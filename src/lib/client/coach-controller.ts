import {
  COACH_LIMITS, CoachRecognizeRequestSchema, GuideCatalogSchema,
  replayCoachHistory, validateCoachContext, validateCoachHelpRequest,
  validateCoachHelpResponse, validateCoachSpeechRequest, validateRecognitionResponse,
  type CoachContext, type CoachHelpRequest, type CoachHelpResponse, type CoachHistory,
  type CoachProgressState, type CoachRecognitionResponse, type CoachRecognizeRequest,
  type CoachSpeechRequest, type CoachVoiceState, type GuideCatalog, type Observation,
} from "@/lib/contracts/coach";
import { createRequestId, preparePhoto, type GuidePhoto } from "./photos";

export type CoachRecognitionTransport = (request: CoachRecognizeRequest, photos: GuidePhoto[], signal: AbortSignal) => Promise<CoachRecognitionResponse>;
/** The transport must return the actual response headers, never copy request IDs into them. */
export type CoachSpeechAudio = { audio: Blob; requestId: string; revision: number; contentType: string };
export interface CoachAssistanceTransport {
  help?: (request: CoachHelpRequest, signal: AbortSignal) => Promise<CoachHelpResponse>;
  speech?: (request: CoachSpeechRequest, signal: AbortSignal) => Promise<CoachSpeechAudio>;
}
/**
 * All operations belong to the supplied signal. In particular, a late getUserMedia
 * result must stop its OWN tracks after abort, without stopping a newer recording.
 * startRecording resolves once ready, and calls onError for duration/size limits.
 * Limits must cancel capture, not upload automatically. finishRecording is called
 * only by the user's finish tap; play resolves on ended and never advances a step.
 * cancelRecording/stopPlayback/dispose must be idempotent and release their URLs.
 */
export interface CoachAudioAdapter {
  startRecording(signal: AbortSignal, onError: (error: Error) => void): Promise<void>;
  finishRecording(): Promise<Blob>;
  cancelRecording(): void;
  play(audio: Blob, signal: AbortSignal): Promise<void>;
  stopPlayback(): void;
  dispose(): void;
}
export type CoachObject = { objectId: string | null; observation: Observation | null; flowId: string; history: CoachHistory };
export type CoachCurrent = ReturnType<typeof replayCoachHistory>;
export type CoachState = {
  progress: CoachProgressState;
  voice: CoachVoiceState;
  sessionId: string;
  revision: number;
  photos: GuidePhoto[];
  objects: CoachObject[];
  activeObjectId: string | null;
  current: CoachCurrent | null;
  mode: "photo" | "manual";
  recognitionText: string;
  guidanceStarted: boolean;
  muted: boolean;
  helpReply: CoachHelpResponse | null;
  helpText: string;
  transcript: string | null;
  error: string | null;
  voiceError: string | null;
  voiceAutoPaused: boolean;
  requiresRestart: boolean;
};
export type CoachControllerOptions = {
  catalog: GuideCatalog;
  recognize: CoachRecognitionTransport;
  assistance?: CoachAssistanceTransport;
  audio?: CoachAudioAdapter;
  prepare?: typeof preparePhoto;
  createId?: () => string;
  revoke?: (url: string) => void;
};
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !(value instanceof Blob) && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

/** Tab-memory-only authority. Keep this instance stable and use subscribe/getSnapshot with useSyncExternalStore. */
export function createCoachController(options: CoachControllerOptions) {
  const catalog = freeze(GuideCatalogSchema.parse(options.catalog));
  const createId = options.createId ?? createRequestId;
  const revoke = options.revoke ?? (url => URL.revokeObjectURL(url));
  const listeners = new Set<() => void>();
  const pending = new Map<string, AbortController>();
  let generation = 0;
  let disposed = false;
  let playbackActive = false;
  let microphoneActive = false;
  let microphoneReady = false;
  let microphoneToken: ReturnType<typeof task> | null = null;
  let helpRequestId: string | null = null;
  let speechRequestId: string | null = null;
  let recognitionRequest: { requestId: string; revision: number } | null = null;
  let state: CoachState = freeze(initial(createId(), 0, false));

  function initial(sessionId: string, revision: number, muted: boolean): CoachState {
    return { progress: "idle", voice: "off", sessionId, revision, photos: [], objects: [], activeObjectId: null, current: null,
      mode: "manual", recognitionText: "", guidanceStarted: false, muted, helpReply: null, helpText: "", transcript: null,
      error: null, voiceError: null, voiceAutoPaused: false, requiresRestart: false };
  }
  function publish(patch: Partial<CoachState>) {
    state = freeze({ ...state, ...patch }); listeners.forEach(listener => listener());
  }
  function release(photos: GuidePhoto[]) { photos.forEach(photo => revoke(photo.url)); }
  function stopAssistance() {
    for (const [requestId, controller] of pending) {
      if (requestId === recognitionRequest?.requestId) continue;
      controller.abort(); pending.delete(requestId);
    }
    if (playbackActive) { playbackActive = false; options.audio?.stopPlayback(); }
    if (microphoneActive) { microphoneActive = false; options.audio?.cancelRecording(); }
    microphoneReady = false; microphoneToken = null;
    helpRequestId = null;
    speechRequestId = null;
  }
  function stopWork() {
    generation++; recognitionRequest = null; stopAssistance();
  }
  const restingVoice = () => state.muted || !state.guidanceStarted ? "off" as const : state.voiceAutoPaused ? "error" as const : "idle" as const;
  function begin(patch: Partial<CoachState> = {}, scope: "all" | "assistance" = "all") {
    if (scope === "all") stopWork(); else stopAssistance();
    publish({ revision: state.revision + 1, voice: restingVoice(), helpReply: null, voiceError: state.voiceAutoPaused ? state.voiceError : null, error: null, ...patch });
  }
  function beginAudio(patch: Partial<Pick<CoachState, "muted" | "voice" | "voiceAutoPaused" | "voiceError">> = {}) {
    // The completed answer still belongs to this unchanged object, step and history.
    // Keep its original response context; new speech requests use context() below
    // with a fresh request ID and revision. Pending assistance is still cancelled.
    begin({ ...patch, helpReply: state.helpReply }, "assistance");
  }
  const active = () => state.objects.find(object => object.objectId === state.activeObjectId);
  function context(): CoachContext {
    const object = active();
    if (!object || !state.current) throw new Error("먼저 안내할 물건을 골라 주세요.");
    const value = { requestId: createId(), sessionId: state.sessionId, objectId: object.objectId, revision: state.revision,
      catalogVersion: catalog.version, flowId: object.flowId, stepId: state.current.step.id };
    validateCoachContext(catalog, value, object.history);
    return value;
  }
  function task(requestId: string, currentContext?: CoachContext) {
    const abort = new AbortController(); pending.set(requestId, abort);
    return { requestId, abort, generation, sessionId: state.sessionId, revision: state.revision, context: currentContext };
  }
  function isCurrent(token: ReturnType<typeof task>) {
    return !disposed && token.generation === generation && !token.abort.signal.aborted && pending.get(token.requestId) === token.abort
      && state.sessionId === token.sessionId
      && (token.context
        ? state.revision === token.revision && state.activeObjectId === token.context.objectId && active()?.flowId === token.context.flowId && state.current?.step.id === token.context.stepId
        // Sound preferences and help drafts can advance the guide revision without
        // changing its input. Recognition stays bound to its own request revision.
        : recognitionRequest?.requestId === token.requestId && recognitionRequest.revision === token.revision);
  }
  function settle(token: ReturnType<typeof task>) {
    if (pending.get(token.requestId) === token.abort) pending.delete(token.requestId);
    if (recognitionRequest?.requestId === token.requestId) recognitionRequest = null;
  }
  function derive(objects: CoachObject[], activeObjectId: string | null, started = state.guidanceStarted) {
    const object = objects.find(candidate => candidate.objectId === activeObjectId);
    if (!object) return { objects, activeObjectId, current: null, progress: "idle" as CoachProgressState };
    const flow = catalog.flows.find(candidate => candidate.id === object.flowId)!;
    const current = replayCoachHistory(flow, object.history);
    validateCoachContext(catalog, { requestId: createId(), sessionId: state.sessionId, revision: state.revision, catalogVersion: catalog.version,
      objectId: object.objectId, flowId: object.flowId, stepId: current.step.id }, object.history);
    const progress: CoachProgressState = current.held ? "needs_help" : current.ended ? "complete" : started ? "guiding" : "choosing";
    return { objects, activeObjectId, current, progress };
  }
  function voiceFailure(error: unknown) {
    publish({ voice: "error", voiceAutoPaused: true, voiceError: message(error, "소리를 사용할 수 없어요. 화면 안내를 계속 보거나 글로 질문해 주세요.") });
  }
  async function speak(cue?: CoachSpeechRequest["cue"]) {
    if (disposed || state.muted || state.voiceAutoPaused || !state.guidanceStarted || !state.current || !options.audio || !options.assistance?.speech) return;
    const request: CoachSpeechRequest = { context: context(), choices: active()!.history.slice(), cue: cue ?? { kind: "step", id: state.current.step.id } };
    validateCoachSpeechRequest(catalog, request);
    const token = task(request.context.requestId, request.context);
    speechRequestId = request.context.requestId;
    publish({ voice: "processing", voiceError: null });
    try {
      const result = await options.assistance.speech(request, token.abort.signal);
      if (!isCurrent(token)) return;
      if (result.requestId !== request.context.requestId || result.revision !== request.context.revision
        || result.contentType.split(";")[0].trim().toLowerCase() !== "audio/wav" || !(result.audio instanceof Blob) || !result.audio.size) {
        throw new Error("현재 단계의 음성을 확인하지 못했어요. 화면 안내를 계속 볼 수 있어요.");
      }
      playbackActive = true; publish({ voice: "speaking" });
      await options.audio.play(result.audio, token.abort.signal);
      if (!isCurrent(token)) return;
      playbackActive = false; publish({ voice: restingVoice() });
    } catch (error) {
      if (!isCurrent(token)) return;
      if (playbackActive) { playbackActive = false; options.audio.stopPlayback(); }
      voiceFailure(error);
    } finally { if (speechRequestId === token.requestId) speechRequestId = null; settle(token); }
  }
  async function runRecognition() {
    if (disposed || state.requiresRestart || state.progress === "recognizing" || state.progress === "preparing") return;
    const input = CoachRecognizeRequestSchema.safeParse({ requestId: createId(), sessionId: state.sessionId, revision: state.revision + 1,
      region: "songpa", mode: state.mode, photoIds: state.photos.map(photo => photo.id), text: state.recognitionText });
    if (!input.success) return;
    begin({ progress: "recognizing", objects: [], current: null, activeObjectId: null, guidanceStarted: false, voice: "off", helpText: "", transcript: null });
    const request = input.data;
    const token = task(request.requestId);
    recognitionRequest = { requestId: request.requestId, revision: request.revision };
    try {
      const raw = await options.recognize(request, state.photos.slice(), token.abort.signal);
      if (!isCurrent(token)) return;
      if (raw.catalogVersion !== catalog.version) {
        publish({ progress: "error", requiresRestart: true, error: "안내 기준이 변경됐어요. 처음으로 돌아가 다시 시작해 주세요." }); return;
      }
      const response = validateRecognitionResponse(catalog, raw, request);
      if (response.requestId !== request.requestId || response.sessionId !== request.sessionId || response.revision !== request.revision) throw new Error("현재 요청의 인식 결과가 아니에요. 다시 시도해 주세요.");
      const objects: CoachObject[] = response.routes.map(route => ({ ...route, observation: response.objects.find(object => object.objectId === route.objectId) ?? null, history: [] }));
      publish(derive(objects, objects[0].objectId));
    } catch (error) {
      if (isCurrent(token)) publish({ progress: "error", error: message(error, "물건을 확인하지 못했어요. 입력을 확인하고 다시 시도해 주세요.") });
    } finally { settle(token); }
  }
  async function help(input: { text: string } | { audio: Blob }) {
    if (!options.assistance?.help || !state.current || disposed) return;
    const request: CoachHelpRequest = { context: context(), choices: active()!.history.slice(), ...input };
    try { validateCoachHelpRequest(catalog, request); }
    catch { voiceFailure(new Error("질문이 비어 있거나 너무 길어요. 짧은 글이나 20초 이내 음성으로 질문해 주세요.")); return; }
    const token = task(request.context.requestId, request.context);
    helpRequestId = request.context.requestId;
    publish({ voice: "processing", voiceError: null });
    try {
      const raw = await options.assistance.help(request, token.abort.signal);
      if (!isCurrent(token)) return;
      const response = validateCoachHelpResponse(catalog, raw, request);
      helpRequestId = null;
      publish({ helpReply: response, transcript: response.transcript, helpText: response.transcript ?? state.helpText, voiceAutoPaused: false, voiceError: null, voice: state.muted || !state.guidanceStarted ? "off" : "idle" });
      await speak({ kind: "reply", id: response.replyId });
    } catch (error) { if (isCurrent(token)) voiceFailure(error); }
    finally { if (helpRequestId === token.requestId) helpRequestId = null; settle(token); }
  }
  function changeHistory(history: CoachHistory) {
    const object = active()!;
    const objects = state.objects.map(value => value === object ? { ...value, history } : value);
    const result = derive(objects, state.activeObjectId, true);
    begin({ ...result, guidanceStarted: true, helpText: "", transcript: null });
    if (!result.current?.ended) void speak();
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { if (disposed) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    async selectPhotos(files: File[]) {
      if (disposed || !files.length) return;
      // Rejected input never changes the valid input or its in-flight work.
      if (files.length > COACH_LIMITS.photos) { publish({ error: "한 번에 사진 3장까지 골라 주세요." }); return; }
      begin({ progress: "preparing", objects: [], activeObjectId: null, current: null, guidanceStarted: false, voice: "off", helpText: "", transcript: null, requiresRestart: false });
      const currentGeneration = generation;
      const prepared: GuidePhoto[] = [];
      try {
        for (const file of files) {
          prepared.push(await (options.prepare ?? preparePhoto)(file));
          if (disposed || generation !== currentGeneration) { release(prepared); return; }
        }
        release(state.photos);
        publish({ photos: prepared, mode: "photo", recognitionText: "", progress: "idle" });
        await runRecognition();
      } catch (error) {
        release(prepared);
        if (!disposed && generation === currentGeneration) publish({ progress: "error", error: message(error, "사진을 읽지 못했어요. 다시 선택해 주세요.") });
      }
    },
    retryRecognition: runRecognition,
    async recognizeText(text: string) {
      if (disposed || state.progress === "recognizing" || state.requiresRestart) return;
      if (!text.trim() || text.length > COACH_LIMITS.text) { publish({ error: "물건의 이름과 상태를 1,000자 이내로 적어 주세요." }); return; }
      release(state.photos);
      begin({ recognitionText: text, mode: "manual", photos: [], objects: [], activeObjectId: null, current: null, progress: "idle", guidanceStarted: false, voice: "off" });
      await runRecognition();
    },
    /** Direct category selection is local and creates a new physical object, even for the same category. */
    pickCategory(categoryId: string) {
      if (disposed || state.requiresRestart) return false;
      const category = catalog.categories.find(value => value.id === categoryId);
      const flow = catalog.flows.find(value => value.categoryId === categoryId);
      if (!category || !flow) return false;
      const objectId = createId();
      const object: CoachObject = { objectId, observation: { objectId, label: category.label, categoryId, recognition: "recognized", views: [], parts: [] }, flowId: flow.id, history: [] };
      release(state.photos);
      begin({ ...derive([object], objectId, false), mode: "manual", photos: [], recognitionText: "", guidanceStarted: false, voice: "off", helpText: "", transcript: null });
      return true;
    },
    switchObject(objectId: string | null) {
      if (disposed || objectId === state.activeObjectId || !state.objects.some(object => object.objectId === objectId)) return false;
      begin({ ...derive(state.objects, objectId), helpText: "", transcript: null });
      void speak(); return true;
    },
    async startGuidance() {
      if (disposed || !state.current || state.guidanceStarted || state.requiresRestart) return;
      begin({ ...derive(state.objects, state.activeObjectId, true), guidanceStarted: true, voiceAutoPaused: false, voiceError: null });
      await speak();
    },
    /** Pass the rendered step ID so rapid double clicks cannot answer the following step. */
    choose(choiceId: string, expectedStepId: string) {
      if (disposed || !state.guidanceStarted || !state.current || state.current.ended || state.current.step.id !== expectedStepId
        || !state.current.step.choices.some(choice => choice.id === choiceId)) return false;
      changeHistory([...active()!.history, { stepId: expectedStepId, choiceId }]); return true;
    },
    back() {
      if (disposed || !active()?.history.length) return false;
      changeHistory(active()!.history.slice(0, -1)); return true;
    },
    correct(stepId: string, choiceId: string) {
      const object = active();
      if (disposed || !object) return false;
      const index = object.history.findIndex(entry => entry.stepId === stepId);
      if (index < 0) return false;
      const flow = catalog.flows.find(value => value.id === object.flowId)!;
      if (!flow.steps.find(step => step.id === stepId)?.choices.some(choice => choice.id === choiceId)) return false;
      changeHistory([...object.history.slice(0, index), { stepId, choiceId }]); return true;
    },
    setHelpText(text: string) {
      if (disposed || text === state.helpText) return;
      begin({ helpText: text }, "assistance");
    },
    async requestHelp(text = state.helpText) {
      if (disposed || !state.current || helpRequestId || microphoneActive) return;
      begin({ helpText: text }); await help({ text });
    },
    async startRecording() {
      if (disposed || !state.current || !options.audio || microphoneActive || helpRequestId) return;
      beginAudio({ voiceAutoPaused: false, voiceError: null });
      const currentContext = context(); const token = task(currentContext.requestId, currentContext);
      microphoneToken = token; microphoneActive = true; microphoneReady = false;
      publish({ voice: "recording" });
      let reportedFailure = false;
      const failed = (error: Error) => {
        if (!isCurrent(token)) return;
        reportedFailure = true;
        microphoneActive = false; microphoneReady = false; microphoneToken = null;
        options.audio!.cancelRecording(); token.abort.abort(); settle(token); voiceFailure(error);
      };
      try {
        await options.audio.startRecording(token.abort.signal, failed);
        if (!isCurrent(token)) {
          // The adapter owns per-signal cleanup; this additionally handles a late
          // permission result when there is no newer capture to accidentally stop.
          if (!reportedFailure && !microphoneActive) options.audio.cancelRecording(); return;
        }
        microphoneReady = true;
      } catch (error) { failed(new Error(message(error, "마이크를 사용할 수 없어요. 글로 질문해 주세요."))); }
    },
    async finishRecording() {
      if (disposed || !microphoneActive || !microphoneReady || !microphoneToken || !options.audio) return;
      const captureToken = microphoneToken; microphoneReady = false;
      // Stop accepting limit callbacks from the recording phase while the adapter
      // finishes its explicit user-triggered encoding. Reset can still abort both.
      publish({ voice: "processing", revision: state.revision + 1 });
      const currentContext = context(); const token = task(currentContext.requestId, currentContext);
      microphoneToken = token;
      try {
        const audio = await options.audio.finishRecording();
        if (!isCurrent(token)) return;
        microphoneActive = false; microphoneToken = null; settle(token);
        begin(); await help({ audio });
      } catch (error) {
        if (!isCurrent(token)) return;
        microphoneActive = false; microphoneToken = null; options.audio.cancelRecording(); settle(token); voiceFailure(error);
      } finally { settle(captureToken); }
    },
    cancelRecording() { if (!disposed && microphoneActive) beginAudio(); },
    async mute(muted = true) {
      if (disposed || muted === state.muted) return;
      beginAudio({ muted, voice: muted ? "off" : state.guidanceStarted ? "idle" : "off", ...(!muted ? { voiceAutoPaused: false, voiceError: null } : {}) });
      if (!muted) await speak();
    },
    async replay() {
      if (disposed || state.muted || !state.guidanceStarted || !state.current || speechRequestId) return;
      beginAudio({ voiceAutoPaused: false, voiceError: null }); await speak();
    },
    reset() {
      if (disposed) return;
      stopWork(); release(state.photos);
      state = freeze(initial(createId(), state.revision + 1, state.muted)); listeners.forEach(listener => listener());
    },
    dispose() {
      if (disposed) return;
      stopWork(); release(state.photos); options.audio?.dispose();
      state = freeze(initial(createId(), state.revision + 1, state.muted)); disposed = true; listeners.clear();
    },
  };
}
export type CoachController = ReturnType<typeof createCoachController>;

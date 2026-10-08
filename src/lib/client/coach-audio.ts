import {
  COACH_LIMITS, CoachErrorResponseSchema, CoachHelpRequestSchema, CoachHelpResponseSchema, CoachSpeechRequestSchema,
  type CoachContext, type CoachHelpRequest,
} from "@/lib/contracts/coach";
import { decodeCoachWav, encodeCoachWav, resampleCoachPcm } from "@/lib/audio/coach-wav";
import type { CoachAssistanceTransport, CoachAudioAdapter } from "./coach-controller";

const invalid = () => new Error("도움 응답을 확인하지 못했어요. 현재 화면에서 다시 시도해 주세요.");
const cancelled = () => new DOMException("요청을 취소했어요.", "AbortError");
const sameContext = (a: CoachContext, b: CoachContext) => Object.keys(a).every(key => a[key as keyof CoachContext] === b[key as keyof CoachContext]);

async function readResponse(response: Response, signal: AbortSignal, limit: number): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  if (!response.body) throw invalid();
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) { void response.body.cancel().catch(() => {}); throw invalid(); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted(); const next = await reader.read(); signal.throwIfAborted();
      if (next.done) break;
      size += next.value.length; if (size > limit) throw invalid(); chunks.push(next.value);
    }
    if (declared !== null && Number(declared) !== size) throw invalid();
    const buffer = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { buffer.set(chunk, at); at += chunk.length; }
    return buffer.buffer;
  } finally { cancel(); chunks.length = 0; signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

async function send<T>(url: string, init: RequestInit, requestId: string, signal: AbortSignal, receive: (response: Response, signal: AbortSignal) => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const abort = new AbortController(); let timedOut = false;
  const cancel = () => abort.abort(signal.reason);
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; abort.abort(); }, COACH_LIMITS.timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: abort.signal, cache: "no-store" });
    abort.signal.throwIfAborted();
    if (!response.ok) {
      const bytes = await readResponse(response, abort.signal, 16 * 1024);
      let payload: unknown; try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw invalid(); }
      const error = CoachErrorResponseSchema.safeParse(payload);
      throw new Error(error.success && (error.data.requestId === null || error.data.requestId === requestId) ? error.data.error.message : "서비스에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    }
    const result = await receive(response, abort.signal); abort.signal.throwIfAborted(); return result;
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? cancelled();
    if (timedOut) throw new Error("응답 시간이 길어지고 있어요. 화면 안내를 보거나 다시 시도해 주세요.");
    if (error instanceof TypeError) throw new Error("인터넷 연결을 확인하고 다시 시도해 주세요.");
    throw error;
  } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
}

export function createCoachAssistanceTransport(): Required<CoachAssistanceTransport> {
  return {
    async help(request, signal) {
      signal.throwIfAborted();
      const parsed = CoachHelpRequestSchema.safeParse(request); if (!parsed.success) throw invalid();
      const input: CoachHelpRequest = parsed.data;
      const body = new FormData(); body.set("context", JSON.stringify(input.context)); body.set("choices", JSON.stringify(input.choices));
      if ("text" in input) body.set("text", input.text);
      else { if (input.audio.type !== "audio/wav") throw invalid(); const bytes = await input.audio.arrayBuffer(); try { decodeCoachWav(bytes).samples.fill(0); } finally { new Uint8Array(bytes).fill(0); } signal.throwIfAborted(); body.set("audio", input.audio, "question.wav"); }
      return send("/api/coach/help", { method: "POST", body }, input.context.requestId, signal, async (response, currentSignal) => {
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw invalid();
        const bytes = await readResponse(response, currentSignal, 64 * 1024);
        let raw: unknown; try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw invalid(); }
        const result = CoachHelpResponseSchema.safeParse(raw);
        if (!result.success || !sameContext(result.data.context, input.context)
          || ("text" in input ? result.data.transcript !== null : !result.data.transcript?.trim())) throw invalid();
        // Canonical reply/source validation belongs to the controller's page-provided catalog.
        return result.data;
      });
    },
    async speech(request, signal) {
      signal.throwIfAborted(); const parsed = CoachSpeechRequestSchema.safeParse(request); if (!parsed.success) throw invalid();
      return send("/api/coach/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) }, request.context.requestId, signal, async (response, currentSignal) => {
        const contentType = response.headers.get("content-type"), requestId = response.headers.get("x-request-id"), revision = response.headers.get("x-guide-revision");
        if (contentType !== "audio/wav" || requestId !== request.context.requestId || revision !== String(request.context.revision)) { void response.body?.cancel().catch(() => {}); throw invalid(); }
        const bytes = await readResponse(response, currentSignal, COACH_LIMITS.audioBytes);
        try { decodeCoachWav(bytes).samples.fill(0); return { audio: new Blob([bytes], { type: contentType }), contentType, requestId, revision: Number(revision) }; }
        finally { new Uint8Array(bytes).fill(0); }
      });
    },
  };
}

type Capture = { signal: AbortSignal; abort: () => void; onError: (error: Error) => void; stream?: MediaStream; source?: MediaStreamAudioSourceNode;
  node?: AudioWorkletNode; mute?: GainNode; timer?: ReturnType<typeof setTimeout>; frames: Float32Array[]; samples: number; rate: number; live: boolean };
type Playback = { live: boolean; signal: AbortSignal; abort: () => void; source?: AudioBufferSourceNode; reject?: (error: unknown) => void };

/** No microphone opens until startRecording. One context is primed in a real button gesture. */
export function createBrowserCoachAudio(): CoachAudioAdapter & { unlockPlayback(): Promise<void> } {
  let context: AudioContext | null = null, worklet: Promise<void> | null = null, recording: Capture | null = null, playback: Playback | null = null, disposed = false;
  function getContext() {
    if (disposed) throw cancelled();
    if (!context) {
      const Context = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) throw new Error("이 브라우저에서는 소리를 사용할 수 없어요. 화면 안내나 글 질문을 이용해 주세요.");
      context = new Context();
    }
    return context;
  }
  function releaseCapture(capture: Capture) {
    if (!capture.live) return;
    capture.live = false; clearTimeout(capture.timer); capture.signal.removeEventListener("abort", capture.abort);
    if (capture.node) { capture.node.port.onmessage = null; capture.node.port.close(); capture.node.disconnect(); }
    capture.source?.disconnect(); capture.mute?.disconnect(); capture.stream?.getTracks().forEach(track => track.stop());
    capture.stream = undefined; capture.node = undefined; capture.source = undefined; capture.mute = undefined;
    if (recording === capture) recording = null;
  }
  function cancelRecording() { if (recording) { const current = recording; releaseCapture(current); current.frames.forEach(frame => frame.fill(0)); current.frames.length = 0; } }
  function stopPlayback() {
    const current = playback; if (!current) return;
    current.live = false; playback = null; current.signal.removeEventListener("abort", current.abort);
    if (current.source) { current.source.onended = null; current.source.stop(); current.source.disconnect(); current.source.buffer = null; }
    current.reject?.(current.signal.reason ?? cancelled());
  }
  function unlockPlayback(): Promise<void> {
    try {
      const audio = getContext();
      // resume and start both execute before the first await, preserving iOS gesture activation.
      const resumed = audio.resume();
      const prime = audio.createBufferSource(); prime.buffer = audio.createBuffer(1, 1, audio.sampleRate); prime.connect(audio.destination);
      prime.onended = () => { prime.disconnect(); prime.buffer = null; }; prime.start();
      return resumed;
    } catch (error) { return Promise.reject(error); }
  }
  return {
    unlockPlayback,
    async startRecording(signal, onError) {
      signal.throwIfAborted(); if (disposed) throw cancelled();
      stopPlayback(); cancelRecording();
      if (!globalThis.isSecureContext) throw new Error("마이크는 HTTPS 보안 연결이나 이 컴퓨터의 localhost에서 사용할 수 있어요. 글로 질문해 주세요.");
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("이 브라우저에서는 마이크를 사용할 수 없어요. 글로 질문해 주세요.");
      const capture: Capture = { signal, onError, abort: () => {}, frames: [], samples: 0, rate: 0, live: true };
      capture.abort = () => { releaseCapture(capture); capture.frames.forEach(frame => frame.fill(0)); capture.frames.length = 0; };
      recording = capture; signal.addEventListener("abort", capture.abort, { once: true });
      try {
        const audio = getContext(); await audio.resume();
        if (!capture.live || signal.aborted) throw cancelled();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
        if (!capture.live || signal.aborted || disposed) { stream.getTracks().forEach(track => track.stop()); throw cancelled(); }
        capture.stream = stream; capture.rate = audio.sampleRate;
        const fail = () => { if (!capture.live) return; capture.abort(); onError(new Error("녹음은 20초까지예요. 짧게 다시 녹음하거나 글로 질문해 주세요.")); };
        capture.timer = setTimeout(fail, COACH_LIMITS.audioSeconds * 1000);
        worklet ??= audio.audioWorklet.addModule("/coach-pcm-worklet.js").catch(error => { worklet = null; throw error; }); await worklet;
        if (!capture.live || signal.aborted || disposed) throw cancelled();
        capture.source = audio.createMediaStreamSource(stream); capture.node = new AudioWorkletNode(audio, "coach-pcm-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        capture.mute = audio.createGain(); capture.mute.gain.value = 0;
        capture.node.port.onmessage = event => {
          if (!capture.live) return;
          const frame: unknown = event.data;
          if (!(frame instanceof Float32Array) || frame.length > 4096 || frame.some(value => !Number.isFinite(value))) { capture.abort(); onError(new Error("녹음에 문제가 생겼어요. 다시 녹음하거나 글로 질문해 주세요.")); return; }
          if (capture.samples + frame.length > capture.rate * COACH_LIMITS.audioSeconds) { fail(); return; }
          capture.frames.push(frame); capture.samples += frame.length;
        };
        capture.source.connect(capture.node); capture.node.connect(capture.mute); capture.mute.connect(audio.destination);
      } catch (error) {
        capture.abort();
        if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw signal.reason ?? cancelled();
        if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)) throw new Error("마이크 권한을 허용한 뒤 다시 녹음해 주세요. 글로 질문할 수도 있어요.");
        if (error instanceof DOMException && ["NotFoundError", "NotReadableError"].includes(error.name)) throw new Error("마이크를 연결하거나 다른 앱의 녹음을 끄고 다시 시도해 주세요.");
        throw new Error("마이크를 시작하지 못했어요. 글로 질문해 주세요.");
      }
    },
    async finishRecording() {
      const capture = recording;
      if (!capture?.live || !capture.node) throw new Error("진행 중인 녹음이 없어요. 다시 녹음해 주세요.");
      capture.signal.throwIfAborted(); releaseCapture(capture);
      const samples = new Float32Array(capture.samples); let at = 0; let pcm: Int16Array | undefined;
      try {
        for (const frame of capture.frames) { samples.set(frame, at); at += frame.length; }
        pcm = resampleCoachPcm(samples, capture.rate); const wav = encodeCoachWav(pcm); decodeCoachWav(wav).samples.fill(0);
        const blob = new Blob([wav], { type: "audio/wav" }); new Uint8Array(wav).fill(0); return blob;
      } finally { samples.fill(0); pcm?.fill(0); capture.frames.forEach(frame => frame.fill(0)); capture.frames.length = 0; }
    },
    cancelRecording,
    async play(blob, signal) {
      signal.throwIfAborted(); stopPlayback(); if (disposed) throw cancelled();
      const audio = getContext(), current: Playback = { live: true, signal, abort: () => {} };
      current.abort = () => { if (playback === current) stopPlayback(); };
      playback = current; signal.addEventListener("abort", current.abort, { once: true });
      try {
        const bytes = await blob.arrayBuffer();
        if (!current.live || signal.aborted) throw cancelled();
        decodeCoachWav(bytes).samples.fill(0);
        const decoded = await audio.decodeAudioData(bytes);
        if (!current.live || signal.aborted || disposed) throw cancelled();
        if (audio.state !== "running") throw new Error("소리가 일시 정지됐어요.");
        await new Promise<void>((resolve, reject) => {
          current.reject = reject;
          const source = audio.createBufferSource(); current.source = source; source.buffer = decoded; source.connect(audio.destination);
          source.onended = () => { if (!current.live) return; current.live = false; source.disconnect(); source.buffer = null; resolve(); };
          source.start();
        });
      } catch {
        if (!current.live || signal.aborted || disposed) throw signal.reason ?? cancelled();
        throw new Error("소리를 재생하지 못했어요. ‘다시 듣기’를 누르거나 화면 안내를 봐 주세요.");
      } finally {
        signal.removeEventListener("abort", current.abort);
        if (playback === current) { playback = null; current.live = false; if (current.source) { current.source.onended = null; current.source.disconnect(); current.source.buffer = null; } }
      }
    },
    stopPlayback,
    dispose() { if (disposed) return; cancelRecording(); stopPlayback(); disposed = true; const audio = context; context = null; worklet = null; if (audio) void audio.close().catch(() => {}); },
  };
}

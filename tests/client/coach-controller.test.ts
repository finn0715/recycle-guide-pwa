import { describe, expect, it, vi } from "vitest";
import { COACH_CATALOG } from "@/data/coach-guides";
import { createCoachController, type CoachAudioAdapter, type CoachAssistanceTransport, type CoachRecognitionTransport } from "@/lib/client/coach-controller";
import type { CoachHelpRequest, CoachRecognitionResponse, CoachRecognizeRequest, CoachSpeechRequest } from "@/lib/contracts/coach";
import { validateCoachSpeechRequest } from "@/lib/contracts/coach";
import type { GuidePhoto } from "@/lib/client/photos";

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const id = (n: number) => `6ba7b810-9dad-41d1-80b4-${n.toString().padStart(12, "0")}`;
const file = new File(["photo"], "can.jpg", { type: "image/jpeg" });
const photo: GuidePhoto = { id: id(100), file, name: file.name, url: "blob:can" };
const wav = () => new Blob([new Uint8Array(64)], { type: "audio/wav" });
function recognized(request: CoachRecognizeRequest, count = 1): CoachRecognitionResponse {
  const objects = Array.from({ length: count }, (_, i) => ({ objectId: id(200 + i), label: `캔 ${i + 1}`, categoryId: "metal_can", recognition: "recognized" as const, views: request.photoIds.map(photoId => ({ photoId, box: null })), parts: [] }));
  return { requestId: request.requestId, sessionId: request.sessionId, revision: request.revision, catalogVersion: COACH_CATALOG.version, outcome: "identified", objects, routes: objects.map(o => ({ objectId: o.objectId, flowId: "metal-can" })) };
}
function answer(request: CoachHelpRequest) {
  const reply = COACH_CATALOG.replies.find(r => r.allowedStepIds.includes(request.context.stepId))!;
  return { context: request.context, transcript: "audio" in request ? "이게 어떤 캔인가요" : null, replyId: reply.id, text: reply.text, choiceIds: reply.choiceIds, sourceIds: reply.sourceIds };
}
function setup(extra: Partial<Parameters<typeof createCoachController>[0]> = {}) {
  let sequence = 0;
  const recognize = vi.fn<CoachRecognitionTransport>(async request => recognized(request));
  const audio: CoachAudioAdapter = { startRecording: vi.fn(async () => {}), finishRecording: vi.fn(async () => wav()), cancelRecording: vi.fn(), play: vi.fn(async () => {}), stopPlayback: vi.fn(), dispose: vi.fn() };
  const assistance: CoachAssistanceTransport = { help: vi.fn(async request => answer(request)), speech: vi.fn(async request => ({ audio: wav(), requestId: request.context.requestId, revision: request.context.revision, contentType: "audio/wav" })) };
  const revoke = vi.fn();
  const controller = createCoachController({ catalog: COACH_CATALOG, recognize, audio, assistance, createId: () => id(++sequence), prepare: async () => photo, revoke, ...extra });
  return { controller, recognize, audio, assistance: extra.assistance ?? assistance, revoke };
}
function choose(c: ReturnType<typeof setup>["controller"], choice: string) { expect(c.choose(choice, c.getSnapshot().current!.step.id)).toBe(true); }
async function manual(category = "metal_can") { const h = setup(); h.controller.pickCategory(category); await h.controller.startGuidance(); return h; }

describe("coach progress authority", () => {
  it("enters without audio, completes only through user choices, and never exposes guessed total steps", async () => {
    const { controller: c, assistance } = setup();
    expect(c.getSnapshot().progress).toBe("idle"); expect(assistance.speech).not.toHaveBeenCalled();
    c.pickCategory("metal_can"); expect(c.getSnapshot().mode).toBe("manual"); expect(c.getSnapshot().objects[0].observation!.views).toEqual([]);
    expect(assistance.speech).not.toHaveBeenCalled(); await c.startGuidance();
    for (const choice of ["aluminum", "none", "done", "done", "done"]) choose(c, choice);
    expect(c.getSnapshot().progress).toBe("guiding"); expect(c.getSnapshot().current!.step.kind).toBe("complete");
    choose(c, "finish"); expect(c.getSnapshot().progress).toBe("complete");
    expect(c.getSnapshot().current!.facts).toMatchObject({ contents: "empty", clean: "yes" });
    expect(c.getSnapshot()).not.toHaveProperty("totalSteps");
  });
  it("back and earlier correction remove only that choice and its dependent suffix", async () => {
    const { controller: c } = await manual(); choose(c, "aluminum"); choose(c, "none"); choose(c, "done");
    c.back(); expect(c.getSnapshot().current!.step.id).toBe("can-empty"); expect(c.getSnapshot().current!.facts).not.toHaveProperty("contents");
    c.correct("can-kind", "steel"); expect(c.getSnapshot().current!.facts).toEqual({ can_kind: "steel_food" });
    expect(c.getSnapshot().objects[0].history).toEqual([{ stepId: "can-kind", choiceId: "steel" }]);
  });
  it("keeps two physical cans and their histories separate", async () => {
    const { controller: c } = setup({ recognize: async request => recognized(request, 2) });
    await c.selectPhotos([file]); await c.startGuidance(); choose(c, "aluminum");
    c.switchObject(id(201)); expect(c.getSnapshot().current!.facts).toEqual({}); choose(c, "steel");
    c.switchObject(id(200)); expect(c.getSnapshot().current!.facts).toEqual({ can_kind: "aluminum_beverage" });
    expect(c.getSnapshot().objects).toHaveLength(2);
  });
  it("retains partial history but holds unfinished components without inventing absent parts", async () => {
    const { controller: c } = await manual("pump_bottle");
    for (const value of ["plastic", "none", "none", "cannot"]) choose(c, value);
    expect(c.getSnapshot().progress).toBe("needs_help");
    expect(c.getSnapshot().current!.destinations.map(d => d.partRole)).toEqual(["body"]);
    choose(c, "close"); expect(c.getSnapshot().progress).toBe("needs_help");
  });
  it("rejects duplicate clicks from the previous step, including repeated done IDs", async () => {
    const { controller: c } = await manual(); choose(c, "aluminum"); choose(c, "none");
    expect(c.choose("done", "can-empty")).toBe(true); expect(c.choose("done", "can-empty")).toBe(false);
    expect(c.getSnapshot().current!.step.id).toBe("can-rinse");
  });
});

describe("coach request and resource lifetimes", () => {
  const auxiliaryActions = ["mute", "helpText", "invalidPhotos"] as const;
  async function auxiliary(c: ReturnType<typeof setup>["controller"], action: typeof auxiliaryActions[number]) {
    if (action === "mute") await c.mute(true);
    else if (action === "helpText") c.setHelpText("재질을 모르겠어요");
    else await c.selectPhotos([file, file, file, file]);
  }
  it.each(auxiliaryActions)("keeps recognition live during %s without requiring a retry", async action => {
    const pending = deferred<CoachRecognitionResponse>(); let request!: CoachRecognizeRequest; let signal!: AbortSignal;
    const { controller: c } = setup({ recognize: async (r, _photos, s) => { request = r; signal = s; return pending.promise; } });
    const work = c.recognizeText("음료 캔"); await auxiliary(c, action);
    expect(c.getSnapshot().progress).toBe("recognizing"); expect(signal.aborted).toBe(false);
    pending.resolve(recognized(request)); await work;
    expect(c.getSnapshot().progress).toBe("choosing"); expect(c.getSnapshot().objects[0].observation!.categoryId).toBe("metal_can"); c.dispose();
  });
  it.each(auxiliaryActions)("keeps photo preparation and its URL live during %s", async action => {
    const pending = deferred<GuidePhoto>();
    const { controller: c, revoke, recognize } = setup({ prepare: () => pending.promise });
    const work = c.selectPhotos([file]); await auxiliary(c, action);
    expect(c.getSnapshot().progress).toBe("preparing"); expect(revoke).not.toHaveBeenCalled();
    pending.resolve(photo); await work;
    expect(c.getSnapshot().progress).toBe("choosing"); expect(c.getSnapshot().photos).toEqual([photo]); expect(recognize).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled(); c.reset(); expect(revoke).toHaveBeenCalledExactlyOnceWith(photo.url);
  });
  it("rejects invalid manual text without cancelling the photo being prepared", async () => {
    const pending = deferred<GuidePhoto>(); const { controller: c, revoke } = setup({ prepare: () => pending.promise });
    const work = c.selectPhotos([file]); await c.recognizeText(" "); pending.resolve(photo); await work;
    expect(c.getSnapshot().progress).toBe("choosing"); expect(revoke).not.toHaveBeenCalled(); c.dispose();
  });
  it("keeps explicit retry available after an unrelated edit and a recognition failure", async () => {
    const pending = deferred<CoachRecognitionResponse>(); let calls = 0;
    const { controller: c } = setup({ recognize: async request => ++calls === 1 ? pending.promise : recognized(request) });
    const work = c.recognizeText("캔"); c.setHelpText("질문 초안"); pending.reject(new Error("연결을 확인해 주세요.")); await work;
    expect(c.getSnapshot().progress).toBe("error"); expect(c.getSnapshot().recognitionText).toBe("캔");
    await c.retryRecognition(); expect(calls).toBe(2); expect(c.getSnapshot().progress).toBe("choosing"); c.dispose();
  });
  it("still rejects late recognition after a neutral edit followed by manual replacement", async () => {
    const pending = deferred<CoachRecognitionResponse>(); let request!: CoachRecognizeRequest;
    const { controller: c } = setup({ recognize: async r => { request = r; return pending.promise; } });
    const work = c.recognizeText("캔"); await c.mute(true); c.pickCategory("pump_bottle");
    pending.resolve(recognized(request)); await work;
    expect(c.getSnapshot().objects[0].observation!.categoryId).toBe("pump_bottle"); expect(c.getSnapshot().current!.step.id).toBe("pump-material"); c.dispose();
  });
  it("matches recognition replies against the pinned request revision after a neutral edit", async () => {
    const pending = deferred<CoachRecognitionResponse>(); let request!: CoachRecognizeRequest;
    const { controller: c } = setup({ recognize: async r => { request = r; return pending.promise; } });
    const work = c.recognizeText("캔"); c.setHelpText("질문");
    expect(c.getSnapshot().revision).toBeGreaterThan(request.revision);
    pending.resolve({ ...recognized(request), revision: c.getSnapshot().revision }); await work;
    expect(c.getSnapshot().progress).toBe("error"); expect(c.getSnapshot().objects).toEqual([]); c.dispose();
  });
  it("keeps photos after network failure and retries only explicitly with a new request ID", async () => {
    const requests: CoachRecognizeRequest[] = [];
    const { controller: c } = setup({ recognize: async request => { requests.push(request); if (requests.length === 1) throw new Error("연결을 확인해 주세요."); return recognized(request); } });
    await c.selectPhotos([file]); expect(c.getSnapshot().progress).toBe("error"); expect(c.getSnapshot().photos).toHaveLength(1); expect(requests).toHaveLength(1);
    await c.retryRecognition(); expect(c.getSnapshot().progress).toBe("choosing"); expect(requests[0].requestId).not.toBe(requests[1].requestId);
  });
  it("drops late recognition after reset and rejects foreign correlation or catalog", async () => {
    const pending = deferred<CoachRecognitionResponse>(); let request!: CoachRecognizeRequest;
    const { controller: c } = setup({ recognize: async r => { request = r; return pending.promise; } });
    const work = c.recognizeText("음료 캔"); const oldSession = c.getSnapshot().sessionId; c.reset();
    pending.resolve(recognized(request)); await work; expect(c.getSnapshot().objects).toEqual([]); expect(c.getSnapshot().sessionId).not.toBe(oldSession);
    for (const patch of [{ requestId: id(999) }, { sessionId: id(999) }, { revision: 999 }, { catalogVersion: "future" }]) {
      const h = setup({ recognize: async r => ({ ...recognized(r), ...patch }) }); await h.controller.recognizeText("캔");
      expect(h.controller.getSnapshot().progress).toBe("error"); expect(h.controller.getSnapshot().objects).toEqual([]);
    }
  });
  it("releases each late prepared URL after reset and stops preparing more files", async () => {
    const pending = deferred<GuidePhoto>(); const prepare = vi.fn(() => pending.promise);
    const { controller: c, revoke, recognize } = setup({ prepare }); const work = c.selectPhotos([file, file]); c.reset();
    pending.resolve(photo); await work; expect(revoke).toHaveBeenCalledExactlyOnceWith(photo.url); expect(prepare).toHaveBeenCalledTimes(1); expect(recognize).not.toHaveBeenCalled();
  });
  it("releases replaced photos and disposes resources exactly once", async () => {
    const { controller: c, revoke, audio } = setup(); await c.selectPhotos([file]); c.reset(); c.dispose(); c.dispose();
    expect(revoke).toHaveBeenCalledExactlyOnceWith(photo.url); expect(audio.dispose).toHaveBeenCalledTimes(1);
  });
  it("sends freeform names through manual recognition and validates direct categories locally", async () => {
    const { controller: c, recognize } = setup(); expect(c.pickCategory("missing")).toBe(false); expect(c.getSnapshot().objects).toEqual([]);
    c.pickCategory("metal_can"); expect(recognize).not.toHaveBeenCalled(); await c.recognizeText("가스 캔 같아요");
    expect(recognize).toHaveBeenCalledWith(expect.objectContaining({ mode: "manual", photoIds: [], text: "가스 캔 같아요" }), [], expect.any(AbortSignal));
  });
  it("releases photo URLs when switching to a freeform manual input", async () => {
    const { controller: c, revoke } = setup(); await c.selectPhotos([file]); await c.recognizeText("캔"); c.reset();
    expect(revoke).toHaveBeenCalledExactlyOnceWith(photo.url);
  });
});

describe("coach help and voice independence", () => {
  it("shows only canonical help without applying suggested choices and drops it after correction", async () => {
    const { controller: c } = await manual(); await c.requestHelp("어떤 캔인가요");
    expect(c.getSnapshot().helpReply!.choiceIds).toContain("aluminum"); expect(c.getSnapshot().current!.facts).toEqual({});
    choose(c, "aluminum"); expect(c.getSnapshot().helpReply).toBeNull();
  });
  it("ignores late help after a user choice and prevents duplicate sends", async () => {
    const pending = deferred<ReturnType<typeof answer>>(); let request!: CoachHelpRequest;
    const help = vi.fn(async (r: CoachHelpRequest) => { request = r; return pending.promise; });
    const { controller: c } = setup({ assistance: { help } }); c.pickCategory("metal_can"); await c.startGuidance();
    const work = c.requestHelp("어떤 캔인가요"); await c.requestHelp("어떤 캔인가요"); expect(help).toHaveBeenCalledTimes(1);
    choose(c, "steel"); pending.resolve(answer(request)); await work; expect(c.getSnapshot().helpReply).toBeNull(); expect(c.getSnapshot().current!.facts.can_kind).toBe("steel_food");
  });
  it("does not advance on playback end; mute makes no synthesis call and replay targets only current step", async () => {
    const { controller: c, assistance } = await manual(); expect(c.getSnapshot().current!.step.id).toBe("can-kind");
    c.mute(true); const calls = vi.mocked(assistance.speech!).mock.calls.length; choose(c, "aluminum"); await c.replay(); expect(assistance.speech).toHaveBeenCalledTimes(calls);
    await c.mute(false); expect(assistance.speech).toHaveBeenLastCalledWith(expect.objectContaining({ cue: { kind: "step", id: "can-accessories" } }), expect.any(AbortSignal));
    expect(c.getSnapshot().objects[0].history).toHaveLength(1);
  });
  it("rejects wrong speech headers and stale speech without affecting visual progress", async () => {
    const { controller: c, audio } = setup({ assistance: { speech: async r => ({ audio: wav(), requestId: id(999), revision: r.context.revision, contentType: "audio/wav" }) } });
    c.pickCategory("metal_can"); await c.startGuidance(); expect(audio.play).not.toHaveBeenCalled(); expect(c.getSnapshot().voice).toBe("error"); expect(c.getSnapshot().progress).toBe("guiding");
    const pending = deferred<{ audio: Blob; requestId: string; revision: number; contentType: string }>(); let request!: CoachSpeechRequest;
    const h = setup({ assistance: { speech: async r => { request = r; return pending.promise; } } }); h.controller.pickCategory("metal_can"); const work = h.controller.startGuidance(); h.controller.reset();
    pending.resolve({ audio: wav(), requestId: request.context.requestId, revision: request.context.revision, contentType: "audio/wav" }); await work; expect(h.audio.play).not.toHaveBeenCalled();
  });
  it("stops pending microphone on reset, never sends cancellation, and sends only on finish tap", async () => {
    const { controller: c, audio, assistance } = await manual(); const pending = deferred<void>(); vi.mocked(audio.startRecording).mockReturnValueOnce(pending.promise);
    const start = c.startRecording(); c.reset(); pending.resolve(); await start; expect(audio.cancelRecording).toHaveBeenCalled(); expect(assistance.help).not.toHaveBeenCalled();
    c.pickCategory("metal_can"); await c.startGuidance(); await c.startRecording(); expect(assistance.help).not.toHaveBeenCalled(); c.cancelRecording(); expect(assistance.help).not.toHaveBeenCalled();
    await c.startRecording(); await c.finishRecording(); expect(assistance.help).toHaveBeenCalledTimes(1); expect(c.getSnapshot().transcript).toBe("이게 어떤 캔인가요");
    c.setHelpText("철캔 같아요"); await c.requestHelp(); expect(assistance.help).toHaveBeenLastCalledWith(expect.objectContaining({ text: "철캔 같아요" }), expect.any(AbortSignal));
  });
  it("retains visual steps and text alternative after microphone limit errors", async () => {
    const { controller: c, audio, assistance } = await manual();
    vi.mocked(audio.startRecording).mockImplementationOnce(async (_signal, onError) => { onError(new Error("20초를 넘었어요. 글로 질문해 주세요.")); });
    await c.startRecording(); expect(c.getSnapshot().voice).toBe("error"); expect(c.getSnapshot().progress).toBe("guiding"); expect(c.getSnapshot().current!.step.id).toBe("can-kind"); expect(assistance.help).not.toHaveBeenCalled();
  });
  it("interrupts pending speech synthesis to accept a microphone or text question", async () => {
    const pending = deferred<never>();
    const { controller: c, audio, assistance } = setup({ assistance: { speech: () => pending.promise, help: vi.fn(async request => answer(request)) } });
    c.pickCategory("metal_can"); void c.startGuidance(); await c.startRecording();
    expect(audio.startRecording).toHaveBeenCalledTimes(1); c.cancelRecording();
    void c.replay(); void c.requestHelp("무슨 캔인가요");
    expect(assistance.help).toHaveBeenCalledTimes(1); c.dispose();
  });
  it("ignores repeated replay taps while the current speech request is pending", async () => {
    const pending = deferred<never>(); const speech = vi.fn(() => pending.promise);
    const { controller: c } = setup({ assistance: { speech } }); c.pickCategory("metal_can"); void c.startGuidance();
    void c.replay(); void c.replay(); expect(speech).toHaveBeenCalledTimes(1); c.dispose();
  });
  it("increments revision at the finish tap and prevents a late encoding result after reset", async () => {
    const { controller: c, audio, assistance } = await manual(); await c.startRecording();
    const pending = deferred<Blob>(); vi.mocked(audio.finishRecording).mockReturnValueOnce(pending.promise);
    const revision = c.getSnapshot().revision; const work = c.finishRecording();
    expect(c.getSnapshot().revision).toBeGreaterThan(revision);
    c.reset(); pending.resolve(wav()); await work; expect(assistance.help).not.toHaveBeenCalled();
  });
  it("pauses automatic speech after failure until explicit replay, preserving the current step", async () => {
    const speech = vi.fn(async (request: CoachSpeechRequest) => {
      if (speech.mock.calls.length === 1) throw new Error("음성 연결을 확인해 주세요.");
      return { audio: wav(), requestId: request.context.requestId, revision: request.context.revision, contentType: "audio/wav" };
    });
    const { controller: c } = setup({ assistance: { speech } }); c.pickCategory("metal_can"); await c.startGuidance();
    expect(c.getSnapshot().voice).toBe("error"); choose(c, "aluminum"); choose(c, "none");
    expect(speech).toHaveBeenCalledTimes(1); expect(c.getSnapshot().current!.step.id).toBe("can-empty");
    await c.replay(); expect(speech).toHaveBeenCalledTimes(2); expect(c.getSnapshot().voice).toBe("idle");
    expect(speech).toHaveBeenLastCalledWith(expect.objectContaining({ cue: { kind: "step", id: "can-empty" } }), expect.any(AbortSignal));
  });
  it("retains help input on failure and retries only on another help tap", async () => {
    const help = vi.fn(async (request: CoachHelpRequest) => { if (help.mock.calls.length === 1) throw new Error("연결 실패"); return answer(request); });
    const { controller: c } = setup({ assistance: { help } }); c.pickCategory("metal_can"); await c.startGuidance();
    await c.requestHelp("종류를 몰라요"); expect(c.getSnapshot().helpText).toBe("종류를 몰라요"); expect(c.getSnapshot().objects[0].history).toEqual([]); expect(help).toHaveBeenCalledTimes(1);
    await c.requestHelp(); expect(help).toHaveBeenCalledTimes(2); expect(c.getSnapshot().helpReply).not.toBeNull();
  });
  it("cancels playing audio on correction and ignores the old ended event", async () => {
    const { controller: c, audio } = setup(); const ended = deferred<void>(); vi.mocked(audio.play).mockReturnValueOnce(ended.promise);
    c.pickCategory("metal_can"); const start = c.startGuidance(); await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(1));
    choose(c, "aluminum"); expect(audio.stopPlayback).toHaveBeenCalledTimes(1); ended.resolve(); await start;
    expect(c.getSnapshot().current!.step.id).toBe("can-accessories"); expect(c.getSnapshot().objects[0].history).toHaveLength(1);
  });
  it("does not let an old pending microphone cancel a newer object's recording", async () => {
    const h = setup({ recognize: async request => recognized(request, 2) }); const c = h.controller;
    await c.selectPhotos([file]); await c.startGuidance(); const old = deferred<void>(); vi.mocked(h.audio.startRecording).mockReturnValueOnce(old.promise);
    const work = c.startRecording(); c.switchObject(id(201)); await c.startRecording(); const cancellations = vi.mocked(h.audio.cancelRecording).mock.calls.length;
    old.resolve(); await work; expect(h.audio.cancelRecording).toHaveBeenCalledTimes(cancellations); expect(c.getSnapshot().voice).toBe("recording"); c.dispose();
  });
  it("drops a pending help response after correcting an earlier answer", async () => {
    const pending = deferred<ReturnType<typeof answer>>(); let request!: CoachHelpRequest;
    const { controller: c } = setup({ assistance: { help: async r => { request = r; return pending.promise; } } }); c.pickCategory("metal_can"); await c.startGuidance(); choose(c, "aluminum"); choose(c, "none");
    const work = c.requestHelp("비울 수 없어요"); c.correct("can-kind", "gas"); pending.resolve(answer(request)); await work;
    expect(c.getSnapshot().helpReply).toBeNull(); expect(c.getSnapshot().progress).toBe("needs_help"); expect(c.getSnapshot().current!.facts).toEqual({ can_kind: "pressure" });
  });
  it("rejects noncanonical help and audio beyond the contract limit without altering history", async () => {
    const { controller: c, audio, assistance } = setup({ assistance: { help: vi.fn(async request => ({ ...answer(request), text: "아무 곳에 버리세요" })) } });
    c.pickCategory("metal_can"); await c.startGuidance(); await c.requestHelp("뭘 해요"); expect(c.getSnapshot().helpReply).toBeNull(); expect(c.getSnapshot().voice).toBe("error");
    await c.startRecording(); vi.mocked(audio.finishRecording).mockResolvedValueOnce(new Blob([new Uint8Array(1024 * 1024 + 1)])); await c.finishRecording();
    expect(assistance.help).toHaveBeenCalledTimes(1); expect(c.getSnapshot().objects[0].history).toEqual([]); expect(c.getSnapshot().progress).toBe("guiding");
  });
});

describe("completed help across audio-only actions", () => {
  const question = "펌프가 안 빠져요. 어떻게 해야 하나요?";
  const reply = COACH_CATALOG.replies.find(value => value.id === "pump-detach-cannot")!;
  function pumpAnswer(request: CoachHelpRequest) {
    return { context: request.context, transcript: null, replyId: reply.id, text: reply.text, choiceIds: reply.choiceIds, sourceIds: reply.sourceIds };
  }
  async function pump() {
    const h = setup();
    vi.mocked(h.recognize).mockImplementation(async request => {
      const result = recognized(request, 2);
      return { ...result, objects: result.objects.map(object => ({ ...object, categoryId: "pump_bottle", label: "펌프 용기" })), routes: result.routes.map(route => ({ ...route, flowId: "pump-bottle" })) };
    });
    vi.mocked(h.assistance.help!).mockImplementation(async request => pumpAnswer(request));
    await h.controller.selectPhotos([file]); await h.controller.startGuidance();
    choose(h.controller, "plastic"); choose(h.controller, "composite");
    await vi.waitFor(() => expect(h.controller.getSnapshot().voice).toBe("idle"));
    return h;
  }
  it("keeps the pump answer and recommendation when muted while its speech is playing", async () => {
    const { controller: c, audio, assistance } = await pump();
    const ended = deferred<void>(); vi.mocked(audio.play).mockReturnValueOnce(ended.promise);
    const work = c.requestHelp(question); await vi.waitFor(() => expect(c.getSnapshot().voice).toBe("speaking"));
    const before = c.getSnapshot(); expect(before.helpReply!.replyId).toBe(reply.id); expect(before.helpReply!.choiceIds).toEqual(["cannot"]);
    const stops = vi.mocked(audio.stopPlayback).mock.calls.length; await c.mute(true);
    expect(c.getSnapshot().helpReply).toBe(before.helpReply); expect(c.getSnapshot().helpText).toBe(question);
    expect(c.getSnapshot().current).toBe(before.current); expect(c.getSnapshot().objects).toBe(before.objects);
    expect(c.getSnapshot().muted).toBe(true); expect(audio.stopPlayback).toHaveBeenCalledTimes(stops + 1);
    await c.mute(false);
    const speech = vi.mocked(assistance.speech!).mock.calls.at(-1)![0];
    expect(speech.context.revision).toBe(c.getSnapshot().revision); expect(speech.context.revision).toBeGreaterThan(before.helpReply!.context.revision);
    expect(speech.context.requestId).not.toBe(before.helpReply!.context.requestId);
    expect(speech.cue).toEqual({ kind: "step", id: "pump-detach" });
    expect(() => validateCoachSpeechRequest(COACH_CATALOG, speech)).not.toThrow();
    expect(c.getSnapshot().helpReply).toBe(before.helpReply);
    ended.resolve(); await work; expect(c.getSnapshot().helpReply).toBe(before.helpReply); c.dispose();
  });
  it("keeps the answer and question across replay, speech failure, and an explicit retry", async () => {
    const { controller: c, assistance } = await pump(); await c.requestHelp(question);
    const before = c.getSnapshot(); vi.mocked(assistance.speech!).mockRejectedValueOnce(new Error("음성 연결을 확인해 주세요."));
    await c.replay(); expect(c.getSnapshot().voice).toBe("error"); expect(c.getSnapshot().voiceAutoPaused).toBe(true);
    expect(c.getSnapshot().helpReply).toBe(before.helpReply); expect(c.getSnapshot().helpText).toBe(question); expect(c.getSnapshot().current).toBe(before.current);
    await c.replay(); expect(c.getSnapshot().voice).toBe("idle"); expect(c.getSnapshot().helpReply).toBe(before.helpReply);
    expect(c.getSnapshot().objects[0].history).toEqual(before.objects[0].history); c.dispose();
  });
  it("keeps the existing answer when another recording is started and cancelled without sending", async () => {
    const { controller: c, assistance } = await pump(); await c.requestHelp(question); const completed = c.getSnapshot().helpReply;
    await c.startRecording(); expect(c.getSnapshot().helpReply).toBe(completed);
    c.cancelRecording(); expect(c.getSnapshot().helpReply).toBe(completed); expect(assistance.help).toHaveBeenCalledTimes(1); c.dispose();
  });
  it("still discards a pending answer after muting instead of accepting its late response", async () => {
    const { controller: c, assistance } = await pump(); const pending = deferred<ReturnType<typeof pumpAnswer>>(); let request!: CoachHelpRequest; let signal!: AbortSignal;
    vi.mocked(assistance.help!).mockImplementationOnce(async (r, s) => { request = r; signal = s; return pending.promise; });
    const work = c.requestHelp(question); await c.mute(true); expect(signal.aborted).toBe(true);
    pending.resolve(pumpAnswer(request)); await work; expect(c.getSnapshot().helpReply).toBeNull(); expect(c.getSnapshot().current!.step.id).toBe("pump-detach"); c.dispose();
  });
  it.each(["step", "back", "correction", "object"] as const)("discards preserved help after a %s change", async action => {
    const { controller: c } = await pump(); await c.requestHelp(question); await c.mute(true);
    expect(c.getSnapshot().helpReply!.replyId).toBe(reply.id);
    if (action === "step") choose(c, "cannot");
    else if (action === "back") c.back();
    else if (action === "correction") c.correct("pump-material", "unknown");
    else c.switchObject(id(201));
    expect(c.getSnapshot().helpReply).toBeNull(); c.dispose();
  });
});

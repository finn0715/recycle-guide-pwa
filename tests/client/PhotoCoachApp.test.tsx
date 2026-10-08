// @vitest-environment jsdom
import { StrictMode, useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { COACH_CATALOG } from "@/data/coach-guides";
import type { CoachController } from "@/lib/client/coach-controller";
import type { CoachHelpRequest, CoachRecognizeRequest } from "@/lib/contracts/coach";
import { PhotoCoachApp } from "@/app/PhotoCoachApp";

const adapters = vi.hoisted(() => [] as Array<{
  dispose: ReturnType<typeof vi.fn>;
  unlockPlayback: ReturnType<typeof vi.fn>;
  cancelRecording: ReturnType<typeof vi.fn>;
  stopPlayback: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
}>);
const controllers = vi.hoisted(() => [] as CoachController[]);
const dependencies = vi.hoisted(() => ({ recognize: vi.fn(), prepare: vi.fn(), help: vi.fn(), speech: vi.fn(), revoke: vi.fn() }));

vi.mock("@/lib/client/coach-recognition", () => ({ sendCoachRecognition: dependencies.recognize }));
vi.mock("@/lib/client/photos", async original => ({ ...await original<typeof import("@/lib/client/photos")>(), preparePhoto: dependencies.prepare }));

vi.mock("@/lib/client/coach-audio", () => ({
  createCoachAssistanceTransport: () => ({ help: dependencies.help, speech: dependencies.speech }),
  createBrowserCoachAudio: () => {
    const adapter = {
      startRecording: vi.fn().mockResolvedValue(undefined), finishRecording: vi.fn(async () => new Blob(["audio"], { type: "audio/wav" })), cancelRecording: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined), stopPlayback: vi.fn(), dispose: vi.fn(),
      unlockPlayback: vi.fn().mockResolvedValue(undefined),
    };
    adapters.push(adapter);
    return adapter;
  },
}));

vi.mock("@/components/recycling/PhotoRecyclingCoach", () => ({
  PhotoRecyclingCoach: ({ controller, onAudioGesture }: { controller: CoachController; onAudioGesture: () => void }) => {
    if (!controllers.includes(controller)) controllers.push(controller);
    const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
    return <>
      <button onClick={() => controller.pickCategory("metal_can")}>캔 선택</button>
      <button onClick={onAudioGesture}>소리 준비</button>
      <output>{state.current?.step.id ?? "준비"}</output>
    </>;
  },
}));

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const objectId = "6ba7b810-9dad-41d1-80b4-000000000001";
const photoId = "6ba7b810-9dad-41d1-80b4-000000000002";
function recognition(request: CoachRecognizeRequest) {
  return { requestId: request.requestId, sessionId: request.sessionId, revision: request.revision, catalogVersion: COACH_CATALOG.version, outcome: "identified",
    objects: [{ objectId, label: "캔", categoryId: "metal_can", recognition: "recognized", views: request.photoIds.map(photoId => ({ photoId, box: null })), parts: [] }], routes: [{ objectId, flowId: "metal-can" }] };
}
function helpAnswer(request: CoachHelpRequest) {
  const reply = COACH_CATALOG.replies.find(reply => reply.allowedStepIds.includes(request.context.stepId))!;
  return { context: request.context, transcript: "audio" in request ? "어떻게 준비하나요" : null, replyId: reply.id, text: reply.text, choiceIds: reply.choiceIds, sourceIds: reply.sourceIds };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("URL", class extends URL { static revokeObjectURL = dependencies.revoke; });
  dependencies.prepare.mockImplementation(async (file: File) => ({ id: photoId, file, name: file.name, url: "blob:page-photo" }));
  dependencies.recognize.mockImplementation(async request => recognition(request));
  dependencies.help.mockImplementation(async request => helpAnswer(request));
  dependencies.speech.mockImplementation(async request => ({ audio: new Blob(["audio"], { type: "audio/wav" }), requestId: request.context.requestId, revision: request.context.revision, contentType: "audio/wav" }));
});
afterEach(() => { cleanup(); adapters.length = 0; controllers.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("StrictMode 재설정 뒤 살아 있는 안내기를 연결하고 언마운트 시 현재 오디오를 정리한다", () => {
  const view = render(<StrictMode><PhotoCoachApp catalog={COACH_CATALOG} /></StrictMode>);
  expect(adapters).toHaveLength(2);
  expect(adapters[0].dispose).toHaveBeenCalledTimes(1);
  expect(adapters[1].dispose).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "캔 선택" }));
  const flow = COACH_CATALOG.flows.find(flow => flow.categoryId === "metal_can")!;
  expect(screen.getByRole("status")).toHaveTextContent(flow.startStepId);
  fireEvent.click(screen.getByRole("button", { name: "소리 준비" }));
  expect(adapters[0].unlockPlayback).not.toHaveBeenCalled();
  expect(adapters[1].unlockPlayback).toHaveBeenCalledTimes(1);

  view.unmount();
  expect(adapters[1].dispose).toHaveBeenCalledTimes(1);
});

it("BFCache pagehide에서 사진·질문·진행과 녹음을 지우고 pageshow 후 같은 안내기를 재사용한다", async () => {
  render(<PhotoCoachApp catalog={COACH_CATALOG} />);
  const controller = controllers.at(-1)!; const audio = adapters.at(-1)!;
  await act(async () => {
    await controller.selectPhotos([new File(["photo"], "can.jpg", { type: "image/jpeg" })]);
    await controller.startGuidance(); controller.choose("aluminum", "can-kind");
    await controller.startRecording(); await controller.finishRecording(); await controller.startRecording();
  });
  const before = controller.getSnapshot();
  expect(before.photos).toHaveLength(1); expect(before.objects[0].history).toHaveLength(1);
  expect(before.helpReply).not.toBeNull(); expect(before.transcript).not.toBeNull(); expect(before.voice).toBe("recording");

  fireEvent(window, new PageTransitionEvent("pagehide", { persisted: true }));
  expect(controller.getSnapshot()).toMatchObject({ progress: "idle", voice: "off", photos: [], objects: [], current: null, helpReply: null, transcript: null, helpText: "" });
  expect(controller.getSnapshot().sessionId).not.toBe(before.sessionId);
  expect(audio.cancelRecording).toHaveBeenCalledTimes(1); expect(dependencies.revoke).toHaveBeenCalledExactlyOnceWith("blob:page-photo");
  expect(audio.dispose).not.toHaveBeenCalled();

  fireEvent(window, new PageTransitionEvent("pageshow", { persisted: true }));
  fireEvent.click(screen.getByRole("button", { name: "캔 선택" }));
  expect(controllers.at(-1)).toBe(controller); expect(controller.getSnapshot().current!.step.id).toBe("can-kind");
  expect(controller.getSnapshot().objects[0].history).toEqual([]); expect(audio.dispose).not.toHaveBeenCalled();
});

it("pagehide가 진행 중 인식을 취소하고 늦은 결과가 사진과 물건을 되살리지 못하게 한다", async () => {
  const result = deferred<ReturnType<typeof recognition>>(); dependencies.recognize.mockReturnValueOnce(result.promise);
  render(<PhotoCoachApp catalog={COACH_CATALOG} />); const controller = controllers.at(-1)!;
  let work!: Promise<void>;
  await act(async () => { work = controller.selectPhotos([new File(["photo"], "can.jpg", { type: "image/jpeg" })]); });
  expect(controller.getSnapshot().progress).toBe("recognizing");
  const [request, , signal] = dependencies.recognize.mock.calls[0];
  fireEvent(window, new PageTransitionEvent("pagehide", { persisted: true }));
  expect(signal.aborted).toBe(true);
  await act(async () => { result.resolve(recognition(request)); await work; });
  expect(controller.getSnapshot()).toMatchObject({ progress: "idle", photos: [], objects: [] });
  expect(dependencies.revoke).toHaveBeenCalledExactlyOnceWith("blob:page-photo");
});

it("pagehide가 진행 중 도움 요청을 취소하고 늦은 답·전사·재생을 버린다", async () => {
  const result = deferred<ReturnType<typeof helpAnswer>>(); dependencies.help.mockReturnValueOnce(result.promise);
  render(<PhotoCoachApp catalog={COACH_CATALOG} />); const controller = controllers.at(-1)!;
  let work!: Promise<void>;
  await act(async () => {
    controller.pickCategory("metal_can"); await controller.startGuidance(); await controller.startRecording();
    work = controller.finishRecording();
  });
  expect(controller.getSnapshot().voice).toBe("processing");
  const [request, signal] = dependencies.help.mock.calls[0]; const plays = adapters.at(-1)!.play.mock.calls.length;
  fireEvent(window, new PageTransitionEvent("pagehide", { persisted: true }));
  expect(signal.aborted).toBe(true);
  await act(async () => { result.resolve(helpAnswer(request)); await work; });
  expect(controller.getSnapshot()).toMatchObject({ progress: "idle", helpReply: null, transcript: null, helpText: "" });
  expect(adapters.at(-1)!.play).toHaveBeenCalledTimes(plays);
});

it("pagehide가 재생 중인 음성을 멈추고 늦은 재생 종료가 진행을 복원하지 않는다", async () => {
  render(<PhotoCoachApp catalog={COACH_CATALOG} />); const controller = controllers.at(-1)!; const audio = adapters.at(-1)!;
  const ended = deferred<void>(); audio.play.mockReturnValueOnce(ended.promise); let work!: Promise<void>;
  await act(async () => { controller.pickCategory("metal_can"); work = controller.startGuidance(); });
  await waitFor(() => expect(controller.getSnapshot().voice).toBe("speaking"));
  fireEvent(window, new PageTransitionEvent("pagehide", { persisted: false }));
  expect(audio.stopPlayback).toHaveBeenCalledTimes(1);
  await act(async () => { ended.resolve(); await work; });
  expect(controller.getSnapshot()).toMatchObject({ progress: "idle", voice: "off", current: null, objects: [] });
});

it("StrictMode 정리와 최종 언마운트에서 pagehide 리스너를 제거한다", () => {
  const add = vi.spyOn(window, "addEventListener"); const remove = vi.spyOn(window, "removeEventListener");
  const view = render(<StrictMode><PhotoCoachApp catalog={COACH_CATALOG} /></StrictMode>);
  const handlers = add.mock.calls.filter(([type]) => type === "pagehide").map(([, handler]) => handler);
  expect(handlers).toHaveLength(2);
  expect(remove.mock.calls.filter(([type]) => type === "pagehide").map(([, handler]) => handler)).toEqual([handlers[0]]);
  const reset = vi.spyOn(controllers.at(-1)!, "reset");
  fireEvent(window, new PageTransitionEvent("pagehide", { persisted: true })); expect(reset).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(remove.mock.calls.filter(([type]) => type === "pagehide").map(([, handler]) => handler)).toEqual(handlers);
  fireEvent(window, new PageTransitionEvent("pagehide", { persisted: true })); expect(reset).toHaveBeenCalledTimes(1);
});

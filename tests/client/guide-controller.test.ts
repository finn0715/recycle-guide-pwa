// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createGuideController } from "../../src/lib/client/guide-controller";
import type { AnalyzeTransport } from "../../src/lib/client/analyze";
import type { AnalysisResponse } from "../../src/lib/contracts";

const question: AnalysisResponse = {
  requestId: "one",
  status: "needs_info",
  item: { id: "ice_pack", label: "아이스팩" },
  question: {
    text: "내용물이 물인가요, 젤인가요?",
    choices: ["물", "젤", "모르겠어요"],
    allowPhoto: true,
  },
  guidance: null,
  message: "내용물을 확인해 주세요.",
};
const ready: AnalysisResponse = {
  ...question,
  status: "ready",
  question: null,
  guidance: {
    region: "songpa",
    ruleIds: ["ice-water"],
    steps: ["내용물을 비워요."],
    parts: [],
    cautions: [],
    sources: [],
  },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(transport: AnalyzeTransport = vi.fn(async () => ready)) {
  let index = 0;
  const releasePhoto = vi.fn();
  const controller = createGuideController({
    transport,
    preparePhoto: async (file: File) => ({
      id: String(++index),
      file,
      name: file.name,
      url: `blob:${index}`,
    }),
    releasePhoto,
    createRequestId: () => `request-${index}`,
  });
  const photo = new File(["photo"], "item.jpg", { type: "image/jpeg" });
  return { controller, photo, releasePhoto, transport };
}

describe("photo guide request lifecycle", () => {
  it("locks immediately so two clicks send exactly one request", async () => {
    const request = deferred<AnalysisResponse>();
    const transport = vi.fn<AnalyzeTransport>(() => request.promise);
    const { controller, photo } = setup(transport);
    await controller.selectPhotos([photo], "replace");
    const first = controller.submit();
    const duplicate = controller.submit();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().status).toBe("loading");
    request.resolve(ready);
    await Promise.all([first, duplicate]);
    expect(controller.getSnapshot().status).toBe("ready");
  });

  it("aborts on reset and ignores a transport that resolves after reset", async () => {
    const request = deferred<AnalysisResponse>();
    const transport = vi.fn<AnalyzeTransport>(() => request.promise);
    const { controller, photo, releasePhoto } = setup(transport);
    await controller.selectPhotos([photo], "replace");
    const pending = controller.submit();
    const signal = transport.mock.calls[0][0].signal;
    controller.reset();
    expect(signal.aborted).toBe(true);
    expect(releasePhoto).toHaveBeenCalledWith("blob:1");
    request.resolve(ready);
    await pending;
    expect(controller.getSnapshot()).toMatchObject({
      status: "idle",
      photos: [],
      messages: [],
      response: null,
      text: "",
    });
  });

  it("preserves photos and text on failure and only retries on a new submit", async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new Error("연결이 끊어졌어요."))
      .mockResolvedValueOnce(ready);
    const { controller, photo } = setup(transport);
    await controller.selectPhotos([photo], "replace");
    controller.setText("아이스팩 뒷면도 확인해 주세요.");
    await controller.submit();
    expect(controller.getSnapshot()).toMatchObject({
      status: "error",
      text: "아이스팩 뒷면도 확인해 주세요.",
      error: "연결이 끊어졌어요.",
    });
    expect(controller.getSnapshot().photos).toHaveLength(1);
    expect(transport).toHaveBeenCalledTimes(1);
    await controller.submit();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().status).toBe("ready");
  });

  it("sends bounded question/answer history and starts fresh for a replacement photo", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(question)
      .mockResolvedValueOnce(ready);
    const { controller, photo, releasePhoto } = setup(transport);
    await controller.selectPhotos([photo], "replace");
    controller.setText("아이스팩이에요.");
    await controller.submit();
    controller.setText("물");
    await controller.submit();
    expect(transport.mock.calls[1][0].messages).toEqual([
      { role: "user", text: "아이스팩이에요." },
      { role: "assistant", text: question.question!.text },
      { role: "user", text: "물" },
    ]);
    await controller.selectPhotos([photo], "replace");
    expect(releasePhoto).toHaveBeenCalledWith("blob:1");
    expect(controller.getSnapshot()).toMatchObject({
      status: "preview",
      messages: [],
      response: null,
      text: "",
    });
    expect(controller.getSnapshot().photos).toHaveLength(1);
  });

  it("keeps the same product and question when a follow-up photo is added", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(question)
      .mockResolvedValueOnce(ready);
    const { controller, photo } = setup(transport);
    await controller.selectPhotos([photo], "replace");
    await controller.submit();
    await controller.selectPhotos([photo], "append");
    expect(controller.getSnapshot().response?.question?.text).toBe(
      question.question!.text,
    );
    await controller.submit();
    expect(transport.mock.calls[1][0].photos).toHaveLength(2);
    expect(transport.mock.calls[1][0].messages).toEqual([
      { role: "assistant", text: question.question!.text },
    ]);
  });

  it("does nothing when file selection is cancelled and rejects limits explicitly", async () => {
    const { controller, photo, transport } = setup();
    await controller.selectPhotos([photo], "replace");
    const before = controller.getSnapshot();
    await controller.selectPhotos([], "replace");
    expect(controller.getSnapshot()).toBe(before);
    await controller.selectPhotos([photo, photo, photo], "append");
    expect(controller.getSnapshot().photos).toHaveLength(1);
    expect(controller.getSnapshot().error).toContain("3장");
    controller.setText("가".repeat(1001));
    await controller.submit();
    expect(transport).not.toHaveBeenCalled();
    expect(controller.getSnapshot().error).toContain("1,000자");
  });
});

describe("photo guide reset races", () => {
  it("keeps the new product result when an older request finishes later", async () => {
    const old = deferred<AnalysisResponse>();
    const current = deferred<AnalysisResponse>();
    const transport = vi
      .fn<AnalyzeTransport>()
      .mockImplementationOnce(() => old.promise)
      .mockImplementationOnce(() => current.promise);
    const { controller, photo } = setup(transport);
    await controller.selectPhotos([photo], "replace");
    const first = controller.submit();
    await controller.selectPhotos([photo], "replace");
    const second = controller.submit();
    current.resolve(ready);
    await second;
    old.resolve(question);
    await first;
    expect(controller.getSnapshot()).toMatchObject({
      status: "ready",
      response: ready,
      messages: [],
    });
  });

  it("releases a photo that finishes decoding after the user has reset", async () => {
    const photo = new File(["image"], "item.jpg", { type: "image/jpeg" });
    const decoding = deferred<{
      id: string;
      file: File;
      name: string;
      url: string;
    }>();
    const releasePhoto = vi.fn();
    const controller = createGuideController({
      preparePhoto: () => decoding.promise,
      releasePhoto,
    });
    const pending = controller.selectPhotos([photo], "replace");
    controller.reset();
    decoding.resolve({
      id: "late",
      file: photo,
      name: photo.name,
      url: "blob:late",
    });
    await pending;
    expect(releasePhoto).toHaveBeenCalledWith("blob:late");
    expect(controller.getSnapshot()).toMatchObject({
      status: "idle",
      photos: [],
      isPreparing: false,
    });
  });
});


describe("product correction isolation", () => {
  it("keeps only photos when correction starts and sends only the new explanation", async () => {
    const transport = vi.fn<AnalyzeTransport>().mockResolvedValueOnce(question).mockResolvedValueOnce(ready);
    const { controller, photo, releasePhoto } = setup(transport);
    await controller.selectPhotos([photo], "replace");
    controller.setText("예전 설명");
    await controller.submit();
    controller.setText("남아 있는 답");
    controller.beginCorrection();
    expect(controller.getSnapshot()).toMatchObject({ status: "preview", messages: [], response: null, text: "", error: null, correcting: true, lastSentPhotoCount: 0 });
    expect(controller.getSnapshot().photos).toHaveLength(1);
    expect(releasePhoto).not.toHaveBeenCalled();
    await controller.submit();
    expect(transport).toHaveBeenCalledTimes(1);
    controller.setText("우유팩이에요.");
    await controller.submit();
    expect(transport.mock.calls[1][0].messages).toEqual([{ role: "user", text: "우유팩이에요." }]);
    expect(controller.getSnapshot().correcting).toBe(false);
  });

  it("does not let a late submission end a newer correction", async () => {
    const old = deferred<AnalysisResponse>();
    const transport = vi.fn<AnalyzeTransport>().mockResolvedValueOnce(question).mockImplementationOnce(() => old.promise);
    const { controller, photo } = setup(transport);
    await controller.selectPhotos([photo], "replace");
    await controller.submit();
    controller.setText("물");
    const pending = controller.submit();
    controller.beginCorrection();
    controller.setText("우유팩이에요.");
    expect(transport.mock.calls[1][0].signal.aborted).toBe(true);
    old.resolve(ready);
    await pending;
    expect(controller.getSnapshot()).toMatchObject({ status: "preview", messages: [], response: null, text: "우유팩이에요.", correcting: true });
  });

  it("discards changed-product guidance and history before a fresh explicit submit", async () => {
    const changed = { ...ready, item: { id: "drink_carton" as const, label: "우유·두유팩" } };
    const transport = vi.fn<AnalyzeTransport>().mockResolvedValueOnce(question).mockResolvedValueOnce(changed).mockResolvedValueOnce(changed);
    const { controller, photo } = setup(transport);
    await controller.selectPhotos([photo], "replace");
    controller.setText("예전 제품의 설명");
    await controller.submit();
    controller.setText("물");
    await controller.submit();
    expect(controller.getSnapshot()).toMatchObject({ status: "error", messages: [], response: null, text: "" });
    expect(controller.getSnapshot().error).toContain("제품 종류가 달라져");
    expect(transport).toHaveBeenCalledTimes(2);
    await controller.submit();
    expect(transport.mock.calls[2][0].messages).toEqual([]);
    expect(controller.getSnapshot().status).toBe("ready");
  });
});


describe("product identity across unresolved responses", () => {
  it("still discards a changed product after an intervening unrecognized result", async () => {
    const transport = vi.fn<AnalyzeTransport>()
      .mockResolvedValueOnce(question)
      .mockResolvedValueOnce({ ...question, item: null })
      .mockResolvedValueOnce({ ...ready, item: { id: "drink_carton", label: "우유·두유팩" } });
    const { controller, photo } = setup(transport);
    await controller.selectPhotos([photo], "replace");
    controller.setText("예전 제품 답변");
    await controller.submit();
    controller.setText("확인해 주세요.");
    await controller.submit();
    controller.setText("다시 봐 주세요.");
    await controller.submit();
    expect(controller.getSnapshot()).toMatchObject({ status: "error", response: null, messages: [] });
  });
});

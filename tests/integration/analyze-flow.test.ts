import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { analyzePhotos, type AnalyzeRequest } from "@/lib/client/analyze";
import { createGuideController } from "@/lib/client/guide-controller";
import { createAnalyzeHandler, analyzeRequest } from "@/lib/server/analyze";
import { POST, runtime, dynamic } from "@/app/api/analyze/route";
import { ApiFailure } from "@/lib/server/analyze-request";
import { FACT_REGISTRY } from "@/lib/server/rules";
import { SOURCES } from "@/data/disposal-rules";
import { LIMITS, type ItemId, type Message } from "@/lib/contracts";

const requestId = "b82fb366-9e28-49b4-856f-3daaaab063f7";
let photo: File;
beforeAll(async () => {
  const bytes = new Uint8Array(await sharp({ create: { width: 16, height: 12, channels: 3, background: "white" } }).jpeg().toBuffer());
  photo = new File([bytes], "item.jpg", { type: "image/jpeg" });
});
afterEach(() => vi.unstubAllGlobals());
const observation = (itemId: ItemId | null = "pump_bottle", verdict = "recognized") => ({ verdict, itemId, facts: [], unable: [] });
const input = (patch: Partial<AnalyzeRequest> = {}): AnalyzeRequest => ({ requestId, photos: [photo], messages: [], signal: new AbortController().signal, ...patch });
type Model = NonNullable<Parameters<typeof createAnalyzeHandler>[0]>["model"];

// Only the model boundary is substituted. Fetch is routed to the real handler;
// native Request serialization, multipart parsing, image decoding and rules all run.
function connect(model: Model) {
  const handler = createAnalyzeHandler({ model });
  const exchanges: { url: string; status: number; payload: unknown }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe("/api/analyze");
    expect(init.method).toBe("POST");
    const request = new Request(new URL(url, "http://localhost"), init);
    expect(request.headers.get("content-type")).toContain("multipart/form-data; boundary=");
    const response = await handler(request);
    exchanges.push({ url, status: response.status, payload: await response.clone().json() });
    expect(response.headers.get("cache-control")).toBe("no-store");
    return response;
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, exchanges };
}
function controller() {
  let serial = 0;
  return createGuideController({
    preparePhoto: async file => ({ id: String(++serial), name: file.name, file, url: `blob:${serial}` }),
    releasePhoto: vi.fn(),
  });
}

describe("browser transport through the actual API and reviewed rules", () => {
  it("exports the production POST handler at the expected route and rejects a malformed request before model use", async () => {
    expect(POST).toBe(analyzeRequest);
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
    const response = await POST(new Request("http://localhost/api/analyze", { method: "POST", body: "bad" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
  });

  it("starts only on submit, asks canonical questions, accepts a label photo, and returns source-backed ready", async () => {
    const seen: { requestId: string; messages: Message[]; imageCount: number }[] = [];
    const { fetch, exchanges } = connect(async input => {
      seen.push({ requestId: input.requestId, messages: structuredClone(input.messages), imageCount: input.images.length });
      expect(input.images.every(image => image.startsWith("data:image/jpeg;base64,"))).toBe(true);
      return observation("pump_bottle");
    });
    const guide = controller();
    await guide.selectPhotos([photo], "replace");
    expect(fetch).not.toHaveBeenCalled();
    await guide.submit();
    expect(guide.getSnapshot().response?.question).toEqual(FACT_REGISTRY.pump_bottle.material.question);
    await guide.selectPhotos([photo], "append");
    expect(fetch).toHaveBeenCalledTimes(1);
    const values = { material: "plastic", contents: "empty", pump: "composite", label: "film" };
    for (const [key, value] of Object.entries(values)) {
      guide.setText(FACT_REGISTRY.pump_bottle[key].choices[value]);
      await guide.submit();
    }
    const response = guide.getSnapshot().response!;
    expect(guide.getSnapshot().status).toBe("ready");
    expect(response.item?.id).toBe("pump_bottle");
    expect(response.question).toBeNull();
    expect(response.guidance?.ruleIds).toContain("pump-plastic-empty");
    expect(response.guidance?.steps.length).toBeGreaterThan(0);
    for (const part of response.guidance!.parts) for (const id of part.sourceIds) {
      expect(response.guidance!.sources.some(source => source.id === id)).toBe(true);
      expect(SOURCES.some(source => source.id === id)).toBe(true);
    }
    expect(seen[1].imageCount).toBe(2);
    expect(seen[1].messages).toEqual([
      { role: "assistant", text: FACT_REGISTRY.pump_bottle.material.question.text },
      { role: "user", text: FACT_REGISTRY.pump_bottle.material.choices.plastic },
    ]);
    expect(new Set(seen.map(value => value.requestId)).size).toBe(5);
    expect(exchanges.map(value => value.status)).toEqual([200, 200, 200, 200, 200]);
    guide.dispose();
  });

  it.each([
    ["multiple", "needs_info"], ["unclear", "needs_info"], ["conflict", "needs_info"],
    ["insufficient", "uncertain"], ["unsupported", "unsupported"],
  ])("accepts safe %s output as %s without any guidance", async (verdict, status) => {
    connect(async () => observation(null, verdict));
    const result = await analyzePhotos(input());
    expect(result.status).toBe(status);
    expect(result.guidance).toBeNull();
    expect(result.message.trim()).not.toBe("");
    if (status === "needs_info") expect(result.question?.allowPhoto).toBe(true);
    else expect(result.question).toBeNull();
  });

  it("accepts uncertain when the real user cannot answer", async () => {
    connect(async () => observation());
    const result = await analyzePhotos(input({ messages: [{ role: "user", text: "모르겠어요" }] }));
    expect(result.status).toBe("uncertain");
    expect(result.guidance).toBeNull();
    expect(result.question).toBeNull();
  });

  it.each([
    ["bad UUID", { requestId: "bad" }, 400, "INVALID_REQUEST"],
    ["undecodable photo", { photos: [new File(["not jpeg"], "bad.jpg", { type: "image/jpeg" })] }, 415, "UNSUPPORTED_IMAGE"],
    ["oversized text", { messages: [{ role: "user", text: "가".repeat(LIMITS.text + 1) }] }, 413, "PAYLOAD_TOO_LARGE"],
    ["too many messages", { messages: Array.from({ length: LIMITS.messages + 1 }, () => ({ role: "user", text: "설명" })) }, 413, "PAYLOAD_TOO_LARGE"],
  ] as const)("surfaces the parser error for %s with no model invocation", async (_name, patch, status, code) => {
    const model = vi.fn(async () => observation());
    const { exchanges } = connect(model);
    await expect(analyzePhotos(input(patch as Partial<AnalyzeRequest>))).rejects.toThrow();
    expect(exchanges[0].status).toBe(status);
    expect(exchanges[0].payload).toMatchObject({ error: { code } });
    expect(model).not.toHaveBeenCalled();
  });

  it("preserves input on real handler errors and only retries by explicit submit", async () => {
    const model = vi.fn().mockRejectedValueOnce(new ApiFailure("SERVICE_UNAVAILABLE")).mockResolvedValueOnce(observation());
    const { fetch, exchanges } = connect(model);
    const guide = controller();
    await guide.selectPhotos([photo], "replace");
    guide.setText("샴푸 용기예요.");
    await guide.submit();
    expect(guide.getSnapshot()).toMatchObject({ status: "error", text: "샴푸 용기예요.", messages: [], response: null });
    expect(guide.getSnapshot().photos).toHaveLength(1);
    expect(exchanges[0].status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1);
    await guide.submit();
    expect(guide.getSnapshot().status).toBe("needs_info");
    expect(fetch).toHaveBeenCalledTimes(2);
    guide.dispose();
  });

  it("drops old-product evidence on correction and restarts with fresh request state", async () => {
    const messages: Message[][] = [];
    const model = vi.fn(async (input) => {
      messages.push(structuredClone(input.messages));
      return observation(messages.length === 1 ? "pump_bottle" : "drink_carton");
    });
    const { fetch } = connect(model);
    const guide = controller();
    await guide.selectPhotos([photo], "replace");
    guide.setText("다 비웠어요");
    await guide.submit();
    guide.beginCorrection();
    expect(fetch).toHaveBeenCalledTimes(1);
    guide.setText("우유팩이에요.");
    await guide.submit();
    expect(messages[1]).toEqual([{ role: "user", text: "우유팩이에요." }]);
    expect(guide.getSnapshot().response?.item?.id).toBe("drink_carton");
    expect(guide.getSnapshot().status).toBe("needs_info");
    guide.setText(FACT_REGISTRY.drink_carton.carton_type.choices.regular);
    await guide.submit();
    expect(guide.getSnapshot().response?.question?.text).toBe(FACT_REGISTRY.drink_carton.contents.question.text);
    guide.reset();
    expect(guide.getSnapshot()).toMatchObject({ status: "idle", photos: [], messages: [], response: null });
    await guide.selectPhotos([photo], "replace");
    await guide.submit();
    expect(messages.at(-1)).toEqual([]);
    guide.dispose();
  });

  it("rejects changed-product guidance derived from old answers, then submits an empty history", async () => {
    const histories: Message[][] = [];
    connect(async input => {
      histories.push(structuredClone(input.messages));
      return observation(histories.length === 1 ? "pump_bottle" : "drink_carton");
    });
    const guide = controller();
    await guide.selectPhotos([photo], "replace");
    guide.setText("다 비웠어요");
    await guide.submit();
    guide.setText("일반 우유팩이에요");
    await guide.submit();
    expect(guide.getSnapshot()).toMatchObject({ status: "error", messages: [], response: null, text: "" });
    await guide.submit();
    expect(histories[2]).toEqual([]);
    expect(guide.getSnapshot().status).toBe("needs_info");
    guide.dispose();
  });

  it("ignores an old real handler response after replacing the photo", async () => {
    let finishOld!: (value: unknown) => void;
    const slow = new Promise(resolve => { finishOld = resolve; });
    const model = vi.fn().mockImplementationOnce(() => slow).mockResolvedValueOnce(observation(null, "unsupported"));
    connect(model);
    const guide = controller();
    await guide.selectPhotos([photo], "replace");
    const old = guide.submit();
    await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(1));
    await guide.selectPhotos([photo], "replace");
    await guide.submit();
    finishOld(observation());
    await old;
    expect(guide.getSnapshot()).toMatchObject({ status: "unsupported", messages: [], response: { status: "unsupported" } });
    guide.dispose();
  });
});

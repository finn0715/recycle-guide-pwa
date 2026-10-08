import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { sendCoachRecognition } from "@/lib/client/coach-recognition";
import { createCoachRecognizeHandler, type PreparedCoachRecognition } from "@/lib/server/coach-recognize";
import { type CoachRecognizeRequest } from "@/lib/contracts/coach";
import { type GuidePhoto } from "@/lib/client/photos";

const request: CoachRecognizeRequest = { requestId: "b82fb366-9e28-49b4-856f-3daaaab063f7", sessionId: "a82fb366-9e28-49b4-856f-3daaaab063f7", revision: 3, region: "songpa", mode: "photo", photoIds: ["c82fb366-9e28-49b4-856f-3daaaab063f7"], text: "" };
const candidate = { label: "캔", categoryId: "metal_can", recognition: "recognized", views: [{ photoId: request.photoIds[0], box: null }], parts: [] };
let photo: GuidePhoto;
beforeAll(async () => {
  const file = new File([new Uint8Array(await sharp({ create: { width: 16, height: 12, channels: 3, background: "white" } }).jpeg().toBuffer())], "can.jpg", { type: "image/jpeg" });
  photo = { id: request.photoIds[0], name: file.name, file, url: "blob:local-preview" };
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const signal = () => new AbortController().signal;
function connect(output: unknown = { objects: [candidate] }, change?: (value: Record<string, unknown>) => unknown) {
  const model = vi.fn(async (input: PreparedCoachRecognition) => {
    expect(input.requestId).toBe(request.requestId); expect(input.sessionId).toBe(request.sessionId); expect(input.revision).toBe(request.revision);
    expect(input.images.every(image => image.startsWith("data:image/jpeg;base64,"))).toBe(true);
    return output;
  });
  const handler = createCoachRecognizeHandler({ model });
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe("/api/coach/recognize");
    expect(init.headers).toBeUndefined();
    const response = await handler(new Request(new URL(url, "http://localhost"), init));
    expect(response.headers.get("cache-control")).toBe("no-store");
    if (change) return Response.json(change(await response.json()));
    return response;
  });
  vi.stubGlobal("fetch", fetcher);
  return { model, fetcher };
}

describe("coach client through real multipart, image decoder and response validation", () => {
  it("sends files in photo ID order and keeps preview metadata out of multipart", async () => {
    const { model, fetcher } = connect();
    const result = await sendCoachRecognition(request, [photo], signal());
    expect(result).toMatchObject({ requestId: request.requestId, sessionId: request.sessionId, revision: 3, outcome: "identified" });
    const form = fetcher.mock.calls[0][1].body as FormData;
    expect([...new Set(form.keys())].sort()).toEqual(["mode", "photoIds", "photos", "region", "requestId", "revision", "sessionId", "text"].sort());
    expect(form.get("photoIds")).toBe(JSON.stringify(request.photoIds));
    expect(form.get("url")).toBeNull(); expect(form.get("name")).toBeNull();
    expect(model).toHaveBeenCalledOnce(); expect(model.mock.calls[0][0].images).toEqual([]);
  });
  it("sends a free manual name with zero images and preserves empty views", async () => {
    const { model } = connect({ objects: [{ ...candidate, views: [] }] });
    const result = await sendCoachRecognition({ ...request, mode: "manual", photoIds: [], text: "새로운 제품명인 캔 음료예요" }, [], signal());
    expect(result.objects[0].views).toEqual([]); expect(model).toHaveBeenCalledOnce();
  });
  it("rejects mismatching, duplicated or out-of-order photo IDs before sending", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    for (const [input, photos] of [
      [request, []],
      [request, [{ ...photo, id: request.sessionId }]],
      [{ ...request, photoIds: [photo.id, photo.id] }, [photo, photo]],
      [{ ...request, photoIds: [photo.id, request.sessionId] }, [{ ...photo, id: request.sessionId }, photo]],
    ] as [CoachRecognizeRequest, GuidePhoto[]][]) await expect(sendCoachRecognition(input, photos, signal())).rejects.toThrow("사진");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    (value: Record<string, unknown>) => ({ ...value, requestId: request.sessionId }),
    (value: Record<string, unknown>) => ({ ...value, sessionId: request.requestId }),
    (value: Record<string, unknown>) => ({ ...value, revision: 2 }),
    (value: Record<string, unknown>) => ({ ...value, routes: [{ objectId: null, flowId: "recovery-ambiguous" }] }),
    (value: Record<string, unknown>) => ({ ...value, objects: [candidate] }),
    (value: Record<string, unknown>) => ({ ...value, objects: [...value.objects as unknown[], ...value.objects as unknown[]], routes: [...value.routes as unknown[], ...value.routes as unknown[]] }),
    (value: Record<string, unknown>) => ({ ...value, rule: "invented" }),
  ])("rejects mismatching context and malformed server output %#", async change => {
    connect(undefined, change);
    await expect(sendCoachRecognition(request, [photo], signal())).rejects.toThrow("결과");
  });
  it("rejects old photo references, missing photo views and invented manual views", async () => {
    for (const views of [[{ photoId: request.sessionId, box: null }], []]) {
      connect(undefined, value => ({ ...value, objects: (value.objects as Record<string, unknown>[]).map(o => ({ ...o, views })) }));
      await expect(sendCoachRecognition(request, [photo], signal())).rejects.toThrow("결과");
    }
    connect({ objects: [{ ...candidate, views: [] }] }, value => ({ ...value, objects: (value.objects as Record<string, unknown>[]).map(o => ({ ...o, views: candidate.views })) }));
    await expect(sendCoachRecognition({ ...request, mode: "manual", photoIds: [], text: "캔" }, [], signal())).rejects.toThrow("결과");
  });
  it("retains local photos after the handler rejects model-generated advice", async () => {
    connect({ objects: [{ ...candidate, disposal: "general" }] });
    await expect(sendCoachRecognition(request, [photo], signal())).rejects.toThrow("분석 결과");
    expect(photo.url).toBe("blob:local-preview"); expect(photo.file.size).toBeGreaterThan(0);
  });
  it("does no fetch for an already aborted request and rejects cancelled late responses", async () => {
    const { fetcher } = connect(); const abort = new AbortController(); abort.abort();
    await expect(sendCoachRecognition(request, [photo], abort.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const pendingAbort = new AbortController();
    const pending = sendCoachRecognition(request, [photo], pendingAbort.signal);
    pendingAbort.abort(); finish(Response.json({}));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
  it("returns a safe generic error for malformed or mismatching error payloads", async () => {
    for (const body of ["private provider text", { requestId: request.sessionId, error: { code: "SERVICE_UNAVAILABLE", message: "private provider text", retryable: true } }]) {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { status: 503 })));
      await expect(sendCoachRecognition(request, [photo], signal())).rejects.toThrow("연결");
    }
  });
});

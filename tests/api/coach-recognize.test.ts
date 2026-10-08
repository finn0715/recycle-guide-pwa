import { beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { COACH_CATALOG } from "@/data/coach-guides";
import { COACH_LIMITS, type CoachRecognizeRequest, type ModelObservation } from "@/lib/contracts/coach";
import { createCoachRecognizeHandler, resolveCoachRecognition, type PreparedCoachRecognition } from "@/lib/server/coach-recognize";
import { createAnalyzeHandler } from "@/lib/server/analyze";

const requestId = "b82fb366-9e28-49b4-856f-3daaaab063f7";
const sessionId = "a82fb366-9e28-49b4-856f-3daaaab063f7";
const photoId = "c82fb366-9e28-49b4-856f-3daaaab063f7";
const otherPhotoId = "d82fb366-9e28-49b4-856f-3daaaab063f7";
const context: CoachRecognizeRequest = { requestId, sessionId, revision: 4, region: "songpa", mode: "photo", photoIds: [photoId], text: "" };
let photo: File;
beforeAll(async () => {
  photo = new File([new Uint8Array(await sharp({ create: { width: 24, height: 12, channels: 3, background: "white" } }).jpeg().toBuffer())], "item.jpg", { type: "image/jpeg" });
});
const view = (id = photoId) => ({ photoId: id, box: { x: 0.1, y: 0.1, width: 0.6, height: 0.8 } });
function candidate(categoryId: string | null = "metal_can", overrides: Partial<ModelObservation> = {}): ModelObservation {
  return { label: "음료캔", categoryId, recognition: "recognized", views: [view()], parts: [{ label: "본체", role: "body", views: [view()] }], ...overrides };
}
function request(fields: Record<string, string> = {}, photos = [photo]) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...context, photoIds: JSON.stringify(context.photoIds), revision: String(context.revision), ...fields })) form.set(key, String(value));
  photos.forEach(file => form.append("photos", file));
  return new Request("http://localhost/api/coach/recognize", { method: "POST", body: form });
}

describe("coach recognition observations and server routes", () => {
  it.each([["metal_can", "metal-can"], ["pump_bottle", "pump-bottle"], ["clear_pet_bottle", "clear-pet"]])("assigns server identities and the catalog route for %s", async (categoryId, flowId) => {
    const model = vi.fn(async () => ({ objects: [candidate(categoryId)] }));
    const response = await createCoachRecognizeHandler({ model })(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const result = await response.json();
    expect(result).toMatchObject({ requestId, sessionId, revision: 4, catalogVersion: COACH_CATALOG.version, outcome: "identified", routes: [{ flowId }] });
    expect(result.objects[0].objectId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.objects[0].parts[0].partId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.routes[0].objectId).toBe(result.objects[0].objectId);
    expect(model.mock.calls[0]).toHaveLength(2);
  });
  it("keeps two separate physical objects of the same category", () => {
    const result = resolveCoachRecognition(context, { objects: [candidate(), candidate()] });
    expect(result.objects).toHaveLength(2);
    expect(new Set(result.objects.map(o => o.objectId)).size).toBe(2);
    expect(result.routes).toHaveLength(2);
  });
  it("resolves an added catalog family without a hardcoded category enum", () => {
    const catalog = {
      ...COACH_CATALOG,
      categories: COACH_CATALOG.categories.map(category => category.id === "metal_can" ? { ...category, id: "refill_can" } : category),
      flows: COACH_CATALOG.flows.map(flow => flow.categoryId === "metal_can" ? { ...flow, categoryId: "refill_can" } : flow),
    };
    const result = resolveCoachRecognition(context, { objects: [candidate("refill_can")] }, catalog);
    expect(result.objects[0].categoryId).toBe("refill_can"); expect(result.routes[0].flowId).toBe("metal-can");
  });
  it("keeps ambiguous multi-photo objects separately selectable", () => {
    const input = { ...context, photoIds: [photoId, otherPhotoId] };
    const result = resolveCoachRecognition(input, { objects: [candidate(null, { recognition: "ambiguous" }), candidate(null, { recognition: "ambiguous", views: [view(otherPhotoId)], parts: [] })] });
    expect(result.objects).toHaveLength(2);
    expect(result.outcome).toBe("needs_input");
    expect(result.routes.every(r => r.objectId && r.flowId === "recovery-ambiguous")).toBe(true);
  });
  it.each(["ambiguous", "out_of_scope"] as const)("routes %s to a reviewed recovery", recognition => {
    const result = resolveCoachRecognition(context, { objects: [candidate(null, { recognition, views: [{ photoId, box: null }], parts: [] })] });
    expect(result.outcome).toBe("needs_input");
    expect(result.routes[0].flowId).toBe(recognition === "ambiguous" ? "recovery-ambiguous" : "recovery-out-of-scope");
    expect(result.routes[0].objectId).toBe(result.objects[0].objectId);
  });
  it("provides exactly one null recovery route when nothing was found", () => {
    expect(resolveCoachRecognition(context, { objects: [] })).toMatchObject({ outcome: "needs_input", objects: [], routes: [{ objectId: null, flowId: "recovery-ambiguous" }] });
  });
  it("recognizes a free manual product name without an allowlist or invented photo", async () => {
    const text = "처음 보는 누리샘 브랜드의 투명 생수 PET병이에요";
    const model = vi.fn(async (input: PreparedCoachRecognition) => {
      expect(input.text).toBe(text); expect(input.images).toEqual([]); expect(input.photoIds).toEqual([]);
      return { objects: [candidate("clear_pet_bottle", { label: "누리샘 생수병", views: [], parts: [] })] };
    });
    const response = await createCoachRecognizeHandler({ model })(request({ mode: "manual", photoIds: "[]", text }, []));
    expect(response.status).toBe(200);
    expect((await response.json()).objects[0].views).toEqual([]);
  });
  const malformed = [
    { objects: [candidate("invented_category")] },
    { objects: [candidate(null)] },
    { objects: [candidate("metal_can", { views: [] })] },
    { objects: [candidate("metal_can", { views: [view(otherPhotoId)] })] },
    { objects: [candidate("metal_can", { views: [view(), view()] })] },
    { objects: [candidate("metal_can", { parts: [{ label: "스프링", role: "spring", views: [] }] })] },
    { objects: [candidate(null, { recognition: "ambiguous", parts: [{ label: "없는 역할", role: "invented", views: [] }] })] },
    { objects: [{ ...candidate(), objectId: requestId }] },
    { objects: [{ ...candidate(), ruleIds: ["metal-can-clean"] }] },
    { objects: [{ ...candidate(), parts: [{ ...candidate().parts[0], partId: "made-up" }] }] },
    { objects: [candidate()], routes: [{ objectId: requestId, flowId: "metal-can" }] },
    { objects: [{ ...candidate(), views: [{ photoId, box: { x: 0.8, y: 0, width: 0.3, height: 1 } }] }] },
    { objects: [{ ...candidate(), views: [{ photoId, box: { x: 0, y: 0, width: 0, height: 1 } }] }] },
    { objects: [{ ...candidate(), views: [{ photoId, box: { x: Number.NaN, y: 0, width: 1, height: 1 } }] }] },
    { objects: [{ ...candidate(), views: [{ photoId, box: { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 1 } }] }] },
  ];
  it.each(malformed)("rejects invalid identifiers, coordinates, references or model rules %#", output => {
    expect(() => resolveCoachRecognition(context, output)).toThrow("INVALID_MODEL_RESPONSE");
  });
  it("rejects a part's photo reference outside its parent object's views", () => {
    expect(() => resolveCoachRecognition({ ...context, photoIds: [photoId, otherPhotoId] }, { objects: [candidate("metal_can", { parts: [{ label: "본체", role: "body", views: [view(otherPhotoId)] }] })] })).toThrow("INVALID_MODEL_RESPONSE");
  });
});

describe("coach multipart and resource boundaries", () => {
  const model = vi.fn(async () => ({ objects: [candidate()] }));
  const handler = createCoachRecognizeHandler({ model });
  const invalidFields: Record<string, string>[] = [
    { requestId: "bad" }, { sessionId: "bad" }, { revision: "-1" }, { revision: "1x" }, { revision: "1.1" }, { region: "seoul" }, { mode: "other" },
    { photoIds: "not json" }, { photoIds: "[]" }, { photoIds: JSON.stringify([photoId, photoId]) }, { photoIds: JSON.stringify([photoId, otherPhotoId]) },
    { extra: "true" }, { mode: "manual", photoIds: "[]", text: "" },
  ];
  it.each(invalidFields)("rejects invalid multipart fields before model use %#", async fields => {
    const localModel = vi.fn(async () => ({ objects: [] }));
    expect((await createCoachRecognizeHandler({ model: localModel })(request(fields))).status).toBe(400);
    expect(localModel).not.toHaveBeenCalled();
  });
  it("rejects duplicate singleton fields and manual photos", async () => {
    const req = request(); const form = await req.formData(); form.append("revision", "4");
    expect((await handler(new Request(req.url, { method: "POST", body: form }))).status).toBe(400);
    expect((await handler(request({ mode: "manual", photoIds: "[]", text: "캔" }))).status).toBe(400);
  });
  it("requires manual text, rejects excess text, and never truncates", async () => {
    expect((await handler(request({ mode: "manual", photoIds: "[]", text: "  " }, []))).status).toBe(400);
    expect((await handler(request({ text: "x".repeat(COACH_LIMITS.text + 1) }))).status).toBe(413);
  });
  it("shares byte, MIME, actual decode and resolution limits", async () => {
    const images = [
      { status: 413, file: new File([new Uint8Array(COACH_LIMITS.photoBytes + 1)], "big.jpg", { type: "image/jpeg" }) },
      { status: 415, file: new File(["fake"], "fake.jpg", { type: "image/jpeg" }) },
      { status: 415, file: new File([await photo.arrayBuffer()], "fake.png", { type: "image/png" }) },
      { status: 415, file: new File([new Uint8Array(await sharp({ create: { width: 6000, height: 5000, channels: 3, background: "white" } }).png().toBuffer())], "large.png", { type: "image/png" }) },
    ];
    for (const { status, file } of images) expect((await handler(request({}, [file]))).status).toBe(status);
  });
  it("normalizes EXIF orientation before model coordinates and preserves photo order", async () => {
    const rotated = new File([new Uint8Array(await sharp({ create: { width: 24, height: 12, channels: 3, background: "red" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer())], "rotate.jpg", { type: "image/jpeg" });
    const inspect = vi.fn(async (input: PreparedCoachRecognition) => {
      expect(input.photoIds).toEqual([otherPhotoId, photoId]);
      const meta = await Promise.all(input.images.map(image => sharp(Buffer.from(image.split(",")[1], "base64")).metadata()));
      expect(meta.map(m => [m.width, m.height, m.orientation])).toEqual([[12, 24, undefined], [24, 12, undefined]]);
      return { objects: [candidate()] };
    });
    expect((await createCoachRecognizeHandler({ model: inspect })(request({ photoIds: JSON.stringify([otherPhotoId, photoId]) }, [rotated, photo]))).status).toBe(200);
    expect(inspect).toHaveBeenCalledOnce();
  });
  it("counts stream bytes despite a false content length", async () => {
    let cancelled = false;
    const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
    const req = new Request("http://localhost/api/coach/recognize", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x", "content-length": "1" }, body, duplex: "half" } as RequestInit);
    expect((await handler(req)).status).toBe(413); expect(cancelled).toBe(true);
  });
  it("consumes a pre-aborted request without model work or unhandled rejection", async () => {
    const unhandled: unknown[] = []; const capture = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", capture);
    try {
      const admission = { active: 0 }; const localModel = vi.fn(async () => ({ objects: [] }));
      const run = createCoachRecognizeHandler({ model: localModel, admission });
      const abort = new AbortController(); abort.abort();
      expect((await run(new Request(request(), { signal: abort.signal }))).status).toBe(400);
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(localModel).not.toHaveBeenCalled(); expect(unhandled).toEqual([]); expect(admission.active).toBe(0);
      expect((await run(request())).status).toBe(200);
    } finally { process.removeListener("unhandledRejection", capture); }
  });
  it("cancels stalled upload reads on timeout", async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    const req = new Request("http://localhost/api/coach/recognize", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, body, duplex: "half" } as RequestInit);
    expect((await createCoachRecognizeHandler({ model, timeoutMs: 15 })(req)).status).toBe(504);
    expect(cancelled).toBe(true);
  });
  it("shares admission with legacy analysis and keeps timed-out work admitted until settled", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const admission = { active: 0 }; let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    let started!: () => void;
    const bothModelsStarted = new Promise<void>(resolve => { started = resolve; });
    let calls = 0;
    const model = vi.fn(async () => { if (++calls === 2) started(); await pending; return { objects: [] }; });
    const run = createCoachRecognizeHandler({ admission, timeoutMs: 30, model });
    try {
      const first = run(request()); const second = run(request());
      await bothModelsStarted;
      const legacy = createAnalyzeHandler({ admission, model: vi.fn() });
      expect((await legacy(new Request("http://localhost/api/analyze", { method: "POST", body: "unused" }))).status).toBe(503);
      await vi.advanceTimersByTimeAsync(30);
      expect((await Promise.all([first, second])).map(r => r.status)).toEqual([504, 504]);
      expect(admission.active).toBe(2); expect((await run(request())).status).toBe(503); expect(model).toHaveBeenCalledTimes(2);
      finish(); await vi.waitFor(() => expect(admission.active).toBe(0));
      expect((await run(request())).status).toBe(200);
      expect(admission.active).toBe(0); expect(model).toHaveBeenCalledTimes(3);
    } finally { finish(); vi.useRealTimers(); }
  });
  it("aborts model work and returns only a safe no-store error", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let started!: () => void;
    const modelStarted = new Promise<void>(resolve => { started = resolve; });
    let aborted = false;
    const run = createCoachRecognizeHandler({ timeoutMs: 30, model: async (_input, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => { aborted = true; reject(new Error("PRIVATE_CONTENT")); }, { once: true });
      started();
    }) });
    try {
      const pending = run(request());
      await modelStarted;
      await vi.advanceTimersByTimeAsync(29); expect(aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const response = await pending;
      expect(response.status).toBe(504); expect(aborted).toBe(true); expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.json(); expect(body.requestId).toBe(requestId); expect(body.error.code).toBe("ANALYSIS_TIMEOUT"); expect(JSON.stringify(body)).not.toContain("PRIVATE_CONTENT");
    } finally { vi.useRealTimers(); }
  });
});

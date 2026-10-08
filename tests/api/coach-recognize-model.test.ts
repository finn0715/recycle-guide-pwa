import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COACH_CATALOG } from "@/data/coach-guides";
import { recognizeCoachWithModel, type PreparedCoachRecognition } from "@/lib/server/coach-recognize";

const photoIds = ["c82fb366-9e28-49b4-856f-3daaaab063f7", "d82fb366-9e28-49b4-856f-3daaaab063f7"];
const input: PreparedCoachRecognition = { requestId: "b82fb366-9e28-49b4-856f-3daaaab063f7", sessionId: "a82fb366-9e28-49b4-856f-3daaaab063f7", revision: 1, region: "songpa", mode: "photo", photoIds, text: "새 브랜드", messages: [{ role: "user", text: "새 브랜드" }], images: ["data:image/jpeg;base64,YQ==", "data:image/jpeg;base64,Yg=="] };
const output = { objects: [{ label: "음료캔", categoryId: "metal_can", recognition: "recognized", views: [{ photoId: photoIds[0], box: null }], parts: [] }] };
const signal = () => new AbortController().signal;
function response(value: unknown = output) {
  return Response.json({ id: "test", status: "completed", output: [{ id: "message", role: "assistant", type: "message", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value), annotations: [] }] }] });
}
beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "test-placeholder"));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("coach model input and strict observation output", () => {
  it("reuses stateless gpt-6-luna and labels every image with its current photo ID in order", async () => {
    const fetcher = vi.fn(async () => response()); vi.stubGlobal("fetch", fetcher);
    expect(await recognizeCoachWithModel(input, signal())).toEqual(output);
    const [, init] = fetcher.mock.calls[0] as unknown as [unknown, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("gpt-6-luna"); expect(body.store).toBe(false); expect(body.tools).toBeUndefined(); expect(body.previous_response_id).toBeUndefined();
    expect(body.input).toHaveLength(1); expect(body.input[0].role).toBe("user");
    expect(body.input[0].content.slice(1)).toEqual(photoIds.flatMap((photoId, index) => [{ type: "input_text", text: JSON.stringify({ photoId }) }, { type: "input_image", image_url: input.images[index], detail: "high" }]));
    expect(body.instructions).toContain(JSON.stringify(COACH_CATALOG.categories));
    expect(body.instructions).not.toContain(COACH_CATALOG.sources[0].url);
    expect(body.text.format.strict).toBe(true);
    const schema = JSON.stringify(body.text.format.schema);
    expect(schema).not.toContain("ruleIds"); expect(schema).not.toContain("objectId"); expect(schema).not.toContain("partId");
  });
  it("sends free manual text with no image, and blocks an invalid image ID mapping", async () => {
    const fetcher = vi.fn(async () => response({ objects: [] })); vi.stubGlobal("fetch", fetcher);
    await recognizeCoachWithModel({ ...input, mode: "manual", photoIds: [], images: [] }, signal());
    const [, init] = fetcher.mock.calls[0] as unknown as [unknown, RequestInit];
    expect(JSON.parse(init.body as string).input[0].content).toHaveLength(1);
    await expect(recognizeCoachWithModel({ ...input, photoIds: [] }, signal())).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("includes catalog additions in model candidates without adding server rules", async () => {
    const catalog = { ...COACH_CATALOG, categories: [...COACH_CATALOG.categories, { id: "new_family", label: "새 범주", description: "새롭게 검수한 용도", roles: ["body", "handle"] }] };
    const fetcher = vi.fn(async () => response({ objects: [] })); vi.stubGlobal("fetch", fetcher);
    await recognizeCoachWithModel(input, signal(), catalog);
    const [, init] = fetcher.mock.calls[0] as unknown as [unknown, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.instructions).toContain(JSON.stringify(catalog.categories));
    expect(body.text.format.schema.properties.objects.items.properties.categoryId).not.toHaveProperty("enum");
  });
  it("does not invoke the network after cancellation", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const abort = new AbortController(); abort.abort();
    await expect(recognizeCoachWithModel(input, abort.signal)).rejects.toMatchObject({ code: "INVALID_REQUEST" }); expect(fetcher).not.toHaveBeenCalled();
  });
  it("fails closed for no key or model-invented rules and never retries", async () => {
    const fetcher = vi.fn(async () => response({ ...output, rules: [] })); vi.stubGlobal("fetch", fetcher);
    await expect(recognizeCoachWithModel(input, signal())).rejects.toMatchObject({ code: "INVALID_MODEL_RESPONSE" }); expect(fetcher).toHaveBeenCalledOnce();
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(recognizeCoachWithModel(input, signal())).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" }); expect(fetcher).toHaveBeenCalledOnce();
  });
});

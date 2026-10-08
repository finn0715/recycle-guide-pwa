// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzePhotos,
  type AnalyzeRequest,
} from "../../src/lib/client/analyze";
import { createRequestId } from "../../src/lib/client/photos";
import { LIMITS } from "../../src/lib/contracts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const request = (): AnalyzeRequest => ({
  requestId: "b82fb366-9e28-49b4-856f-3daaaab063f7",
  photos: [new File(["image"], "bottle.jpg", { type: "image/jpeg" })],
  messages: [{ role: "user", text: "샴푸통이에요." }],
  signal: new AbortController().signal,
});
const uncertain = {
  requestId: "b82fb366-9e28-49b4-856f-3daaaab063f7",
  status: "uncertain",
  item: null,
  question: null,
  guidance: null,
  message: "사진으로는 확인하기 어려워요.",
};

describe("real analysis transport", () => {
  it("sends the shared multipart contract and accepts a valid response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => uncertain });
    vi.stubGlobal("fetch", fetchMock);
    await expect(analyzePhotos(request())).resolves.toEqual(uncertain);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/analyze");
    expect(options.method).toBe("POST");
    const body = options.body as FormData;
    expect(body.get("requestId")).toBe("b82fb366-9e28-49b4-856f-3daaaab063f7");
    expect(body.get("region")).toBe("songpa");
    expect(body.getAll("photos")).toHaveLength(1);
    expect(JSON.parse(body.get("messages") as string)).toEqual([
      { role: "user", text: "샴푸통이에요." },
    ]);
  });
  it("rejects malformed, mismatched, or incomplete success responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...uncertain, requestId: "someone-else" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...uncertain, status: "ready" }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => null });
    vi.stubGlobal("fetch", fetchMock);
    for (let index = 0; index < 3; index++)
      await expect(analyzePhotos(request())).rejects.toThrow(
        "분석 결과를 확인하지 못했어요.",
      );
  });
  it("returns the server error and never substitutes made-up guidance", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: false,
          json: async () => ({
            error: {
              code: "CONFIGURATION_ERROR",
              message: "분석 서비스가 준비되지 않았어요.",
              retryable: false,
            },
          }),
        }),
    );
    await expect(analyzePhotos(request())).rejects.toThrow(
      "분석 서비스가 준비되지 않았어요.",
    );
  });
  it("bounds a stalled request with a manual-retry timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      ),
    );
    const assertion = expect(analyzePhotos(request())).rejects.toThrow(
      "분석 시간이 길어지고 있어요.",
    );
    await vi.advanceTimersByTimeAsync(LIMITS.timeoutMs);
    await assertion;
  });
  it("creates UUIDs when randomUUID is unavailable on an HTTP LAN origin", () => {
    const crypto = {
      getRandomValues: (array: Uint8Array) => {
        array.fill(23);
        return array;
      },
    };
    vi.stubGlobal("crypto", crypto);
    expect(createRequestId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

const validReady = {
  ...uncertain, status: "ready", item: { id: "ice_pack", label: "아이스팩" },
  guidance: { region: "songpa", ruleIds: ["reviewed"], steps: ["표시를 확인해요."],
    parts: [{ name: "포장", disposal: "표시에 따른 배출", actions: ["표시를 확인해요."], sourceIds: ["official"] }],
    cautions: [], sources: [{ id: "official", title: "공식 안내", url: "https://www.songpa.go.kr/", checkedAt: "2026-10-01" }] },
};
const validQuestion = { text: "무엇이 보이나요?", choices: ["모르겠어요"], allowPhoto: true };
describe("success response invariants", () => {
  const invalidResponses: [string, unknown][] = [
    ["ready without item", { ...validReady, item: null }],
    ["ready with question", { ...validReady, question: validQuestion }],
    ["needs_info with guidance", { ...validReady, status: "needs_info", question: validQuestion }],
    ["uncertain with guidance", { ...validReady, status: "uncertain" }],
    ["unsupported with question", { ...uncertain, status: "unsupported", question: validQuestion }],
    ["uncertain with question", { ...uncertain, question: validQuestion }],
    ["blank message", { ...uncertain, message: " " }],
    ...["ruleIds", "steps", "parts", "sources"].map(field => [field, { ...validReady, guidance: { ...validReady.guidance, [field]: [] } }] as [string, unknown]),
    ["unknown part source", { ...validReady, guidance: { ...validReady.guidance, parts: [{ ...validReady.guidance.parts[0], sourceIds: ["missing"] }] } }],
    ["empty part source", { ...validReady, guidance: { ...validReady.guidance, parts: [{ ...validReady.guidance.parts[0], sourceIds: [] }] } }],
    ["empty question", { ...uncertain, status: "needs_info", question: { ...validQuestion, text: " " } }],
    ["duplicate source identity", { ...validReady, guidance: { ...validReady.guidance, sources: [...validReady.guidance.sources, ...validReady.guidance.sources] } }],
  ];
  it.each(invalidResponses)("rejects %s", async (_name, payload) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
    await expect(analyzePhotos(request())).rejects.toThrow("분석 결과를 확인하지 못했어요.");
  });
  it("accepts complete source-backed guidance", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => validReady }));
    await expect(analyzePhotos(request())).resolves.toEqual(validReady);
  });
});

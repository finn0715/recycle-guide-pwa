import { afterEach, expect, it, vi } from "vitest";
import { callApi, seal, unseal } from "../../sites/call-api";
const origin = "https://recycle.example";
const secret = "synthetic-test-secret-only";
const offer = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const context = { waitUntil: vi.fn() };
const request = (body = offer, language = "ko", source = origin) => new Request(origin + "/api/call", { method: "POST", headers: { Origin: source, "Content-Type": "application/sdp", "X-Recycling-Language": language }, body });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("encrypted cleanup works across instances without exposing the call id", async () => {
  const token = await seal("rtc_test-call", secret);
  expect(token).not.toContain("rtc_test-call");
  expect(await unseal(token, secret)).toBe("rtc_test-call");
  await expect(unseal(token, "different-key")).rejects.toThrow();
  const changed = token.slice(0, 20) + (token[20] === "a" ? "b" : "a") + token.slice(21);
  await expect(unseal(changed, secret)).rejects.toThrow();
  await expect(unseal(await seal("rtc_test-call", secret, 1), secret)).rejects.toThrow();
});
it("rejects origin, language, body and forged tokens before provider requests", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect((await callApi(request(offer, "ko", "https://other.example"), { OPENAI_API_KEY: secret }, context)).status).toBe(403);
  for (const req of [request(offer, "fr"), request("not SDP"), request("v=0" + "a".repeat(66000)), new Request(origin + "/api/call", { method: "DELETE", headers: { Origin: origin }, body: "v1.invalid" })]) {
    expect((await callApi(req, { OPENAI_API_KEY: secret }, context)).status).toBe(400);
  }
  expect(fetcher).not.toHaveBeenCalled();
});
it("exchanges English SDP and ends a call using an authenticated cleanup token", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("v=0 answer", { headers: { location: "/v1/realtime/calls/rtc_example" } })).mockResolvedValueOnce(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const response = await callApi(request(offer, "en"), { OPENAI_API_KEY: secret }, context);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json(); expect(Object.keys(body).sort()).toEqual(["sdp", "token"]);
  expect(JSON.stringify(body)).not.toContain(secret);
  const form = fetcher.mock.calls[0][1].body as FormData;
  expect(JSON.parse(form.get("session") as string).audio.input.transcription.language).toBe("en");
  const ended = await callApi(new Request(origin + "/api/call", { method: "DELETE", headers: { Origin: origin }, body: body.token }), { OPENAI_API_KEY: secret }, context);
  expect(ended.status).toBe(204);
  expect(fetcher.mock.calls[1][0]).toBe("https://api.openai.com/v1/realtime/calls/rtc_example/hangup");
});
it("cleans up a provider call when its answer is unusable", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("invalid", { headers: { location: "/v1/realtime/calls/rtc_invalid" } })).mockResolvedValueOnce(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  expect((await callApi(request(), { OPENAI_API_KEY: secret }, context)).status).toBe(502);
  expect(context.waitUntil).toHaveBeenCalledOnce();
  await context.waitUntil.mock.calls[0][0];
  expect(fetcher.mock.calls[1][0]).toContain("rtc_invalid/hangup");
});
it("does not return provider error bodies or configuration secrets", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("provider private details", { status: 401 })));
  const response = await callApi(request(), { OPENAI_API_KEY: secret }, context);
  expect(response.status).toBe(503);
  const body = await response.text(); expect(body).not.toContain("provider private details"); expect(body).not.toContain(secret);
  expect((await callApi(request(), {}, context)).status).toBe(503);
});

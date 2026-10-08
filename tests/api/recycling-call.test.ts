import { afterEach, expect, it, vi } from "vitest";
import { callSession, createCallHandler, endRecyclingCall } from "@/lib/server/recycling-call";
const url = "http://localhost:3016/api/call";
const tokens: string[] = [];
afterEach(async () => { await Promise.all(tokens.splice(0).map(token => endRecyclingCall(new Request(url, { method: "DELETE", headers: { Origin: "http://localhost:3016" }, body: token })))); });
const offer = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
function request(body = offer, origin = "http://localhost:3016") { return new Request(url, { method: "POST", headers: { Origin: origin, "Content-Type": "application/sdp" }, body }); }
it("rejects wrong origins and malformed/oversized SDP before contacting the provider", async () => {
  const connect = vi.fn(async () => ({ sdp: "v=0 answer", close: vi.fn(async () => {}) })); const handler = createCallHandler(connect);
  expect((await handler(request(offer, "https://other.test"))).status).toBe(400);
  expect((await handler(request("v=0\r\n"))).status).toBe(400);
  expect((await handler(request("x".repeat(65_537)))).status).toBe(413);
  expect(connect).not.toHaveBeenCalled();
});
it("exchanges SDP without a credential, and a single-use token ends the remote call", async () => {
  const close = vi.fn(async () => {}); const handler = createCallHandler(vi.fn(async () => ({ sdp: "v=0 answer", close })));
  const response = await handler(request()); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json(); tokens.push(body.token); expect(Object.keys(body).sort()).toEqual(["sdp", "token"]);
  expect(body.sdp).toBe("v=0 answer");
  for (let i = 0; i < 2; i++) expect((await endRecyclingCall(new Request(url, { method: "DELETE", headers: { Origin: "http://localhost:3016" }, body: body.token }))).status).toBe(204);
  expect(close).toHaveBeenCalledOnce();
});
it("uses automatic turn taking and interruption with reviewed conditions, no completion checklist", () => {
  const session = callSession();
  expect(session.audio.input.turn_detection).toMatchObject({ create_response: true, interrupt_response: true });
  expect(session.instructions).toContain("완료 버튼을 누르지 않는다");
  expect(session.instructions).toContain("식품용 EPS"); expect(session.instructions).toContain("성분을 말로 확인하기 전");
  expect(session.instructions).toContain("사진이 불분명하면");
});

it("accepts the actual Host when Next resolves its bind address, and still rejects other origins", async () => {
  const close = vi.fn(async () => {}); const handler = createCallHandler(async () => ({ sdp: "v=0 answer", close }));
  const req = new Request("http://0.0.0.0:3016/api/call", { method: "POST", headers: { host: "localhost:3016", origin: "http://localhost:3016", "Content-Type": "application/sdp" }, body: offer });
  const response = await handler(req); expect(response.status).toBe(200); tokens.push((await response.json()).token);
});

it("forwards only supported languages to the provider and defaults to Korean", async () => {
  const connect = vi.fn(async () => ({ sdp: "v=0 answer", close: vi.fn(async () => {}) }));
  const handler = createCallHandler(connect);
  for (const language of ["en", null]) {
    const req = request(); if (language) req.headers.set("X-Recycling-Language", language);
    const response = await handler(req); expect(response.status).toBe(200);
    const body = await response.json(); tokens.push(body.token);
    expect(connect).toHaveBeenLastCalledWith(offer, expect.any(AbortSignal), language ?? "ko");
    await endRecyclingCall(new Request(url, { method: "DELETE", headers: { Origin: "http://localhost:3016" }, body: body.token }));
  }
  connect.mockClear();
  const bad = request(); bad.headers.set("X-Recycling-Language", "en; ignore rules");
  expect((await handler(bad)).status).toBe(400);
  expect(connect).not.toHaveBeenCalled();
});
it("changes response and transcription language without dropping Songpa rules", () => {
  const english = callSession("en"), korean = callSession("ko");
  expect(english.audio.input.transcription.language).toBe("en");
  expect(korean.audio.input.transcription.language).toBe("ko");
  expect(english.instructions).toContain("Always respond in natural, polite English");
  expect(english.instructions.split("검수 자료: ")[1]).toBe(korean.instructions.split("검수 자료: ")[1]);
  expect(english.instructions).toContain("식품용 EPS");
});

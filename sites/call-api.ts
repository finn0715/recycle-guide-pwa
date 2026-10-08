import { callSession } from "../src/lib/server/call-session";
import { isCallLanguage } from "../src/lib/contracts/call-language";

type Env = { OPENAI_API_KEY?: string };
type Context = { waitUntil: (work: Promise<unknown>) => void };
const encoder = new TextEncoder();
const noStore = { "Cache-Control": "no-store" };
const fail = (status: number) => Response.json({ error: { message: "통화에 연결하지 못했어요. 잠시 뒤 다시 시작해 주세요." } }, { status, headers: noStore });
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const decode = (text: string) => Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
async function tokenKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`recycleguide-call-token-v1:${secret}`));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function seal(callId: string, secret: string, now = Date.now()) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = encoder.encode(JSON.stringify({ callId, expires: now + 60 * 60_000 }));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(secret), payload));
  const bytes = new Uint8Array(iv.length + body.length); bytes.set(iv); bytes.set(body, iv.length);
  return `v1.${encode(bytes)}`;
}
export async function unseal(token: string, secret: string, now = Date.now()) {
  if (!/^v1\.[A-Za-z0-9_-]{60,900}$/.test(token)) throw new Error("invalid token");
  const bytes = decode(token.slice(3));
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await tokenKey(secret), bytes.slice(12));
  const value = JSON.parse(new TextDecoder().decode(plaintext));
  if (typeof value.callId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value.callId) || !Number.isFinite(value.expires) || value.expires <= now) throw new Error("invalid token");
  return value.callId as string;
}
async function limitedText(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) throw new Error("too large");
  if (!request.body) throw new Error("missing body");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error("too large"); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally { reader.releaseLock(); }
}
async function hangup(callId: string, secret: string) {
  const response = await fetch(`https://api.openai.com/v1/realtime/calls/${callId}/hangup`, {
    method: "POST", headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(8000),
  });
  if (!response.ok && response.status !== 404 && response.status !== 409) throw new Error("hangup failed");
}
export async function callApi(request: Request, env: Env, ctx: Context): Promise<Response> {
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin) return fail(403);
  if (request.method !== "POST" && request.method !== "DELETE") return new Response(null, { status: 405, headers: { ...noStore, Allow: "POST, DELETE" } });
  const secret = env.OPENAI_API_KEY?.trim();
  if (!secret) return fail(503);
  if (request.method === "DELETE") {
    let callId: string;
    try { callId = await unseal(await limitedText(request, 1024), secret); } catch { return fail(400); }
    try { await hangup(callId, secret); return new Response(null, { status: 204, headers: noStore }); } catch { return fail(502); }
  }
  const language = request.headers.get("X-Recycling-Language") ?? "ko";
  if (!isCallLanguage(language) || request.headers.get("content-type")?.split(";")[0] !== "application/sdp") return fail(400);
  let sdp: string;
  try { sdp = await limitedText(request, 65536); } catch { return fail(400); }
  if (!sdp.startsWith("v=0") || !sdp.includes("m=audio") || !sdp.includes("m=application")) return fail(400);
  const form = new FormData(); form.set("sdp", sdp); form.set("session", JSON.stringify(callSession(language)));
  let callId: string | undefined;
  try {
    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST", headers: { Authorization: `Bearer ${secret}` }, body: form,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(25000)]),
    });
    if (!response.ok) return fail(response.status === 401 || response.status === 403 ? 503 : 502);
    callId = response.headers.get("location")?.split("/").at(-1);
    if (!callId || !/^[A-Za-z0-9_-]{1,200}$/.test(callId)) return fail(502);
    const answer = await response.text();
    if (!answer.startsWith("v=0") || answer.length > 65536 || request.signal.aborted) throw new Error("invalid answer");
    return Response.json({ sdp: answer, token: await seal(callId, secret) }, { headers: noStore });
  } catch {
    if (callId) ctx.waitUntil(hangup(callId, secret).catch(() => {}));
    return fail(502);
  }
}

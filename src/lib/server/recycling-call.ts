import { isCallLanguage, type CallLanguage } from "@/lib/contracts/call-language";
import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { requestAdmission } from "./analyze";
import { ApiFailure, checkAborted } from "./analyze-request";
import { createCoachRequestHandler, readCoachBody } from "./coach-request";

export { CALL_MODEL, callInstructions, callSession } from "./call-session";
import { callSession } from "./call-session";

export type ConnectedCall = { sdp: string; close: () => Promise<void> };
export type CallConnector = (sdp: string, signal: AbortSignal, language: CallLanguage) => Promise<ConnectedCall>;
const calls = new Map<string, { close: () => Promise<void>; timer: ReturnType<typeof setTimeout> }>();
async function closeCall(token: string) {
  const call = calls.get(token); if (!call) return;
  calls.delete(token); clearTimeout(call.timer);
  try { await call.close(); } catch { /* Peer closure is an independent termination path. */ }
}
export const connectOpenAICall: CallConnector = async (sdp, signal, language) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) throw new ApiFailure("CONFIGURATION_ERROR");
  const client = new OpenAI({ apiKey, baseURL: "https://api.openai.com/v1", maxRetries: 0, timeout: 25_000, logLevel: "off" });
  try {
    const response = await client.realtime.calls.create({ sdp, session: callSession(language) }, { signal });
    const location = response.headers.get("location");
    const callId = location?.split("/").at(-1);
    if (!callId || !/^[a-zA-Z0-9_-]{1,200}$/.test(callId)) throw new ApiFailure("INVALID_MODEL_RESPONSE");
    const close = () => client.realtime.calls.hangup(callId).then(() => undefined);
    if (signal.aborted) { await close().catch(() => {}); checkAborted(signal); }
    const answer = await response.text();
    if (!answer.startsWith("v=0") || answer.length > 65_536) { await close().catch(() => {}); throw new ApiFailure("INVALID_MODEL_RESPONSE"); }
    return { sdp: answer, close };
  } catch (error) {
    checkAborted(signal);
    if (error instanceof ApiFailure) throw error;
    if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError || error instanceof OpenAI.NotFoundError) throw new ApiFailure("CONFIGURATION_ERROR");
    throw new ApiFailure("SERVICE_UNAVAILABLE");
  }
};

function sameOrigin(request: Request) {
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    const target = new URL(request.url);
    return origin.origin === `${target.protocol}//${request.headers.get("host") ?? target.host}`;
  } catch { return false; }
}
export function createCallHandler(connect: CallConnector = connectOpenAICall) {
  return createCoachRequestHandler(async (request, signal) => {
    if (!sameOrigin(request)) throw new ApiFailure("INVALID_REQUEST");
    if (request.headers.get("content-type")?.split(";")[0] !== "application/sdp") throw new ApiFailure("INVALID_REQUEST");
    if (calls.size >= 2) throw new ApiFailure("SERVICE_UNAVAILABLE");
    const language = request.headers.get("X-Recycling-Language") ?? "ko";
    if (!isCallLanguage(language)) throw new ApiFailure("INVALID_REQUEST");
    const bytes = await readCoachBody(request, signal, 65_536);
    let sdp: string;
    try { sdp = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    finally { bytes.fill(0); }
    if (!sdp.startsWith("v=0") || !sdp.includes("m=audio") || !sdp.includes("m=application")) throw new ApiFailure("INVALID_REQUEST");
    const result = await connect(sdp, signal, language);
    if (signal.aborted) { await result.close().catch(() => {}); checkAborted(signal); }
    if (calls.size >= 2) { await result.close().catch(() => {}); throw new ApiFailure("SERVICE_UNAVAILABLE"); }
    const token = randomUUID();
    const timer = setTimeout(() => { void closeCall(token); }, 10 * 60_000);
    timer.unref?.();
    calls.set(token, { close: result.close, timer });
    return Response.json({ sdp: result.sdp, token }, { headers: { "Cache-Control": "no-store" } });
  }, { admission: requestAdmission, timeoutMs: 30_000 });
}
export const recyclingCallRequest = createCallHandler();

export const endRecyclingCall = createCoachRequestHandler(async (request, signal) => {
  if (!sameOrigin(request)) throw new ApiFailure("INVALID_REQUEST");
  const bytes = await readCoachBody(request, signal, 100);
  const token = new TextDecoder().decode(bytes); bytes.fill(0);
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new ApiFailure("INVALID_REQUEST");
  await closeCall(token);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}, { timeoutMs: 10_000 });

import WebSocket from "ws";
import { COACH_CATALOG } from "@/data/coach-guides";
import { COACH_LIMITS, CoachContextSchema, validateCoachSpeechRequest, type GuideCatalog } from "@/lib/contracts/coach";
import { decodeCoachWav, encodeCoachWav } from "@/lib/audio/coach-wav";
import { requestAdmission } from "./analyze";
import { ApiFailure, checkAborted } from "./analyze-request";
import { changedCatalog, createCoachRequestHandler, readCoachBody } from "./coach-request";

export const COACH_SPEECH_MODEL = "gpt-realtime-2.1-mini";
export type CoachSynthesizedSpeech = { pcm: Int16Array; transcript: string };
const normalized = (text: string) => text.normalize("NFC").replace(/[\s\p{P}]/gu, "");
export function matchesCoachSpeech(expected: string, actual: string) { return normalized(expected).length > 0 && normalized(expected) === normalized(actual); }

/** One bounded server connection per cue. Audio is withheld until its full transcript is verified. */
export async function synthesizeCoachSpeech(speechText: string, signal: AbortSignal): Promise<CoachSynthesizedSpeech> {
  checkAborted(signal);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) throw new ApiFailure("CONFIGURATION_ERROR");
  const socket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${COACH_SPEECH_MODEL}`, {
    headers: { Authorization: `Bearer ${apiKey}` }, maxPayload: 2 * 1024 * 1024, handshakeTimeout: COACH_LIMITS.timeoutMs,
  });
  const chunks: Buffer[] = [];
  let bytes = 0, transcript = "", finalTranscript: string | null = null, responseId: string | null = null;
  let result: CoachSynthesizedSpeech | undefined, failure: ApiFailure | undefined, closing = false, requested = false;
  const stop = (error?: ApiFailure) => {
    if (error && !failure) failure = error;
    if (closing) return;
    closing = true;
    // Termination promptly releases transport; settle only on close, never before native work ends.
    socket.terminate();
  };
  const abort = () => stop(signal.reason instanceof ApiFailure ? signal.reason : new ApiFailure("INVALID_REQUEST"));
  const timer = setTimeout(() => stop(new ApiFailure("ANALYSIS_TIMEOUT")), COACH_LIMITS.timeoutMs);
  try {
    return await new Promise<CoachSynthesizedSpeech>((resolve, reject) => {
      socket.on("close", () => {
        if (signal.aborted) abort();
        if (failure || !result) reject(failure ?? new ApiFailure("SERVICE_UNAVAILABLE"));
        else resolve(result);
      });
      socket.on("error", () => stop(new ApiFailure("SERVICE_UNAVAILABLE")));
      socket.on("message", raw => {
        if (closing) return;
        try {
          const event = JSON.parse(raw.toString());
          if (event.type === "error") {
            const code = event.error?.code;
            stop(new ApiFailure(["model_not_found", "invalid_api_key", "permission_denied", "insufficient_permissions"].includes(code) ? "CONFIGURATION_ERROR" : "SERVICE_UNAVAILABLE")); return;
          }
          if (event.type === "session.created") {
            socket.send(JSON.stringify({ type: "session.update", session: {
              type: "realtime", output_modalities: ["audio"], tools: [], tool_choice: "none",
              instructions: "Read only the supplied Korean sentence exactly, without additions, omissions, explanations, or sound effects.",
              audio: { input: { turn_detection: null }, output: { format: { type: "audio/pcm", rate: COACH_LIMITS.audioSampleRate }, voice: "marin" } },
            } }));
          } else if (event.type === "session.updated" && !requested) {
            requested = true;
            socket.send(JSON.stringify({ type: "response.create", response: { conversation: "none", output_modalities: ["audio"], max_output_tokens: 1800,
              instructions: "Read the user sentence verbatim in Korean. No greeting, commentary, advice, or extra words.",
              input: [{ type: "message", role: "user", content: [{ type: "input_text", text: speechText }] }],
            } }));
          } else if (event.type === "response.created") {
            if (!requested || responseId || typeof event.response?.id !== "string") throw new Error();
            responseId = event.response.id;
          } else if (["response.output_audio.delta", "response.output_audio_transcript.delta", "response.output_audio_transcript.done"].includes(event.type)) {
            if (!responseId || event.response_id !== responseId || event.output_index !== 0 || event.content_index !== 0) throw new Error();
            if (event.type === "response.output_audio.delta") {
              if (typeof event.delta !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.delta)) throw new Error();
              const chunk = Buffer.from(event.delta, "base64");
              bytes += chunk.length;
              if (bytes > COACH_LIMITS.audioSeconds * COACH_LIMITS.audioSampleRate * 2 || bytes + 44 > COACH_LIMITS.audioBytes) { chunk.fill(0); throw new Error(); }
              chunks.push(chunk);
            } else if (event.type === "response.output_audio_transcript.delta") {
              if (typeof event.delta !== "string") throw new Error();
              transcript += event.delta; if (transcript.length > 2000) throw new Error();
            } else {
              if (typeof event.transcript !== "string" || event.transcript.length > 2000 || finalTranscript !== null) throw new Error();
              finalTranscript = event.transcript;
            }
          } else if (event.type === "response.done") {
            const response = event.response, content = response?.output?.[0]?.content;
            if (!responseId || response?.id !== responseId || response.status !== "completed" || response.output.length !== 1
              || response.output[0].type !== "message" || response.output[0].role !== "assistant" || !Array.isArray(content) || content.length !== 1
              || content[0].type !== "output_audio" || typeof content[0].transcript !== "string" || !bytes || bytes % 2) throw new Error();
            const final = content[0].transcript;
            if (!matchesCoachSpeech(speechText, final) || finalTranscript === null || !matchesCoachSpeech(final, finalTranscript)
              || (transcript && !matchesCoachSpeech(final, transcript))) throw new Error();
            const buffer = Buffer.concat(chunks), pcm = new Int16Array(bytes / 2);
            for (let i = 0; i < pcm.length; i++) pcm[i] = buffer.readInt16LE(i * 2);
            buffer.fill(0); result = { pcm, transcript: final }; stop();
          }
        } catch { stop(new ApiFailure("INVALID_MODEL_RESPONSE")); }
      });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  } finally {
    clearTimeout(timer); signal.removeEventListener("abort", abort); socket.removeAllListeners();
    chunks.forEach(chunk => chunk.fill(0)); chunks.length = 0; transcript = ""; finalTranscript = null;
    if (failure && result) result.pcm.fill(0);
    result = undefined; speechText = "";
  }
}

export function createCoachSpeechHandler(options: { synthesize?: (text: string, signal: AbortSignal) => Promise<CoachSynthesizedSpeech>; timeoutMs?: number; admission?: { active: number }; catalog?: GuideCatalog } = {}) {
  const catalog = options.catalog ?? COACH_CATALOG;
  return createCoachRequestHandler(async (request, signal, onId) => {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new ApiFailure("INVALID_REQUEST");
    const bytes = await readCoachBody(request, signal, 64 * 1024);
    let speechText = "", raw: unknown, output: CoachSynthesizedSpeech | undefined;
    try {
      let current: ReturnType<typeof validateCoachSpeechRequest>;
      try {
        raw = JSON.parse(new TextDecoder().decode(bytes));
        const context = CoachContextSchema.parse((raw as { context?: unknown })?.context); onId(context.requestId);
        if (context.catalogVersion !== catalog.version) throw changedCatalog();
        current = validateCoachSpeechRequest(catalog, raw);
      } catch (error) { if (error instanceof ApiFailure) throw error; throw new ApiFailure("INVALID_REQUEST"); }
      speechText = current.speechText;
      checkAborted(signal);
      output = await (options.synthesize ?? synthesizeCoachSpeech)(speechText, signal);
      checkAborted(signal);
      let wav: ArrayBuffer;
      try {
        if (typeof output.transcript !== "string" || !matchesCoachSpeech(speechText, output.transcript) || !(output.pcm instanceof Int16Array)) throw new Error();
        wav = encodeCoachWav(output.pcm); const decoded = decodeCoachWav(wav); decoded.samples.fill(0);
      } catch { throw new ApiFailure("INVALID_MODEL_RESPONSE"); }
      return new Response(wav, { headers: { "Content-Type": "audio/wav", "Content-Length": String(wav.byteLength), "Cache-Control": "no-store",
        "X-Request-Id": current.context.requestId, "X-Guide-Revision": String(current.context.revision),
      } });
    } finally { bytes.fill(0); if (output?.pcm instanceof Int16Array) output.pcm.fill(0); output = undefined; raw = undefined; speechText = ""; }
  }, options);
}

export const coachSpeechRequest = createCoachSpeechHandler({ admission: requestAdmission });

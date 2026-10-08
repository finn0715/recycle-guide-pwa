import { COACH_LIMITS } from "@/lib/contracts/coach";
import { ApiFailure, abortable, checkAborted, failureResponse } from "./analyze-request";

export class CoachFailure extends ApiFailure {
  constructor(code: ConstructorParameters<typeof ApiFailure>[0], public readonly safeMessage: string) { super(code); }
}
export const changedCatalog = () => new CoachFailure("INVALID_REQUEST", "안내 기준이 변경됐어요. 처음으로 돌아가 다시 시작해 주세요.");
export const invalidAudio = () => new CoachFailure("INVALID_REQUEST", "음성을 읽을 수 없어요. 20초 이내로 다시 녹음하거나 글로 질문해 주세요.");
export const tooLarge = () => new CoachFailure("PAYLOAD_TOO_LARGE", "질문은 1,000자, 음성은 20초 이내로 보내 주세요.");

export async function coachFailureResponse(error: unknown, requestId: string | null) {
  const base = failureResponse(error, requestId);
  if (!(error instanceof CoachFailure)) return base;
  const body = await base.json();
  body.error.message = error.safeMessage;
  return Response.json(body, { status: base.status, headers: { "Cache-Control": "no-store" } });
}

export async function readCoachBody(request: Request, signal: AbortSignal, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  checkAborted(signal);
  if (!request.body) throw new ApiFailure("INVALID_REQUEST");
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) throw new ApiFailure("INVALID_REQUEST");
  if (Number(length) > maxBytes) throw tooLarge();
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      checkAborted(signal);
      const result = await abortable(reader.read(), signal);
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) throw tooLarge();
      chunks.push(result.value);
    }
    checkAborted(signal);
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } catch (error) { cancel(); checkAborted(signal); throw error; }
  finally { chunks.length = 0; signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

export function createCoachRequestHandler(
  work: (request: Request, signal: AbortSignal, onId: (id: string) => void) => Promise<Response>,
  options: { admission?: { active: number }; timeoutMs?: number },
) {
  const admission = options.admission ?? { active: 0 };
  return async (request: Request): Promise<Response> => {
    if (admission.active >= COACH_LIMITS.concurrency) return coachFailureResponse(new ApiFailure("SERVICE_UNAVAILABLE"), null);
    admission.active++;
    let requestId: string | null = null;
    const controller = new AbortController();
    const cancel = () => controller.abort(new ApiFailure("INVALID_REQUEST"));
    request.signal.addEventListener("abort", cancel, { once: true });
    if (request.signal.aborted) cancel();
    const timer = setTimeout(() => controller.abort(new ApiFailure("ANALYSIS_TIMEOUT")), options.timeoutMs ?? COACH_LIMITS.timeoutMs);
    const pending = (async () => {
      try { checkAborted(controller.signal); return await work(request, controller.signal, id => { requestId = id; }); }
      finally { admission.active--; }
    })();
    try { return await abortable(pending, controller.signal); }
    catch (error) { return coachFailureResponse(error, requestId); }
    finally { clearTimeout(timer); request.signal.removeEventListener("abort", cancel); }
  };
}

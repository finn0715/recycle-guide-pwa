import { LIMITS } from "@/lib/contracts";
import { ApiFailure, abortable, checkAborted, failureResponse, prepareAnalysis, type PreparedAnalysis } from "./analyze-request";
import { resolveModelObservation } from "./analyze-observation";
import { analyzeWithModel } from "./analyze-model";

type Model = (input: PreparedAnalysis, signal: AbortSignal) => Promise<unknown>;
/** One process-local admission gate covers uploads, decoding, and the model request. */
export const requestAdmission = { active: 0 };
export function createAnalyzeHandler(options: { model?: Model; timeoutMs?: number; admission?: { active: number }; resolve?: (requestId: string, output: unknown, messages: PreparedAnalysis["messages"]) => unknown } = {}) {
  const admission = options.admission ?? { active: 0 };
  return async function analyze(request: Request): Promise<Response> {
    if (admission.active >= LIMITS.concurrency) return failureResponse(new ApiFailure("SERVICE_UNAVAILABLE"), null);
    admission.active++;
    let requestId: string | null = null;
    let input: PreparedAnalysis | undefined;
    const controller = new AbortController();
    const cancel = () => controller.abort(new ApiFailure("INVALID_REQUEST"));
    request.signal.addEventListener("abort", cancel, { once: true });
    if (request.signal.aborted) cancel();
    const timer = setTimeout(() => controller.abort(new ApiFailure("ANALYSIS_TIMEOUT")), options.timeoutMs ?? LIMITS.timeoutMs);
    const work = (async () => {
      try {
        input = await prepareAnalysis(request, controller.signal, id => { requestId = id; });
        checkAborted(controller.signal);
        const output = await (options.model ?? analyzeWithModel)(input, controller.signal);
        checkAborted(controller.signal);
        return Response.json((options.resolve ?? resolveModelObservation)(input.requestId, output, input.messages), { headers: { "Cache-Control": "no-store" } });
      } finally {
        // A timeout sends its response immediately; admission is released only when native/network work settles.
        if (input) { input.images.length = 0; input.messages.length = 0; }
        admission.active--;
      }
    })();
    try {
      return await abortable(work, controller.signal);
    } catch (error) { return failureResponse(error, requestId); }
    finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", cancel);
    }
  };
}
export const analyzeRequest = createAnalyzeHandler({ admission: requestAdmission });

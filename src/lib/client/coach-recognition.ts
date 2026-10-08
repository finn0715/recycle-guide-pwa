import { COACH_LIMITS, CoachErrorResponseSchema, CoachRecognizeRequestSchema, CoachRecognitionResponseSchema, type CoachRecognizeRequest, type CoachRecognitionResponse } from "@/lib/contracts/coach";
import { type GuidePhoto } from "./photos";

const invalidResult = () => new Error("인식 결과를 확인하지 못했어요. 사진과 설명을 확인하고 다시 시도해 주세요.");

function validateResponse(payload: unknown, request: CoachRecognizeRequest): CoachRecognitionResponse {
  const parsed = CoachRecognitionResponseSchema.safeParse(payload);
  if (!parsed.success) throw invalidResult();
  const response = parsed.data;
  if (response.requestId !== request.requestId || response.sessionId !== request.sessionId || response.revision !== request.revision) throw invalidResult();
  for (const object of response.objects) {
    if (request.mode === "photo" && !object.views.length) throw invalidResult();
    for (const view of [object, ...object.parts].flatMap(part => part.views)) {
      if (request.mode === "manual" || !request.photoIds.includes(view.photoId)) throw invalidResult();
    }
    if (object.parts.some(part => part.views.some(view => !object.views.some(parent => parent.photoId === view.photoId)))) throw invalidResult();
    if (response.routes.filter(route => route.objectId === object.objectId).length !== 1) throw invalidResult();
  }
  if (response.objects.length === 0) {
    if (response.routes.length !== 1 || response.routes[0].objectId !== null) throw invalidResult();
  } else if (response.routes.length !== response.objects.length || response.routes.some(route => !response.objects.some(object => object.objectId === route.objectId))) throw invalidResult();
  // The controller, which receives the page's catalog, checks catalog version and category/flow references.
  return response;
}

export async function sendCoachRecognition(request: CoachRecognizeRequest, photos: GuidePhoto[], signal: AbortSignal): Promise<CoachRecognitionResponse> {
  signal.throwIfAborted();
  const parsed = CoachRecognizeRequestSchema.safeParse(request);
  if (!parsed.success || photos.length !== request.photoIds.length || photos.some((photo, index) => photo.id !== request.photoIds[index])) throw new Error("사진과 요청 정보가 일치하지 않아요. 다시 선택해 주세요.");
  const body = new FormData();
  for (const key of ["requestId", "sessionId", "region", "mode", "text"] as const) body.set(key, request[key]);
  body.set("revision", String(request.revision));
  body.set("photoIds", JSON.stringify(request.photoIds));
  for (const photo of photos) body.append("photos", photo.file);
  const abort = new AbortController();
  let timedOut = false;
  const relayAbort = () => abort.abort();
  signal.addEventListener("abort", relayAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; abort.abort(); }, COACH_LIMITS.timeoutMs);
  try {
    const response = await fetch("/api/coach/recognize", { method: "POST", body, signal: abort.signal });
    signal.throwIfAborted();
    abort.signal.throwIfAborted();
    const payload: unknown = await response.json().catch(() => null);
    signal.throwIfAborted();
    abort.signal.throwIfAborted();
    if (!response.ok) {
      const error = CoachErrorResponseSchema.safeParse(payload);
      throw new Error(error.success && (error.data.requestId === null || error.data.requestId === request.requestId)
        ? error.data.error.message : "분석 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
    return validateResponse(payload, request);
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (timedOut) throw new Error("인식 시간이 길어지고 있어요. 사진은 그대로 있으니 다시 시도해 주세요.");
    if (error instanceof TypeError) throw new Error("인터넷 연결을 확인하고 다시 시도해 주세요. 선택한 사진은 유지돼요.");
    throw error;
  } finally { clearTimeout(timer); signal.removeEventListener("abort", relayAbort); }
}

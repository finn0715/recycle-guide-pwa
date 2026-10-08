import sharp from "sharp";
import { z } from "zod";
import { LIMITS, type ErrorCode, type ErrorResponse, type Message } from "@/lib/contracts";

const errors: Record<ErrorCode, { status: number; message: string; retryable: boolean }> = {
  INVALID_REQUEST: { status: 400, message: "요청 형식을 확인하고 사진과 설명을 다시 보내 주세요.", retryable: false },
  PAYLOAD_TOO_LARGE: { status: 413, message: "사진은 장당 5MB, 전체 요청은 16MB까지예요. 대화는 12개, 글은 각각 1,000자까지 보내 주세요.", retryable: false },
  UNSUPPORTED_IMAGE: { status: 415, message: "사진을 읽을 수 없어요. 정상적인 JPEG·PNG·WebP 사진으로 다시 보내 주세요.", retryable: false },
  CONFIGURATION_ERROR: { status: 503, message: "분석 서비스 설정을 확인해야 해요. 운영자에게 알려 주세요.", retryable: false },
  SERVICE_UNAVAILABLE: { status: 503, message: "지금은 분석 서비스를 이용하기 어려워요. 잠시 뒤 다시 시도해 주세요.", retryable: true },
  ANALYSIS_TIMEOUT: { status: 504, message: "분석 시간이 초과됐어요. 잠시 뒤 다시 시도해 주세요.", retryable: true },
  INVALID_MODEL_RESPONSE: { status: 502, message: "분석 결과를 안전하게 확인하지 못했어요. 사진과 설명을 확인하고 다시 시도해 주세요.", retryable: true },
};
export class ApiFailure extends Error {
  constructor(public readonly code: ErrorCode, public readonly reason?: "image_resolution") { super(code); this.name = "ApiFailure"; }
}
export function failureResponse(error: unknown, requestId: string | null): Response {
  const code = error instanceof ApiFailure ? error.code : "SERVICE_UNAVAILABLE";
  const { status, message, retryable } = errors[code];
  const safeMessage = error instanceof ApiFailure && error.reason === "image_resolution" ? "사진 해상도가 너무 커요. 크기를 줄인 사진을 선택해 주세요." : message;
  const body: ErrorResponse = { requestId, error: { code, message: safeMessage, retryable } };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
export function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof ApiFailure ? signal.reason : new ApiFailure("INVALID_REQUEST");
}
export async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason instanceof ApiFailure ? signal.reason : new ApiFailure("INVALID_REQUEST"));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  // Always attach handlers to already-started work, including when the signal was aborted beforehand.
  try { return await Promise.race([aborted, work]); }
  finally { signal.removeEventListener("abort", onAbort); }
}
export type PreparedAnalysis = { requestId: string; messages: Message[]; images: string[] };
const messagesSchema = z.array(z.strictObject({ role: z.enum(["user", "assistant"]), text: z.string() }));
const formats: Record<string, string> = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };

export async function boundedFormData(request: Request, signal: AbortSignal): Promise<FormData> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(type) || !request.body) throw new ApiFailure("INVALID_REQUEST");
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) throw new ApiFailure("INVALID_REQUEST");
  if (Number(length) > LIMITS.bodyBytes) throw new ApiFailure("PAYLOAD_TOO_LARGE");
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      checkAborted(signal);
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > LIMITS.bodyBytes) { cancel(); throw new ApiFailure("PAYLOAD_TOO_LARGE"); }
      chunks.push(new Uint8Array(value));
    }
    checkAborted(signal);
    return await abortable(new Response(new Blob(chunks), { headers: { "Content-Type": type } }).formData(), signal);
  } catch (error) {
    cancel();
    checkAborted(signal);
    if (error instanceof ApiFailure) throw error;
    throw new ApiFailure("INVALID_REQUEST");
  } finally {
    chunks.length = 0;
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export async function decodePhoto(photo: File, signal: AbortSignal): Promise<string> {
  if (photo.size > LIMITS.photoBytes) throw new ApiFailure("PAYLOAD_TOO_LARGE");
  if (!photo.size || !Object.hasOwn(formats, photo.type)) throw new ApiFailure("UNSUPPORTED_IMAGE");
  checkAborted(signal);
  const bytes = Buffer.from(await abortable(photo.arrayBuffer(), signal));
  // Decode limits bound compressed-image expansion; no disk cache or uploaded metadata is retained.
  const decoder = sharp(bytes, { failOn: "warning", limitInputPixels: LIMITS.photoPixels, sequentialRead: true });
  const stop = () => { decoder.destroy(); };
  signal.addEventListener("abort", stop, { once: true });
  try {
    const metadata = await decoder.metadata();
    checkAborted(signal);
    if (metadata.format !== formats[photo.type] || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) throw new ApiFailure("UNSUPPORTED_IMAGE");
    // toBuffer decodes pixels (metadata alone would accept corrupt/truncated files).
    const image = await decoder.rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    checkAborted(signal);
    return `data:image/jpeg;base64,${image.toString("base64")}`;
  } catch (error) {
    checkAborted(signal);
    if (error instanceof ApiFailure) throw error;
    if (error instanceof Error && error.message.includes("pixel limit")) throw new ApiFailure("UNSUPPORTED_IMAGE", "image_resolution");
    throw new ApiFailure("UNSUPPORTED_IMAGE");
  } finally { signal.removeEventListener("abort", stop); decoder.destroy(); }
}

export async function prepareAnalysis(request: Request, signal: AbortSignal, onRequestId: (id: string) => void): Promise<PreparedAnalysis> {
  const form = await boundedFormData(request, signal);
  const rawId = form.get("requestId");
  if (typeof rawId !== "string" || !z.uuid().safeParse(rawId).success || form.getAll("requestId").length !== 1) throw new ApiFailure("INVALID_REQUEST");
  onRequestId(rawId);
  for (const key of form.keys()) if (!["requestId", "region", "photos", "messages"].includes(key)) throw new ApiFailure("INVALID_REQUEST");
  if (form.get("region") !== "songpa" || form.getAll("region").length !== 1 || form.getAll("messages").length !== 1) throw new ApiFailure("INVALID_REQUEST");
  const rawMessages = form.get("messages");
  if (typeof rawMessages !== "string") throw new ApiFailure("INVALID_REQUEST");
  let messages: Message[];
  try { messages = messagesSchema.parse(JSON.parse(rawMessages)); } catch { throw new ApiFailure("INVALID_REQUEST"); }
  if (messages.length > LIMITS.messages || messages.some(message => message.text.length > LIMITS.text)) throw new ApiFailure("PAYLOAD_TOO_LARGE");
  if (messages.some(message => !message.text.trim())) throw new ApiFailure("INVALID_REQUEST");
  const photos = form.getAll("photos");
  if (!photos.length || photos.length > LIMITS.photos || photos.some(photo => typeof photo === "string")) throw new ApiFailure("INVALID_REQUEST");
  if (photos.some(photo => (photo as File).size > LIMITS.photoBytes)) throw new ApiFailure("PAYLOAD_TOO_LARGE");
  const images: string[] = [];
  // Decode sequentially under the request semaphore, never three full-size images in parallel.
  for (const photo of photos) images.push(await decodePhoto(photo as File, signal));
  return { requestId: rawId, messages, images };
}

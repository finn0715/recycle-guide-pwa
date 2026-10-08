import { z } from "zod";
import {
  ITEMS,
  LIMITS,
  type AnalysisResponse,
  type ItemId,
  type Message,
} from "@/lib/contracts";

export type AnalyzeRequest = {
  requestId: string;
  photos: File[];
  messages: Message[];
  signal: AbortSignal;
};
export type AnalyzeTransport = (
  request: AnalyzeRequest,
) => Promise<AnalysisResponse>;
const nonemptyText = z.string().refine((value) => value.trim().length > 0);
const responseSchema = z
  .object({
    requestId: z.uuid(),
    status: z.enum(["needs_info", "ready", "uncertain", "unsupported"]),
    item: z
      .object({
        id: z.enum(Object.keys(ITEMS) as [ItemId, ...ItemId[]]),
        label: nonemptyText,
      })
      .nullable(),
    question: z
      .object({
        text: nonemptyText.max(LIMITS.text),
        choices: z.array(nonemptyText),
        allowPhoto: z.boolean(),
      })
      .nullable(),
    guidance: z
      .object({
        region: z.literal("songpa"),
        ruleIds: z.array(nonemptyText).min(1),
        steps: z.array(nonemptyText).min(1),
        parts: z.array(
          z.object({
            name: nonemptyText,
            disposal: nonemptyText,
            actions: z.array(nonemptyText).min(1),
            sourceIds: z.array(nonemptyText).min(1),
          }),
        ).min(1),
        cautions: z.array(nonemptyText),
        sources: z.array(
          z.object({
            id: nonemptyText,
            title: nonemptyText,
            url: z.string().url(),
            checkedAt: nonemptyText,
          }),
        ).min(1),
      })
      .nullable(),
    message: nonemptyText,
  })
  .refine((value) => {
    if (value.status === "ready")
      return value.item !== null && value.guidance !== null && value.question === null;
    if (value.guidance !== null) return false;
    return value.status === "needs_info" ? value.question !== null : value.question === null;
  })
  .refine((value) => {
    if (!value.guidance) return true;
    const sourceIds = new Set(value.guidance.sources.map((source) => source.id));
    return sourceIds.size === value.guidance.sources.length &&
      value.guidance.parts.every((part) => part.sourceIds.every((id) => sourceIds.has(id)));
  });

export const analyzePhotos: AnalyzeTransport = async ({
  requestId,
  photos,
  messages,
  signal,
}) => {
  const body = new FormData();
  body.append("requestId", requestId);
  body.append("region", "songpa");
  for (const photo of photos) body.append("photos", photo);
  body.append("messages", JSON.stringify(messages));
  const abort = new AbortController();
  let timedOut = false;
  const relayAbort = () => abort.abort();
  signal.addEventListener("abort", relayAbort, { once: true });
  if (signal.aborted) abort.abort();
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, LIMITS.timeoutMs);
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      body,
      signal: abort.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = z
        .object({ error: z.object({ message: z.string() }) })
        .safeParse(payload);
      throw new Error(
        error.success
          ? error.data.error.message
          : "분석 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    }
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.requestId !== requestId)
      throw new Error("분석 결과를 확인하지 못했어요. 다시 시도해 주세요.");
    return parsed.data;
  } catch (error) {
    if (timedOut)
      throw new Error(
        "분석 시간이 길어지고 있어요. 사진은 그대로 있으니 다시 시도해 주세요.",
      );
    if (signal.aborted) throw error;
    if (error instanceof TypeError)
      throw new Error(
        "인터넷 연결을 확인하고 다시 시도해 주세요. 선택한 사진은 유지돼요.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", relayAbort);
  }
};

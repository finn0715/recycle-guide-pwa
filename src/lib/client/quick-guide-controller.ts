import { ITEMS, LIMITS, type ItemId } from "@/lib/contracts";
import { IdentificationResponseSchema, type Identification } from "@/lib/contracts/quick";
import { createRequestId, preparePhoto, type GuidePhoto } from "./photos";

export type IdentifyTransport = (photos: File[], signal: AbortSignal) => Promise<Identification>;
export const identifyPhotos: IdentifyTransport = async (photos, signal) => {
  const requestId = createRequestId();
  const body = new FormData();
  body.set("requestId", requestId); body.set("region", "songpa"); body.set("messages", "[]");
  photos.forEach(photo => body.append("photos", photo));
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, LIMITS.timeoutMs);
  try {
    const response = await fetch("/api/identify", { method: "POST", body, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof payload?.error?.message === "string" ? payload.error.message : "사진을 분석하지 못했어요. 다시 시도하거나 아래에서 물건을 골라 주세요.");
    const parsed = IdentificationResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.requestId !== requestId) throw new Error("사진 결과를 읽지 못했어요. 다시 시도하거나 물건을 직접 골라 주세요.");
    return parsed.data;
  } catch (error) {
    if (timedOut) throw new Error("사진 분석이 오래 걸리고 있어요. 다시 시도하거나 물건을 직접 골라 주세요.");
    if (error instanceof TypeError) throw new Error("인터넷 연결을 확인해 주세요. 아래에서 물건을 고르면 바로 방법을 볼 수 있어요.");
    throw error;
  } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
};

export type QuickState = {
  status: "idle" | "preparing" | "loading" | "done" | "error";
  photos: GuidePhoto[];
  items: ItemId[];
  activeId: ItemId | null;
  methodId: string | null;
  origin: "photo" | "manual";
  notice: string | null;
  error: string | null;
};
const initial = (): QuickState => ({ status: "idle", photos: [], items: [], activeId: null, methodId: null, origin: "manual", notice: null, error: null });
export function createQuickGuideController(options: { transport?: IdentifyTransport; prepare?: typeof preparePhoto; revoke?: (url: string) => void } = {}) {
  let state = initial();
  let version = 0;
  let abort: AbortController | null = null;
  const listeners = new Set<() => void>();
  const transport = options.transport ?? identifyPhotos;
  const revoke = options.revoke ?? (url => URL.revokeObjectURL(url));
  const update = (patch: Partial<QuickState>) => { state = {...state, ...patch}; listeners.forEach(listener => listener()); };
  const cancel = () => { version++; abort?.abort(); abort = null; };
  const release = (photos: GuidePhoto[]) => photos.forEach(photo => revoke(photo.url));
  async function analyze() {
    if (!state.photos.length || state.status === "loading") return;
    cancel();
    const current = version;
    abort = new AbortController();
    const signal = abort.signal;
    update({ status: "loading", activeId: null, methodId: null, items: [], error: null, notice: null, origin: "photo" });
    try {
      const result = await transport(state.photos.map(photo => photo.file), signal);
      if (current !== version || signal.aborted) return;
      update({ status: "done", items: result.items, activeId: result.items[0] ?? null,
        notice: result.outcome === "unclear" ? "사진이 잘 보이지 않아요. 아래에서 물건을 고르거나 다시 찍어 주세요."
          : result.outcome === "unsupported" ? "이 사진에서는 지원 품목을 찾지 못했어요. 아래 10종을 직접 고를 수 있어요."
          : result.hasOtherItems ? "사진 속 지원 품목을 찾았어요. 다른 물건은 목록에서 직접 골라 주세요." : null });
    } catch (error) {
      if (current !== version || signal.aborted) return;
      update({ status: "error", error: error instanceof Error ? error.message : "사진 분석을 마치지 못했어요. 다시 시도해 주세요." });
    } finally { if (current === version) abort = null; }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async selectPhotos(files: File[]) {
      if (!files.length) return;
      if (files.length > LIMITS.photos) { update({ error: "한 번에 사진 3장까지 골라 주세요." }); return; }
      cancel(); const current = version;
      update({ status: "preparing", error: null, activeId: null, methodId: null, items: [], notice: null });
      const prepared: GuidePhoto[] = [];
      try {
        for (const file of files) prepared.push(await (options.prepare ?? preparePhoto)(file));
        if (current !== version) { release(prepared); return; }
        release(state.photos);
        update({ photos: prepared, status: "idle" });
        await analyze();
      } catch (error) {
        release(prepared);
        if (current === version) update({ status: "error", error: error instanceof Error ? error.message : "사진을 읽지 못했어요." });
      }
    },
    retry() { if (state.status === "preparing" || state.status === "loading") return Promise.resolve(); return analyze(); },
    pickItem(id: ItemId, origin: "photo" | "manual" = "manual") {
      if (!Object.hasOwn(ITEMS, id)) return;
      cancel();
      update({ status: "done", activeId: id, methodId: null, origin, error: null });
    },
    pickMethod(id: string) { update({ methodId: id }); },
    reset() { cancel(); release(state.photos); state = initial(); listeners.forEach(listener => listener()); },
    dispose() { cancel(); release(state.photos); state = initial(); listeners.clear(); },
  };
}
export type QuickGuideController = ReturnType<typeof createQuickGuideController>;

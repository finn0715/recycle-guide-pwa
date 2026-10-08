import { LIMITS, type AnalysisResponse, type ItemId, type Message } from "@/lib/contracts";
import { analyzePhotos, type AnalyzeTransport } from "./analyze";
import { createRequestId, preparePhoto, type GuidePhoto } from "./photos";

export type GuideState = {
  status: "idle" | "preview" | "loading" | "error" | AnalysisResponse["status"];
  photos: GuidePhoto[];
  messages: Message[];
  response: AnalysisResponse | null;
  text: string;
  error: string | null;
  isPreparing: boolean;
  correcting: boolean;
  lastSentPhotoCount: number;
};
type Dependencies = {
  transport?: AnalyzeTransport;
  preparePhoto?: (file: File) => Promise<GuidePhoto>;
  releasePhoto?: (url: string) => void;
  createRequestId?: () => string;
};
const initialState = (): GuideState => ({
  status: "idle",
  photos: [],
  messages: [],
  response: null,
  text: "",
  error: null,
  isPreparing: false,
  correcting: false,
  lastSentPhotoCount: 0,
});

export function createGuideController(dependencies: Dependencies = {}) {
  const transport = dependencies.transport ?? analyzePhotos;
  const prepare = dependencies.preparePhoto ?? preparePhoto;
  const release =
    dependencies.releasePhoto ?? ((url: string) => URL.revokeObjectURL(url));
  const requestId = dependencies.createRequestId ?? createRequestId;
  let state = initialState();
  let version = 0;
  let locked = false;
  let knownItemId: ItemId | null = null;
  let abort: AbortController | null = null;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<GuideState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const cancel = () => {
    version++;
    abort?.abort();
    abort = null;
    locked = false;
  };
  const reset = () => {
    cancel();
    knownItemId = null;
    state.photos.forEach((photo) => release(photo.url));
    state = initialState();
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset,
    beginCorrection() {
      cancel();
      knownItemId = null;
      update({
        ...initialState(),
        photos: state.photos,
        status: state.photos.length ? "preview" : "idle",
        correcting: true,
      });
    },
    dispose: () => {
      reset();
      listeners.clear();
    },
    setText: (text: string) => update({ text, error: null }),
    async selectPhotos(files: File[], mode: "replace" | "append") {
      if (!files.length) return;
      const remaining =
        mode === "append" ? LIMITS.photos - state.photos.length : LIMITS.photos;
      if (files.length > remaining) {
        update({ error: "한 물건의 사진은 최대 3장까지 선택할 수 있어요." });
        return;
      }
      if (mode === "replace") reset();
      else cancel();
      const selectedVersion = version;
      const prepared: GuidePhoto[] = [];
      update({ isPreparing: true, error: null });
      try {
        for (const file of files) prepared.push(await prepare(file));
        if (selectedVersion !== version) {
          prepared.forEach((photo) => release(photo.url));
          return;
        }
        const photos = [...state.photos, ...prepared];
        if (
          photos.reduce((total, photo) => total + photo.file.size, 0) >
          LIMITS.bodyBytes - 64 * 1024
        )
          throw new Error(
            "사진 전체 용량이 너무 커요. 사진 크기를 줄여 주세요.",
          );
        update({
          photos,
          status: state.response?.status ?? "preview",
          isPreparing: false,
        });
      } catch (error) {
        prepared.forEach((photo) => release(photo.url));
        if (selectedVersion !== version) return;
        update({
          isPreparing: false,
          error:
            error instanceof Error
              ? error.message
              : "사진을 준비하지 못했어요. 다시 선택해 주세요.",
        });
      }
    },
    removePhoto(id: string) {
      cancel();
      knownItemId = null;
      const selected = state.photos.find((photo) => photo.id === id);
      if (selected) release(selected.url);
      const photos = state.photos.filter((photo) => photo.id !== id);
      update({
        photos,
        status: photos.length ? "preview" : "idle",
        messages: [],
        response: null,
        error: null,
        isPreparing: false,
        lastSentPhotoCount: 0,
      });
    },
    async submit() {
      if (locked || state.isPreparing) return;
      if (!state.photos.length) {
        update({ error: "먼저 물건 사진을 한 장 선택해 주세요." });
        return;
      }
      const text = state.text.trim();
      if (state.correcting && !text) {
        update({ error: "어떤 물건인지 설명을 입력해 주세요." });
        return;
      }
      if (state.text.length > LIMITS.text) {
        update({ error: "설명은 한 번에 1,000자까지 입력할 수 있어요." });
        return;
      }
      const previousItemId = knownItemId;
      const question = state.response?.question;
      if (
        question &&
        !text &&
        state.photos.length <= state.lastSentPhotoCount
      ) {
        update({
          error: question.allowPhoto
            ? "답변을 입력하거나 같은 물건의 사진을 추가해 주세요."
            : "질문에 대한 답변을 입력해 주세요.",
        });
        return;
      }
      const messages: Message[] = [...state.messages];
      if (question) messages.push({ role: "assistant", text: question.text });
      if (text) messages.push({ role: "user", text });
      if (messages.length > LIMITS.messages) {
        update({
          error:
            "대화는 최대 12개 메시지까지 이어갈 수 있어요. 새 물건으로 시작해 주세요.",
        });
        return;
      }
      if (messages.some((message) => message.text.length > LIMITS.text)) {
        update({
          error:
            "질문 또는 설명이 1,000자를 넘었어요. 새 물건으로 다시 시작해 주세요.",
        });
        return;
      }
      locked = true;
      abort = new AbortController();
      const activeAbort = abort;
      const activeVersion = ++version;
      update({ status: "loading", error: null });
      try {
        const response = await transport({
          requestId: requestId(),
          photos: state.photos.map((photo) => photo.file),
          messages,
          signal: activeAbort.signal,
        });
        if (activeVersion !== version || activeAbort.signal.aborted) return;
        if (previousItemId && response.item && previousItemId !== response.item.id) {
          // Answers to the old item's questions must never authorize a new item's guidance.
          knownItemId = null;
          update({
            ...initialState(),
            photos: state.photos,
            status: "error",
            error: "제품 종류가 달라져 이전 답변을 지웠어요. 같은 사진으로 다시 분석해 주세요.",
          });
          return;
        }
        if (response.item) knownItemId = response.item.id;
        update({
          status: response.status,
          response,
          correcting: false,
          messages,
          text: "",
          lastSentPhotoCount: state.photos.length,
        });
      } catch (error) {
        if (activeVersion !== version || activeAbort.signal.aborted) return;
        update({
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "분석하지 못했어요. 다시 시도해 주세요.",
        });
      } finally {
        if (activeVersion === version) {
          locked = false;
          abort = null;
        }
      }
    },
  };
}
export type GuideController = ReturnType<typeof createGuideController>;

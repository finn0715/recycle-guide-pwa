export const ITEMS = {
  pump_bottle: "샴푸·린스 용기",
  clear_pet_bottle: "투명 생수·음료병",
  drink_carton: "우유·두유팩",
  cardboard_box: "택배 상자",
  foam_box: "스티로폼 상자",
  snack_bag: "과자 봉지",
  takeaway_container: "배달 용기",
  glass_jar: "잼 유리병",
  toothbrush: "칫솔",
  ice_pack: "아이스팩",
} as const;
export type ItemId = keyof typeof ITEMS;
export type Message = { role: "user" | "assistant"; text: string };
export type Source = {
  id: string;
  title: string;
  url: string;
  checkedAt: string;
};
export type Question = { text: string; choices: string[]; allowPhoto: boolean };
export type Guidance = {
  region: "songpa";
  ruleIds: string[];
  steps: string[];
  parts: {
    name: string;
    disposal: string;
    actions: string[];
    sourceIds: string[];
  }[];
  cautions: string[];
  sources: Source[];
};
export type AnalysisStatus =
  "needs_info" | "ready" | "uncertain" | "unsupported";
export type AnalysisResponse = {
  requestId: string;
  status: AnalysisStatus;
  item: { id: ItemId; label: string } | null;
  question: Question | null;
  guidance: Guidance | null;
  message: string;
};
export type ErrorCode =
  | "INVALID_REQUEST"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_IMAGE"
  | "CONFIGURATION_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "ANALYSIS_TIMEOUT"
  | "INVALID_MODEL_RESPONSE";
export type ErrorResponse = {
  requestId: string | null;
  error: { code: ErrorCode; message: string; retryable: boolean };
};
export const LIMITS = {
  photoBytes: 5 * 1024 * 1024,
  bodyBytes: 16 * 1024 * 1024,
  photos: 3,
  messages: 12,
  text: 1000,
  timeoutMs: 45000,
  concurrency: 2,
  photoPixels: 24_000_000,
  photoMaxEdge: 4096,
} as const;

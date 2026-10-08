import { ITEMS, type AnalysisResponse, type Guidance, type ItemId } from "@/lib/contracts";
import { FACT_REGISTRY } from "@/data/facts";
import { RULES, SOURCES, type DisposalRule, type OfficialSource } from "@/data/disposal-rules";

export { FACT_REGISTRY } from "@/data/facts";
export type Facts = Record<string, string>;
export type RuleResolution = Pick<AnalysisResponse, "status" | "question" | "guidance" | "message">;
export type ResolveOptions = {
  /** Keys supported by actual user statements, never inferred solely from images. */
  confirmedFactKeys?: string[];
  /** Explicit user inability to confirm, distinct from not having been asked yet. */
  unableToAnswer?: string[];
};

export class InvalidFactsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFactsError";
  }
}

function own(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** Reject arbitrary model keys and values before any rule selection. Missing keys stay missing. */
export function validateFacts(itemId: ItemId, raw: unknown): Facts {
  if (!own(ITEMS, itemId)) throw new InvalidFactsError("Unknown item");
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new InvalidFactsError("Facts must be an object");
  }
  const registry = FACT_REGISTRY[itemId];
  const entries = Object.entries(raw);
  for (const [key, value] of entries) {
    if (!own(registry, key) || typeof value !== "string" || !registry[key].values.includes(value)) {
      throw new InvalidFactsError(`Invalid fact: ${key}`);
    }
  }
  return Object.fromEntries(entries) as Facts;
}

/** Validate authored data as well as each part's provenance; fail closed on invalid data. */
export function assertRuleData(rules: DisposalRule[], sources: OfficialSource[]): void {
  const sourceIds = new Set<string>();
  for (const source of sources) {
    if (sourceIds.has(source.id) || !source.id || !source.title || !source.section || !source.url.startsWith("https://") || !/^\d{4}-\d{2}-\d{2}$/.test(source.checkedAt) || source.verification !== "official_body_checked") {
      throw new Error(`Invalid source: ${source.id}`);
    }
    sourceIds.add(source.id);
  }
  const ids = new Set<string>();
  for (const rule of rules) {
    if (ids.has(rule.id) || !rule.id || !own(ITEMS, rule.item) || rule.region !== "songpa" || rule.reviewStatus !== "reviewed") {
      throw new Error(`Invalid rule: ${rule.id}`);
    }
    ids.add(rule.id);
    if (!rule.sourceIds.length || rule.sourceIds.some((id) => !sourceIds.has(id))) {
      throw new Error(`Invalid source in rule: ${rule.id}`);
    }
    if (!rule.parts.length || rule.parts.some((part) => !part.sourceIds.length || part.sourceIds.some((id) => !sourceIds.has(id) || !rule.sourceIds.includes(id)))) {
      throw new Error(`Invalid part source in rule: ${rule.id}`);
    }
    const registry = FACT_REGISTRY[rule.item];
    for (const [key, values] of Object.entries(rule.conditions)) {
      if (!own(registry, key) || !values.length || values.some((value) => value === "unknown" || !registry[key].values.includes(value))) {
        throw new Error(`Invalid fact condition: ${rule.id}/${key}`);
      }
    }
    if (rule.facts.length !== Object.keys(rule.conditions).length || rule.facts.some((key) => !own(rule.conditions, key))) {
      throw new Error(`Invalid fact registry in rule: ${rule.id}`);
    }
    if (rule.questions.length !== rule.facts.length || rule.questions.some((text, index) => text !== registry[rule.facts[index]].question.text)) {
      throw new Error(`Invalid fact question in rule: ${rule.id}`);
    }
  }
}

assertRuleData(RULES, SOURCES);

const uncertainMessages: Record<ItemId, string> = {
  pump_bottle: "남은 내용물이나 펌프·라벨 재질의 처리 기준을 확인해야 해요. 송파구청 또는 제품 제조사의 안내를 확인해 주세요.",
  clear_pet_bottle: "투명 생수·음료병 규칙을 지금 상태에 적용할 수 없어요. 용도·남은 내용물·라벨을 확인한 뒤 다시 알려주세요.",
  drink_carton: "팩의 종류·남은 내용물·빨대·포장비닐 등 부속품을 확인해야 해요. 일반 종이로 분류하지 말고 송파구 종이팩 안내를 확인해 주세요.",
  cardboard_box: "코팅·오염·젖은 상태나 테이프·송장 등 부속품의 세부 처리 기준이 더 필요해요. 송파구청에 상자의 재질과 상태를 확인해 주세요.",
  foam_box: "식품 포장용은 송파 공식 자료의 기준이 달라 확정할 수 없어요. 유색·코팅·제거되지 않는 오염·미확인 부속품도 현재 규칙에서 보류해요. 송파구청에 상태를 설명하고 배출 방법을 확인해 주세요.",
  snack_bag: "남은 내용물·이물질 또는 포장재 재질의 세부 기준을 확인해야 해요. 현재 정보로 배출 분류를 확정할 수 없어요.",
  takeaway_container: "혼합 음식·기름·국물 또는 뚜껑·밀봉 필름의 재질·상태는 별도 확인이 필요해요. 남은 것을 모두 음식물쓰레기로 판단하지 않고 송파구 기준을 확인해 주세요.",
  glass_jar: "병의 재질·깨짐·잔여물·뚜껑에 추가 확인이 필요해요. 내열유리나 부속품까지 유리병류로 분류하지 않고 송파구 기준을 확인해 주세요.",
  toothbrush: "이 안내는 전기를 쓰지 않는 일반 플라스틱 칫솔만 다뤄요. 전동 칫솔·배터리나 다른 재질은 별도 배출 기준을 확인해 주세요.",
  ice_pack: "전분 등 미검수 냉매·포장재 또는 누출 상태에는 현재 규칙을 적용할 수 없어요. 포장을 자르거나 내용물을 붓기 전에 성분과 처리 방법을 제조사나 송파구청에 확인해 주세요.",
};

function uncertain(itemId: ItemId): RuleResolution {
  return { status: "uncertain", question: null, guidance: null, message: uncertainMessages[itemId] };
}

function buildGuidance(selected: DisposalRule[]): Guidance {
  const sourceIds = new Set(selected.flatMap((rule) => rule.sourceIds));
  const sources = SOURCES.filter((source) => sourceIds.has(source.id)).map(({ id, title, url, checkedAt }) => ({ id, title, url, checkedAt }));
  return structuredClone({
    region: "songpa",
    ruleIds: selected.map((rule) => rule.id),
    steps: [...new Set(selected.flatMap((rule) => rule.steps))],
    parts: selected.flatMap((rule) => rule.parts),
    cautions: [...new Set(selected.flatMap((rule) => rule.cautions))],
    sources,
  });
}

/** All question/guidance text comes from trusted data; no generated directions are accepted. */
export function resolveRules(itemId: ItemId, rawFacts: Facts, options: ResolveOptions = {}): RuleResolution {
  const facts = validateFacts(itemId, rawFacts);
  const registry = FACT_REGISTRY[itemId];
  for (const keys of [options.confirmedFactKeys ?? [], options.unableToAnswer ?? []]) {
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string" || !own(registry, key))) {
      throw new InvalidFactsError("Invalid fact confirmation keys");
    }
  }
  const confirmed = new Set(options.confirmedFactKeys ?? []);
  const unable = new Set(options.unableToAnswer ?? []);
  for (const key of Object.keys(facts)) {
    if (unable.has(key) || (registry[key].evidence === "user_only" && !confirmed.has(key))) facts[key] = "unknown";
  }
  const isUnknown = (key: string) => !own(facts, key) || facts[key] === "unknown";
  const candidates = RULES.filter((rule) => rule.item === itemId && rule.kind === "base" && Object.entries(rule.conditions).every(([key, values]) => isUnknown(key) || values.includes(facts[key])));
  if (!candidates.length) return uncertain(itemId);
  const relevantKeys = Object.keys(registry).filter((key) => candidates.some((rule) => own(rule.conditions, key)));
  const missing = relevantKeys.find(isUnknown);
  if (relevantKeys.some((key) => isUnknown(key) && unable.has(key))) return uncertain(itemId);
  if (missing) {
    return { status: "needs_info", question: structuredClone(registry[missing].question), guidance: null, message: "분리배출 방법을 정하기 전에 한 가지만 확인할게요." };
  }
  if (candidates.length !== 1) return uncertain(itemId);
  const extra = RULES.filter((rule) => rule.item === itemId && rule.kind === "part" && Object.entries(rule.conditions).every(([key, values]) => !isUnknown(key) && values.includes(facts[key])));
  return { status: "ready", question: null, guidance: buildGuidance([candidates[0], ...extra]), message: "확인된 조건에 맞는 송파구 배출 방법이에요." };
}

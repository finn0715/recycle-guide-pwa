import { z } from "zod";
import { ITEMS, type AnalysisResponse, type ItemId, type Message } from "@/lib/contracts";
import { FACT_REGISTRY, resolveRules, validateFacts, type Facts } from "./rules";
import { ApiFailure } from "./analyze-request";

const userEvidence = { messageIndex: z.number().int().nullable(), quote: z.string().max(1000).nullable() };
export const ObservationSchema = z.strictObject({
  verdict: z.enum(["recognized", "multiple", "unclear", "unsupported", "conflict", "insufficient"]),
  itemId: z.enum(Object.keys(ITEMS) as [ItemId, ...ItemId[]]).nullable(),
  facts: z.array(z.strictObject({ key: z.string().max(80), value: z.string().max(80), evidence: z.strictObject({ kind: z.enum(["user", "photo"]), ...userEvidence }) })).max(30),
  unable: z.array(z.strictObject({ key: z.string().max(80), ...userEvidence })).max(15),
});
const invalid = () => new ApiFailure("INVALID_MODEL_RESPONSE");
const normalize = (text: string) => text.replace(/[\s.,!·]/g, "").toLowerCase();
const inability = /모르|모릅|확인하기\s*어려|확인할\s*수\s*없|확인\s*(?:불가|못)/;
// These are request instructions/quotations, not first-person reports of physical conditions.
const nonAssertion = /(?:system|assistant|developer|ignore|prompt|ruleIds|confirmedFactKeys)|(?:지시|규칙|정책).*(?:무시|덮어|변경)|(?:라고|라는).*(?:답|말|처리|가정)|(?:출력|응답|분류|처리)(?:해|하라|하세요)|[?？"'“”‘’「」『』`]|(?:인가요|일까요|맞나요|나요|까요)(?:[.!]|\s|$)/i;
const negation = /아니|않|아닌|못|안\s*비/;
const correction = /잘못|착각|정정|수정|다시|알고\s*보니|실은|사실/;

/** Optional conservative free-text forms. The registry remains the key/value authority. */
function freeTextMatches(key: string, value: string, text: string): boolean {
  const patterns: Record<string, RegExp> = {
    "material:plastic": /^(?:본체|용기)(?:는|가)?\s*플라스틱(?:입니다|이에요|이예요|예요|이다)$/,
    "contents:empty": /^(?:(?:내용물|안|내부)(?:은|는|을|를)?\s*)?(?:모두|다|완전히)\s*비웠(?:어요|습니다|다)$/,
    "contents:remaining": /^(?:내용물|샴푸|음료|물|우유)(?:은|는|이|가)?\s*(?:아직\s*)?(?:남아\s*있(?:어요|습니다)|남았(?:어요|습니다))$/,
    "pump:composite": /^펌프(?:에는|에|는|가)?\s*(?:금속\s*)?스프링(?:이|은)?\s*(?:있(?:어요|습니다)|섞여\s*있(?:어요|습니다))$/,
    "pump:none": /^펌프(?:는|가)?\s*없(?:어요|습니다)$/,
    "label:none": /^라벨(?:은|이)?\s*없(?:어요|습니다)$/,
    "label:film": /^(?:라벨(?:은|이)\s*)?(?:분리할\s*수\s*있는|떼어낼\s*수\s*있는)\s*비닐\s*라벨(?:입니다|이에요|예요)$/,
    "bottle_type:clear_beverage": /^투명(?:한)?\s*(?:생수|음료|물)(?:용)?\s*(?:페트)?병(?:입니다|이에요|예요|이다)$/,
    "carton_type:regular": /^일반\s*(?:우유|종이)팩(?:입니다|이에요|예요)$/,
    "carton_type:aseptic": /^멸균\s*팩(?:입니다|이에요|예요)$/,
    "cap:present": /^뚜껑(?:은|이)?\s*있(?:어요|습니다)$/,
    "cap:absent": /^뚜껑(?:은|이)?\s*없(?:어요|습니다)$/,
    "coolant:water": /^(?:포장에\s*)?물\s*100\s*%(?:라고)?\s*(?:적혀\s*있(?:어요|습니다)|표시되어\s*있(?:어요|습니다))$/,
    "coolant:gel": /^(?:고흡수성수지(?:\(SAP\))?|SAP)(?:라고)?\s*(?:적혀\s*있(?:어요|습니다)|표시되어\s*있(?:어요|습니다))$/i,
    "coolant:starch": /^전분(?:이)?\s*들어\s*있다고\s*적혀\s*있(?:어요|습니다)$/,
    "condition:food_remaining": /^(?:음식|국물|기름|내용물)(?:은|는|이|가)?\s*(?:남아\s*있(?:어요|습니다)|남았(?:어요|습니다))$/,
    "leftovers:mixed_other": /^(?:국물|기름|여러\s*재료)(?:은|는|이|가)?\s*(?:남아\s*있(?:어요|습니다)|남았(?:어요|습니다))$/,
  };
  return patterns[`${key}:${value}`]?.test(text) ?? false;
}

function matchedClause(itemId: ItemId, key: string, text: string): string | undefined {
  const definition = FACT_REGISTRY[itemId][key];
  const compact = normalize(text);
  const exact = Object.entries(definition.choices).find(([value, choice]) => value !== "unknown" && compact === normalize(choice));
  if (exact) return exact[0];
  // Authored choices such as "깨지지 않았어요" have an explicit meaning; other negations do not.
  if (negation.test(text) || inability.test(text)) return undefined;
  const matches = definition.values.filter(value => value !== "unknown" && freeTextMatches(key, value, text));
  return matches.length === 1 ? matches[0] : undefined;
}

/** Accept complete declarations, never a recognized substring inside an unverified utterance. */
function parseUserFacts(itemId: ItemId, text: string): Facts | null {
  if (nonAssertion.test(text)) return null;
  const clauses = text.split(/[.!。！,，;；\n]+/).map(clause => clause.trim()).filter(Boolean);
  if (!clauses.length) return null;
  const facts: Facts = {};
  for (const clause of clauses) {
    const matches = Object.keys(FACT_REGISTRY[itemId]).map(key => ({ key, value: matchedClause(itemId, key, clause) })).filter(match => match.value !== undefined);
    // One unknown clause can change a previously confirmed condition. Reconfirm the utterance as a whole.
    if (!matches.length) return null;
    for (const { key, value } of matches) {
      if (Object.hasOwn(facts, key) && facts[key] !== value) return null;
      facts[key] = value!;
    }
  }
  return facts;
}

function matchedValue(itemId: ItemId, key: string, text: string): string | undefined {
  return parseUserFacts(itemId, text)?.[key];
}

function verifyQuote(evidence: { messageIndex: number | null; quote: string | null }, messages: Message[]): { text: string; index: number } {
  const { messageIndex, quote } = evidence;
  if (messageIndex === null || !Number.isInteger(messageIndex) || messageIndex < 0 || !quote?.trim()) throw invalid();
  const message = messages[messageIndex];
  if (!message || message.role !== "user" || !message.text.includes(quote)) throw invalid();
  return { text: message.text, index: messageIndex };
}

const productNames: Record<ItemId, RegExp> = {
  pump_bottle: /샴푸|린스/g, clear_pet_bottle: /페트병|생수병|음료병/g, drink_carton: /우유팩|두유팩|멸균팩|종이팩/g,
  cardboard_box: /택배\s*상자|골판지/g, foam_box: /스티로폼/g, snack_bag: /과자\s*봉지/g,
  takeaway_container: /배달\s*용기/g, glass_jar: /잼\s*(?:병|유리병)/g, toothbrush: /칫솔/g, ice_pack: /아이스팩/g,
};
function productScope(messages: Message[]): { start: number; correctedItem: ItemId | null } {
  let start = 0;
  let correctedItem: ItemId | null = null;
  let previousItem: ItemId | null = null;
  messages.forEach((message, index) => {
    if (message.role !== "user") return;
    const reset = /(?:다른|새로운|새)\s*(?:제품|물건)|바꿨|교체|잘못\s*인식|아니라|정정/.test(message.text);
    let namedItem: ItemId | null = null;
    let last = -1;
    for (const [item, pattern] of Object.entries(productNames)) {
      for (const match of message.text.matchAll(pattern)) if (match.index > last) { last = match.index; namedItem = item as ItemId; }
    }
    if (reset || (namedItem && previousItem && namedItem !== previousItem)) { start = index; correctedItem = namedItem; }
    if (namedItem) previousItem = namedItem;
  });
  return { start, correctedItem };
}

function fixedResponse(requestId: string, verdict: string, itemId: ItemId | null): AnalysisResponse {
  const item = itemId ? { id: itemId, label: ITEMS[itemId] } : null;
  if (verdict === "unsupported") return { requestId, item: null, status: "unsupported", question: null, guidance: null, message: "현재 지원하는 10가지 생활용품에 해당하지 않아요. 지원 품목 한 가지를 선택해 다시 촬영해 주세요." };
  if (verdict === "insufficient") return { requestId, item, status: "uncertain", question: null, guidance: null, message: "추가 정보로도 제품과 상태를 확인하기 어려워요. 제품 표시를 확인하거나 제조사·송파구청에 문의해 주세요." };
  const conflict = verdict === "conflict";
  return { requestId, item, status: "needs_info", question: {
    text: conflict ? "사진과 설명이 같은 제품인가요? 제품 이름을 확인하고 한 제품의 사진을 다시 보내 주세요." : "한 제품만 전체 모습과 표시가 선명하게 보이도록 다시 촬영해 주세요.",
    choices: conflict ? ["같은 제품이에요", "다른 제품으로 다시 시작할게요", "확인하기 어려워요"] : ["한 제품을 다시 촬영할게요", "확인하기 어려워요"], allowPhoto: true,
  }, guidance: null, message: conflict ? "사진과 설명이 달라 배출 방법을 정할 수 없어요." : "제품을 확인할 사진이 더 필요해요." };
}

export function resolveModelObservation(requestId: string, raw: unknown, messages: Message[]): AnalysisResponse {
  const parsed = ObservationSchema.safeParse(raw);
  if (!parsed.success) throw invalid();
  const output = parsed.data;
  const latestUser = messages.findLast(message => message.role === "user");
  const cannotContinue = !!latestUser && inability.test(latestUser.text);
  if (output.verdict !== "recognized") return fixedResponse(requestId, cannotContinue && output.verdict !== "unsupported" ? "insufficient" : output.verdict, output.itemId);
  if (!output.itemId) throw invalid();
  const itemId = output.itemId;
  const scope = productScope(messages);
  if (scope.correctedItem && scope.correctedItem !== itemId) return fixedResponse(requestId, "conflict", null);
  const facts: Facts = {};
  const confirmed = new Set<string>();
  const unable = new Set<string>();
  const seen = new Set<string>();
  const latestUserFactIndex = new Map<string, number>();
  for (const fact of output.facts) {
    try { validateFacts(itemId, { [fact.key]: fact.value }); } catch { throw invalid(); }
    if (seen.has(fact.key)) throw invalid();
    seen.add(fact.key);
    if (fact.evidence.kind === "photo") {
      if (fact.evidence.messageIndex !== null || fact.evidence.quote !== null) throw invalid();
      if (FACT_REGISTRY[itemId][fact.key].evidence === "photo_allowed") facts[fact.key] = fact.value;
    } else {
      const evidence = verifyQuote(fact.evidence, messages);
      if (evidence.index < scope.start) continue;
      // A real newer statement can revoke a prior value even when its new meaning is not accepted.
      latestUserFactIndex.set(fact.key, evidence.index);
      // An existing substring is necessary but not enough: its meaning must match a registered answer.
      if (matchedValue(itemId, fact.key, evidence.text) === fact.value && matchedValue(itemId, fact.key, fact.evidence.quote!) === fact.value) {
        facts[fact.key] = fact.value;
        confirmed.add(fact.key);
      }
    }
  }
  for (const evidence of output.unable) {
    if (!Object.hasOwn(FACT_REGISTRY[itemId], evidence.key)) throw invalid();
    const verified = verifyQuote(evidence, messages);
    const resolvedLater = messages.slice(verified.index + 1).some(message => message.role === "user" && matchedValue(itemId, evidence.key, message.text));
    if (verified.index >= scope.start && !resolvedLater && inability.test(evidence.quote!) && inability.test(verified.text)) unable.add(evidence.key);
  }
  // Fold user statements in time order. An unresolved correction revokes prior confirmations;
  // no later pass may re-inject earlier answers, including claims previously accepted from the model.
  for (const [index, message] of messages.entries()) {
    if (index < scope.start || message.role !== "user") continue;
    for (const [key, evidenceIndex] of latestUserFactIndex) {
      if (index === evidenceIndex) { delete facts[key]; confirmed.delete(key); }
    }
    const parsedFacts = parseUserFacts(itemId, message.text);
    if (parsedFacts === null || correction.test(message.text)) {
      for (const key of Object.keys(facts)) delete facts[key];
      confirmed.clear();
    }
    for (const [key, value] of Object.entries(parsedFacts ?? {})) {
      if (index < (latestUserFactIndex.get(key) ?? scope.start)) continue;
      facts[key] = value; confirmed.add(key);
    }
  }
  if (cannotContinue) return fixedResponse(requestId, "insufficient", itemId);
  const resolution = resolveRules(itemId, facts, { confirmedFactKeys: [...confirmed], unableToAnswer: [...unable] });
  return { requestId, item: { id: itemId, label: ITEMS[itemId] }, ...resolution };
}

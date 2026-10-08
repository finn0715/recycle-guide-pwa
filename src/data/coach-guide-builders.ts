import type { Choice, Destination, Step } from "@/lib/contracts/coach";
import { COACH_ADDITIONAL_RULES, RULES } from "./disposal-rules";

// Disposal conditions are projected from the shared reviewed rules, never copied into a second answer catalog.
export const rules = [...RULES, ...COACH_ADDITIONAL_RULES].map(({ id, region, reviewStatus, conditions, sourceIds }) => ({ id, region, reviewStatus, conditions, sourceIds }));
export const sourcesFor = (ruleIds: string[]) => [...new Set(ruleIds.flatMap(id => {
  const rule = rules.find(r => r.id === id);
  if (!rule) throw new Error(`없는 검수 규칙: ${id}`);
  return rule.sourceIds;
}))];
export const choice = (id: string, label: string, nextStepId: string | null, factPatch: Record<string, string> = {}): Choice => ({ id, label, nextStepId, factPatch });
export const fact = (...values: string[]) => ({ values: [...values, "unknown"], evidence: "user_only" as const });
function shortStepSpeech(id: string, kind: Step["kind"], text: string) {
  const specific: Record<string, string> = {
    "can-pressure-hold": "가스·스프레이 용기는 따로 확인해야 해요. 뚫거나 가열하지 말고 송파구 담당 부서에 확인해 주세요.",
    "can-accessory-hold": "다른 재질 부품의 배출 방법을 확인해야 해요. 억지로 떼지 말고 재질 표시를 확인해 주세요.",
    "recovery-ambiguous-hold": "재질과 용도를 충분히 알 수 없어요. 표시가 보이는 사진이나 설명으로 새로 확인해 주세요.",
    "recovery-out-of-scope-hold": "배터리·전자제품·대형·위험물은 일반 포장재로 안내하지 않아요. 송파구의 해당 수거 경로를 확인해 주세요.",
    "recovery-source-conflict-hold": "공식 기준이 서로 달라 보류해요. 송파구 담당 부서의 현행 기준을 확인해 주세요.",
    "recovery-unverified-hold": "재질·성분의 근거가 부족해요. 표시를 확인하고 송파구 담당 부서에 문의해 주세요.",
    "pump-type": "표시나 보이는 구조로 금속 스프링이 있는지 확인해 주세요. 확인하려고 펌프를 부수지 마세요.",
  };
  if (specific[id]) return specific[id];
  if (kind === "handoff") return "확인되지 않거나 준비하기 어려운 부분이 있어요. 지금 멈추고 표시와 사진으로 송파구 담당 부서에 확인해 주세요.";
  if (kind === "complete") return "준비한 부품을 아래처럼 나눠 배출해 주세요.";
  return text;
}
export function step(id: string, kind: Step["kind"], text: string, action: Step["visual"]["action"], targetRoles: string[], choices: Choice[], ruleIds: string[], reason: string, destinations: Destination[] = []): Step {
  return { id, kind, text, speechText: shortStepSpeech(id, kind, text), visual: { action, assetId: null }, targetRoles, choices, ruleIds, sourceIds: sourcesFor(ruleIds), reason, replyIds: [], destinations };
}
export function destination(id: string, role: string, bin: Destination["bin"], label: string, ruleIds: string[], next: string): Step {
  return step(id, "destination", "이 부품을 아래 안내에 맞춰 따로 모아 주세요.", "sort", [role], [choice("done", "준비했어요", next)], ruleIds, "앞에서 직접 확인한 조건과 준비 행동이 모두 맞는 부품에만 이 분류를 적용해요.", [{ partRole: role, bin, label, ruleIds, sourceIds: sourcesFor(ruleIds) }]);
}
export function hold(id: string, roles: string[], ruleIds: string[], reason: string): Step {
  const text = `${reason} 표시나 사진을 준비해 송파구 재활용팀(02-2147-6377~6379)에 확인해 주세요.`;
  return step(id, "handoff", text, "hold", roles, [choice("close", "확인 후 다시 시작할게요", null)], ruleIds, reason, roles.map(partRole => ({ partRole, bin: "hold", label: "공식 확인 전 보류", ruleIds, sourceIds: sourcesFor(ruleIds) })));
}
export function complete(id: string, ruleIds: string[]): Step {
  return step(id, "complete", "준비한 부품을 아래처럼 나눠 배출해 주세요.", "sort", ["body"], [choice("finish", "이 물건 안내 마치기", null)], ruleIds, "완료는 지금까지의 사용자 준비 완료 응답을 뜻해요.");
}
export function actionChoices(next: string, holdId: string, patch: Record<string, string>, absentNext = holdId, absentPatch: Record<string, string> = {}) {
  return [choice("done", "했어요", next, patch), choice("cannot", "안돼요", holdId), choice("absent", absentNext === holdId ? "없어요" : "contents" in absentPatch ? "남은 내용물이 없어요" : "이물질이 없어요", absentNext, absentPatch), choice("unknown", "모르겠어요", holdId)];
}

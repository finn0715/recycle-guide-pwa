import { GuideCatalogSchema, type GuideCatalog, type GuideFlow, type Reply, type Step } from "@/lib/contracts/coach";
import { SOURCES } from "./disposal-rules";
import { rules, sourcesFor, choice, fact, step, destination, hold, complete, actionChoices } from "./coach-guide-builders";
import { householdFlows, householdCategories, householdFailureReplies } from "./coach-household-guides";

const canRule = ["can-food-beverage-clean"];
const canFlow: GuideFlow = {
  id: "metal-can", categoryId: "metal_can", startStepId: "can-kind",
  facts: { can_kind: fact("aluminum_beverage", "steel_food", "pressure"), contents: fact("empty"), can_accessories: fact("none"), clean: fact("yes") },
  steps: [
    step("can-kind", "confirm", "이 캔의 재질과 용도를 확인해 주세요. 음료용 알루미늄 캔 또는 식품용 철 캔인가요?", "inspect", ["body"], [choice("aluminum", "알루미늄 음료캔이에요", "can-accessories", { can_kind: "aluminum_beverage" }), choice("steel", "철 식품캔이에요", "can-accessories", { can_kind: "steel_food" }), choice("gas", "스프레이·가스 용기예요", "can-pressure-hold", { can_kind: "pressure" }), choice("unknown", "모르겠어요", "can-hold")], canRule, "일반 음료·식품 캔과 가스·스프레이 용기는 송파구 원문에서 서로 다른 항목이에요."),
    step("can-accessories", "question", "플라스틱 덮개처럼 캔과 다른 재질의 부품이 붙어 있나요?", "inspect", ["body", "lid"], [choice("none", "없어요", "can-empty", { can_accessories: "none" }), choice("present", "다른 재질 부품이 있어요", "can-accessory-hold"), choice("unknown", "모르겠어요", "can-hold")], canRule, "다른 재질 부품은 제거해야 하며, 그 부품의 재질별 배출 방법도 확인해야 해요."),
    step("can-empty", "action", "내용물을 원래 용도로 다 사용해 빈 상태로 준비해 주세요. 남은 내용물의 처리 방법을 모르면 멈춰 주세요.", "empty", ["body"], actionChoices("can-rinse", "can-hold", { contents: "empty" }, "can-rinse", { contents: "empty" }), canRule, "송파구 기준은 내용물을 비운 캔에 적용해요. 사진으로 내부가 비었다고 단정하지 않아요."),
    step("can-rinse", "action", "빈 캔을 물로 헹궈 남은 이물질을 없애 주세요. 날카로운 절단면을 손으로 만지지 마세요.", "rinse", ["body"], actionChoices("can-bin", "can-hold", { clean: "yes" }, "can-bin", { clean: "yes" }), canRule, "이물질이 없는 금속캔에만 금속캔 배출 기준을 적용해요."),
    destination("can-bin", "body", "metal", "금속캔류", canRule, "can-complete"),
    complete("can-complete", canRule),
    hold("can-hold", ["body"], canRule, "용도·재질·비움·세척 중 확인되지 않은 조건이 있어요. 추측으로 금속캔 수거함을 확정할 수 없어요."),
    hold("can-accessory-hold", ["body", "lid"], canRule, "다른 재질 부품의 배출 기준이 아직 확인되지 않았어요. 부품을 억지로 떼지 말고 재질 표시를 확인해 주세요."),
    hold("can-pressure-hold", ["body"], ["pressure-can-separate-check"], "가스·스프레이 용기는 일반 음료캔 안내를 적용하지 않아요. 남은 가스와 내용물에 맞는 안전한 처리를 따로 확인해야 해요. 구멍을 뚫거나 가열하지 마세요."),
  ],
};
const pumpBodyRule = ["pump-plastic-empty"];
const pumpPartRule = ["pump-composite-part"];
const pumpLabelRule = ["pump-film-label"];
const pumpFlow: GuideFlow = {
  id: "pump-bottle", categoryId: "pump_bottle", startStepId: "pump-material",
  facts: { material: fact("plastic"), contents: fact("empty"), pump: fact("composite", "none"), label: fact("film", "none"), clean: fact("yes"), pump_removed: fact("yes"), label_removed: fact("yes"), label_clean: fact("yes") },
  steps: [
    step("pump-material", "confirm", "샴푸·린스 등 세정용 제품의 플라스틱 용기인지 재질 표시와 용도를 확인해 주세요.", "inspect", ["body"], [choice("plastic", "플라스틱 세정용기예요", "pump-type", { material: "plastic" }), choice("other", "다른 재질·용도예요", "pump-hold"), choice("unknown", "모르겠어요", "pump-hold")], pumpBodyRule, "상품명보다 본체 재질과 용도를 확인해야 해요. 금속·유리 등 다른 재질에 이 규칙을 적용하지 않아요."),
    step("pump-type", "question", "펌프에 금속 스프링이 섞여 있나요? 표시나 이미 보이는 구조로 확인해 주세요. 확인하려고 펌프를 부수지 마세요.", "inspect", ["pump"], [choice("composite", "금속 스프링이 있는 복합 펌프예요", "pump-detach", { pump: "composite" }), choice("none", "펌프가 없어요", "pump-label-type", { pump: "none" }), choice("other", "다른 구조예요", "pump-hold"), choice("unknown", "모르겠어요", "pump-hold")], pumpPartRule, "금속 스프링이 섞인 복합 펌프만 일반쓰레기 규칙을 적용해요. 단일재질 펌프를 같은 것으로 보지 않아요."),
    step("pump-detach", "action", "펌프를 본체에서 손으로 부드럽게 돌려 분리해 주세요. 잘 풀리지 않으면 멈춰 주세요.", "detach", ["pump", "body"], actionChoices("pump-part-bin", "pump-hold", { pump_removed: "yes" }), pumpPartRule, "금속과 플라스틱이 섞인 펌프는 플라스틱 본체와 따로 처리해야 해요."),
    destination("pump-part-bin", "pump", "general", "복합 펌프: 일반쓰레기 종량제봉투", pumpPartRule, "pump-label-type"),
    step("pump-label-type", "question", "본체의 라벨은 어떤 상태인가요?", "inspect", ["label"], [choice("film", "떼어낼 수 있는 비닐 라벨이에요", "pump-label-detach", { label: "film" }), choice("none", "라벨이 없어요", "pump-empty", { label: "none" }), choice("other", "다른 재질이거나 안 떨어져요", "pump-hold"), choice("unknown", "모르겠어요", "pump-hold")], pumpLabelRule, "비닐 라벨 규칙을 종이·복합 라벨에 확대하지 않아요."),
    step("pump-label-detach", "action", "비닐 라벨의 끝을 잡아 본체에서 떼어 주세요. 잘 안 떨어지면 멈춰 주세요.", "detach", ["label", "body"], actionChoices("pump-label-clean", "pump-hold", { label_removed: "yes" }), pumpLabelRule, "본체와 다른 재질인 비닐 라벨을 분리해야 해요."),
    step("pump-label-clean", "action", "분리한 비닐 라벨에 묻은 이물질을 없애 주세요.", "rinse", ["label"], actionChoices("pump-label-bin", "pump-hold", { label_clean: "yes" }, "pump-label-bin", { label_clean: "yes" }), pumpLabelRule, "이물질이 제거된 비닐을 흩날리지 않게 모아 배출해요."),
    destination("pump-label-bin", "label", "vinyl", "비닐 라벨: 비닐류", pumpLabelRule, "pump-empty"),
    step("pump-empty", "action", "내용물을 원래 용도로 다 사용해 본체를 비워 주세요. 남은 제품을 어떻게 처리할지 모르면 멈춰 주세요.", "empty", ["body"], actionChoices("pump-rinse", "pump-hold", { contents: "empty" }, "pump-rinse", { contents: "empty" }), pumpBodyRule, "빈 용기 처리 규칙으로 남은 샴푸의 처리 방법을 추정하지 않아요."),
    step("pump-rinse", "action", "빈 본체를 물로 헹궈 남은 이물질을 없애 주세요.", "rinse", ["body"], actionChoices("pump-body-bin", "pump-hold", { clean: "yes" }, "pump-body-bin", { clean: "yes" }), pumpBodyRule, "내용물과 이물질을 없앤 플라스틱 본체를 배출해요."),
    destination("pump-body-bin", "body", "plastic", "플라스틱 본체: 플라스틱류", pumpBodyRule, "pump-complete"),
    complete("pump-complete", pumpBodyRule),
    hold("pump-hold", ["body", "pump", "label"], pumpBodyRule, "분리·세척이 어려운 부품의 처리 방법을 더 확인해야 해요. 억지로 떼지 말고 해당 부품을 지금 상태로 두세요."),
  ],
};
const petBodyRule = ["pet-clear-empty"];
const petLabelRule = ["pet-film-label"];
const petCapRule = ["pet-reclose-cap"];
const petFlow: GuideFlow = {
  id: "clear-pet", categoryId: "clear_pet_bottle", startStepId: "pet-type",
  facts: { bottle_type: fact("clear_beverage"), contents: fact("empty"), label: fact("film", "none"), cap: { values: ["present", "absent", "unknown"], evidence: "visible" }, clean: fact("yes"), label_removed: fact("yes"), label_clean: fact("yes"), cap_closed: fact("yes") },
  steps: [
    step("pet-type", "confirm", "투명한 생수·음료용 PET병인가요? 표시와 원래 용도를 확인해 주세요.", "inspect", ["body"], [choice("yes", "투명 생수·음료용 PET병이에요", "pet-empty", { bottle_type: "clear_beverage" }), choice("other", "색이 있거나 다른 용도예요", "pet-hold"), choice("unknown", "모르겠어요", "pet-hold")], petBodyRule, "투명 생수·음료 PET 분류는 유색병·세정용기 등에 적용하지 않아요."),
    step("pet-empty", "action", "생수·음료를 다 사용해 내용물을 깨끗이 비워 주세요.", "empty", ["body"], actionChoices("pet-rinse", "pet-hold", { contents: "empty" }, "pet-rinse", { contents: "empty" }), petBodyRule, "원문은 내용물을 깨끗이 비운 투명 생수·음료병에 적용해요."),
    step("pet-rinse", "action", "빈 병에 남은 이물질을 없애 주세요.", "rinse", ["body"], actionChoices("pet-label-type", "pet-hold", { clean: "yes" }, "pet-label-type", { clean: "yes" }), petBodyRule, "내용물이 깨끗이 비워진 상태를 직접 확인해 주세요."),
    step("pet-label-type", "question", "라벨은 어떤 상태인가요?", "inspect", ["label"], [choice("film", "떼어낼 수 있는 비닐 라벨이에요", "pet-label-detach", { label: "film" }), choice("none", "라벨이 없어요", "pet-cap", { label: "none" }), choice("other", "다른 재질이거나 안 떨어져요", "pet-hold"), choice("unknown", "모르겠어요", "pet-hold")], petLabelRule, "비닐 라벨은 본체에서 분리해요. 다른 재질은 별도 확인이 필요해요."),
    step("pet-label-detach", "action", "비닐 라벨의 끝을 잡아 병에서 떼어 주세요. 잘 안 떨어지면 멈춰 주세요.", "detach", ["label", "body"], actionChoices("pet-label-clean", "pet-hold", { label_removed: "yes" }), petLabelRule, "투명 PET병은 라벨을 제거한 뒤 따로 배출해요."),
    step("pet-label-clean", "action", "떼어 낸 비닐 라벨의 이물질을 없애 주세요.", "rinse", ["label"], actionChoices("pet-label-bin", "pet-hold", { label_clean: "yes" }, "pet-label-bin", { label_clean: "yes" }), petLabelRule, "깨끗한 비닐은 흩날리지 않게 모아 배출해요."),
    destination("pet-label-bin", "label", "vinyl", "비닐 라벨: 비닐류", petLabelRule, "pet-cap"),
    step("pet-cap", "question", "다시 닫을 수 있는 원래 뚜껑이 있나요?", "inspect", ["cap"], [choice("present", "뚜껑이 있어요", "pet-flatten-cap", { cap: "present" }), choice("absent", "뚜껑이 없어요", "pet-flatten-open", { cap: "absent" }), choice("unknown", "모르겠어요", "pet-hold")], petCapRule, "뚜껑이 있으면 압착 후 다시 닫아서 본체와 함께 배출해요. 뚜껑을 새로 구할 필요는 없어요."),
    step("pet-flatten-cap", "action", "뚜껑을 열어 둔 병을 손으로 가능한 만큼만 눌러 주세요. 힘을 더 줘야 하면 멈춰도 돼요.", "flatten", ["body"], [choice("done", "했어요", "pet-cap-close"), choice("cannot", "안돼요", "pet-cap-close"), choice("absent", "누를 부분이 없어요", "pet-cap-close"), choice("unknown", "모르겠어요", "pet-hold")], petBodyRule, "송파구 원문은 가능한 압착이라고 안내해요. 눌리지 않으면 강제로 누르지 않고 다음 준비를 해요."),
    step("pet-cap-close", "action", "원래 뚜껑을 병에 다시 닫아 주세요.", "sort", ["cap", "body"], actionChoices("pet-cap-bin", "pet-hold", { cap_closed: "yes" }), petCapRule, "송파구는 투명 PET병의 뚜껑을 닫아 함께 배출하도록 안내해요."),
    destination("pet-cap-bin", "cap", "clear_pet", "뚜껑: 투명 PET병 본체에 닫아 함께 배출", petCapRule, "pet-body-bin"),
    step("pet-flatten-open", "action", "빈 병을 손으로 가능한 만큼만 눌러 주세요. 힘을 더 줘야 하면 멈춰도 돼요.", "flatten", ["body"], [choice("done", "했어요", "pet-body-bin"), choice("cannot", "안돼요", "pet-body-bin"), choice("absent", "누를 부분이 없어요", "pet-body-bin"), choice("unknown", "모르겠어요", "pet-hold")], petBodyRule, "가능한 범위의 압착만 안내하므로 눌리지 않으면 강제로 누르지 않아요."),
    destination("pet-body-bin", "body", "clear_pet", "투명 생수·음료 PET병 전용 수거함", petBodyRule, "pet-complete"),
    complete("pet-complete", petBodyRule),
    hold("pet-hold", ["body", "label", "cap"], petBodyRule, "용도나 부품이 확인되지 않았거나 준비하기 어려운 부분이 있어요. 해당 부품을 지금 상태로 두세요."),
  ],
};
function recovery(id: string, reason: string, ruleIds = ["material-scope-check"]): GuideFlow {
  return { id, categoryId: null, startStepId: `${id}-hold`, facts: {}, steps: [hold(`${id}-hold`, ["body"], ruleIds, reason)] };
}
const flows = [canFlow, pumpFlow, petFlow, ...householdFlows,
  recovery("recovery-ambiguous", "물건의 재질·용도·부품을 충분히 확인하지 못했어요. 상품명이 처음 보인다는 이유만으로 제외하지 않아요. 표시가 보이는 사진을 추가하거나 재질과 용도를 적어 새로 확인해 주세요."),
  recovery("recovery-out-of-scope", "배터리·전자제품·대형폐기물·위험물은 일반 포장재 수거함으로 안내하지 않아요. 현재 물건에 적용할 검수 근거가 없어 해당 품목의 송파구 공식 수거 경로 확인이 필요해요."),
  recovery("recovery-source-conflict", "공식 자료의 적용 조건이 서로 달라 배출 방법을 확정하지 못했어요. 식품용 EPS의 기존 자료 충돌은 계속 보류하며 담당 부서의 현행 조건 확인이 필요해요.", ["foam-packaging-clean"]),
  recovery("recovery-unverified", "재질·성분 또는 부품의 배출 기준이 검수되지 않았어요. 성분을 모르는 아이스팩을 물이나 젤로 추정하지 않아요. 표시와 용도를 확인한 뒤에도 근거가 없으면 담당 부서에 확인해 주세요.", ["ice-water-film", "ice-gel-intact"]),
];
// Replies offer explanations and choices; they never apply a fact patch or advance a step.
const replies: Reply[] = [];
function addReply(id: string, steps: Step[], text: string, speechText: string, choiceIds: string[], ruleIds = steps[0].ruleIds) {
  for (const step of steps) step.replyIds.push(id);
  replies.push({ id, allowedStepIds: steps.map(step => step.id), text, speechText, choiceIds, ruleIds, sourceIds: sourcesFor(ruleIds) });
}
const emptyFailure = {
  text: "남은 내용물의 처리 방법은 이 빈 용기 안내로 정할 수 없어요. 지금 멈추고 '안돼요'를 눌러 보류해 주세요.",
  speechText: "남은 내용물의 처리 방법은 별도 확인이 필요해요. 지금 멈추고 안돼요를 눌러 주세요.",
};
const rinseFailure = {
  text: "씻어도 이물질이 남으면 지금 기준으로 배출 방법을 확정할 수 없어요. '안돼요'를 눌러 보류해 주세요.",
  speechText: "이물질을 없애기 어려우면 배출 방법을 더 확인해야 해요. 안돼요를 눌러 주세요.",
};
const labelFailure = {
  text: "라벨이 안 떨어지면 억지로 떼지 마세요. 이 상태의 처리 방법은 아직 확인되지 않았어요. '안돼요'를 눌러 보류해 주세요.",
  speechText: "안 떨어지는 라벨은 억지로 떼지 마세요. 처리 방법을 더 확인하도록 안돼요를 눌러 주세요.",
};
const failureReplies: Record<string, {text: string; speechText: string}> = {
  ...householdFailureReplies,
  "can-empty": emptyFailure, "pump-empty": emptyFailure, "pet-empty": emptyFailure,
  "can-rinse": rinseFailure, "pump-rinse": rinseFailure, "pet-rinse": rinseFailure,
  "pump-label-clean": rinseFailure, "pet-label-clean": rinseFailure,
  "pump-label-detach": labelFailure, "pet-label-detach": labelFailure,
  "pump-detach": {
    text: "펌프가 안 빠지면 힘을 더 주지 말고 멈춰 주세요. 확인된 다른 분리 방법이 없어 보류가 필요해요. '안돼요'를 눌러 주세요.",
    speechText: "안 빠지는 펌프는 억지로 분리하지 마세요. 확인된 대안이 없으니 안돼요를 눌러 보류해 주세요.",
  },
  "pet-flatten-cap": {
    text: "송파구는 가능한 만큼 압착하도록 안내해요. 더 세게 누르지 않아도 돼요. '안돼요'를 누르면 원래 뚜껑을 닫는 단계로 갈 수 있어요.",
    speechText: "가능한 만큼만 누르면 돼요. 더 누르지 말고 안돼요를 선택해 뚜껑을 닫는 단계로 가세요.",
  },
  "pet-flatten-open": {
    text: "송파구는 가능한 만큼 압착하도록 안내해요. 더 세게 누르지 않아도 돼요. '안돼요'를 눌러 뚜껑 없는 병의 배출 준비를 확인해 주세요.",
    speechText: "가능한 만큼만 누르면 돼요. 더 누르지 말고 안돼요를 선택해 배출 준비를 확인해 주세요.",
  },
  "pet-cap-close": {
    text: "원래 뚜껑이 닫히지 않으면 준비 완료로 표시할 수 없어요. 억지로 조이지 말고 '안돼요'를 눌러 보류해 주세요.",
    speechText: "뚜껑이 닫히지 않으면 억지로 조이지 마세요. 안돼요를 눌러 별도로 확인해 주세요.",
  },
};
for (const flow of flows) {
  for (const step of flow.steps) {
    // Existing IDs remain available. How-to answers describe the action without repeating its rationale.
    const defaultChoices = step.kind === "action" ? ["done", "cannot"] : step.choices.map(choice => choice.id);
    addReply(`${step.id}-help`, [step], step.kind === "handoff" ? step.speechText : step.text, step.speechText, defaultChoices);
    if (["confirm", "question", "action"].includes(step.kind)) addReply(`${step.id}-why`, [step], step.reason, step.reason, []);
    const failure = failureReplies[step.id];
    if (failure) addReply(`${step.id}-cannot`, [step], failure.text, failure.speechText, ["cannot"]);
  }
  if (flow.categoryId !== null) {
    addReply(`${flow.id}-scope-help`, flow.steps,
      "이 도움은 지금 선택한 물건의 분리배출 단계만 설명해요. 다른 물건은 사진이나 설명으로 새로 확인해 주세요. 이 질문으로 현재 선택이 바뀌지는 않아요.",
      "지금 선택한 물건의 단계만 설명할 수 있어요. 다른 물건은 새로 확인해 주세요. 현재 선택은 바뀌지 않아요.",
      [], ["material-scope-check"]);
  }
}
const findStep = (id: string) => {
  const result = flows.flatMap(flow => flow.steps).find(step => step.id === id);
  if (!result) throw new Error(`없는 도움 대상 단계: ${id}`);
  return result;
};
addReply("pump-type-unknown", [findStep("pump-type")],
  "겉모습만으로 내부 스프링을 단정할 수 없어요. 표시나 이미 보이는 구조로 확인되지 않으면 분해하지 말고 '모르겠어요'를 눌러 주세요.",
  "스프링을 확인하려고 분해하지 마세요. 표시나 보이는 구조로 확인하기 어렵다면 모르겠어요를 눌러 주세요.", ["unknown"]);
addReply("can-kind-pressure", [findStep("can-kind")],
  "부탄가스·살충제·스프레이 용기라면 일반 음료캔과 처리 조건이 달라요. '스프레이·가스 용기예요'를 눌러 따로 확인해 주세요. 뚫거나 가열하지 마세요.",
  "가스·스프레이는 일반 음료캔과 달라요. 뚫거나 가열하지 말고 스프레이·가스 용기예요를 눌러 주세요.", ["gas"], ["pressure-can-separate-check"]);
addReply("pet-cap-absent", [findStep("pet-cap")],
  "원래 뚜껑이 없으면 새 뚜껑을 구할 필요는 없어요. '뚜껑이 없어요'를 직접 눌러 지금 상태를 알려 주세요.",
  "원래 뚜껑이 없으면 새로 구하지 않아도 돼요. 뚜껑이 없어요를 직접 눌러 주세요.", ["absent"]);
addReply("carton-bin-no-bin", [findStep("carton-bin")],
  "종이팩 전용수거함이 없으면 일반 종이와 구분되도록 묶어 종이류 수거함에 배출할 수 있어요. 일반팩과 멸균팩은 각각 모아 주세요.",
  "전용수거함이 없으면 일반 종이와 구분되도록 묶어 종이류 수거함에 두세요. 일반팩과 멸균팩은 각각 모아 주세요.", ["done"]);
export const COACH_CATALOG: GuideCatalog = GuideCatalogSchema.parse({
  version: "songpa-coach-2026-10-08-v3",
  categories: [
    ...householdCategories,
    { id: "metal_can", label: "음료·식품 금속캔", description: "알루미늄 음료캔·철 식품캔. 가스·스프레이 용기는 별도 확인", roles: ["body", "lid"] },
    { id: "pump_bottle", label: "플라스틱 펌프 용기", description: "플라스틱 세정용 본체와 복합 펌프·비닐 라벨을 각각 확인", roles: ["body", "pump", "label"] },
    { id: "clear_pet_bottle", label: "투명 생수·음료 PET병", description: "투명 음료용 PET 본체와 라벨·뚜껑을 각각 확인", roles: ["body", "label", "cap"] },
  ], flows, rules,
  sources: SOURCES.map(({ id, title, publisher, url, section, scope, checkedAt, publishedAt, updatedAt }) => ({ id, title, publisher, url, section, scope, checkedAt, publishedAt, updatedAt })),
  replies,
});

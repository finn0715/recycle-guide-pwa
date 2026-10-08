import type { Guidance, ItemId, Source } from "@/lib/contracts";
import { FACT_REGISTRY } from "./facts";

export type OfficialSource = Source & {
  publisher: string;
  section: string;
  publishedAt: string | null;
  updatedAt: string | null;
  scope: "songpa" | "national";
  verification: "official_body_checked";
};
const checkedAt = "2026-10-01";
const songpaUrl = "https://www.songpa.go.kr/www/contents.do?key=3164";
function songpa(id: string, section: string): OfficialSource {
  return { id, publisher: "송파구청", title: `송파구청 재활용품 분리배출 방법 · ${section}`, url: songpaUrl, section, checkedAt: "2026-10-08", publishedAt: null, updatedAt: "2026-08-26", scope: "songpa", verification: "official_body_checked" };
}
function dictionary(id: string, name: string, index: number): OfficialSource {
  return { id, publisher: "분리의 정석 (운영: 한국폐기물협회)", title: `분리의 정석 품목사전 · ${name}`, url: `https://xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=${index}`, section: `${name} / 배출방법·특징·유의사항`, checkedAt: ["national-rinse", "national-shampoo", "national-straw", "national-film", "national-toothbrush", "national-ice-water", "national-ice-gel"].includes(id) ? "2026-10-08" : checkedAt, publishedAt: null, updatedAt: null, scope: "national", verification: "official_body_checked" };
}
const songpaGuideUrl = "https://www.songpa.go.kr/previewContents.do?atchmnflNo=158114&ems=1fef9fcbf324d25916321108a416213ab3c302e400b4849e8373d46e64841540";
function songpaGuide(id: string, section: string): OfficialSource {
  return { id, publisher: "송파구청", title: `송파구청 올바른 재활용품 분리배출 안내서 · ${section}`, url: songpaGuideUrl, section, checkedAt: "2026-10-08", publishedAt: null, updatedAt: null, scope: "songpa", verification: "official_body_checked" };
}
export const SOURCES: OfficialSource[] = [
  songpa("songpa-pet", "투명(음료·생수) 페트병"),
  songpa("songpa-plastic", "합성수지 용기·트레이류"),
  songpa("songpa-carton", "종이팩"),
  songpa("songpa-paper", "종이류·상자류"),
  songpa("songpa-foam", "스티로폼 완충재"),
  songpa("songpa-film", "비닐포장재·1회용비닐봉투"),
  songpa("songpa-glass", "유리병"),
  songpa("songpa-metal", "고철류"),
  songpa("songpa-can", "금속캔 / 음료·주류캔, 식료품캔"),
  songpa("songpa-battery", "폐전지류·리튬이차전지 / 전용수거함·동주민센터"),
  songpa("songpa-contact", "재질별 제외품목·잔여 위험 내용물 / 담당부서 연락처"),
  { id: "songpa-electronic", publisher: "송파구청", title: "송파구청 · 폐소형·대형 가전제품 무상수거", url: "https://www.songpa.go.kr/www/contents.do?key=3171", section: "소형가전 지역별 수거·대형가전 예약", checkedAt: "2026-10-08", publishedAt: null, updatedAt: "2025-09-22", scope: "songpa", verification: "official_body_checked" },
  { id: "songpa-bulky", publisher: "송파구청", title: "송파구청 · 대형생활폐기물 배출", url: "https://www.songpa.go.kr/www/contents.do?key=2117", section: "배출신청·동별 수거업체·유의사항", checkedAt: "2026-10-08", publishedAt: null, updatedAt: "2026-08-26", scope: "songpa", verification: "official_body_checked" },
  songpa("songpa-pressure-can", "기타캔류 / 부탄가스·살충제·스프레이 용기"),
  songpaGuide("songpa-guide-paper", "8쪽 종이류·상자류 / 반듯하게 펴서 쌓기"),
  songpaGuide("songpa-guide-accessories", "12쪽 재활용이 안 되는 일반쓰레기 / 스티커·운송장·테이프"),
  songpaGuide("songpa-guide-foam", "10쪽 흰색 스티로폼 박스·완충재 / 식품 포장용 제외"),
  songpaGuide("songpa-guide-plastic-lid", "9쪽 투명 용기·뚜껑은 플라스틱 / 10쪽 플라스틱류"),
  dictionary("national-straw", "빨대", 384),
  dictionary("national-film", "비닐", 532),
  dictionary("national-shampoo", "샴푸", 590),
  dictionary("national-rinse", "린스", 591),
  dictionary("national-snack", "과자봉지", 97),
  dictionary("national-toothbrush", "칫솔", 334),
  dictionary("national-ice-water", "물 아이스팩", 779),
  dictionary("national-ice-gel", "젤 아이스팩", 179),
  { id: "national-mixed-pump", publisher: "기후에너지환경부", title: "기후에너지환경부 · 종량제 봉투로 가야 할 쓰레기 6가지", url: "https://mcee.go.kr/home/web/board/read.do?boardId=1400740&boardMasterId=713&menuId=10392", section: "카드뉴스 펌프 용기·음식물이 담긴 용기 이미지 대체텍스트", checkedAt: "2026-10-08", publishedAt: "2020-09-25", updatedAt: null, scope: "national", verification: "official_body_checked" },
  { id: "songpa-food", publisher: "송파구청", title: "송파구청 · 음식물쓰레기 배출요령", url: "https://www.songpa.go.kr/www/contents.do?key=3161", section: "음식물쓰레기 배출요령·음식물쓰레기가 아닌 식품류·유의사항", checkedAt, publishedAt: null, updatedAt: "2026-02-19", scope: "songpa", verification: "official_body_checked" },
  { id: "songpa-ice", publisher: "송파구청 · 송파TV", title: "송파TV · 2022년 12월 5일 주간뉴스 아이스팩 안내", url: "https://www.songpa.go.kr/tv/songpaTvList.do?categoryNo=21&key=3496&songpatvNo=6216", section: "젤 타입 종량제봉투 / 물 타입 내용물과 포장재 분리", checkedAt: "2026-10-08", publishedAt: "2022-12-02", updatedAt: null, scope: "songpa", verification: "official_body_checked" },
];

export type DisposalRule = {
  id: string;
  item: ItemId;
  region: "songpa";
  kind: "base" | "part";
  conditions: Record<string, string[]>;
  facts: string[];
  questions: string[];
  steps: string[];
  parts: Guidance["parts"];
  cautions: string[];
  sourceIds: string[];
  reviewStatus: "reviewed";
};
function part(name: string, disposal: string, actions: string[], sourceIds: string[]): Guidance["parts"][number] {
  return { name, disposal, actions, sourceIds };
}
function rule(id: string, item: ItemId, conditions: Record<string, string[]>, steps: string[], parts: Guidance["parts"], sourceIds: string[], cautions: string[] = [], kind: "base" | "part" = "base"): DisposalRule {
  const facts = Object.keys(conditions);
  return { id, item, region: "songpa", kind, conditions, facts, questions: facts.map((key) => FACT_REGISTRY[item][key].question.text), steps, parts, sourceIds, cautions, reviewStatus: "reviewed" };
}
const plasticSteps = ["내용물과 이물질을 없앤 뒤 용기를 물로 헹궈 주세요.", "본체와 다른 재질의 상표·부속품을 떼고 플라스틱류로 배출해 주세요."];
const plasticPart = part("용기", "플라스틱류", plasticSteps, ["songpa-plastic"]);
const cartonAccessories = ["none", "clean_pp_straw", "clean_film", "clean_pp_straw_and_film"];
const boxAttachments = ["none", "tape", "shipping_label", "tape_and_label"];
const takeawayCovers = ["none", "clean_film", "clean_plastic_lid", "clean_lid_and_film"];
function boxPartRules(item: "cardboard_box" | "foam_box"): DisposalRule[] {
  return [
    rule(`${item}-tape`, item, { attachments: ["tape", "tape_and_label"] }, ["분리한 포장 테이프는 일반쓰레기 종량제봉투에 넣어 주세요."], [part("포장 테이프", "일반쓰레기 종량제봉투", ["상자에서 떼어 주세요."], ["songpa-guide-accessories"])], ["songpa-guide-accessories"], [], "part"),
    rule(`${item}-shipping-label`, item, { attachments: ["shipping_label", "tape_and_label"] }, ["분리한 접착식 택배 송장은 일반쓰레기 종량제봉투에 넣어 주세요."], [part("택배 송장", "일반쓰레기 종량제봉투", ["상자에서 떼어 주세요."], ["songpa-guide-accessories"])], ["songpa-guide-accessories"], [], "part"),
  ];
}

/** Author-reviewed data: model output must never be added to steps or parts. */
export const RULES: DisposalRule[] = [
  rule("pump-plastic-empty", "pump_bottle", { material: ["plastic"], contents: ["empty"], pump: ["composite", "none"], label: ["film", "none"] }, ["남은 이물질을 헹궈 없애고 펌프와 라벨을 분리해 주세요.", "용기 본체는 플라스틱류로 배출해 주세요."], [part("용기", "플라스틱류", ["이물질을 헹구고 펌프·라벨을 분리해 주세요."], ["songpa-plastic", "national-shampoo", "national-rinse"])], ["songpa-plastic", "national-shampoo", "national-rinse"]),
  rule("pump-composite-part", "pump_bottle", { pump: ["composite"] }, ["금속 스프링이 섞인 펌프는 일반쓰레기 종량제봉투에 넣어 주세요."], [part("복합재질 펌프", "일반쓰레기 종량제봉투", ["본체에서 분리해 주세요."], ["national-mixed-pump", "national-rinse"])], ["national-mixed-pump", "national-rinse"], [], "part"),
  rule("pump-film-label", "pump_bottle", { label: ["film"] }, ["떼어 낸 비닐 라벨은 이물질을 제거해 비닐류로 모아 주세요."], [part("비닐 라벨", "비닐류", ["이물질을 없애고 흩날리지 않게 모아 주세요."], ["national-rinse", "songpa-film"])], ["national-rinse", "songpa-film"], [], "part"),
  rule("pet-clear-empty", "clear_pet_bottle", { bottle_type: ["clear_beverage"], contents: ["empty"], label: ["film", "none"], cap: ["present", "absent"] }, ["내용물을 깨끗이 비우고 라벨을 제거해 주세요.", "가능한 만큼 압착한 뒤 투명 생수·음료 페트병으로 따로 배출해 주세요."], [part("투명 페트병", "투명 생수·음료 페트병", ["라벨을 떼고 가능한 만큼 압착해 주세요."], ["songpa-pet"])], ["songpa-pet"], ["생수·음료용 투명 페트병에 적용합니다. 세정제 병·유색 페트병은 이 분류에 넣지 않아요."]),
  rule("pet-reclose-cap", "clear_pet_bottle", { cap: ["present"] }, ["압착한 병의 뚜껑을 다시 닫아서 함께 배출해 주세요."], [part("뚜껑", "페트병 본체에 다시 닫아 함께 배출", ["압착한 뒤 닫아 주세요."], ["songpa-pet"])], ["songpa-pet"], [], "part"),
  rule("pet-film-label", "clear_pet_bottle", { label: ["film"] }, ["분리한 비닐 라벨은 이물질을 제거해 비닐류로 모아 주세요."], [part("비닐 라벨", "비닐류", ["이물질을 없애고 흩날리지 않게 모아 주세요."], ["songpa-film"])], ["songpa-film"], [], "part"),
  rule("carton-empty-separated", "drink_carton", { carton_type: ["regular", "aseptic"], contents: ["empty"], accessories: cartonAccessories }, ["팩을 헹군 뒤 말리고 빨대·비닐 등 다른 재질은 떼어 주세요.", "우유팩과 멸균팩을 서로 나누어 종이팩 전용수거함에 넣어 주세요.", "일반 종이와 섞지 마세요. 전용수거함이 없으면 종류별로 따로 묶어 구분되게 종이류 수거함에 배출해 주세요."], [part("우유·두유팩", "종이팩류 (일반팩·멸균팩 구분)", ["헹구고 말려 일반 종이와 구분해 주세요."], ["songpa-carton"])], ["songpa-carton"]),
  rule("carton-pp-straw", "drink_carton", { accessories: ["clean_pp_straw", "clean_pp_straw_and_film"] }, ["깨끗한 단일 PP 빨대는 팩에서 분리해 플라스틱류로 배출해 주세요."], [part("PP 빨대", "플라스틱류", ["팩과 포장비닐에서 분리해 주세요."], ["national-straw"])], ["national-straw"], [], "part"),
  rule("carton-straw-wrapper", "drink_carton", { accessories: ["clean_film", "clean_pp_straw_and_film"] }, ["깨끗한 PP·PE 빨대 포장비닐은 비닐류로 모아 주세요."], [part("빨대 포장비닐", "비닐류", ["팩·빨대와 분리해 흩날리지 않게 모아 주세요."], ["songpa-film", "national-film"])], ["songpa-film", "national-film"], [], "part"),
  rule("cardboard-clean", "cardboard_box", { material: ["cardboard"], condition: ["clean_dry"], attachments: boxAttachments }, ["확인한 포장 테이프와 택배 송장을 떼어 주세요.", "상자를 젖지 않게 모은 뒤 종이류로 배출해 주세요."], [part("골판지 상자", "종이류", ["다른 재질을 제거하고 젖지 않게 모아 주세요."], ["songpa-paper", "songpa-guide-paper"])], ["songpa-paper", "songpa-guide-paper"]),
  ...boxPartRules("cardboard_box"),
  rule("foam-packaging-clean", "foam_box", { material: ["eps_packaging"], condition: ["empty_clean", "removable_residue"], color: ["white"], packaging_use: ["non_food"], attachments: boxAttachments }, ["빈 상자를 헹궈 이물질을 없애 주세요.", "테이프·스티커 등 다른 재질을 떼고 스티로폼류로 배출해 주세요."], [part("스티로폼 상자", "스티로폼류", ["이물질과 다른 재질을 제거해 주세요."], ["songpa-foam", "songpa-guide-foam"])], ["songpa-foam", "songpa-guide-foam"], ["코팅 없는 흰색 비식품 생활용품 배송 상자에만 적용해요. 식품 포장용은 송파 공식 자료의 기준이 달라 확정하지 않습니다."]),
  ...boxPartRules("foam_box"),
  rule("snack-film-clean", "snack_bag", { material: ["film"], condition: ["empty_clean"] }, ["비운 봉지의 이물질을 제거해 주세요.", "흩날리지 않도록 투명·반투명 봉투에 모아 비닐류로 배출해 주세요."], [part("과자 봉지", "비닐류", ["이물질을 없애고 모아서 배출해 주세요."], ["songpa-film", "national-snack"])], ["songpa-film", "national-snack"]),
  rule("takeaway-clean", "takeaway_container", { material: ["recyclable_plastic"], condition: ["empty_clean", "color_only", "removable_residue"], cover: takeawayCovers }, plasticSteps, [plasticPart], ["songpa-plastic"], ["착색만 남은 상태와 음식물이 붙어 있는 상태를 구분해 주세요. 이 안내는 이물질이 제거되는 용기에 적용해요."]),
  rule("takeaway-stuck-food", "takeaway_container", { material: ["recyclable_plastic"], condition: ["stuck_residue"], cover: takeawayCovers }, ["음식물 이물질이 씻어도 제거되지 않는 용기는 일반쓰레기 종량제봉투에 배출해 주세요."], [part("이물질이 제거되지 않는 용기", "일반쓰레기 종량제봉투", ["단순 착색이 아니라 붙어 있는 음식물이 제거되지 않는 경우에 적용해 주세요."], ["national-mixed-pump"])], ["national-mixed-pump"], ["용기 안에 별도로 덜어낼 음식이 남아 있으면 음식부터 확인해야 합니다."]),
  rule("takeaway-rice", "takeaway_container", { material: ["recyclable_plastic"], condition: ["food_remaining"], leftovers: ["plain_rice"], cover: takeawayCovers }, ["다른 재료 없이 남은 밥은 물기를 줄이고 비닐을 섞지 않아야 해요.", "밥은 거주지 음식물 전용용기·RFID 등 지정 방식에 따라 배출해 주세요.", ...plasticSteps], [part("남은 밥", "음식물쓰레기", ["물기를 줄이고 비닐을 섞지 말아 주세요."], ["songpa-food"]), plasticPart], ["songpa-food", "songpa-plastic"], ["뼈·껍데기·기름 등이 섞인 음식에 이 안내를 확대 적용하지 마세요."]),
  rule("takeaway-bones-shells", "takeaway_container", { material: ["recyclable_plastic"], condition: ["food_remaining"], leftovers: ["bones_shells"], cover: takeawayCovers }, ["살점 없는 뼈·조개껍데기는 용기에서 분리해 일반쓰레기 종량제봉투에 넣어 주세요.", ...plasticSteps], [part("뼈·껍데기", "일반쓰레기 종량제봉투", ["음식물쓰레기와 섞지 말아 주세요."], ["songpa-food"]), plasticPart], ["songpa-food", "songpa-plastic"], ["살점과 다른 음식이 섞였으면 먼저 구분해야 해요."]),
  rule("takeaway-sealing-film", "takeaway_container", { cover: ["clean_film", "clean_lid_and_film"] }, ["분리한 깨끗한 PP·PE 밀봉 필름은 비닐류로 모아 주세요."], [part("밀봉 필름", "비닐류", ["용기에서 완전히 분리하고 흩날리지 않게 모아 주세요."], ["songpa-film", "national-film"])], ["songpa-film", "national-film"], [], "part"),
  rule("takeaway-plastic-lid", "takeaway_container", { cover: ["clean_plastic_lid", "clean_lid_and_film"] }, ["분리한 깨끗한 PET·PE·PP·PS 뚜껑은 플라스틱류로 배출해 주세요."], [part("플라스틱 뚜껑", "플라스틱류", ["필름과 용기에서 분리해 주세요."], ["songpa-plastic", "songpa-guide-plastic-lid"])], ["songpa-plastic", "songpa-guide-plastic-lid"], [], "part"),
  rule("glass-jar-intact", "glass_jar", { material: ["food_glass"], integrity: ["intact"], contents: ["empty"], lid: ["metal", "none"] }, ["빈 유리병을 헹궈 이물질을 제거해 주세요.", "금속 뚜껑이 있으면 분리하고 병은 깨지지 않게 유리병류로 배출해 주세요."], [part("잼 유리병", "유리병류", ["이물질을 제거하고 깨지지 않게 배출해 주세요."], ["songpa-glass"])], ["songpa-glass"], ["내열유리·도자기·거울 등에는 이 유리병 안내를 적용하지 않아요."]),
  rule("glass-metal-lid", "glass_jar", { lid: ["metal"], integrity: ["intact"] }, ["분리한 금속 뚜껑은 이물질을 없애 금속류로 배출해 주세요."], [part("금속 뚜껑", "금속류", ["고무 등 다른 재질이 붙어 분리되지 않으면 별도로 확인해 주세요."], ["songpa-metal"])], ["songpa-metal"], [], "part"),
  rule("glass-jar-broken", "glass_jar", { material: ["food_glass"], integrity: ["broken"], contents: ["empty"], lid: ["none"] }, ["깨진 병은 손이 다치지 않도록 신문지 등으로 감싸 주세요.", "재활용 유리병과 섞지 말고 일반쓰레기 종량제봉투로 배출해 주세요."], [part("깨진 유리병", "일반쓰레기 종량제봉투", ["봉투를 찢거나 손을 베지 않도록 감싸 주세요."], ["songpa-glass"])], ["songpa-glass"]),
  rule("toothbrush-manual", "toothbrush", { kind: ["manual_plastic"] }, ["일반 플라스틱 칫솔은 일반쓰레기 종량제봉투에 넣어 주세요."], [part("일반 칫솔", "일반쓰레기 종량제봉투", ["플라스틱 수거함에 넣지 말아 주세요."], ["national-toothbrush", "songpa-plastic"])], ["national-toothbrush", "songpa-plastic"], ["전동 칫솔과 배터리는 이 안내에 포함되지 않아요."]),
  rule("ice-gel-intact", "ice_pack", { coolant: ["gel"], integrity: ["intact"] }, ["젤 아이스팩은 자르지 말고 통째로 일반쓰레기 종량제봉투에 넣어 주세요."], [part("젤 아이스팩", "일반쓰레기 종량제봉투", ["내용물을 꺼내거나 하수구에 붓지 말고 포장째 배출해 주세요."], ["national-ice-gel", "songpa-ice"])], ["national-ice-gel", "songpa-ice"], ["전용 수거함에 재사용 목적으로 내놓으려면 현재 운영 여부와 수거 조건을 확인해 주세요. 과거 운영 일정은 적용하지 않아요."]),
  rule("ice-water-film", "ice_pack", { coolant: ["water"], integrity: ["intact"], packaging: ["film"] }, ["성분 표시로 물 100%임을 확인한 아이스팩만 열어 물만 하수구로 비워 주세요.", "빈 비닐 포장재는 비닐류로 배출해 주세요."], [part("물 100% 내용물", "하수구", ["젤·첨가물이 섞인 냉매에는 적용하지 말아 주세요."], ["national-ice-water", "songpa-ice"]), part("비닐 포장재", "비닐류", ["내용물을 비우고 모아 주세요."], ["national-ice-water", "songpa-film"])], ["national-ice-water", "songpa-ice", "songpa-film"], ["냉매 성분이 확인되지 않으면 포장을 자르거나 내용물을 붓지 마세요."]),
];

/** Same reviewed material guidance, with per-part preparation facts for incremental coach results.
 * Legacy aggregate conditions stay unchanged. Source ownership remains in the original part rule.
 */
function preparedPartRule(id: string, originalRuleId: string, conditions: Record<string,string[]>): Pick<DisposalRule, "id" | "region" | "conditions" | "sourceIds" | "reviewStatus"> {
  const original = RULES.find(rule => rule.id === originalRuleId);
  if (!original || original.kind !== "part") throw new Error(`없는 부품 원본 규칙: ${originalRuleId}`);
  return { id, region: original.region, reviewStatus: original.reviewStatus, conditions, sourceIds: original.sourceIds };
}

/** New coach categories share this source of truth without expanding legacy ItemId. */
export const COACH_ADDITIONAL_RULES: Pick<DisposalRule, "id" | "region" | "conditions" | "sourceIds" | "reviewStatus">[] = [
  { id: "can-food-beverage-clean", region: "songpa", reviewStatus: "reviewed", conditions: { can_kind: ["aluminum_beverage", "steel_food"], contents: ["empty"], can_accessories: ["none"], clean: ["yes"] }, sourceIds: ["songpa-can"] },
  { id: "pressure-can-separate-check", region: "songpa", reviewStatus: "reviewed", conditions: { can_kind: ["pressure"] }, sourceIds: ["songpa-pressure-can"] },
  { id: "material-scope-check", region: "songpa", reviewStatus: "reviewed", conditions: {}, sourceIds: ["songpa-plastic", "songpa-can"] },
  { id: "scrap-single-metal", region: "songpa", reviewStatus: "reviewed", conditions: { metal_type: ["single_metal"], accessories: ["none"], clean: ["yes"] }, sourceIds: ["songpa-metal"] },
  { id: "paper-clean-dry", region: "songpa", reviewStatus: "reviewed", conditions: { paper_type: ["plain_uncoated"], condition: ["clean_dry"], accessories: ["none"] }, sourceIds: ["songpa-paper"] },
  { id: "battery-official-handoff", region: "songpa", reviewStatus: "reviewed", conditions: {}, sourceIds: ["songpa-battery"] },
  { id: "electronic-official-handoff", region: "songpa", reviewStatus: "reviewed", conditions: {}, sourceIds: ["songpa-electronic"] },
  { id: "bulky-official-handoff", region: "songpa", reviewStatus: "reviewed", conditions: {}, sourceIds: ["songpa-bulky"] },
  { id: "hazardous-official-handoff", region: "songpa", reviewStatus: "reviewed", conditions: {}, sourceIds: ["songpa-pressure-can", "songpa-contact"] },
  preparedPartRule("coach-plastic-lid-prepared", "takeaway-plastic-lid", { lid: ["plastic"], lid_removed: ["yes"], lid_clean: ["yes"] }),
  preparedPartRule("coach-plastic-film-prepared", "takeaway-sealing-film", { film: ["pp_pe"], film_removed: ["yes"], film_clean: ["yes"] }),
  preparedPartRule("coach-carton-straw-prepared", "carton-pp-straw", { straw: ["pp"], straw_removed: ["yes"], straw_prepared: ["yes"] }),
  preparedPartRule("coach-carton-film-prepared", "carton-straw-wrapper", { film: ["pp_pe"], film_removed: ["yes"], film_prepared: ["yes"] }),

];

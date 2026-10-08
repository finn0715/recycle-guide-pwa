import { ITEMS, type ItemId } from "@/lib/contracts";
import type { QuickGuide, QuickMethod, QuickPart } from "@/lib/contracts/quick";
import { RULES, SOURCES } from "./disposal-rules";

// Preparation recipes describe what to do, not claims that a photographed item is already clean.
function method(id: string, label: string, scope: string, ruleIds: string[], steps: string[], parts: QuickPart[], note = "", extraSources: string[] = []): QuickMethod {
  const selected = ruleIds.map(ruleId => {
    const found = RULES.find(rule => rule.id === ruleId);
    if (!found || found.reviewStatus !== "reviewed") throw new Error(`Unreviewed quick guide: ${ruleId}`);
    return found;
  });
  const ids = new Set([...selected.flatMap(rule => rule.sourceIds), ...extraSources]);
  if (!ids.size || [...ids].some(sourceId => !SOURCES.some(source => source.id === sourceId))) throw new Error(`Missing quick guide source: ${id}`);
  return { id, label, scope, ruleIds, steps, parts, note, sources: SOURCES.filter(source => ids.has(source.id)).map(({id,title,url,checkedAt}) => ({id,title,url,checkedAt})) };
}
const part = (name: string, bin: string, note?: string): QuickPart => ({ name, bin, ...(note ? {note} : {}) });
const guide = (id: ItemId, shortLabel: string, methods: QuickMethod[], question?: string): QuickGuide => ({ id, label: ITEMS[id], shortLabel, methods, ...(question ? {question} : {}) });
const foodScope = "PET·PE·PP·PS 용기 · 뚜껑과 필름은 떼어낸 뒤";
const foamSources = ["songpa-foam", "songpa-guide-foam"];

export const QUICK_GUIDES: QuickGuide[] = [
  guide("pump_bottle", "샴푸통", [method("basic", "배출 방법", "플라스틱 샴푸·린스 용기 · 내용물을 다 쓴 뒤", ["pump-plastic-empty", "pump-composite-part", "pump-film-label"],
    ["펌프와 라벨을 떼세요.", "본체 안의 이물질을 물로 헹구세요.", "본체·펌프·라벨을 아래처럼 나눠 버리세요."],
    [part("플라스틱 본체", "플라스틱"), part("금속 스프링 펌프", "일반쓰레기", "억지로 분해하지 말고 통째로"), part("떼어낸 비닐 라벨", "비닐")],
    "비닐 라벨이 있을 때만 비닐로 배출해요. 종이·미분리 라벨, 다른 재질의 본체나 펌프는 해당 부품의 재질 표시를 확인해 주세요. 남은 샴푸를 하수구에 붓지 마세요.")]),
  guide("clear_pet_bottle", "페트병", [method("basic", "배출 방법", "생수·음료용 투명 페트병 기준", ["pet-clear-empty", "pet-reclose-cap", "pet-film-label"],
    ["내용물을 비우고 비닐 라벨을 떼세요.", "병을 눌러 압착하고 뚜껑이 있으면 다시 닫으세요.", "병은 투명 페트병끼리, 비닐 라벨은 따로 모으세요."],
    [part("투명 병 + 뚜껑", "투명 페트병"), part("비닐 라벨", "비닐", "있다면 분리")],
    "유색 병이나 세제 용기는 투명 생수·음료 페트병 수거함에 넣지 않아요.")]),
  guide("drink_carton", "우유·두유팩", [method("basic", "배출 방법", "우유·두유·주스용 종이팩 기준", ["carton-empty-separated", "carton-pp-straw", "carton-straw-wrapper"],
    ["내용물을 비우고 팩을 헹군 뒤 말리세요.", "빨대와 포장비닐이 있으면 떼세요.", "일반팩·멸균팩을 구분해 종이팩 전용수거함에 넣으세요."],
    [part("우유·두유팩", "종이팩", "일반 종이와 섞지 않기"), part("깨끗한 단일 PP 빨대", "플라스틱"), part("PP·PE 포장비닐", "비닐")],
    "전용수거함이 없으면 종류별로 따로 묶어 종이류 수거함에 구분해 놓으세요. 종이·복합 빨대에는 PP 빨대 방법을 적용하지 않아요.")]),
  guide("cardboard_box", "택배 상자", [method("basic", "배출 방법", "깨끗하고 마른 비코팅 골판지 상자 기준", ["cardboard-clean", "cardboard_box-tape", "cardboard_box-shipping-label"],
    ["붙어 있는 테이프와 송장을 떼세요.", "상자는 젖지 않게 종이류로 모으세요."],
    [part("골판지 상자", "종이"), part("포장 테이프·접착식 송장", "일반쓰레기")],
    "비닐·은박 코팅이나 기름 오염이 있는 상자는 이 종이류 안내 대상과 달라요.")]),
  guide("foam_box", "스티로폼", [
    method("household", "흰색 생활용품 상자", "코팅 없는 흰색 EPS · 식품·전자제품 배송 제외", ["foam-packaging-clean", "foam_box-tape", "foam_box-shipping-label"],
      ["상자를 비우고 이물질을 헹궈 없애세요.", "테이프와 송장을 떼고 본체만 따로 모으세요."],
      [part("흰색 스티로폼 본체", "스티로폼"), part("테이프·송장", "일반쓰레기")], "씻어도 이물질이 제거되지 않거나 다른 재질이 붙은 상자는 해당하지 않아요."),
    method("food", "식품 배송 상자", "송파구의 식품 포장용 EPS 안내 확인 필요", [], ["테이프·송장 등 부속품을 본체와 분리하세요.", "본체는 송파구 공식 안내에서 식품 포장용 기준을 확인해 주세요."], [], "현재 송파구 본문과 첨부 안내서의 식품용 EPS 기준이 달라 본체의 수거 분류를 하나로 정할 수 없어요.", foamSources),
    method("other", "유색·코팅·기타", "흰색 비코팅 생활용품 상자와 다른 제품", [], ["제품의 재질·용도를 확인하고 송파구청 배출 안내를 확인하세요."], [], "유색·코팅·전자제품 포장재에는 흰색 생활용품 상자 방법을 그대로 적용하지 않아요.", foamSources),
  ], "어떤 스티로폼 상자인가요?"),
  guide("snack_bag", "과자 봉지", [method("basic", "배출 방법", "비닐 포장재 · 내용물과 이물질을 없앤 뒤", ["snack-film-clean"],
    ["남은 과자와 부스러기를 털어내세요.", "이물질을 없애고 투명·반투명 봉투에 모으세요."], [part("깨끗한 과자 봉지", "비닐")],
    "은색 안감만 보고 일반쓰레기로 정하지 마세요. 종이가 섞였거나 이물질이 제거되지 않는 포장은 별도 확인이 필요해요.")]),
  guide("takeaway_container", "배달 용기", [
    method("clean", "씻을 수 있는 용기", foodScope, ["takeaway-clean", "takeaway-sealing-film", "takeaway-plastic-lid"],
      ["남은 음식·국물·기름을 용기에서 분리하세요.", "이물질을 물로 헹구고 뚜껑·필름을 떼세요.", "용기와 부속품을 아래처럼 나눠 버리세요."],
      [part("깨끗한 용기·플라스틱 뚜껑", "플라스틱"), part("깨끗한 PP·PE 밀봉 필름", "비닐")],
      "씻은 뒤 색만 남았다고 일반쓰레기는 아니에요. 붙어 있는 음식물과 착색을 구분하세요. 국물·기름·혼합 음식의 처리 방법을 음식물쓰레기로 일괄 분류하지 않아요."),
    method("stuck", "음식물이 안 지워져요", foodScope + " · 별도로 덜어낼 내용물은 없는 상태", ["takeaway-stuck-food"],
      ["덜어낼 음식·국물·기름부터 용기와 분리하세요.", "씻어도 음식물 이물질이 붙어 있는 본체는 종량제봉투에 넣으세요."], [part("음식물이 안 지워지는 본체", "일반쓰레기")], "색만 남은 상태에는 이 방법을 적용하지 않아요. 뚜껑·필름은 본체와 따로 재질과 오염을 확인하세요."),
    method("rice", "밥만 남았어요", "다른 재료 없이 밥만 남은 PET·PE·PP·PS 용기", ["takeaway-rice"],
      ["밥은 물기를 줄여 음식물 전용용기에 버리세요.", "용기는 헹구고 다른 재질의 부속품을 떼세요."], [part("남은 밥", "음식물쓰레기"), part("씻은 용기 본체", "플라스틱")], "뼈·껍데기·기름 등 다른 재료가 섞인 음식에 확대 적용하지 않아요."),
    method("bones", "살점 없는 뼈·껍데기", "살점 없는 뼈·조개껍데기만 남은 플라스틱 용기", ["takeaway-bones-shells"],
      ["뼈·조개껍데기를 종량제봉투에 버리세요.", "용기는 헹구고 다른 재질의 부속품을 떼세요."], [part("살점 없는 뼈·조개껍데기", "일반쓰레기"), part("씻은 용기 본체", "플라스틱")], "살점이나 다른 음식이 섞였으면 먼저 구분하세요."),
  ]),
  guide("glass_jar", "잼 유리병", [
    method("intact", "깨지지 않은 병", "일반 식품 유리병 · 내용물을 비운 뒤", ["glass-jar-intact", "glass-metal-lid"],
      ["병을 헹구고 뚜껑을 떼세요.", "병은 깨지지 않게 유리병류로 모으세요."], [part("식품 유리병", "유리병"), part("단일 금속 뚜껑", "금속")], "내열유리·도자기·거울은 유리병류가 아니에요. 고무가 붙어 분리되지 않는 뚜껑은 단일 금속 뚜껑과 달라요."),
    method("broken", "깨지거나 금이 갔어요", "내용물이 없고 다른 부품을 분리한 식품 유리병", ["glass-jar-broken"],
      ["다치지 않게 신문지 등으로 감싸세요.", "재활용 유리병과 섞지 말고 종량제봉투에 넣으세요."], [part("깨진 유리병", "일반쓰레기")], "봉투가 찢어지지 않게 감싸 주세요."),
  ]),
  guide("toothbrush", "칫솔", [method("basic", "배출 방법", "전기·배터리를 쓰지 않는 일반 플라스틱 칫솔", ["toothbrush-manual"],
    ["일반 플라스틱 칫솔은 종량제봉투에 넣으세요."], [part("일반 플라스틱 칫솔", "일반쓰레기")], "플라스틱 수거함에 넣지 않아요. 전동·배터리·나무 칫솔은 다른 품목이에요.")]),
  guide("ice_pack", "아이스팩", [
    method("water", "물 100% · 비닐 포장", "물 100% 표시 · 터지지 않은 비닐 포장", ["ice-water-film"],
      ["물 100% 표시를 확인한 팩만 열어 물을 비우세요.", "빈 비닐 포장재는 비닐류로 모으세요."], [part("물 100% 내용물", "하수구"), part("빈 비닐 포장재", "비닐")], "젤·첨가물이 섞인 팩이나 종이 포장에는 적용하지 않아요."),
    method("gel", "고흡수성수지(SAP) 젤", "SAP 표시 · 터지지 않은 포장", ["ice-gel-intact"],
      ["자르거나 내용물을 꺼내지 마세요.", "포장째 종량제봉투에 넣으세요."], [part("젤 아이스팩 통째로", "일반쓰레기")], "젤은 하수구에 붓지 마세요."),
    method("unknown", "전분·모름·터진 팩", "성분이나 포장 상태를 먼저 확인", [],
      ["포장을 자르거나 내용물을 하수구에 붓지 마세요.", "포장의 성분 표시를 확인하고 제조사·송파구청 안내를 확인하세요."], [], "전분·혼합형·누출 상태는 물·SAP의 배출 방법으로 대체할 수 없어요.", ["national-ice-water", "national-ice-gel", "songpa-ice"]),
  ], "포장에 적힌 성분을 골라 주세요."),
];

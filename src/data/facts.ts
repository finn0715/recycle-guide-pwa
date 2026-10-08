import type { ItemId, Question } from "@/lib/contracts";

export type FactDefinition = {
  values: string[];
  evidence: "user_only" | "photo_allowed";
  question: Question;
  choices: Record<string, string>;
  description: string;
};

function fact(text: string, choices: Record<string, string>, description: string, visual = false): FactDefinition {
  const all = { ...choices, unknown: "확인하기 어려워요" };
  return {
    values: Object.keys(all),
    evidence: visual ? "photo_allowed" : "user_only",
    // Supporting photos are welcome; evidence still controls fact confirmation.
    question: { text, choices: Object.values(all), allowPhoto: true },
    choices: all,
    description,
  };
}

const contents = fact("내용물을 다 비웠나요?", { empty: "다 비웠어요", remaining: "아직 남아 있어요" }, "용기 내부 상태. 겉면 사진으로 비었다고 확정하지 않는다.");
const label = fact("라벨은 어떤 상태인가요?", { film: "분리할 수 있는 비닐 라벨이에요", none: "라벨이 없어요", other: "종이 라벨이거나 잘 분리되지 않아요" }, "비닐 재질과 분리 가능 여부는 사용자가 확인한다.");

const attachments = fact("상자에 어떤 테이프·송장이 있나요?", {
  none: "테이프·송장 등 부속품이 없어요",
  tape: "떼어낼 수 있는 일반 포장 테이프만 있어요",
  shipping_label: "떼어낼 수 있는 접착식 택배 송장만 있어요",
  tape_and_label: "떼어낼 수 있는 일반 포장 테이프와 접착식 송장이 있어요",
  other: "다른 부속품이 있거나 떼어지지 않아요",
}, "일반 비닐·종이 포장용 접착테이프와 접착식 택배 송장의 유무·분리 가능 여부를 확인한다. 일반 종이 문서는 송장이 아니다. 끈·철핀·보냉재 등 다른 부속품이 하나라도 있으면 other다. 사진에서 안 보인다는 이유로 none으로 정하지 않는다.");

/** Only registered visible facts may be confirmed from photographs alone. */
export const FACT_REGISTRY: Record<ItemId, Record<string, FactDefinition>> = {
  pump_bottle: {
    material: fact("용기 본체는 플라스틱인가요?", { plastic: "플라스틱 용기예요", other: "다른 재질이에요" }, "샴푸 또는 린스를 담았던 플라스틱 용기에 한정한다."),
    contents,
    pump: fact("펌프에 금속 스프링이 섞여 있나요?", { composite: "금속 스프링이 섞인 펌프예요", none: "펌프가 없어요", single_material: "단일 재질 펌프예요" }, "내부 스프링은 사진만으로 확정하지 않는다. 억지로 분해하지 않는다."),
    label,
  },
  clear_pet_bottle: {
    bottle_type: fact("투명한 생수·음료용 페트병인가요?", { clear_beverage: "투명한 생수·음료병이에요", other: "유색 병이거나 다른 용도예요" }, "PET 외관만으로 원래 용도를 단정하지 않는다."),
    contents,
    label,
    cap: fact("병뚜껑이 있나요?", { present: "뚜껑이 있어요", absent: "뚜껑이 없어요" }, "사진에 명확히 보이는 뚜껑의 유무만 관찰 가능하다.", true),
  },
  drink_carton: {
    carton_type: fact("팩에 어떤 종류라고 표시되어 있나요?", { regular: "일반 우유팩이에요", aseptic: "멸균팩이에요", other: "종이팩인지 확실하지 않아요" }, "우유·두유·주스용 종이팩이며 일반팩/멸균팩을 구분한다."),
    contents,
    accessories: fact("팩의 빨대와 포장비닐은 어떤 상태인가요?", {
      none: "빨대·포장비닐 등 부속품이 없어요",
      clean_pp_straw: "분리되는 깨끗한 단일 PP 빨대만 있어요",
      clean_film: "분리되는 깨끗한 PP·PE 빨대 포장비닐만 있어요",
      clean_pp_straw_and_film: "깨끗한 단일 PP 빨대와 PP·PE 포장비닐이 분리돼요",
      other: "다른 부속품이 있거나 재질·오염 상태가 달라요",
    }, "빨대는 단일 PP, 포장비닐은 PP·PE 재질이며 팩에서 분리 가능하고 내용물·이물질이 없음을 사용자가 확인한다. 종이·금속·복합 빨대, 뚜껑·주입구, 미분리·오염 부속품 등 하나라도 다른 것이 있으면 other다. 재질은 외관으로 단정하지 않는다."),
  },
  cardboard_box: {
    material: fact("코팅이 없는 골판지 택배 상자인가요?", { cardboard: "코팅 없는 골판지예요", coated: "비닐·은박 코팅이 있어요", other: "다른 재질이에요" }, "복합 보냉 상자와 일반 골판지를 구별한다."),
    condition: fact("상자는 깨끗하고 말라 있나요?", { clean_dry: "깨끗하고 말라 있어요", wet: "젖어 있어요", dirty: "기름·음식물이 묻어 있어요" }, "오염과 수분은 사용자가 확인한다."),
    attachments,
  },
  foam_box: {
    material: fact("코팅 없는 포장용 스티로폼 상자인가요?", { eps_packaging: "코팅 없는 포장용 스티로폼이에요", coated: "다른 재질이 코팅·접착되어 있어요", other: "건축용이거나 다른 재질이에요" }, "발포스티렌(EPS) 배송 상자로 한정하며 다른 재질 코팅·접착 여부를 사용자에게 확인한다. 식품용 여부는 packaging_use에서 별도 확인한다."),
    condition: fact("상자를 비우고 이물질도 제거했나요?", { empty_clean: "비웠고 이물질도 없어요", removable_residue: "비웠고 남은 이물질은 씻으면 제거돼요", stuck_residue: "이물질이 제거되지 않아요" }, "빈 상자 상태 및 세척 가능 여부는 사용자가 확인한다."),
    color: fact("스티로폼 본체의 색은 무엇인가요?", { white: "흰색이에요", colored: "색이나 무늬가 있어요" }, "본체 전체의 색을 확인한다. 송파 안내서의 흰색 범위 밖인 유색·무늬 제품은 전국 안내를 자동 적용하지 않고 보류한다."),
    packaging_use: fact("무엇을 배송한 스티로폼 상자인가요?", { non_food: "식품·전자제품이 아닌 생활용품 배송 상자예요", food: "식품 배송·포장 상자예요", other: "전자제품 포장재이거나 다른 용도예요" }, "식품 포장은 송파 본문과 첨부 안내서의 배출 기준이 충돌하여 uncertain이다. non_food는 비식품 생활용품 배송 상자이며 판매점 반환 안내가 별도로 있는 전자제품 포장재와 건축재를 제외한다."),
    attachments,
  },
  snack_bag: {
    material: fact("과자 포장재는 비닐인가요?", { film: "비닐 포장재예요", other: "종이 등이 섞인 다른 재질이에요" }, "은색 안감만으로 비닐 여부를 단정하지 않는다."),
    condition: fact("봉지 안을 비우고 이물질도 제거했나요?", { empty_clean: "비웠고 이물질도 없어요", crumbs: "과자나 부스러기가 남아 있어요", stuck_residue: "이물질이 제거되지 않아요" }, "남은 과자를 임의로 음식물 또는 일반쓰레기로 분류하지 않는다."),
  },
  takeaway_container: {
    material: fact("용기의 재질 표시를 확인해 주세요.", { recyclable_plastic: "PET·PE·PP·PS 플라스틱 용기예요", other: "다른 재질이거나 복합재질이에요" }, "스티로폼·종이·복합 용기는 이 플라스틱 규칙에서 제외한다."),
    condition: fact("배달 용기 안은 어떤 상태인가요?", { empty_clean: "내용물은 모두 비웠고 이물질도 없어요", color_only: "내용물은 모두 비웠고 씻어도 색만 남았어요", removable_residue: "내용물은 모두 비웠고 얇은 이물질은 씻으면 제거돼요", stuck_residue: "내용물은 모두 비웠지만 붙은 음식물이 안 지워져요", food_remaining: "음식·국물·기름 등 내용물이 남아 있어요" }, "국물·액체 기름 등 액체나 고형 내용물이 남아 있으면 food_remaining이다. empty_clean/color_only/removable_residue/stuck_residue는 고형·액체 내용물을 모두 비웠다는 사용자 확인이 필요하다. 착색과 얇게 붙은 이물질을 구분하고 세척 가능 여부를 외관만으로 판단하지 않는다. 내용물을 버릴 곳을 임의로 정하거나 무조건 비우도록 유도하지 않는다."),
    leftovers: fact("남은 것은 무엇인가요?", { plain_rice: "다른 재료 없이 밥만 남았어요", bones_shells: "살점 없이 뼈·조개껍데기만 남았어요", mixed_other: "국물·기름 또는 여러 재료가 남아 있어요" }, "food_remaining일 때만 필요하다. 국물·기름 또는 밥·살점 없는 뼈/조개껍데기 이외 내용물은 mixed_other다. 국물·기름·혼합 음식물의 배출방법은 이 규칙에서 확정하지 않는다."),
    cover: fact("배달 용기의 뚜껑·밀봉 필름은 어떤 상태인가요?", {
      none: "뚜껑·밀봉 필름 등 부속품이 없어요",
      clean_film: "떼어지는 깨끗한 PP·PE 밀봉 필름만 있어요",
      clean_plastic_lid: "분리되는 깨끗한 PET·PE·PP·PS 뚜껑만 있어요",
      clean_lid_and_film: "깨끗한 PET·PE·PP·PS 뚜껑과 PP·PE 필름이 분리돼요",
      other: "다른 부속품이 있거나 재질·오염·분리 상태가 달라요",
    }, "필름은 PP·PE, 뚜껑은 PET·PE·PP·PS 단일 플라스틱이며 내용물·이물질이 없고 본체와 분리 가능함을 사용자가 확인한다. clean_lid_and_film도 뚜껑 재질 확인이 필요하다. 알루미늄·종이 복합 필름, 재질 불명, 미분리, 오염, 다른 부속품은 other다. 필름처럼 보인다는 이유로 비닐로 확정하지 않는다."),
  },
  glass_jar: {
    material: fact("잼을 담았던 일반 유리병인가요?", { food_glass: "식품 포장용 일반 유리병이에요", heat_resistant: "내열유리 용기예요", other: "다른 유리제품이에요" }, "유리병과 내열유리 식기를 구분한다."),
    integrity: fact("유리병이 깨졌나요?", { intact: "깨지지 않았어요", broken: "깨지거나 금이 갔어요" }, "눈에 보이는 깨짐·균열을 관찰할 수 있다. 보이지 않는 면은 추측하지 않는다.", true),
    contents,
    lid: fact("뚜껑은 어떤 재질인가요?", { metal: "다른 재질이 붙지 않은 금속 뚜껑이에요", none: "뚜껑이 없어요", plastic: "플라스틱 뚜껑이에요", other: "복합재질이거나 다른 재질이에요" }, "떼어낼 수 없는 고무 등이 붙어 있으면 other다. 금속 이외 부속품은 이 규칙에서 배출 분류를 확정하지 않는다."),
  },
  toothbrush: {
    kind: fact("전기나 배터리를 쓰지 않는 일반 플라스틱 칫솔인가요?", { manual_plastic: "일반 플라스틱 칫솔이에요", electric: "전동 칫솔이에요", other: "나무 등 다른 재질이에요" }, "전동 칫솔·전동 칫솔 부속품을 일반 칫솔로 취급하지 않는다."),
  },
  ice_pack: {
    coolant: fact("포장에 적힌 냉매 성분은 무엇인가요?", { water: "물 100%라고 적혀 있어요", gel: "고흡수성수지(SAP)라고 적혀 있어요", starch: "전분이 들어 있다고 적혀 있어요", other: "다른 성분이에요" }, "제품 성분 표시를 사용자가 확인한다. 물 100%만 water, 고흡수성수지(SAP) 확인만 gel, 전분 또는 물과 전분의 혼합은 starch다. 젤처럼 보이는 모양이나 친환경 표시만으로 성분을 확정하지 않는다. 전분의 배출 방법은 미검수이므로 물이나 SAP 규칙으로 대체하지 않는다."),
    integrity: fact("아이스팩 포장이 터지거나 새고 있나요?", { intact: "터지지 않았어요", leaking: "터졌거나 새고 있어요" }, "보이는 누출 상태는 사진으로 확인할 수 있다.", true),
    packaging: fact("물 아이스팩의 포장재는 무엇인가요?", { film: "비닐 포장재예요", coated_paper: "코팅된 종이 포장재예요", other: "다른 재질이에요" }, "물 100% 아이스팩에서만 필요하다. 종이 외관을 일반 종이로 단정하지 않는다."),
  },
};

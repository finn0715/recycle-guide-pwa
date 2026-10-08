import type { GuideCatalog, GuideFlow, Step } from "@/lib/contracts/coach";
import { actionChoices, choice, complete, destination, fact, hold, step } from "./coach-guide-builders";

export const householdFailureReplies: Record<string, { text: string; speechText: string }> = {};
function action(id: string, text: string, visual: Step["visual"]["action"], roles: string[], next: string, held: string, patch: Record<string,string>, rules: string[], reason: string, failure: string, assetId: string | null = null): Step {
  householdFailureReplies[id] = { text: `${failure} '안돼요'를 눌러 지금 상태의 처리 방법을 확인해 주세요.`, speechText: `${failure} 안돼요를 눌러 주세요.` };
  const canReportEmpty = visual === "empty" || visual === "rinse";
  const choices = actionChoices(next, held, patch, canReportEmpty ? next : held, canReportEmpty ? patch : {});
  const result = step(id, "action", text, visual, roles, canReportEmpty ? choices : choices.filter(c => c.id !== "absent"), rules, reason);
  result.visual.assetId = assetId;
  return result;
}
const otherChoices = (held: string) => [choice("other", "다른 재질·상태예요", held), choice("unknown", "모르겠어요", held)];
function flow(id: string, categoryId: string, facts: GuideFlow["facts"], steps: Step[]): GuideFlow {
  return { id, categoryId, startStepId: steps[0].id, facts, steps };
}

const scrapRule = ["scrap-single-metal"];
const scrap = flow("metal-scrap", "metal_scrap", {metal_type:fact("single_metal"), accessories:fact("none"), clean:fact("yes")}, [
  step("scrap-type", "confirm", "전기제품이 아닌 철·알루미늄·스테인리스 등 금속 물건인가요?", "inspect", ["body"], [choice("yes","금속 물건이에요","scrap-accessories",{metal_type:"single_metal"}),...otherChoices("scrap-hold")], scrapRule, "고철은 금속 재질을 확인해요. 전기제품과 여러 재질이 섞인 물건은 별도 처리가 필요해요."),
  step("scrap-accessories", "question", "고무 손잡이·천·플라스틱 등 다른 재질이 붙어 있나요?", "inspect", ["body"], [choice("none","다른 재질이 없어요","scrap-clean",{accessories:"none"}),choice("present","다른 재질이 붙어 있어요","scrap-hold"),choice("unknown","모르겠어요","scrap-hold")], scrapRule, "고철에는 이물질과 다른 재질이 섞이지 않아야 해요. 분리 여부를 겉모습으로 추측하지 않아요."),
  action("scrap-clean","표면에 묻은 이물질을 물로 씻어 주세요. 날카로운 부분은 손으로 만지지 마세요.","rinse",["body"],"scrap-bin","scrap-hold",{clean:"yes"},scrapRule,"송파구는 이물질이 섞이지 않은 고철과 비철금속을 따로 배출하도록 안내해요.","이물질 제거가 어렵거나 날카로우면 작업을 멈추세요."),
  destination("scrap-bin","body","metal","고철·비철금속류",scrapRule,"scrap-complete"), complete("scrap-complete",scrapRule),
  hold("scrap-hold",["body"],scrapRule,"재질이 섞였거나 안전하게 준비하기 어려운 금속 물건이에요. 분리하려고 부수지 마세요."),
]);

// Covers are confirmed separately from body cleanliness. Each detached part is prepared before the next one.
const plasticRule = ["takeaway-clean"];
const lidRule = ["coach-plastic-lid-prepared"];
const filmRule = ["coach-plastic-film-prepared"];
const plastic = flow("plastic-container","plastic_container",{
  material:fact("recyclable_plastic"),condition:fact("empty_clean","color_only","removable_residue","stuck_residue"),cover:fact("none","clean_film","clean_plastic_lid","clean_lid_and_film"),
  lid:fact("plastic","none"),film:fact("pp_pe","none"),contents:fact("empty"), lid_removed:fact("yes"),film_removed:fact("yes"),lid_clean:fact("yes"),film_clean:fact("yes"),
},[
  step("plastic-type","confirm","본체 표시가 PET·PE·PP·PS인 용기인가요? 투명 생수·음료 PET병은 전용 안내를 골라 주세요.","inspect",["body"],[choice("yes","해당 재질의 일반 용기예요","plastic-cover" ,{material:"recyclable_plastic"}),...otherChoices("plastic-hold")],plasticRule,"용기·트레이 기준은 혼합 재질 장난감이나 문구에 적용하지 않아요. 투명 음료 PET병은 따로 모아요."),
  step("plastic-cover","question","뚜껑·밀봉 필름은 어떤 재질인가요? 그 밖의 라벨·부품이 있으면 다른 부품을 선택해 주세요.","inspect",["lid","film"],[
    choice("none","뚜껑·필름·다른 부품이 없어요","plastic-empty",{cover:"none",lid:"none",film:"none"}),
    choice("lid","PET·PE·PP·PS 뚜껑만 있어요","plastic-lid-detach",{lid:"plastic",film:"none"}),
    choice("film","PP·PE 필름만 있어요","plastic-film-detach",{lid:"none",film:"pp_pe"}),
    choice("both","해당 뚜껑과 필름이 모두 있어요","plastic-lid-detach-both",{lid:"plastic",film:"pp_pe"}),
    choice("other","다른 부품·재질이 있어요","plastic-hold"),choice("unknown","모르겠어요","plastic-hold"),
  ],plasticRule,"분리 가능한 단일 재질 뚜껑과 PP·PE 필름만 각각 안내해요. 확인되지 않은 부품은 따로 확인해야 해요."),
  ...[false,true].flatMap(both => {
    const suffix = both ? "-both" : "";
    return [action(`plastic-lid-detach${suffix}`,"뚜껑을 손으로 부드럽게 열어 본체에서 분리해 주세요.","detach",["lid","body"],`plastic-lid-clean${suffix}`,"plastic-hold",{lid_removed:"yes"},lidRule,"플라스틱 뚜껑은 필름과 본체에서 분리한 뒤 이물질을 없애요.","뚜껑이 안 열리면 비틀거나 도구로 찌르지 말고 멈추세요."),
      action(`plastic-lid-clean${suffix}`,"분리한 뚜껑의 이물질을 물로 씻어 주세요.","rinse",["lid"],`plastic-lid-bin${suffix}`,"plastic-hold",both?{lid_clean:"yes"}:{lid_clean:"yes",cover:"clean_plastic_lid"},lidRule,"깨끗한 PET·PE·PP·PS 뚜껑에 플라스틱 분류를 적용해요.","뚜껑의 이물질이 씻기지 않으면 별도로 확인해야 해요."),
      destination(`plastic-lid-bin${suffix}`,"lid","plastic","플라스틱 뚜껑: 플라스틱류",lidRule,both?"plastic-film-detach-both":"plastic-empty")];
  }),
  ...[false,true].flatMap(both => { const suffix = both ? "-both" : ""; return [
    action(`plastic-film-detach${suffix}`,"밀봉 필름의 끝을 잡아 본체에서 떼어 주세요.","detach",["film","body"],`plastic-film-clean${suffix}`,"plastic-hold",{film_removed:"yes"},filmRule,"PP·PE 필름은 단단한 용기와 분리해서 비닐류로 모아요.","필름이 안 떨어지면 억지로 뜯지 마세요."),
    action(`plastic-film-clean${suffix}`,"떼어 낸 필름에 묻은 이물질을 없애 주세요.","rinse",["film"],`plastic-film-bin${suffix}`,"plastic-hold",{film_clean:"yes",cover:both?"clean_lid_and_film":"clean_film"},filmRule,"이물질이 없는 필름만 비닐류로 모을 수 있어요.","필름에 붙은 이물질을 없앨 수 없으면 보류해야 해요."),
    destination(`plastic-film-bin${suffix}`,"film","vinyl","PP·PE 필름: 비닐류",filmRule,"plastic-empty"),
  ]; }),
  action("plastic-empty","내용물을 다 사용해 빈 용기로 준비해 주세요. 남은 국물·기름의 처리 방법을 모르면 멈추세요.","empty",["body"],"plastic-rinse","plastic-hold",{contents:"empty"},plasticRule,"빈 용기 기준으로 남은 제품이나 국물·기름의 처리 방법을 추정하지 않아요.","내용물이 남았으면 용기 준비를 멈추고 내용물의 처리부터 확인하세요."),
  action("plastic-rinse","빈 용기를 물로 헹궈 붙은 이물질을 없애 주세요.","rinse",["body"],"plastic-bin","plastic-hold",{condition:"empty_clean"},plasticRule,"이물질이 제거된 PET·PE·PP·PS 용기에 플라스틱 배출 기준을 적용해요.","씻어도 붙은 이물질이 남으면 지금 상태의 처리를 더 확인해야 해요."),
  step("plastic-residue","question","덜어낼 음식은 없나요? 씻은 뒤 색만 남았는지, 붙은 음식물이 남았는지 구분해 주세요.","inspect",["body"],[
    choice("color","이물질 없이 색만 남았어요","plastic-bin",{condition:"color_only"}),
    choice("stuck","씻어도 붙은 음식물만 남았어요","plastic-stuck-bin",{condition:"stuck_residue"}),
    choice("remaining","덜어낼 음식·액체가 남았어요","plastic-hold"),choice("unknown","모르겠어요","plastic-hold"),
  ],["takeaway-clean","takeaway-stuck-food"],"착색만 남은 용기와 씻어도 음식물이 붙은 용기는 달라요. 남은 음식·액체부터 별도로 처리해야 해요."),
  destination("plastic-stuck-bin","body","general","씻어도 음식물이 붙은 빈 용기: 종량제봉투",["takeaway-stuck-food"],"plastic-complete"),
  destination("plastic-bin","body","plastic","플라스틱 용기류",plasticRule,"plastic-complete"),complete("plastic-complete",plasticRule),
  hold("plastic-hold",["body","lid","film"],plasticRule,"재질이나 남은 내용물, 분리·세척이 어려운 부분의 처리를 더 확인해야 해요."),
]);

// An inability response asks about the remaining residue; it does not claim it is food or automatically classify it.
plastic.steps.find(s => s.id === "plastic-rinse")!.choices.find(c => c.id === "cannot")!.nextStepId = "plastic-residue";
householdFailureReplies["plastic-rinse"] = {
  text: "색만 남은 것과 붙은 음식물이 남은 것은 처리 기준이 달라요. '안돼요'를 눌러 현재 상태를 직접 구분해 주세요.",
  speechText: "색만 남았는지 음식물이 붙었는지 더 확인해야 해요. 안돼요를 눌러 상태를 골라 주세요.",
};

const glassRule=["glass-jar-intact"];
const glassLidRule=["glass-metal-lid"];
const glass=flow("glass-bottle","glass_bottle",{material:fact("food_glass"),integrity:fact("intact","broken"),contents:fact("empty"),lid:fact("metal","none"),clean:fact("yes"),lid_clean:fact("yes"),lid_removed:fact("yes")},[
  step("glass-type","confirm","일반 식품·음료용 유리병인가요? 내열유리·도자기·거울은 제외해 주세요.","inspect",["body"],[choice("yes","일반 식품·음료병이에요","glass-integrity",{material:"food_glass"}),choice("deposit","빈용기 보증금 표시가 있어요","glass-return"),...otherChoices("glass-hold")],glassRule,"일반 유리병과 내열·코팅 유리는 처리 기준이 달라요. 보증금 병은 소매점에 반납할 수 있어요."),
  step("glass-integrity","question","금이 가거나 깨진 곳이 없는지 눈으로 확인해 주세요.","inspect",["body"],[choice("intact","깨지거나 금 간 곳이 없어요","glass-lid",{integrity:"intact"}),choice("broken","깨졌거나 금이 갔어요","glass-broken-hold",{integrity:"broken"}),choice("unknown","모르겠어요","glass-hold")],glassRule,"깨진 유리와 온전한 병은 배출 방법이 달라요. 금 간 곳을 손으로 확인하지 마세요."),
  step("glass-lid","question","뚜껑이 단일 금속인가요? 고무·플라스틱이 붙어 있으면 다른 재질을 골라 주세요.","inspect",["lid"],[choice("metal","금속만 있는 뚜껑이에요","glass-lid-detach",{lid:"metal"}),choice("none","뚜껑이 없어요","glass-empty",{lid:"none"}),...otherChoices("glass-hold")],glassLidRule,"다른 재질이 섞인 뚜껑을 단일 금속으로 보지 않아요."),
  action("glass-lid-detach","뚜껑을 손으로 부드럽게 돌려 병에서 분리해 주세요.","detach",["lid","body"],"glass-lid-clean","glass-hold",{lid_removed:"yes"},glassLidRule,"금속 뚜껑과 유리병은 재질이 달라 각각 모아요.","뚜껑이 안 열리면 병을 치거나 가열하지 말고 멈추세요."),
  action("glass-lid-clean","금속 뚜껑에 묻은 이물질을 없애 주세요.","rinse",["lid"],"glass-lid-bin","glass-hold",{lid_clean:"yes"},glassLidRule,"이물질이 섞이지 않은 금속 부품만 금속류로 배출해요.","뚜껑 이물질이 제거되지 않으면 별도 확인이 필요해요."),
  destination("glass-lid-bin","lid","metal","단일 금속 뚜껑: 금속류",glassLidRule,"glass-empty"),
  action("glass-empty","내용물을 다 사용해 병을 빈 상태로 준비해 주세요.","empty",["body"],"glass-rinse","glass-hold",{contents:"empty"},glassRule,"일반 식품 유리병 기준은 내용물을 비운 상태에 적용해요.","내용물 처리 방법을 모르면 임의로 붓지 말고 먼저 확인하세요."),
  action("glass-rinse","빈 유리병을 물로 헹궈 이물질을 없애 주세요. 병이 깨지지 않게 다뤄 주세요.","rinse",["body"],"glass-bin","glass-hold",{clean:"yes"},glassRule,"이물질 없이 비운 온전한 유리병을 유리병류로 모아요.","세척이 어렵거나 병에 금이 생기면 작업을 멈추세요."),
  destination("glass-bin","body","glass","일반 식품·음료 유리병류",glassRule,"glass-complete"),complete("glass-complete",glassRule),
  hold("glass-hold",["body","lid"],glassRule,"유리의 종류나 뚜껑 재질, 비움·세척 상태를 더 확인해야 해요."),
  hold("glass-broken-hold",["body"],["glass-jar-broken"],"깨진 병은 유리병 수거함에 넣지 마세요. 손으로 파편을 만지지 말고 송파구의 감싸서 종량제 배출하는 방법을 확인하세요."),
  hold("glass-return",["body"],glassRule,"빈용기 보증금 대상 병은 소매점 반납 경로를 확인해 주세요. 병을 깨뜨리지 말고 표시를 보여 주세요."),
]);

const paperRule=["paper-clean-dry"];
const paper=flow("plain-paper","paper",{paper_type:fact("plain_uncoated"),condition:fact("clean_dry"),accessories:fact("none")},[
  step("paper-type","confirm","물기·기름때·비닐 코팅이 없는 종이나 신문·책인가요?", "inspect",["body"],[choice("yes","마르고 깨끗한 비코팅 종이예요","paper-accessories",{paper_type:"plain_uncoated",condition:"clean_dry"}),...otherChoices("paper-hold")],paperRule,"비닐 코팅이나 제거하기 어려운 이물질이 있는 종이는 일반 종이와 구분해야 해요."),
  step("paper-accessories","question","코팅 표지·스프링·스티커 등 다른 재질이 남아 있나요?","inspect",["body"],[choice("none","다른 재질이 없어요","paper-stack",{accessories:"none"}),choice("present","다른 재질이 있어요","paper-hold"),choice("unknown","모르겠어요","paper-hold")],paperRule,"다른 재질은 종이에서 제거해야 해요. 부품 종류를 확인하지 않고 모두 같은 곳에 버리지 않아요."),
  action("paper-stack","종이를 반듯하게 펴서 쌓고 흩날리지 않게 묶어 주세요.","sort",["body"],"paper-bin","paper-hold",{},paperRule,"젖지 않은 종이를 모아 묶으면 다른 재질과 섞이거나 흩날리는 것을 줄일 수 있어요.","젖었거나 정리하기 어려우면 지금 상태를 더 확인해 주세요.","paper-stack"),
  destination("paper-bin","body","paper","마른 비코팅 종이류",paperRule,"paper-complete"),complete("paper-complete",paperRule),hold("paper-hold",["body"],paperRule,"코팅·오염이나 붙어 있는 부품의 재질을 더 확인해야 해요."),
]);

/** The optional attachment paths retain original presence facts for shared part rules. */
function boxAttachments(prefix: string, item: "cardboard_box"|"foam_box", next: string, bodyRule: string[]): Step[] {
  const tapeRule=[`${item}-tape`], labelRule=[`${item}-shipping-label`], held=`${prefix}-hold`;
  return [step(`${prefix}-attachments`,"question","일반 포장 테이프나 접착식 택배 송장이 붙어 있나요? 다른 부품이 있으면 따로 확인해 주세요.","inspect",["tape","label"],[
    choice("none","아무것도 붙어 있지 않아요",next,{attachments:"none",tape:"none",label:"none"}),
    choice("tape","테이프만 있어요",`${prefix}-tape-detach`,{attachments:"tape",tape:"present",label:"none"}),
    choice("label","접착식 송장만 있어요",`${prefix}-label-detach`,{attachments:"shipping_label",tape:"none",label:"present"}),
    choice("both","테이프와 송장이 모두 있어요",`${prefix}-tape-detach-both`,{attachments:"tape_and_label",tape:"present",label:"present"}),...otherChoices(held),
  ],bodyRule,"일반 포장 테이프와 접착식 송장은 본체와 재질이 달라 떼어 종량제봉투로 모아요."),
  ...[false,true].flatMap(both=>{const suffix=both?"-both":"";return [
    action(`${prefix}-tape-detach${suffix}`,"테이프 끝을 잡아 상자에서 천천히 떼어 주세요.","detach",["tape","body"],`${prefix}-tape-bin${suffix}`,held,{tape_removed:"yes"},tapeRule,"테이프가 붙어 있으면 종이나 스티로폼 본체에 다른 재질이 섞이게 돼요.","테이프가 안 떨어지면 본체를 부수거나 가열하지 마세요."),
    destination(`${prefix}-tape-bin${suffix}`,"tape","general","포장 테이프: 일반쓰레기 종량제봉투",tapeRule,both?`${prefix}-label-detach`:next),
  ];}),
  action(`${prefix}-label-detach`,"접착식 택배 송장의 끝을 잡아 상자에서 떼어 주세요.","detach",["label","body"],`${prefix}-label-bin`,held,{label_removed:"yes"},labelRule,"접착식 송장은 종이·스티로폼 본체에서 분리해 종량제봉투로 모아요.","송장이 안 떨어지면 억지로 긁거나 본체를 부수지 마세요."),
  destination(`${prefix}-label-bin`,"label","general","접착식 택배 송장: 일반쓰레기 종량제봉투",labelRule,next)];
}
const attachmentFacts={attachments:fact("none","tape","shipping_label","tape_and_label"),tape:fact("present","none"),label:fact("present","none"),tape_removed:fact("yes"),label_removed:fact("yes")};
const boxRule=["cardboard-clean"];
const box=flow("cardboard-box","cardboard_box",{material:fact("cardboard"),condition:fact("clean_dry"),...attachmentFacts},[
  step("box-type","confirm","마르고 깨끗하며 코팅되지 않은 골판지 상자인가요?","inspect",["body"],[choice("yes","해당 골판지 상자예요","box-attachments",{material:"cardboard",condition:"clean_dry"}),...otherChoices("box-hold")],boxRule,"골판지는 젖음·기름·비닐 코팅 여부를 확인해야 종이류로 모을 수 있어요."),
  ...boxAttachments("box","cardboard_box","box-unfold",boxRule),
  action("box-unfold","접힌 날개를 열어 상자를 반듯하게 펴서 쌓아 주세요.","unfold",["body"],"box-bin","box-hold",{},boxRule,"송파구 안내서는 테이프·송장을 제거한 상자를 펴서 쌓도록 안내해요.","상자가 안 펴지면 도구로 찌르거나 무리하게 힘주지 마세요."),
  destination("box-bin","body","paper","골판지 상자: 종이류",boxRule,"box-complete"),complete("box-complete",boxRule),hold("box-hold",["body","tape","label"],boxRule,"상자의 코팅·오염이나 떨어지지 않는 부품을 더 확인해야 해요."),
]);
const foamRule=["foam-packaging-clean"];
const foam=flow("foam-box","foam_box",{material:fact("eps_packaging"),condition:fact("empty_clean","removable_residue"),color:fact("white"),packaging_use:fact("non_food","food","electronic"),contents:fact("empty"),...attachmentFacts},[
  step("foam-use","confirm","이 스티로폼 포장재는 어떤 물건을 담거나 보호했나요?","inspect",["body"],[choice("non_food","비식품 생활용품 포장이에요","foam-type",{packaging_use:"non_food"}),choice("food","식품 포장이에요","foam-conflict",{packaging_use:"food"}),choice("electronic","전자제품 완충재예요","foam-return",{packaging_use:"electronic"}),...otherChoices("foam-hold")],foamRule,"식품 포장용은 송파구 자료 간 조건이 달라요. 전자제품 완충재는 구입처 반납을 먼저 확인해요."),
  step("foam-type","confirm","흰색이며 코팅·무늬·다른 재질 접착이 없는 EPS 포장재인가요?","inspect",["body"],[choice("yes","흰색 비코팅 EPS예요","foam-attachments",{material:"eps_packaging",color:"white"}),...otherChoices("foam-hold")],foamRule,"유색·코팅·건축용 스티로폼을 흰색 비식품 포장용 EPS와 같은 것으로 보지 않아요."),
  ...boxAttachments("foam","foam_box","foam-empty",foamRule),
  action("foam-empty","상자 안의 물건을 꺼내 빈 상태로 준비해 주세요.","empty",["body"],"foam-clean","foam-hold",{contents:"empty"},foamRule,"내용물을 비운 포장용 EPS에만 이 배출 기준을 적용해요.","안에 남은 물건을 안전하게 꺼낼 수 없으면 작업을 멈추세요."),
  action("foam-clean","빈 스티로폼에 묻은 이물질을 물로 헹궈 없애 주세요.","rinse",["body"],"foam-bin","foam-hold",{condition:"empty_clean"},foamRule,"흰색 포장용 EPS도 이물질과 다른 재질을 제거해야 해요.","이물질이 안 없어지면 부수거나 잘라내지 말고 확인해 주세요."),
  destination("foam-bin","body","foam","흰색 비식품 포장용 스티로폼류",foamRule,"foam-complete"),complete("foam-complete",foamRule),
  hold("foam-hold",["body","tape","label"],foamRule,"용도·재질·색 또는 분리·세척이 어려운 부분을 더 확인해야 해요."),
  hold("foam-conflict",["body"],foamRule,"식품용 EPS는 송파구 웹 안내와 안내서의 기준이 서로 달라요. 현재 적용 기준을 확인할 때까지 그대로 두세요."),
  hold("foam-return",["body"],foamRule,"전자제품 완충재는 송파구 안내에 따라 구입처 반납 가능 여부를 먼저 확인해 주세요."),
]);

const cartonRule=["carton-empty-separated"], strawRule=["coach-carton-straw-prepared"], wrapperRule=["coach-carton-film-prepared"];
const carton=flow("drink-carton","drink_carton",{carton_type:fact("regular","aseptic"),contents:fact("empty"),accessories:fact("none","clean_pp_straw","clean_film","clean_pp_straw_and_film"),straw:fact("pp","none"),film:fact("pp_pe","none"),straw_removed:fact("yes"),film_removed:fact("yes"),clean:fact("yes"),dry:fact("yes"),straw_prepared:fact("yes"),film_prepared:fact("yes")},[
  step("carton-type","confirm","우유·주스·두유 등의 종이팩인가요? 표시에서 일반팩과 멸균팩을 구분해 주세요.","inspect",["body"],[choice("regular","일반 종이팩이에요","carton-accessories",{carton_type:"regular"}),choice("aseptic","멸균 종이팩이에요","carton-accessories",{carton_type:"aseptic"}),...otherChoices("carton-hold")],cartonRule,"일반 종이팩과 멸균팩은 각각 모아야 하며 일반 종이류와 섞지 않아요."),
  step("carton-accessories","question","분리되는 단일 PP 빨대나 PP·PE 포장비닐이 있나요? 뚜껑 등 다른 부품은 별도 확인해 주세요.","inspect",["straw","film"],[
    choice("none","빨대·비닐·다른 부품이 없어요","carton-empty",{accessories:"none",straw:"none",film:"none"}),
    choice("straw","단일 PP 빨대만 있어요","carton-straw",{straw:"pp",film:"none"}),
    choice("film","PP·PE 비닐만 있어요","carton-film",{straw:"none",film:"pp_pe"}),
    choice("both","해당 빨대와 비닐이 모두 있어요","carton-straw-both",{straw:"pp",film:"pp_pe"}),...otherChoices("carton-hold"),
  ],cartonRule,"종이·복합 빨대를 PP 빨대로 추정하지 않아요. 팩과 다른 재질은 따로 준비해야 해요."),
  ...[false,true].flatMap(both=>{const suffix=both?"-both":"";return [
    action(`carton-straw${suffix}`,"PP 빨대를 팩과 포장비닐에서 빼서 따로 두세요.","detach",["straw","body"],`carton-straw-clean${suffix}`,"carton-hold",{straw_removed:"yes"},strawRule,"단일 PP 빨대는 종이팩에 붙여 두지 않고 플라스틱류로 모아요.","빨대를 분리할 수 없으면 팩을 찌르거나 억지로 당기지 마세요."),
    action(`carton-straw-clean${suffix}`,"빨대 안팎에 남은 음료를 물로 씻어 주세요.","rinse",["straw"],`carton-straw-bin${suffix}`,"carton-hold",both?{straw_prepared:"yes"}:{straw_prepared:"yes",accessories:"clean_pp_straw"},strawRule,"깨끗한 단일 PP 빨대에만 플라스틱 배출 기준을 적용해요.","빨대 안쪽의 음료를 씻기 어려우면 따로 확인해야 해요."),
    destination(`carton-straw-bin${suffix}`,"straw","plastic","깨끗한 단일 PP 빨대: 플라스틱류",strawRule,both?"carton-film-both":"carton-empty"),
  ];}),
  ...[false,true].flatMap(both => { const suffix = both ? "-both" : ""; return [
    action(`carton-film${suffix}`,"빨대 포장비닐을 종이팩과 빨대에서 떼어 주세요.","detach",["film","body"],`carton-film-clean${suffix}`,"carton-hold",{film_removed:"yes"},wrapperRule,"PP·PE 포장비닐은 종이팩과 분리해서 비닐류로 모아요.","포장비닐이 안 떨어지면 억지로 뜯지 마세요."),
    action(`carton-film-clean${suffix}`,"분리한 포장비닐의 이물질을 없애 주세요.","rinse",["film"],`carton-film-bin${suffix}`,"carton-hold",{film_prepared:"yes",accessories:both?"clean_pp_straw_and_film":"clean_film"},wrapperRule,"비닐은 이물질 없이 모아 흩날리지 않게 배출해요.","비닐의 이물질을 없앨 수 없으면 지금 상태를 더 확인해 주세요."),
    destination(`carton-film-bin${suffix}`,"film","vinyl","빨대 포장비닐: 비닐류",wrapperRule,"carton-empty"),
  ]; }),
  action("carton-empty","음료를 다 사용해 종이팩을 빈 상태로 준비해 주세요.","empty",["body"],"carton-rinse","carton-hold",{contents:"empty"},cartonRule,"내용물이 남지 않은 종이팩을 헹구고 말려 배출해요.","음료가 남았거나 비우기 어려우면 처리 방법부터 확인해 주세요."),
  action("carton-rinse","빈 팩 안쪽을 물로 헹궈 남은 음료를 없애 주세요.","rinse",["body"],"carton-dry","carton-hold",{clean:"yes"},cartonRule,"종이팩에 남은 음료는 물로 헹궈 제거해야 해요.","팩 안쪽을 씻기 어려우면 억지로 찢지 말고 확인해 주세요."),
  action("carton-dry","헹군 팩의 물기를 빼고 말려 주세요.","inspect",["body"],"carton-bin","carton-hold",{dry:"yes"},cartonRule,"종이팩은 헹군 뒤 말려서 일반팩과 멸균팩을 각각 모아요.","아직 젖어 있으면 말린 뒤 직접 선택해 주세요. 가열하지 마세요.","carton-dry"),
  destination("carton-bin","body","carton","종이팩 전용수거함 · 일반팩과 멸균팩 각각",cartonRule,"carton-complete"),complete("carton-complete",cartonRule),
  hold("carton-hold",["body","straw","film"],cartonRule,"팩의 종류나 부속품 재질, 비움·세척·건조 상태를 더 확인해야 해요."),
]);
const vinylRule=["snack-film-clean"];
const vinyl=flow("vinyl-packaging","vinyl_packaging",{material:fact("film"),condition:fact("empty_clean"),contents:fact("empty")},[
  step("vinyl-type","confirm","과자 봉지나 일회용 봉투 같은 비닐 포장재인가요? 고무·천·장판은 제외해 주세요.","inspect",["body"],[choice("yes","비닐 포장재·봉투예요","vinyl-empty",{material:"film"}),...otherChoices("vinyl-hold")],vinylRule,"상품명이나 분리배출 표시 유무보다 비닐 포장재인지 확인해요. 고무·섬유는 비닐류가 아니에요."),
  action("vinyl-empty","포장 안의 내용물을 다 사용하고 비워 주세요.","empty",["body"],"vinyl-clean","vinyl-hold",{contents:"empty"},vinylRule,"내용물을 비운 비닐 포장재에 배출 기준을 적용해요.","남은 내용물을 어떻게 처리할지 모르면 임의로 붓지 마세요."),
  action("vinyl-clean","비닐 안팎에 묻은 이물질을 없애 주세요.","rinse",["body"],"vinyl-bin","vinyl-hold",{condition:"empty_clean"},vinylRule,"이물질이 제거된 비닐은 투명·반투명 봉투에 모아 흩날리지 않게 배출해요.","이물질이 떨어지지 않으면 비닐류로 확정하지 말고 확인해 주세요."),
  destination("vinyl-bin","body","vinyl","비닐류 · 투명·반투명 봉투에 모으기",vinylRule,"vinyl-complete"),complete("vinyl-complete",vinylRule),hold("vinyl-hold",["body"],vinylRule,"비닐 포장재 여부나 제거되지 않는 오염의 처리를 더 확인해야 해요."),
]);
const toothbrushRule=["toothbrush-manual"];
const toothbrush=flow("manual-toothbrush","toothbrush",{kind:fact("manual_plastic")},[
  step("toothbrush-type","confirm","배터리가 없는 일반 플라스틱 수동 칫솔인가요?","inspect",["body"],[choice("manual","플라스틱 수동 칫솔이에요","toothbrush-bin",{kind:"manual_plastic"}),choice("electric","전동·배터리 칫솔이에요","toothbrush-electric"),...otherChoices("toothbrush-hold")],toothbrushRule,"일반 칫솔은 솔·고무·플라스틱이 섞여 있어 플라스틱 용기류에 넣지 않아요."),
  destination("toothbrush-bin","body","general","일반 플라스틱 칫솔: 종량제봉투",toothbrushRule,"toothbrush-complete"),complete("toothbrush-complete",toothbrushRule),
  hold("toothbrush-hold",["body"],toothbrushRule,"나무·다른 재질 칫솔이나 구조가 확인되지 않는 제품은 처리 방법을 더 확인해야 해요."),
  hold("toothbrush-electric",["body"],["electronic-official-handoff","battery-official-handoff"],"전동 칫솔은 일반 수동 칫솔과 달라요. 배터리를 억지로 꺼내지 말고 송파구 폐가전·폐전지 수거 경로를 확인해 주세요."),
]);
const gelRule=["ice-gel-intact"],waterRule=["ice-water-film"];
const ice=flow("ice-pack","ice_pack",{coolant:fact("gel","water"),integrity:fact("intact","leaking"),packaging:fact("film"),contents:fact("empty")},[
  step("ice-coolant","confirm","성분 표시를 확인해 주세요. 물 100%인가요, SAP 젤인가요?","inspect",["body"],[choice("gel","SAP 젤로 확인했어요","ice-gel-integrity",{coolant:"gel"}),choice("water","물 100%로 확인했어요","ice-water-integrity",{coolant:"water"}),choice("other","전분·혼합·다른 성분이에요","ice-hold"),choice("unknown","모르겠어요","ice-hold")],[...gelRule,...waterRule],"성분은 겉모습으로 알 수 없어요. 물 100%와 젤은 내용물 처리 방법이 달라요."),
  ...["gel","water"].map(type=>step(`ice-${type}-integrity`,"question","포장이 찢어지거나 내용물이 새는 곳이 있나요?","inspect",["body"],[choice("intact","찢어짐·누출이 없어요",type==="gel"?"ice-gel-bin":"ice-packaging",{integrity:"intact"}),choice("leaking","찢어졌거나 새요","ice-hold",{integrity:"leaking"}),choice("unknown","모르겠어요","ice-hold")],type==="gel"?gelRule:waterRule,"누출이 없는 포장에만 현재 안내를 적용해요. 성분을 확인하려고 포장을 열지 마세요.")),
  destination("ice-gel-bin","body","general","SAP 젤 아이스팩: 열지 말고 통째로 종량제봉투",gelRule,"ice-gel-complete"),complete("ice-gel-complete",gelRule),
  step("ice-packaging","question","물 100% 아이스팩의 포장이 비닐인가요?","inspect",["body"],[choice("film","비닐 포장재예요","ice-water-empty",{packaging:"film"}),...otherChoices("ice-hold")],waterRule,"빈 비닐 포장재에만 비닐류 배출 방법을 적용해요. 다른 포장 재질은 별도 확인이 필요해요."),
  action("ice-water-empty","물 100%로 확인한 팩만 개봉부를 열어 물을 하수구에 비워 주세요. 열기 어려우면 멈추세요.","empty",["body"],"ice-water-bin","ice-hold",{contents:"empty"},waterRule,"성분이 물 100%인 경우만 물을 비울 수 있어요. 젤·첨가물·미확인 냉매에는 적용하지 않아요.","개봉이 어려우면 찌르거나 억지로 뜯지 마세요.","water-pack-empty"),
  destination("ice-water-bin","body","vinyl","물을 비운 아이스팩 비닐 포장재: 비닐류",waterRule,"ice-water-complete"),complete("ice-water-complete",waterRule),
  hold("ice-hold",["body"],[...gelRule,...waterRule],"성분·포장·누출 여부가 확인되지 않았거나 안전하게 열기 어려워요. 포장을 더 열거나 내용물을 붓지 마세요."),
]);

function handoff(categoryId:string,ruleId:string,text:string):GuideFlow {
  const s=hold(`${categoryId}-official`,["body"],[ruleId],text);
  // This is an official handoff, not a disposal bin confirmation or a booking made by the app.
  s.text=text; s.speechText=text;
  return flow(`${categoryId}-handoff`,categoryId,{},[s]);
}
export const householdFlows: GuideFlow[]=[scrap,plastic,glass,paper,box,carton,vinyl,foam,toothbrush,ice,
  handoff("battery","battery-official-handoff","배터리는 일반 포장재와 따로 확인해요. 억지로 분해하지 말고 동주민센터의 폐전지·이차전지 수거함을 확인해 주세요."),
  handoff("electronic","electronic-official-handoff","전자제품은 분해하지 말고 송파구 폐소형·대형 가전 수거 안내를 확인해 주세요. 대형가전은 1599-0903에서 대상·예약을 확인해요."),
  handoff("bulky","bulky-official-handoff","가구 등 대형폐기물은 송파구 배출신청에서 품목·수거업체를 확인해 주세요. 일반 포장재 수거함에 넣지 않아요."),
  handoff("hazardous","hazardous-official-handoff","가스·스프레이·위험 내용물은 뚫거나 가열하지 마세요. 제품 표시를 준비해 송파구 재활용팀 02-2147-6377~6379에 문의해 주세요."),
];
export const householdCategories: GuideCatalog["categories"]=[
  {id:"metal_scrap",label:"고철·금속 물건",description:"작은 철·알루미늄·스테인리스 물건. 캔·전자제품·복합 부품은 구분",roles:["body"]},
  {id:"plastic_container",label:"일반 플라스틱 용기",description:"유색 PET·PE·PP·PS 용기·트레이, 뚜껑·필름. 투명 음료 PET와 펌프 용기는 별도",roles:["body","lid","film"]},
  {id:"glass_bottle",label:"식품·음료 유리병",description:"일반 식품·음료 유리병과 금속 뚜껑. 보증금 병·파손·내열유리 별도 확인",roles:["body","lid"]},
  {id:"paper",label:"종이·신문·책",description:"마른 비코팅 종이·신문·책. 종이팩·골판지는 별도, 코팅·다른 부품 확인",roles:["body"]},
  {id:"cardboard_box",label:"골판지 상자",description:"택배·포장용 골판지 상자와 포장 테이프·접착식 송장",roles:["body","tape","label"]},
  {id:"drink_carton",label:"우유·두유·음료팩",description:"일반팩·멸균팩, 단일 PP 빨대·PP/PE 포장비닐을 각각 확인",roles:["body","straw","film"]},
  {id:"vinyl_packaging",label:"비닐 포장재·봉투",description:"과자 봉지·일회용 비닐봉투 등. 상품명보다 재질·내용물·오염 확인",roles:["body"]},
  {id:"foam_box",label:"스티로폼 포장재",description:"흰색 EPS 상자·완충재와 테이프·송장. 식품 포장·전자제품 완충재는 따로 확인",roles:["body","tape","label"]},
  {id:"toothbrush",label:"칫솔",description:"일반 플라스틱 수동 칫솔. 전동·나무 제품은 별도 경로",roles:["body"]},
  {id:"ice_pack",label:"아이스팩",description:"겉모습으로 성분을 단정하지 않고 물100%·SAP젤·미확인 성분과 포장·누출 확인",roles:["body"]},
  {id:"battery",label:"배터리·건전지",description:"건전지·보조배터리·충전지: 인식되면 공식 폐전지 수거 문의만 안내",roles:["body"]},
  {id:"electronic",label:"전자제품·전동제품",description:"전기·배터리 사용 제품: 인식되면 송파구 폐가전 수거 문의만 안내",roles:["body"]},
  {id:"bulky",label:"가구·대형폐기물",description:"가구·매트리스 등 대형 물건: 인식되면 송파구 배출신청 경로만 안내",roles:["body"]},
  {id:"hazardous",label:"가스·위험 내용물",description:"가스·스프레이·화학물질·남은 페인트 등: 인식되면 공식 안전 처리 문의만 안내",roles:["body"]},
];

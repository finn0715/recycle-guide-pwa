import { describe, expect, it } from "vitest";
import { ITEMS, type ItemId } from "@/lib/contracts";
import { RULES, SOURCES } from "@/data/disposal-rules";
import { FACT_REGISTRY, InvalidFactsError, assertRuleData, resolveRules, validateFacts } from "@/lib/server/rules";

const cases: Record<ItemId, Record<string, string>> = {
  pump_bottle: { material: "plastic", contents: "empty", pump: "composite", label: "film" },
  clear_pet_bottle: { bottle_type: "clear_beverage", contents: "empty", label: "film", cap: "present" },
  drink_carton: { carton_type: "regular", contents: "empty", accessories: "clean_pp_straw_and_film" },
  cardboard_box: { material: "cardboard", condition: "clean_dry", attachments: "tape_and_label" },
  foam_box: { material: "eps_packaging", condition: "empty_clean", color: "white", packaging_use: "non_food", attachments: "tape_and_label" },
  snack_bag: { material: "film", condition: "empty_clean" },
  takeaway_container: { material: "recyclable_plastic", condition: "empty_clean", cover: "clean_lid_and_film" },
  glass_jar: { material: "food_glass", integrity: "intact", contents: "empty", lid: "metal" },
  toothbrush: { kind: "manual_plastic" },
  ice_pack: { coolant: "gel", integrity: "intact" },
};
const run = (item: ItemId, facts = cases[item]) => resolveRules(item, facts, { confirmedFactKeys: Object.keys(facts) });

describe("reviewed Songpa rules", () => {
  it.each(Object.keys(ITEMS) as ItemId[])("has sourced representative guidance for %s", (item) => {
    const result = run(item);
    expect(result.status).toBe("ready");
    expect(result.question).toBeNull();
    expect(result.guidance?.region).toBe("songpa");
    expect(result.guidance?.steps.length).toBeGreaterThan(0);
    expect(result.guidance?.sources.length).toBeGreaterThan(0);
    const sourceIds = result.guidance!.sources.map((s) => s.id);
    for (const part of result.guidance!.parts) {
      expect(part.sourceIds.length).toBeGreaterThan(0);
      expect(part.sourceIds.every((id) => sourceIds.includes(id))).toBe(true);
    }
  });

  it.each(Object.keys(ITEMS) as ItemId[])("reaches %s guidance within five fact questions", (item) => {
    const facts: Record<string, string> = {};
    let result = run(item, facts);
    let count = 0;
    while (result.status === "needs_info" && count < 6) {
      const entry = Object.entries(FACT_REGISTRY[item]).find(([, fact]) => fact.question.text === result.question?.text);
      expect(entry).toBeDefined();
      const key = entry![0];
      expect(facts[key]).toBeUndefined();
      facts[key] = cases[item][key];
      count++;
      result = run(item, facts);
    }
    expect(result.status).toBe("ready");
    expect(count).toBeLessThanOrEqual(item === "foam_box" ? 5 : 4);
  });

  it("asks only one canonical question for a missing required fact", () => {
    const result = run("pump_bottle", { ...cases.pump_bottle, contents: "unknown" });
    expect(result.status).toBe("needs_info");
    expect(result.question?.text).toBe(FACT_REGISTRY.pump_bottle.contents.question.text);
    expect(result.question?.choices).toContain("확인하기 어려워요");
    expect(result.question?.allowPhoto).toBe(true);
    expect(result.guidance).toBeNull();
  });

  it("never confirms hidden facts from a photo alone", () => {
    const result = resolveRules("pump_bottle", cases.pump_bottle);
    expect(result.status).toBe("needs_info");
    expect(result.guidance).toBeNull();
  });

  it.each([
    ["pump_bottle", "material"],
    ["pump_bottle", "label"],
    ["pump_bottle", "contents"],
    ["ice_pack", "coolant"],
  ] as [ItemId, string][])("accepts supporting photos for %s/%s without granting confirmation", (item, key) => {
    const knownFacts = cases[item];
    const confirmedFactKeys = Object.keys(knownFacts).filter((factKey) => factKey !== key);
    const pending = resolveRules(item, { ...knownFacts, [key]: "unknown" }, { confirmedFactKeys });
    expect(pending.status).toBe("needs_info");
    expect(pending.question?.text).toBe(FACT_REGISTRY[item][key].question.text);
    expect(pending.question?.allowPhoto).toBe(true);
    expect(FACT_REGISTRY[item][key].evidence).toBe("user_only");

    const withPhotoFact = resolveRules(item, knownFacts, { confirmedFactKeys });
    expect(withPhotoFact.status).toBe("needs_info");
    expect(withPhotoFact.question).toEqual(pending.question);
    expect(withPhotoFact.guidance).toBeNull();

    const photoOnly = resolveRules(item, { [key]: knownFacts[key] });
    expect(photoOnly.status).toBe("needs_info");
    expect(photoOnly.guidance).toBeNull();
  });

  it("allows visual evidence only for registered visible facts", () => {
    const result = resolveRules("clear_pet_bottle", cases.clear_pet_bottle, {
      confirmedFactKeys: ["bottle_type", "contents", "label"],
    });
    expect(result.status).toBe("ready");
    expect(FACT_REGISTRY.clear_pet_bottle.cap.evidence).toBe("photo_allowed");
  });

  it("ends with uncertainty after an explicit unable-to-answer response", () => {
    const result = resolveRules("ice_pack", { coolant: "unknown" }, { unableToAnswer: ["coolant"] });
    expect(result.status).toBe("uncertain");
    expect(result.question).toBeNull();
    expect(result.guidance).toBeNull();
    expect(result.message).toContain("확인");
  });

  it("recloses the PET cap and does not send it to separate plastic", () => {
    const guidance = run("clear_pet_bottle").guidance!;
    expect(guidance.steps.join(" ")).toMatch(/뚜껑.*닫/);
    expect(guidance.parts.find((p) => p.name === "뚜껑")?.disposal).toContain("본체");
  });

  it("sends the composite pump to general waste separately from the bottle", () => {
    const parts = run("pump_bottle").guidance!.parts;
    expect(parts.find((p) => p.name === "복합재질 펌프")?.disposal).toBe("일반쓰레기 종량제봉투");
    expect(parts.find((p) => p.name === "용기")?.disposal).toBe("플라스틱류");
  });

  it("distinguishes regular cartons and aseptic cartons from ordinary paper", () => {
    for (const carton_type of ["regular", "aseptic"]) {
      const guidance = run("drink_carton", { carton_type, contents: "empty", accessories: "none" }).guidance!;
      expect(guidance.steps.join(" ")).toContain("일반 종이");
      expect(guidance.steps.join(" ")).toContain("우유팩과 멸균팩");
    }
  });

  it("handles water ice packs only with confirmed coolant and film packaging", () => {
    const water = run("ice_pack", { coolant: "water", packaging: "film", integrity: "intact" });
    expect(water.status).toBe("ready");
    expect(water.guidance?.steps.join(" ")).toContain("물만");
    expect(run("ice_pack", { coolant: "water", packaging: "unknown", integrity: "intact" }).status).toBe("needs_info");
    expect(run("ice_pack", { coolant: "gel", integrity: "leaking" }).status).toBe("uncertain");
    expect(run("ice_pack").guidance?.steps.join(" ")).toContain("자르지");
  });

  it("keeps starch-labelled coolant distinct from water and SAP gel", () => {
    expect(validateFacts("ice_pack", { coolant: "starch" })).toEqual({ coolant: "starch" });
    expect(FACT_REGISTRY.ice_pack.coolant.choices.starch).toContain("전분");
    expect(FACT_REGISTRY.ice_pack.coolant.evidence).toBe("user_only");
    expect(FACT_REGISTRY.ice_pack.coolant.description).toContain("성분");
  });

  it.each([
    { coolant: "starch" },
    { coolant: "starch", integrity: "intact", packaging: "film" },
    { coolant: "starch", integrity: "leaking", packaging: "coated_paper" },
  ] as Record<string, string>[])("does not apply water or gel disposal to a starch variant: %j", (facts) => {
    const result = run("ice_pack", facts);
    expect(result.status).toBe("uncertain");
    expect(result.question).toBeNull();
    expect(result.guidance).toBeNull();
    expect(result.message).toContain("전분");
    expect(RULES.filter((rule) => rule.item === "ice_pack").every((rule) => !rule.conditions.coolant?.includes("starch"))).toBe(true);
  });

  it("does not turn mere discoloration into general waste", () => {
    const result = run("takeaway_container", { material: "recyclable_plastic", condition: "color_only", cover: "none" });
    expect(result.status).toBe("ready");
    expect(result.guidance?.parts[0].disposal).toBe("플라스틱류");
  });

  it("asks what remains before classifying food and never generalizes all leftovers", () => {
    const facts = { material: "recyclable_plastic", condition: "food_remaining" };
    expect(run("takeaway_container", facts).status).toBe("needs_info");
    const bones = run("takeaway_container", { ...facts, leftovers: "bones_shells", cover: "none" });
    expect(bones.status).toBe("ready");
    expect(bones.guidance!.parts.find((p) => p.name === "뼈·껍데기")?.disposal).toBe("일반쓰레기 종량제봉투");
    expect(run("takeaway_container", { ...facts, leftovers: "mixed_other" }).status).toBe("uncertain");
  });

  it("requires all contents including liquids to be emptied before removable-residue guidance", () => {
    const fact = FACT_REGISTRY.takeaway_container.condition;
    expect(fact.choices.removable_residue).toContain("내용물은 모두 비웠고");
    expect(fact.choices.food_remaining).toContain("국물");
    expect(fact.choices.food_remaining).toContain("기름");
    expect(fact.description).toContain("food_remaining");
    expect(FACT_REGISTRY.takeaway_container.leftovers.choices.mixed_other).toMatch(/국물.*기름/);
    const contentsRemaining = { material: "recyclable_plastic", condition: "food_remaining" };
    expect(run("takeaway_container", contentsRemaining).status).toBe("needs_info");
    const result = run("takeaway_container", { ...contentsRemaining, leftovers: "mixed_other" });
    expect(result.status).toBe("uncertain");
    expect(result.guidance).toBeNull();
    expect(result.message).toMatch(/기름.*국물/);
  });

  it.each([
    ["toothbrush", { kind: "electric" }],
    ["pump_bottle", { ...cases.pump_bottle, contents: "remaining" }],
    ["foam_box", { material: "coated", condition: "empty_clean" }],
    ["snack_bag", { material: "film", condition: "stuck_residue" }],
  ] as [ItemId, Record<string, string>][])("does not invent a rule for %s edge cases", (item, facts) => {
    const result = run(item, facts);
    expect(result.status).toBe("uncertain");
    expect(result.guidance).toBeNull();
  });
});

describe("fact and source boundaries", () => {
  it("accepts only item-specific values and rejects foreign facts", () => {
    expect(validateFacts("ice_pack", { coolant: "unknown" })).toEqual({ coolant: "unknown" });
    for (const raw of [{ coolant: "edible" }, { arbitrary: "water" }, { coolant: 1 }, { sourceIds: ["invented"] }, [], null]) {
      expect(() => validateFacts("ice_pack", raw)).toThrow(InvalidFactsError);
    }
    expect(() => resolveRules("ice_pack", { coolant: "edible" })).toThrow(InvalidFactsError);
    expect(() => resolveRules("ice_pack", {}, { confirmedFactKeys: ["invented"] })).toThrow(InvalidFactsError);
  });

  it("validates every rule, condition, review status and referenced source", () => {
    expect(() => assertRuleData(RULES, SOURCES)).not.toThrow();
    const rule = structuredClone(RULES[0]);
    rule.parts[0].sourceIds = ["invented"];
    expect(() => assertRuleData([rule], SOURCES)).toThrow(/source/i);
    const invalid = structuredClone(RULES[0]);
    invalid.conditions.material = ["made-up"];
    expect(() => assertRuleData([invalid], SOURCES)).toThrow(/fact/i);
  });

  it("returns detached guidance so a consumer cannot mutate the trusted data", () => {
    run("toothbrush").guidance!.steps[0] = "invented disposal";
    expect(run("toothbrush").guidance!.steps[0]).not.toBe("invented disposal");
  });
});

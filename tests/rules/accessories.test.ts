import { describe, expect, it } from "vitest";
import type { ItemId } from "@/lib/contracts";
import { FACT_REGISTRY, resolveRules, type Facts } from "@/lib/server/rules";

const examples: { item: ItemId; key: string; facts: Facts }[] = [
  { item: "drink_carton", key: "accessories", facts: { carton_type: "regular", contents: "empty", accessories: "clean_pp_straw_and_film" } },
  { item: "cardboard_box", key: "attachments", facts: { material: "cardboard", condition: "clean_dry", attachments: "tape_and_label" } },
  { item: "foam_box", key: "attachments", facts: { material: "eps_packaging", condition: "empty_clean", color: "white", packaging_use: "non_food", attachments: "tape_and_label" } },
  { item: "takeaway_container", key: "cover", facts: { material: "recyclable_plastic", condition: "empty_clean", cover: "clean_lid_and_film" } },
];
const run = (item: ItemId, facts: Facts) => resolveRules(item, facts, { confirmedFactKeys: Object.keys(facts) });

function expectParts(item: ItemId, facts: Facts, expected: Record<string, string>) {
  const result = run(item, facts);
  expect(result.status).toBe("ready");
  const parts = result.guidance!.parts;
  for (const [name, disposal] of Object.entries(expected)) {
    const part = parts.find((entry) => entry.name === name);
    expect(part?.disposal).toBe(disposal);
    expect(part!.sourceIds.length).toBeGreaterThan(0);
    expect(part!.sourceIds.every((id) => result.guidance!.sources.some((source) => source.id === id))).toBe(true);
  }
  expect(parts.length).toBe(Object.keys(expected).length + 1);
}

describe("reviewed accessories and complete results", () => {
  it.each(examples)("requires explicit accessory confirmation for $item", ({ item, key, facts }) => {
    const missing = { ...facts };
    delete missing[key];
    const result = run(item, missing);
    expect(result.status).toBe("needs_info");
    expect(result.question).toEqual(FACT_REGISTRY[item][key].question);
    expect(result.guidance).toBeNull();
    const photoOnlyAccessory = resolveRules(item, facts, { confirmedFactKeys: Object.keys(missing) });
    expect(photoOnlyAccessory.status).toBe("needs_info");
    expect(photoOnlyAccessory.question?.allowPhoto).toBe(true);
    const unable = resolveRules(item, missing, { confirmedFactKeys: Object.keys(missing), unableToAnswer: [key] });
    expect(unable.status).toBe("uncertain");
    expect(unable.question).toBeNull();
  });

  it.each(examples)("does not silently omit unreviewed accessories for $item", ({ item, key, facts }) => {
    const result = run(item, { ...facts, [key]: "other" });
    expect(result.status).toBe("uncertain");
    expect(result.guidance).toBeNull();
  });

  it.each(examples)("allows confirmed absence of accessories for $item", ({ item, key, facts }) => {
    expectParts(item, { ...facts, [key]: "none" }, {});
  });

  it.each([
    ["clean_pp_straw", { "PP 빨대": "플라스틱류" }],
    ["clean_film", { "빨대 포장비닐": "비닐류" }],
    ["clean_pp_straw_and_film", { "PP 빨대": "플라스틱류", "빨대 포장비닐": "비닐류" }],
  ] as [string, Record<string, string>][])("classifies carton accessories %s individually", (accessories, expected) => {
    expectParts("drink_carton", { ...examples[0].facts, accessories }, expected);
  });

  it.each(["cardboard_box", "foam_box"] as const)("separates adhesive tape and shipping labels from %s", (item) => {
    const facts = examples.find((entry) => entry.item === item)!.facts;
    expectParts(item, { ...facts, attachments: "tape" }, { "포장 테이프": "일반쓰레기 종량제봉투" });
    expectParts(item, { ...facts, attachments: "shipping_label" }, { "택배 송장": "일반쓰레기 종량제봉투" });
    expectParts(item, facts, { "포장 테이프": "일반쓰레기 종량제봉투", "택배 송장": "일반쓰레기 종량제봉투" });
  });

  it.each([
    ["clean_film", { "밀봉 필름": "비닐류" }],
    ["clean_plastic_lid", { "플라스틱 뚜껑": "플라스틱류" }],
    ["clean_lid_and_film", { "밀봉 필름": "비닐류", "플라스틱 뚜껑": "플라스틱류" }],
  ] as [string, Record<string, string>][])("classifies removable clean takeaway covers %s", (cover, expected) => {
    expectParts("takeaway_container", { ...examples[3].facts, cover }, expected);
  });

  it("requires the user choices to confirm separation, lid material and removable foam residue", () => {
    for (const key of ["clean_pp_straw", "clean_film", "clean_pp_straw_and_film"]) {
      expect(FACT_REGISTRY.drink_carton.accessories.choices[key]).toContain("분리");
    }
    expect(FACT_REGISTRY.takeaway_container.cover.choices.clean_lid_and_film).toContain("PET·PE·PP·PS");
    expect(FACT_REGISTRY.foam_box.condition.choices.removable_residue).toContain("씻으면 제거");
  });

  it("still asks about covers after selecting a remaining-food branch", () => {
    const facts = { material: "recyclable_plastic", condition: "food_remaining", leftovers: "plain_rice" };
    expect(run("takeaway_container", facts).question).toEqual(FACT_REGISTRY.takeaway_container.cover.question);
    const result = run("takeaway_container", { ...facts, cover: "clean_lid_and_film" });
    expect(result.status).toBe("ready");
    expect(result.guidance!.parts.map((part) => part.name)).toEqual(expect.arrayContaining(["남은 밥", "용기", "밀봉 필름", "플라스틱 뚜껑"]));
    expect(run("takeaway_container", { ...facts, cover: "other" }).status).toBe("uncertain");
  });

  it("does not lose accessories when the container itself has unremovable food residue", () => {
    const facts = { ...examples[3].facts, condition: "stuck_residue" };
    expectParts("takeaway_container", facts, { "밀봉 필름": "비닐류", "플라스틱 뚜껑": "플라스틱류" });
    expect(run("takeaway_container", facts).guidance!.parts[0].disposal).toBe("일반쓰레기 종량제봉투");
  });

  it.each(["color", "packaging_use"])("does not infer foam %s from incomplete evidence", (key) => {
    const facts = { ...examples[2].facts };
    delete facts[key];
    expect(run("foam_box", facts).question).toEqual(FACT_REGISTRY.foam_box[key].question);
  });

  it.each([
    { color: "colored" },
    { packaging_use: "food" },
    { packaging_use: "other" },
    { material: "coated" },
    { condition: "stuck_residue" },
  ] as Facts[])("does not resolve conflicting or unreviewed foam conditions %j", (change) => {
    const result = run("foam_box", { ...examples[2].facts, ...change });
    expect(result.status).toBe("uncertain");
    expect(result.guidance).toBeNull();
    expect(result.question).toBeNull();
  });
});

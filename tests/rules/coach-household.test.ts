import { describe, expect, it, vi } from "vitest";
import { COACH_CATALOG } from "@/data/coach-guides";
import { replayCoachHistory, validateCoachContext, type CoachHistory } from "@/lib/contracts/coach";
import { createCoachController } from "@/lib/client/coach-controller";
const uuid = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
function follow(category: string, choices: string[]) {
  const flow = COACH_CATALOG.flows.find(f => f.categoryId === category);
  expect(flow, category).toBeDefined();
  const history: CoachHistory = [];
  for (const choiceId of choices) {
    const current = replayCoachHistory(flow!, history);
    history.push({ stepId: current.step.id, choiceId });
  }
  const stepId = replayCoachHistory(flow!, history).step.id;
  return { history, ...validateCoachContext(COACH_CATALOG, {requestId:uuid, sessionId:uuid, objectId:uuid, revision:0, catalogVersion:COACH_CATALOG.version, flowId:flow!.id, stepId}, history) };
}
const happy = [
  { category:"metal_scrap", choices:["yes","none","done","done"], bins:{body:"metal"} },
  { category:"plastic_container", choices:["yes","none","done","done","done"], bins:{body:"plastic"} },
  { category:"glass_bottle", choices:["yes","intact","none","done","done","done"], bins:{body:"glass"} },
  { category:"paper", choices:["yes","none","done","done"], bins:{body:"paper"} },
  { category:"cardboard_box", choices:["yes","none","done","done"], bins:{body:"paper"} },
  { category:"drink_carton", choices:["regular","none","done","done","done","done"], bins:{body:"carton"} },
  { category:"vinyl_packaging", choices:["yes","done","done","done"], bins:{body:"vinyl"} },
  { category:"foam_box", choices:["non_food","yes","none","done","done","done"], bins:{body:"foam"} },
  { category:"toothbrush", choices:["manual","done"], bins:{body:"general"} },
  { category:"ice_pack", choices:["gel","intact","done"], bins:{body:"general"} },
  { category:"ice_pack", choices:["water","intact","film","done","done"], bins:{body:"vinyl"} },
];
describe("household preparation coverage", () => {
  it.each(happy)("guides $category from direct confirmations to part destinations", async ({ category, choices, bins }) => {
    const state = follow(category,choices);
    expect(state.step.kind).toBe("complete");
    expect(state.held).toBe(false);
    expect(Object.fromEntries(state.destinations.map(d => [d.partRole,d.bin]))).toEqual(bins);
    const controller = createCoachController({catalog:COACH_CATALOG,recognize:vi.fn()});
    controller.pickCategory(category); await controller.startGuidance();
    for (const choice of [...choices,"finish"]) expect(controller.choose(choice,controller.getSnapshot().current!.step.id)).toBe(true);
    expect(controller.getSnapshot().progress).toBe("complete");
    controller.dispose();
  });
  it.each(["metal_scrap","plastic_container","glass_bottle","paper","cardboard_box","drink_carton","vinyl_packaging","foam_box","toothbrush","ice_pack"])("keeps unknown %s conditions unresolved", category => {
    const state = follow(category,["unknown"]);
    expect(state.held).toBe(true);
    expect(state.destinations.every(d => d.bin === "hold")).toBe(true);
  });
  it("preserves food EPS conflict and unknown or starch ice coolant boundaries", () => {
    expect(follow("foam_box",["food"]).step.reason).toMatch(/충돌|서로/);
    for (const choice of ["unknown","other"]) expect(follow("ice_pack",[choice]).held).toBe(true);
    expect(follow("ice_pack",["water","leaking"]).held).toBe(true);
    expect(follow("ice_pack",["water","intact","film","cannot"]).held).toBe(true);
  });
  it.each(["battery","electronic","bulky","hazardous"])("only offers official collection or contact for %s", category => {
    const state = follow(category,[]);
    expect(state.step.kind).toBe("handoff");
    expect(state.destinations.every(d => d.bin === "hold")).toBe(true);
    expect(state.step.sourceIds.length).toBeGreaterThan(0);
  });
  it("keeps prepared cardboard tape while holding an unresolved label and drops it after correction", () => {
    const state = follow("cardboard_box",["yes","both","done","done","cannot"]);
    expect(Object.fromEntries(state.destinations.map(d => [d.partRole,d.bin]))).toEqual({tape:"general",body:"hold",label:"hold"});
    expect(replayCoachHistory(state.flow,state.history.slice(0,2)).destinations).toEqual([]);
    const corrected = follow("cardboard_box",["yes","none","unknown"]);
    expect(corrected.destinations.map(d => d.partRole)).toEqual(["body"]);
  });
  it("keeps accessory cleanliness unknown until the preparation response", () => {
    expect(follow("plastic_container",["yes","lid"]).facts.cover).toBeUndefined();
    expect(follow("drink_carton",["regular","straw"]).facts.accessories).toBeUndefined();
    expect(follow("plastic_container",["yes","lid","done","done"]).facts.cover).toBe("clean_plastic_lid");
    expect(follow("drink_carton",["regular","straw","done","done"]).facts.accessories).toBe("clean_pp_straw");
  });
  it("uses explicit empty and clean reports as preparation, not a failure", () => {
    const empty = follow("plastic_container",["yes","none","absent"]);
    expect(empty.step.id).toBe("plastic-rinse");
    expect(empty.facts.contents).toBe("empty");
    const clean = follow("plastic_container",["yes","none","absent","absent"]);
    expect(clean.step.id).toBe("plastic-bin");
    expect(clean.facts.condition).toBe("empty_clean");
    for (const category of ["cardboard_box","paper","drink_carton"]) {
      const f = COACH_CATALOG.flows.find(f => f.categoryId === category)!;
      for (const step of f.steps.filter(s => s.kind === "action" && !["empty","rinse"].includes(s.visual.action))) expect(step.choices.some(c => c.id === "absent")).toBe(false);
    }
  });
  it.each([
    {category:"plastic_container",first:"yes",key:"cover",cleanValue:"clean_lid_and_film",bins:{lid:"plastic",film:"vinyl",body:"hold"}},
    {category:"drink_carton",first:"regular",key:"accessories",cleanValue:"clean_pp_straw_and_film",bins:{straw:"plastic",film:"vinyl",body:"hold"}},
  ])("confirms both $category accessories only after both preparations and keeps their results",({category,first,key,cleanValue,bins})=>{
    expect(follow(category,[first,"both","done","done"]).facts[key]).toBeUndefined();
    const state=follow(category,[first,"both","done","done","done","done","done","done","cannot"]);
    expect(state.facts[key]).toBe(cleanValue);
    expect(state.held).toBe(true);
    expect(Object.fromEntries(state.destinations.map(d=>[d.partRole,d.bin]))).toEqual(bins);
    expect(replayCoachHistory(state.flow,state.history.slice(0,2)).destinations).toEqual([]);
  });
  it.each([
    {category:"plastic_container",first:"yes",role:"lid",bin:"plastic"},
    {category:"drink_carton",first:"regular",role:"straw",bin:"plastic"},
  ])("retains the first prepared $category part when preparing the second fails",({category,first,role,bin})=>{
    const firstPrepared=follow(category,[first,"both","done","done"]);
    expect(firstPrepared.step.kind).toBe("destination");
    expect(firstPrepared.destinations.map(d=>[d.partRole,d.bin])).toEqual([[role,bin]]);
    const held=follow(category,[first,"both","done","done","done","cannot"]);
    expect(held.held).toBe(true);
    expect(Object.fromEntries(held.destinations.map(d=>[d.partRole,d.bin]))).toEqual({[role]:bin,body:"hold",film:"hold"});
    expect(held.destinations.some(d=>d.partRole==="body"&&d.bin!=="hold")).toBe(false);
    expect(replayCoachHistory(held.flow,held.history.slice(0,2)).destinations).toEqual([]);
  });
  it.each([
    {category:"plastic_container",choices:["yes","lid","done","done"]},
    {category:"plastic_container",choices:["yes","film","done","done"]},
    {category:"drink_carton",choices:["regular","straw","done","done"]},
    {category:"drink_carton",choices:["regular","film","done","done"]},
  ])("rejects $category part destinations when any preparation prerequisite is removed",({category,choices})=>{
    const prepared=follow(category,choices);
    const destination=prepared.destinations[0];
    const rule=COACH_CATALOG.rules.find(r=>r.id===destination.ruleIds[0])!;
    expect(Object.keys(rule.conditions)).toHaveLength(3);
    for (const key of Object.keys(rule.conditions)) {
      const catalog=structuredClone(COACH_CATALOG);
      const flow=catalog.flows.find(f=>f.id===prepared.flow.id)!;
      for (const h of prepared.history) delete flow.steps.find(s=>s.id===h.stepId)!.choices.find(c=>c.id===h.choiceId)!.factPatch[key];
      expect(()=>validateCoachContext(catalog,{requestId:uuid,sessionId:uuid,objectId:uuid,revision:0,catalogVersion:catalog.version,flowId:flow.id,stepId:prepared.step.id},prepared.history),key).toThrow();
    }
  });
  it("offers the reviewed food-residue alternative only after an explicit empty-body report", () => {
    const stuck = follow("plastic_container",["yes","none","done","cannot","stuck","done"]);
    expect(stuck.step.kind).toBe("complete");
    expect(stuck.destinations.map(d => d.bin)).toEqual(["general"]);
    expect(follow("plastic_container",["yes","none","done","cannot","unknown"]).held).toBe(true);
    expect(follow("plastic_container",["yes","none","cannot"]).destinations.every(d => d.bin === "hold")).toBe(true);
  });
  it("uses water-only emptying and concise actionable completion copy", () => {
    const water = follow("ice_pack",["water","intact","film"]);
    expect(water.step.visual).toEqual({action:"empty",assetId:"water-pack-empty"});
    expect(water.destinations).toEqual([]);
    const complete = follow("toothbrush",["manual","done"]);
    expect(complete.step.text).toContain("준비한 부품");
    expect(complete.step.text).not.toMatch(/AI|인증/);
    for (const flow of COACH_CATALOG.flows) for (const step of flow.steps) if (step.kind === "destination") expect(step.text).not.toMatch(/수거함로|배출로/);
  });
});

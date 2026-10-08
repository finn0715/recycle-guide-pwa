import { describe, expect, it } from "vitest";
import { COACH_CATALOG } from "@/data/coach-guides";
import { RULES, SOURCES } from "@/data/disposal-rules";
import { GuideCatalogSchema, replayCoachHistory, validateCoachContext, type CoachHistory, type GuideFlow } from "@/lib/contracts/coach";
const uuid = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
function context(flow: GuideFlow, history: CoachHistory) {
  return { requestId: uuid, sessionId: uuid, objectId: flow.categoryId === null ? null : uuid, revision: 0, catalogVersion: COACH_CATALOG.version, flowId: flow.id, stepId: replayCoachHistory(flow, history).step.id };
}
function follow(flowId: string, choices: string[]) {
  const flow = COACH_CATALOG.flows.find(f => f.id === flowId)!;
  const history: CoachHistory = [];
  for (const choiceId of choices) history.push({ stepId: replayCoachHistory(flow, history).step.id, choiceId });
  return { history, ...validateCoachContext(COACH_CATALOG, context(flow, history), history) };
}
describe("reviewed action flows", () => {
  it("shares legacy rule conditions and source metadata rather than a second answer set", () => {
    for (const rule of RULES) {
      const current = COACH_CATALOG.rules.find(r => r.id === rule.id)!;
      expect(current.conditions).toEqual(rule.conditions);
      expect(current.sourceIds).toEqual(rule.sourceIds);
    }
    for (const source of SOURCES) expect(COACH_CATALOG.sources.find(s => s.id === source.id)).toMatchObject({ checkedAt: source.checkedAt, url: source.url, publisher: source.publisher, section: source.section });
  });
  it("replays every authored route with valid conditions and never completes a held part", () => {
    let terminalPaths = 0;
    for (const flow of COACH_CATALOG.flows) {
      const walk = (history: CoachHistory) => {
        const state = validateCoachContext(COACH_CATALOG, context(flow, history), history);
        if (state.step.kind === "complete" || state.step.kind === "handoff") {
          terminalPaths++;
          if (state.step.kind === "complete") { expect(state.held).toBe(false); expect(state.destinations.length).toBeGreaterThan(0); }
          if (state.held) {
            expect(state.step.kind).toBe("handoff");
            expect(state.destinations.some(d => d.bin === "hold")).toBe(true);
            expect(state.step.destinations.every(d => d.bin === "hold")).toBe(true);
            for (const destination of state.destinations.filter(d => d.bin !== "hold")) {
              const prepared = state.visited.find(s => s.kind === "destination" && s.destinations.some(d => d.partRole === destination.partRole && d.bin !== "hold"));
              expect(prepared?.destinations).toContainEqual(destination);
            }
          }
          return;
        }
        for (const c of state.step.choices) walk([...history, {stepId: state.step.id, choiceId: c.id}]);
      };
      walk([]);
    }
    expect(terminalPaths).toBeGreaterThan(100);
  });
  it.each(["aluminum", "steel"])("only classifies a cleaned %s food/beverage can after user actions", kind => {
    const state = follow("metal-can", [kind,"none","done","done","done"]);
    expect(state.step.kind).toBe("complete");
    expect(state.destinations.map(d => d.bin)).toEqual(["metal"]);
    const unknown = follow("metal-can", [kind,"none","unknown"]);
    expect(unknown.held).toBe(true);
    expect(unknown.destinations.some(d => d.bin === "metal")).toBe(false);
  });
  it("routes a pressure can to a separate hold and a detached-pump failure to hold", () => {
    expect(follow("metal-can", ["gas"]).step.id).toBe("can-pressure-hold");
    const held = follow("pump-bottle", ["plastic", "composite", "cannot"]);
    expect(held.held).toBe(true);
    expect(held.step.kind).toBe("handoff");
  });
  it("does not invent a pump or label after an explicit absent response", () => {
    const state = follow("pump-bottle", ["plastic", "none", "none", "done", "done", "done"]);
    expect(state.step.kind).toBe("complete");
    expect(state.destinations.map(d => d.partRole)).toEqual(["body"]);
  });
  it("only uses the reviewed optional-flatten alternative and recloses a present PET cap", () => {
    const state = follow("clear-pet", ["yes", "done", "done", "none", "present", "cannot", "done", "done", "done"]);
    expect(state.step.kind).toBe("complete");
    expect(state.facts.cap_closed).toBe("yes");
    expect(state.destinations.find(d => d.partRole === "cap")?.bin).toBe("clear_pet");
  });
  it("rejects skipping preparation or reusing dependent answers after changing the first answer", () => {
    const state = follow("metal-can", ["aluminum", "none", "done"]);
    const altered = [...state.history]; altered[0] = { stepId: "can-kind", choiceId: "gas" };
    expect(() => replayCoachHistory(state.flow, altered)).toThrow();
    expect(replayCoachHistory(state.flow, [altered[0]]).facts).toEqual({can_kind:"pressure"});
    expect(() => validateCoachContext(COACH_CATALOG, {...context(state.flow, state.history), stepId:"can-bin"},state.history)).toThrow();
  });
  it("rejects destination rules if their previously confirmed condition is missing or unknown", () => {
    const catalog = structuredClone(COACH_CATALOG);
    const flow = catalog.flows.find(f => f.id === "metal-can")!;
    flow.steps.find(s => s.id === "can-empty")!.choices.find(c => c.id === "done")!.factPatch = {contents:"unknown"};
    expect(GuideCatalogSchema.safeParse(catalog).success).toBe(true);
    const history = [{stepId:"can-kind",choiceId:"steel"},{stepId:"can-accessories",choiceId:"none"},{stepId:"can-empty",choiceId:"done"},{stepId:"can-rinse",choiceId:"done"}];
    expect(() => validateCoachContext(catalog,{...context(flow,history)},history)).toThrow(/확인/);
  });
  it("keeps source-conflict and unverified-coolant recovery free of disposal confirmation", () => {
    for (const id of ["recovery-source-conflict", "recovery-unverified", "recovery-ambiguous", "recovery-out-of-scope"]) {
      const state = follow(id, []);
      expect(state.held).toBe(true);
      expect(state.destinations.every(d => d.bin === "hold")).toBe(true);
    }
  });
});

describe("held destinations reflect reported part absence", () => {
  it("does not recreate an absent pump or label when emptying fails", () => {
    const state = follow("pump-bottle", ["plastic", "none", "none", "cannot"]);
    expect(state.held).toBe(true);
    expect(state.facts).toMatchObject({pump:"none",label:"none"});
    expect(state.destinations.map(d => d.partRole)).toEqual(["body"]);
    expect(state.step.destinations.map(d => d.partRole)).toEqual(["body"]);
    expect(state.step.targetRoles).toEqual(["body"]);
  });
  it("does not recreate an absent PET label or cap after an unknown answer", () => {
    const state = follow("clear-pet", ["yes", "done", "done", "none", "absent", "unknown"]);
    expect(state.held).toBe(true);
    expect(state.facts).toMatchObject({label:"none",cap:"absent"});
    expect(state.destinations.map(d => d.partRole)).toEqual(["body"]);
    expect(state.step.destinations.map(d => d.partRole)).toEqual(["body"]);
  });
  it("retains a present pump as held and never edits the catalog", () => {
    const original = structuredClone(COACH_CATALOG);
    const state = follow("pump-bottle", ["plastic", "composite", "cannot"]);
    expect(state.destinations.some(d => d.partRole === "pump" && d.bin === "hold")).toBe(true);
    follow("pump-bottle", ["plastic", "none", "none", "cannot"]);
    expect(COACH_CATALOG).toEqual(original);
  });
});

describe("partial preparation preserves resolved parts", () => {
  it.each([false, true])("keeps the prepared pump while only body and label are held (ended=%s)", ended => {
    const state = follow("pump-bottle", ["plastic", "composite", "done", "done", "other", ...(ended ? ["close"] : [])]);
    expect(state.held).toBe(true);
    expect(state.ended).toBe(ended);
    expect(state.step.kind).toBe("handoff");
    expect(Object.fromEntries(state.destinations.map(d => [d.partRole,d.bin]))).toEqual({pump:"general",body:"hold",label:"hold"});
    expect(state.destinations.find(d => d.partRole === "pump")?.ruleIds).toEqual(["pump-composite-part"]);
    expect(state.step.destinations.map(d => d.partRole)).toEqual(["body", "label"]);
    expect(state.step.targetRoles).toEqual(["body", "label"]);
  });
  it("keeps a cleaned label while holding the unemptied body and excluding an absent pump", () => {
    const state = follow("pump-bottle", ["plastic", "none", "film", "done", "done", "done", "cannot"]);
    expect(Object.fromEntries(state.destinations.map(d => [d.partRole,d.bin]))).toEqual({label:"vinyl",body:"hold"});
    expect(state.held).toBe(true);
  });
  it("keeps a prepared PET label while body and unconfirmed cap remain held", () => {
    const state = follow("clear-pet", ["yes", "done", "done", "film", "done", "done", "done", "unknown"]);
    expect(Object.fromEntries(state.destinations.map(d => [d.partRole,d.bin]))).toEqual({label:"vinyl",body:"hold",cap:"hold"});
    expect(state.held).toBe(true);
  });
  it("discards a resolved destination when its prerequisite choices are removed or corrected", () => {
    const previous = follow("pump-bottle", ["plastic", "composite", "done", "done", "other"]);
    const beforeDetaching = replayCoachHistory(previous.flow, previous.history.slice(0, 2));
    expect(beforeDetaching.destinations).toEqual([]);
    expect(beforeDetaching.facts.pump_removed).toBeUndefined();
    const corrected = follow("pump-bottle", ["plastic", "composite", "cannot"]);
    expect(corrected.destinations.every(d => d.bin === "hold")).toBe(true);
    const absent = follow("pump-bottle", ["plastic", "none", "none", "cannot"]);
    expect(Object.fromEntries(absent.destinations.map(d => [d.partRole,d.bin]))).toEqual({body:"hold"});
  });
});

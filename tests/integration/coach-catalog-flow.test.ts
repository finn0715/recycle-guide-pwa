import { describe, expect, it, vi } from "vitest";
import { COACH_CATALOG } from "@/data/coach-guides";
import { createCoachController } from "@/lib/client/coach-controller";
import { validateCoachContext } from "@/lib/contracts/coach";

describe("coach controller with the reviewed catalog", () => {
  it.each([
    { category: "metal_can", choices: ["aluminum", "none", "done", "done", "done", "finish"], bins: { body: "metal" } },
    { category: "pump_bottle", choices: ["plastic", "composite", "done", "done", "film", "done", "done", "done", "done", "done", "done", "finish"], bins: { pump: "general", label: "vinyl", body: "plastic" } },
    { category: "clear_pet_bottle", choices: ["yes", "done", "done", "film", "done", "done", "done", "present", "cannot", "done", "done", "done", "finish"], bins: { label: "vinyl", cap: "clear_pet", body: "clear_pet" } },
  ])("completes $category only from reported choices and retains reviewed destinations", async ({ category, choices, bins }) => {
    const recognize = vi.fn();
    const controller = createCoachController({ catalog: COACH_CATALOG, recognize });
    controller.pickCategory(category); await controller.startGuidance();
    for (const choice of choices) {
      const before = controller.getSnapshot();
      expect(controller.choose(choice, before.current!.step.id)).toBe(true);
      const state = controller.getSnapshot(); const object = state.objects[0];
      const replay = validateCoachContext(COACH_CATALOG, {
        requestId: state.sessionId, sessionId: state.sessionId, objectId: object.objectId, revision: state.revision,
        catalogVersion: COACH_CATALOG.version, flowId: object.flowId, stepId: state.current!.step.id,
      }, object.history);
      expect(state.current!.facts).toEqual(replay.facts);
      expect(state.current!.destinations).toEqual(replay.destinations);
    }
    expect(controller.getSnapshot().progress).toBe("complete");
    expect(Object.fromEntries(controller.getSnapshot().current!.destinations.map(d => [d.partRole, d.bin]))).toEqual(bins);
    expect(recognize).not.toHaveBeenCalled(); controller.dispose();
  });

  it("keeps a recovery route usable with a null object and cannot turn it into overall completion", async () => {
    const controller = createCoachController({ catalog: COACH_CATALOG, recognize: async request => ({
      requestId: request.requestId, sessionId: request.sessionId, revision: request.revision,
      catalogVersion: COACH_CATALOG.version, outcome: "needs_input", objects: [], routes: [{ objectId: null, flowId: "recovery-ambiguous" }],
    }) });
    await controller.recognizeText("재질을 모르겠는 포장"); await controller.startGuidance();
    expect(controller.getSnapshot().progress).toBe("needs_help"); expect(controller.getSnapshot().objects[0].observation).toBeNull();
    expect(controller.choose("close", "recovery-ambiguous-hold")).toBe(true);
    expect(controller.getSnapshot().progress).toBe("needs_help");
    controller.pickCategory("metal_can"); expect(controller.getSnapshot().current!.facts).toEqual({});
    controller.dispose();
  });

  it("returns stable immutable snapshots and notifies only current subscribers", () => {
    const controller = createCoachController({ catalog: COACH_CATALOG, recognize: vi.fn() });
    const listener = vi.fn(); const unsubscribe = controller.subscribe(listener);
    const idle = controller.getSnapshot(); expect(controller.getSnapshot()).toBe(idle);
    controller.pickCategory("metal_can"); const selected = controller.getSnapshot();
    expect(selected).not.toBe(idle); expect(listener).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(selected.objects[0].history)).toBe(true); expect(Object.isFrozen(selected.current!.step)).toBe(true);
    expect(() => selected.objects[0].history.push({ stepId: "can-kind", choiceId: "gas" })).toThrow();
    unsubscribe(); controller.reset(); expect(listener).toHaveBeenCalledTimes(1); expect(idle.objects).toEqual([]);
    controller.dispose();
  });
});

describe("partial preparation through controller and server replay", () => {
  it("retains earlier prepared parts before and after closing a handoff, and clears them on correction", async () => {
    const controller = createCoachController({catalog:COACH_CATALOG,recognize:vi.fn()});
    controller.pickCategory("pump_bottle"); await controller.startGuidance();
    for (const choice of ["plastic","composite","done","done","other"]) expect(controller.choose(choice,controller.getSnapshot().current!.step.id)).toBe(true);
    const assertPartial = () => {
      const state = controller.getSnapshot(); const object = state.objects[0];
      expect(state.progress).toBe("needs_help");
      expect(Object.fromEntries(state.current!.destinations.map(d => [d.partRole,d.bin]))).toEqual({pump:"general",body:"hold",label:"hold"});
      expect(state.current!.step.destinations.map(d => d.partRole)).toEqual(["body","label"]);
      const replay = validateCoachContext(COACH_CATALOG,{requestId:state.sessionId,sessionId:state.sessionId,objectId:object.objectId,revision:state.revision,catalogVersion:COACH_CATALOG.version,flowId:object.flowId,stepId:state.current!.step.id},object.history);
      expect(replay.destinations).toEqual(state.current!.destinations);
    };
    assertPartial();
    expect(controller.choose("close","pump-hold")).toBe(true); assertPartial();
    expect(controller.back()).toBe(true); assertPartial();
    expect(controller.back()).toBe(true);
    expect(controller.getSnapshot().current!.step.id).toBe("pump-label-type");
    expect(controller.getSnapshot().current!.destinations.map(d => d.bin)).toEqual(["general"]);
    expect(controller.correct("pump-detach","cannot")).toBe(true);
    expect(controller.getSnapshot().progress).toBe("needs_help");
    expect(controller.getSnapshot().current!.destinations.every(d => d.bin === "hold")).toBe(true);
    expect(controller.getSnapshot().current!.facts.pump_removed).toBeUndefined();
    expect(controller.getSnapshot().objects[0].history.some(h => h.stepId === "pump-part-bin")).toBe(false);
    controller.dispose();
  });
});

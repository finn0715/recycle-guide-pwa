import { describe, expect, it } from "vitest";
import { BoxSchema, CoachContextSchema, CoachProgressStateSchema, GuideCatalogSchema, ModelObservationSchema, replayCoachHistory, validateCoachContext, validateRecognitionResponse } from "@/lib/contracts/coach";
import { COACH_CATALOG } from "@/data/coach-guides";

const id = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const flow = () => COACH_CATALOG.flows.find(f => f.id === "metal-can")!;
describe("coach boundaries", () => {
  it("validates the complete catalog and rejects broken links, loops, unsafe URLs and unreviewed rules", () => {
    expect(GuideCatalogSchema.safeParse(COACH_CATALOG).success).toBe(true);
    for (const mutate of [
      (c: typeof COACH_CATALOG) => { c.flows[0].startStepId = "missing"; },
      (c: typeof COACH_CATALOG) => { c.flows[0].steps[0].choices[0].nextStepId = c.flows[0].steps[0].id; },
      (c: typeof COACH_CATALOG) => { c.sources[0].url = "javascript:alert(1)"; },
      (c: typeof COACH_CATALOG) => { c.rules[0].sourceIds = []; },
    ]) { const c = structuredClone(COACH_CATALOG); mutate(c); expect(GuideCatalogSchema.safeParse(c).success).toBe(false); }
  });
  it("rejects malformed coordinates, states, revisions and model disposal claims", () => {
    for (const box of [{ x: .8, y: 0, width: .3, height: .1 }, { x: 0, y: 0, width: 0, height: 1 }, { x: NaN, y: 0, width: 1, height: 1 }]) expect(BoxSchema.safeParse(box).success).toBe(false);
    expect(CoachProgressStateSchema.safeParse("ready").success).toBe(false);
    expect(CoachContextSchema.safeParse({ requestId: id, sessionId: id, objectId: id, revision: -1, catalogVersion: "v", flowId: "metal-can", stepId: "can-kind" }).success).toBe(false);
    expect(ModelObservationSchema.safeParse({ label: "음료캔", categoryId: "metal_can", recognition: "recognized", views: [], parts: [], ruleIds: ["can-empty"] }).success).toBe(false);
  });
  it("requires replay from the start and drops dependent choices when the caller truncates history", () => {
    expect(() => replayCoachHistory(flow(), [{ stepId: "can-rinse", choiceId: "done" }])).toThrow();
    const history = [{ stepId: "can-kind", choiceId: "aluminum" }];
    expect(replayCoachHistory(flow(), history).step.id).toBe("can-accessories");
    expect(replayCoachHistory(flow(), []).facts).toEqual({});
    expect(replayCoachHistory(flow(), [{ stepId: "can-kind", choiceId: "gas" }]).step.kind).toBe("handoff");
  });
  it("rejects references to old photos and mismatched object routes", () => {
    const response = { requestId:id, sessionId:id, revision:0, catalogVersion:COACH_CATALOG.version, outcome:"identified", objects:[{ objectId:id,label:"캔",categoryId:"metal_can",recognition:"recognized",views:[{photoId:id,box:null}],parts:[]}], routes:[{objectId:id,flowId:"metal-can"}] };
    expect(() => validateRecognitionResponse(COACH_CATALOG,response,{mode:"photo",photoIds:[id]})).not.toThrow();
    expect(() => validateRecognitionResponse(COACH_CATALOG,response,{mode:"photo",photoIds:["6ba7b811-9dad-41d1-80b4-00c04fd430c8"]})).toThrow();
    expect(() => validateRecognitionResponse(COACH_CATALOG,{...response,routes:[]},{mode:"photo",photoIds:[id]})).toThrow();
    expect(() => validateRecognitionResponse(COACH_CATALOG,response,{mode:"manual",photoIds:[]})).toThrow();
  });
  it("requires current step and current catalog for help", () => {
    const context = { requestId:id, sessionId:id, objectId:id, revision:0, catalogVersion:COACH_CATALOG.version, flowId:"metal-can", stepId:"can-rinse" };
    expect(() => validateCoachContext(COACH_CATALOG, context, [])).toThrow();
  });
});

describe("coach catalog corruption and bounded input", () => {
  it("rejects foreign next steps, invalid patches, destination sources and unreviewed rules", () => {
    const mutations: ((c: typeof COACH_CATALOG) => void)[] = [
      c => { c.flows[0].steps[0].choices[0].nextStepId = "pump-type"; },
      c => { c.flows[0].steps[0].choices[0].factPatch = {can_kind:"new-answer"}; },
      c => { c.flows[0].steps[0].sourceIds = ["missing"]; },
      c => { c.replies[0].allowedStepIds = ["missing"]; },
      c => { c.flows[0].steps[0].choices[0].nextStepId = null; },
      c => { c.flows[0].steps[0].choices.push(c.flows[0].steps[0].choices[0]); },
      c => { Object.assign(c.rules[0], {reviewStatus:"unreviewed"}); },
      c => { Object.assign(c.rules[0], {region:"seoul"}); },
    ];
    for (const mutate of mutations) { const c = structuredClone(COACH_CATALOG); mutate(c); expect(GuideCatalogSchema.safeParse(c).success).toBe(false); }
  });
  it("never truncates oversized history or objects", () => {
    expect(() => replayCoachHistory(flow(),Array.from({length:65}, () => ({stepId:"can-kind",choiceId:"gas"})))).toThrow();
    const objects = Array.from({length:13},(_,i) => ({objectId:`6ba7b8${(10+i).toString().padStart(2,"0")}-9dad-41d1-80b4-00c04fd430c8`,label:"캔",categoryId:"metal_can",recognition:"recognized",views:[],parts:[]}));
    expect(() => validateRecognitionResponse(COACH_CATALOG,{requestId:id,sessionId:id,revision:0,catalogVersion:COACH_CATALOG.version,outcome:"identified",objects,routes:objects.map(o => ({objectId:o.objectId,flowId:"metal-can"}))},{mode:"manual",photoIds:[]})).toThrow();
  });
  it("uses null object IDs only for recovery and requires actual photo views", () => {
    const context = {requestId:id,sessionId:id,objectId:null,revision:0,catalogVersion:COACH_CATALOG.version,flowId:"metal-can",stepId:"can-kind"};
    expect(() => validateCoachContext(COACH_CATALOG,context,[])).toThrow();
    const object = {objectId:id,label:"캔",categoryId:"metal_can",recognition:"recognized",views:[],parts:[]};
    const response = {requestId:id,sessionId:id,revision:0,catalogVersion:COACH_CATALOG.version,outcome:"identified",objects:[object],routes:[{objectId:id,flowId:"metal-can"}]};
    expect(() => validateRecognitionResponse(COACH_CATALOG,response,{mode:"photo",photoIds:[id]})).toThrow();
    expect(() => validateRecognitionResponse(COACH_CATALOG,{...response,outcome:"needs_input",objects:[],routes:[{objectId:null,flowId:"recovery-ambiguous"}]},{mode:"photo",photoIds:[id]})).not.toThrow();
  });
});

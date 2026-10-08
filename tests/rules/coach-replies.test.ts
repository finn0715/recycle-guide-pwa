import { describe, expect, it } from "vitest";
import { COACH_CATALOG } from "@/data/coach-guides";
import { GuideCatalogSchema, replayCoachHistory, validateCoachHelpResponse, validateCoachSpeechRequest, type CoachHistory } from "@/lib/contracts/coach";
const getReply = (id: string) => COACH_CATALOG.replies.find(r => r.id === id)!;
const uuid = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";

describe("question-specific reviewed help", () => {
  it("keeps legacy help IDs while providing different how, failure, reason and scope answers", () => {
    expect(COACH_CATALOG.version).not.toBe("songpa-coach-2026-10-08-v1");
    for (const flow of COACH_CATALOG.flows) for (const step of flow.steps) expect(step.replyIds).toContain(`${step.id}-help`);
    const replies = ["pump-detach-help", "pump-detach-cannot", "pump-detach-why", "pump-bottle-scope-help"].map(getReply);
    expect(replies.every(Boolean)).toBe(true);
    expect(new Set(replies.map(r => r.text)).size).toBe(4);
    expect(getReply("pump-detach-why").choiceIds).toEqual([]);
    expect(getReply("pump-bottle-scope-help").choiceIds).toEqual([]);
  });
  it("answers a stuck pump with stopping and only the inability choice", () => {
    const reply = getReply("pump-detach-cannot");
    expect(reply).toBeDefined();
    expect(reply.text).toMatch(/억지|멈/);
    expect(reply.text).toContain("확인된 다른 분리 방법이 없어");
    expect(reply.choiceIds).toEqual(["cannot"]);
    expect(reply.allowedStepIds).toEqual(["pump-detach"]);
    expect(reply.ruleIds).toEqual(["pump-composite-part"]);
    expect(getReply("pump-type-unknown").choiceIds).toEqual(["unknown"]);
  });
  it.each(["pet-flatten-cap", "pet-flatten-open"])("offers the reviewed optional-flatten alternative at %s", stepId => {
    const reply = getReply(`${stepId}-cannot`);
    expect(reply).toBeDefined();
    expect(reply.text).toContain("가능한");
    expect(reply.choiceIds).toEqual(["cannot"]);
    expect(reply.ruleIds).toContain("pet-clear-empty");
    expect(reply.text).toContain(stepId === "pet-flatten-cap" ? "뚜껑" : "배출 준비");
  });
  it("ties every new answer and its subset of choices to the current reviewed step", () => {
    expect(GuideCatalogSchema.safeParse(COACH_CATALOG).success).toBe(true);
    for (const flow of COACH_CATALOG.flows) for (const step of flow.steps) {
      for (const id of step.replyIds) {
        const reply = getReply(id);
        expect(reply.allowedStepIds).toContain(step.id);
        expect(reply.choiceIds.every(id => step.choices.some(choice => choice.id === id))).toBe(true);
      }
      if (step.kind === "action") expect(getReply(`${step.id}-cannot`).choiceIds).toEqual(["cannot"]);
    }
  });
  it("uses brief speech instead of concatenating the full reason and instruction", () => {
    for (const flow of COACH_CATALOG.flows) for (const step of flow.steps) {
      expect(step.speechText.length, step.id).toBeLessThanOrEqual(80);
      const help = getReply(`${step.id}-help`);
      expect(help.speechText, help.id).not.toBe(`${step.reason} ${step.text}`);
    }
    for (const reply of COACH_CATALOG.replies) expect(reply.speechText.length, reply.id).toBeLessThanOrEqual(80);
  });
  it("keeps help and speech from applying the suggested choice or hidden facts", () => {
    const flow = COACH_CATALOG.flows.find(f => f.id === "pump-bottle")!;
    const choices: CoachHistory = [{stepId:"pump-material",choiceId:"plastic"},{stepId:"pump-type",choiceId:"composite"}];
    const before = replayCoachHistory(flow,choices);
    const context = {requestId:uuid,sessionId:uuid,objectId:uuid,revision:0,catalogVersion:COACH_CATALOG.version,flowId:flow.id,stepId:"pump-detach"};
    const request = {context,choices,text:"펌프가 안 빠져요"};
    const reply = getReply("pump-detach-cannot");
    expect(reply).toBeDefined();
    const response = {context,transcript:null,replyId:reply.id,text:reply.text,choiceIds:reply.choiceIds,sourceIds:reply.sourceIds};
    expect(validateCoachHelpResponse(COACH_CATALOG,response,request).choiceIds).toEqual(["cannot"]);
    expect(validateCoachSpeechRequest(COACH_CATALOG,{context,choices,cue:{kind:"reply",id:reply.id}}).speechText).toBe(reply.speechText);
    expect(replayCoachHistory(flow,choices)).toEqual(before);
    expect(before.step.id).toBe("pump-detach");
    expect(before.facts.pump_removed).toBeUndefined();
  });
});

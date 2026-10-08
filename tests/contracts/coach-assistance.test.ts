import { describe, expect, it } from "vitest";
import { COACH_CATALOG } from "@/data/coach-guides";
import { CoachHelpRequestSchema, validateCoachHelpRequest, validateCoachHelpResponse, validateCoachSpeechRequest } from "@/lib/contracts/coach";
const id = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const context = {requestId:id, sessionId:id, objectId:id, revision:0, catalogVersion:COACH_CATALOG.version, flowId:"metal-can", stepId:"can-kind"};
const audio = () => new Blob([new Uint8Array(44)], {type:"audio/wav"});
const reply = COACH_CATALOG.replies.find(r => r.id === "can-kind-help")!;
const response = {context,transcript:null,replyId:reply.id,text:reply.text,choiceIds:reply.choiceIds,sourceIds:reply.sourceIds};
const textRequest = {context, choices:[], text:"캔 종류를 모르겠어요"};

describe("shared coach help request", () => {
  it("accepts exactly one bounded text or audio input", () => {
    expect(CoachHelpRequestSchema.safeParse(textRequest).success).toBe(true);
    expect(CoachHelpRequestSchema.safeParse({context,choices:[],audio:audio()}).success).toBe(true);
    for (const input of [
      {context,choices:[]}, {...textRequest,audio:audio()}, {...textRequest,text:"가".repeat(1001)},
      {...textRequest,text:" ".repeat(1001)}, {...textRequest,text:" "},
      {context,choices:[],audio:"fake wav"}, {context,choices:[],audio:new Blob([])},
      {context,choices:[],audio:new Blob([new Uint8Array(1024*1024+1)])},
    ]) expect(CoachHelpRequestSchema.safeParse(input).success).toBe(false);
  });
  it("validates history and current step at the common request boundary", () => {
    expect(validateCoachHelpRequest(COACH_CATALOG,textRequest).step.id).toBe("can-kind");
    expect(() => validateCoachHelpRequest(COACH_CATALOG,{...textRequest,context:{...context,stepId:"can-rinse"}})).toThrow();
    expect(() => validateCoachHelpRequest(COACH_CATALOG,{...textRequest,choices:[{stepId:"can-rinse",choiceId:"done"}]})).toThrow();
  });
  it("requires null transcript for text and a nonblank bounded transcript for audio", () => {
    expect(() => validateCoachHelpResponse(COACH_CATALOG,response,textRequest)).not.toThrow();
    expect(() => validateCoachHelpResponse(COACH_CATALOG,{...response,transcript:"invented"},textRequest)).toThrow();
    const request = {context,choices:[],audio:audio()};
    expect(() => validateCoachHelpResponse(COACH_CATALOG,{...response,transcript:"어떤 캔인가요"},request)).not.toThrow();
    for (const transcript of [null,"", " ", "가".repeat(1001)]) expect(() => validateCoachHelpResponse(COACH_CATALOG,{...response,transcript},request)).toThrow();
    expect(() => validateCoachHelpResponse(COACH_CATALOG,{...response,text:"arbitrary answer"},textRequest)).toThrow();
  });
});

describe("current coach speech cue", () => {
  it("reconstructs only the current reviewed step or its allowed reply", () => {
    expect(validateCoachSpeechRequest(COACH_CATALOG,{context,choices:[],cue:{kind:"step",id:"can-kind"}}).speechText).toBe(COACH_CATALOG.flows.find(f=>f.id==="metal-can")!.steps[0].speechText);
    expect(validateCoachSpeechRequest(COACH_CATALOG,{context,choices:[],cue:{kind:"reply",id:"can-kind-help"}}).speechText).toBe(reply.speechText);
  });
  it("rejects foreign, old and unknown IDs, invalid history and arbitrary text", () => {
    for (const cue of [{kind:"reply",id:"pump-part-bin-help"},{kind:"reply",id:"missing"},{kind:"step",id:"can-rinse"},{kind:"step",id:"missing"}]) expect(() => validateCoachSpeechRequest(COACH_CATALOG,{context,choices:[],cue})).toThrow();
    const input = {context,choices:[],cue:{kind:"step",id:"can-kind"}};
    expect(() => validateCoachSpeechRequest(COACH_CATALOG,{...input,text:"say anything"})).toThrow();
    expect(() => validateCoachSpeechRequest(COACH_CATALOG,{...input,choices:[{stepId:"can-rinse",choiceId:"done"}]})).toThrow();
    const nextContext = {...context,stepId:"can-accessories"};
    const history = [{stepId:"can-kind",choiceId:"aluminum"}];
    expect(() => validateCoachSpeechRequest(COACH_CATALOG,{context:nextContext,choices:history,cue:{kind:"step",id:"can-kind"}})).toThrow();
    expect(validateCoachSpeechRequest(COACH_CATALOG,{context:nextContext,choices:history,cue:{kind:"step",id:"can-accessories"}}).step.id).toBe("can-accessories");
  });
});

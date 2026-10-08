import { afterEach, describe, expect, it, vi } from "vitest";
import { COACH_CATALOG } from "@/data/coach-guides";
import { createCoachHelpHandler } from "@/lib/server/coach-help";
import { createCoachSpeechHandler } from "@/lib/server/coach-voice";
import { createCoachAssistanceTransport } from "@/lib/client/coach-audio";
import { validateCoachHelpResponse } from "@/lib/contracts/coach";
import { encodeCoachWav,decodeCoachWav } from "@/lib/audio/coach-wav";
const id="6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const context={requestId:id,sessionId:id,objectId:id,revision:2,catalogVersion:COACH_CATALOG.version,flowId:"pump-bottle",stepId:"pump-confirm"};
const pcm=()=>Int16Array.from({length:2400},(_,i)=>Math.sin(i/10)*9000);
afterEach(()=>vi.unstubAllGlobals());
describe("actual coach assistance HTTP contracts",()=>{
  it("connects text/PCM help and speech using actual bodies and canonical server resolution",async()=>{
    const flow=COACH_CATALOG.flows.find(f=>f.id==="pump-bottle")!,step=flow.steps.find(s=>s.id===flow.startStepId)!;
    const current={...context,stepId:step.id};const reply=COACH_CATALOG.replies.find(r=>r.id===step.replyIds[0])!;
    const help=createCoachHelpHandler({model:async input=>{expect(input.step.id).toBe(step.id);return {replyId:reply.id,choiceIds:reply.choiceIds};},transcribe:async()=>"펌프가 안 빠져요"});
    const speech=createCoachSpeechHandler({synthesize:async text=>({pcm:pcm(),transcript:text})});
    vi.stubGlobal("fetch",async(url:string,init:RequestInit)=>{const request=new Request(`http://localhost${url}`,init);return url.endsWith("/help")?help(request):speech(request);});
    const transport=createCoachAssistanceTransport(),signal=new AbortController().signal;
    for(const input of [{context:current,choices:[],text:"펌프가 안 빠져요"},{context:current,choices:[],audio:new Blob([encodeCoachWav(pcm())],{type:"audio/wav"})}]) {
      const result=await transport.help(input,signal);expect(validateCoachHelpResponse(COACH_CATALOG,result,input).text).toBe(reply.text);
    }
    const audio=await transport.speech({context:current,choices:[],cue:{kind:"reply",id:reply.id}},signal);
    expect(audio.requestId).toBe(id);expect(decodeCoachWav(await audio.audio.arrayBuffer()).samples).toEqual(pcm());
  });
});

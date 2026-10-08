import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserCoachAudio, createCoachAssistanceTransport } from "@/lib/client/coach-audio";
import { decodeCoachWav, encodeCoachWav } from "@/lib/audio/coach-wav";
import { COACH_CATALOG } from "@/data/coach-guides";
const id="6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const context={requestId:id,sessionId:id,objectId:id,revision:2,catalogVersion:COACH_CATALOG.version,flowId:"metal-can",stepId:"can-kind"};
const request={context,choices:[],text:"무슨 캔이죠?"};
const speech={context,choices:[],cue:{kind:"step" as const,id:"can-kind"}};
const reply=COACH_CATALOG.replies.find(r=>r.id==="can-kind-help")!;
const result={context,transcript:null,replyId:reply.id,text:reply.text,choiceIds:reply.choiceIds,sourceIds:reply.sourceIds};
const wav=()=>new Blob([encodeCoachWav(Int16Array.from({length:2400},(_,i)=>Math.sin(i/10)*9000))],{type:"audio/wav"});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe("coach assistance transport",()=>{
  it("sends actual multipart with exactly one input and validates all response context",async()=>{
    const fetcher=vi.fn(async(_url:unknown,init:RequestInit)=>{
      expect(init.body).toBeInstanceOf(FormData);const body=init.body as FormData;
      expect([...body.keys()]).toEqual(["context","choices","text"]);expect(JSON.parse(body.get("context") as string)).toEqual(context);
      return Response.json(result);
    });vi.stubGlobal("fetch",fetcher);
    expect(await createCoachAssistanceTransport().help!(request,new AbortController().signal)).toEqual(result);
    for(const changed of [{revision:3},{objectId:null},{stepId:"old"},{requestId:"5ba7b810-9dad-41d1-80b4-00c04fd430c8"}]) {
      fetcher.mockImplementation(async()=>Response.json({...result,context:{...context,...changed}}));
      await expect(createCoachAssistanceTransport().help!(request,new AbortController().signal)).rejects.toThrow();
    }
  });
  it("checks actual WAV, MIME, request and revision headers before returning audio",async()=>{
    const headers={"content-type":"audio/wav","x-request-id":id,"x-guide-revision":"2"};
    const fetcher=vi.fn(async()=>new Response(wav(),{headers}));vi.stubGlobal("fetch",fetcher);
    expect((await createCoachAssistanceTransport().speech!(speech,new AbortController().signal)).revision).toBe(2);
    for(const change of [{"content-type":"audio/webm"},{"x-request-id":"bad"},{"x-guide-revision":"1"}]){
      fetcher.mockImplementation(async()=>new Response(wav(),{headers:{...headers,...change}}));
      await expect(createCoachAssistanceTransport().speech!(speech,new AbortController().signal)).rejects.toThrow();
    }
    fetcher.mockImplementation(async()=>new Response("not wav",{headers}));await expect(createCoachAssistanceTransport().speech!(speech,new AbortController().signal)).rejects.toThrow();
  });
  it("does not fetch cancelled, contradictory or empty requests",async()=>{
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);const abort=new AbortController();abort.abort();
    await expect(createCoachAssistanceTransport().help!(request,abort.signal)).rejects.toThrow();
    await expect(createCoachAssistanceTransport().help!({...request,audio:wav()},new AbortController().signal)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
  });
});

class FakeNode { connect=vi.fn();disconnect=vi.fn(); }
class FakeSource extends FakeNode { buffer:unknown;onended:(()=>void)|null=null;start=vi.fn();stop=vi.fn(()=>this.onended?.()); }
class FakeWorklet extends FakeNode {
  static all:FakeWorklet[]=[];port={onmessage:null as ((e:{data:Float32Array})=>void)|null,close:vi.fn()};
  constructor(){super();FakeWorklet.all.push(this);}
}
class FakeContext {
  static all:FakeContext[]=[];sampleRate=48000;state="running";destination={};
  audioWorklet={addModule:vi.fn(async()=>{})};resume=vi.fn(async()=>{});close=vi.fn(async()=>{});
  sources:FakeSource[]=[];decodeAudioData=vi.fn(async()=>({}));createBuffer=vi.fn(()=>({}));
  createBufferSource=()=>{const s=new FakeSource();this.sources.push(s);return s;};
  createGain=()=>Object.assign(new FakeNode(),{gain:{value:1}});createMediaStreamSource=vi.fn(()=>new FakeNode());
  constructor(){FakeContext.all.push(this);}
}
const stream=()=>({getTracks:()=>[{stop:vi.fn()}]});
beforeEach(()=>{FakeContext.all=[];FakeWorklet.all=[];});
function browser(getUserMedia=vi.fn(async()=>stream())) {
  vi.stubGlobal("isSecureContext",true);vi.stubGlobal("navigator",{mediaDevices:{getUserMedia}});
  vi.stubGlobal("AudioContext",FakeContext);vi.stubGlobal("AudioWorkletNode",FakeWorklet);
  return {getUserMedia};
}
describe("browser tap recording and playback lifetime",()=>{
  it("captures real PCM at hardware rate and returns mono 24k WAV only on finish",async()=>{
    browser();const audio=createBrowserCoachAudio();const error=vi.fn();await audio.startRecording(new AbortController().signal,error);
    for(let offset=0;offset<4800;offset+=128) FakeWorklet.all[0].port.onmessage!({data:Float32Array.from({length:Math.min(128,4800-offset)},(_,i)=>Math.sin((i+offset)/10)*0.2)});
    const blob=await audio.finishRecording();expect(blob.type).toBe("audio/wav");expect(decodeCoachWav(await blob.arrayBuffer()).samples.length).toBe(2400);expect(error).not.toHaveBeenCalled();audio.dispose();
  });
  it("rejects insecure, denied and silent recordings with Korean errors",async()=>{
    const {getUserMedia}=browser();vi.stubGlobal("isSecureContext",false);
    await expect(createBrowserCoachAudio().startRecording(new AbortController().signal,vi.fn())).rejects.toThrow(/HTTPS|보안/);expect(getUserMedia).not.toHaveBeenCalled();
    vi.stubGlobal("isSecureContext",true);getUserMedia.mockRejectedValueOnce(new DOMException("denied","NotAllowedError"));
    await expect(createBrowserCoachAudio().startRecording(new AbortController().signal,vi.fn())).rejects.toThrow(/권한/);
    const audio=createBrowserCoachAudio();await audio.startRecording(new AbortController().signal,vi.fn());
    FakeWorklet.all.at(-1)!.port.onmessage!({data:new Float32Array(128)});await expect(audio.finishRecording()).rejects.toThrow(/목소리/);audio.dispose();
  });
  it("limit cancels capture and calls onError, never silently trims or sends",async()=>{
    vi.useFakeTimers();browser();const audio=createBrowserCoachAudio(),error=vi.fn();await audio.startRecording(new AbortController().signal,error);
    await vi.advanceTimersByTimeAsync(20000);expect(error).toHaveBeenCalledOnce();await expect(audio.finishRecording()).rejects.toThrow();audio.dispose();
  });
  it("bounds an opened microphone even while the worklet module is still loading",async()=>{
    vi.useFakeTimers();const stop=vi.fn();browser(vi.fn(async()=>({getTracks:()=>[{stop}]})));
    const audio=createBrowserCoachAudio();await audio.unlockPlayback();let release!:()=>void;
    FakeContext.all[0].audioWorklet.addModule.mockImplementationOnce(()=>new Promise<void>(r=>{release=r;}));
    const onError=vi.fn();const starting=audio.startRecording(new AbortController().signal,onError).catch(e=>e);
    await vi.advanceTimersByTimeAsync(1);await vi.advanceTimersByTimeAsync(20000);expect(stop).toHaveBeenCalledOnce();expect(onError).toHaveBeenCalledOnce();
    release();await starting;audio.dispose();
  });
  it("late cancelled getUserMedia stops only its own tracks, preserving a newer recording",async()=>{
    const oldStop=vi.fn(),newStop=vi.fn();let release!:(value:unknown)=>void;
    const getUserMedia=vi.fn().mockImplementationOnce(()=>new Promise(r=>{release=r;})).mockResolvedValueOnce({getTracks:()=>[{stop:newStop}]});browser(getUserMedia);
    const audio=createBrowserCoachAudio(),abort=new AbortController();const old=audio.startRecording(abort.signal,vi.fn());const oldResult=old.catch(e=>e);await vi.waitFor(()=>expect(getUserMedia).toHaveBeenCalledOnce());abort.abort();
    await audio.startRecording(new AbortController().signal,vi.fn());release({getTracks:()=>[{stop:oldStop}]});await oldResult;
    expect(oldStop).toHaveBeenCalledOnce();expect(newStop).not.toHaveBeenCalled();audio.cancelRecording();expect(newStop).toHaveBeenCalledOnce();audio.dispose();
  });
  it("unlocks synchronously in the gesture and discards late decoded playback after stop",async()=>{
    browser();const audio=createBrowserCoachAudio();const unlock=audio.unlockPlayback();expect(FakeContext.all[0].resume).toHaveBeenCalledOnce();await unlock;
    const context=FakeContext.all[0];let release!:(value:object)=>void;context.decodeAudioData.mockImplementationOnce(()=>new Promise<object>(r=>{release=r;}));
    const playing=audio.play(wav(),new AbortController().signal);const settled=playing.catch(e=>e);await vi.waitFor(()=>expect(context.decodeAudioData).toHaveBeenCalled());audio.stopPlayback();release({});await settled;
    expect(context.sources.filter(s=>s.start.mock.calls.length)).toHaveLength(1);audio.dispose();expect(context.close).toHaveBeenCalledOnce();
  });
});

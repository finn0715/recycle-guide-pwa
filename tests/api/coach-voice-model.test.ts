import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COACH_LIMITS } from "@/lib/contracts/coach";
const mocks=vi.hoisted(()=>({sockets:[] as unknown[]}));
vi.mock("ws",()=>({default:class extends EventEmitter{
  send=vi.fn();terminate=vi.fn(()=>queueMicrotask(()=>this.emit("close")));
  constructor(public url:string,public options:unknown){super();mocks.sockets.push(this);}
}}));
import { synthesizeCoachSpeech, COACH_SPEECH_MODEL } from "@/lib/server/coach-voice";
type Socket=EventEmitter & {send:ReturnType<typeof vi.fn>;terminate:ReturnType<typeof vi.fn>;url:string;options:{headers:Record<string,string>}};
const text="펌프를 돌려 분리해 주세요.";
function event(socket:Socket,value:unknown){socket.emit("message",Buffer.from(JSON.stringify(value)));}
function ready(socket:Socket){event(socket,{type:"session.created"});event(socket,{type:"session.updated"});event(socket,{type:"response.created",response:{id:"response1"}});}
function output(socket:Socket,transcript=text){
  const ids={response_id:"response1",output_index:0,content_index:0};
  event(socket,{type:"response.output_audio.delta",...ids,delta:Buffer.from([1,2,3,4]).toString("base64")});
  event(socket,{type:"response.output_audio_transcript.delta",...ids,delta:transcript});
  event(socket,{type:"response.output_audio_transcript.done",...ids,transcript});
  event(socket,{type:"response.done",response:{id:"response1",status:"completed",output:[{type:"message",role:"assistant",content:[{type:"output_audio",transcript}]}]}});
}
beforeEach(()=>{mocks.sockets=[];vi.stubEnv("OPENAI_API_KEY","test-placeholder");});
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
describe("bounded server Realtime protocol",()=>{
  it("uses current model, disables VAD and tools, scopes input to the canonical cue and waits for close",async()=>{
    const pending=synthesizeCoachSpeech(text,new AbortController().signal);const socket=mocks.sockets[0] as Socket;
    expect(socket.url).toBe(`wss://api.openai.com/v1/realtime?model=${COACH_SPEECH_MODEL}`);ready(socket);
    const session=JSON.parse(socket.send.mock.calls[0][0]).session;expect(session.audio.input.turn_detection).toBeNull();expect(session.tools).toEqual([]);
    const response=JSON.parse(socket.send.mock.calls[1][0]).response;expect(response.conversation).toBe("none");expect(response.input[0].content).toEqual([{type:"input_text",text}]);
    output(socket);expect(socket.terminate).toHaveBeenCalledOnce();const result=await pending;expect(result.transcript).toBe(text);expect(result.pcm.length).toBe(2);expect(socket.listenerCount("message")).toBe(0);
  });
  it("does not release a result before socket close even after cancellation",async()=>{
    const abort=new AbortController();const pending=synthesizeCoachSpeech(text,abort.signal);const rejected=pending.catch(e=>e);const socket=mocks.sockets[0] as Socket;
    socket.terminate.mockImplementation(()=>{});let settled=false;void rejected.then(()=>{settled=true;});abort.abort();await Promise.resolve();expect(settled).toBe(false);
    socket.emit("close");expect(await rejected).toMatchObject({code:"INVALID_REQUEST"});expect(socket.listenerCount("message")).toBe(0);
  });
  it.each(["말을 바꿨어요.",`${text} 일반쓰레기에 버려요.`])("withholds changed or expanded transcript %#",async transcript=>{
    const pending=synthesizeCoachSpeech(text,new AbortController().signal);const rejected=pending.catch(e=>e);const socket=mocks.sockets[0] as Socket;ready(socket);output(socket,transcript);expect(await rejected).toMatchObject({code:"INVALID_MODEL_RESPONSE"});
  });
  it("rejects response cross-talk, oversized PCM, and private provider errors safely",async()=>{
    for(const eventValue of [
      {type:"response.output_audio.delta",response_id:"wrong",output_index:0,content_index:0,delta:"AQI="},
      {type:"response.output_audio.delta",response_id:"response1",output_index:0,content_index:0,delta:Buffer.alloc(COACH_LIMITS.audioSeconds*COACH_LIMITS.audioSampleRate*2+2).toString("base64")},
      {type:"error",error:{code:"model_not_found",message:"secret-provider-content"}},
    ]) {
      const pending=synthesizeCoachSpeech(text,new AbortController().signal);const rejected=pending.catch(e=>e);const socket=mocks.sockets.at(-1) as Socket;ready(socket);event(socket,eventValue);const error=await rejected;expect(error.code).toBe(eventValue.type==="error"?"CONFIGURATION_ERROR":"INVALID_MODEL_RESPONSE");expect(error.message).not.toContain("secret-provider-content");
    }
  });
  it("does not open a socket with no key or an already aborted signal",async()=>{
    const abort=new AbortController();abort.abort();await expect(synthesizeCoachSpeech(text,abort.signal)).rejects.toMatchObject({code:"INVALID_REQUEST"});
    vi.stubEnv("OPENAI_API_KEY","");await expect(synthesizeCoachSpeech(text,new AbortController().signal)).rejects.toMatchObject({code:"CONFIGURATION_ERROR"});expect(mocks.sockets).toHaveLength(0);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecyclingCall, type RecyclingCall } from "@/lib/client/recycling-call";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function mediaStream(kind = "audio") {
  const track = Object.assign(new EventTarget(), { enabled: true, stop: vi.fn(), kind });
  return { track, stream: { getTracks: () => [track], getAudioTracks: () => kind === "audio" ? [track] : [], getVideoTracks: () => kind === "video" ? [track] : [] } as unknown as MediaStream };
}
function setup(language: "ko" | "en" = "ko") {
  const microphone = mediaStream(); const camera = mediaStream("video");
  const channel = { readyState: "open", bufferedAmount: 0, send: vi.fn(), close: vi.fn(), onmessage: null as null | ((event: { data: string }) => void), onclose: null as null | (() => void), onerror: null };
  const peer = { localDescription: { sdp: "v=0\r\nm=audio\r\nm=application\r\n" }, connectionState: "connected", addTrack: vi.fn(), createDataChannel: vi.fn(() => channel), createOffer: vi.fn(async () => ({ type: "offer", sdp: "v=0" })), setLocalDescription: vi.fn(async () => {}), setRemoteDescription: vi.fn(async () => {}), close: vi.fn(), ontrack: null, onconnectionstatechange: null };
  const media = { getUserMedia: vi.fn(async (constraints: MediaStreamConstraints) => constraints.video ? camera.stream : microphone.stream) };
  const audio = { srcObject: null, pause: vi.fn(), play: vi.fn(async () => {}) };
  const video = { srcObject: null, play: vi.fn(async () => {}), videoWidth: 640, videoHeight: 480 };
  const close = vi.fn(); const connect = vi.fn(async () => ({ sdp: "v=0 answer", close }));
  const capture = vi.fn(() => "data:image/jpeg;base64,eA==");
  const readImage = vi.fn(async () => "data:image/jpeg;base64,eA==");
  const call = createRecyclingCall({ language, media, peer: () => peer as unknown as RTCPeerConnection, audio: audio as unknown as HTMLAudioElement, video: video as unknown as HTMLVideoElement, connect, capture, readImage });
  calls.push(call);
  const emit = (event: object) => channel.onmessage?.({ data: JSON.stringify(event) });
  const connected = async () => { await call.start(); emit({ type: "session.created" }); };
  const sent = () => channel.send.mock.calls.map(([raw]) => JSON.parse(raw));
  return { call, media, microphone, camera, audio, video, channel, peer, connect, close, emit, connected, capture, readImage, sent };
}
const calls: RecyclingCall[] = [];
afterEach(() => { calls.splice(0).forEach(call => call.dispose()); vi.useRealTimers(); });

describe("continuous recycling call", () => {
  it("connects with audio only, starts one greeting, and releases every resource on hangup", async () => {
    const h = setup(); await h.connected();
    expect(h.call.getSnapshot().status).toBe("connected");
    expect(h.media.getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    expect(h.sent()).toEqual([expect.objectContaining({ type: "response.create" })]);
    await h.call.toggleCamera(); expect(h.video.srcObject).toBe(h.camera.stream);
    h.call.mute(); expect(h.microphone.track.enabled).toBe(false);
    h.call.mute(); expect(h.microphone.track.enabled).toBe(true);
    h.call.end(); h.call.end();
    expect(h.microphone.track.stop).toHaveBeenCalledTimes(1); expect(h.camera.track.stop).toHaveBeenCalledTimes(1);
    expect(h.close).toHaveBeenCalledTimes(1); expect(h.peer.close).toHaveBeenCalledTimes(1);
    expect(h.video.srcObject).toBeNull(); expect(h.audio.srcObject).toBeNull(); expect(h.call.getSnapshot().caption).toBe("");
  });
  it("closes a late microphone approval after the user cancels without opening a connection", async () => {
    const h = setup(); const pending = deferred<MediaStream>(); h.media.getUserMedia.mockReturnValueOnce(pending.promise);
    const start = h.call.start(); h.call.end(); pending.resolve(h.microphone.stream); await start;
    expect(h.microphone.track.stop).toHaveBeenCalledTimes(1); expect(h.connect).not.toHaveBeenCalled(); expect(h.call.getSnapshot().status).toBe("ended");
  });
  it("hangs up a late server call and ignores events from the old call", async () => {
    const h = setup(); const pending = deferred<{ sdp: string; close: typeof h.close }>(); h.connect.mockReturnValueOnce(pending.promise);
    const start = h.call.start(); await vi.waitFor(() => expect(h.connect).toHaveBeenCalled());
    h.call.end(); pending.resolve({ sdp: "v=0 answer", close: h.close }); await start;
    h.emit({ type: "session.created" }); h.emit({ type: "response.output_audio_transcript.delta", delta: "stale" });
    expect(h.close).toHaveBeenCalledOnce(); expect(h.peer.setRemoteDescription).not.toHaveBeenCalled(); expect(h.call.getSnapshot().status).toBe("ended"); expect(h.call.getSnapshot().caption).toBe("");
  });
  it("camera rejection leaves audio connected, and late camera approval is stopped after cancellation", async () => {
    const h = setup(); await h.connected(); h.media.getUserMedia.mockRejectedValueOnce(new Error("permission")); await h.call.toggleCamera();
    expect(h.call.getSnapshot().status).toBe("connected"); expect(h.call.getSnapshot().camera).toBe("off"); expect(h.call.getSnapshot().mediaError).toBeTruthy();
    const pending = deferred<MediaStream>(); h.media.getUserMedia.mockReturnValueOnce(pending.promise);
    const opening = h.call.toggleCamera(); await h.call.toggleCamera(); pending.resolve(h.camera.stream); await opening;
    expect(h.camera.track.stop).toHaveBeenCalledOnce(); expect(h.call.getSnapshot().camera).toBe("off"); expect(h.video.srcObject).toBeNull();
  });
  it("streams captions, supports interruption, and does not send one request per frame", async () => {
    vi.useFakeTimers(); const h = setup(); await h.connected();
    h.emit({ type: "response.created" }); h.emit({ type: "response.output_audio_transcript.delta", delta: "펌프를 " }); h.emit({ type: "response.output_audio_transcript.delta", delta: "떼세요." });
    expect(h.call.getSnapshot().caption).toBe("펌프를 떼세요.");
    h.emit({ type: "output_audio_buffer.started" }); expect(h.call.getSnapshot().activity).toBe("speaking");
    h.emit({ type: "input_audio_buffer.speech_started" }); expect(h.call.getSnapshot().activity).toBe("hearing"); expect(h.call.getSnapshot().caption).toBe("");
    await h.call.toggleCamera(); vi.advanceTimersByTime(9_000);
    expect(h.sent().filter(e => e.type === "response.create")).toHaveLength(1);
    expect(h.sent().filter(e => e.type === "conversation.item.create")).toHaveLength(4);
    expect(h.sent().filter(e => e.type === "conversation.item.delete")).toHaveLength(2);
    await h.call.toggleCamera(); const count = h.channel.send.mock.calls.length; vi.advanceTimersByTime(9_000); expect(h.channel.send).toHaveBeenCalledTimes(count);
  });
  it("never sends a photo decoded after hangup, and queues a photo reply behind current speech", async () => {
    const h = setup(); await h.connected();
    await h.call.sendPhoto(new File(["x"], "test.jpg")); expect(h.sent().filter(e => e.type === "response.create")).toHaveLength(1);
    h.emit({ type: "response.done", response: { status: "completed" } }); expect(h.sent().filter(e => e.type === "response.create")).toHaveLength(2);
    const pending = deferred<string>(); h.readImage.mockReturnValueOnce(pending.promise);
    const sending = h.call.sendPhoto(new File(["x"], "late.jpg")); h.call.end(); const count = h.channel.send.mock.calls.length;
    pending.resolve("data:image/jpeg;base64,eA=="); await sending;
    expect(h.channel.send).toHaveBeenCalledTimes(count); expect(h.call.getSnapshot().photoSending).toBe(false);
  });
  it("times out connection and stops the microphone; a retry uses a new generation", async () => {
    vi.useFakeTimers(); const h = setup(); h.connect.mockImplementationOnce(() => new Promise(() => {}));
    void h.call.start(); await vi.advanceTimersByTimeAsync(30_001);
    expect(h.call.getSnapshot().status).toBe("error"); expect(h.microphone.track.stop).toHaveBeenCalledOnce();
    await h.connected(); expect(h.call.getSnapshot().status).toBe("connected");
    await vi.advanceTimersByTimeAsync(600_001); expect(h.call.getSnapshot().status).toBe("ended"); expect(h.close).toHaveBeenCalledOnce();
  });
});

it("uses the chosen language for connection, greeting, and photo prompts", async () => {
  const h = setup("en"); await h.connected();
  expect(h.connect).toHaveBeenCalledWith(expect.any(String), expect.any(AbortSignal), "en");
  expect(h.sent()[0].response.instructions).toContain("English");
  await h.call.sendPhoto(new File(["x"], "sample.jpg"));
  const photo = h.sent().find(event => event.type === "conversation.item.create");
  expect(photo.item.content[0].text).toContain("English");
});

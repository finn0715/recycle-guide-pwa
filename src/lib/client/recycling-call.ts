import { callGreeting, type CallLanguage } from "@/lib/contracts/call-language";
import { captureCallImage, readCallImage } from "./call-images";

export type CallState = {
  status: "idle" | "connecting" | "connected" | "ended" | "error";
  activity: "listening" | "hearing" | "thinking" | "speaking";
  muted: boolean; camera: "off" | "starting" | "on"; photoSending: boolean;
  caption: string; heard: string; error: string | null; mediaError: string | null; audioBlocked: boolean;
};
export type CallOptions = {
  language?: CallLanguage;
  audio: HTMLAudioElement; video: HTMLVideoElement;
  media?: Pick<MediaDevices, "getUserMedia">;
  peer?: () => RTCPeerConnection;
  connect?: (sdp: string, signal: AbortSignal, language: CallLanguage) => Promise<{ sdp: string; close: () => void }>;
  readImage?: (file: File) => Promise<string>;
  capture?: (video: HTMLVideoElement) => string | null;
};
const initial = (): CallState => ({ status: "idle", activity: "listening", muted: false, camera: "off", photoSending: false, caption: "", heard: "", error: null, mediaError: null, audioBlocked: false });
async function connect(sdp: string, signal: AbortSignal, language: CallLanguage) {
  const response = await fetch("/api/call", { method: "POST", headers: { "Content-Type": "application/sdp", "X-Recycling-Language": language }, body: sdp, signal, cache: "no-store" });
  if (!response.ok) throw new Error("통화에 연결하지 못했어요. 잠시 뒤 다시 시작해 주세요.");
  const answer = await response.json();
  if (typeof answer.sdp !== "string" || !answer.sdp.startsWith("v=0") || answer.sdp.length > 65_536 || typeof answer.token !== "string" || !/^(?:[a-f0-9-]{36}|v1\.[A-Za-z0-9_-]{60,900})$/.test(answer.token)) throw new Error("통화 연결을 확인하지 못했어요. 다시 시작해 주세요.");
  return { sdp: answer.sdp as string, close: () => {
    void fetch("/api/call", { method: "DELETE", body: answer.token, keepalive: true, cache: "no-store" }).catch(() => {});
  } };
}
const stopTracks = (stream: MediaStream | null) => stream?.getTracks().forEach(track => track.stop());
export function createRecyclingCall(options: CallOptions) {
  const language = options.language ?? "ko";
  let state = initial();
  const listeners = new Set<() => void>();
  let closeRemote: (() => void) | null = null;
  let generation = 0, cameraGeneration = 0, photoGeneration = 0;
  let disposed = false, peer: RTCPeerConnection | null = null, channel: RTCDataChannel | null = null;
  let microphone: MediaStream | null = null, camera: MediaStream | null = null;
  let request: AbortController | null = null;
  let frameTimer: ReturnType<typeof setInterval> | undefined;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let durationTimer: ReturnType<typeof setTimeout> | undefined;
  let disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let responseActive = false, pendingPhotoReply = false;
  let imageIds: string[] = [], imageSequence = 0;
  const publish = (patch: Partial<CallState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  const live = (version: number) => !disposed && generation === version;
  function cameraOff() {
    cameraGeneration++; clearInterval(frameTimer); frameTimer = undefined;
    stopTracks(camera); camera = null; options.video.srcObject = null;
    publish({ camera: "off" });
  }
  function release() {
    generation++; photoGeneration++; request?.abort(); request = null;
    closeRemote?.(); closeRemote = null;
    clearTimeout(connectTimer); clearTimeout(durationTimer); clearTimeout(disconnectTimer);
    cameraOff(); stopTracks(microphone); microphone = null;
    channel?.close(); channel = null; peer?.close(); peer = null;
    options.audio.pause(); options.audio.srcObject = null;
    imageIds = []; responseActive = false; pendingPhotoReply = false;
  }
  function end() { release(); publish({ ...initial(), status: "ended" }); }
  function fail(message: string) { release(); publish({ ...initial(), status: "error", error: message }); }
  function send(event: object) {
    if (!channel || channel.readyState !== "open") return false;
    try { channel.send(JSON.stringify(event)); return true; }
    catch { fail("통화 연결이 끊겼어요. 다시 시작해 주세요."); return false; }
  }
  function requestReply() {
    if (responseActive) { pendingPhotoReply = true; return; }
    responseActive = true;
    send({ type: "response.create" });
  }
  function sendImage(image: string, uploaded = false) {
    if (state.status !== "connected" || !channel || channel.bufferedAmount > 120_000) return false;
    const id = `frame_${generation}_${++imageSequence}`;
    if (!send({ type: "conversation.item.create", item: { id, type: "message", role: "user", content: [
      { type: "input_text", text: language === "en" ? (uploaded ? "Here is the item. Please give brief disposal guidance in English." : "Current camera image. Only answer when I ask a question, in English.") : (uploaded ? "지금 물건의 사진이에요. 짧게 안내해 주세요." : "현재 카메라 화면이에요. 질문이 있을 때만 답해 주세요.") },
      { type: "input_image", image_url: image },
    ] } })) return false;
    imageIds.push(id);
    // Only the newest two image messages remain; never collect a video history.
    while (imageIds.length > 2) send({ type: "conversation.item.delete", item_id: imageIds.shift() });
    if (uploaded) requestReply();
    return true;
  }
  function frame() {
    if (state.camera !== "on" || state.status !== "connected") return;
    try {
      const image = options.capture ? options.capture(options.video) : captureCallImage(options.video, options.video.videoWidth, options.video.videoHeight);
      if (image) sendImage(image);
    } catch { cameraOff(); publish({ mediaError: "카메라 화면을 보내지 못했어요. 음성 대화는 계속할 수 있어요." }); }
  }
  async function play() {
    const version = generation;
    try { await options.audio.play(); if (live(version)) publish({ audioBlocked: false }); }
    catch { if (live(version)) publish({ audioBlocked: true }); }
  }
  function receive(raw: string, version: number) {
    if (!live(version)) return;
    let event: Record<string, unknown>;
    try { event = JSON.parse(raw); } catch { return; }
    switch (event.type) {
      case "session.created":
        clearTimeout(connectTimer); publish({ status: "connected" });
        durationTimer = setTimeout(end, 10 * 60_000);
        responseActive = true;
        send({ type: "response.create", response: { instructions: callGreeting(language) } }); break;
      case "input_audio_buffer.speech_started":
        publish({ activity: "hearing", caption: "", heard: "" }); frame(); break;
      case "input_audio_buffer.speech_stopped": publish({ activity: "thinking" }); frame(); break;
      case "conversation.item.input_audio_transcription.completed":
        if (typeof event.transcript === "string") publish({ heard: event.transcript.slice(0, 300) }); break;
      case "response.created": responseActive = true; publish({ activity: "thinking", caption: "" }); break;
      case "response.output_audio_transcript.delta":
        if (typeof event.delta === "string") publish({ caption: (state.caption + event.delta).slice(-1200) }); break;
      case "response.output_audio_transcript.done":
        if (typeof event.transcript === "string") publish({ caption: event.transcript.slice(0, 1200) }); break;
      case "output_audio_buffer.started": publish({ activity: "speaking" }); break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared": publish({ activity: "listening" }); break;
      case "response.done": {
        responseActive = false;
        const response = event.response as { status?: string } | undefined;
        if (response?.status === "failed") { fail("답변 연결에 문제가 생겼어요. 다시 시작해 주세요."); break; }
        if (response?.status === "incomplete") publish({ mediaError: "답변이 중간에 끊겼어요. 다시 설명해 달라고 말씀해 주세요." });
        if (pendingPhotoReply) { pendingPhotoReply = false; requestReply(); }
        break;
      }
      case "error": fail("대화 연결에 문제가 생겼어요. 다시 시작해 주세요."); break;
    }
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => state,
    async start() {
      if (disposed || state.status === "connecting" || state.status === "connected") return;
      release(); const version = generation;
      publish({ ...initial(), status: "connecting" });
      request = new AbortController(); const signal = request.signal;
      connectTimer = setTimeout(() => { if (live(version)) fail("연결이 오래 걸리고 있어요. 다시 시작해 주세요."); }, 30_000);
      try {
        const media = options.media ?? navigator.mediaDevices;
        if (!media?.getUserMedia) throw new Error("HTTPS로 접속해야 마이크를 사용할 수 있어요.");
        const stream = await media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (!live(version)) { stopTracks(stream); return; }
        microphone = stream;
        const connection = (options.peer ?? (() => new RTCPeerConnection()))(); peer = connection;
        for (const track of stream.getAudioTracks()) {
          track.addEventListener("ended", () => { if (live(version)) fail("마이크 연결이 끝났어요. 다시 시작해 주세요."); });
          connection.addTrack(track, stream);
        }
        connection.ontrack = event => { if (!live(version)) return; options.audio.srcObject = event.streams[0] ?? new MediaStream([event.track]); void play(); };
        connection.onconnectionstatechange = () => {
          if (!live(version)) return;
          if (connection.connectionState === "failed" || connection.connectionState === "closed") fail("통화 연결이 끊겼어요. 다시 시작해 주세요.");
          else if (connection.connectionState === "disconnected") {
            clearTimeout(disconnectTimer);
            disconnectTimer = setTimeout(() => { if (live(version)) fail("통화 연결이 끊겼어요. 다시 시작해 주세요."); }, 8_000);
          } else if (connection.connectionState === "connected") clearTimeout(disconnectTimer);
        };
        const events = connection.createDataChannel("oai-events"); channel = events;
        events.onmessage = event => receive(event.data, version);
        events.onclose = () => { if (live(version)) fail("통화가 끊겼어요. 다시 시작해 주세요."); };
        events.onerror = () => { if (live(version)) fail("통화 연결에 문제가 생겼어요. 다시 시작해 주세요."); };
        const offer = await connection.createOffer();
        if (!live(version)) return;
        await connection.setLocalDescription(offer);
        if (!live(version)) return;
        const sdp = connection.localDescription?.sdp;
        if (!sdp) throw new Error("통화를 준비하지 못했어요. 다시 시작해 주세요.");
        const answer = await (options.connect ?? connect)(sdp, signal, language);
        if (!live(version)) { answer.close(); return; }
        closeRemote = answer.close;
        await connection.setRemoteDescription({ type: "answer", sdp: answer.sdp });
      } catch (error) {
        if (!live(version)) return;
        const denied = (error instanceof Error || error instanceof DOMException) && ["NotAllowedError", "SecurityError"].includes(error.name);
        const safe = error instanceof Error && ["통화에 연결하지 못했어요. 잠시 뒤 다시 시작해 주세요.", "통화 연결을 확인하지 못했어요. 다시 시작해 주세요.", "HTTPS로 접속해야 마이크를 사용할 수 있어요."].includes(error.message) ? error.message : "통화를 연결하지 못했어요. 다시 시작해 주세요.";
        fail(denied ? "마이크 사용을 허용한 뒤 다시 시작해 주세요." : safe);
      }
    },
    end,
    mute() {
      if (state.status !== "connected") return;
      const muted = !state.muted;
      microphone?.getAudioTracks().forEach(track => { track.enabled = !muted; });
      publish({ muted });
    },
    async toggleCamera() {
      if (state.status !== "connected" || state.photoSending) return;
      if (state.camera !== "off") { cameraOff(); return; }
      const version = generation, cameraVersion = ++cameraGeneration;
      publish({ camera: "starting", mediaError: null });
      try {
        const stream = await (options.media ?? navigator.mediaDevices).getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } } });
        if (!live(version) || cameraGeneration !== cameraVersion) { stopTracks(stream); return; }
        camera = stream; options.video.srcObject = stream;
        stream.getVideoTracks().forEach(track => track.addEventListener("ended", () => { if (live(version) && cameraGeneration === cameraVersion) { cameraOff(); publish({ mediaError: "카메라 연결이 끝났어요. 음성 대화는 계속할 수 있어요." }); } }));
        await options.video.play();
        if (!live(version) || cameraGeneration !== cameraVersion) return;
        publish({ camera: "on" }); frame(); frameTimer = setInterval(frame, 3_000);
      } catch {
        if (!live(version) || cameraGeneration !== cameraVersion) return;
        cameraOff(); publish({ mediaError: "카메라를 켜지 못했어요. 사진을 보내거나 말로 설명해 주세요." });
      }
    },
    async sendPhoto(file: File) {
      if (state.status !== "connected" || state.photoSending) return;
      cameraOff(); const version = generation, photoVersion = ++photoGeneration;
      publish({ photoSending: true, mediaError: null });
      try {
        const image = await (options.readImage ?? readCallImage)(file);
        if (!live(version) || photoGeneration !== photoVersion) return;
        if (!sendImage(image, true)) publish({ mediaError: "사진을 보내지 못했어요. 다시 골라 주세요." });
      } catch (error) {
        if (live(version) && photoGeneration === photoVersion) publish({ mediaError: error instanceof Error ? error.message : "사진을 열지 못했어요. 다른 사진을 골라 주세요." });
      } finally { if (live(version) && photoGeneration === photoVersion) publish({ photoSending: false }); }
    },
    play,
    dispose() { if (disposed) return; release(); disposed = true; listeners.clear(); },
  };
}
export type RecyclingCall = ReturnType<typeof createRecyclingCall>;

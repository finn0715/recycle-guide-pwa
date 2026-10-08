"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Camera, CameraOff, ImagePlus, Mic, MicOff, PhoneOff, Pause, Play, Volume2, MapPin, Recycle, ArrowRight, Globe } from "lucide-react";
import { createRecyclingCall, type CallState, type RecyclingCall } from "@/lib/client/recycling-call";
import { type CallLanguage } from "@/lib/contracts/call-language";
import { callText, callError } from "./call-copy";
import styles from "./RecyclingCallApp.module.css";

const labels: Record<CallState["activity"], string> = { listening: "편하게 말씀하세요", hearing: "듣고 있어요", thinking: "버리는 방법을 확인하고 있어요", speaking: "이렇게 버려주세요" };
export function CallControls({ call, language = "ko" }: { call: RecyclingCall; language?: CallLanguage }) {
  const t = (text: string) => callText(language, text);
  const state = useSyncExternalStore(call.subscribe, call.getSnapshot, call.getSnapshot);
  const input = useRef<HTMLInputElement>(null);
  const captureInput = useRef<HTMLInputElement>(null); const id = useId();
  const pendingPhoto = useRef<File | null>(null);
  useEffect(() => {
    if (state.status === "connected" && pendingPhoto.current) {
      const file = pendingPhoto.current;
      pendingPhoto.current = null;
      void call.sendPhoto(file);
    } else if (state.status === "ended" || state.status === "error") {
      pendingPhoto.current = null;
    }
  }, [call, state.status]);
  useEffect(() => () => { pendingPhoto.current = null; }, [call]);
  const startVoice = () => { pendingPhoto.current = null; void call.start(); };
  const active = state.status === "connected";
  const connecting = state.status === "connecting";
  const onPhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (active) void call.sendPhoto(file);
    else { pendingPhoto.current = file; void call.start(); }
  };
  return <>
    <section className={styles.conversation} aria-label={t("음성 대화")}>
      {!active && !connecting ? <div className={styles.welcome}>
        <h1>{t("이거 어떻게 버리지?")}</h1>
        <button className={styles.voiceEntry} type="button" onClick={startVoice}>
          <span className={styles.voiceTop} aria-hidden="true"><span className={styles.entryWave}><i /><i /><i /><i /><i /><i /><i /></span><span className={styles.voiceArrow}><ArrowRight size={22} /></span></span>
          <span className={styles.voiceLabel}><Mic size={24} aria-hidden="true" /><strong>{state.status === "error" ? t("다시 연결하기") : t("말로 물어보기")}</strong></span>
          <small>{t("사진 없이 바로 대화해요")}</small>
        </button>
        <section className={styles.photoCard} aria-label={t("사진으로 시작하기")}>
          <div className={styles.photoHeading}><h2>{t("사진으로 시작하기")}</h2><DisposalIllustration /></div>
          <div className={styles.photoActions}>
            <button type="button" onClick={() => captureInput.current?.click()} aria-label={t("사진 찍기")}>
              <Camera size={24} aria-hidden="true" /><strong>{t("사진 찍기")}</strong><small>{t("휴대폰 카메라로 촬영")}</small>
            </button>
            <button type="button" onClick={() => input.current?.click()} aria-label={t("사진 선택")}>
              <ImagePlus size={24} aria-hidden="true" /><strong>{t("사진 선택")}</strong><small>{t("앨범·파일에서 가져오기")}</small>
            </button>
          </div>
        </section>
      </div> : <>
        <div className={styles.callStatus} role="status"><span className={styles.statusDot} data-active={active && !state.paused} />{connecting ? t("연결하고 있어요") : state.paused ? t("일시정지 중") : state.muted ? t("마이크가 꺼져 있어요") : t(labels[state.activity])}</div>
        {state.camera === "off" && <div className={styles.voiceOrb} data-speaking={!state.paused && (state.activity === "speaking" || state.activity === "hearing")} aria-hidden="true"><span /><span /><span /><span /><span /></div>}
        <p className={styles.liveHint}>{t(state.paused ? "마이크와 안내 음성을 멈췄어요" : "분리배출 안내 중")}</p>
        {state.heard && <p className={styles.heard}>{state.heard}</p>}
        <p className={styles.caption} aria-live="off">{state.caption || (connecting ? t("잠시만 기다려 주세요.") : t("무엇을 버리려고 하세요?"))}</p>
      </>}
      <input ref={captureInput} id={`${id}-capture`} className={styles.hidden} type="file" accept="image/*" capture="environment" aria-label={t("분리배출 사진 촬영")} onChange={onPhoto} />
      <input ref={input} id={id} className={styles.hidden} type="file" accept="image/*" aria-label={t("분리배출 사진 선택")} onChange={onPhoto} />
      {state.error && <p className={styles.error} role="alert">{callError(language, state.error)}</p>}
      {state.mediaError && <p className={styles.error} role="alert">{callError(language, state.mediaError)}</p>}
      {state.photoSending && <p className={styles.notice} role="status">{t("사진을 보내고 있어요")}</p>}
      {state.audioBlocked && !state.paused && <button className={styles.play} onClick={() => void call.play()}><Volume2 size={20} aria-hidden="true" />{t("소리 듣기")}</button>}
    </section>
    {(active || connecting) && <div className={styles.controls}>
      {active && <div className={styles.tools}>
        <button type="button" onClick={() => call.mute()} disabled={state.paused} aria-pressed={state.muted}>{state.muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}<span>{state.muted ? t("마이크 켜기") : t("마이크 끄기")}</span></button>
        <button type="button" onClick={() => void call.toggleCamera()} disabled={state.paused || state.photoSending} aria-pressed={state.camera !== "off"}>{state.camera === "off" ? <Camera aria-hidden="true" /> : <CameraOff aria-hidden="true" />}<span>{state.camera === "off" ? t("카메라 켜기") : state.camera === "starting" ? t("카메라 취소") : t("카메라 끄기")}</span></button>
        <button type="button" onClick={() => input.current?.click()} disabled={state.paused || state.photoSending}><ImagePlus aria-hidden="true" /><span>{t("사진 보내기")}</span></button>
      </div>}
      <div className={styles.sessionActions}>
      {active && <button type="button" className={styles.pause} onClick={() => call.togglePause()} aria-pressed={state.paused}>{state.paused ? <Play size={21} aria-hidden="true" /> : <Pause size={21} aria-hidden="true" />}{t(state.paused ? "계속하기" : "일시정지")}</button>}
      <button type="button" className={styles.end} onClick={() => { pendingPhoto.current = null; call.end(); }}><PhoneOff size={21} aria-hidden="true" />{connecting ? t("연결 취소") : t("안내 끝내기")}</button>
      </div>
    </div>}
    <footer className={styles.footer}>
      {!active && !connecting && <p className={styles.regionNote}><MapPin size={14} aria-hidden="true" />{t("현재는 서울 송파구 기준으로 안내해요")}</p>}
      <details><summary>{t("대화·카메라 안내")}</summary><p>{t("AI 음성 안내입니다. 대화 중 마이크 소리가 OpenAI로 전달됩니다. 사진을 선택하면 음성 안내에 연결한 뒤 사진을 전달합니다. 카메라를 켜면 약 3초마다 화면 사진을 전달합니다.")}</p><p>{t("앱은 음성·사진·대화를 저장하지 않습니다. 통화 종료나 페이지 이탈 시 마이크와 카메라를 끕니다. 한 통화는 최대 10분입니다.")}</p><p>{t("송파구 기준으로 안내하며, 성분이나 재질이 불분명하면 추가 확인이 필요합니다.")}</p></details>
    </footer>
  </>;
}

function DisposalIllustration() {
  return <svg className={styles.illustration} viewBox="0 0 360 208" fill="none" aria-hidden="true">
    <ellipse cx="184" cy="185" rx="115" ry="12" fill="#b8d4b0" opacity=".5" />
    <g transform="rotate(-14 143 108)">
      <path d="M127 43h34v20c0 9 22 17 22 34v68c0 12-8 19-20 19h-38c-12 0-20-7-20-19V97c0-17 22-25 22-34V43Z" fill="#f7fcf3" stroke="#27644c" strokeWidth="2" />
      <path d="M132 69c-1 11-17 17-17 30v58" stroke="#c6dfbf" strokeWidth="6" strokeLinecap="round" />
      <rect x="124" y="29" width="40" height="20" rx="5" fill="#275d49" />
      <path d="M132 34v10m8-10v10m8-10v10m8-10v10" stroke="#7b9f78" strokeWidth="2" />
      <path d="M105 104h78v47h-78z" fill="#b8d890" />
      <path d="m137 116-7 12h12m-10 10h14l-6-10m19 1-7-12-6 10" stroke="#285a43" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M117 163h54" stroke="#d1e2c8" strokeWidth="3" strokeLinecap="round" />
    </g>
    <g transform="rotate(12 236 139)">
      <path d="m203 107 7 66c1 7 7 11 14 11h33c7 0 12-4 13-11l7-66" fill="#faf5e9" stroke="#886e4e" strokeWidth="2" />
      <path d="m207 133 4 31h60l3-31" fill="#edb56b" />
      <rect x="197" y="101" width="86" height="11" rx="5" fill="#fffaf0" stroke="#886e4e" strokeWidth="2" />
      <path d="m206 101 5-10h58l6 10" fill="#fffaf0" stroke="#886e4e" strokeWidth="2" />
    </g>
    <path d="M62 69V53a8 8 0 0 1 8-8h16m188 0h16a8 8 0 0 1 8 8v16M62 153v16a8 8 0 0 0 8 8h16m188 0h16a8 8 0 0 0 8-8v-16" stroke="#739a66" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}

function CameraPreview({ call, video, language }: { call: RecyclingCall | null; language: CallLanguage; video: React.RefObject<HTMLVideoElement | null> }) {
  const t = (text: string) => callText(language, text);
  const state = useSyncExternalStore(call?.subscribe ?? (() => () => {}), call?.getSnapshot ?? (() => null), () => null);
  return <div className={styles.camera} hidden={!state || state.camera === "off"}>
    <video ref={video} autoPlay playsInline muted aria-label={t("통화 중 보여주는 카메라 화면")} />
    <span>{state?.camera === "starting" ? t("카메라를 켜고 있어요") : t("카메라 공유 중")}</span>
  </div>;
}
export function RecyclingCallApp() {
  const [language, setLanguage] = useState<CallLanguage>("ko");
  const t = (text: string) => callText(language, text);
  const audio = useRef<HTMLAudioElement>(null), video = useRef<HTMLVideoElement>(null);
  const [call, setCall] = useState<RecyclingCall | null>(null);
  useEffect(() => {
    const runtime = createRecyclingCall({ language, audio: audio.current!, video: video.current! });
    const end = () => runtime.end();
    window.addEventListener("pagehide", end);
    // Browser resources are recreated after StrictMode effect cleanup.
    setCall(runtime);
    return () => { window.removeEventListener("pagehide", end); runtime.dispose(); };
  }, [language]);
  return <main className={styles.app} lang={language}>
    <div className={styles.shell}>
      <header className={styles.header}><span className={styles.brand}><Recycle size={22} strokeWidth={2.2} aria-hidden="true" />{t("분리수거 길잡이")}</span><div className={styles.headerActions}><span className={styles.region}><MapPin size={14} aria-hidden="true" />{t("송파구")}</span><LanguagePicker call={call} language={language} onChange={setLanguage} /></div></header>
      <audio ref={audio} autoPlay className={styles.hidden} />
      <CameraPreview call={call} video={video} language={language} />
      {call ? <CallControls key={language} call={call} language={language} /> : <p className={styles.loading} role="status">{t("대화를 준비하고 있어요")}</p>}
    </div>
  </main>;
}

function LanguagePicker({ call, language, onChange }: { call: RecyclingCall | null; language: CallLanguage; onChange: (language: CallLanguage) => void }) {
  const state = useSyncExternalStore(call?.subscribe ?? (() => () => {}), call?.getSnapshot ?? (() => null), () => null);
  const busy = state?.status === "connected" || state?.status === "connecting";
  return <label className={styles.language} title={callText(language, busy ? "안내를 끝내면 언어를 바꿀 수 있어요" : "언어")}>
    <Globe size={16} aria-hidden="true" />
    <select aria-label="언어 / Language" value={language} disabled={busy} onChange={event => onChange(event.target.value as CallLanguage)}>
      <option value="ko">한국어</option><option value="en">English</option>
    </select>
  </label>;
}

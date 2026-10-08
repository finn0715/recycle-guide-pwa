"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, Camera, ImagePlus, MessageSquare, Mic, RotateCcw, Volume2, VolumeX } from "lucide-react";
import type { CoachController, CoachObject, CoachState } from "@/lib/client/coach-controller";
import type { GuideCatalog, GuideFlow } from "@/lib/contracts/coach";
import { ActionDiagram, DestinationList, PartShape } from "./ActionDiagram";
import { PhotoAnnotation } from "./PhotoAnnotation";
import { PreparationSummary, type PreparationGuide } from "./PreparationSummary";
import { SourcePanel } from "./SourcePanel";
import styles from "./PhotoRecyclingCoach.module.css";

export type PhotoRecyclingCoachProps = { controller: CoachController; catalog: GuideCatalog; preparationGuides?: PreparationGuide[]; onAudioGesture?: () => void };

function PhotoInputs({ controller, replace = false, disabled = false }: { controller: CoachController; replace?: boolean; disabled?: boolean }) {
  const id = useId();
  const take = replace ? "새 사진 찍기" : "찍고 안내받기";
  const select = replace ? "새 사진 고르기" : "사진 골라 안내받기";
  function receive(input: HTMLInputElement) { const files = Array.from(input.files ?? []); input.value = ""; if (files.length) void controller.selectPhotos(files); }
  return <div className={styles.photoInputs}>
    <label htmlFor={`${id}-camera`} className={`${styles.primary} ${styles.fileButton}`} aria-disabled={disabled}>
      <Camera aria-hidden="true" size={22} />{take}<input className={styles.srOnly} id={`${id}-camera`} aria-label={take} type="file" accept="image/*" capture="environment" disabled={disabled} onChange={e => receive(e.currentTarget)} />
    </label>
    <label htmlFor={`${id}-library`} className={`${styles.secondary} ${styles.fileButton}`} aria-disabled={disabled}>
      <ImagePlus aria-hidden="true" size={22} />{select}<input className={styles.srOnly} id={`${id}-library`} aria-label={select} type="file" accept="image/*" multiple disabled={disabled} onChange={e => receive(e.currentTarget)} />
    </label>
  </div>;
}
function HistoryChoices({ flow, object, controller }: { flow: GuideFlow; object: CoachObject; controller: CoachController }) {
  if (!object.history.length) return null;
  return <details className={styles.details}><summary>지금까지 한 선택 · 수정</summary><ol className={styles.history}>
    {object.history.map((entry, index) => {
      const step = flow.steps.find(s => s.id === entry.stepId)!;
      return <li key={`${index}-${entry.stepId}`}><p>{step.text}</p><form onSubmit={e => {
        e.preventDefault(); const value = new FormData(e.currentTarget).get("choice"); if (typeof value === "string") controller.correct(entry.stepId, value);
      }}><select key={entry.choiceId} name="choice" defaultValue={entry.choiceId} aria-label={`${index + 1}번째 선택 수정`}>{step.choices.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select><button type="submit" className={styles.secondary}>이 선택으로 고치기</button></form></li>;
    })}
  </ol><p className={styles.finePrint}>선택을 고치면 그다음 안내를 다시 진행해요.</p></details>;
}
function RecoveryTools({ state, controller }: { state: CoachState; controller: CoachController }) {
  const addId = useId();
  return <details className={styles.details}><summary>잘못 짚었어요 · 부분 다시 확인</summary>
    <div className={styles.recovery}>
      <p>부분이나 표시가 잘 보이게 찍어 주세요. 사진·품목을 바꾸면 지금까지의 선택을 지우고 다시 시작해요.</p>
      {state.photos.length > 0 && state.photos.length < 3 && <label className={`${styles.secondary} ${styles.fileButton}`} htmlFor={addId}><ImagePlus aria-hidden="true" size={20} />다른 각도 사진 추가<input className={styles.srOnly} id={addId} aria-label="다른 각도 사진 추가" type="file" accept="image/*" capture="environment" onChange={e => { const files = Array.from(e.currentTarget.files ?? []); e.currentTarget.value = ""; if (files.length) void controller.selectPhotos([...state.photos.map(p => p.file), ...files]); }} /></label>}
      <PhotoInputs controller={controller} replace />
    </div>
  </details>;
}

function VoiceControls({ state, controller, onAudioGesture }: Pick<PhotoRecyclingCoachProps, "controller" | "onAudioGesture"> & { state: CoachState }) {
  const [textOpen, setTextOpen] = useState(false); const input = useRef<HTMLTextAreaElement>(null); const questionId = useId();
  const recording = state.voice === "recording";
  const showText = textOpen || state.transcript !== null || !!state.helpText;
  const canRecord = typeof window === "undefined" || window.isSecureContext !== false;
  const current = state.current!;
  const replyChoices = current.step.choices.filter(choice => state.helpReply?.choiceIds.includes(choice.id));
  useEffect(() => { if (textOpen) input.current?.focus({ preventScroll: true }); }, [textOpen]);
  return <section className={styles.helpSection} aria-label="질문과 소리 안내">
    {recording ? <div className={styles.recording}>
      <p role="status"><span className={styles.recordingDot} />녹음 중 · 최대 20초</p>
      <p>말을 마치고 보내기를 눌러 주세요.</p>
      <button type="button" className={styles.primary} onClick={() => void controller.finishRecording()}>말 마치고 보내기</button>
      <button type="button" className={styles.secondary} onClick={() => controller.cancelRecording()}>녹음 취소</button>
    </div> : <div className={styles.helpButtons}>
      <button type="button" className={styles.secondary} disabled={!canRecord} onClick={() => void controller.startRecording()}><Mic size={20} aria-hidden="true" />말로 질문</button>
      <button type="button" className={styles.secondary} onClick={() => setTextOpen(open => !open)} aria-expanded={showText} aria-controls={questionId}><MessageSquare size={20} aria-hidden="true" />글로 질문</button>
      <button type="button" className={styles.quiet} disabled={state.muted} onClick={() => { onAudioGesture?.(); void controller.replay(); }}><RotateCcw size={18} aria-hidden="true" />다시 듣기</button>
      <button type="button" className={styles.quiet} onClick={() => { if (state.muted) onAudioGesture?.(); void controller.mute(!state.muted); }}>{state.muted ? <Volume2 size={18} aria-hidden="true" /> : <VolumeX size={18} aria-hidden="true" />}{state.muted ? "소리 켜기" : "소리 끄기"}</button>
    </div>}
    {!canRecord && <p className={styles.finePrint}>이 연결에서는 마이크를 사용할 수 없어요. 글로 질문해 주세요.</p>}
    {state.voice === "processing" && <p className={styles.voiceStatus} role="status">소리나 답을 준비하고 있어요. 화면 안내는 계속할 수 있어요.</p>}
    {state.voice === "speaking" && <p className={styles.voiceStatus} role="status">안내를 읽고 있어요.</p>}
    {state.voiceError && <div className={styles.voiceError} role="status"><p>{state.voiceError}</p><p>화면의 버튼이나 글 질문으로 이어갈 수 있어요.</p></div>}
    {showText && <form id={questionId} className={styles.questionForm} onSubmit={e => { e.preventDefault(); void controller.requestHelp(); }}>
      <label htmlFor={`${questionId}-text`}>질문 내용</label>
      {state.transcript !== null && <p className={styles.finePrint}>들은 말이 다르면 고친 뒤 다시 보내 주세요.</p>}
      <textarea id={`${questionId}-text`} ref={input} rows={3} value={state.helpText} onChange={e => controller.setHelpText(e.target.value)} placeholder="어느 부분인지, 왜 안 되는지 적어 주세요." />
      <button className={styles.secondary} type="submit" disabled={!state.helpText.trim() || recording}>질문 보내기</button>
    </form>}
    {state.helpReply && <div className={styles.helpReply}><p>{state.helpReply.text}</p>{!current.ended && <div role="group" aria-label="도움 답의 추천 선택" className={styles.replyChoices}>{replyChoices.map(choice => <button type="button" className={styles.secondary} key={choice.id} onClick={() => controller.choose(choice.id, current.step.id)}>{choice.label}</button>)}</div>}<p className={styles.finePrint}>맞는 답을 직접 골라 주세요.</p></div>}
  </section>;
}

/** Presentation only: the owner keeps controller lifetime stable, including StrictMode mounts. */
export function PhotoRecyclingCoach({ controller, catalog, preparationGuides, onAudioGesture }: PhotoRecyclingCoachProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const object = state.objects.find(candidate => candidate.objectId === state.activeObjectId);
  const flow = catalog.flows.find(candidate => candidate.id === object?.flowId);
  const category = catalog.categories.find(candidate => candidate.id === flow?.categoryId);
  const current = state.current;
  const preparation = preparationGuides?.find(guide => guide.categoryId === flow?.categoryId);
  const busy = state.progress === "preparing" || state.progress === "recognizing";
  const guidance = useRef<HTMLDivElement>(null); const heading = useRef<HTMLHeadingElement>(null);
  const stepId = current?.step.id;
  useEffect(() => {
    if (state.guidanceStarted && stepId) { heading.current?.focus({ preventScroll: true }); guidance.current?.scrollIntoView?.({ block: "start", behavior: "instant" }); }
  }, [stepId, state.activeObjectId, state.guidanceStarted]);
  const currentLabel = state.progress === "complete" ? "이 물건 준비 완료" : state.progress === "needs_help" ? "이 물건은 확인이 필요해요" : "지금 할 일";
  return <main className={styles.app}>
    <div className={styles.shell}>
      <header className={styles.header}><span className={styles.brand}>분리수거 길잡이</span><span className={styles.region}>송파구 기준</span></header>
      {!current && !busy && <section className={styles.start} aria-labelledby="start-title">
        <div className={styles.cameraScene} aria-hidden="true"><svg viewBox="0 0 300 180"><path d="M53 53V31h30m134 0h30v22M53 129v22h30m134 0h30v-22" fill="none" stroke="#21745a" strokeWidth="3" /><g color="#37584c"><PartShape categoryId="pump_bottle" x={70} y={67} scale={.8} /><PartShape role="pump" x={78} y={28} scale={.63} /><PartShape categoryId="metal_can" x={151} y={81} scale={.68} /></g><path d="M63 108h174" stroke="#83bca6" strokeWidth="2" strokeDasharray="6 6" /></svg></div>
        <h1 id="start-title">버릴 물건을 찍어 주세요</h1>
        <PhotoInputs controller={controller} />
      </section>}
      {busy && <section className={styles.busy} aria-live="polite" aria-busy="true"><span className={styles.busyMark} /><h1>{state.progress === "preparing" ? "사진을 준비하고 있어요" : state.mode === "photo" ? "사진 속 물건을 찾고 있어요" : "물건에 맞는 안내를 찾고 있어요"}</h1><p>{state.progress === "preparing" || state.mode === "photo" ? "물건과 보이는 부품을 확인해요." : "적어 주신 이름과 상태를 확인해요."}</p>{state.photos.length > 0 && <PhotoAnnotation photos={state.photos} observation={null} targetRoles={[]} />}<button className={styles.secondary} type="button" onClick={() => controller.reset()}>취소하고 처음으로</button></section>}
      {state.error && <section className={styles.error} role="alert"><p>{state.error}</p>{state.progress === "error" && !state.requiresRestart && <button type="button" className={styles.secondary} onClick={() => void controller.retryRecognition()}>다시 확인하기</button>}{state.requiresRestart && <button type="button" className={styles.secondary} onClick={() => controller.reset()}>처음부터 다시 시작</button>}</section>}
      {current && object && flow && <>
        {state.objects.length > 1 && <nav className={styles.objectTabs} aria-label="안내할 물건 바꾸기">{state.objects.map((item, index) => <button type="button" key={item.objectId ?? "unidentified"} aria-label={`물건 ${index + 1} ${item.observation?.label ?? "확인할 물건"}`} aria-pressed={item.objectId === state.activeObjectId} onClick={() => controller.switchObject(item.objectId)}><span>물건 {index + 1}</span>{item.observation?.label ?? "확인할 물건"}</button>)}</nav>}
        <div className={`${styles.guidance} ${preparation && !state.guidanceStarted ? styles.quickGuidance : ""}`} ref={guidance}>
          <div className={styles.progress}><span>{state.mode === "photo" ? object.observation?.label ?? "사진 속 물건" : "사진 없이 직접 고른 물건"}</span><span>{state.progress === "complete" ? "이 물건 준비됨" : current.held ? "확인 전 보류" : state.guidanceStarted ? `지금 ${object.history.length + 1}번째 안내` : preparation ? "배출 방법" : "내 물건 확인"}</span></div>
          {state.photos.length > 0 ? <PhotoAnnotation key={state.activeObjectId ?? "unidentified"} photos={state.photos} observation={object.observation} targetRoles={state.guidanceStarted ? current.step.targetRoles : []} /> : <p className={styles.manualNotice}>{category?.label ?? "확인할 물건"}{preparation && !state.guidanceStarted ? " · 직접 고른 품목" : " · 아래 그림은 예시예요."}</p>}
          {!state.guidanceStarted ? <section className={styles.ready}>
            {!preparation && state.photos.length === 0 && <ActionDiagram step={current.step} categoryId={flow.categoryId} />}
            {preparation ? <PreparationSummary key={`${state.activeObjectId}-${flow.id}`} guide={preparation} /> : <><h1>{object.observation?.label ?? "이 물건부터 확인해요"}</h1><p>{state.mode === "photo" ? "사진과 같은 물건이면 안내를 시작해 주세요." : "실제 물건과 맞으면 안내를 시작해 주세요."}</p></>}
            <button className={preparation ? styles.quiet : styles.primary} type="button" onClick={() => { onAudioGesture?.(); void controller.startGuidance(); }}>{preparation ? "잘 안 되나요? 단계별 도움 받기" : "이 물건 안내 시작"}</button>
            {preparation && <button className={styles.primary} type="button" onClick={() => controller.reset()}>다른 물건 찍기</button>}
          </section> : <>
            <section className={styles.currentAction} aria-labelledby="current-heading">
              <h2 id="current-heading" className={styles.currentHeading} ref={heading} tabIndex={-1}>{currentLabel}</h2>
              {current.step.kind !== "complete" && <ActionDiagram step={current.step} categoryId={flow.categoryId} />}
              <p className={styles.instruction} key={current.step.id}>{current.step.text}</p>
              {current.destinations.length > 0 && <DestinationList destinations={current.step.kind === "complete" || current.ended || current.held ? current.destinations : current.step.destinations} categoryId={flow.categoryId} />}
              {!current.ended && <div role="group" aria-label="현재 행동 선택" className={styles.choices}>{current.step.choices.map((choice, i) => <button type="button" key={`${current.step.id}-${choice.id}`} className={i === 0 && !current.held ? styles.primary : styles.secondary} onClick={() => controller.choose(choice.id, current.step.id)}>{choice.label}</button>)}</div>}
              {object.history.length > 0 && <button type="button" className={styles.back} onClick={() => controller.back()}><ArrowLeft size={17} aria-hidden="true" />이전 선택 바꾸기</button>}
            </section>
            <VoiceControls key={state.activeObjectId ?? "unidentified"} state={state} controller={controller} onAudioGesture={onAudioGesture} />
            <SourcePanel catalog={catalog} current={current} object={object} />
            <HistoryChoices flow={flow} object={object} controller={controller} />
          </>}
          <RecoveryTools state={state} controller={controller} />
          {(state.progress === "complete" || current.ended) && <button type="button" className={styles.secondary} onClick={() => controller.reset()}>다른 사진으로 새로 시작</button>}
        </div>
      </>}
      <footer className={styles.footer}><details className={styles.appInfo}>
        <summary>앱 정보</summary>
        <p>사진·질문·녹음은 OpenAI로 보내 처리하며 앱에 보관하지 않습니다. 안내 음성은 AI가 생성합니다.</p>
        <p>녹음은 ‘말로 질문’을 눌렀을 때 시작하며, 보내기 전 취소할 수 있습니다.</p>
      </details></footer>
    </div>
  </main>;
}

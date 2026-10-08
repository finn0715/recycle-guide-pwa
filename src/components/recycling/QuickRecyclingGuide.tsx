"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { ArrowLeft, ArrowRight, Brush, Camera, ChevronDown, Droplets, GlassWater, ImagePlus, LoaderCircle, Milk, Package, Recycle, RotateCcw, ScanLine, Snowflake, Tag, Utensils, X, type LucideIcon } from "lucide-react";
import type { ItemId } from "@/lib/contracts";
import type { QuickGuide } from "@/lib/contracts/quick";
import { createQuickGuideController, type QuickGuideController } from "@/lib/client/quick-guide-controller";
import styles from "./QuickRecyclingGuide.module.css";

const icons: Record<ItemId, LucideIcon> = { pump_bottle: Droplets, clear_pet_bottle: GlassWater, drink_carton: Milk, cardboard_box: Package, foam_box: Package, snack_bag: Tag, takeaway_container: Utensils, glass_jar: GlassWater, toothbrush: Brush, ice_pack: Snowflake };

export function QuickRecyclingGuide({ guides, controller: provided }: { guides: QuickGuide[]; controller?: QuickGuideController }) {
  const [controller] = useState(() => provided ?? createQuickGuideController());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [pickerOpen, setPickerOpen] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const guide = guides.find(guide => guide.id === state.activeId);
  const method = guide?.methods.find(method => method.id === state.methodId) ?? (guide?.question ? undefined : guide?.methods[0]);
  const busy = state.status === "loading" || state.status === "preparing";
  useEffect(() => {
    const clear = () => controller.reset();
    window.addEventListener("pagehide", clear);
    return () => { window.removeEventListener("pagehide", clear); controller.dispose(); };
  }, [controller]);
  useEffect(() => {
    if (state.activeId) heading.current?.focus({ preventScroll: true });
  }, [state.activeId]);
  function select(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setPickerOpen(false);
    void controller.selectPhotos(files);
  }
  function chooseItem(id: ItemId, origin: "manual" | "photo" = "manual") {
    controller.pickItem(id, origin); setPickerOpen(false);
  }
  function reset() { controller.reset(); setPickerOpen(false); }
  const itemPicker = (compact = false) => <div className={compact ? styles.pickerCompact : styles.itemGrid}>
    {guides.map(item => { const Icon = icons[item.id]; return <button key={item.id} className={styles.itemButton} onClick={() => chooseItem(item.id)} aria-label={`${item.shortLabel} 배출 방법`}><Icon size={23} aria-hidden="true" /><span>{item.shortLabel}</span></button>; })}
  </div>;

  return <div className={styles.page}>
    <header className={styles.header}>
      <button className={styles.brand} onClick={reset} aria-label="RecycleGuide 처음으로"><span><Recycle size={21} /></span>RecycleGuide</button>
      <span className={styles.region}>송파구 기준</span>
    </header>
    <main className={styles.main}>
      <input ref={camera} className={styles.hidden} type="file" accept="image/*" capture="environment" aria-label="촬영한 사진으로 분석" onChange={select} />
      <input ref={picker} className={styles.hidden} type="file" accept="image/*" multiple aria-label="선택한 사진으로 분석" onChange={select} />
      {!guide && !busy && <section className={styles.intro}>
        <span className={styles.eyebrow}>버리는 방법, 바로 찾기</span>
        <h1>이거, 어디에 버리지?</h1>
        <p>사진으로 찾거나 물건을 바로 골라 보세요.</p>
      </section>}

      {state.photos.length > 0 && <div className={styles.photoBar}>
        <div className={styles.thumbnails}>{state.photos.map(photo => <Image key={photo.id} src={photo.url} alt={photo.name} width={44} height={44} unoptimized />)}</div>
        <span>{state.photos.length}장 {state.items.length > 0 && `· ${state.items.length}종 찾음`}</span>
        <button onClick={reset} className={styles.iconButton} aria-label="사진 삭제하고 처음으로"><X size={18} /></button>
      </div>}

      {busy && <section className={styles.loading} role="status"><div className={styles.scanIcon}><ScanLine size={32} /><LoaderCircle className={styles.spinner} size={18} /></div><h1>{state.status === "preparing" ? "사진을 준비하고 있어요" : "사진 속 물건을 찾고 있어요"}</h1><p>여러 물건도 하나씩 나눠서 알려드려요.</p><button className={styles.textButton} onClick={() => { reset(); setPickerOpen(true); }}>기다리지 않고 직접 고르기 <ArrowRight size={16}/></button></section>}

      {state.error && <div className={styles.error} role="alert"><p>{state.error}</p>{state.photos.length > 0 && !busy && <button className={styles.textButton} onClick={() => void controller.retry()}><RotateCcw size={15} /> 사진 다시 분석</button>}</div>}
      {state.notice && !busy && <p className={styles.notice}>{state.notice}</p>}

      {!guide && !busy && <>
        <section aria-label="사진으로 물건 찾기" className={styles.upload}>
          <div className={styles.captureButtons}>
            <button className={styles.primary} onClick={() => camera.current?.click()}><Camera size={21} /> 찍고 분석하기</button>
            <button className={styles.secondary} onClick={() => picker.current?.click()}><ImagePlus size={21} /> 사진 골라 분석</button>
          </div>
          <p className={styles.privacy}>선택한 사진은 OpenAI로 전송돼요. 앱에는 저장하지 않아요.<br />사진 1~3장 · 장당 5MB · 여러 물건도 함께 찍어 주세요.</p>
        </section>
        <section className={styles.quickPick} aria-label="물건 직접 선택"><div className={styles.sectionHeading}><h2>사진 없이 바로 고르기</h2><span>10가지 생활용품</span></div>{itemPicker()}</section>
        <details className={styles.smallPrint}><summary>사진·기준 안내 <ChevronDown size={14}/></summary><p>사진은 JPG·PNG·WebP를 지원해요. 촬영이 열리지 않으면 기본 카메라로 찍은 사진을 골라 주세요. 사진 속 개인정보는 가려 주세요. 외부 서비스의 데이터 처리 정책은 별도로 적용돼요. 안내는 해당 재질과 상태의 배출 준비 방법이며, 사진만으로 내부 상태를 확인한 결과는 아니에요.</p></details>
      </>}

      {guide && !busy && <section className={styles.result} aria-label="분리배출 방법">
        {state.items.length > 1 && <nav className={styles.itemTabs} aria-label="사진에서 찾은 물건">{state.items.map(id => <button key={id} aria-pressed={state.activeId === id} onClick={() => chooseItem(id, "photo")}>{guides.find(item => item.id === id)?.shortLabel}</button>)}</nav>}
        <div className={styles.resultTop}><span className={styles.eyebrow}>{state.origin === "photo" ? "사진에서 찾았어요" : "직접 고른 물건"}</span><button className={styles.textButton} aria-expanded={pickerOpen} onClick={() => setPickerOpen(!pickerOpen)}>물건 바꾸기 <ChevronDown size={14} /></button></div>
        {pickerOpen && <section className={styles.changePicker} aria-label="다른 물건 선택">{itemPicker(true)}</section>}
        <h1 tabIndex={-1} ref={heading} className={styles.resultTitle}>{guide.label}<span>이렇게 버리세요.</span></h1>
        {guide.methods.length > 1 && <div className={styles.methods}><p>{guide.question ?? "상태에 맞는 방법을 골라 보세요."}</p><div>{guide.methods.map(option => <button key={option.id} aria-pressed={method?.id === option.id} onClick={() => controller.pickMethod(option.id)}>{option.label}</button>)}</div></div>}
        {!method && <p className={styles.selectHint}>위에서 한 번 선택하면 바로 방법이 나와요.</p>}
        {method && <article key={method.id}>
          <p className={styles.scope}>{method.scope}</p>
          <div className={styles.steps} aria-label="먼저 할 일">{method.steps.map((step,index) => <div key={step}><span className={styles.stepNumber}>{index+1}</span><p>{step}</p></div>)}</div>
          {method.parts.length > 0 && <section className={styles.bins} aria-label="부품별 버리는 곳">{method.parts.map(part => <div key={part.name} className={styles.binRow}><div><strong>{part.name}</strong>{part.note && <small>{part.note}</small>}</div><span data-general={part.bin === "일반쓰레기"}>{part.bin}</span></div>)}</section>}
          {method.note && <details className={styles.note}><summary>예외·주의할 점 <ChevronDown size={14}/></summary><p>{method.note}</p></details>}
          <details className={styles.sources}><summary>공식 근거 보기 <span>{method.sources.length}개 <ChevronDown size={14}/></span></summary><ul>{method.sources.map(source => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}<ArrowRight size={13}/></a><small>확인 {source.checkedAt}</small></li>)}</ul></details>
        </article>}
        <div className={styles.resultActions}><button className={styles.secondary} onClick={reset}><ArrowLeft size={17}/> 다른 물건 고르기</button><button className={styles.primary} onClick={() => picker.current?.click()}><ImagePlus size={17}/> 새 사진 분석</button></div>
        <p className={styles.resultPrivacy}>새로 선택한 사진은 분석을 위해 OpenAI로 전송돼요.</p>
      </section>}
    </main>
    <footer className={styles.footer}>RecycleGuide <span>·</span> WAICY 2026</footer>
  </div>;
}

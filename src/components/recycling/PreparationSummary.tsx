"use client";

import { useEffect, useRef, useState } from "react";
import type { QuickMethod } from "@/lib/contracts/quick";
import styles from "./PhotoRecyclingCoach.module.css";

export type PreparationGuide = { categoryId: string; label: string; question?: string; methods: QuickMethod[] };

/** Instructions, not a report of observed facts or completed preparation. */
export function PreparationSummary({ guide }: { guide: PreparationGuide }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView?.({ block: "start" }); }, []);
  const [selected, setSelected] = useState<string | null>(null);
  const method = guide.methods.find(item => item.id === selected) ?? (guide.question ? undefined : guide.methods[0]);
  return <section className={styles.summary} aria-label="바로 보는 배출 방법">
    <h1 ref={heading} tabIndex={-1}>{guide.label}</h1>
    {guide.methods.length > 1 && <div className={styles.methodPicker}>
      <p>{guide.question ?? "상태에 맞는 방법"}</p>
      <div role="group" aria-label="배출 방법 선택">{guide.methods.map(item => <button key={item.id} type="button" aria-pressed={method?.id === item.id} onClick={() => setSelected(item.id)}>{item.label}</button>)}</div>
    </div>}
    {!method && <p className={styles.finePrint}>모르면 ‘모름’ 또는 ‘기타’를 골라 주세요.</p>}
    {method && <>
      <p className={styles.summaryScope}>{method.scope}</p>
      <h2>이렇게 준비하세요</h2>
      <ol className={styles.preparationSteps}>{method.steps.map(step => <li key={step}>{step}</li>)}</ol>
      {method.parts.length > 0 && <><h2>준비한 뒤 버릴 곳</h2><dl className={styles.preparationBins}>{method.parts.map(part => <div key={part.name}><dt>{part.name}{part.note && <small>{part.note}</small>}</dt><dd>{part.bin}</dd></div>)}</dl></>}
      {method.note && <p className={styles.summaryNote}>{method.note}</p>}
      <details className={styles.details}><summary>배출 기준 보기</summary>{method.sources.map(source => <a className={styles.summarySource} key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title}<small>확인 {source.checkedAt}</small></a>)}</details>
    </>}
  </section>;
}

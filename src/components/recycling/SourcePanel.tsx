import type { CSSProperties } from "react";
import type { CoachCurrent, CoachObject } from "@/lib/client/coach-controller";
import type { CoachSource, Destination, GuideCatalog, Step } from "@/lib/contracts/coach";
import { BIN_COLORS, partLabel } from "./ActionDiagram";
import styles from "./PhotoRecyclingCoach.module.css";

type ReportedChoice = { text: string; label: string; id: string };
function reportedChoices(catalog: GuideCatalog, object: CoachObject, reached: Step[], ruleIds: string[], preparationIds: string[] = []): ReportedChoice[] {
  const conditionKeys = new Set(catalog.rules.filter(rule => ruleIds.includes(rule.id)).flatMap(rule => Object.keys(rule.conditions)));
  return object.history.flatMap(entry => {
    // Only steps in this reached prefix count. Never recover an answer from another branch.
    const step = reached.find(item => item.id === entry.stepId);
    const choice = step?.choices.find(item => item.id === entry.choiceId);
    return choice && (preparationIds.includes(step!.id) || Object.keys(choice.factPatch).some(key => conditionKeys.has(key)))
      ? [{ text: step!.text, label: choice.label, id: entry.stepId }] : [];
  });
}
function ReportedConditions({ choices }: { choices: ReportedChoice[] }) {
  return <dl>{choices.map(item => <div key={item.id}><dt>{item.text}</dt><dd>{item.label}</dd></div>)}</dl>;
}
function SourceLinks({ sources }: { sources: CoachSource[] }) {
  return <>{sources.map(source => <article key={source.id} className={styles.source}>
    <span className={styles.sourceScope}>{source.scope === "songpa" ? "송파구 배출 기준" : "전국 공통 참고"}</span>
    <strong>{source.publisher}</strong><p>{source.section}</p>
    <span className={styles.checked}>내용 확인 {source.checkedAt}</span>
    <a href={source.url} target="_blank" rel="noreferrer">원문에서 확인 <span className={styles.srOnly}>{source.title} (새 창)</span></a>
  </article>)}</>;
}

function DestinationEvidence({ destination, reached, object, catalog }: { destination: Destination; reached: Step[]; object: CoachObject; catalog: GuideCatalog }) {
  // The owner is the reached step that produced this actual destination, not the
  // final complete step or a later broad handoff that did not supersede it.
  const owner = [...reached].reverse().find(step => step.destinations.some(item => item.partRole === destination.partRole && item.bin === destination.bin))!;
  const prefix = reached.slice(0, reached.indexOf(owner) + 1);
  const before = prefix.filter(step => !["destination", "complete", "handoff"].includes(step.kind));
  const failedStep = before.at(-1);
  const held = destination.bin === "hold";
  const preparation = held
    ? failedStep?.targetRoles.includes(destination.partRole) ? [failedStep] : []
    : before.filter(step => step.targetRoles.includes(destination.partRole) && step.ruleIds.some(id => destination.ruleIds.includes(id)));
  // Include the material/structure explanation and the latest preparation reason.
  // Both must be from this destination's reached rule path; no unvisited action is inferred.
  const reasons = [...new Set((held ? [owner, ...preparation] : preparation.length ? [preparation[0], preparation[preparation.length - 1]] : [owner]).map(step => step.reason))];
  const ruleIds = [...new Set([...destination.ruleIds, ...(held ? preparation.flatMap(step => step.ruleIds) : [])])];
  const sourceIds = new Set([...destination.sourceIds, ...(held ? preparation.flatMap(step => step.sourceIds) : [])]);
  const reported = reportedChoices(catalog, object, prefix, ruleIds, preparation.map(step => step.id));
  return <section aria-label={`${partLabel(destination.partRole)} 배출 근거`} className={styles.destinationEvidence} style={{ "--bin-color": BIN_COLORS[destination.bin] } as CSSProperties}>
    <div className={styles.evidenceTitle}><h3>{partLabel(destination.partRole)}</h3><strong>{destination.label}</strong></div>
    <div className={styles.evidenceReasons}>{reasons.map(reason => <p key={reason}>{reason}</p>)}</div>
    {reported.length > 0 && <details className={styles.evidenceConditions}><summary>{held ? "보류까지 직접 확인한 내용" : "적용 조건과 내가 한 준비"}</summary><ReportedConditions choices={reported} /></details>}
    <SourceLinks sources={catalog.sources.filter(source => sourceIds.has(source.id))} />
  </section>;
}

export function SourcePanel({ catalog, current, object }: { catalog: GuideCatalog; current: CoachCurrent; object: CoachObject }) {
  const flow = catalog.flows.find(item => item.id === object.flowId);
  const category = catalog.categories.find(item => item.id === flow?.categoryId);
  // On an ended handoff the replay's current step filters out already-resolved roles.
  const reached = [...new Map([...current.visited, current.step].map(step => [step.id, step])).values()];
  const isResult = current.step.kind === "complete" || current.ended || current.held;
  const reported = reportedChoices(catalog, object, reached, current.step.ruleIds);
  return <details className={styles.details}>
    <summary>왜 이렇게 버리나요?</summary>
    <section aria-label="현재 안내의 근거" className={styles.sourcePanel}>
      {isResult && current.destinations.length > 0 ? <>
        <p className={styles.finePrint}>{category?.description ?? "아직 적용할 재질·용도를 확정하지 못했어요."}</p>
        {current.destinations.map(destination => <DestinationEvidence key={destination.partRole} destination={destination} reached={reached} object={object} catalog={catalog} />)}
      </> : <>
        <p className={styles.reason}>{current.step.reason}</p>
        <h3>이 안내가 적용되는 물건</h3>
        <p>{category?.description ?? "아직 적용할 재질·용도를 확정하지 못했어요."}</p>
        {reported.length > 0 && <><h3>내가 확인한 조건</h3><ReportedConditions choices={reported} /></>}
        <h3>현재 행동의 공식 근거</h3>
        <SourceLinks sources={catalog.sources.filter(source => current.step.sourceIds.includes(source.id))} />
      </>}
      <p className={styles.finePrint}>내용 확인일은 원문을 대조한 날짜예요.</p>
    </section>
  </details>;
}

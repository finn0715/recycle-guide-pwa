import { useId } from "react";
import type { CSSProperties } from "react";
import type { Destination, Step } from "@/lib/contracts/coach";
import styles from "./PhotoRecyclingCoach.module.css";

export const PART_LABELS: Record<string, string> = {
  body: "본체", pump: "펌프", label: "라벨", cap: "뚜껑", lid: "덮개", straw: "빨대", sleeve: "종이 띠", film: "필름", tape: "테이프", handle: "손잡이", coolant: "내용물", contents: "내용물", accessory: "다른 부품", accessories: "다른 부품",
};
export function partLabel(role: string) { return PART_LABELS[role] ?? "확인할 부품"; }
export const BIN_COLORS: Record<Destination["bin"], string> = {
  metal: "#32688b", plastic: "#246e58", clear_pet: "#157889", glass: "#56763d", paper: "#936c35", carton: "#657732", vinyl: "#6c5d98", foam: "#586975", general: "#695c50", special_collection: "#8b5927", hold: "#925323",
};

/** External silhouettes only. No unseen spring or contents is presented as an observation. */
export function PartShape({ role = "body", categoryId, x = 0, y = 0, scale = 1 }: { role?: string; categoryId?: string | null; x?: number; y?: number; scale?: number }) {
  return <g data-shape={role === "body" ? categoryId ?? "bottle" : role} transform={`translate(${x} ${y}) scale(${scale})`} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    {role === "pump" ? <><path d="M21 30h38v12H21z" fill="#accbbb" /><path d="M36 29V12h27V4H19L9 10h26M40 42v48" fill="none" /></>
      : role === "label" || role === "film" || role === "sleeve" ? <><path d="M12 24Q38 16 62 27v47Q36 64 12 74z" fill="#eccb74" /><path d="M22 37h25m-25 9h20m-20 9h26" opacity=".5" /></>
      : role === "cap" || role === "lid" ? <><path d="M18 32h43v27H18z" fill="#93bcb3" /><path d="M26 35v20m8-20v20m9-20v20m9-20v20" /></>
      : role === "straw" ? <path d="M25 90V29l27-13 5 10-21 10v54z" fill="#eccb74" />
      : role === "tape" ? <path d="M11 31q38-20 49 0v50q-18-18-49 0z" fill="#eccb74" />
      : <BodyShape categoryId={categoryId} />}

  </g>;
}

function BodyShape({categoryId}:{categoryId?:string|null}) {
  switch (categoryId) {
    case "toothbrush": return <><path d="M34 39h14l-2 49q-5 13-10 0z" fill="#a9c9d9"/><path d="M32 8h18v32H32z" fill="#edf3e9"/><path d="M35 10v25m5-25v25m5-25v25M32 17h18m-18 8h18" strokeWidth="1.5"/></>;
    case "metal_scrap": return <><path d="m24 14 10 17 13-7-9-17c16-2 26 17 18 28L32 79a12 12 0 1 1-16-12l26-39" fill="#d0dde4"/><circle cx="25" cy="80" r="4" fill="#fff"/><path d="M50 66h22m-14-7v34m-4 0h8"/></>;
    case "cardboard_box": return <><path d="m9 42 31-16 31 16v42L40 101 9 84z" fill="#e1c594"/><path d="m9 42 31 15 31-15M40 57v44"/><path d="M9 42 1 23l31-15 8 18 9-18 30 15-8 19-31-16z" fill="#eddbb4"/></>;
    case "foam_box": return <><path d="m7 38 34-12 32 12v50l-32 12L7 88z" fill="#f8faf6"/><path d="m7 38 34 12 32-12M41 50v50M7 48l34 12 32-12"/><path d="M17 65h1m11 10h1m-10 9h1m34-17h1m5 15h1" stroke="#aab8af" strokeWidth="3"/></>;
    case "drink_carton": return <><path d="M16 33 28 12h26l12 21v62H16z" fill="#f2e7c9"/><path d="M16 33h50L54 12M28 12v20m-3 19h31v25H25z" fill="none"/></>;
    case "paper": return <><path d="M10 22h45l15 16v58H10z" fill="#f2e7c9"/><path d="M55 22v16h15M22 50h35M22 63h35M22 76h27" fill="none"/></>;
    case "glass_bottle": return <><path d="M16 17h48v9l5 12v55q-29 9-58 0V38l5-12z" fill="#deead3"/><path d="M16 20h48M17 34h46M20 88h40"/><path d="M22 43v30" stroke="#fff" strokeWidth="5"/></>;
    case "ice_pack": return <><path d="M11 14h58l-4 82H15z" fill="#dcecf3"/><path d="M17 21h46M17 88h44"/><rect x="21" y="34" width="38" height="36" rx="3" fill="#f7fafb"/><path d="M29 44h22m-22 9h22m-22 9h13" strokeWidth="2"/></>;
    case "vinyl_packaging": return <><path d="M11 15q29 5 58 0l-4 80q-25-5-50 0z" fill="#e2def0"/><path d="M17 22h46M17 87h44M26 37l24 31"/></>;
    case "plastic_container": return <><path d="m6 35 13 55h44l13-55z" fill="#e3e9e4"/><ellipse cx="41" cy="35" rx="35" ry="12" fill="#f8faf7"/><path d="M22 52h37"/></>;
    case "battery": return <><path d="M15 22h23v72H15zM44 40h23v54H44z" fill="#d7dfcd"/><path d="M21 16h11v6H21zM50 34h11v6H50z" fill="#a5b594"/><path d="M21 39h11m-5-5v10M50 54h11"/></>;
    case "electronic": return <><rect x="6" y="16" width="68" height="50" rx="4" fill="#cedddc"/><path d="M13 23h54v34H13z" fill="#eff5f3"/><path d="M34 66v16h15V66M22 84h40M65 80v13h9v-8m-13-9v-8m9 8v-8"/></>;
    case "bulky": return <><path d="M19 10h44v46H19z" fill="#d9c6a6"/><path d="M11 56h59v14H11z" fill="#e7d6b7"/><path d="M17 70v28m47-28v28M28 20v25m25-25v25"/></>;
    case "hazardous": return <><path d="M19 28h43v65H19z" fill="#e5d6c2"/><path d="M24 16h34v12H24zM31 7h26v9H31z" fill="#c0c9c7"/><path d="m40 45 17 28H23z" fill="#f5e1a3"/><path d="M40 54v9m0 5v1"/></>;
    case "metal_can": return <><path d="M14 16q26-9 52 0v73q-26 10-52 0z" fill="#d3e3e8"/><ellipse cx="40" cy="16" rx="26" ry="7" fill="#edf4f4"/><path d="M33 14h14v5H33zM20 79q20 5 40 0" fill="none"/><path d="M24 38h32v21H24z" fill="#9ebfc9" stroke="none"/></>;
    default: return <><path d="M28 6h24v17c0 9 17 13 17 27v43q-29 9-58 0V50c0-14 17-18 17-27z" fill={categoryId === "pump_bottle" ? "#e9eadb" : "#d9eeee"}/><path d="M29 13h22M19 69h42M19 78h42" opacity=".35"/><path d="M28 37q-10 5-10 19" stroke="white" strokeWidth="5"/></>;
  }
}

type DiagramName = "water-pack-empty" | "carton-dry" | "paper-stack" | "pump-detach" | "label-peel" | "part-detach" | "empty" | "rinse" | "flatten" | "unfold" | "sort" | "cap-close" | "inspect" | "hold";
/** Stable extension point for future catalog assets; absent assets fall back to the catalog action and roles. */
export const ACTION_ASSET_MAP: Record<string, DiagramName> = {
  "water-pack-empty": "water-pack-empty", "carton-dry": "carton-dry", "paper-stack": "paper-stack",
  "pump-detach": "pump-detach", "label-peel": "label-peel", "empty-container": "empty", "rinse-container": "rinse", "pet-flatten": "flatten", "paper-unfold": "unfold", "part-to-bin": "sort", "pet-cap-close": "cap-close",
};
export function diagramFor(step: Step): DiagramName {
  const explicit = step.visual.assetId && ACTION_ASSET_MAP[step.visual.assetId];
  if (explicit) return explicit;
  if (step.visual.action === "detach") return step.targetRoles.includes("pump") ? "pump-detach" : step.targetRoles.includes("label") ? "label-peel" : "part-detach";
  if (step.visual.action === "sort" && step.kind === "action" && step.targetRoles.includes("cap")) return "cap-close";
  return step.visual.action;
}
const CAPTIONS: Record<DiagramName, string> = {
  "water-pack-empty": "물 100% 확인한 팩의 물만 비우기", "carton-dry": "헹군 팩 물기 빼고 말리기", "paper-stack": "마른 종이를 펴서 쌓고 묶기",
  "pump-detach": "본체는 잡고 · 펌프를 돌려 위로", "label-peel": "라벨 끝에서 바깥쪽으로", "part-detach": "다른 재질의 부품을 따로", empty: "다 사용한 용기의 안쪽 확인", rinse: "물로 남은 이물질 씻기", flatten: "가능한 만큼만 부피 줄이기", unfold: "접힌 부분 펼치기", sort: "준비한 부품과 배출 장소 짝짓기", "cap-close": "원래 뚜껑을 본체에 닫기", inspect: "표시와 실제 상태 확인", hold: "지금 상태로 두고 확인하기",
};
export function ActionDiagram({ step, categoryId, compact = false }: { step: Step; categoryId?: string | null; compact?: boolean }) {
  const marker = useId().replace(/:/g, ""); const diagram = diagramFor(step);
  const role = step.targetRoles.find(r => r !== "body") ?? "body";
  const arrow = `url(#${marker})`;
  return <figure className={`${styles.diagram} ${compact ? styles.compactDiagram : ""}`} data-testid="action-diagram" data-diagram={diagram}>
    <svg viewBox="0 0 360 154" role="img" aria-label={`예시: ${CAPTIONS[diagram]}`}>
      <defs><marker id={marker} markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="m0 0 6 3.5L0 7z" fill="#21745a" /></marker></defs>
      <g fill="none" stroke="#21745a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {diagram === "pump-detach" ? <>
          <PartShape categoryId="pump_bottle" x={34} y={54} scale={.82} /><PartShape role="pump" x={39} y={5} scale={.7} />
          <path d="M35 38C5 14 70 2 84 24" markerEnd={arrow} /><path d="M61 105h-26m70 0H86" /><path d="M117 78h50" markerEnd={arrow} />
          <PartShape categoryId="pump_bottle" x={191} y={54} scale={.82} /><g className={styles.lift}><PartShape role="pump" x={260} y={5} scale={.75} /></g><path d="M293 81V48" markerEnd={arrow} />
          <text x="66" y="150" textAnchor="middle">잡기</text><text x="245" y="150" textAnchor="middle">돌려 분리</text>
        </> : diagram === "label-peel" ? <>
          <PartShape categoryId={categoryId} x={40} y={28} /><PartShape role="label" x={44} y={37} scale={.9} />
          <path d="M132 78h42" markerEnd={arrow} /><PartShape categoryId={categoryId} x={189} y={28} />
          <g className={styles.peel}><PartShape role="label" x={279} y={35} scale={.8} /></g><path d="M242 70q35-38 55-6" markerEnd={arrow} />
          <text x="80" y="150" textAnchor="middle">붙은 라벨</text><text x="265" y="150" textAnchor="middle">끝을 잡아 떼기</text>
        </> : diagram === "water-pack-empty" ? <>
          <g transform="translate(39 14) rotate(65 40 50)"><PartShape categoryId="ice_pack"/><path d="M57 14h15" stroke="#fff" strokeWidth="8"/></g>
          <path className={styles.water} d="M119 64q28 17 35 47m-30-43q26 20 25 43" stroke="#3284b2"/>
          <ellipse cx="155" cy="120" rx="33" ry="8" fill="#e0e7e9"/><path d="M137 119h36m-29-4v10m10-10v10m10-10v10" stroke="#708993"/>
          <path d="M207 75h26" markerEnd={arrow}/><PartShape categoryId="ice_pack" x={265} y={22} scale={.8}/>
          <text x="118" y="150" textAnchor="middle">물만 비우기</text><text x="300" y="150" textAnchor="middle">빈 비닐</text>
        </> : diagram === "carton-dry" ? <>
          <PartShape categoryId="drink_carton" x={40} y={23}/><path d="M110 64q8 13 0 17-8-4 0-17" fill="#94c5e1" stroke="#3284b2"/>
          <path d="M144 77h35" markerEnd={arrow}/><PartShape categoryId="drink_carton" x={224} y={23}/>
          <path d="M216 130h99M225 12q15-12 27 0m5-5q15-12 27 0m3 6q15-12 27 0" stroke="#88aca0"/>
          <text x="81" y="150" textAnchor="middle">물기 빼기</text><text x="267" y="150" textAnchor="middle">말리기</text>
        </> : diagram === "paper-stack" ? <>
          <PartShape categoryId="paper" x={36} y={23}/><path d="M139 79h35" markerEnd={arrow}/>
          <path d="m216 55 67-16 38 26-66 18zM216 65l39 28 66-17M216 76l39 27 66-15" fill="#f2e7c9"/>
          <path d="m248 48 39 27v26m-53-16 67-18" stroke="#a58652"/><text x="268" y="150" textAnchor="middle">펴서 쌓고 묶기</text>
        </> : diagram === "empty" ? <>
          <PartShape categoryId={categoryId} x={23} y={31} /><path d="M116 79h44" markerEnd={arrow} />
          <PartShape categoryId={categoryId} x={200} y={31} />
          <path d="M239 40 280 42" strokeDasharray="3 4" />
          <circle cx="306" cy="44" r="26" fill="#fff" /><path d="m325 63 15 15" />
          <ellipse cx="306" cy="44" rx="17" ry="10" fill="#edf3ef" stroke="#37584c" /><ellipse cx="306" cy="44" rx="11" ry="6" fill="#fff" stroke="#9aafa0" strokeWidth="1.5" />
          <text x="63" y="150" textAnchor="middle">다 사용한 용기</text><text x="250" y="150" textAnchor="middle">안쪽 직접 확인</text>
        </> : diagram === "rinse" ? <>
          <path d="M205 0h-72v16h14v13h18V14h40z" fill="#d7e2e6" />
          <path className={styles.water} d="M151 30v24m8-24v21m-16-20v20" stroke="#3284b2" markerEnd={arrow} />
          <PartShape role={step.targetRoles.includes("body") ? "body" : role} categoryId={categoryId} x={116} y={43} scale={.85} />
          <path d="M203 78h36" markerEnd={arrow} /><PartShape role={step.targetRoles.includes("body") ? "body" : role} categoryId={categoryId} x={260} y={43} scale={.85} />
          <path d="M258 22v-7m-8 14h-7m12-5-5-5" /><text x="181" y="150" textAnchor="middle">남은 이물질 씻기</text>
        </> : diagram === "flatten" ? <>
          <PartShape categoryId={categoryId} x={29} y={22} /><path d="M129 72h36" markerEnd={arrow} />
          <path d="M255 46h24v15l13 10-9 8 9 8-9 8 9 9-10 8h-33l-10-8 9-9-9-8 9-8-9-8 16-10z" fill="#d9eeee" stroke="#37584c" /><path d="M255 53h24m-31 25h35m-35 17h35" stroke="#a4c8c7" /><path d="M267 9v25" markerEnd={arrow} /><path d="M267 134v-13" markerEnd={arrow} />
          <text x="79" y="150" textAnchor="middle">비운 용기</text><text x="268" y="150" textAnchor="middle">가볍게 누르기</text>
        </> : diagram === "unfold" ? <>
          <PartShape categoryId={categoryId ?? "paper_carton"} x={29} y={21} /><path d="M133 75h35" markerEnd={arrow} />
          {categoryId === "cardboard_box" ? <><path d="M232 52V27h38v25h43v33h-43v27h-38V85h-28V52z" fill="#e1c594"/><path d="M232 52h38v33h-38z" strokeDasharray="4 5"/></> : <><path d="m214 41 27 12 29-12 27 12 26-12v70l-26 12-27-12-29 12-27-12z" fill="#f2e7c9"/><path d="M241 53v70m29-82v70m27-58v70" strokeDasharray="4 5"/></>}
          <text x="265" y="150" textAnchor="middle">접힌 선 따라 펼치기</text>
        </> : diagram === "cap-close" ? <>
          <PartShape categoryId={categoryId} x={71} y={43} scale={.9} /><PartShape role="cap" x={78} y={-13} scale={.7} /><path d="M144 31q22 14 0 28" markerEnd={arrow} />
          <path d="M173 80h38" markerEnd={arrow} /><PartShape categoryId={categoryId} x={246} y={41} scale={.9} /><PartShape role="cap" x={254} y={19} scale={.68} />
          <text x="260" y="150" textAnchor="middle">같이 두기</text>
        </> : diagram === "part-detach" ? <>
          <PartShape categoryId={categoryId} x={39} y={30} /><PartShape role={role} x={40} y={-6} scale={.6} /><path d="M133 78h38" markerEnd={arrow} />
          <PartShape categoryId={categoryId} x={208} y={30} /><PartShape role={role} x={282} y={5} scale={.7} /><path d="M297 76V51" markerEnd={arrow} />
        </> : diagram === "sort" ? <>
          <PartShape role={role} categoryId={categoryId} x={58} y={29} /><path d="M161 80h44" markerEnd={arrow} />
          <path d="m242 46 9 85h60l9-85z" fill="#c8ded0" /><path d="M235 44h90v12h-90z" fill="#90bca5" /><path d="M264 77h35m-35 13h35m-35 13h25" />
        </> : diagram === "hold" ? <>
          <PartShape role={step.targetRoles[0] ?? "body"} categoryId={categoryId} x={139} y={27} /><path d="M75 132h223" stroke="#925323" /><text x="180" y="152" textAnchor="middle">억지로 분리하지 않기</text>
        </> : <>
          <PartShape role={step.targetRoles.length === 1 && role !== "body" ? role : "body"} categoryId={categoryId} x={76} y={29} />
          <path d="M110 75h45l35-36" strokeDasharray="4 5" /><path d="M192 18h122v88H192z" fill="#fff" /><path d="M206 38h49m-49 16h85m-85 17h70m-70 17h36" opacity=".65" />
          <text x="252" y="139" textAnchor="middle">표시·용도 직접 확인</text>
        </>}
      </g>
    </svg>
    <div className={styles.diagramCaption}><span>예시 도해</span><span>{CAPTIONS[diagram]}</span></div>
  </figure>;
}

export function DestinationList({ destinations, categoryId }: { destinations: Destination[]; categoryId?: string | null }) {
  if (!destinations.length) return null;
  return <section aria-label="부품별 모아 둘 곳" className={styles.destinations}>
    {destinations.map(destination => <div key={destination.partRole} className={styles.destination} style={{ "--bin-color": BIN_COLORS[destination.bin] } as CSSProperties}>
      <svg viewBox="0 0 80 110" role="img" aria-label={`${partLabel(destination.partRole)} 예시`}><PartShape role={destination.partRole} categoryId={categoryId} /></svg>
      <div><span className={styles.partName}>{partLabel(destination.partRole)}</span><strong>{destination.label}</strong></div>
    </div>)}
  </section>;
}

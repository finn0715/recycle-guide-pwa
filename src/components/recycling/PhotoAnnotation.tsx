import { useState } from "react";
import type { Box, Observation } from "@/lib/contracts/coach";
import type { GuidePhoto } from "@/lib/client/photos";
import { partLabel } from "./ActionDiagram";
import styles from "./PhotoRecyclingCoach.module.css";

function boxStyle(box: Box) {
  return { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` };
}
export function PhotoAnnotation({ photos, observation, targetRoles }: { photos: GuidePhoto[]; observation: Observation | null; targetRoles: string[] }) {
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const firstView = observation?.views[0]?.photoId;
  const photo = photos.find(p => p.id === selectedPhoto) ?? photos.find(p => p.id === firstView) ?? photos[0];
  if (!photo) return null;
  const index = photos.indexOf(photo);
  const objectBox = observation?.views.find(v => v.photoId === photo.id)?.box;
  const parts = observation?.parts.filter(part => targetRoles.includes(part.role)).flatMap(part => {
    const box = part.views.find(view => view.photoId === photo.id)?.box;
    return box ? [{ ...part, box }] : [];
  }) ?? [];
  const missing = targetRoles.filter(role => !parts.some(part => part.role === role));
  return <section className={styles.photoSection} aria-label="내 사진과 현재 확인할 부분">
    <div className={styles.photoStage}>
      {/* The image keeps its intrinsic ratio. The overlay's containing block is the image itself,
          never the surrounding stage: portrait/landscape letterboxing cannot displace boxes. */}
      <div className={styles.imageBounds}>
        {/* The prepared browser blob needs neither a remote image loader nor another crop. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.url} alt={`내 사진 ${index + 1}`} className={styles.userPhoto} />
        {objectBox && <span className={styles.objectOutline} style={boxStyle(objectBox)} aria-label="물건 전체 위치" data-testid="object-outline" />}
        {parts.map((part, partIndex) => <span className={styles.partOutline} style={boxStyle(part.box)} key={part.partId} data-testid={`part-${part.partId}`} aria-label={`${partIndex + 1}번 ${part.label} 위치`}><b>{partIndex + 1}</b></span>)}
      </div>
    </div>
    <div className={styles.photoCaption}>
      <span>내 사진 {index + 1}{objectBox ? " · 점선은 물건 전체" : ""}</span>
      {parts.length > 0 && <div className={styles.partKey}>{parts.map((part, i) => <span key={part.partId}><b>{i + 1}</b>{part.label}</span>)}</div>}
    </div>
    {photos.length > 1 && <div className={styles.photoTabs} role="group" aria-label="사진 바꾸기">{photos.map((item, i) => <button type="button" key={item.id} aria-label={`사진 ${i + 1} 보기`} aria-pressed={item.id === photo.id} onClick={() => setSelectedPhoto(item.id)}>사진 {i + 1}</button>)}</div>}
    {missing.length > 0 && <p className={styles.locationNote}>이 사진에서 {missing.map(partLabel).join("·")} 위치를 확인하지 못했어요. 아래 예시와 실제 부분을 함께 봐 주세요.</p>}
  </section>;
}

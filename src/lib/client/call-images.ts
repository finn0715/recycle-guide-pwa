import { preparePhoto } from "./photos";

/** Keep each data-channel message below 60 KB, preserving the full image. */
export function captureCallImage(source: CanvasImageSource, width: number, height: number): string | null {
  if (!width || !height) return null;
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 640 / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.7, 0.5, 0.3, 0.15]) {
    const image = canvas.toDataURL("image/jpeg", quality);
    if (image.length < 58_000) return image;
  }
  return null;
}
export async function readCallImage(file: File): Promise<string> {
  const photo = await preparePhoto(file);
  try {
    const image = new Image(); image.src = photo.url; await image.decode();
    const encoded = captureCallImage(image, image.naturalWidth, image.naturalHeight);
    if (!encoded) throw new Error("사진을 보내지 못했어요. 더 가까이 찍은 사진을 골라 주세요.");
    return encoded;
  } finally { URL.revokeObjectURL(photo.url); }
}

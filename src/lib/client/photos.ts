import { LIMITS } from "@/lib/contracts";

export type GuidePhoto = { id: string; file: File; name: string; url: string };

export function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function")
    return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function")
    globalThis.crypto.getRandomValues(bytes);
  else
    for (let index = 0; index < bytes.length; index++)
      bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function preparePhoto(file: File): Promise<GuidePhoto> {
  if (file.size > LIMITS.photoBytes)
    throw new Error(
      "사진 한 장은 5MB 이하여야 해요. 크기를 줄여 다시 선택해 주세요.",
    );
  if (!file.size)
    throw new Error("비어 있는 사진이에요. 다른 사진을 선택해 주세요.");
  if (file.type && !file.type.startsWith("image/"))
    throw new Error("사진 파일을 선택해 주세요. JPG, PNG, WebP를 지원해요.");
  const temporaryUrl = URL.createObjectURL(file);
  try {
    const picture = new Image();
    picture.src = temporaryUrl;
    try {
      await picture.decode();
    } catch {
      throw new Error(
        /heic|heif/i.test(`${file.type} ${file.name}`)
          ? "이 브라우저에서는 HEIC 사진을 열 수 없어요. JPG로 변환하거나 카메라로 다시 촬영해 주세요."
          : "사진을 열 수 없어요. JPG, PNG 또는 WebP 사진을 다시 선택해 주세요.",
      );
    }
    if (!picture.naturalWidth || !picture.naturalHeight)
      throw new Error("사진 크기를 읽을 수 없어요. 다른 사진을 선택해 주세요.");
    let normalized = file;
    const width = picture.naturalWidth;
    const height = picture.naturalHeight;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      width * height > LIMITS.photoPixels
    ) {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, LIMITS.photoMaxEdge / Math.max(width, height));
      canvas.width = Math.max(1, Math.floor(width * scale));
      canvas.height = Math.max(1, Math.floor(height * scale));
      const context = canvas.getContext("2d");
      if (!context)
        throw new Error("사진을 변환할 수 없어요. JPG 사진을 선택해 주세요.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      // Browser image decoding applies the file's EXIF orientation before drawing.
      context.drawImage(picture, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9),
      );
      if (!blob)
        throw new Error("사진을 변환할 수 없어요. JPG 사진을 선택해 주세요.");
      normalized = new File(
        [blob],
        `${file.name.replace(/\.[^.]+$/, "")}.jpg`,
        { type: "image/jpeg" },
      );
    }
    if (normalized.size > LIMITS.photoBytes)
      throw new Error(
        "변환한 사진이 5MB를 넘어요. 사진 크기를 줄여 다시 선택해 주세요.",
      );
    return {
      id: createRequestId(),
      file: normalized,
      name: normalized.name,
      url: URL.createObjectURL(normalized),
    };
  } finally {
    URL.revokeObjectURL(temporaryUrl);
  }
}

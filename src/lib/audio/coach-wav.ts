import { COACH_LIMITS } from "@/lib/contracts/coach";

const invalid = () => new Error("음성을 읽을 수 없어요. 20초 이내로 다시 녹음하거나 글로 질문해 주세요.");
const maxSamples = COACH_LIMITS.audioSampleRate * COACH_LIMITS.audioSeconds;
/** Both boundaries decode RIFF chunks; a filename or MIME is never proof of WAV. */
export function decodeCoachWav(buffer: ArrayBuffer): { samples: Int16Array; sampleRate: number } {
  if (buffer.byteLength < 44 || buffer.byteLength > COACH_LIMITS.audioBytes) throw invalid();
  const view = new DataView(buffer);
  const tag = (at: number) => String.fromCharCode(...new Uint8Array(buffer, at, 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || view.getUint32(4, true) + 8 !== buffer.byteLength) throw invalid();
  let format = false, data: { offset: number; size: number } | undefined;
  for (let offset = 12; offset < buffer.byteLength;) {
    if (offset + 8 > buffer.byteLength) throw invalid();
    const type = tag(offset), size = view.getUint32(offset + 4, true), start = offset + 8, end = start + size;
    if (end > buffer.byteLength || end + (size % 2) > buffer.byteLength) throw invalid();
    if (type === "fmt ") {
      if (format || size < 16 || view.getUint16(start, true) !== 1 || view.getUint16(start + 2, true) !== COACH_LIMITS.audioChannels
        || view.getUint32(start + 4, true) !== COACH_LIMITS.audioSampleRate || view.getUint32(start + 8, true) !== COACH_LIMITS.audioSampleRate * 2
        || view.getUint16(start + 12, true) !== 2 || view.getUint16(start + 14, true) !== COACH_LIMITS.audioBits) throw invalid();
      format = true;
    } else if (type === "data") {
      if (data || size === 0 || size % 2 || size / 2 > maxSamples) throw invalid();
      data = { offset: start, size };
    }
    offset = end + (size % 2);
  }
  if (!format || !data) throw invalid();
  const samples = new Int16Array(data.size / 2);
  let energy = 0;
  for (let i = 0; i < samples.length; i++) { const sample = view.getInt16(data.offset + i * 2, true); samples[i] = sample; energy += sample * sample; }
  if (Math.sqrt(energy / samples.length) < 32) { samples.fill(0); throw new Error("목소리가 들리지 않았어요. 마이크를 가까이하고 다시 녹음해 주세요."); }
  return { samples, sampleRate: COACH_LIMITS.audioSampleRate };
}

export function encodeCoachWav(samples: Int16Array): ArrayBuffer {
  if (!samples.length || samples.length > maxSamples || 44 + samples.byteLength > COACH_LIMITS.audioBytes) throw invalid();
  const buffer = new ArrayBuffer(44 + samples.byteLength), view = new DataView(buffer);
  const tag = (at: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); };
  tag(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); tag(8, "WAVE"); tag(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, COACH_LIMITS.audioChannels, true);
  view.setUint32(24, COACH_LIMITS.audioSampleRate, true); view.setUint32(28, COACH_LIMITS.audioSampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, COACH_LIMITS.audioBits, true); tag(36, "data"); view.setUint32(40, samples.byteLength, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true);
  return buffer;
}

/** Convert actual hardware rate, averaging source intervals when downsampling. */
export function resampleCoachPcm(input: Float32Array, sourceRate: number): Int16Array {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0 || !input.length || input.length > sourceRate * COACH_LIMITS.audioSeconds) throw invalid();
  const ratio = sourceRate / COACH_LIMITS.audioSampleRate;
  const output = new Int16Array(Math.floor(input.length / ratio));
  if (!output.length || output.length > maxSamples) throw invalid();
  for (let i = 0; i < output.length; i++) {
    const start = i * ratio, end = Math.min(input.length, (i + 1) * ratio);
    let sum = 0;
    for (let j = Math.floor(start); j < Math.ceil(end); j++) {
      if (!Number.isFinite(input[j])) throw invalid();
      sum += input[j] * (Math.min(end, j + 1) - Math.max(start, j));
    }
    const value = Math.max(-1, Math.min(1, sum / (end - start)));
    output[i] = Math.round(value * (value < 0 ? 32768 : 32767));
  }
  return output;
}

// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { RecyclingCallApp, CallControls } from "@/components/recycling/RecyclingCallApp";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("offers photo and voice entry and closes a late microphone on pagehide after StrictMode replay", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  let resolve!: (stream: MediaStream) => void;
  const getUserMedia = vi.fn(() => new Promise<MediaStream>(done => { resolve = done; }));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  render(<StrictMode><RecyclingCallApp /></StrictMode>);
  expect(screen.getAllByRole("button")).toHaveLength(3);
  expect(screen.getByRole("button", { name: /말로 물어보기/ })).toBeEnabled();
  expect(screen.getByRole("combobox", { name: "언어 / Language" })).toBeEnabled();
  expect(getUserMedia).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /말로 물어보기/ }));
  expect(screen.getByRole("button", { name: "연결 취소" })).toBeVisible();
  expect(getUserMedia).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("combobox")).toBeDisabled();
  act(() => window.dispatchEvent(new Event("pagehide")));
  const stop = vi.fn(); await act(async () => resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream));
  expect(stop).toHaveBeenCalledOnce();
  expect(screen.getByRole("heading", { name: "이거 어떻게 버리지?" })).toBeVisible();
  expect(screen.getByRole("button", { name: /말로 물어보기/ })).toBeEnabled();
});

function fakeCall() {
  let state: import("@/lib/client/recycling-call").CallState = { status: "idle", activity: "listening", muted: false, camera: "off", photoSending: false, caption: "", heard: "", error: null, mediaError: null, audioBlocked: false };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<typeof state>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const call = { subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); }, getSnapshot: () => state, start: vi.fn(async () => { update({ status: "connecting" }); }), sendPhoto: vi.fn(async () => {}), end: vi.fn(() => update({ status: "ended" })), mute: vi.fn(), toggleCamera: vi.fn(async () => {}), play: vi.fn(async () => {}), dispose: vi.fn() };
  return { call, update };
}
it("sends a selected photo exactly once after connecting, without requiring another send action", () => {
  const { call, update } = fakeCall();
  render(<StrictMode><CallControls call={call} /></StrictMode>);
  const file = new File(["sample"], "sample.jpg", { type: "image/jpeg" });
  fireEvent.change(screen.getByLabelText("분리배출 사진 선택"), { target: { files: [file] } });
  expect(call.start).toHaveBeenCalledOnce();
  expect(call.sendPhoto).not.toHaveBeenCalled();
  act(() => update({ status: "connected" }));
  expect(call.sendPhoto).toHaveBeenCalledExactlyOnceWith(file);
  act(() => update({ activity: "speaking", caption: "시험 안내" }));
  expect(call.sendPhoto).toHaveBeenCalledTimes(1);
  expect(screen.getByText("시험 안내")).toBeVisible();
});
it.each(["cancel", "error"])("discards a pending photo after %s before a later voice session", kind => {
  const { call, update } = fakeCall();
  render(<CallControls call={call} />);
  fireEvent.change(screen.getByLabelText("분리배출 사진 선택"), { target: { files: [new File(["x"], "sample.jpg")] } });
  if (kind === "cancel") fireEvent.click(screen.getByRole("button", { name: "연결 취소" }));
  else act(() => update({ status: "error", error: "마이크 사용을 허용해 주세요." }));
  fireEvent.click(screen.getByRole("button", { name: /말로 물어보기|다시 연결하기/ }));
  act(() => update({ status: "connected" }));
  expect(call.sendPhoto).not.toHaveBeenCalled();
});
it("leaves microphone untouched when the file picker is cancelled", () => {
  const { call } = fakeCall();
  render(<CallControls call={call} />);
  fireEvent.change(screen.getByLabelText("분리배출 사진 선택"), { target: { files: [] } });
  expect(call.start).not.toHaveBeenCalled();
});

it("opens camera capture separately from the photo library without starting a microphone", () => {
  const { call } = fakeCall();
  render(<CallControls call={call} />);
  const camera = screen.getByLabelText("분리배출 사진 촬영");
  const library = screen.getByLabelText("분리배출 사진 선택");
  const cameraClick = vi.spyOn(camera, "click");
  const libraryClick = vi.spyOn(library, "click");
  fireEvent.click(screen.getByRole("button", { name: "사진 찍기" }));
  expect(cameraClick).toHaveBeenCalledOnce();
  expect(camera).toHaveAttribute("capture", "environment");
  expect(library).not.toHaveAttribute("capture");
  fireEvent.click(screen.getByRole("button", { name: "사진 선택" }));
  expect(libraryClick).toHaveBeenCalledOnce();
  expect(call.start).not.toHaveBeenCalled();
});
it("passes a captured photo into the same automatic guidance flow", () => {
  const { call, update } = fakeCall();
  render(<CallControls call={call} />);
  const file = new File(["capture"], "camera.jpg", { type: "image/jpeg" });
  fireEvent.change(screen.getByLabelText("분리배출 사진 촬영"), { target: { files: [file] } });
  expect(call.start).toHaveBeenCalledOnce();
  act(() => update({ status: "connected" }));
  expect(call.sendPhoto).toHaveBeenCalledExactlyOnceWith(file);
});
it("switches the UI to English and translates microphone permission recovery", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const getUserMedia = vi.fn(async () => { throw new DOMException("denied", "NotAllowedError"); });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  render(<RecyclingCallApp />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "en" } });
  expect(screen.getByRole("main")).toHaveAttribute("lang", "en");
  expect(screen.getByRole("button", { name: "Take a photo" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Ask by voice/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Allow microphone access, then try again.");
  expect(screen.getByRole("combobox")).toBeEnabled();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "ko" } });
  expect(screen.getByRole("button", { name: "사진 찍기" })).toBeVisible();
});

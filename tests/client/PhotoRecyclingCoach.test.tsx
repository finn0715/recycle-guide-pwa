// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ActionDiagram } from "@/components/recycling/ActionDiagram";
import { PhotoRecyclingCoach } from "@/components/recycling/PhotoRecyclingCoach";
import { preparationGuides } from "@/data/preparation-guides";
import { COACH_CATALOG } from "@/data/coach-guides";
import { createCoachController, type CoachControllerOptions, type CoachAudioAdapter } from "@/lib/client/coach-controller";
import type { CoachHelpRequest, CoachRecognizeRequest, CoachRecognitionResponse, CoachSpeechRequest } from "@/lib/contracts/coach";

const id = (n: number) => `6ba7b810-9dad-41d1-80b4-${String(n).padStart(12, "0")}`;
const file = new File(["photo"], "pump.jpg", { type: "image/jpeg" });
const wav = () => new Blob([new Uint8Array(64)], { type: "audio/wav" });
function recognition(request: CoachRecognizeRequest): CoachRecognitionResponse {
  const objects = [0, 1].map(n => ({ objectId: id(200 + n), label: `펌프 용기 ${n + 1}`, categoryId: "pump_bottle", recognition: "recognized" as const,
    views: request.photoIds.map(photoId => ({ photoId, box: { x: n ? 0.5 : 0.1, y: 0.1, width: 0.35, height: 0.8 } })),
    parts: [{ partId: `pump-${n}`, role: "pump", label: "펌프", views: [{ photoId: request.photoIds[0], box: { x: 0.2, y: 0.1, width: 0.2, height: 0.15 } }] }],
  }));
  return { requestId: request.requestId, sessionId: request.sessionId, revision: request.revision, catalogVersion: COACH_CATALOG.version, outcome: "identified", objects, routes: objects.map(o => ({ objectId: o.objectId, flowId: "pump-bottle" })) };
}
function answer(request: CoachHelpRequest) {
  const reply = COACH_CATALOG.replies.find(r => r.allowedStepIds.includes(request.context.stepId))!;
  return { context: request.context, transcript: "audio" in request ? "펌프가 어떤 건가요" : null, replyId: reply.id, text: reply.text, choiceIds: reply.choiceIds, sourceIds: reply.sourceIds };
}
const controllers: ReturnType<typeof createCoachController>[] = [];
afterEach(() => { cleanup(); controllers.splice(0).forEach(c => c.dispose()); });
function setup(extra: Partial<CoachControllerOptions> = {}, quick = false) {
  let sequence = 0;
  const audio: CoachAudioAdapter = { startRecording: vi.fn(async () => {}), finishRecording: vi.fn(async () => wav()), cancelRecording: vi.fn(), play: vi.fn(async () => {}), stopPlayback: vi.fn(), dispose: vi.fn() };
  const help = vi.fn(async (request: CoachHelpRequest) => answer(request));
  const speech = vi.fn(async (request: CoachSpeechRequest) => ({ audio: wav(), requestId: request.context.requestId, revision: request.context.revision, contentType: "audio/wav" }));
  const controller = createCoachController({ catalog: COACH_CATALOG, recognize: vi.fn(async r => recognition(r)), prepare: async f => ({ id: id(++sequence + 100), file: f, name: f.name, url: `blob:${f.name}` }), createId: () => id(++sequence), revoke: vi.fn(), audio, assistance: { help, speech }, ...extra });
  controllers.push(controller);
  const gesture = vi.fn();
  render(<PhotoRecyclingCoach controller={controller} catalog={COACH_CATALOG} preparationGuides={quick ? preparationGuides(COACH_CATALOG) : undefined} onAudioGesture={gesture} />);
  return { controller, audio, help, speech, gesture };
}
async function photos(h: ReturnType<typeof setup>) { await act(async () => { await h.controller.selectPhotos([file, new File(["p"], "side.jpg", { type: "image/jpeg" })]); }); }
async function start() { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "이 물건 안내 시작" })); }); }
function choose(name: string) { fireEvent.click(within(screen.getByRole("group", { name: "현재 행동 선택" })).getByRole("button", { name })); }

describe("photo coach user flow with the real controller", () => {
  it("starts with camera and library inputs, hides manual categories, and waits for an explicit audio gesture", async () => {
    const h = setup();
    expect(screen.getByLabelText("찍고 안내받기")).toHaveAttribute("capture", "environment");
    expect(screen.getByLabelText("사진 골라 안내받기")).toHaveAttribute("multiple");
    expect(screen.queryByText("품목을 직접 찾기")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await photos(h); expect(h.speech).not.toHaveBeenCalled(); expect(h.audio.startRecording).not.toHaveBeenCalled();
    expect(screen.getByAltText("내 사진 1")).toBeVisible();
    await start(); expect(h.gesture).toHaveBeenCalledTimes(1); expect(h.speech).toHaveBeenCalledTimes(1);
    expect(h.gesture.mock.invocationCallOrder[0]).toBeLessThan(h.speech.mock.invocationCallOrder[0]);
  });
  it("describes manual recognition accurately and cancels without claiming photo analysis", () => {
    const h = setup({ recognize: () => new Promise(() => {}) });
    act(() => { void h.controller.recognizeText("샴푸통"); });
    expect(screen.getByRole("heading", { name: "물건에 맞는 안내를 찾고 있어요" })).toBeVisible();
    expect(screen.queryByText("사진 속 물건을 찾고 있어요")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "취소하고 처음으로" }));
    expect(h.controller.getSnapshot().progress).toBe("idle");
  });
  it("shows only observed target boxes on the intrinsic image and preserves progress for each physical object", async () => {
    const h = setup(); await photos(h); await start(); choose("플라스틱 세정용기예요");
    const part = screen.getByTestId("part-pump-0"); expect(part).toHaveStyle({ left: "20%", top: "10%", width: "20%", height: "15%" });
    expect(part.parentElement).toContainElement(screen.getByAltText("내 사진 1"));
    expect(screen.getByTestId("object-outline")).toHaveAttribute("aria-label", "물건 전체 위치");
    fireEvent.click(screen.getByRole("button", { name: "사진 2 보기" })); expect(screen.queryByTestId("part-pump-0")).not.toBeInTheDocument();
    expect(screen.getByText(/이 사진에서.*위치를 확인하지 못했어요/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /물건 2.*펌프 용기 2/ }));
    expect(h.controller.getSnapshot().current!.step.id).toBe("pump-material");
    fireEvent.click(screen.getByRole("button", { name: /물건 1.*펌프 용기 1/ }));
    expect(h.controller.getSnapshot().current!.step.id).toBe("pump-type");
    choose("금속 스프링이 있는 복합 펌프예요"); expect(screen.getByTestId("action-diagram")).toHaveAttribute("data-diagram", "pump-detach");
    choose("안돼요"); expect(h.controller.getSnapshot().progress).toBe("needs_help");
    expect(screen.getByRole("heading", { name: "이 물건은 확인이 필요해요" })).toBeVisible();
    expect(screen.queryByText("이 물건 준비 완료")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "이전 선택 바꾸기" })); expect(h.controller.getSnapshot().current!.step.id).toBe("pump-detach");
  });
  it("uses catalog reasons and source scope/check dates without leaving the current photo", async () => {
    const h = setup(); await photos(h); await start();
    fireEvent.click(screen.getByText("왜 이렇게 버리나요?"));
    const panel = screen.getByRole("region", { name: "현재 안내의 근거" });
    expect(panel).toHaveTextContent(COACH_CATALOG.flows.find(f => f.id === "pump-bottle")!.steps[0].reason);
    const source = COACH_CATALOG.sources.find(s => s.id === h.controller.getSnapshot().current!.step.sourceIds[0])!;
    expect(panel).toHaveTextContent(source.publisher); expect(panel).toHaveTextContent(source.section); expect(panel).toHaveTextContent(`내용 확인 ${source.checkedAt}`);
    expect(screen.getByAltText("내 사진 1")).toBeVisible(); expect(within(panel).getAllByRole("link")[0]).toHaveAttribute("target", "_blank");
  });
  it("never sends a cancelled recording, lets the user correct a transcript, and applies suggested choices only on a tap", async () => {
    const h = setup(); await photos(h); await start();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "말로 질문" })); });
    expect(screen.getByText(/녹음 중/)).toBeVisible(); expect(screen.getByText(/20초/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "녹음 취소" })); expect(h.help).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "말로 질문" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "말 마치고 보내기" })); });
    expect(h.help).toHaveBeenCalledTimes(1); expect(h.controller.getSnapshot().objects[0].history).toHaveLength(0);
    const input = screen.getByLabelText("질문 내용"); expect(input).toHaveValue("펌프가 어떤 건가요");
    fireEvent.change(input, { target: { value: "재질 표시를 어디서 찾나요" } }); expect(h.controller.getSnapshot().helpText).toBe("재질 표시를 어디서 찾나요");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "질문 보내기" })); });
    expect(h.help).toHaveBeenLastCalledWith(expect.objectContaining({ text: "재질 표시를 어디서 찾나요" }), expect.any(AbortSignal));
    fireEvent.click(within(screen.getByRole("group", { name: "도움 답의 추천 선택" })).getByRole("button", { name: "플라스틱 세정용기예요" }));
    expect(h.controller.getSnapshot().current!.step.id).toBe("pump-type");
  });
  it("continues visually after audio failure and only retries audio through the replay gesture", async () => {
    const speech = vi.fn(async () => { throw new Error("소리를 준비하지 못했어요."); }); const h = setup({ assistance: { speech } });
    await photos(h); await start(); expect(screen.getByText("소리를 준비하지 못했어요.")).toBeVisible();
    choose("플라스틱 세정용기예요"); expect(speech).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "다시 듣기" })); }); expect(speech).toHaveBeenCalledTimes(2); expect(h.gesture).toHaveBeenCalledTimes(2);
  });
  it("completes one manual object through real choices and keeps example imagery clearly marked", async () => {
    const h = setup(); act(() => { h.controller.pickCategory("metal_can"); });
    expect(screen.getByText("사진 없이 직접 고른 물건" )).toBeVisible(); expect(screen.queryByAltText(/내 사진/)).not.toBeInTheDocument();
    await start(); for (const name of ["알루미늄 음료캔이에요", "없어요", "했어요", "했어요", "준비했어요", "이 물건 안내 마치기"]) choose(name);
    expect(h.controller.getSnapshot().progress).toBe("complete"); expect(screen.getByRole("heading", { name: "이 물건 준비 완료" })).toBeVisible();
    expect(screen.getByRole("region", { name: "부품별 모아 둘 곳" })).toHaveTextContent("금속캔류");
    expect(screen.queryByText(/모든 물건.*완료/)).not.toBeInTheDocument();
  });
});


describe("empty-container illustration", () => {
  it.each(["can-empty", "pump-empty", "pet-empty"])("shows inspection after use for %s", stepId => {
    const flow = COACH_CATALOG.flows.find(item => item.steps.some(step => step.id === stepId))!;
    const step = flow.steps.find(item => item.id === stepId)!;
    render(<ActionDiagram step={step} categoryId={flow.categoryId} />);
    const example = screen.getByRole("img", { name: "예시: 다 사용한 용기의 안쪽 확인" });
    expect(within(example).getByText("다 사용한 용기")).toBeVisible();
    expect(within(example).getByText("안쪽 직접 확인")).toBeVisible();
    expect(screen.getByTestId("action-diagram")).toHaveAttribute("data-diagram", "empty");
  });
});

describe("destination evidence follows the actual path", () => {
  async function completePet() {
    const h = setup(); act(() => { h.controller.pickCategory("clear_pet_bottle"); }); await start();
    for (const name of ["투명 생수·음료용 PET병이에요", "했어요", "했어요", "떼어낼 수 있는 비닐 라벨이에요", "했어요", "했어요", "준비했어요", "뚜껑이 있어요", "했어요", "했어요", "준비했어요", "준비했어요", "이 물건 안내 마치기"]) choose(name);
    fireEvent.click(screen.getByText("왜 이렇게 버리나요?"));
    return h;
  }
  function reason(stepId: string) { return COACH_CATALOG.flows.flatMap(flow => flow.steps).find(step => step.id === stepId)!.reason; }
  function sourceFor(region: HTMLElement, sourceId: string) {
    const source = COACH_CATALOG.sources.find(item => item.id === sourceId)!;
    expect(region).toHaveTextContent(source.section); expect(region).toHaveTextContent(source.publisher); expect(region).toHaveTextContent(`내용 확인 ${source.checkedAt}`);
    expect(within(region).getAllByRole("link").some(link => link.getAttribute("href") === source.url)).toBe(true);
  }
  it("explains the completed PET label, cap and body using the reached actions and each destination source", async () => {
    const h = await completePet(); expect(h.controller.getSnapshot().progress).toBe("complete");
    const label = screen.getByRole("region", { name: "라벨 배출 근거" });
    expect(label).toHaveTextContent("비닐 라벨: 비닐류"); expect(label).toHaveTextContent(reason("pet-label-clean"));
    expect(label).toHaveTextContent("떼어낼 수 있는 비닐 라벨이에요"); sourceFor(label, "songpa-film");
    const cap = screen.getByRole("region", { name: "뚜껑 배출 근거" });
    expect(cap).toHaveTextContent(reason("pet-cap-close")); expect(cap).toHaveTextContent("뚜껑이 있어요"); sourceFor(cap, "songpa-pet");
    sourceFor(screen.getByRole("region", { name: "본체 배출 근거" }), "songpa-pet");
  });
  it("keeps the resolved pump beside unresolved parts and links only visited evidence to each", async () => {
    const h = setup(); act(() => { h.controller.pickCategory("pump_bottle"); }); await start();
    for (const name of ["플라스틱 세정용기예요", "금속 스프링이 있는 복합 펌프예요", "했어요", "준비했어요", "다른 재질이거나 안 떨어져요"]) choose(name);
    expect(h.controller.getSnapshot().current!.held).toBe(true);
    const destinations = screen.getByRole("region", { name: "부품별 모아 둘 곳" });
    expect(destinations).toHaveTextContent("복합 펌프: 일반쓰레기 종량제봉투"); expect(destinations).toHaveTextContent("공식 확인 전 보류");
    fireEvent.click(screen.getByText("왜 이렇게 버리나요?"));
    const pump = screen.getByRole("region", { name: "펌프 배출 근거" });
    expect(pump).toHaveTextContent(reason("pump-detach")); expect(pump).toHaveTextContent("금속 스프링이 있는 복합 펌프예요"); sourceFor(pump, "national-mixed-pump");
    const label = screen.getByRole("region", { name: "라벨 배출 근거" });
    expect(label).toHaveTextContent(reason("pump-hold")); expect(label).toHaveTextContent(reason("pump-label-type"));
    expect(label).toHaveTextContent("다른 재질이거나 안 떨어져요"); expect(label).not.toHaveTextContent(reason("pump-label-clean")); sourceFor(label, "songpa-film");
    const body = screen.getByRole("region", { name: "본체 배출 근거" });
    expect(body).toHaveTextContent("공식 확인 전 보류"); expect(body).not.toHaveTextContent(reason("pump-rinse"));
    expect(body).not.toHaveTextContent(COACH_CATALOG.sources.find(source => source.id === "national-mixed-pump")!.section);
    choose("확인 후 다시 시작할게요");
    expect(h.controller.getSnapshot().current!.ended).toBe(true);
    expect(screen.getByRole("region", { name: "부품별 모아 둘 곳" })).toHaveTextContent("복합 펌프: 일반쓰레기 종량제봉투");
    sourceFor(screen.getByRole("region", { name: "펌프 배출 근거" }), "national-mixed-pump");
    expect(screen.getByRole("region", { name: "라벨 배출 근거" })).toHaveTextContent("공식 확인 전 보류");
  });
  it("removes old label reasons and sources immediately after correcting the earlier choice", async () => {
    const h = await completePet(); fireEvent.click(screen.getByText("지금까지 한 선택 · 수정"));
    const select = screen.getByLabelText("4번째 선택 수정"); fireEvent.change(select, { target: { value: "none" } });
    fireEvent.click(within(select.closest("form")!).getByRole("button", { name: "이 선택으로 고치기" }));
    expect(h.controller.getSnapshot().current!.step.id).toBe("pet-cap");
    const panel = screen.getByRole("region", { name: "현재 안내의 근거" });
    expect(panel).not.toHaveTextContent(reason("pet-label-clean"));
    expect(panel).not.toHaveTextContent(COACH_CATALOG.sources.find(source => source.id === "songpa-film")!.section);
    for (const name of ["뚜껑이 없어요", "했어요", "준비했어요", "이 물건 안내 마치기"]) choose(name);
    expect(h.controller.getSnapshot().progress).toBe("complete");
    expect(screen.queryByRole("region", { name: "라벨 배출 근거" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "뚜껑 배출 근거" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "본체 배출 근거" })).not.toHaveTextContent(COACH_CATALOG.sources.find(source => source.id === "songpa-film")!.section);
  });
});


describe("check-free preparation", () => {
  it("shows photo instructions immediately without claiming completion or starting audio", async () => {
    const h = setup({}, true); await photos(h);
    const summary = screen.getByRole("region", { name: "바로 보는 배출 방법" });
    expect(summary).toHaveTextContent("펌프와 라벨을 떼세요.");
    expect(summary).toHaveTextContent("금속 스프링 펌프");
    expect(screen.queryByRole("group", { name: "현재 행동 선택" })).not.toBeInTheDocument();
    expect(h.controller.getSnapshot().objects[0].history).toEqual([]);
    expect(h.controller.getSnapshot().progress).not.toBe("complete");
    expect(h.speech).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "다른 물건 찍기" }));
    expect(screen.queryByRole("region", { name: "바로 보는 배출 방법" })).not.toBeInTheDocument();
    expect(h.controller.getSnapshot().photos).toEqual([]);
  });
  it("requires only the material choice for ice packs and clears it on item changes", () => {
    const h = setup({}, true);
    act(() => h.controller.pickCategory("ice_pack"));
    expect(screen.queryByText("준비한 뒤 버릴 곳")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "고흡수성수지(SAP) 젤" }));
    expect(screen.getByRole("region", { name: "바로 보는 배출 방법" })).toHaveTextContent("자르거나 내용물을 꺼내지 마세요.");
    expect(h.controller.getSnapshot().objects[0].history).toEqual([]);
    act(() => h.controller.pickCategory("paper"));
    expect(screen.getByRole("region", { name: "바로 보는 배출 방법" })).toHaveTextContent("종이를 반듯하게");
    act(() => h.controller.pickCategory("ice_pack"));
    expect(screen.queryByText("준비한 뒤 버릴 곳")).not.toBeInTheDocument();
  });
  it("keeps food EPS unresolved and shows official handoffs without a start gate", () => {
    const h = setup({}, true);
    act(() => h.controller.pickCategory("foam_box"));
    fireEvent.click(screen.getByRole("button", { name: "식품 배송 상자" }));
    expect(screen.getByRole("region", { name: "바로 보는 배출 방법" })).toHaveTextContent("수거 분류를 하나로 정할 수 없어요");
    expect(screen.queryByText("준비한 뒤 버릴 곳")).not.toBeInTheDocument();
    act(() => h.controller.pickCategory("battery"));
    expect(screen.getByRole("region", { name: "바로 보는 배출 방법" })).toHaveTextContent("동주민센터");
    expect(h.controller.getSnapshot().guidanceStarted).toBe(false);
  });
});

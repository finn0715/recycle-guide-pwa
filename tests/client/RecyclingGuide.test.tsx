// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RecyclingGuide } from "../../src/components/recycling/RecyclingGuide";
import { createGuideController } from "../../src/lib/client/guide-controller";
import type { AnalysisResponse } from "../../src/lib/contracts";

afterEach(cleanup);
const question: AnalysisResponse = {
  requestId: "request",
  status: "needs_info",
  item: { id: "pump_bottle", label: "샴푸·린스 용기" },
  question: {
    text: "내용물이 남아 있나요?",
    choices: ["비웠어요", "남아 있어요", "모르겠어요"],
    allowPhoto: true,
  },
  guidance: null,
  message: "용기 안쪽 상태를 확인해 주세요.",
};
const ready: AnalysisResponse = {
  ...question,
  status: "ready",
  question: null,
  message: "펌프와 몸통을 나눠 주세요.",
  guidance: {
    region: "songpa",
    ruleIds: ["pump"],
    steps: ["내용물을 비우고 헹궈요.", "펌프를 분리해요."],
    parts: [
      {
        name: "몸통",
        disposal: "플라스틱류",
        actions: ["물기를 말려요."],
        sourceIds: ["songpa"],
      },
    ],
    cautions: ["재질 표시를 확인해요."],
    sources: [
      {
        id: "songpa",
        title: "송파구 분리배출 안내",
        url: "https://www.songpa.go.kr/www/contents.do?key=3164",
        checkedAt: "2026-10-01",
      },
    ],
  },
};
function renderGuide(transport = vi.fn().mockResolvedValue(question)) {
  let index = 0;
  const controller = createGuideController({
    transport,
    preparePhoto: async (file) => ({
      id: String(++index),
      file,
      name: file.name,
      url: `blob:photo-${index}`,
    }),
    releasePhoto: vi.fn(),
  });
  render(<RecyclingGuide controller={controller} />);
  const choose = () =>
    fireEvent.change(screen.getByLabelText("새 물건 사진 선택"), {
      target: {
        files: [new File(["image"], "bottle.jpg", { type: "image/jpeg" })],
      },
    });
  return { transport, controller, choose };
}

describe("RecyclingGuide user interaction", () => {
  it("explains external transmission before submission and requires an explicit analysis click", async () => {
    const { transport, choose } = renderGuide();
    expect(
      screen.getByRole("button", { name: "분리배출 방법 확인하기" }),
    ).toBeDisabled();
    expect(screen.getByText("OpenAI로 전송")).toBeVisible();
    choose();
    await screen.findByAltText("선택한 물건 사진 1: bottle.jpg");
    expect(transport).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "분리배출 방법 확인하기" }),
    );
    await screen.findByRole("heading", { name: "내용물이 남아 있나요?" });
    expect(transport).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "비웠어요" }));
    expect(transport).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox")).toHaveValue("비웠어요");
    expect(
      screen.getByRole("button", { name: "답변 보내고 확인하기" }),
    ).toBeEnabled();
  });

  it("renders canonical guidance and sources after a follow-up, then clears all on reset", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(question)
      .mockResolvedValueOnce(ready);
    const { choose } = renderGuide(transport);
    choose();
    await screen.findByAltText("선택한 물건 사진 1: bottle.jpg");
    fireEvent.click(
      screen.getByRole("button", { name: "분리배출 방법 확인하기" }),
    );
    await screen.findByRole("heading", { name: "내용물이 남아 있나요?" });
    fireEvent.click(screen.getByRole("button", { name: "비웠어요" }));
    fireEvent.click(
      screen.getByRole("button", { name: "답변 보내고 확인하기" }),
    );
    await screen.findByRole("heading", { name: "이렇게 버리면 돼요." });
    expect(screen.getByText("내용물을 비우고 헹궈요.")).toBeVisible();
    expect(screen.getByText("플라스틱류")).toBeVisible();
    fireEvent.click(screen.getByText("안내의 근거 확인하기"));
    expect(
      screen.getByRole("link", { name: "송파구 분리배출 안내" }),
    ).toHaveAttribute(
      "href",
      "https://www.songpa.go.kr/www/contents.do?key=3164",
    );
    expect(screen.getByText("확인일 2026-10-01")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다음 물건 확인하기" }));
    expect(screen.getByText("사진 한 장으로 시작해요")).toBeVisible();
    expect(
      screen.queryByText("내용물을 비우고 헹궈요."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("shows a recoverable error while retaining the original photo and explanation", async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new Error("인터넷 연결을 확인해 주세요."));
    const { choose } = renderGuide(transport);
    choose();
    await screen.findByAltText("선택한 물건 사진 1: bottle.jpg");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "펌프가 분리되지 않아요." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "분리배출 방법 확인하기" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "인터넷 연결을 확인해 주세요.",
      ),
    );
    expect(screen.getByRole("textbox")).toHaveValue("펌프가 분리되지 않아요.");
    expect(screen.getByAltText("선택한 물건 사진 1: bottle.jpg")).toBeVisible();
    expect(screen.getByRole("button", { name: "다시 분석하기" })).toBeEnabled();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe("correction and ephemeral page state", () => {
  it("allows correcting a question result and hides all old output before resubmitting", async () => {
    const transport = vi.fn().mockResolvedValueOnce(question).mockResolvedValueOnce(ready);
    const { choose, controller } = renderGuide(transport);
    choose();
    await screen.findByAltText("선택한 물건 사진 1: bottle.jpg");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "예전 설명" } });
    fireEvent.click(screen.getByRole("button", { name: "분리배출 방법 확인하기" }));
    await screen.findByRole("heading", { name: question.question!.text });
    fireEvent.click(screen.getByRole("button", { name: "물건 설명 수정하기" }));
    expect(screen.queryByRole("heading", { name: question.question!.text })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "수정한 설명으로 확인하기" })).toBeDisabled();
    expect(controller.getSnapshot().messages).toEqual([]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "우유팩이에요" } });
    fireEvent.click(screen.getByRole("button", { name: "수정한 설명으로 확인하기" }));
    await screen.findByRole("heading", { name: "이렇게 버리면 돼요." });
    expect(transport.mock.calls[1][0].messages).toEqual([{ role: "user", text: "우유팩이에요" }]);
  });

  it("keeps over-limit input visible and explains the limit without sending it", async () => {
    const { choose, transport } = renderGuide();
    choose();
    await screen.findByAltText("선택한 물건 사진 1: bottle.jpg");
    const text = "가".repeat(1001);
    expect(screen.getByRole("textbox")).not.toHaveAttribute("maxlength");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "분리배출 방법 확인하기" }));
    expect(screen.getByRole("textbox")).toHaveValue(text);
    expect(screen.getByRole("alert")).toHaveTextContent("1,000자");
    expect(transport).not.toHaveBeenCalled();
  });

  it("clears photos and conversation before a page enters the back-forward cache", async () => {
    const { choose, controller } = renderGuide();
    choose();
    await screen.findByAltText("선택한 물건 사진 1: bottle.jpg");
    fireEvent.click(screen.getByRole("button", { name: "분리배출 방법 확인하기" }));
    await screen.findByRole("heading", { name: question.question!.text });
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(controller.getSnapshot()).toMatchObject({ status: "idle", photos: [], messages: [], response: null, text: "" });
    expect(screen.queryByAltText("선택한 물건 사진 1: bottle.jpg")).not.toBeInTheDocument();
  });
});

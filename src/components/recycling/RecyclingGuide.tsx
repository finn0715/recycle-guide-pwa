"use client";

/* eslint-disable @next/next/no-img-element -- Previews are local object URLs and must never reach an image proxy. */

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  ArrowDown,
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  ExternalLink,
  ImagePlus,
  Info,
  Leaf,
  LoaderCircle,
  MapPin,
  Plus,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  X,
} from "lucide-react";
import { ITEMS, LIMITS, type Guidance } from "@/lib/contracts";
import {
  createGuideController,
  type GuideController,
} from "@/lib/client/guide-controller";
import type { AnalyzeTransport } from "@/lib/client/analyze";
import styles from "./RecyclingGuide.module.css";

const OFFICIAL_HELP = "https://www.songpa.go.kr/www/contents.do?key=3164";

function EverydayObjects() {
  return (
    <svg
      className={styles.illustration}
      viewBox="0 0 400 230"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="221" cy="119" r="93" fill="#E3EAC9" />
      <path d="M42 204H360" stroke="#BCC5B4" strokeWidth="1.5" />
      <g transform="rotate(-12 114 150)">
        <path
          d="M71 90L123 83L151 104V194H72V90Z"
          fill="#F2EBDB"
          stroke="#496447"
          strokeWidth="2"
        />
        <path
          d="M71 90L99 110L151 104M99 110V194M123 83V105"
          stroke="#496447"
          strokeWidth="2"
        />
        <path
          d="M82 76L121 70L123 83L71 90L82 76Z"
          fill="#C6D6A9"
          stroke="#496447"
          strokeWidth="2"
        />
        <path
          d="M114 139L126 131L138 139V159L126 167L114 159V139Z"
          fill="#D4DEBD"
        />
        <path
          d="M119 146L126 141L133 146M126 141V157"
          stroke="#496447"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
      <g transform="rotate(7 222 135)">
        <path
          d="M191 70C191 62 200 62 200 52V36H229V52C229 62 238 62 238 70L247 89V187C247 196 240 200 215 200C190 200 183 196 183 187V89L191 70Z"
          fill="#F9FBF4"
          stroke="#3B624C"
          strokeWidth="2"
        />
        <rect x="198" y="27" width="33" height="13" rx="3" fill="#315D45" />
        <path
          d="M184 105H245V162H184V105Z"
          fill="#B9D188"
          stroke="#3B624C"
          strokeWidth="2"
        />
        <path
          d="M205 139C206 125 224 123 228 120C229 133 220 144 210 143M205 150L222 131"
          stroke="#315D45"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M190 178H239M190 186H239" stroke="#BDCDB3" strokeWidth="2" />
      </g>
      <g transform="rotate(-5 300 160)">
        <path
          d="M274 132H326V190C326 198 274 198 274 190V132Z"
          fill="#D2DCBC"
          stroke="#496447"
          strokeWidth="2"
        />
        <ellipse
          cx="300"
          cy="132"
          rx="26"
          ry="7"
          fill="#F7F8F0"
          stroke="#496447"
          strokeWidth="2"
        />
        <ellipse
          cx="300"
          cy="132"
          rx="10"
          ry="2.5"
          stroke="#496447"
          strokeWidth="1.5"
        />
        <path
          d="M286 151V178M293 151V184"
          stroke="#EDF1E1"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
      <path
        d="M322 49V64M315 57H330M60 120V131M55 125H66"
        stroke="#839B60"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M341 98C350 92 358 94 360 96C356 105 346 110 341 98Z"
        fill="#91AA71"
      />
      <path
        d="M339 104L352 98"
        stroke="#496447"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function OfficialHelp() {
  return (
    <a
      className={styles.officialLink}
      href={OFFICIAL_HELP}
      target="_blank"
      rel="noopener noreferrer"
    >
      송파구 공식 안내 확인하기 <ExternalLink size={14} aria-hidden="true" />
    </a>
  );
}
function GuidanceResult({ guidance }: { guidance: Guidance }) {
  return (
    <div className={styles.guidance}>
      <ol className={styles.instructions}>
        {guidance.steps.map((step, index) => (
          <li key={`${index}-${step}`}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <p>{step}</p>
          </li>
        ))}
      </ol>
      {guidance.parts.length > 0 && (
        <section className={styles.parts}>
          <h4>부분별로 이렇게 나눠요</h4>
          {guidance.parts.map((part, index) => (
            <div className={styles.part} key={`${index}-${part.name}`}>
              <div>
                <strong>{part.name}</strong>
                <span>{part.disposal}</span>
              </div>
              <ul>
                {part.actions.map((action, actionIndex) => (
                  <li key={`${actionIndex}-${action}`}>{action}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
      {guidance.cautions.length > 0 && (
        <aside className={styles.cautions}>
          <Info size={17} aria-hidden="true" />
          <div>
            <h4>버리기 전, 이것도 확인해요</h4>
            <ul>
              {guidance.cautions.map((caution, index) => (
                <li key={`${index}-${caution}`}>{caution}</li>
              ))}
            </ul>
          </div>
        </aside>
      )}
      <details className={styles.sources}>
        <summary>
          안내의 근거 확인하기 <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <ul>
          {guidance.sources.map((source) => (
            <li key={source.id}>
              {/^https?:\/\//i.test(source.url) ? (
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.title}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              ) : (
                <span>{source.title}</span>
              )}
              <small>확인일 {source.checkedAt.slice(0, 10)}</small>
            </li>
          ))}
        </ul>
        <p>지역의 배출 방식과 수거 일정은 공식 안내를 함께 확인해 주세요.</p>
        <OfficialHelp />
      </details>
    </div>
  );
}

type Props = { transport?: AnalyzeTransport; controller?: GuideController };
export function RecyclingGuide({
  transport,
  controller: providedController,
}: Props = {}) {
  const [controller] = useState(
    () => providedController ?? createGuideController({ transport }),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [dragging, setDragging] = useState(false);
  const correcting = state.correcting;
  const picker = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const extra = useRef<HTMLInputElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const textId = useId();
  const noteId = useId();
  const busy = state.status === "loading" || state.isPreparing;
  const response = state.response;
  const question = response?.status === "needs_info" ? response.question : null;
  const isReady = response?.status === "ready" && response.guidance;
  const showInput =
    !response || !!question || correcting || state.status === "error";
  const canAdd =
    state.photos.length < LIMITS.photos &&
    (!response || !!question?.allowPhoto);
  const canSubmit =
    state.photos.length > 0 &&
    !busy &&
    (!correcting || !!state.text.trim()) &&
    (!question ||
      !!state.text.trim() ||
      state.photos.length > state.lastSentPhotoCount);

  useEffect(() => {
    const clear = () => controller.reset();
    window.addEventListener("pagehide", clear);
    return () => {
      window.removeEventListener("pagehide", clear);
      controller.dispose();
    };
  }, [controller]);
  useEffect(() => {
    if (
      ["ready", "needs_info", "uncertain", "unsupported"].includes(state.status)
    )
      resultHeading.current?.focus({ preventScroll: true });
  }, [state.status]);

  function choose(
    event: ChangeEvent<HTMLInputElement>,
    mode: "replace" | "append",
  ) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    void controller.selectPhotos(files, mode);
  }
  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (state.isPreparing) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length) {
      void controller.selectPhotos(files, "replace");
    }
  }
  function reset() {
    controller.reset();
  }
  function submit() {
    return controller.submit();
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <a
            href="#"
            className={styles.brand}
            aria-label="RecycleGuide 처음으로"
            onClick={(event) => {
              event.preventDefault();
              reset();
            }}
          >
            <span className={styles.brandMark}>
              <Leaf size={21} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span>
              RecycleGuide
              <span className={styles.brandCaption}>
                생활 속 분리배출 길잡이
              </span>
            </span>
          </a>
          <span className={styles.region}>
            <MapPin size={14} aria-hidden="true" />
            송파구 기준
          </span>
        </header>

        <main>
          <section className={styles.hero} aria-labelledby="page-title">
            <div>
              <p className={styles.eyebrow}>
                <span />작은 확인으로 시작하는 분리배출
              </p>
              <h1 id="page-title">
                버리기 전,
                <br />
                <span>한 번만 확인해요.</span>
              </h1>
              <p className={styles.intro}>
                헷갈리는 분리배출, 사진으로 물어보세요.
                <br />
                물건의 재질부터 분리하는 순서까지 함께 확인해요.
              </p>
            </div>
            <div className={styles.heroArt}>
              <EverydayObjects />
              <span>작은 확인이 만드는, 다음 쓰임</span>
            </div>
          </section>

          <nav className={styles.progress} aria-label="분리배출 안내 순서">
            <span className={!response ? styles.activeStep : ""}>
              <b>
                {state.photos.length > 0 ? (
                  <Check size={13} aria-hidden="true" />
                ) : (
                  "01"
                )}
              </b>
              사진 올리기
            </span>
            <i />
            <span
              className={
                question || state.status === "loading" ? styles.activeStep : ""
              }
            >
              <b>02</b>함께 확인하기
            </span>
            <i />
            <span className={isReady ? styles.activeStep : ""}>
              <b>03</b>분리배출하기
            </span>
          </nav>

          <div className={styles.workspace}>
            <section className={styles.photoCard} aria-labelledby="photo-title">
              <div className={styles.cardTitle}>
                <h2 id="photo-title">어떤 물건을 버리나요?</h2>
                <span>{state.photos.length} / 3장</span>
              </div>
              <p className={styles.cardSubtitle}>
                한 번에 한 가지 물건을, 잘 보이게 찍어 주세요.
              </p>
              <input
                className={styles.hiddenInput}
                ref={camera}
                type="file"
                accept="image/*"
                capture="environment"
                aria-label="카메라로 새 물건 촬영"
                onChange={(event) => choose(event, "replace")}
              />
              <input
                className={styles.hiddenInput}
                ref={picker}
                type="file"
                accept="image/*"
                multiple
                aria-label="새 물건 사진 선택"
                onChange={(event) => choose(event, "replace")}
              />
              <input
                className={styles.hiddenInput}
                ref={extra}
                type="file"
                accept="image/*"
                multiple
                aria-label="같은 물건 사진 추가"
                onChange={(event) => choose(event, "append")}
              />
              <div
                className={`${styles.dropzone} ${dragging ? styles.dragging : ""} ${state.photos.length ? styles.hasPhotos : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={drop}
              >
                {state.isPreparing ? (
                  <div className={styles.preparing} role="status">
                    <LoaderCircle
                      className={styles.spin}
                      size={28}
                      aria-hidden="true"
                    />
                    <strong>사진을 준비하고 있어요</strong>
                    <span>선택한 사진의 형식을 확인하고 있어요.</span>
                  </div>
                ) : state.photos.length === 0 ? (
                  <div className={styles.emptyPhoto}>
                    <span className={styles.scanIcon}>
                      <ScanLine
                        size={38}
                        strokeWidth={1.3}
                        aria-hidden="true"
                      />
                      <span className={styles.miniLeaf}>
                        <Leaf size={17} aria-hidden="true" />
                      </span>
                    </span>
                    <strong>사진 한 장으로 시작해요</strong>
                    <p>물건 전체와 재질 표시가 보이면 더 좋아요.</p>
                    <button
                      className={styles.cameraButton}
                      type="button"
                      onClick={() => camera.current?.click()}
                    >
                      <Camera size={18} aria-hidden="true" />
                      사진 촬영하기
                    </button>
                    <button
                      className={styles.pickerButton}
                      type="button"
                      onClick={() => picker.current?.click()}
                    >
                      <ImagePlus size={17} aria-hidden="true" />
                      사진 선택하기
                      <ArrowRight size={15} aria-hidden="true" />
                    </button>
                    <span className={styles.dropHint}>
                      또는 사진을 이곳에 끌어 놓으세요
                    </span>
                  </div>
                ) : (
                  <div className={styles.photoGrid}>
                    {state.photos.map((photo, index) => (
                      <figure className={styles.photo} key={photo.id}>
                        <img
                          src={photo.url}
                          alt={`선택한 물건 사진 ${index + 1}: ${photo.name}`}
                        />
                        <figcaption>
                          {index === 0 ? "대표 사진" : `추가 사진 ${index}`}
                        </figcaption>
                        <button
                          type="button"
                          aria-label={`사진 ${index + 1} 삭제`}
                          disabled={busy}
                          onClick={() => controller.removePhoto(photo.id)}
                        >
                          <X size={16} aria-hidden="true" />
                        </button>
                      </figure>
                    ))}
                    {canAdd && (
                      <button
                        className={styles.addPhoto}
                        type="button"
                        disabled={busy}
                        onClick={() => extra.current?.click()}
                      >
                        <Plus size={22} aria-hidden="true" />
                        <span>
                          같은 물건
                          <br />
                          사진 추가
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className={styles.photoMeta}>
                <span>사진 1~3장 · 장당 최대 5MB</span>
                <span>JPG · PNG · WebP</span>
              </div>
              {state.photos.length > 0 && (
                <div className={styles.photoTools}>
                  <button
                    type="button"
                    disabled={state.isPreparing}
                    onClick={() => picker.current?.click()}
                  >
                    <ImagePlus size={15} aria-hidden="true" />
                    다른 물건 사진
                  </button>
                  <button type="button" onClick={reset}>
                    <RotateCcw size={14} aria-hidden="true" />
                    처음부터
                  </button>
                </div>
              )}
              <div className={styles.photoTip}>
                <Info size={16} aria-hidden="true" />
                <p>
                  펌프, 뚜껑, 라벨처럼 분리되는 부분도 함께 보여 주세요.{" "}
                  <br />
                  사진 속 개인정보는 가리거나 잘라 주세요.
                </p>
              </div>
            </section>

            <section
              className={`${styles.answerCard} ${isReady ? styles.readyCard : ""}`}
              aria-labelledby="answer-title"
              aria-busy={busy}
            >
              {state.status === "loading" ? (
                <div className={styles.loading} role="status">
                  <span className={styles.loadingIcon}>
                    <ScanLine size={33} strokeWidth={1.5} aria-hidden="true" />
                    <LoaderCircle
                      className={styles.spin}
                      size={17}
                      aria-hidden="true"
                    />
                  </span>
                  <p className={styles.eyebrow}>물건을 자세히 확인하고 있어요</p>
                  <h2 id="answer-title">물건을 살펴보고 있어요.</h2>
                  <p>
                    재질과 상태를 확인하고
                    <br />
                    송파구 배출 기준과 연결하고 있어요.
                  </p>
                  <span>사진에 보이지 않는 부분은 다시 여쭤볼게요.</span>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={reset}
                  >
                    분석 취소하고 처음으로
                  </button>
                </div>
              ) : (
                <>
                  <div className={styles.resultTop}>
                    <span className={styles.sectionLabel}>
                      {question
                        ? "한 가지만 더 확인할게요"
                        : isReady
                          ? "분리배출 안내"
                          : response
                            ? "확인이 필요해요"
                            : "사진 속 물건, 차근차근"}
                    </span>
                    {response?.item && (
                      <span className={styles.itemChip}>
                        {response.item.label}
                      </span>
                    )}
                  </div>
                  <h2
                    id="answer-title"
                    ref={resultHeading}
                    tabIndex={-1}
                    className={styles.answerHeading}
                  >
                    {question ? (
                      question.text
                    ) : isReady ? (
                      "이렇게 버리면 돼요."
                    ) : response?.status === "unsupported" ? (
                      "아직 안내하기 어려운 물건이에요."
                    ) : response?.status === "uncertain" ? (
                      "확실하지 않아 한 번 더 확인해요."
                    ) : (
                      <>
                        나누는 방법을 알면,
                        <br />
                        버리기가 쉬워져요.
                      </>
                    )}
                  </h2>
                  {!response && (
                    <p className={styles.answerIntro}>
                      사진을 올리면 필요한 정보를 확인하고,
                      <br />이 물건에 맞는 배출 방법을 알려드릴게요.
                    </p>
                  )}
                  {response?.message && (
                    <p className={styles.responseMessage}>{response.message}</p>
                  )}
                  {question && (
                    <div
                      className={styles.choices}
                      role="group"
                      aria-label="질문 답변 선택"
                    >
                      {question.choices.map((choice, index) => (
                        <button
                          type="button"
                          key={`${index}-${choice}`}
                          aria-pressed={state.text === choice}
                          onClick={() => controller.setText(choice)}
                        >
                          {state.text === choice && (
                            <Check size={14} aria-hidden="true" />
                          )}
                          {choice}
                        </button>
                      ))}
                    </div>
                  )}
                  {isReady && response?.guidance && (
                    <GuidanceResult guidance={response.guidance} />
                  )}
                  {response &&
                    (response.status === "uncertain" ||
                      response.status === "unsupported") && (
                      <div className={styles.needHelp}>
                        <Info size={19} aria-hidden="true" />
                        <p>
                          불확실한 정보로 배출 방법을 정하지 않아요.
                          <br />
                          송파구 공식 안내에서 확인해 주세요.
                        </p>
                        <OfficialHelp />
                      </div>
                    )}
                  {response &&
                    !correcting &&
                    state.status !== "error" && (
                      <div className={styles.correction}>
                        <span>다른 물건으로 인식했나요?</span>
                        <button
                          type="button"
                          onClick={() => controller.beginCorrection()}
                        >
                          물건 설명 수정하기{" "}
                          <ArrowRight size={14} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  {showInput && (
                    <form
                      className={styles.form}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                      }}
                    >
                      <div className={styles.inputHeading}>
                        <label htmlFor={textId}>
                          {question
                            ? "답변을 알려 주세요"
                            : correcting
                              ? "어떤 물건인지 알려 주세요"
                              : "사진에 설명을 더해 주세요"}
                        </label>
                        <span>
                          {question || correcting ? "직접 입력 가능" : "선택"}
                        </span>
                      </div>
                      <textarea
                        id={textId}
                        value={state.text}
                        disabled={busy}
                        onChange={(event) =>
                          controller.setText(event.target.value)
                        }
                        placeholder={
                          question
                            ? "선택지에 없거나 더 알려줄 내용이 있나요?"
                            : correcting
                              ? "예: 샴푸가 아니라 주방 세제 용기예요."
                              : "예: 펌프가 달린 샴푸 통이고, 내용물은 비웠어요."
                        }
                        aria-describedby={`${textId}-hint ${textId}-count`}
                      />
                      <div className={styles.textMeta}>
                        <span id={`${textId}-hint`}>
                          {question?.allowPhoto
                            ? "사진 영역에서 같은 물건 사진도 추가할 수 있어요."
                            : question
                              ? "모르겠다면 ‘모르겠어요’라고 답해도 괜찮아요."
                              : "재질 표시나 오염 상태를 알려주면 도움이 돼요."}
                        </span>
                        <span id={`${textId}-count`}>
                          {state.text.length.toLocaleString()} / 1,000
                        </span>
                      </div>
                      <p className={styles.privacyNotice} id={noteId}>
                        <ShieldCheck size={16} aria-hidden="true" />
                        <span>
                          아래 버튼을 누르면 사진과 설명이{" "}
                          <strong>OpenAI로 전송</strong>돼요. 이 서비스는 사진과
                          대화를 저장하지 않아요. 외부 서비스의 데이터 처리 정책은 별도로 적용돼요.
                        </span>
                      </p>
                      <button
                        className={styles.analyzeButton}
                        type="submit"
                        disabled={!canSubmit}
                        aria-describedby={noteId}
                      >
                        {state.status === "error"
                          ? "다시 분석하기"
                          : question
                            ? "답변 보내고 확인하기"
                            : correcting
                              ? "수정한 설명으로 확인하기"
                              : "분리배출 방법 확인하기"}
                        <ArrowRight size={18} aria-hidden="true" />
                      </button>
                      {!state.photos.length && (
                        <p className={styles.startHint}>
                          사진을 먼저 올려 주세요
                          <ArrowDown size={12} aria-hidden="true" />
                        </p>
                      )}
                    </form>
                  )}
                  {state.error && (
                    <div className={styles.error} role="alert">
                      <Info size={18} aria-hidden="true" />
                      <p>{state.error}</p>
                    </div>
                  )}
                  {response && !showInput && (
                    <button
                      type="button"
                      className={styles.nextItem}
                      onClick={reset}
                    >
                      <Plus size={16} aria-hidden="true" />
                      다음 물건 확인하기
                    </button>
                  )}
                </>
              )}
            </section>
          </div>

          <details className={styles.supported}>
            <summary>
              <span>
                <span className={styles.supportedDot} />
                어떤 물건을 확인할 수 있나요?<small>일상 속 10가지</small>
              </span>
              <ChevronDown size={18} aria-hidden="true" />
            </summary>
            <div className={styles.supportedBody}>
              <p>
                현재는 송파구의 아래 생활용품을 안내해요. 종류가 같아도 재질이나
                내용물에 따라 배출 방법이 달라질 수 있어요.
              </p>
              <ul>
                {Object.entries(ITEMS).map(([id, name], index) => (
                  <li key={id}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          </details>
          <div className={styles.serviceNotes}>
            <span>
              <ShieldCheck size={15} aria-hidden="true" />
              로그인 없이, 저장 없이
            </span>
            <span>
              <ScanLine size={15} aria-hidden="true" />
              사진으로 보고, 질문으로 확인
            </span>
            <span>
              <MapPin size={15} aria-hidden="true" />
              지역 기준에 맞는 안내
            </span>
          </div>
        </main>
        <footer className={styles.footer}>
          <span>잘 나누는 오늘, 다시 쓰이는 내일.</span>
          <span>
            RecycleGuide <i /> WAICY 2026
          </span>
        </footer>
      </div>
    </div>
  );
}
export default RecyclingGuide;

# RecycleGuide

현재 이 체크아웃은 Sites PWA 배포 소스다. 먼저 `docs/sites-pwa.md`를 읽는다. 배포는 `sites/main.tsx`의 React 화면과 `sites/worker.ts`·`sites/call-api.ts`의 Workers API를 사용한다. Next 경로는 로컬 호환용으로 보존한다. 키는 Sites secret에만 등록하며 배포 빌드에 넣지 않는다.

새 세션은 `docs/tracking/handoff.md`에서 사용자 의도·유효한 검증·미커밋 변경·다음 작업을 먼저 확인한다.

WAICY 시연과 소규모 가정용 시험을 위한 한국어·영어 분리배출 안내 웹앱이다.
Next.js 앱 하나에서 통화처럼 말로 질문하고 답을 듣는다. 기본 진입은 RecyclingCallApp이며 통화 중 카메라 공유·사진 전송을 선택할 수 있다. 이전 PhotoRecyclingCoach와 API는 별도 기존 소비자다. 송파구 일상 안내 13범주와 공식 수거·문의 4범주를 제공하며 현장 정확도·환경 효과·실물 휴대폰 음성은 아직 검증하지 않았다.

## 프로젝트 구조

```text
./
├── AGENTS.md                         ← 프로젝트 진입과 핵심 경계
├── CLAUDE.md                         ← 동일한 프로젝트 진입 규칙
├── docs/
│   ├── architecture.md               ← 구성과 요청의 전체 흐름
│   ├── business-rules.md             ← 사실 확인·조건·배출 판단
│   ├── security.md                   ← 키·사진·대화와 접근 범위
│   ├── standards.md                  ← 변경·검증·기록 보존 규칙
│   ├── engineering-notes.md           ← 재현된 함정과 대응
│   ├── operations.md                 ← 설치·실행·로컬 기기 연결
│   ├── contracts.md                  ← 분석 요청과 응답 계약
│   ├── verification.md               ← 실제 실행 기록과 미실시 항목
│   ├── qa/
│   │   ├── visual-coach-evidence.json ← 사진·단계·음성·HTTPS의 확인과 한계
│   │   ├── api-evidence-summary.json  ← 2026-10-01 상세 API 연결 이력
│   │   ├── completion-evidence.json  ← 초기 구현 검사·실행·화면 관측
│   │   └── ux-evidence.json          ← 2026-10-01 빠른 안내 검사 이력
│   └── tracking/
│       ├── handoff.md                ← 새 세션 인수인계
│       ├── status.md                 ← 구현·검증 상태와 이후 범위
│       ├── findings.md               ← 근거 충돌·외부 검증 한계
│       └── decisions/
│           ├── index.md              ← 주요 결정 목록
│           ├── 0001-recognition-and-rules.md ← 인식과 배출 판단의 분리 이유
│           ├── 0002-songpa-household-scope.md ← 송파구 가정용 범위의 이유
│           ├── 0003-web-photo-input.md       ← 웹과 파일 입력을 선택한 이유
│           ├── 0004-preparation-first.md     ← 이전 빠른 안내 방식의 결정 이력
│           ├── 0005-photo-step-voice.md      ← 이전 단계별 소비자 결정
│           └── 0006-conversation-first.md    ← 현재 통화형 기본 흐름
├── scripts/
│   └── AGENTS.md                     ← 비공개 인증서와 로컬 HTTPS 실행
└── src/
    ├── app/
    │   └── AGENTS.md                 ← 페이지와 HTTP 진입 경계
    ├── components/recycling/
    │   └── AGENTS.md                 ← 입력·질문·안내 화면
    ├── data/
    │   └── AGENTS.md                 ← 사실 사전과 검수 기준
    └── lib/
        ├── audio/
        │   └── AGENTS.md             ← 브라우저·서버 공통 WAV 경계
        ├── client/
        │   └── AGENTS.md             ← 사진·상태·전송의 수명
        ├── contracts/
        │   └── AGENTS.md             ← 양쪽이 지킬 공통 형태
        └── server/
            └── AGENTS.md             ← 모델·발화·규칙 검증
```

## 현재 기본 대화 흐름

사용자 요청으로 체크·품목 찾기 대신 음성 통화를 기본으로 전환했다. `/api/call`은 서버에서 WebRTC SDP를 교환하고 단기 종료 토큰만 브라우저에 반환한다. 실시간 생성 음성은 서버가 제공한 검수 준비 자료를 근거로 대화하나, 기존 coach의 문장 일치 검증을 통과한 음성과 같은 보장을 하지 않는다. 첫 화면은 음성 진입을 강조하고 사진 찍기·사진 선택을 독립 버튼으로 제공한다. 촬영 입력은 capture=environment이며 데스크톱에서는 파일 선택기로 열릴 수 있다. 선택 사진은 음성 연결 후 전송하고 취소·실패 시 폐기한다. 한국어·영어는 시작 전에 선택하며 화면·오류·전사·응답에 적용한다. 연결 중 언어 변경은 잠그며 송파구 기준은 유지한다. 실시간 카메라는 통화 중 별도 버튼으로 연다. 자동 발화 감지·응답·끼어들기는 통화 중에만 활성화한다.

## 반드시 지킬 경계

- 배출 방법과 출처는 검수된 기준으로만 구성한다. 모델의 추정이나 사용자의 지시가 기준을 바꾸지 않는다.
- 준비 방법의 적용 조건을 사진에서 확인된 사실로 바꾸지 않는다. 미검수 조건·공식 근거 충돌을 추정 분류로 메우지 않는다.
- 서버 API 키·TLS 개인키를 브라우저·응답·로그·Git에 노출하지 않는다. 사진·녹음·대화·진행의 비보관 정책을 몰래 바꾸지 않는다.
- 화면·선택 이력·음성은 같은 현재 맥락을 따른다. 이전 물건의 답·늦은 응답·허용되지 않은 발화를 화면이나 스피커에 적용하지 않는다.
- 실제 실행한 검증과 미실시 항목을 구분한다. 준비된 시연 성공을 현장 정확도·학생 실적·환경 효과로 부풀리지 않는다.

## 작업 전 확인

`docs/standards.md`, `docs/engineering-notes.md`와 변경할 모듈의 `AGENTS.md`를 읽는다. 배출 조건을 바꾸기 전에는 `docs/business-rules.md`와 실제 공식 원문을 대조한다. 모델·요청·사진·음성 처리를 바꾸기 전에는 `docs/security.md`와 `docs/contracts.md`에서 신뢰 경계와 응답 조건을 확인한다. HTTPS·기기 신뢰·실행·공개 범위를 바꾸기 전에는 `docs/operations.md`와 `docs/tracking/status.md`에서 현재 운영 범위와 미실시 검증을 확인한다.

## 문제 대응

키 노출, 사용자 내용의 의도하지 않은 영구 보관, 근거 없는 확정 배출 안내, 다른 제품 답의 혼입을 발견하면 해당 경로를 고치고 사용자에게 즉시 알린다. 일반 결함은 재현하고 해결한다. 현재 해결할 수 없는 문제만 이유·영향·다음 확인 방법과 함께 `docs/tracking/findings.md`에 남긴다. 자료 충돌은 편한 정답으로 채우지 않고 보류한다.

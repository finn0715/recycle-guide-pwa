# 사진·질문·음성 인터페이스

**Sites PWA 현재 운영:** 설치·배포 소스, 접근 범위, Workers 통화 종료 계약과 검증은 [Sites PWA](sites-pwa.md)를 우선 따른다. 아래 Next 로컬 서버 기록과 구분한다.

현재 기본 화면은 아래 `POST /api/call` 및 `DELETE /api/call`을 사용한다. 그 외 본문의 카탈로그·multipart·WAV·단계 이력 설명은 보존한 기존 API 계약이다. 기본 통화에는 GuideCatalog 페이지 전달이나 WAV 응답을 적용하지 않는다.

로컬 웹앱과 같은 출처에서 요청한다. 사용자 로그인·인증 헤더·서버 세션 이력 조회는 없다. ID는 요청 상관관계와 진행 구분용이며 사용자 인증 수단이 아니다. 서버가 초기 페이지에 제공하는 검증된 `GuideCatalog`의 버전·흐름·단계·선택·답 ID를 사용한다. 카탈로그 조회용 별도 HTTP 경로는 없다.

성공·실패 응답 모두 `Cache-Control: no-store`다. 성공은 음성 경로만 `audio/wav`, 나머지는 JSON이다. 실패는 모든 경로가 말미의 공통 JSON 오류 형식을 사용한다. 일반 문자열을 HTML로 렌더링하지 않는다. 알 수 없는 필드·중복 단일 필드·잘못된 ID·참조·선택 경로를 허용하지 않는다. FormData의 Content-Type 경계값은 브라우저가 작성한다.

## 공통 한도와 사진 좌표

| 항목 | 현재 한도 |
|---|---|
| 사진 | 1~3장, 장당 5MiB, JPEG·PNG·WebP의 실제 단일 이미지, 장당 2,400만 화소 |
| 인식 multipart 전체 | 경계값 포함 16MiB |
| 인식 결과 | 실물 최대 12개, 물건당 부품 최대 16개 |
| 설명·글 질문·전사 | 최대 1,000자 |
| 선택 이력 | 최대 64개 |
| 음성 입력·출력 | WAV의 단일 채널 24kHz·16bit PCM, 20초 이하, 1MiB 이하 |
| 도움 multipart 전체 | 1MiB + 64KiB |
| 음성 JSON 요청 | 64KiB |
| 처리 시간 | 요청당 45초 |
| 동시 요청 | 동일 서버 프로세스의 coach 3경로와 기존 analyze/identify를 합쳐 2건 |

서버는 사진을 실제 해독하며 오디오도 RIFF/WAVE 헤더·데이터 길이·샘플 형식·무음을 검사한다. 잘못된 WAV·무음은 `INVALID_REQUEST`, 파일·본문·글 길이 초과는 `PAYLOAD_TOO_LARGE`다. 사진 개수·선택 이력처럼 구조 한도를 어긴 경우는 `INVALID_REQUEST`다. 한도를 맞추려고 입력을 조용히 잘라 성공시키지 않는다. 모델 결과가 객체 수·참조·좌표 제한을 어기면 `INVALID_MODEL_RESPONSE`다.

사진 좌표는 EXIF 방향을 바로잡고 전체 비율을 유지한 사진의 0~1 정규화 값이다. `box={x,y,width,height}`에서 모든 수는 유한하며 폭·높이는 양수, 오른쪽·아래 끝은 1 이하다. `box:null`은 위치 미확인이다. 화면은 실제 이미지가 표시된 영역에 맞춰 좌표를 변환한다.

## POST /api/coach/recognize

모든 단일 필드는 정확히 한 번 보내며 아래의 `text`도 생략하지 않는다.

| multipart 필드 | 형식 |
|---|---|
| `requestId`, `sessionId` | UUID 문자열. 매 요청에는 새 requestId 사용 |
| `revision` | 0 이상 안전한 정수의 10진 문자열 |
| `region` | `songpa` |
| `mode` | `photo` 또는 `manual` |
| `photoIds` | 중복 없는 UUID 배열의 JSON 문자열 |
| `photos` | photo 모드에서만 1~3개 File. photoIds와 개수·순서 일치 |
| `text` | 최대 1,000자. photo 모드에서는 빈 문자열 가능; manual은 공백 아닌 설명 필수 |

manual 모드는 `photoIds="[]"`, photos 필드 없음으로 보낸다. 사진에서 인식한 것처럼 표시하지 않는다. 새 사진·정정 인식은 새 요청이며 이전 관찰·진행을 자동 이전하지 않는다.

```ts
type View = { photoId: string; box: { x: number; y: number; width: number; height: number } | null };
type Observation = {
  objectId: string; label: string; categoryId: string | null;
  recognition: "recognized" | "ambiguous" | "out_of_scope";
  views: View[];
  parts: { partId: string; label: string; role: string; views: View[] }[];
};
type Recognition = {
  requestId: string; sessionId: string; revision: number; catalogVersion: string;
  outcome: "identified" | "needs_input";
  objects: Observation[];
  routes: { objectId: string | null; flowId: string }[];
};
```

HTTP 200에서 `identified`는 recognized 관찰이 하나 이상 있다는 뜻이다. recognized는 현재 카탈로그의 categoryId를 가지며 나머지는 해당 범주 또는 null이다. 이 응답의 objectId와 partId는 서버가 부여한다. 같은 범주의 서로 다른 실물을 같은 objectId로 합치지 않는다. photo 관찰에는 현재 사진의 view가 하나 이상 필요하고, 부품 view는 부모 물건의 사진만 참조한다. view의 photoId는 한 관찰 안에서 중복되지 않으며 manual의 모든 views는 빈 배열이다. label은 1~2,000자의 일반 텍스트다.

각 물건은 정확히 하나의 route를 갖는다. recognized는 해당 범주 흐름, ambiguous/out_of_scope는 확인·공식 문의 흐름이다. objects가 비면 routes는 `{objectId:null,flowId}` 하나로 복구 흐름을 가리킨다. 인식 결과에는 배출 지시·규칙·출처 URL·완료 사실이 들어오지 않는다.

소비자는 requestId·sessionId·revision·catalogVersion과 현재 사진 참조를 검사한다. 다른 세션이나 이전 요청이면 버린다. 오류는 공통 표를 따르며 입력을 유지해 수동 재시도한다.

## 카탈로그와 진행 맥락

카탈로그 버전의 현재 값은 `songpa-coach-2026-10-08-v3`다. 버전을 고정 추정하지 말고 현재 페이지 자료를 사용한다. 카탈로그는 `{version,categories,flows,rules,sources,replies}`이며 아래 구조를 갖는다.

- 범주: `{id,label,description,roles}`. 일상 안내 범주는 `metal_can`, `metal_scrap`, `pump_bottle`, `clear_pet_bottle`, `plastic_container`, `glass_bottle`, `paper`, `cardboard_box`, `drink_carton`, `vinyl_packaging`, `foam_box`, `toothbrush`, `ice_pack`이다. 공식 경로 안내 범주는 `battery`, `electronic`, `bulky`, `hazardous`다.
- 흐름: `{id,categoryId,startStepId,facts,steps}`. facts는 허용값 집합과 `user_only | visible` 확인 경계다. 복구 흐름의 categoryId만 null일 수 있다.
- 단계: `{id,kind,text,speechText,visual,targetRoles,choices,ruleIds,sourceIds,reason,replyIds,destinations}`. kind는 `confirm | question | action | destination | handoff | complete`, visual은 `{action,assetId}`이며 action은 `inspect | detach | rinse | empty | unfold | flatten | sort | hold`다. assetId는 검수 자산 ID 또는 null이다.
- 선택: `{id,label,nextStepId,factPatch}`. 선택 ID는 단계 안에서 고유하며 nextStepId는 같은 흐름의 다음 단계다. complete/handoff의 종료 선택만 null이다. factPatch는 흐름에 허용된 키·값만 갖는다.
- 목적지: `{partRole,bin,label,ruleIds,sourceIds}`. bin은 `metal | plastic | clear_pet | glass | paper | carton | vinyl | foam | general | special_collection | hold`다. 이전에 준비한 부품과 현재 보류 부품은 각각 유지한다.
- 답: `{id,allowedStepIds,text,speechText,choiceIds,ruleIds,sourceIds}`. 규칙은 `{id,region,reviewStatus,conditions,sourceIds}`이며 활성 자료는 songpa·reviewed다.
- 출처: `{id,title,publisher,url,section,scope,checkedAt,publishedAt,updatedAt}`. scope는 `songpa | national`, URL은 검수한 http(s) 원문, 날짜는 `YYYY-MM-DD`다. 미확인 발행·수정일은 null이며 확인일과 혼동하지 않는다.

흐름·단계·규칙·출처·답 등의 카탈로그 ID는 1~100자, 영문/숫자로 시작해 영문·숫자·`_`·`-`만 쓴다. 다음 요청들은 다음 맥락과 선택 이력을 전달한다.

```ts
type Context = {
  requestId: string; sessionId: string; objectId: string | null;
  revision: number; catalogVersion: string; flowId: string; stepId: string;
};
type History = { stepId: string; choiceId: string }[];
```

requestId·sessionId·objectId는 UUID이며 복구 흐름에서만 objectId=null을 허용한다. revision은 0 이상의 정수다. choices는 시작부터 현재 단계까지 재생 가능한 순서여야 한다. 이전 답을 바꾸면 그 답에 의존한 후속 이력을 버리고 다시 계산한다. 현재 단계 주장과 이력이 다르거나 카탈로그 버전이 달라지면 `INVALID_REQUEST`다. 버전 변경 메시지를 받으면 현재 진행을 조용히 새 기준으로 바꾸지 말고 재시작한다.

## POST /api/coach/help

`multipart/form-data`에 `context`와 `choices`를 JSON 문자열로 넣고 `text` 또는 `audio` 중 정확히 하나를 보낸다. text는 공백 아닌 1~1,000자, audio는 위 한도의 `audio/wav` File이다. `choices`는 빈 배열일 수 있다. 빈 질문·둘 다 제출·알 수 없는 필드·오디오 형식 오류·잘못된 단계 이력은 공통 오류로 처리한다.

HTTP 200은 `{context,transcript,replyId,text,choiceIds,sourceIds}`다. context는 요청과 일치하며 글 질문의 transcript는 null, 음성 질문의 transcript는 1~1,000자 전사다. replyId·문장·선택 ID·출처 ID는 현재 단계에 허용된 검수 답과 일치한다. 소비자는 전사를 수정해 글 질문으로 다시 보낼 수 있다. 답은 진행을 자동 변경하지 않으며 제안한 선택 버튼을 사용자가 눌러야 상태에 적용한다.

## POST /api/coach/speech

`Content-Type: application/json`으로 `{context,choices,cue:{kind:"step"|"reply",id}}`를 보낸다. step cue는 현재 단계 ID, reply cue는 현재 단계에 허용된 답 ID다. 클라이언트가 읽을 자유 문장을 보내는 필드는 없다.

HTTP 200은 한도 내 WAV 바이트이며 `Content-Type: audio/wav`, `Content-Length`, `Cache-Control: no-store`, `X-Request-Id`, `X-Guide-Revision`을 포함한다. 서버는 생성 음성의 대응 텍스트를 NFC 정규화하고 공백·문장부호를 제외한 뒤 검수 문장과 대조한다. 불일치는 `INVALID_MODEL_RESPONSE`이며 오디오를 반환하지 않는다. 오류 본문은 WAV가 아닌 공통 JSON이다.

소비자는 성공 상태·Content-Type·요청 ID·revision을 확인하고, 요청 당시 세션·물건·단계가 아직 현재인지 대조한 뒤 재생한다. 초기화·정정·물건 전환·화면 이탈 시 녹음·전사·도움·재생 요청을 취소하고 늦은 응답도 버린다. 음성 종료만으로 다음 단계에 가지 않는다. 실패하면 현재 화면 안내를 유지하고 글·버튼 또는 수동 재시도를 제공한다.

## POST /api/identify — 기존 10종 품목 인식

`multipart/form-data`로 `requestId` UUID, `region: songpa`, `photos` 1~3개, `messages: "[]"`를 전달한다. 한 사진의 여러 물건과 서로 다른 물건의 여러 사진을 허용한다. 크기·형식·본문·해독·시간·동시 처리 제한 및 오류 응답은 아래 분석 API와 동일하다.

HTTP 200 응답은 `{requestId, outcome, items, hasOtherItems}`다. outcome은 `identified | unclear | unsupported`, items는 아래 ItemId의 중복 없는 배열(최대 10개), hasOtherItems는 별도의 미지원 물체 포함 여부다. identified는 하나 이상, 나머지는 빈 items여야 한다. 모델이 만든 안내·URL·임의 품목 ID는 받지 않는다. requestId가 현재 요청과 다르면 버린다.

이전 기본 화면의 소비자는 품목 선택 후 서버가 제공한 검수 카탈로그에서 준비 방법을 표시한다. 적용 재질·상태와 공식 출처를 함께 제공하고, 선택한 상태를 AI가 확인한 사실로 바꾸지 않는다. 품목·상태 전환에는 추가 네트워크 요청이 없다.

## POST /api/analyze — 기존 상세 조건 확인

`multipart/form-data`로 전송한다. 브라우저 FormData의 Content-Type 경계값을 직접 덮어쓰지 않는다.

| 필드 | 형식과 한도 |
|---|---|
| `requestId` | 전송마다 새로 만드는 UUID 문자열. 상관관계 확인용이며 저장 키가 아니다. |
| `region` | 문자열 `songpa` |
| `photos` | 동일 필드명으로 사진 File 1~3개. 한 제품의 현재 사진 전체. 장당 5MiB까지, 실제 JPEG·PNG·WebP 단일 이미지. MIME과 내용이 맞아야 한다. |
| `messages` | JSON 문자열 배열. 각 항목은 `{role: "user" 또는 "assistant", text: string}`. 빈 배열 허용, 시간순 최대 12개, 각 text 최대 1,000자. |

요청 전체는 multipart 경계를 포함해 16MiB까지다. 서버 해독은 이미지당 2,400만 화소까지 허용한다. 기본 화면은 읽을 수 있는 큰 사진을 비율 유지 축소하지만 직접 API를 쓰는 소비자도 한도를 지켜야 한다. 제한 초과 입력을 자동으로 잘라 처리하지 않는다. 분석 제한시간은 45초, 동시에 처리할 수 있는 요청은 서버 프로세스당 2건이다. 재시도는 새 requestId로 사용자가 실행한다.

## /api/analyze 정상 응답

이 경로의 HTTP 200 응답은 다음 필드를 갖는다. 미사용 값은 생략하지 않고 null을 보낸다.

```ts
type Result = {
  requestId: string;
  status: "needs_info" | "ready" | "uncertain" | "unsupported";
  item: { id: ItemId; label: string } | null;
  question: { text: string; choices: string[]; allowPhoto: boolean } | null;
  guidance: {
    region: "songpa";
    ruleIds: string[];
    steps: string[];
    parts: { name: string; disposal: string; actions: string[]; sourceIds: string[] }[];
    cautions: string[];
    sources: { id: string; title: string; url: string; checkedAt: string }[];
  } | null;
  message: string;
};
```

| ItemId | label |
|---|---|
| `pump_bottle` | 샴푸·린스 용기 |
| `clear_pet_bottle` | 투명 생수·음료병 |
| `drink_carton` | 우유·두유팩 |
| `cardboard_box` | 택배 상자 |
| `foam_box` | 스티로폼 상자 |
| `snack_bag` | 과자 봉지 |
| `takeaway_container` | 배달 용기 |
| `glass_jar` | 잼 유리병 |
| `toothbrush` | 칫솔 |
| `ice_pack` | 아이스팩 |

`needs_info`에는 질문 하나가 있고 guidance는 null이다. choices 외의 자유글 답도 가능하며 allowPhoto가 참이면 같은 제품의 사진을 추가한다. `ready`에는 item과 guidance가 필수이고 question은 null이다. ruleIds·steps·parts·sources와 각 부품의 actions·sourceIds는 비어 있지 않다. 모든 부품의 sourceIds는 해당 sources의 고유 ID를 참조한다. ruleIds는 실제 검수 규칙이며 소비자가 생성하거나 지정하는 값이 아니다. sources의 checkedAt은 자료 확인 날짜 `YYYY-MM-DD`이고 발행일을 뜻하지 않는다.

`uncertain`과 `unsupported`는 question·guidance가 모두 null이다. message는 이유와 다음 행동을 설명한다. 확정 배출 방법을 이 상태에 추가하지 않는다. requestId가 현재 요청과 다르면 소비자는 응답을 적용하지 않는다.

## 실패 응답

```ts
type Failure = {
  requestId: string | null;
  error: { code: string; message: string; retryable: boolean };
};
```

requestId는 유효한 값이 확인된 경우 되돌려주고 그 전의 실패에서는 null일 수 있다. 오류에는 스택·키·사진 본문·외부 원본 오류가 없다. retryable은 같은 조건에서 수동 재시도를 할 수 있는지 나타내며 자동 반복 요청을 지시하지 않는다.

| HTTP | code | retryable | 소비자 행동 |
|---|---|---|---|
| 400 | `INVALID_REQUEST` | false | 필드·지역·JSON·현재 경로·오디오 형식 수정. 카탈로그 변경 안내면 처음부터 재시작 |
| 413 | `PAYLOAD_TOO_LARGE` | false | 파일·본문·메시지 수·글 길이를 줄임 |
| 415 | `UNSUPPORTED_IMAGE` | false | 실제 해독 가능한 지원 사진 또는 작은 해상도로 변경 |
| 503 | `CONFIGURATION_ERROR` | false | 운영자에게 서버 키·인증·모델 접근 확인 요청 |
| 503 | `SERVICE_UNAVAILABLE` | true | 네트워크·서비스·사용량·동시 요청 문제 후 수동 재시도 |
| 504 | `ANALYSIS_TIMEOUT` | true | 수동 재시도 |
| 502 | `INVALID_MODEL_RESPONSE` | true | 유효한 결과를 받지 못했음을 표시하고 수동 재시도 |

응답을 받지 못하는 네트워크 오류도 실패다. 입력을 유지하며 임의 성공 결과로 대체하지 않는다. 위 기존 API는 스트리밍·이벤트 구독·파일 조회·대화 복원 API를 제공하지 않는다. 기본 통화는 아래 WebRTC 스트림과 데이터 채널을 사용한다.

## POST /api/call — 기본 음성 통화

`application/sdp`의 WebRTC offer를 최대 64KiB로 받는다. 선택 헤더 `X-Recycling-Language`는 `ko` 또는 `en`만 허용하며 생략 시 `ko`다. 미지원 값은 외부 연결 전에 400으로 거절한다. 선택 언어는 세션 지침·전사 언어·첫인사에 일관되게 적용하고 검수된 송파구 기준은 변경하지 않는다. Origin은 실제 Host/스킴과 일치해야 한다(개발 서버의 0.0.0.0 바인드 주소와 구분). 서버의 기존 API 키로 Realtime calls를 연결하고 `{sdp,token}` JSON을 no-store로 반환한다. token은 로그인 자격증명이 아닌 해당 통화를 종료할 수 있는 임시 UUID이며 서버 메모리에만 매핑한다. 서버 키·제공자 call ID는 브라우저에 반환하지 않는다. 실패는 기존 공통 오류 응답이다.

`DELETE /api/call`은 같은 출처의 요청 본문에 JSON이 아닌 token 문자열 하나를 최대 100바이트로 받아 제공자 통화를 종료한다. 이미 끝난 token도 204로 응답한다. 서버는 최대 두 통화를 유지하고 10분 뒤 자동 종료를 요청한다. 프로세스가 재시작되면 임시 매핑은 소실되므로 클라이언트의 WebRTC 연결 종료가 독립된 정리 경로다.

브라우저는 WebRTC 미디어 트랙으로 음성을 주고받고 데이터 채널로 현재 자막·발화 상태·이미지를 전달한다. 카메라 프레임은 약 3초 간격 JPEG이며 한 이벤트를 60KB 미만으로 만들고 최근 두 이미지 메시지만 유지한다. 기본 발화 감지·답변·끼어들기는 자동이다. 기존 coach의 choices·speech cue·발화 일치 검증은 이 경로의 계약이 아니다.

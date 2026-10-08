# Sites PWA 배포

2026-10-08. 사용자 요청으로 기존 UI를 보존한 배포용 체크아웃 `../RecycleGuide-PWA`를 만들었다. 원본 `../WAICY_2026_분리수거AI`의 미커밋 작업과 로컬 실행은 그대로 보존했다. 이후 **배포 수정은 RecycleGuide-PWA에서 수행**하며, 두 디렉터리는 자동 동기화하지 않는다.

## 실행과 배포

- `.openai/hosting.json`의 project_id가 연결된 Sites다. 새 Site를 중복 생성하지 않는다.
- `npm ci`, `npm run build`: `dist/server/index.js`와 임베디드 공개 자산을 생성한다. Sites의 정상 workflow로 소스 푸시·패키징·저장·배포한다.
- `npm run preview:sites`: localhost:3026의 Workers 로컬 실행. 키가 필요한 검증은 `--env-file ../WAICY_2026_분리수거AI/.env`를 추가해 이미 승인된 로컬 키를 읽는다. 값을 출력하거나 파일을 복사하지 않는다.
- `npm run dev` / `npm run build:next`: 보존된 Next.js 로컬 구현이다. Sites 런타임과 같다고 취급하지 않는다.
- 기존 키를 Sites의 `OPENAI_API_KEY` secret으로 등록하도록 사용자가 명시 승인했다. 값은 소스·빌드·브라우저에 넣지 않는다.
- 기본 접근은 소유자 전용이다. 공개 공유 전환은 별도 사용자 요청을 따른다. 정기 갱신은 필요하지 않다.

## 제공하는 기능

Sites에서는 기존 React 통화 화면, 한국어/영어, 음성·촬영·앨범 진입, 통화 중 카메라 정지 화면·사진·음소거·종료와 `/api/call`을 제공한다. 원래 프로젝트의 사용하지 않는 단계별 API·WAV/이미지 서버 경로는 소스에 보존했지만 Sites에 노출하지 않는다. 검수 세션 지침은 `src/lib/server/call-session.ts`를 공유한다.

PWA는 manifest의 standalone 모드, 일반 192/512px·maskable 512px·Apple 180px 아이콘, 서비스 워커를 제공한다. 홈·API·사진·음성·자막은 캐시하지 않고 `/offline.html`만 저장한다. AI 안내에는 인터넷이 필요하다. iPhone Safari에서 공유 → 홈 화면에 추가, Android Chrome에서 설치 메뉴를 이용한다. 실물 기기 설치·권한·백그라운드 복귀는 아직 미검증이다.

## 서버 차이와 검증 경계

Workers는 요청마다 실행 인스턴스가 달라질 수 있어 로컬 서버의 메모리 Map을 통화 종료에 사용하지 않는다. 통화 ID와 1시간 만료 시각을 인증 암호화한 불투명 토큰을 반환하며, 다른 인스턴스에서도 검증 후 지정된 통화만 종료한다. 사용자 대화·미디어는 저장하지 않는다. 위조·변조·만료 토큰은 제공자 호출 전에 거절한다. 토큰을 재사용해도 같은 통화 종료 요청만 가능하다.

10분 종료는 클라이언트 타이머가 실행한다. Workers에는 요청 이후의 10분 타이머나 전역 동시 통화 2개 보장을 두지 않는다. 브라우저 강제 종료·중단 시 제공자 연결 종료까지의 시간이나 총 비용 상한은 보장하지 않는다. 키 재설정은 기존 종료 토큰을 무효화하며 브라우저 peer 종료는 별도로 동작한다.

lint/typecheck 통과. 자동 검사 35파일·577개: 첫 실행의 기존 HTTPS 검사 1개는 새 폴더에 Git이 없어 실패했고, 저장소 초기화 후 해당 11개 검사를 재실행해 모두 통과했다. 나머지 566개는 첫 실행에서 통과했다. Sites Worker와 보존된 Next 빌드 모두 통과했다. 빌드 산출물에서 실제 키 일치 0건, production 의존성 npm audit 0건이다.

Aside에서 로컬 Workers 런타임의 한국어·영어 UI, manifest standalone, 서비스 워커 activated/controlled, 오프라인 캐시가 `/offline.html` 하나뿐임을 확인했다. 무음 합성 마이크로 실제 OpenAI WebRTC 연결·영어 첫인사 자막·종료 API 204를 확인했다. 사람 청취·실물 촬영은 검증하지 않았다. 배포 성공 근거는 Sites의 해당 배포 상태를 따른다.

참고: [MDN PWA 설치 조건](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [Workers 인스턴스와 전역 상태](https://developers.cloudflare.com/workers/reference/how-workers-works/).

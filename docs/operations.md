# 로컬 실행과 점검

**Sites PWA 현재 운영:** 설치·배포 소스, 접근 범위, Workers 통화 종료 계약과 검증은 [Sites PWA](sites-pwa.md)를 우선 따른다. 아래 Next 로컬 서버 기록과 구분한다.

macOS에서 Node.js 22.22.3, npm 10.9.8, OpenSSL 3.6.4로 확인했다. Node 22 계열·npm과 모델 호출용 인터넷 연결이 필요하다. 기본 통화에는 `gpt-realtime-2.1-mini`와 `gpt-transcribe`를 사용한다. 기존 coach를 시험할 때에는 사진/도움 `gpt-6-luna`, 전사 `gpt-transcribe`, 안내 음성 `gpt-realtime-2.1-mini` 접근이 가능해야 한다. 음성 목소리는 현재 `marin`이다. 키는 서버 전용이며 음성 사용에는 추가 API 비용이 발생한다.

## 처음 실행

프로젝트 루트에서 기존 설치·환경을 확인하고 실행한다. 기존 `.env`를 출력·덮어쓰지 않는다.

```sh
npm ci
if [ ! -f .env ]; then cp .env.example .env; fi
chmod 600 .env
```

키가 비어 있으면 로컬 편집기로 `.env`의 `OPENAI_API_KEY`를 설정한다. 이미 설정되어 있으면 재사용한다. `NEXT_PUBLIC_` 변수나 클라이언트 설정에 넣지 않는다. 앱 환경변수는 서버 키 하나이며 `OPENAI_MODEL` 설정은 사용하지 않는다. 모델·목소리는 서버 코드에 지정되어 있다. 첫 실행용 DB 초기화·업로드 저장소·사용자 데이터 이전은 없다.

```sh
npm run dev
```

컴퓨터에서는 `http://localhost:3000`을 연다. 언어 선택 후 말로 물어보기를 눌러 질문하며 localhost의 마이크도 브라우저 권한이 필요하다. 휴대폰에서 컴퓨터 LAN 주소의 일반 HTTP로 접속하면 마이크를 사용할 수 없으므로 HTTPS를 준비한다. 보안 연결과 권한 조건은 [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)에 근거한다. 파일 촬영/선택은 브라우저의 실시간 카메라 스트림과 별개다.

## 로컬 HTTPS 준비

같은 신뢰할 수 있는 Wi-Fi에 컴퓨터와 기기를 연결한다. 먼저 설치된 OpenSSL을 확인한 뒤 인증서만 준비한다. 자동 도구 설치·공개 터널·공개 배포는 하지 않는다.

```sh
openssl version
npm run https:prepare
```

OpenSSL 3가 필요하다. 명령은 Git 제외 `.local-https/` 아래에 다음 파일을 만들고 접속 주소를 출력한다. 폴더는 0700, 파일은 0600이다.

| 파일 | 용도 |
|---|---|
| `.local-https/authority/cert.pem` | 기기에 신뢰시킬 CA 공개 인증서 |
| `.local-https/authority/key.pem` | CA 개인키. 컴퓨터 밖으로 전송하지 않음 |
| `.local-https/server/cert.pem` | localhost와 현재 장치 사설 IPv4 주소용 서버 인증서 |
| `.local-https/server/key.pem` | 서버 개인키. 공유·커밋하지 않음 |

CA는 3,650일, 서버 인증서는 30일로 생성한다. 기존 CA·서버 키는 재사용하며, 현재 RFC1918 IP 집합이 달라지거나 서버 인증서의 남은 유효기간이 하루 미만이면 서버 인증서만 검증 후 교체한다. CA의 남은 기간이 31일 미만이거나 기존 자료가 불완전하면 중단한다. CA를 자동 교체하지 않으므로 기기 신뢰가 몰래 바뀌지 않는다.

심볼릭 링크·다른 소유자·과도한 권한·잘못된 기존 키/인증서는 자동 수정하지 않는다. 오류가 나면 정확한 파일과 소유권을 확인한다. `.lock` 오류에서는 실행 중인 준비 명령이 있는지 먼저 확인하고, 남은 잠금임을 확인한 경우에만 빈 잠금 폴더를 제거한다. 폴더 전체를 무조건 지우고 CA를 다시 만들지 않는다.

## 기기에서 마지막으로 수행할 신뢰 설정

이 절차는 실제 사용할 기기 소유자가 수행한다. 앱은 시스템 신뢰를 자동 변경하지 않는다. 신뢰 대상은 직접 생성한 `RecycleGuide Local Development CA` 하나이며 다음 명령으로 공개 인증서의 주체·기간·SHA-256 지문을 확인한다.

```sh
openssl x509 -in .local-https/authority/cert.pem -noout -subject -dates -fingerprint -sha256
```

Mac에서는 **CA 공개 cert.pem만** 키체인 접근의 로그인 또는 시스템 키체인에 추가하고, 해당 인증서를 열어 신뢰 항목에서 SSL 신뢰를 설정한다. 인증서 지문과 대상 이름을 확인한 뒤 기기의 인증 요청을 처리한다. [Apple 인증서 추가](https://support.apple.com/guide/keychain-access/add-certificates-to-a-keychain-kyca2431/mac), [Apple 인증서 신뢰 설정](https://support.apple.com/guide/keychain-access/change-the-trust-settings-of-a-certificate-kyca11871/mac)의 수동 절차를 따른다.

iPhone/iPad에 옮길 때는 필요하면 공개 인증서만 DER 형식으로 변환한다. 개인키·`.env`·인증서 폴더 전체는 전송하지 않는다.

```sh
openssl x509 -in .local-https/authority/cert.pem -outform DER -out .local-https/recycleguide-local-ca.cer
```

공개 `.cer` 파일만 사용할 기기에 안전하게 옮겨 열고, 설정의 일반 → VPN 및 기기 관리에서 해당 인증서 프로파일을 확인·설치한다. 이어 일반 → 정보 → 인증서 신뢰 설정에서 해당 루트 인증서의 전체 신뢰를 켠다. 프로파일 설치만으로 SSL 신뢰가 자동 활성화되는 것은 아니다. [Apple 프로파일 설치·삭제](https://support.apple.com/guide/iphone/install-or-remove-configuration-profiles-iph6c493b19/ios), [Apple 수동 인증서의 SSL 신뢰](https://support.apple.com/en-us/102390)에 따른 절차이며 OS 버전에 따라 메뉴 표현이 달라질 수 있다. 관리 기기에서 설치가 제한되면 관리 정책을 우회하지 않는다.

시험을 끝내고 더 이상 쓸 필요가 없으면 기기에 설치한 프로젝트 인증서/프로파일의 신뢰를 제거한다. 다른 인증서나 프로파일을 일괄 삭제하지 않는다. Android 등 다른 기기는 실제 OS·브라우저와 제조사의 CA 설치 경로를 확인한 뒤 진행한다. 현재 어떤 휴대폰에서도 신뢰 설정·마이크 성공을 확인한 상태는 아니다.

## HTTPS 서버 시작과 주소 검증

이 프로젝트의 HTTP 개발 서버가 실행 중이면 먼저 그 서버를 시작한 터미널에서 `Ctrl+C`로 종료한다. Next 개발 서버는 같은 프로젝트의 `.next/dev/lock`을 사용하므로 포트만 바꿔 두 개발 서버를 동시에 실행할 수 없다. 다른 프로젝트 서버는 종료하지 않는다.

```sh
npm run dev:https -- --port 3443
```

기본 포트는 3443이다. 명령은 인증서를 먼저 준비하고 Next 개발 서버에 key·cert·CA 경로를 명시하여 시작한다. 다른 프로그램이 사용 중인 포트라면 해당 프로그램을 임의 종료하지 말고 비어 있는 별도 포트를 지정한다. 같은 프로젝트 개발 서버의 잠금 문제는 포트 변경으로 해결하지 않는다. `--prepare` 옵션을 주면 서버를 시작하지 않고 인증서 준비만 수행한다.

컴퓨터는 `https://localhost:3443`, 휴대폰은 터미널에 표시된 `https://현재-컴퓨터-IP:3443`을 연다. 휴대폰의 localhost는 휴대폰 자신이므로 사용하지 않는다. SAN에는 현재 장치의 정확한 RFC1918 IPv4만 넣으며 공인·와일드카드 주소는 추가하지 않는다. 네트워크/IP가 바뀌면 HTTPS 서버를 종료하고 위 실행 명령으로 다시 준비·시작한다. 개발 출처 허용 목록도 서버 시작 시 갱신된다.

별도 터미널에서 시스템 신뢰 설치 없이 CA 파일을 명시한 TLS·HTML 응답을 확인할 수 있다.

```sh
openssl verify -purpose sslserver -verify_hostname localhost -CAfile .local-https/authority/cert.pem .local-https/server/cert.pem
curl --fail --cacert .local-https/authority/cert.pem https://localhost:3443/ -o /dev/null
```

LAN 주소는 출력된 현재 IP로 바꿔 같은 curl 확인과 `openssl verify -purpose sslserver -verify_ip 현재-IP -CAfile .local-https/authority/cert.pem .local-https/server/cert.pem`을 수행한다. 인증서 오류를 무시하는 `curl -k` 성공을 신뢰 검증으로 기록하지 않는다. 이 확인은 서버의 TLS/HTML 근거이며 휴대폰 브라우저의 신뢰·마이크 동작 근거가 아니다.

## 기본 통화 흐름과 검증

현재 기본 화면은 언어 선택 → 말로 물어보기 → 마이크 허용 → 질문이다. 사진 찍기와 사진 선택은 독립 버튼이며 선택한 사진을 음성 연결 후 자동 전송한다. 사진 선택을 취소하면 마이크를 요청하지 않는다. 촬영 입력은 휴대폰 후면 카메라를 요청하지만 데스크톱에서는 파일 선택기로 열릴 수 있다. 통화 중에는 별도로 카메라 공유와 사진 전송을 선택한다. 연결 중 언어 전환은 잠기며 종료 후 바꿀 수 있다. 휴대폰은 앞 절의 신뢰된 HTTPS가 필요하다. localhost 데스크톱 시험은 휴대폰의 권한·오디오 경로·화면 잠금·모바일 데이터 전환 검증을 대체하지 않는다. `/api/call`은 로컬 범위에서 WebRTC 연결을 열며 전화번호로 거는 PSTN/SIP 전화는 구성하지 않았다.

## 이전 coach 기기 흐름과 검증

촬영/파일 선택 → 물건 확인 → 안내 시작 → 행동 선택 → 말로 질문·말 마치기 → 제안 선택 → 부품별 결과를 실제 기기에서 확인한다. 정보 메뉴에서 외부 전송·AI 음성 안내를 확인하고, 권한 거절·취소·무음·다시 듣기·재생 중 물건 전환도 시험한다. 마이크 권한 실패에서는 글·버튼으로 계속 진행할 수 있어야 한다.

가상 키보드·세로/가로·글자 확대·동작 줄이기, 사진 방향·HEIC·파일 취소는 기기명·OS·브라우저와 함께 기록한다. HEIC를 읽지 못하면 JPEG로 변환해 선택한다. 데스크톱 CSS 폭 확인을 휴대폰 기기 검증으로 기록하지 않는다.

## 공통 코드 검사와 프로덕션 실행

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run start -- --port 3014
```

`typecheck`는 Next 경로 타입을 생성한 뒤 검사한다. 같은 프로젝트의 개발 서버를 종료한 상태에서 build와 프로덕션 점검을 수행한다. `start`는 성공한 build 결과가 필요하고 위 프로덕션 점검 주소는 `http://localhost:3014`다. HTTPS 개발 명령의 기기 시험과 구분한다. 페이지 응답 외에 소수 준비 입력의 실제 모델 연결·no-store·요청 맥락을 확인한다. 같은 코드의 문서만 바꿨다면 전체 빌드를 반복하지 않는다.

## 실패 처리와 종료

모델 설정 실패는 키·계정 접근을 값 출력 없이 확인한다. 기본 통화 연결 실패는 오류를 표시하고 사용자가 다시 시작한다. 기존 coach의 음성 실패는 현재 안내를 유지하고 글/버튼으로 진행한다. 원본 제공자 오류를 사용자 기록에 복사하지 않는다. 인증서 문제는 기기 신뢰·접속 IP·인증서 SAN·만료를, 접속 실패는 같은 Wi-Fi·포트·방화벽을 확인한다. 공개 터널로 우회하지 않는다.

시작한 터미널에서 `Ctrl+C`로 해당 서버를 종료하고 포트가 닫혔는지 확인한다. 다른 프로젝트 프로세스를 이름만 보고 일괄 종료하지 않는다. 사진·녹음·대화·진행은 영구 복원되지 않는다. 공개 운영은 접근·비용 통제와 외부 처리 고지를 별도 결정해야 한다.

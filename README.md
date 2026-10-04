# 워뇨띠 체결 뷰어

배포 사이트: **https://wonyotti-viewer.pages.dev/**

[sinsa-99/wonyotti-viewer](https://github.com/sinsa-99/wonyotti-viewer)의 포크입니다.
TradingView Lightweight Charts로 원본 프로젝트의 체결·포지션·캔들·거래량 데이터를 표시합니다.

## 빌드

Node.js 22 이상에서 실행합니다. 추가 npm 패키지는 필요하지 않습니다.

```sh
npm ci
npm run build
```

`dist/`에 공개 정적 파일을 복사하고 월별 Fisher9 JSON을 생성합니다.
HTML이 참조하는 스크립트, 월별 체결·캔들 파일과 Cloudflare Pages의 개별 파일 크기 제한을 확인합니다.

```sh
npm test
npm run preview
```

로컬 차트: http://127.0.0.1:4173/#fills/2021-06/3600/ep2537
`preview`는 빌드한 `dist/`만 제공합니다. 코드를 수정하면 다시 빌드하고 브라우저를 새로 고칩니다.

## 차트 초안: 거래량 · Fisher9 · Long/Short

- 범위: 원본 XBTUSD의 2018-03~2021-12, 46개월, 2,590개 포지션.
- 같은 시간축에 가격/체결 → 시장 거래량 → Fisher9/Trigger → 실제 보유 포지션을 표시합니다.
- 거래량은 캔들 원본의 여섯 번째 열을 합산한 시장 거래량입니다. 워뇨띠의 체결 수량과 구분합니다. XBTUSD 계약 수량이며 1계약 = 1 USD입니다.
- 1분·5분·30분·1시간·4시간·1일을 지원하고 거래량·Fisher9·포지션 패널을 켜고 끌 수 있습니다.
- 초록 ▲ = Long, 빨강 ▼ = Short. 채운 삼각형 = 진입/추가, 빈 삼각형 = 축소/종료. 피드에서는 네 행동을 각각 표시합니다.
- 롱을 줄이는 매도는 Long 축소/종료, 숏을 줄이는 매수는 Short 축소/종료입니다. 실제 매수/매도 정보는 주문 상세에 남습니다.
- 하나의 주문이 방향 전환에 쓰였으면 양방향 역할을 함께 적고 노랑으로 표시합니다.
- 커서를 옮기거나 봉을 클릭하면 해당 봉의 거래량·Fisher·Trigger 수치를 읽을 수 있습니다.

### Fisher9 계산 조건

초안은 **기간 9, 가격 HL2 = (고가 + 저가)/2**를 사용합니다. 최근 9봉 HL2의 최저/최고로 정규화하고 다음 식을 적용합니다.

```text
x = 0.66 × ((HL2 - lowest) / (highest - lowest) - 0.5) + 0.67 × x[1]
x > 0.99이면 0.999, x < -0.99이면 -0.999로 제한
Fisher = 0.5 × ln((1 + x) / (1 - x)) + 0.5 × Fisher[1]
Trigger = Fisher[1]
```

가격 범위가 0인 봉은 정규화 변위를 0으로 처리합니다. 데이터 시작에서 재귀 상태를 0으로 초기화하고 초기 9봉 미만은 가용 이력으로 계산합니다. 월 경계에서는 상태를 초기화하지 않습니다. 빌드가 시간 순으로 전체 2,018,880개 분봉을 읽어 각 봉 크기별로 독립 계산합니다. UTC 기준으로 봉을 집계하고 표시만 KST로 바꿉니다. 점선 0·±1.5는 참고 눈금입니다.

**사용자의 TradingView Fisher9 원본 Pine 코드와 수치 일치는 아직 검증하지 않았습니다.** 입력 가격, 평활식, 초기값, 0 범위 처리, 거래소 데이터가 다르면 값도 달라집니다. 이 초안에는 매매 신호/전략/백테스트를 추가하지 않았습니다. 봉의 지표값은 완성된 봉 기준이며 후속 연구에서 체결 시점에 사용할 때는 봉 마감 전 정보와 구분해야 합니다.

계산 근거: [Fisher Transform 개요](https://www.tradingview.com/support/solutions/43000589141-fisher-transform/).
상세 구현과 검증: [research.mjs](research.mjs), [tests/research.test.mjs](tests/research.test.mjs).

## Cloudflare Pages: GitHub 연결

Cloudflare의 **Workers & Pages → Create application → Pages → Connect to Git**에서 다음 설정을 사용합니다.

| 항목 | 값 |
| --- | --- |
| GitHub 저장소 | `unknowntrader7/wonyotti-viewer` |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | 비워 둠 (저장소 루트) |

GitHub 앱 연결이 정상일 때 `main` 푸시로 Cloudflare가 자동 빌드·배포합니다.
배포 대상은 이 저장소의 뷰어와 공개 데이터입니다.

2026-10-04 최초 배포는 성공했지만 대시보드의 Git 계정 연결 해제 경고로 후속 자동 배포는 아직 확인되지 않았습니다. 저장소에 푸시된 코드와 현재 운영 사이트의 버전은 배포 내역에서 확인해야 합니다.

공식 문서: [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/),
[Build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/).

## 원본과 동기화

```sh
git fetch upstream
git merge upstream/main
git push origin main
```

현재 포지션·시장 데이터는 원본 프로젝트에서 가져온 상태이며 Fisher9·거래량 패널과 행동 표기를 추가했습니다. 우리 재구성 자료와 원본 포지션의 전수 대사는 후속 작업입니다.
원본 화면의 출처 표기 및 TradingView Lightweight Charts 라이선스 고지를 유지합니다.

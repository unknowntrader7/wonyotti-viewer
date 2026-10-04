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

`dist/`에 `index.html`, `app.js`, `data/`, `lib/`를 복사합니다.
HTML이 참조하는 스크립트, 월별 체결·캔들 파일과 Cloudflare Pages의 개별 파일 크기 제한을 확인합니다.
로컬에서는 `dist/`를 정적 HTTP 서버로 제공해 실행합니다.

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

연결 후 `main`에 커밋을 푸시하면 Cloudflare가 자동으로 빌드·배포합니다.
배포 대상은 이 저장소의 뷰어와 공개 데이터입니다.

공식 문서: [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/),
[Build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/).

## 원본과 동기화

```sh
git fetch upstream
git merge upstream/main
git push origin main
```

이 포크의 자체 포지션 데이터 연결과 Fisher9 추가는 후속 작업입니다.
현재 차트와 연구 데이터는 원본 프로젝트에서 가져온 상태입니다.
원본 화면의 출처 표기 및 TradingView Lightweight Charts 라이선스 고지를 유지합니다.

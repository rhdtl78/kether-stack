# Multi-machine Workspace

Hermes Desktop의 머신 → 프로젝트 → 세션 통합 탐색을 위한 개인 플러그인 프로젝트.

## 현재 상태

**초기 구성만 완료. 통합 탐색 기능은 미구현이다.**

- `plugin.js`: Desktop-only ESM 진입점. 기본 비활성(`defaultEnabled: false`). 초기 상태를 설명하는 pane만 등록한다.
- `tests/plugin.test.js`: 실제 entry module을 불러와 id/opt-in/등록 계약을 확인한다. context는 테스트 fixture다. Desktop 실행 검증은 아니다.
- `docs/PLAN.md`: 요구사항·SDK 근거·남은 경계와 승인 범위.

Python backend나 `plugin.yaml`은 필요가 확인되기 전 추가하지 않는다. 저장소의 `hermes/plugins/`는 소스 정리 경로이며 Hermes 런타임의 plugin 설치 위치가 아니다.

## 로컬 검증

이 디렉터리에서 Node.js 22 이상으로 실행한다. 외부 의존성 설치는 필요 없다.

```sh
npm run check
npm test
```

## 후속 구현·설치

기능 구현 전 docs/PLAN.md와 저장소 AGENTS.md를 읽는다. 실제 UI는 `@hermes/plugin-sdk`, `react`, `react/jsx-runtime` 공개 import만 사용하며 JSX 빌드 없이 ESM으로 배포한다.

앱 설치는 별도 승인 대상이다. 승인 시 대상 앱이 읽는 HERMES_HOME을 확인한 뒤 `desktop-plugins/multi-machine-workspace/plugin.js`로 배포하는 경로를 검토한다. 지금은 복사·symlink·자동 설치 스크립트를 추가하지 않는다. 단일 entry에 모듈을 추가할 경우 런타임 로더의 상대 import 지원부터 확인한다.

공식 SDK: https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk

# 요구사항과 최소 변경 경계

## 목표

- 머신 선택기를 순회하지 않고 모든 등록 머신을 동시에 표시한다.
- 머신 아래 프로젝트와 세션을 펼친다. profile/targetProfile 소유권은 보존한다.
- 다른 머신의 세션을 기존 탭·분할에서 동시에 연다. 선택으로 다른 목록이나 열린 작업이 사라지지 않는다.
- 같은 이름·ID의 충돌과 입력·스트림·승인 오라우팅을 막는다.
- 로딩, 빈 목록, 오프라인, 재인증, 실패를 구분한다.

## 조사 근거와 한계

이 문서는 desktop-ui 조사 결과의 프로젝트용 요약이다. Home Repo 원문이나 봇 메모리를 복사한 것이 아니다.

설치 Desktop 0.22.0의 install-stamp 기준 커밋은 `e06df9c2eae6901f4c88f464e0ae6e753c0428b8`이었다. 앱 업데이트 시 다시 확인한다. 기존 로컬 checkout의 Desktop은 0.17.0이어서 설치 버전 판단 근거로 사용하지 않는다.

해당 빌드 소스 기준:

- `apps/desktop/src/sdk/index.ts:1478-1520`: `host.profileRoutes()`와 `host.requestProfile(route, ...)`로 전경 전환 없이 연결별 조회 가능.
- `sdk/index.ts:385-424`, `:958-1080`: `host.openSession`에 route/intent 옵션 존재.
- `store/projects.ts:519-620`, `:653-695`: `projects.tree`와 `projects.project_sessions`를 재사용할 수 있음. 활성 store를 전역 전환하며 순회하지 말고 route별 query/cache를 둘 것.
- `sdk/index.ts:1161-1169`, `app/open-session.ts:197-201`: Sessions-mode의 ownerRoute 전달 경계는 추가 검증이 필요함.
- `store/session-states.ts:2365-2401`, `:2440`: 탭 판별과 pane identity가 storedSessionId 중심이어서 같은 id의 cross-source 동시 열기를 안전하다고 단정할 수 없음.

설치 번들의 정적 존재와 소스 읽기까지 확인했으며 실제 UI·원격 입력·승인 격리 성공 증거는 없다. CDP 9222는 응답하지 않았고 앱을 재시작하지 않았다.

## 구현 방향 — 아직 미승인

통합 트리는 이 플러그인에서 구현한다. 기존 연결 풀·인증·세션 renderer·탭·분할을 재사용한다. profileRoutes descriptor 전체를 보존하고 cache 및 row key에 owner scope를 포함한다. tree preview를 전체 세션 목록으로 오표시하지 않는다.

SDK 경계나 동일 stored id의 탭 충돌이 실제로 재현되면 필요한 앱 보강 범위를 별도로 승인받는다. 일반 세션을 Bot Mode로 위장하거나 비밀을 읽어 우회하지 않는다.

## 검증 순서

1. 현재 초기 구성: syntax와 module registration 계약 테스트.
2. 기능 구현 승인 후: route별 cache, 실패 격리, 중복 ID 회귀 테스트.
3. 격리 Desktop에서 실제 탭·분할·포커스·draft 보존·재연결 검증.
4. 대상과 내용을 승인받은 실제 머신 입력·스트림·승인 라우팅 검증.
5. 실사용 설치·활성화는 별도 승인.

## 참고

- https://hermes-agent.nousresearch.com/docs/user-guide/multi-connection-desktop
- https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk

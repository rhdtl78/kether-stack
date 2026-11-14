# Multi-machine Workspace

Hermes Desktop용 opt-in **머신 → 프로젝트 → 세션** 탐색 pane. `plugin.js`는 실제 실행 가능한 단일 ESM entry다. 저장소의 `hermes/plugins/`는 소스 위치이며 실사용 Hermes 설치 위치가 아니다.

## 동작

- 공개 `host.profileRoutes()` descriptor를 connectionId로 묶어 머신을 동시에 표시한다. 프로젝트에는 Desktop `profile → targetProfile`을 표시한다. 동일 프로젝트 이름/id는 route별 별도 행이다.
- 공개 `host.requestProfile(route, ...)`로 route별 독립 조회한다. React Query의 앱 공용 client를 사용하고, key에 **connectionId, mode, profile, targetProfile, resource, project id**를 넣는다. 전경 연결을 순회·전환하지 않는다.
- 프로젝트를 펼치면 hydrated 세션을 별도 조회한다. 다른 세션 선택 때문에 다른 트리를 접거나 지우지 않는다. 머신을 접어도 자식은 mounted 상태를 유지한다.
- 로딩 / 빈 결과 / 실패 / 오프라인·재연결 / 재인증 / API 미지원을 구분하고 수동 재조회가 가능하다. 재조회 실패 때 이전 캐시가 있으면 stale이라고 표시한다. 자동 폴링·자동 RPC retry는 없다.
- React Query 취소 신호를 읽고 RPC 완료 뒤 다시 확인한다. 늦은 응답은 취소된 query에 게시하지 않는다. RPC transport 자체를 중단하는 것은 아니다. disable/unload 시 query 취소·캐시 제거를 한다.
- 세션 선택만 공개 `host.openSession(id, { route, profile, intent: 'tab', workspaceMode: 'sessions', keepAllProfilesScope: true, ... })`를 호출한다. descriptor 전체를 보존하고 `profile`은 Desktop route profile, 프로젝트 RPC의 `params.profile`은 **backend targetProfile**이다. 기존 탭/분할 focus 및 중복 방지는 core opener에 맡기고, 새 탭은 기존 main을 대체하지 않는 `tab` intent를 사용한다. 새 split을 직접 생성하지 않는다. 전역 활성 연결/profile 변경 API는 호출하지 않는다. `keepAllProfilesScope`에 따른 core의 전체 프로필 표시 변경은 있을 수 있다.

## 충돌 거부와 SDK 경계 — 안전성 보증 아님

알려진 동일 stored id / lineage alias가 다른 owner scope의 overview membership·preview·hydrated cache에 있거나, 이 플러그인의 이전 open claim과 충돌하면 **열기 전에 거부**한다. 공개 focused owner가 다르거나 불명확한 경우도 거부한다. 실패한 open도 이미 탭을 만들었을 수 있으므로 claim은 renderer 플러그인 수명 동안 보존한다. reload하면 claim은 사라진다. 모호한 동일 connectionId/profile의 mode/targetProfile descriptor는 조회 자체를 거부한다. 응답의 기존 connection/profile 소유권을 조용히 덮어쓰지 않는다.

하지만 공개 SDK에는 **모든 열린 탭/분할의 소유 route를 읽는 API가 없다.** non-focused 탭, 숨겨진 세션, 아직 불러오지 않은 머신/프로젝트, 아래 입력 창 밖의 중복 id, 재시작 이전 open은 이 gate가 완전히 검사하지 못한다. 한 route 실패가 다른 route 조회를 막지는 않지만, 실패한 route의 충돌 유무는 알 수 없다. 이 구현은 알려진 충돌에 대한 보수적 거부이며, 전체 cross-machine 안전성 검증이 아니다.

설치 빌드 ref `e06df9c2eae6901f4c88f464e0ae6e753c0428b8`에서는:

- `apps/desktop/src/sdk/index.ts:958-1080,1161-1169`: route owner hint와 explicit dial은 있지만 **Sessions-mode에서는 SDK가 core opener workspaceScope에 ownerRoute를 전달하지 않는다.**
- `apps/desktop/src/app/open-session.ts:197-201`: 새 session tile 생성에 scope를 넘기는 경로도 Bots-mode에 제한된다.
- `apps/desktop/src/store/session-states.ts:2365-2401,2440`: 탭 중복 판별과 pane 이동 식별이 storedSessionId 중심이다.

따라서 route를 SDK 입력에 정확히 전달한 fixture 성공은 pane owner 보존·입력·스트림·승인 라우팅 성공이 아니다. UI에서도 이 한계를 계속 표시한다. 일반 세션을 Bot Mode로 위장하지 않고, 내부 bridge·전역 store·비밀·DOM으로 우회하지 않는다.

**별도 core 변경 승인 필요:** Sessions-mode ownerRoute를 opener → tile → gateway keep-set까지 보존하고, `(connection, profile, stored id/lineage)`로 pane identity와 reuse를 구분하는 보강. 이 저장소에서 core patch는 구현하지 않았다.

## 실제 프로젝트 RPC 계약과 목록 제한

위 pinned ref를 checkout HEAD가 아니라 `git show <ref>:<path>`로 확인했다.

| RPC | 요청 | 응답 / 제한 |
| --- | --- | --- |
| `projects.tree` | `{ profile: targetProfile, preview_limit: 3, session_limit: 2000 }` | `{ projects, active_id, scoped_session_ids }`. project는 `{ id, label, repos:[{ groups:[{ sessions:[] }] }], sessionCount, previewSessions, sessionIds, ... }`. lane은 overview에서 세션을 담지 않음. |
| `projects.project_sessions` | `{ profile: targetProfile, project_id, session_limit: 5000 }` | `{ project: <hydrated tree> \| null }`. `repos[].groups[].sessions`를 렌더. preview를 전체 세션으로 표시하지 않음. |

근거: `tui_gateway/contracts/projects_pets.py:283-308`, `methods_config.py:138-166`, `methods_projects.py:339-349`; Desktop consumer `store/projects.ts:519-620,653-695`; tree shape `app/chat/sidebar/projects/workspace-groups.ts:14-81`.

**페이지 API가 아니다.** backend는 profile 전체에서 최근 세션을 `offset=0`으로 위 입력 창만 읽은 뒤 grouping한다. `project_sessions`의 5,000도 project별 5,000 보장이 아니라 profile 입력 창이다. cursor/has_more/total/다음 페이지를 제공하지 않으므로 전체 이력이라고 주장하거나 임의 offset을 보내지 않는다. archived, child, cron/kanban/oneshot, 0-message 세션도 이 계약에서 제외된다. tree overview의 count 역시 그 조회 창 기준이다. `project: null`은 삭제/입력 창 밖일 수 있고 빈 project와 구분해서 설명한다. 머신 목록은 SDK가 반환하는 route만 표시하며 SDK에서 누락된 unreachable registry source까지 발견했다고 주장하지 않는다.

## 로컬 실행 및 검증

이 디렉터리에서 Node.js 22 이상:

```sh
npm run check && npm test
```

외부 의존성 설치·빌드·실제 RPC 호출은 없다. `--experimental-vm-modules` 경고는 Node의 VM fixture 실행 경고다. `tests/plugin.test.js`는 실제 package entry를 `vm.SourceTextModule`로 실행하고 **공개 SDK/React/context fixture**를 연결한다. 상대 module import나 app 내부 import는 fixture linker도 거부한다. SDK 허용 import는 `@hermes/plugin-sdk`, `react`, `react/jsx-runtime`뿐이다. 실제 loader도 `apps/desktop/src/contrib/runtime-loader.ts:321-398`에서 상대 import를 거부하므로 production은 단일 entry를 유지한다.

회귀 범위: route 중복·모호성, 동일 project/session/lineage id, 소유 scope key, targetProfile params, 한 연결 실패 격리, 늦은 응답 취소, 선택 후 다른 트리 유지, owner route를 전달하는 공개 opener, 지원하지 않는 API, 응답 소유자 불일치, 열기 직렬화·dispose.

**검증하지 않은 것:** 실제 React/TanStack 동작, Desktop loader/UI 렌더·접근성·시각 품질, 실제 등록 머신/원격 RPC, 기존 탭·분할의 실제 focus/reuse, draft 보존, gateway keep-set, 입력·스트림·승인·재연결 라우팅. SDK/context fixture를 Desktop E2E 증거로 해석하지 않는다.

## 설치는 별도 승인

현재는 앱 복사·symlink·플러그인 활성화·재시작·실제 메시지 전송을 하지 않는다. 승인된 후에만 실제 앱 HERMES_HOME과 runtime 버전을 다시 확인하고 `desktop-plugins/multi-machine-workspace/plugin.js` 배포를 검토한다. 기본 비활성(`defaultEnabled: false`)이며 Python backend, 서비스, 유료 의존성, 자동 설치 스크립트는 없다.

공식 최신 문서도 확인했다: https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk . 앱 업데이트 시 위 pinned ref와 최신 SDK 차이를 다시 확인해야 한다.

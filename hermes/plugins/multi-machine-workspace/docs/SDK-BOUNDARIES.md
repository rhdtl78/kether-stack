# 공개 Desktop SDK 경계 — 통합 트리와 세션 소유권

## 목적·범위·판정

통합 탐색 플러그인이 재사용할 공개 계약과, 앱 변경 없이 보장할 수 없는 경계를 기록한다. 구현자와 독립적으로 소스를 검토했으며 작성 중인 플러그인 코드의 미완성은 최종 결함으로 판정하지 않았다.

- 소스 기준은 설치 빌드로 전달받은 **`e06df9c2eae6901f4c88f464e0ae6e753c0428b8`** 하나다. 이하 `apps/…`, `tui_gateway/…`의 `path:line`은 모두 이 커밋의 `git show` 내용이다.
- `/Users/kether/.hermes/hermes-agent`의 현재 HEAD, 오래된 Desktop 0.17.0 checkout, 최신 웹 문서, 설치 번들 및 실제 동작은 서로 다른 증거다. 이 검토는 설치 앱 파일을 읽거나 설치 커밋을 다시 측정하지 않았다. 전달받은 빌드 식별자를 고정해 계약을 확인했다.
- 공식 최신 [multi-connection-desktop](https://hermes-agent.nousresearch.com/docs/user-guide/multi-connection-desktop)와 [desktop-plugin-sdk](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk)를 공개 HTTP로 직접 대조했다. SDK 페이지의 첫 추출은 중간 내용이 잘려 `curl -fLsS`와 HTML 본문 파싱으로 `profileRoutes`/`requestProfile` 설명을 추가 확인했다. TLS 검증을 끄지 않았다.
- **가능:** 전경을 바꾸지 않는 소스별 조회, 머신 → profile → 프로젝트 → repo/lane → 세션 표시, 출처를 포함한 플러그인 캐시, 기존 세션 UI 재사용 시도.
- **조건부/제한:** 공개 `openSession`의 일반 Sessions 경로는 route가 새 탭까지 직접 전달되지 않는 seam이 있다. stored ID가 같은 서로 다른 소스의 탭 동시 열기는 핵심 탭 판별에서 충돌한다. 플러그인 row key만으로 해결되지 않는다. 안전한 제품 동작은 충돌 open 차단과 제한 안내이며, 완전한 동일 ID 동시 작업은 별도 앱 보강 승인/검증 대상이다.
- **관측하지 않음:** Desktop 로딩, 포커스·draft·split 보존, 실제 머신 통신·스트리밍·승인, 재연결. 정적 계약을 실제 성공이라고 표현하지 않는다.

## 책임과 보존/재사용/제한

| 기존 기능 | 플러그인 책임·재사용 | 보존할 것 / 제한 |
| --- | --- | --- |
| 등록 gateway·인증·연결 풀 | `host.connections`, `host.agents`, `host.profileRoutes` | 토큰·URL·SSH 키 원문을 읽지 않는다. 실제 연결 생성/인증은 코어 소유다. |
| 기존 All profiles / Gateway & profile 목록 | 프로젝트 중심의 추가 탐색 pane | 공식 가이드에 이미 전 gateway 세션 목록이 있다. 기존 기능이 없다고 주장하거나 대체·제거하지 않는다. |
| 프로젝트 분류·repo/worktree lane | `projects.tree`, `projects.project_sessions` | backend membership을 재사용한다. cwd 접두사만으로 로컬에서 소유권을 다시 계산하지 않는다. |
| 탭·분할·transcript·composer | `host.openSession(id, options)` | 기존 UI를 재사용하되 일반 Sessions owner 전달 및 동일 ID 한계를 숨기지 않는다. private store/DOM을 조작하지 않는다. |
| 스트림·승인 라우팅 | 기존 코어 event/owner dispatcher | 플러그인은 메시지나 승인을 자동 전송하지 않는다. 리스트용 이벤트가 입력 라우터가 되어서는 안 된다. |
| 재연결·오프라인·재인증 | 코어 socket 관리, route별 query 상태 | 이전 목록은 stale로 표시; 실패를 빈 목록으로 바꾸지 않는다. 재연결이 런타임/작업 복구 성공을 뜻하지 않는다. |
| Bot Mode canonical chat | 그대로 유지 | 일반 세션을 `workspaceMode: 'bots'`로 위장해 owner seam을 우회하지 않는다. |
| 설정·설치·배포 | opt-in 개발 산출물만 | 실사용 플러그인 폴더 복사, 활성화, 앱 재시작, 원격 변경은 이번 승인 밖이다. |

공식 multi-connection 문서는 이미 모든 등록 gateway의 연결 유지, union roster, All profiles의 전체 gateway 세션, owner backend로의 승인 응답을 설명한다(“Agents across gateways”, “Sessions and Bot Mode”). 이것은 제품 계약이며 이 검토에서 실제 접속해 검증한 결과가 아니다.

## 공개 API 이름과 실제 반환 shape

### 인벤토리·조회

```ts
interface PluginProfileRoute {
  connectionId: string
  mode: 'local' | 'remote'
  primary?: true
  profile: string        // 소스 내 Desktop route 선택자
  targetProfile: string  // 그 route가 서비스하는 backend Hermes profile
}

host.profileRoutes(): Promise<PluginProfileRoute[]>
host.requestProfile<T>(route: PluginProfileRoute | string,
  method: string, params?: Record<string, unknown>, timeoutMs?: number,
  options?: { spawnPriority?: 'foreground' | 'background' }): Promise<T>
```

근거: `apps/desktop/src/sdk/index.ts:212-221`, `:254-290`, `:1476-1520`.

- `profileRoutes()` 결과는 배열이다. `{ routes: […] }`나 연결 라벨을 포함한 객체가 아니다. 인벤토리 내부 profile refresh가 실패하면 기존 cache를 사용하고, bridge 미지원이면 reject한다.
- `connections()`도 **배열**을 반환한다. bridge의 `{ connections, primary }`를 받아 각 row에 boolean `primary`를 붙인다. `agents()`는 `{ agents, sources }` 객체를 반환한다. source에 `connectionId, label, kind, reachable, error?, needsSignIn?`가 있고 agent에 `connectionId, connectionKind, connectionLabel, profile, targetProfile?, handle`이 있다. `apps/desktop/src/sdk/index.ts:893-920`; `apps/desktop/src/global.d.ts:1212-1234`.
- `mode: 'remote'`는 SSH/Cloud/URL을 구분하는 kind가 아니다. kind/라벨은 연결·roster metadata와 ID로 조인한다. route에는 인증 원문을 추가하지 않는다.
- `ensureAgent(connectionId, profile)`는 **활성화**한다. 그 뒤 `host.request`는 그 agent로 향한다. 전경 전환 없이 여러 머신을 조회하는 loop에 쓰면 안 된다. `warmAgent`는 fire-and-forget prewarm이다. `apps/desktop/src/sdk/index.ts:922-939`.
- registry 환경에서는 bare profile string overload 대신 descriptor 전체를 전달한다. 같은 profile 이름은 gateway 사이에서 유일하지 않다. 키는 적어도 `[connectionId, profile]`, 프로젝트·세션 키는 그 아래 ID를 붙인 tuple로 만든다. 구분자 충돌을 피하려면 JSON tuple을 직렬화한다.
- 공개 method feature detection은 필요하다. 함수가 있다는 것과 호출 성공은 다르다. 미지원은 명시적 제한으로 표시하고 여러 source를 ambient `host.request`로 순회하는 fallback은 금지한다.

### `profile`과 `targetProfile`은 교환 가능하지 않다

`apps/desktop/electron/plugin-profile-routes.ts:191-210`, `:261-302`에서 legacy URL/cloud override는 backend `default`, SSH remoteProfile override는 별도 이름을 서비스할 수 있다. registry local은 두 값이 같지만 모든 route가 그렇지는 않다. 최신 SDK 문서도 “source-local route used for requests”와 “backend Hermes profile served by that route”를 구분한다.

**중요:** `requestPluginProfile`은 descriptor 세 필드를 검증하지만 전달한 RPC params의 `profile`을 자동으로 `targetProfile`로 치환하지 않는다. `requestGatewayForAgent(route.connectionId, route.profile, method, params, …)`를 호출한다(`apps/desktop/src/sdk/index.ts:277-290`). 따라서 프로젝트 읽기는 다음처럼 backend profile을 명시한다.

```js
await host.requestProfile(route, 'projects.tree', {
  profile: route.targetProfile, preview_limit: 3
})
await host.requestProfile(route, 'projects.project_sessions', {
  profile: route.targetProfile, project_id: projectId
})
```

`route.profile`을 `targetProfile`로 덮어쓴 새 descriptor를 만들지 않는다. 연결 선택자와 backend 요청 scope가 섞인다. 코어 session dispatcher의 별도 `routeParams`는 params에 profile이 있을 때 targetProfile로 바꾸지만, 그것은 SDK query의 동작과 다른 경로다(`apps/desktop/src/store/session-request-router.ts:90-96`, `:201-215`). 공유 primary 최적화도 자체 profile scope를 추가하므로 route 매핑 fixture가 필요하다(`apps/desktop/src/store/gateway.ts:1350-1375`).

## 프로젝트 payload와 “전체 목록”의 정확한 의미

근거: `tui_gateway/contracts/projects_pets.py:234-308`, `tui_gateway/methods_config.py:130-166`.

```ts
// projects.tree params: { profile?, preview_limit?, session_limit? }
{ projects: ProjectNode[], active_id: string | null,
  scoped_session_ids: string[] }

// projects.project_sessions params: { profile?, project_id, session_limit? }
{ project: ProjectNode | null }

// 주요 ProjectNode 필드 (선택/default 세부는 위 contract 참조)
{ id, label, path, color, icon, isAuto, isNoProject,
  sessionCount, lastActive, totalTokens, totalCostUsd,
  repos: [{ id, label, path, sessionCount,
    groups: [{ id, label, path, isMain, isKanban, isGit, sessions: SessionRow[] }] }],
  previewSessions: SessionRow[], sessionIds: string[] }
```

- lane children의 실제 필드는 `groups`, lane rows는 `sessions`다. 응답 root에 flat `sessions`가 있다고 가정하지 않는다.
- overview의 lane에는 session rows가 없고 preview만 소수다. 펼치기/Show all은 **동일 route**의 `projects.project_sessions`로 hydrate한다. `project: null`은 읽기 오류와 다르며 discovery-only/빈 프로젝트의 경우도 구분해야 한다.
- `sessionIds`, `scoped_session_ids`는 membership/제외용 ID 집합이지 렌더 가능한 전체 row가 아니다. counts를 preview 길이로 대체하지 않는다.
- “Fully hydrated”는 **서버가 선택한 세션 집합에 대한** lane hydration이다. 기본 tree `session_limit`은 2000, drill-in은 5000이다. `methods_projects._project_tree_inputs`는 offset 0, 최소 메시지 1, children 제외, archived 제외 및 excluded sources filter를 적용한다. 따라서 모든 과거·숨김·빈 세션·archive를 빠짐없이 제공하는 무제한 페이지 API라고 표기하면 안 된다. `tui_gateway/methods_config.py:146-165`; `tui_gateway/methods_projects.py:339-350`.
- SessionRow는 durable `id`, lineage 필드, title/preview, last_active, cwd/git 정보 등을 가진 최소 projection이다. runtime ID가 아니다. backend가 profile을 stamp하지만 connection ID는 이 플러그인이 request descriptor와 함께 별도 보존해야 한다. `tui_gateway/methods_projects.py:322-336`; `tui_gateway/methods_config.py:130-135`.
- 기존 프로젝트 store는 전경 profile과 전역 generation을 따른다. 플러그인에서 직접 import하거나 전역 전환하며 재사용하지 않는다. 공개 RPC 계약만 재사용하고 route별 query/cache 및 늦은 결과 무효화 generation을 둔다. `apps/desktop/src/store/projects.ts:519-620`, `:653-695`.

## 세션 열기·owner 전달·동일 ID 경계

공개 `host.openSession(storedSessionId, options): Promise<void>`는 `route`, `profile`, `intent`, `awaitHydration`, `expectHistory`, `forceResume`, `hydrationTimeoutMs`, `keepAllProfilesScope`, `refreshInPlace`, `workspaceMode` 등을 받는다. `intent`에는 `in-place | main | stack | tab | window`가 있다. 이 메서드는 split 방향/anchor를 받는 공개 API는 아니다. 실제 split은 기존 탭 드래그/UI를 재사용해야 하며 임의 `intent: 'split'`을 만들지 않는다. `apps/desktop/src/sdk/index.ts:385-424`, `:958`; `apps/desktop/src/app/open-session.ts:33`.

### 일반 Sessions owner seam — 소스상 확인

1. 명시 `route`가 있으면 owner hint를 설정하고 해당 `(connectionId, profile)`을 전경 변경 없이 dial한다. `apps/desktop/src/sdk/index.ts:964-991`, `:1031-1046`, `:1064-1080`.
2. 그러나 core opener에 `ownerRoute`를 전달하는 분기는 `workspaceMode === 'bots'`뿐이다. 일반 Sessions에서는 `openSession(id, navigate, intent)`만 호출한다. `apps/desktop/src/sdk/index.ts:1161-1169`.
3. core도 새 Sessions tab에 scope를 넘기지 않고 `openSessionTile(id, 'center')`를 호출한다. `apps/desktop/src/app/open-session.ts:128-129`, `:197-201`.
4. tile 내부는 ownerRoute를 저장할 수 있고 그 route가 socket pin 및 재연결 격리의 근거가 된다. 이미 route를 가진 Sessions tile 재열기는 owner를 보존한다. 하지만 이는 새 SDK Sessions tab에서 route가 직접 전달된다는 증거가 아니다. `apps/desktop/src/store/session-states.ts:2043-2078`, `:2408-2418`, `:2123-2160`.

**판정:** “공개 옵션 route 존재 = 새 일반 탭의 ownerRoute까지 end-to-end 보장”은 성립하지 않는다. hint·row·event owner로 나중에 해석될 수 있으므로 모든 cross-source open이 반드시 실패한다고도 단정하지 않는다. 플러그인은 exact route를 전달하고 충돌을 fail closed하되, 새 일반 tab에 owner가 붙어 전경 변화·재연결 중에도 보존되는지는 별도 통합 검증 gate로 남긴다.

### 동일 stored ID — plugin key와 core tab key는 다르다

- `openSessionTile`의 기존 tile lookup은 stored ID 하나, 중복 방지는 lineage aliases와 stored ID로 한다. `apps/desktop/src/store/session-states.ts:2365-2366`, `:2391-2401`.
- pane ID도 `${TILE_PANE_PREFIX}${storedSessionId}`이며 `focusOpenSession`은 owner 비교 없이 aliases로 기존 tile을 찾는다. `apps/desktop/src/store/session-states.ts:2440`, `:2496-2509`.
- SDK focused owner는 여러 owner hints가 있으면 null이다. 임의 첫 owner를 고르는 계약이 아니다. `apps/desktop/src/sdk/index.ts:164-202`.
- 따라서 `[connection, profile, storedId]` 플러그인 키로 트리는 안전하게 분리할 수 있어도 같은 stored ID를 두 코어 탭으로 동시에 연다고 보장할 수 없다. UUID처럼 보인다는 이유로 충돌 테스트를 생략하지 않는다. lineage ID 충돌도 같은 범주다.
- 안전한 제한: 인벤토리/열린 작업에서 소유권이 모호한 stored ID의 open을 차단하고 이유와 source를 표시한다. 현재 불러온 preview만 충돌 검사했다면 미수집/이미 열린 세션까지 안전하다고 주장하지 않는다. SDK가 전역 opened-owner inventory를 보장하지 않는 부분은 제품 제한으로 남긴다.

## 입력·스트림·승인·재연결 소유권

### 코어가 이미 제공하는 보호

- gateway pool scope는 `(connectionId, profile)`이고 secondary event에는 closure의 connection/profile을 stamp한다. server request도 같은 owner 정보를 전달한다. `apps/desktop/src/store/gateway.ts:1330-1351`, `:1090-1131`, `:370-375`.
- session RPC는 focused tile이 아니라 요청 `session_id`의 owner로 dispatch한다. runtime→stored 변환, tile route, runtime event owner, hint/row 등을 해석하고 unresolved이면 multi-source에서 명시적 오류로 닫는다. `apps/desktop/src/app/contrib/session-rpc-dispatcher.ts:15-32`, `:64-111`.
- live approval 응답은 원래 request의 `respond` closure로 그 socket에 돌려보낸다. 재연결 재전달은 같은 ID의 entry를 갱신한다. live request가 없으면 `approval.respond`가 session owner 경로를 사용한다. `apps/desktop/src/store/server-requests.ts:3-37`; `apps/desktop/src/store/prompts.ts:363-405`.

이 보호들을 우회하는 플러그인 전용 send/approval 기능은 이번 설계에 필요 없다. 이벤트 갱신은 source-qualified key로 목록만 invalidate하고, event의 bare session ID만으로 다른 머신 row를 업데이트하지 않는다. background 결과는 navigation/focus를 바꾸지 않아야 한다.

### 남는 경계와 확인 항목

- 같은 stored/runtime ID가 서로 다른 source에서 동시에 나타날 때, 코어 탭 identity와 전역 maps의 모든 소비자가 분리된다는 증거는 없다. 특히 live server request map도 `request.id` 단일 키다(`apps/desktop/src/store/server-requests.ts:16-19`). 동일 request ID까지 충돌하는 fixture는 추가 스트레스 검증 항목이지 실제 오라우팅이 발생했다는 런타임 관측이 아니다.
- `retainProfile(route)`는 다중 session-RPC sequence 동안 lease를 유지하고 finally에서 release하는 공개 API다. 단일 프로젝트 read마다 무조건 영구 retain할 필요는 없다. `retainProfileSocket`은 별도 API이며 local route는 idle reap을 위해 exempt다. `apps/desktop/src/sdk/index.ts:1522-1557`.
- route별 요청 lease는 호출 종료 후 해제될 수 있다. 요청 성공이 runtime/socket의 영구 생존을 뜻하지 않는다. `apps/desktop/src/store/gateway.ts:1394-1418`.
- 재연결은 해당 owner route의 runtime binding만 떼고 stored row로 resume하는 모델이다. 다른 gateway의 healthy tile/draft가 영향받지 않아야 한다. ownerRoute가 없는 tile은 같은 보장을 가정할 수 없다. `apps/desktop/src/store/session-states.ts:2083-2198`.
- connection 삭제는 secondary를 즉시 dispose한다. material edit는 active request/relay/foreground lease가 drain될 때까지 기존 socket을 유지한 뒤 redial할 수 있다. stale descriptor를 자동 재사용하지 말고 route inventory를 다시 받아야 한다. `apps/desktop/src/store/gateway.ts:2563-2616`; SDK route 재확인 비교는 `apps/desktop/src/sdk/index.ts:320-337`.
- 공식 SDK 문서는 background reconnect backoff와 사용자 foreground priority를 구분한다. 자동 query는 background로 두고 명시적인 재시도/열기만 foreground priority로 요청한다. 401/403 재인증, transient network failure, missing RPC capability를 서로 다른 상태로 노출한다.
- Desktop 재연결·창 종료·gateway 재시작·작업 재개는 다른 사건이다. 자동 failover, 다른 머신으로 작업 이동, 비밀/환경 공유를 보장하지 않는다.

## 구현 검증 체크리스트와 승인 gate

### 로컬 계약·fixture 검증 — 이번 개발 범위

- [ ] 실제 SDK shape: routes와 connections는 배열, agents는 `{ agents, sources }`; empty/partial/reject/missing API를 각각 검사.
- [ ] 같은 profile 이름, connection label, 프로젝트 ID/경로, stored ID/lineage ID를 여러 source에 넣어 query key·row key가 분리되는지 검사.
- [ ] `profile !== targetProfile` fixture에서 route 선택에는 profile, 프로젝트 RPC params에는 targetProfile이 유지되는지 검사.
- [ ] query는 `requestProfile`만 사용하고 inventory loop에서 `ensureAgent`, `host.request`, private bridge를 호출하지 않음.
- [ ] tree preview를 전체 목록으로 표시하지 않고 route별 hydrate; repo.groups[].sessions 구조, `project: null`, session_limit·필터 한계 설명.
- [ ] 느린 이전 응답/두 row 동시 펼치기/한 source 실패가 다른 source cache를 덮거나 숨기지 않음. 삭제·변경된 route의 오래된 응답 폐기.
- [ ] offline·reauth·unsupported·loading·empty·stale·error를 구분하며 목록 갱신이 열려 있는 세션이나 입력을 바꾸지 않음.
- [ ] open 호출은 원 descriptor를 전달. 동일 stored ID 및 소유권 모호함은 차단. 차단의 인벤토리 범위와 아직 보장하지 못하는 열린 탭 충돌을 설명.
- [ ] opt-in 유지, 허용된 SDK/React imports만 사용, disable/dispose 시 구독·query·lease 정리. 실제 설치 없이 로컬 tests 수행.

### 격리 Desktop / 실제 gateway — 별도 실행 승인 필요

- [ ] 서로 다른 ID의 A/B 일반 Sessions 탭·split에서 owner route가 새 tile과 pin에 보존됨을 실제 확인. plain click/stack/tab/window 각각 검사.
- [ ] 동일 stored ID와 lineage ID의 A/B는 다른 transcript를 잘못 front하지 않고 제한 안내. 완전 동시 열기를 주장하려면 app seam 변경 승인 후 실제 회귀 필요.
- [ ] A draft·focus·scroll 유지한 채 B 연결 끊김/재연결, B 프로필 rename/delete, connection edit/remove; A runtime·draft가 재바인딩/삭제되지 않음.
- [ ] 비전경 A로 입력, A/B 동시 스트림, 승인 prompt 및 재연결 후 open_requests 재전달이 owner backend로만 이동. 대상/내용에 대한 명시적 승인 없이 실제 메시지·승인은 실행하지 않음.
- [ ] 실제 설치 버전은 승인 후 공개 stamp로 재확인. 이 문서의 exact ref와 다르면 다시 source contract를 검토.

## 재실행 명령과 금지 경계

아래 명령은 읽기 전용 또는 로컬 문서/플러그인 검사다. 실제 실행 결과와 실행 제안은 인계 보고서에서 구분한다.

```sh
# exact build 소스만; checkout/reset/fetch/worktree 생성 없이 읽는다.
git -C /Users/kether/.hermes/hermes-agent cat-file -t e06df9c2eae6901f4c88f464e0ae6e753c0428b8
git -C /Users/kether/.hermes/hermes-agent show e06df9c2eae6901f4c88f464e0ae6e753c0428b8:apps/desktop/src/sdk/index.ts
git -C /Users/kether/.hermes/hermes-agent show e06df9c2eae6901f4c88f464e0ae6e753c0428b8:apps/desktop/src/app/open-session.ts
git -C /Users/kether/.hermes/hermes-agent show e06df9c2eae6901f4c88f464e0ae6e753c0428b8:apps/desktop/src/store/session-states.ts
git -C /Users/kether/.hermes/hermes-agent show e06df9c2eae6901f4c88f464e0ae6e753c0428b8:tui_gateway/contracts/projects_pets.py
curl -fLsS https://hermes-agent.nousresearch.com/docs/user-guide/multi-connection-desktop
curl -fLsS https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk

# 아래는 feature worktree에서 수행. tests는 구현 완료 후 검증자가 수행한다.
cd /Users/kether/projects/.worktrees/kether-stack/feature/multi-machine-workspace
git status --short --branch
git diff --check -- hermes/plugins/multi-machine-workspace/docs/
npm --prefix hermes/plugins/multi-machine-workspace run check
npm --prefix hermes/plugins/multi-machine-workspace test
```

이 독립 검토자의 쓰기 범위는 위 worktree의 `hermes/plugins/multi-machine-workspace/docs/`와 지정된 DAG handoff 보고서뿐이다. 코드·테스트·README·AGENTS·Home 원본은 수정하지 않는다. commit/push/merge, 앱 파일 접근/설치/재시작, CDP 활성화를 위한 종료, 실사용 plugin root 복사, 원격 Test/SSH/agent 실행, 다른 프로필/비밀 읽기·변경, 실제 메시지/승인은 금지다. connection **Test도** SSH에서는 원격 runtime을 시작할 수 있으므로 읽기 전용이라고 간주하지 않는다(공식 multi-connection 문서 “The gateway registry”).

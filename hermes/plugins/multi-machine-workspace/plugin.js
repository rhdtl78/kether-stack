import { host, useQuery, queryClient, Button } from '@hermes/plugin-sdk'
import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

export const QUERY_ROOT = ['multi-machine-workspace', 'v1']
export const LIMITS = Object.freeze({ tree: 2000, project: 5000, preview: 3 })
const text = value => typeof value === 'string' && value.trim().length > 0
const fail = message => { throw new Error(message) }

// Address metadata, NOT an alias/owner ledger. Both overview and hydrated data
// can outlive navigation inventory and project membership. Enumerate every
// generated address, reread actual cache data on open, and retain no old aliases.
// Empty/evicted addresses add no evidence; disposal removes cache and addresses.
const queryResources = new Map()

// JSON tuples, never delimiter-joined ids: project paths and profile labels may
// themselves contain any separator. targetProfile is part of cache ownership.
export function scopeKey(route) {
  return [route.connectionId, route.mode, route.profile, route.targetProfile]
}
export function resourceKey(route, projectId) {
  const scope = scopeKey(route)
  const tree = projectId === undefined
  const queryKey = [...QUERY_ROOT, ...scope, tree ? 'tree' : 'project', ...(tree ? [] : [projectId])]
  queryResources.set(JSON.stringify(queryKey), {
    ownerKey: JSON.stringify(scope), tree, queryKey: Object.freeze([...queryKey])
  })
  return queryKey
}
export function normalizeRoutes(payload) {
  if (!Array.isArray(payload)) fail('잘못된 profileRoutes 응답: 배열이 아닙니다.')
  const unique = new Map()
  const transport = new Map()
  for (const route of payload) {
    if (!route || !['local', 'remote'].includes(route.mode) || !['connectionId', 'profile', 'targetProfile'].every(k => text(route[k]))) {
      fail('불완전한 route descriptor입니다. 프로필 이름만으로 대체하지 않습니다.')
    }
    const key = JSON.stringify(scopeKey(route))
    const dialKey = JSON.stringify([route.connectionId, route.profile])
    if (transport.has(dialKey) && transport.get(dialKey) !== key) {
      fail(`모호한 route: ${route.connectionId} / ${route.profile}. 같은 연결·프로필의 mode/targetProfile이 다릅니다.`)
    }
    transport.set(dialKey, key)
    if (!unique.has(key)) unique.set(key, Object.freeze({ ...route }))
  }
  return [...unique.values()]
}

export function classifyError(error) {
  const message = error?.message ?? String(error)
  const code = error?.code ?? error?.status
  if (code === -32601 || /method (?:not found|.*not supported)|unknown (?:rpc )?method|routing unavailable|SDK.*미지원/i.test(message)) return 'unsupported'
  if ([401, 403].includes(code) || /unauthorized|authentication required|reauth|sign in|token expired/i.test(message)) return 'auth'
  if (['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code) || /not connected|connection closed|connection refused|gateway unavailable|offline|reconnecting/i.test(message)) return 'offline'
  return 'error'
}
const abortCheck = signal => {
  if (signal?.aborted) throw new DOMException('Superseded query', 'AbortError')
}
function validateRow(row, route) {
  if (!row || !text(row.id)) fail('세션 응답에 유효한 id가 없습니다.')
  if (row.connection_id && row.connection_id !== route.connectionId) fail('세션 응답의 연결 소유자가 route와 다릅니다.')
  if (row.profile && row.profile !== route.targetProfile) fail('세션 응답의 backend profile이 targetProfile과 다릅니다.')
  return { ...row, connection_id: route.connectionId, profile: row.profile || route.targetProfile }
}
export function parseProject(project, route) {
  if (!project || !text(project.id) || !Array.isArray(project.repos)) fail('잘못된 project tree 응답입니다.')
  return {
    ...project,
    previewSessions: (project.previewSessions ?? []).map(row => validateRow(row, route)),
    repos: project.repos.map(repo => {
      if (!Array.isArray(repo.groups)) fail('잘못된 repo groups 응답입니다.')
      return { ...repo, groups: repo.groups.map(group => {
        if (!Array.isArray(group.sessions)) fail('잘못된 lane sessions 응답입니다.')
        return { ...group, sessions: group.sessions.map(row => validateRow(row, route)) }
      }) }
    })
  }
}
export function rowsOf(project) {
  return project.repos.flatMap(repo => repo.groups.flatMap(group => group.sessions))
}
export function aliasesOf(row) {
  return [...new Set([row.id, row._lineage_root_id, ...(row._lineage_ids ?? [])].filter(text))]
}
export function projectAliases(project) {
  return [...new Set([...(project.sessionIds ?? []), ...project.previewSessions.flatMap(aliasesOf), ...rowsOf(project).flatMap(aliasesOf)].filter(text))]
}

export function inventoryQuery(api = host) {
  return {
    queryKey: [...QUERY_ROOT, 'routes'], staleTime: 30_000, gcTime: 300_000, retry: false,
    queryFn: async ({ signal }) => {
      if (typeof api.profileRoutes !== 'function') fail('SDK profileRoutes 미지원')
      const routes = await api.profileRoutes()
      abortCheck(signal)
      return normalizeRoutes(routes)
    }
  }
}
export function projectQuery(route, projectId, api = host) {
  const owner = Object.freeze({ ...route })
  const tree = projectId === undefined
  return {
    queryKey: resourceKey(owner, projectId), staleTime: 30_000, gcTime: 300_000,
    retry: false,
    queryFn: async ({ signal }) => {
      if (typeof api.requestProfile !== 'function') fail('SDK requestProfile 미지원')
      abortCheck(signal)
      const payload = await api.requestProfile(owner,
        tree ? 'projects.tree' : 'projects.project_sessions',
        tree ? { profile: owner.targetProfile, preview_limit: LIMITS.preview, session_limit: LIMITS.tree }
          : { profile: owner.targetProfile, project_id: projectId, session_limit: LIMITS.project },
        60_000)
      // requestProfile has no AbortSignal door. React Query cancels publication;
      // also reject here so a late RPC cannot be accepted after route/unmount.
      abortCheck(signal)
      if (tree) {
        if (!payload || !Array.isArray(payload.projects)) fail('잘못된 projects.tree 응답입니다.')
        return { owner, projects: payload.projects.map(p => parseProject(p, owner)) }
      }
      if (!payload || !Object.hasOwn(payload, 'project')) fail('잘못된 projects.project_sessions 응답입니다.')
      if (payload.project !== null && payload.project.id !== projectId) fail('요청한 project id와 응답이 다릅니다.')
      return { owner, project: payload.project === null ? null : parseProject(payload.project, owner) }
    }
  }
}

// Only a local refusal gate, NOT a replacement for core's owner-qualified pane
// identity. Public SDK exposes no complete open-tab owner inventory.
export function createOpenGate(api = host, client = queryClient) {
  const claims = new Map()
  let opening = false
  let disposed = false
  return {
    dispose() { disposed = true },
    async open(route, row) {
      if (disposed) fail('플러그인이 종료되었습니다.')
      if (typeof api.openSession !== 'function') fail('SDK openSession 미지원')
      if (opening) fail('이전 세션 열기가 진행 중입니다. 완료 후 다시 선택하세요.')
      const inventory = client.getQueryData([...QUERY_ROOT, 'routes'])
      const ownerKey = JSON.stringify(scopeKey(route))
      if (!inventory?.some(r => JSON.stringify(scopeKey(r)) === ownerKey)) fail('등록 route가 바뀌었습니다. 머신 목록을 새로고침하세요.')
      validateRow(row, route)
      const aliases = aliasesOf(row)
      const owners = new Map()
      const add = (id, key) => {
        if (!owners.has(id)) owners.set(id, new Set())
        owners.get(id).add(key)
      }
      // Inventory authorizes only the selected route above. It cannot revoke
      // retained evidence belonging to omitted/changed owners. Query addresses
      // carry the full original owner tuple; never relabel them from inventory.
      for (const resource of queryResources.values()) {
        const data = client.getQueryData(resource.queryKey)
        const projects = resource.tree ? data?.projects ?? [] : data?.project ? [data.project] : []
        for (const project of projects) for (const id of projectAliases(project)) add(id, resource.ownerKey)
      }
      for (const [id, key] of claims) add(id, key)
      const focused = api.state?.focusedStoredSessionId?.get?.()
      if (aliases.includes(focused)) {
        const owner = api.state?.focusedSessionOwner?.get?.()
        if (!owner || owner.connectionId !== route.connectionId || owner.profile !== route.profile) {
          fail('동일 stored id의 현재 탭 소유자가 다르거나 불명확합니다. 충돌 위험으로 열기를 거부했습니다.')
        }
      }
      for (const id of aliases) {
        if ([...(owners.get(id) ?? [])].some(key => key !== ownerKey)) {
          fail(`동일 stored id (${id})가 다른 route에도 있습니다. 앱 pane 충돌 위험으로 열기를 거부했습니다.`)
        }
      }
      // Keep claims even after a failed open: the SDK may have partially opened
      // a tab before hydration fails. Never release authority on a mere timeout.
      for (const id of aliases) claims.set(id, ownerKey)
      opening = true
      try {
        await api.openSession(row.id, {
          route: { ...route }, profile: route.profile, intent: 'tab',
          workspaceMode: 'sessions', keepAllProfilesScope: true,
          awaitHydration: true, expectHistory: true, hydrationTimeoutMs: 20_000
        })
      } finally { opening = false }
    }
  }
}

const labels = { unsupported: '미지원', auth: '재인증 필요', offline: '오프라인 / 재연결 중', error: '조회 실패' }
const muted = { color: 'var(--ui-text-tertiary)' }
const action = (label, onClick, disabled = false) => jsx(Button, { type: 'button', size: 'sm', variant: 'ghost', disabled, onClick, children: label })
function QueryStatus({ query, empty, emptyLabel }) {
  if (query.isPending) return jsx('p', { role: 'status', children: '불러오는 중…' })
  if (query.isError) return jsxs('div', { role: 'alert', children: [
    jsx('p', { children: `${labels[classifyError(query.error)]}: ${query.error?.message ?? String(query.error)}` }),
    query.data ? jsx('p', { children: '아래 목록은 이전 캐시입니다. 현재 연결 상태를 보장하지 않습니다.' }) : null,
    action('다시 조회', () => void query.refetch(), query.isFetching)
  ] })
  if (empty) return jsx('p', { style: muted, children: emptyLabel })
  return query.isFetching ? jsx('p', { role: 'status', children: '새로고침 중…' }) : null
}
function SessionRow({ route, row, gate }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  return jsxs('li', { children: [
    action(row.title || row.preview || row.id, async () => {
      setBusy(true)
      setMessage('')
      try { await gate.open(route, row) }
      catch (error) { setMessage(error.message) }
      finally { setBusy(false) }
    }, busy),
    message ? jsx('p', { role: 'alert', children: message }) : null
  ] })
}
function ProjectRows({ route, project, gate }) {
  const query = useQuery(projectQuery(route, project.id))
  const loaded = query.data?.project
  const rows = loaded ? [...new Map(rowsOf(loaded).map(row => [row.id, row])).values()] : []
  return jsxs('div', { children: [
    jsx(QueryStatus, { query, empty: !rows.length, emptyLabel: loaded ? '조회 창 안에 세션이 없습니다.' : '프로젝트가 사라졌거나 조회 창 밖에 있습니다.' }),
    jsx('p', { style: muted, children: `세션 ${rows.length}개 · backend 최근 ${LIMITS.project}개 입력 창, 전체 이력 보장 아님` }),
    jsx('ul', { children: rows.map(row => jsx(SessionRow, { route, row, gate }, JSON.stringify([scopeKey(route), project.id, row.id]))) }),
    action('세션 새로고침', () => void query.refetch(), query.isFetching)
  ] })
}
function ProjectNode({ route, project, gate }) {
  const [expanded, setExpanded] = useState(false)
  return jsxs('li', { children: [
    jsx('button', { type: 'button', 'aria-expanded': expanded,
      onClick: () => setExpanded(value => !value),
      className: 'w-full py-1 text-left',
      children: `${expanded ? '▾' : '▸'} ${project.label || project.id} · ${route.profile} → ${route.targetProfile} · ${project.sessionCount ?? '?'} (조회 창)` }),
    expanded ? jsx(ProjectRows, { route, project, gate }) : null
  ] })
}
function RouteTree({ route, gate }) {
  const query = useQuery(projectQuery(route))
  const projects = query.data?.projects ?? []
  return jsxs('section', { 'aria-label': `${route.profile} → ${route.targetProfile}`, children: [
    jsx('p', { style: muted, children: `${route.profile} → ${route.targetProfile}` }),
    jsx(QueryStatus, { query, empty: !projects.length, emptyLabel: '조회 창 안에 프로젝트가 없습니다.' }),
    jsx('ul', { children: projects.map(project => jsx(ProjectNode, { route, project, gate }, JSON.stringify([scopeKey(route), project.id]))) }),
    action('프로젝트 새로고침', () => void query.refetch(), query.isFetching)
  ] })
}
function MachineNode({ connectionId, routes, gate }) {
  const [expanded, setExpanded] = useState(true)
  return jsxs('section', { children: [
    jsx('button', { type: 'button', 'aria-expanded': expanded, onClick: () => setExpanded(value => !value),
      className: 'w-full py-1 text-left font-medium', children: `${expanded ? '▾' : '▸'} ${connectionId}` }),
    // Keep mounted when collapsed: a selection elsewhere never destroys this
    // branch's expansion state or its independent in-flight query.
    jsx('div', { hidden: !expanded, children: routes.map(route => jsx(RouteTree, { route, gate }, JSON.stringify(scopeKey(route)))) })
  ] })
}
export function WorkspacePane({ gate }) {
  const query = useQuery(inventoryQuery())
  const machines = new Map()
  for (const route of query.data ?? []) {
    if (!machines.has(route.connectionId)) machines.set(route.connectionId, [])
    machines.get(route.connectionId).push(route)
  }
  return jsxs('div', { className: 'h-full overflow-auto p-3 text-sm', children: [
    jsx('h2', { children: '머신 · 프로젝트 · 세션' }),
    jsx('p', { style: muted, children: '조회 전용 탐색 · 선택 시 기존 탭/분할 재사용, 없으면 탭으로 열기' }),
    jsx('p', { role: 'note', style: muted, children: '실험적: Sessions ownerRoute 전달에 SDK 한계가 있습니다. 알려진 동일 id 충돌만 거부하며, 숨겨진 탭·조회 창 밖·실제 멀티 머신 안전성을 보장하지 않습니다.' }),
    jsx('p', { style: muted, children: `프로젝트 overview: 최근 ${LIMITS.tree}개 세션 입력 / preview ${LIMITS.preview}개. 세션은 펼칠 때 별도 조회합니다. cursor/다음 페이지 API 없음.` }),
    action('머신 목록 새로고침', () => void query.refetch(), query.isFetching),
    jsx(QueryStatus, { query, empty: !machines.size, emptyLabel: '공개 SDK가 반환한 등록 route가 없습니다. 미응답 머신은 SDK 목록에서 누락될 수 있습니다.' }),
    [...machines].map(([connectionId, routes]) => jsx(MachineNode, { connectionId, routes, gate }, connectionId))
  ] })
}

export default {
  id: 'multi-machine-workspace', name: 'Multi-machine Workspace', defaultEnabled: false,
  register(ctx) {
    const gate = createOpenGate()
    ctx.onDispose(() => {
      gate.dispose()
      void queryClient.cancelQueries({ queryKey: QUERY_ROOT })
      queryClient.removeQueries({ queryKey: QUERY_ROOT })
      queryResources.clear()
    })
    ctx.register({ id: 'workspace', area: 'panes', title: 'Multi-machine Workspace',
      data: { placement: 'left', width: '320px' }, render: () => jsx(WorkspacePane, { gate }) })
  }
}

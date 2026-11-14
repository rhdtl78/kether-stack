import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../plugin.js', import.meta.url), 'utf8')
const a = Object.freeze({ connectionId: 'a', mode: 'remote', profile: 'desktop', targetProfile: 'backend', primary: true })
const b = Object.freeze({ ...a, connectionId: 'b' })
const row = (id = 's', extra = {}) => ({ id, title: id, profile: 'backend', ...extra })
const project = (id = 'p', rows = [], extra = {}) => ({ id, label: id, sessionCount: rows.length, previewSessions: [], sessionIds: rows.map(r => r.id), repos: [{ id: 'repo', groups: [{ id: 'lane', sessions: rows }] }], ...extra })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const tick = () => new Promise(resolve => setImmediate(resolve))

// Public SDK/context contract fixture only. This tiny cache deliberately models
// key ownership and cancellation; it is NOT Hermes Desktop or TanStack Query.
async function load(overrides = {}) {
  const calls = []
  const cache = new Map()
  const states = new Map()
  const hooks = new Map()
  let currentPath, slot
  const key = value => JSON.stringify(value)
  const api = {
    profileRoutes: async () => [a, b],
    requestProfile: async (route, method, params, timeout) => {
      calls.push({ route, method, params, timeout })
      return method === 'projects.tree' ? { projects: [project()] } : { project: project(params.project_id, [row(route.connectionId + '-s')]) }
    },
    openSession: async (...args) => { calls.push({ open: args }) },
    state: { focusedStoredSessionId: { get: () => null }, focusedSessionOwner: { get: () => null } },
    ...overrides
  }
  function start(options, entry) {
    entry.abort?.abort()
    const abort = new AbortController()
    entry.abort = abort
    entry.isFetching = true
    const promise = options.queryFn({ signal: abort.signal })
    entry.promise = Promise.resolve(promise).then(data => {
      if (entry.abort !== abort || abort.signal.aborted) return
      cache.set(key(options.queryKey), data)
      Object.assign(entry, { data, isPending: false, isError: false, isFetching: false, error: null })
    }, error => {
      if (entry.abort !== abort || abort.signal.aborted) return
      Object.assign(entry, { error, isPending: false, isError: true, isFetching: false })
    })
    return entry.promise
  }
  const client = {
    getQueryData: k => cache.get(key(k)),
    setQueryData: (k, value) => cache.set(key(k), value),
    cancelQueries: () => { for (const entry of states.values()) entry.abort.abort() },
    removeQueries: ({ queryKey }) => {
      for (const store of [states, cache]) for (const k of store.keys()) {
        const parts = JSON.parse(k)
        if (queryKey.every((part, i) => part === parts[i])) store.delete(k)
      }
    }
  }
  function useQuery(options) {
    const k = key(options.queryKey)
    if (!states.has(k)) {
      const entry = { isPending: true, isFetching: false, isError: false }
      states.set(k, entry)
      entry.refetch = () => start(options, entry)
      start(options, entry)
    }
    return states.get(k)
  }
  function useState(initial) {
    const k = currentPath + ':' + slot++
    if (!hooks.has(k)) hooks.set(k, typeof initial === 'function' ? initial() : initial)
    return [hooks.get(k), next => hooks.set(k, typeof next === 'function' ? next(hooks.get(k)) : next)]
  }
  const element = (type, props, key) => ({ type, props: props ?? {}, key })
  const sdk = { host: api, queryClient: client, useQuery, Button: props => element('button', props) }
  const modules = {
    '@hermes/plugin-sdk': sdk,
    react: { useState },
    'react/jsx-runtime': { jsx: element, jsxs: element }
  }
  const context = vm.createContext({ AbortController, DOMException, console })
  const entry = new vm.SourceTextModule(source, { context, identifier: 'plugin.js' })
  await entry.link(specifier => {
    assert.ok(Object.hasOwn(modules, specifier), `unsupported import: ${specifier}`)
    const values = modules[specifier]
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value)
    }, { context })
  })
  await entry.evaluate()
  const exports = entry.namespace
  let renderRoot
  function walk(value, path = 'root') {
    if (value === null || value === undefined || value === false) return []
    if (Array.isArray(value)) return value.flatMap((child, i) => walk(child, path + '/' + (child?.key ?? i)))
    if (typeof value !== 'object') return [value]
    if (typeof value.type === 'function') {
      currentPath = path + '/' + value.type.name
      slot = 0
      return walk(value.type(value.props), currentPath)
    }
    return [{ ...value, children: walk(value.props.children, path + '/children') }]
  }
  const flat = value => value.flatMap(node => typeof node === 'object' ? [node, ...flat(node.children)] : [node])
  let nodes = []
  return {
    exports, api, client, calls, states,
    mount() {
      const contributions = [], disposers = []
      exports.default.register({ register: c => contributions.push(c), onDispose: cb => disposers.push(cb) })
      renderRoot = contributions[0].render
      return { contributions, dispose: () => disposers.forEach(fn => fn()) }
    },
    render() { nodes = flat(walk(renderRoot())); return nodes },
    button(label) { return nodes.find(n => n?.type === 'button' && flat(n.children).filter(x => typeof x === 'string').join('').includes(label)) },
    output() { return nodes.filter(n => typeof n === 'string').join('\n') }
  }
}
const plain = value => JSON.parse(JSON.stringify(value))
function seed(h, routes = [a, b]) {
  h.client.setQueryData([...h.exports.QUERY_ROOT, 'routes'], h.exports.normalizeRoutes(routes))
}
function seedProject(h, route, p) {
  h.client.setQueryData(h.exports.resourceKey(route), { owner: route, projects: [h.exports.parseProject(p, route)] })
}

test('actual ESM entry is opt-in and registers a working pane with public context cleanup', async () => {
  const h = await load()
  const mounted = h.mount()
  assert.equal(h.exports.default.id, 'multi-machine-workspace')
  assert.equal(h.exports.default.defaultEnabled, false)
  assert.equal(mounted.contributions[0].area, 'panes')
  h.render()
  assert.match(h.output(), /불러오는 중/)
  await tick(); h.render(); await tick(); h.render()
  assert.match(h.output(), /a/)
  assert.match(h.output(), /b/)
  assert.equal(h.calls.length, 2)
  mounted.dispose()
  assert.equal(h.states.size, 0)
})

test('exact duplicate routes dedupe, but transport aliases with changed target/mode fail closed', async () => {
  const { exports: e } = await load()
  assert.equal(e.normalizeRoutes([a, { ...a }, b]).length, 2)
  assert.throws(() => e.normalizeRoutes([a, { ...a, targetProfile: 'other' }]), /모호한 route/)
  assert.throws(() => e.normalizeRoutes([{ ...a, connectionId: ' ' }]), /불완전한/)
  assert.notDeepEqual(plain(e.scopeKey(a)), plain(e.scopeKey(b)))
  assert.notDeepEqual(plain(e.resourceKey(a, 'x::y')), plain(e.resourceKey({ ...a, targetProfile: 'backend::x' }, 'y')))
})

test('route and backend profile are distinct: descriptors and params are preserved on both RPCs', async () => {
  const h = await load()
  const tree = await h.exports.projectQuery(a).queryFn({ signal: new AbortController().signal })
  await h.exports.projectQuery(a, 'p').queryFn({})
  assert.deepEqual(plain(h.calls[0]), { route: a, method: 'projects.tree', params: { profile: 'backend', preview_limit: 3, session_limit: 2000 }, timeout: 60000 })
  assert.deepEqual(plain(h.calls[1].params), { profile: 'backend', project_id: 'p', session_limit: 5000 })
  assert.equal(tree.projects.length, 1)
  assert.equal(tree.projects[0].repos[0].groups[0].sessions.length, 0)
})

test('same project/session ids stay in independent route caches; known collision is rejected', async () => {
  const h = await load()
  seed(h)
  seedProject(h, a, project('p', [row('same')]))
  seedProject(h, b, project('p', [row('same')]))
  assert.notDeepEqual(plain(h.exports.resourceKey(a, 'p')), plain(h.exports.resourceKey(b, 'p')))
  await assert.rejects(h.exports.createOpenGate(h.api, h.client).open(a, row('same')), /pane 衝突|pane 충돌/)
  assert.equal(h.calls.length, 0)
})

test('retained hydrated stored and lineage aliases refuse open after their project disappears', async t => {
  const cases = [
    { name: 'stored id', cached: row('same'), selected: row('same') },
    { name: 'lineage root', cached: row('rotated-b', { _lineage_root_id: 'root' }), selected: row('rotated-a', { _lineage_root_id: 'root' }) },
    { name: 'lineage ids', cached: row('rotated-b', { _lineage_ids: ['ancestor'] }), selected: row('ancestor') }
  ]
  for (const { name, cached, selected } of cases) await t.test(name, async () => {
    const h = await load()
    seed(h)
    seedProject(h, b, project('older-project'))
    const hydratedKey = h.exports.resourceKey(b, 'older-project')
    const hydrated = { owner: b, project: h.exports.parseProject(project('older-project', [cached]), b) }
    h.client.setQueryData(hydratedKey, hydrated)
    await assert.rejects(h.exports.createOpenGate(h.api, h.client).open(a, selected), /pane 충돌/)
    assert.equal(h.calls.length, 0)
    h.client.setQueryData(h.exports.resourceKey(b), { owner: b, projects: [] })
    assert.strictEqual(h.client.getQueryData(hydratedKey), hydrated)
    // A new gate cannot depend on a previous open attempt remembering aliases.
    const gate = h.exports.createOpenGate(h.api, h.client)
    await assert.rejects(gate.open(a, selected), /pane 충돌/)
    assert.equal(h.calls.length, 0)
    await gate.open(b, cached)
    assert.equal(h.calls.length, 1)
    assert.deepEqual(plain(h.calls[0].open[1].route), b)
  })
})

test('hydrated cache without overview is checked on first open; replacement, null and eviction release only cache evidence', async () => {
  const h = await load()
  seed(h)
  const e = h.exports
  const hydratedKey = e.resourceKey(b, 'older-project')
  const putRows = rows => h.client.setQueryData(hydratedKey, { owner: b, project: e.parseProject(project('older-project', rows), b) })
  putRows([row('same')])
  const gate = e.createOpenGate(h.api, h.client)
  await assert.rejects(gate.open(a, row('same')), /pane 충돌/)
  assert.equal(h.calls.length, 0)
  await gate.open(a, row('unrelated'))
  assert.equal(h.calls.length, 1)

  // Simulate a failed/stale refresh retaining old data, then a successful one.
  h.api.requestProfile = async () => { throw new Error('gateway connection closed') }
  await assert.rejects(e.projectQuery(b, 'older-project').queryFn({}), /connection closed/)
  await assert.rejects(gate.open(a, row('same')), /pane 충돌/)
  assert.equal(h.calls.length, 1)
  putRows([])
  await gate.open(a, row('same'))
  assert.equal(h.calls.length, 2)

  putRows([row('rotated', { _lineage_ids: ['ancestor'] })])
  await assert.rejects(gate.open(a, row('ancestor')), /pane 충돌/)
  h.client.setQueryData(hydratedKey, { owner: b, project: null })
  await gate.open(a, row('ancestor'))
  assert.equal(h.calls.length, 3)

  putRows([row('evicted')])
  await assert.rejects(gate.open(a, row('evicted')), /pane 충돌/)
  h.client.removeQueries({ queryKey: e.QUERY_ROOT })
  seed(h)
  await gate.open(a, row('evicted'))
  assert.deepEqual(h.calls.map(c => c.open[0]), ['unrelated', 'same', 'ancestor', 'evicted'])
  assert.ok(h.calls.every(c => c.open[1].route.connectionId === 'a'))
})

test('retained query lookup preserves full route tuple even for the same connection and project id', async () => {
  const h = await load()
  const otherProfile = { ...a, profile: 'other-desktop', targetProfile: 'other-backend' }
  seed(h, [a, otherProfile])
  const e = h.exports
  h.client.setQueryData(e.resourceKey(a, 'p'), { owner: a, project: e.parseProject(project('p', [row('local-only')]), a) })
  h.client.setQueryData(e.resourceKey(otherProfile, 'p'), { owner: otherProfile,
    project: e.parseProject(project('p', [row('shared', { profile: 'other-backend' })]), otherProfile) })
  const gate = e.createOpenGate(h.api, h.client)
  await assert.rejects(gate.open(a, row('shared')), /pane 충돌/)
  assert.equal(h.calls.length, 0)
  await gate.open(a, row('local-only'))
  await gate.open(otherProfile, row('shared', { profile: 'other-backend' }))
  assert.deepEqual(h.calls.map(c => plain(c.open[1].route)), [a, otherProfile])
})

// Exercise query creation and the real open gate; only cache/SDK are stand-ins.
// Overview-only cases deliberately never generate a hydrated query address.
const evidenceCases = [
  { name: 'overview membership', tree: true, alias: 'stored' },
  { name: 'overview preview root', tree: true, alias: 'root' },
  { name: 'overview preview lineage', tree: true, alias: 'lineage' },
  { name: 'hydrated stored', tree: false, alias: 'stored' },
  { name: 'hydrated root', tree: false, alias: 'root' },
  { name: 'hydrated lineage', tree: false, alias: 'lineage' }
]
function retain(h, route, kind, id = 'same') {
  const e = h.exports
  const cached = row(kind.alias === 'stored' ? id : 'rotated-' + id, {
    profile: route.targetProfile,
    ...(kind.alias === 'root' ? { _lineage_root_id: id } : {}),
    ...(kind.alias === 'lineage' ? { _lineage_ids: [id] } : {})
  })
  const p = e.parseProject(kind.tree
    ? project('p', [], { sessionIds: kind.alias === 'stored' ? [id] : [], previewSessions: kind.alias === 'stored' ? [] : [cached] })
    : project('p', [cached]), route)
  const key = e.projectQuery(route, kind.tree ? undefined : 'p').queryKey
  const data = kind.tree ? { owner: route, projects: [p] } : { owner: route, project: p }
  h.client.setQueryData(key, data)
  return { key, data, cached }
}

test('retained evidence is independent of navigation inventory across omission and owner tuple changes', async t => {
  const transitions = [
    { name: 'route omitted', routes: [a] },
    { name: 'profile changed', routes: [a, { ...b, profile: 'renamed-desktop' }] },
    { name: 'targetProfile changed', routes: [a, { ...b, targetProfile: 'renamed-backend' }] },
    { name: 'mode changed', routes: [a, { ...b, mode: 'local' }] }
  ]
  for (const kind of evidenceCases) for (const transition of transitions) {
    await t.test(`${kind.name} / ${transition.name}`, async () => {
      const h = await load()
      seed(h)
      const retained = retain(h, b, kind)
      seed(h, transition.routes)
      assert.strictEqual(h.client.getQueryData(retained.key), retained.data)
      // No earlier gate/claim observed this evidence; registry must cover it.
      const gate = h.exports.createOpenGate(h.api, h.client)
      await assert.rejects(gate.open(a, row('same')), /pane 충돌/)
      await assert.rejects(gate.open(b, retained.cached), /route가 바뀌/)
      assert.equal(h.calls.length, 0)
      await gate.open(a, row('unrelated'))
      assert.deepEqual(h.calls.map(c => plain(c.open[1].route)), [a])
      const successor = transition.routes[1]
      if (successor) {
        // A descriptor replacement must not relabel retained old-owner data.
        await assert.rejects(gate.open(successor, row('same', { profile: successor.targetProfile })), /pane 충돌/)
        await gate.open(successor, row('successor-only', { profile: successor.targetProfile }))
        assert.deepEqual(plain(h.calls[1].open[1].route), successor)
      }
    })
  }
})

test('inventory refresh failure retains cache evidence and still permits noncolliding registered navigation', async () => {
  const h = await load()
  h.mount(); h.render(); await tick(); h.render(); await tick(); h.render()
  const e = h.exports
  const overview = retain(h, b, evidenceCases[1], 'overview-root')
  const hydrated = retain(h, b, evidenceCases[5], 'hydrated-lineage')
  // A successful partial list followed by failure: only A remains navigable.
  h.api.profileRoutes = async () => [a]
  const inventory = h.states.get(JSON.stringify([...e.QUERY_ROOT, 'routes']))
  await inventory.refetch()
  h.api.profileRoutes = async () => { throw new Error('gateway connection closed') }
  await inventory.refetch()
  assert.equal(inventory.isError, true)
  assert.deepEqual(plain(inventory.data), [a])
  assert.strictEqual(h.client.getQueryData(overview.key), overview.data)
  assert.strictEqual(h.client.getQueryData(hydrated.key), hydrated.data)
  const gate = e.createOpenGate(h.api, h.client)
  await assert.rejects(gate.open(a, row('overview-root')), /pane 충돌/)
  await assert.rejects(gate.open(a, row('hydrated-lineage')), /pane 충돌/)
  await assert.rejects(gate.open(b, row('removed')), /route가 바뀌/)
  assert.equal(h.calls.filter(c => c.open).length, 0)
  await gate.open(a, row('unrelated'))
  assert.deepEqual(plain(h.calls.find(c => c.open).open[1].route), a)
  // With no usable inventory, navigation cannot authenticate even A; evidence
  // retention does not grant navigation authority to any old descriptor.
  h.client.removeQueries({ queryKey: [...e.QUERY_ROOT, 'routes'] })
  await assert.rejects(gate.open(a, row('another')), /route가 바뀌/)
  assert.strictEqual(h.client.getQueryData(overview.key), overview.data)
})

test('actual cache replacement, null and scoped eviction remove only that retained source, never failed-open claims', async t => {
  for (const tree of [true, false]) for (const removal of ['replacement', 'null', 'eviction']) {
    await t.test(`${tree ? 'overview' : 'hydrated'} / ${removal}`, async () => {
      const h = await load()
      seed(h)
      const e = h.exports
      const source = retain(h, b, { tree, alias: 'root' }, 'shared')
      const otherSource = retain(h, b, { tree: !tree, alias: 'lineage' }, 'shared')
      const gate = e.createOpenGate(h.api, h.client)
      // B is genuinely eligible here. A failed SDK open can already own a tab.
      h.api.openSession = async (...args) => { h.calls.push({ open: args }); throw new Error('hydration timeout') }
      await assert.rejects(gate.open(b, row('claimed', { _lineage_root_id: 'claim-root', _lineage_ids: ['claim-ancestor'] })), /hydration timeout/)
      seed(h, [a])
      h.api.openSession = async (...args) => { h.calls.push({ open: args }) }
      await assert.rejects(gate.open(a, row('shared')), /pane 충돌/)
      if (removal === 'replacement') {
        retain(h, b, { tree, alias: 'stored' }, 'replacement-id')
      } else if (removal === 'null') {
        h.client.setQueryData(source.key, tree ? null : { owner: b, project: null })
      } else {
        h.client.removeQueries({ queryKey: source.key })
      }
      // Removing one source must not erase the other source of the same alias.
      assert.strictEqual(h.client.getQueryData(otherSource.key), otherSource.data)
      await assert.rejects(gate.open(a, row('shared')), /pane 충돌/)
      h.client.removeQueries({ queryKey: otherSource.key })
      await gate.open(a, row('shared'))
      if (removal === 'replacement') await assert.rejects(gate.open(a, row('replacement-id')), /pane 충돌/)
      // Clear all actual cache data; claims are an independent lifetime.
      h.client.removeQueries({ queryKey: e.QUERY_ROOT })
      seed(h, [a])
      for (const id of ['claimed', 'claim-root', 'claim-ancestor']) await assert.rejects(gate.open(a, row(id)), /pane 충돌/)
      await gate.open(a, row('unrelated'))
      assert.deepEqual(h.calls.map(c => c.open[0]), ['claimed', 'shared', 'unrelated'])
      assert.deepEqual(h.calls.map(c => plain(c.open[1].route)), [b, a, a])
    })
  }
})

test('lineage collision, preview membership and prior partially-failed opens all refuse cross-owner reuse', async () => {
  const h = await load({ openSession: async () => { throw new Error('hydration timeout') } })
  seed(h)
  seedProject(h, b, project('p', [], { sessionIds: ['root'] }))
  const gate = h.exports.createOpenGate(h.api, h.client)
  await assert.rejects(gate.open(a, row('rotated', { _lineage_root_id: 'root' })), /거부/)
  await assert.rejects(gate.open(a, row('unique')), /hydration timeout/)
  await assert.rejects(gate.open(b, row('unique')), /거부/)
})

test('known focused tab owner mismatch or unresolved owner refuses; matching owner reuses public opener', async () => {
  const h = await load()
  seed(h)
  h.api.state.focusedStoredSessionId.get = () => 's'
  const gate = h.exports.createOpenGate(h.api, h.client)
  await assert.rejects(gate.open(a, row()), /불명확/)
  h.api.state.focusedSessionOwner.get = () => ({ connectionId: 'b', profile: 'desktop' })
  await assert.rejects(gate.open(a, row()), /거부/)
  h.api.state.focusedSessionOwner.get = () => ({ connectionId: 'a', profile: 'desktop' })
  await gate.open(a, row())
  const [id, options] = h.calls[0].open
  assert.equal(id, 's')
  assert.deepEqual(plain(options.route), a)
  assert.equal(options.profile, 'desktop')
  assert.equal(options.intent, 'tab')
  assert.equal(options.workspaceMode, 'sessions')
  assert.equal(options.keepAllProfilesScope, true)
  assert.equal(Object.hasOwn(options, 'workspaceOwnerKey'), false)
})

test('one offline connection does not block the other tree, session expansion or selection', async () => {
  const calls = []
  const h = await load({
    requestProfile: async (route, method) => {
      calls.push({ route, method })
      if (route.connectionId === 'b') throw new Error('gateway connection closed')
      return method === 'projects.tree' ? { projects: [project()] } : { project: project('p', [row('select')]) }
    }
  })
  h.mount(); h.render(); await tick(); h.render(); await tick(); h.render()
  assert.match(h.output(), /오프라인/)
  assert.ok(h.button('p · desktop'))
  h.button('p · desktop').props.onClick(); h.render(); await tick(); h.render()
  const before = h.client.getQueryData(h.exports.resourceKey(a))
  assert.ok(h.button('select'))
  await h.button('select').props.onClick(); h.render()
  assert.strictEqual(h.client.getQueryData(h.exports.resourceKey(a)), before)
  assert.ok(h.button('select'))
  assert.match(h.output(), /오프라인/)
  assert.equal(calls.filter(c => c.route.connectionId === 'b').length, 1)
})

test('slow superseded responses cannot publish, including same-route refetch and disposed inventory', async () => {
  const slow = deferred()
  const h = await load({ requestProfile: () => slow.promise })
  const abort = new AbortController()
  const pending = h.exports.projectQuery(a).queryFn({ signal: abort.signal })
  abort.abort()
  slow.resolve({ projects: [project('old')] })
  await assert.rejects(pending, error => error.name === 'AbortError')
  const inventory = deferred()
  h.api.profileRoutes = () => inventory.promise
  const query = h.exports.inventoryQuery(h.api)
  const control = new AbortController()
  const p = query.queryFn({ signal: control.signal })
  control.abort(); inventory.resolve([a])
  await assert.rejects(p, error => error.name === 'AbortError')
})

test('empty, missing project, malformed, unsupported, auth, offline and ordinary failure remain distinct', async () => {
  const h = await load()
  const e = h.exports
  h.api.requestProfile = async () => ({ projects: [] })
  assert.equal((await e.projectQuery(a).queryFn({})).projects.length, 0)
  h.api.requestProfile = async () => ({ project: null })
  assert.equal((await e.projectQuery(a, 'p').queryFn({})).project, null)
  h.api.requestProfile = async () => ({})
  await assert.rejects(e.projectQuery(a).queryFn({}), /잘못된/)
  h.api.requestProfile = undefined
  await assert.rejects(e.projectQuery(a).queryFn({}), error => e.classifyError(error) === 'unsupported')
  h.api.profileRoutes = undefined
  await assert.rejects(e.inventoryQuery().queryFn({}), /미지원/)
  assert.equal(e.classifyError({ code: -32601, message: 'no method' }), 'unsupported')
  assert.equal(e.classifyError({ status: 401, message: 'expired' }), 'auth')
  assert.equal(e.classifyError(new Error('gateway connection closed')), 'offline')
  assert.equal(e.classifyError(new Error('request timed out')), 'error')
})

test('wrong response owner/project and removed routes are not silently repaired or opened', async () => {
  const h = await load()
  seed(h)
  assert.throws(() => h.exports.parseProject(project('p', [row('s', { connection_id: 'b' })]), a), /소유자/)
  assert.throws(() => h.exports.parseProject(project('p', [row('s', { profile: 'desktop' })]), a), /targetProfile/)
  h.api.requestProfile = async () => ({ project: project('other') })
  await assert.rejects(h.exports.projectQuery(a, 'p').queryFn({}), /project id/)
  const gate = h.exports.createOpenGate(h.api, h.client)
  seed(h, [b])
  await assert.rejects(gate.open(a, row()), /route가 바뀌/)
  seed(h)
  h.api.openSession = undefined
  await assert.rejects(gate.open(a, row()), /openSession 미지원/)
  assert.equal(h.calls.length, 0)
})

test('simultaneous opens serialize and disposed gate cannot navigate', async () => {
  const wait = deferred()
  const h = await load({ openSession: () => wait.promise })
  seed(h)
  const gate = h.exports.createOpenGate(h.api, h.client)
  const first = gate.open(a, row('one'))
  await assert.rejects(gate.open(b, row('two')), /진행 중/)
  wait.resolve(); await first
  gate.dispose()
  await assert.rejects(gate.open(a, row('one')), /종료/)
})

test('private package has no installed runtime dependencies', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.private, true)
  assert.equal(pkg.type, 'module')
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [])
})

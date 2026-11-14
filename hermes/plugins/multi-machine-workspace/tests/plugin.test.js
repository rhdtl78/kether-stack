import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import plugin from '../plugin.js'

test('plugin id matches its directory and remains opt-in', () => {
  const directory = new URL('../', import.meta.url).pathname.split('/').filter(Boolean).at(-1)
  assert.equal(plugin.id, directory)
  assert.equal(plugin.defaultEnabled, false)
  assert.equal(typeof plugin.register, 'function')
})

test('registration exposes only an honest scaffold pane', () => {
  const contributions = []
  plugin.register({ register: contribution => contributions.push(contribution) })
  assert.equal(contributions.length, 1)
  const pane = contributions[0]
  assert.equal(pane.area, 'panes')
  assert.equal(pane.data.placement, 'left')
  assert.match(pane.render(), /아직 구현되지 않았습니다/)
})

test('package stays private and dependency-free for initial setup', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.private, true)
  assert.equal(pkg.type, 'module')
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [])
})

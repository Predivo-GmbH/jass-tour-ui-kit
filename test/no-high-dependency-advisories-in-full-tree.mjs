import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
test('the full dependency tree has no high or critical advisories', () => {
  const windows = globalThis.process.platform === 'win32'
  const result = spawnSync(windows ? 'npm.cmd' : 'npm', ['audit', '--json'], { cwd: root, shell: windows, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  assert.ok(result.status === 0 || result.status === 1, 'npm audit must finish with an audit report')
  const counts = JSON.parse(result.stdout).metadata?.vulnerabilities
  assert.ok(counts && Number.isInteger(counts.high) && Number.isInteger(counts.critical), 'audit severity counts must be present')
  assert.equal(counts.high, 0, 'full-tree high advisories')
  assert.equal(counts.critical, 0, 'full-tree critical advisories')
  console.log(JSON.stringify({ vulnerabilities: counts }))
})

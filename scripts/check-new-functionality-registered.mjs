#!/usr/bin/env node
/**
 * THE REFUSAL — a change that adds a functionality without a test does not land.
 *
 * Roger, 2026-09-17: "every single feature that is created also creates a test. This test will run
 * every time we deploy something." And: "you need to be the one that really asks the question every
 * single time we do anything with a product."
 *
 * This is that question, asked by a machine, on every change. It does NOT try to know how many
 * functionalities a product has — nobody can. It compares what the product WAS to what it BECAME
 * and refuses anything new that arrives without its row and its test. From an empty product that
 * property holds forever by induction: start at zero (complete by definition), and never let an
 * unrecognised, untested thing in.
 *
 * Usage:
 *   node scripts/check-new-functionality-registered.mjs                 # vs origin/main
 *   node scripts/check-new-functionality-registered.mjs --diff HEAD~1   # vs any git range
 *   node scripts/check-new-functionality-registered.mjs --root <dir>
 *
 * Exit 0 = nothing new, or everything new is written down AND tested.
 * Exit 1 = something a user can do arrived with no row, or a row with no real test.
 */

import { readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const args = process.argv.slice(2)
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null }
const ROOT = resolve(val('--root') || process.cwd())
const RANGE = val('--diff') || defaultRange()

function defaultRange() {
  for (const base of ['origin/main', 'origin/master', 'main', 'master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', base], { cwd: ROOT, stdio: 'ignore' })
      return `${base}...HEAD`
    } catch { /* try the next one */ }
  }
  return 'HEAD~1'
}

// ── what arrived in this change ─────────────────────────────────────────────────────────────
// fileURLToPath, never .pathname: a hand-rolled conversion leaves %20 for every space, and this
// fleet lives under "C:\Business\Internal Projects\...". It passed in CI only because a GitHub
// runner's checkout path has no spaces in it.
const here = fileURLToPath(new URL('./recognise-functionality.mjs', import.meta.url))
let added
try {
  const out = execFileSync(process.execPath, [here, '--root', ROOT, '--diff', RANGE, '--json'], {
    encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024,
  })
  added = JSON.parse(out)
} catch (e) {
  // the recogniser exits 1 when it found something unclassified — that is still a valid report
  const out = e.stdout || ''
  if (!out.trim()) {
    console.error(`FAIL  could not read the change (${RANGE}): ${e.message}`)
    process.exit(1)
  }
  added = JSON.parse(out)
}

if (added.total === 0) {
  console.log(`OK    this change adds nothing a user can do (${RANGE}).`)
  process.exit(0)
}

// ── the register ────────────────────────────────────────────────────────────────────────────
const REGISTRY = ['docs/FEATURES.md', 'docs/FEATURE_REGISTRY.md']
  .map((p) => join(ROOT, p))
  .find((p) => existsSync(p) && /^#{2,3} F-\d{3}:/m.test(readFileSync(p, 'utf-8')))

if (!REGISTRY) {
  // GREEN BY ABSENCE IS NOT ALLOWED. The older coverage gate exited 0 when no register existed,
  // which made a product with no register the safest kind of product. It is the least safe kind.
  console.error(
    `FAIL  this change adds ${added.total} thing(s) a user can do, and the product has no feature\n` +
    `      register with a single F-XXX row (looked for docs/FEATURES.md, docs/FEATURE_REGISTRY.md).\n` +
    `      Create docs/FEATURES.md and give every new functionality a row. A product with no\n` +
    `      register is not a product with nothing to test.`
  )
  process.exit(1)
}

const registry = readFileSync(REGISTRY, 'utf-8')
const rows = [...registry.matchAll(/^#{2,3} (F-\d{3}):\s*(.+)$/gm)].map((m, i, arr) => {
  const start = m.index
  const nextRow = /^#{2,3} F-\d{3}:/gm
  nextRow.lastIndex = start + 1
  const nm = nextRow.exec(registry)
  return { id: m[1], name: m[2].trim(), body: registry.slice(start, nm ? nm.index : registry.length) }
})

const STOP = new Set([
  'click', 'change', 'open', 'the', 'page', 'form', 'control', 'that', 'runs', 'and', 'for',
  'submit', 'enter', 'choose', 'value', 'server', 'action', 'read', 'see', 'product', 'find',
  'search', 'title', 'description', 'move', 'through', 'pages', 'list', 'table', 'column', 'sort',
  'filter', 'upload', 'file', 'download', 'export', 'something', 'unnamed', 'interactive',
])
const tokens = (s) => (s.toLowerCase().match(/[a-z0-9_\-/.]{3,}/g) || []).filter((t) => !STOP.has(t))

function rowFor(item) {
  const want = tokens(item.label)
  if (want.length === 0) return null
  let best = null, bestHits = 0
  for (const r of rows) {
    const hay = r.body.toLowerCase()
    const hits = want.filter((t) => hay.includes(t)).length
    if (hits > bestHits) { best = r; bestHits = hits }
  }
  return bestHits >= Math.max(1, Math.ceil(want.length / 2)) ? best : null
}

function testsOf(row) {
  const out = []
  for (const m of row.body.matchAll(/`([^`]+\.(?:spec|test)\.[tj]sx?)`/g)) out.push(m[1])
  return out
}

// ── judge ───────────────────────────────────────────────────────────────────────────────────
const noRow = []
const noTest = []
const missingFile = []
const unnameable = added.items.filter((i) => i.kind === 'unclassified')

for (const item of added.items) {
  if (item.kind === 'unclassified') continue
  const row = rowFor(item)
  if (!row) { noRow.push(item); continue }
  const tests = testsOf(row)
  if (tests.length === 0) { noTest.push({ item, row }); continue }
  const absent = tests.filter((t) => !existsSync(join(ROOT, t)))
  if (absent.length === tests.length) missingFile.push({ item, row, absent })
}

const failed = noRow.length + noTest.length + missingFile.length + unnameable.length

console.log(`Change ${RANGE} adds ${added.total} thing(s) a user can do. Register: ${REGISTRY.replace(ROOT, '.')}`)

if (unnameable.length) {
  console.error(`\nFAIL  ${unnameable.length} interactive thing(s) could not be recognised at all:`)
  for (const u of unnameable) console.error(`        ${u.evidence[0]}  ${u.label}`)
  console.error(`      Nothing unrecognised is allowed through. Either it is a functionality — give it a\n` +
                `      row and a test — or teach the recogniser, with a fixture, why it is not.`)
}
if (noRow.length) {
  console.error(`\nFAIL  ${noRow.length} new functionality/ies with NO row in the register:`)
  for (const i of noRow) console.error(`        [${i.kind}] ${i.label}\n            ${i.evidence.join('  ')}`)
}
if (noTest.length) {
  console.error(`\nFAIL  ${noTest.length} new functionality/ies whose row names NO test file:`)
  for (const { item, row } of noTest) console.error(`        ${row.id} ${row.name}  <-  ${item.label}`)
}
if (missingFile.length) {
  console.error(`\nFAIL  ${missingFile.length} row(s) name a test file that does not exist:`)
  for (const { row, absent } of missingFile) console.error(`        ${row.id}: ${absent.join(', ')}`)
}

if (failed === 0) {
  console.log(`OK    every new functionality has a row and a test that exists.`)
  process.exit(0)
}

console.error(
  `\nREFUSED. ${failed} of ${added.total} new thing(s) a user can do are not written down and tested.\n` +
  `What counts as a functionality: docs/WHAT-COUNTS-AS-A-FUNCTIONALITY.md\n` +
  `Add a row per item to ${REGISTRY.replace(ROOT, '.')} in THIS change, in the shape:\n` +
  `\n    ### F-0NN: <what the user can do>\n    - **Status:** tested\n    - **Test Files:** E2E: \`e2e/<name>.spec.ts\`\n`
)
process.exit(1)

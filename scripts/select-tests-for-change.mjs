#!/usr/bin/env node
/**
 * TWO SPEEDS — keep deploys fast without letting a far-away wheel break unnoticed.
 *
 * Roger, 2026-09-17: "if you just change a number or a colour that doesn't influence any
 * functionalities, then we do not need to run it [everything]. This will always take a lot of time."
 * And, in the same breath: "when we turn the wheel, somewhere in the system, some other wheel
 * outside of everything can break. This needs to be made sure of."
 *
 * Those two pull against each other, and the resolution is NOT an opinion about the change. A human
 * or an agent deciding "this looks harmless" is exactly the judgement that is wrong when a far wheel
 * breaks. So:
 *
 *   CHEAP checks (does that column still sort, does that field still validate) cost milliseconds.
 *   They ALL run on EVERY change, always. No selection logic — selection that can be wrong is worse
 *   than paying seconds.
 *
 *   EXPENSIVE journeys (sign up, pay, connect an account, complete a workflow) cost minutes. These
 *   are selected from what the change ACTUALLY touches, followed outward through the register.
 *
 *   ANYTHING UNTRACEABLE RUNS EVERYTHING. A shared component, a design token, a dependency, a
 *   config, a migration, or a file no row claims — all of those mean the blast radius is unknown,
 *   and unknown blast radius means run the lot. A colour change stays cheap; a change to something
 *   shared correctly becomes expensive.
 *
 * Usage: node scripts/select-tests-for-change.mjs [--diff <range>] [--root <dir>] [--json]
 * Prints the expensive suites to run, or ALL.
 */

import { readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { execFileSync } from 'child_process'

const args = process.argv.slice(2)
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null }
const ROOT = resolve(val('--root') || process.cwd())
const RANGE = val('--diff') || 'origin/main...HEAD'
const AS_JSON = args.includes('--json')

// Files whose blast radius cannot be bounded by reading them.
const UNBOUNDED = [
  /(^|\/)components\//, /(^|\/)ui\//, /(^|\/)lib\//, /(^|\/)hooks\//, /(^|\/)providers\//,
  /(^|\/)layout\//, /(^|\/)shared\//, /(^|\/)utils\//,
  /(^|\/)supabase\/migrations\//, /(^|\/)supabase\/functions\/_shared\//,
  /package(-lock)?\.json$/, /tsconfig.*\.json$/, /vite\.config\./, /tailwind\.config\./,
  /design-tokens\.json$/, /\.env/, /playwright.*\.config\./, /(^|\/)\.github\/workflows\//,
  /(^|\/)main\.[tj]sx?$/, /(^|\/)App\.[tj]sx?$/, /(^|\/)router\.[tj]sx?$/, /index\.css$/,
]

let changed = []
try {
  changed = execFileSync('git', ['diff', '--name-only', RANGE], { cwd: ROOT, encoding: 'utf-8' })
    .split('\n').map((s) => s.trim()).filter(Boolean)
} catch (e) {
  emit({ run: 'ALL', why: `the change could not be read (${RANGE}) — unknown blast radius`, files: [] })
}

if (changed.length === 0) emit({ run: 'NONE', why: 'nothing changed', files: [] })

const unbounded = changed.filter((f) => UNBOUNDED.some((re) => re.test(f)))
if (unbounded.length) {
  emit({
    run: 'ALL',
    why: 'the change touches something shared, so what it can break cannot be bounded',
    files: unbounded,
  })
}

// Bounded: map each changed file to the register rows that name it, and run those rows' tests.
const REGISTRY = ['docs/FEATURES.md', 'docs/FEATURE_REGISTRY.md']
  .map((p) => join(ROOT, p)).find((p) => existsSync(p))
if (!REGISTRY) emit({ run: 'ALL', why: 'there is no feature register to trace the change through', files: changed })

const registry = readFileSync(REGISTRY, 'utf-8')
const rows = [...registry.matchAll(/^#{2,3} (F-\d{3}):[\s\S]*?(?=^#{2,3} F-\d{3}:|$)/gm)]
  .map((m) => ({ id: m[1], body: m[0] }))

const suites = new Set()
const unclaimed = []
for (const f of changed) {
  const base = f.split('/').pop()
  const owners = rows.filter((r) => r.body.includes(f) || r.body.includes(base.replace(/\.[tj]sx?$/, '')))
  if (owners.length === 0) { unclaimed.push(f); continue }
  for (const o of owners) for (const m of o.body.matchAll(/`([^`]+\.(?:spec|test)\.[tj]sx?)`/g)) suites.add(m[1])
}

// A changed file that no row claims is, by definition, a change nobody can trace. Run everything.
if (unclaimed.length) {
  emit({ run: 'ALL', why: 'a changed file is not claimed by any written-down functionality', files: unclaimed })
}

emit({ run: 'SELECTED', why: 'every changed file traces to a written-down functionality', suites: [...suites], files: changed })

function emit(result) {
  if (AS_JSON) console.log(JSON.stringify(result, null, 2))
  else {
    console.log(`EXPENSIVE JOURNEYS: ${result.run}`)
    console.log(`  because: ${result.why}`)
    if (result.suites?.length) result.suites.forEach((s) => console.log(`    - ${s}`))
    if (result.files?.length) console.log(`  files: ${result.files.slice(0, 8).join(', ')}${result.files.length > 8 ? ` (+${result.files.length - 8})` : ''}`)
    console.log(`CHEAP CHECKS: ALL, always — they cost milliseconds and selection that can be wrong is worse.`)
  }
  process.exit(0)
}

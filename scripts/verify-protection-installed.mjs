#!/usr/bin/env node
/**
 * IS THIS PRODUCT ACTUALLY PROTECTED? — the last mile.
 *
 * WHY THIS EXISTS. On 2026-08-21 the fleet coverage gate was rolled out and its own notes recorded
 * one leftover: "templatize into project-starter (ships none of it)". Twenty-seven days later that
 * was still true, and a new product would have been born unprotected while everyone believed the
 * opposite. The machinery being IN the template is not the same fact as a product HAVING it.
 *
 * "Start a new project" does not mechanically copy this template (AGENTS.md:30 — it means running
 * the Factory kickoff). So a product gets this only if whoever builds it scaffolds from the
 * template, and until now nothing ever checked whether that happened.
 *
 * This is that check. Point it at any product and it answers one question with a yes or a no:
 * would an untested functionality be able to ship here?
 *
 * Usage: node scripts/verify-protection-installed.mjs [--root <dir>]
 * Exit 0 = protected. Exit 1 = not protected, with the exact missing pieces listed.
 */

import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, resolve } from 'path'

const args = process.argv.slice(2)
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null }
const ROOT = resolve(val('--root') || process.cwd())

const REQUIRED_SCRIPTS = [
  ['scripts/recognise-functionality.mjs', 'the machine that notices what a user can do'],
  ['scripts/check-new-functionality-registered.mjs', 'the refusal — blocks a change that adds an untested functionality'],
  ['scripts/check-feature-coverage.mjs', 'every written-down feature must have a test that runs'],
  ['scripts/select-tests-for-change.mjs', 'cheap checks always, expensive journeys by blast radius'],
  ['scripts/build-functionality-overview.mjs', 'the overview page'],
  ['docs/WHAT-COUNTS-AS-A-FUNCTIONALITY.md', 'the written definition everything is measured against'],
]

const problems = []
const ok = []

for (const [rel, what] of REQUIRED_SCRIPTS) {
  if (existsSync(join(ROOT, rel))) ok.push(`${rel} — ${what}`)
  else problems.push(`MISSING  ${rel}\n         (${what})`)
}

// A script present but never called protects nothing. This is the exact failure the 2026-08-21
// rollout left behind: the checker shipped into repos and was wired into only one workflow.
const wfDir = join(ROOT, '.github', 'workflows')
const workflows = existsSync(wfDir)
  ? readdirSync(wfDir).filter((f) => /\.ya?ml(\.template)?$/.test(f))
  : []

const callers = { 'check-new-functionality-registered': [], 'check-feature-coverage': [] }
for (const f of workflows) {
  const body = readFileSync(join(wfDir, f), 'utf-8')
  for (const key of Object.keys(callers)) if (body.includes(key)) callers[key].push(f)
  // A gate allowed to fail is not a gate. CHECK THE STEP, NOT THE FILE — the first version of this
  // flagged any workflow that contained `continue-on-error: true` anywhere, which is a false alarm
  // on every real workflow (they all soften something harmless, like an artifact upload). A check
  // that cries wolf on a correct file is a check people learn to ignore.
  const lines = body.split('\n')
  lines.forEach((line, i) => {
    if (!Object.keys(callers).some((k) => line.includes(k))) return
    const step = lines.slice(Math.max(0, i - 4), i + 4).join('\n')
    if (/continue-on-error:\s*true/.test(step)) {
      problems.push(`SOFT GATE  ${f}:${i + 1} — this gate step carries continue-on-error: true.\n           A gate allowed to fail is not a gate.`)
    }
  })
}

if (workflows.length === 0) {
  problems.push(`MISSING  .github/workflows/ — nothing runs on a push, so no gate can block anything.`)
} else {
  for (const [key, files] of Object.entries(callers)) {
    if (files.length === 0) problems.push(`NEVER RUN  ${key}.mjs is not called by ANY workflow.\n           A script nobody calls protects nothing.`)
    else ok.push(`${key}.mjs runs in: ${files.join(', ')}`)
  }
}

// and the register itself
const register = ['docs/FEATURES.md', 'docs/FEATURE_REGISTRY.md']
  .map((p) => join(ROOT, p))
  .find((p) => existsSync(p) && /^#{2,3} F-\d{3}:/m.test(readFileSync(p, 'utf-8')))
if (register) ok.push(`feature register present with rows: ${register.replace(ROOT, '.')}`)
else if (existsSync(join(ROOT, 'docs/FEATURE_COVERAGE_OPT_OUT.md'))) ok.push('no register, but a written opt-out exists')
else problems.push(`MISSING  a feature register with at least one "### F-XXX:" row (docs/FEATURES.md).`)

console.log(`Checking: ${ROOT}\n`)
for (const line of ok) console.log(`  OK    ${line}`)
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n`)
  for (const p of problems) console.error(`  ${p}\n`)
  console.error(
    `NOT PROTECTED. A functionality could be added to this product with no test and nothing would\n` +
    `stop it. Scaffold the missing pieces from C:\\Business\\Templates\\project-starter and wire the\n` +
    `two gates into the deploy workflow as BLOCKING steps.`
  )
  process.exit(1)
}
console.log(`\nPROTECTED. An untested functionality cannot ship from this product.`)
process.exit(0)

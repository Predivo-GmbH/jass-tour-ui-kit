// No workflow job here may land on GitHub's `ubuntu-latest`.
//
// WHY (measured 2026-11-10 21:22Z and 21:36Z): GitHub moved `ubuntu-latest` to Ubuntu 26.04.
// backoffice run 42903519192, attempts 1 and 3, logged "Image: ubuntu-26.04", and there
// Playwright's `install --with-deps` / `install-deps` fails: "E: Package 'libavcodec60' has no
// installation candidate" (libicu74, libvpx9, libxml2, libx264-164 likewise) and then
// "Failed to install browsers". Every workflow in the fleet was proven on 24.04.
//
// So GitHub's machine is NAMED `ubuntu-24.04` everywhere a job can reach it: a literal
// `runs-on:`, the `|| 'ubuntu-...'` fallback after vars.RUNNER_LABEL, a `merge_group && '...'`
// branch, and a `runs_on:` handed to a reusable workflow. Moving to a newer image is a deliberate
// change that edits this guard, never a silent default that GitHub flips for us overnight.
//
// Comments and step/job `name:` lines are not checked, and neither is a file name that merely
// contains the word (this guard's own): a line that explains WHY the label is not ubuntu-latest
// must be able to say it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The repo root: the nearest directory above this file that holds .github/workflows. */
function repoRoot() {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    if (existsSync(join(dir, '.github', 'workflows'))) return dir
    const up = dirname(dir)
    if (up === dir) throw new Error('no .github/workflows above ' + fileURLToPath(import.meta.url))
    dir = up
  }
}

/** ubuntu-latest as a label of its own, not inside a longer word or file name. */
const LABEL = /(?<![\w./-])ubuntu-latest(?![\w.-])/

/** Lines whose CODE (not a comment, not a name:) names ubuntu-latest, as { n, line }. */
export function ubuntuLatestLines(text) {
  const out = []
  String(text).split(/\r?\n/).forEach((line, i) => {
    if (line.trimStart().startsWith('#')) return
    if (/^\s*(- )?name:/.test(line)) return
    const hash = line.match(/\s#/)
    const code = hash ? line.slice(0, hash.index) : line
    if (LABEL.test(code)) out.push({ n: i + 1, line })
  })
  return out
}

test('the detector sees every shape that resolves to ubuntu-latest, and no comment', () => {
  for (const bad of [
    '    runs-on: ubuntu-latest',
    "    runs-on: ${{ vars.RUNNER_LABEL || 'ubuntu-latest' }}",
    "    runs-on: ${{ github.event_name == 'merge_group' && 'ubuntu-latest' || vars.RUNNER_LABEL || 'ubuntu-24.04' }}",
    "    runs-on: ${{ (github.event.inputs.runner == 'github' && 'ubuntu-latest') || vars.RUNNER_LABEL || 'ubuntu-24.04' }}",
    "      runs_on: ${{ inputs.runner == 'github' && 'ubuntu-latest' || '' }}",
    '        os: [ubuntu-latest, windows-latest]',
  ]) assert.equal(ubuntuLatestLines(bad).length, 1, bad)
  for (const ok of [
    '    runs-on: ubuntu-24.04',
    "    runs-on: ${{ vars.RUNNER_LABEL || 'ubuntu-24.04' }}",
    '    # an offline laptop falls back to ubuntu-latest',
    '    runs-on: ubuntu-24.04   # not ubuntu-latest: that is 26.04 since 2026-11-10',
    "      - name: Every job names ubuntu-24.04, never ubuntu-latest",
    '        run: node --test scripts/no-job-lands-on-ubuntu-latest.test.mjs',
  ]) assert.deepEqual(ubuntuLatestLines(ok), [], ok)
})

test('no workflow job resolves to ubuntu-latest (26.04 breaks Playwright install-deps, run 42903519192)', () => {
  const dir = join(repoRoot(), '.github', 'workflows')
  const files = readdirSync(dir).filter((f) => /\.ya?ml(\.template)?$/.test(f))
  assert.ok(files.length > 0, `found no workflow in ${dir}: absence is not success`)
  const found = []
  for (const f of files) {
    for (const { n, line } of ubuntuLatestLines(readFileSync(join(dir, f), 'utf8'))) {
      found.push(`${f}:${n}: ${line.trim()}`)
    }
  }
  assert.deepEqual(
    found,
    [],
    "name GitHub's machine 'ubuntu-24.04', never 'ubuntu-latest' (that is Ubuntu 26.04 since " +
      '2026-11-10, where Playwright install-deps cannot find libavcodec60/libicu74/libvpx9)'
  )
})

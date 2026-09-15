/**
 * THE REPORTER THAT KEEPS ARIA SNAPSHOTS OFF A RUNNER 19 REPOSITORIES SHARE ACTUALLY DOES IT,
 * AND EVERY PLAYWRIGHT CONFIG IN THIS REPO ACTUALLY REGISTERS IT FIRST.
 *
 * ══ WHAT THIS IS ABOUT ═══════════════════════════════════════════════════════════════════════
 *
 * The playwright configs set trace, screenshot and video to 'off'. Those three switches do not
 * reach Playwright's ERROR CONTEXT: node_modules/playwright/lib/index.js writes
 * test-results/<test>/error-context.md whenever a test ends with errors, gated on
 * `errors.length > 0` and nothing else, and the content is an ARIA snapshot of the page - the
 * signed-in application, form-field contents included. There is no `use:` option to turn it off.
 *
 * It is not hypothetical. On 2026-09-01 production-monitor's login spec failed against production
 * and Playwright wrote the monitor account's real password, in plaintext, into an error context
 * that CI then published as a downloadable artifact. Both specs already had `trace: 'off'`.
 *
 * A FLAKY test is enough to produce one. Cockpit run 34898267882 / job 104159648677 concluded
 * SUCCESS (1 flaky, 91 passed) and still left one on a self-hosted runner, and the base reporter
 * printed its path into the job log, where it stays readable for 7 days after the file is gone.
 *
 * e2e/strip-runner-artifacts.reporter.ts closes that. This asserts it closes it, because the only
 * other proof is waiting for a test to go flaky again on a shared machine.
 *
 * ══ WHY IT ASSERTS THE SPLICE AS WELL AS THE DELETE ══════════════════════════════════════════
 *
 * Deleting the file and leaving the attachment in `result.attachments` would still publish the
 * path, because runner/index.js prints `Error Context: <path>` straight out of that array. Both
 * halves are the fix; one half is a file that is gone and a map to it that is not.
 *
 * ══ AND THE HALF THAT IS EASY TO BREAK BY BEING THOROUGH ═════════════════════════════════════
 *
 * A reporter that deleted every path-bearing attachment would delete files this suite was only
 * HANDED - a fixture attaching something from elsewhere on disk. So containment within the
 * project's own outputDir is asserted too, in the negative direction.
 *
 * ══ AND THE HALF A NEW CONFIG BREAKS SILENTLY ════════════════════════════════════════════════
 *
 * This repo has more than one playwright config. A reporter wired into some of them is a channel
 * that is still open, and nothing about a green suite would say so - which is why the third test
 * DISCOVERS the configs instead of listing them, and fails if it finds none.
 *
 * The behaviour tests run entirely inside a throwaway directory under the OS temp dir and never
 * touch a real output directory. Nothing here ever opens an error context: reading one to check
 * whether it happened to hold a credential is the leak, not the precaution.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CONFIG_ROOT = resolve(HERE, '..')
const REPORTER_FILE = resolve(HERE, '..', 'e2e', 'strip-runner-artifacts.reporter.ts')
const REPORTER = pathToFileURL(REPORTER_FILE).href

/** One attachment record shaped the way Playwright hands it to a reporter. */
const attachment = (name, path, contentType = 'text/markdown') => ({ name, path, contentType })

test('an error context written by this suite is deleted AND its path never reaches the log', async () => {
  const { default: StripRunnerArtifacts } = await import(REPORTER)
  const root = mkdtempSync(join(tmpdir(), 'strip-runner-'))
  try {
    const outputDir = join(root, 'test-results', 'artifacts')
    const caseDir = join(outputDir, 'some-spec-chromium')
    mkdirSync(caseDir, { recursive: true })

    // The real thing is an ARIA snapshot of a signed-in page. A placeholder stands in for it here
    // precisely so this test never has to hold the real content of one.
    const errorContext = join(caseDir, 'error-context.md')
    writeFileSync(errorContext, 'placeholder - this test never writes or reads a real snapshot\n')

    // A file the suite was handed rather than one it wrote: it lives OUTSIDE outputDir.
    const foreign = join(root, 'handed-to-us.md')
    writeFileSync(foreign, 'not ours to delete\n')

    // A sibling of outputDir that CI reads AFTER the suite - a json report, an uploaded gate
    // screenshot. It must survive the sweep, which is why the configs nest outputDir under it.
    const siblingCiReadsLater = join(root, 'test-results', 'results.json')
    writeFileSync(siblingCiReadsLater, '{"note":"written by the json reporter, read by CI"}\n')

    const reporter = new StripRunnerArtifacts()
    reporter.onBegin({ projects: [{ outputDir }] }, {})

    const result = {
      attachments: [
        attachment('error-context', errorContext),
        attachment('a-fixture-handed-us-this', foreign),
        attachment('no-path-at-all', undefined, 'text/plain'),
      ],
    }
    reporter.onTestEnd({ title: 'a signed-in page renders' }, result)

    assert.equal(existsSync(errorContext), false,
      'the error context this suite wrote must be gone from the runner, not merely unreferenced')

    const names = result.attachments.map((a) => a.name)
    assert.equal(names.includes('error-context'), false,
      'the attachment must also be removed from result.attachments. The base reporter prints '
        + '`Error Context: <path>` out of that array, and a path in a CI log is a map to the file '
        + 'for 7 days after the file itself is gone.')

    assert.equal(existsSync(foreign), true,
      'a file the suite was only HANDED lives outside outputDir and is not this reporter\'s to delete')
    assert.deepEqual(names, ['a-fixture-handed-us-this', 'no-path-at-all'],
      'only attachments inside the suite\'s own output directory may be stripped')

    // onEnd sweeps whatever was written but never attached.
    const orphan = join(caseDir, 'never-attached.md')
    writeFileSync(orphan, 'written but not attached\n')
    reporter.onEnd({ status: 'passed' })
    assert.equal(existsSync(outputDir), false,
      'onEnd must remove the output directory itself, which is what catches a file that was '
        + 'written but never attached to a result')
    assert.equal(existsSync(siblingCiReadsLater), true,
      'the sweep must not reach a sibling of outputDir. test-results/ in this fleet also holds '
        + 'json reports that CI steps read after the suite and specs that write their own '
        + 'screenshots; a sweep that took those would turn a security fix into a broken deploy.')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the reporter declares that it does not print to stdio, so it cannot silence the suite', async () => {
  const { default: StripRunnerArtifacts } = await import(REPORTER)
  const reporter = new StripRunnerArtifacts()
  assert.equal(typeof reporter.printsToStdio, 'function',
    'printsToStdio() must be DECLARED. Playwright defaults a reporter that omits it to TRUE '
      + '(wrapReporterAsV2), which is the opposite of the truth for this one.')
  assert.equal(reporter.printsToStdio(), false,
    'it must be false. createReporters only adds its fallback reporter when NO reporter prints to '
      + 'stdio; a silent reporter claiming it prints takes that slot and cancels the fallback. '
      + 'Measured on BackOffice, whose only other reporter is \'html\': `playwright test --list` '
      + 'printed every load error before this reporter existed and NOTHING after. A suite whose '
      + 'failures print nothing is worse than the leak this file closes.')
})

test('the reporter never prints a path, because that is the string it exists to remove', async () => {
  const { default: StripRunnerArtifacts } = await import(REPORTER)
  const root = mkdtempSync(join(tmpdir(), 'strip-runner-log-'))
  try {
    const outputDir = join(root, 'test-results', 'artifacts')
    mkdirSync(outputDir, { recursive: true })
    const file = join(outputDir, 'error-context.md')
    writeFileSync(file, 'placeholder\n')

    const reporter = new StripRunnerArtifacts()
    reporter.onBegin({ projects: [{ outputDir }] }, {})
    reporter.onTestEnd({ title: 't' }, { attachments: [attachment('error-context', file)] })

    const said = []
    const realLog = console.log
    console.log = (...args) => said.push(args.join(' '))
    try { reporter.onEnd({ status: 'passed' }) } finally { console.log = realLog }

    const spoken = said.join('\n')
    assert.ok(spoken.length > 0, 'a removal that says nothing at all cannot be audited afterwards')
    for (const dir of ['test-results/', 'playwright-report/', 'blob-report/']) {
      assert.equal(spoken.includes(dir), false,
        `the reporter must not print "${dir}..." itself - a reporter announcing what it deleted `
          + 'would re-publish the map to it into the very job log the deletion was for.')
    }
    assert.ok(/\b1\b/.test(spoken), 'it should say HOW MANY it removed: a count is the fleet rule for '
      + 'reporting on something whose value must not be rendered')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('every playwright config in this repo registers the stripper FIRST and keeps outputDir off test-results', () => {
  const configs = readdirSync(CONFIG_ROOT)
    .filter((f) => /^playwright.*\.config\.(ts|js|mjs|cjs)$/.test(f))
    .sort()

  assert.ok(configs.length > 0,
    'no playwright*.config.* found where this guard looks. Absence is not success: either the configs '
      + 'moved and this guard now watches nothing, or it is looking in the wrong place.')

  for (const name of configs) {
    const text = readFileSync(join(CONFIG_ROOT, name), 'utf8')

    // The reporter value, taken by bracket matching rather than by regex, so a nested option
    // cannot fool it - and skipping strings and comments, so a bracket inside either cannot.
    const key = text.search(/^[ \t]*reporter[ \t]*:/m)
    assert.notEqual(key, -1, `${name} declares no reporter. The default is 'dot' on CI, and a `
      + 'config that falls through to it has no stripper, so an error context it writes survives.')

    const open = text.indexOf('[', key)
    assert.notEqual(open, -1, `${name}'s reporter must be an ARRAY - the stripper has to be an `
      + 'entry in it, and a bare string reporter cannot hold one.')

    let depth = 0
    let first = null
    for (let i = open; i < text.length; i++) {
      const c = text[i]
      if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i === -1) break; continue }
      if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i) + 1; continue }
      if (c === "'" || c === '"' || c === '`') {
        for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++
        continue
      }
      if (c === '[') {
        depth++
        if (depth === 2 && first === null) first = { start: i }
      } else if (c === ']') {
        if (depth === 2 && first && first.end === undefined) first.end = i + 1
        depth--
        if (depth === 0) break
      }
    }
    assert.ok(first && first.end !== undefined, `${name}'s reporter array has no entries to read`)
    first = text.slice(first.start, first.end)
    assert.match(first, /strip-runner-artifacts\.reporter/,
      `${name} must register the stripper as the FIRST reporter. Reporters are called in array `
        + 'order and share one TestResult: registered after the base reporter it deletes the file '
        + 'and the base reporter has already printed `Error Context: <path>` into the job log. '
        + `Its first entry is instead: ${first}`)

    // The sweep is unconditional, so outputDir must contain nothing anybody reads afterwards.
    const outputDir = text.match(/^\s*outputDir\s*:\s*['"]([^'"]+)['"]/m)
    assert.ok(outputDir, `${name} must pin outputDir. It defaults to 'test-results', which in this `
      + 'fleet also holds json reports CI reads after the suite - and onEnd sweeps outputDir whole.')
    assert.doesNotMatch(outputDir[1], /^\.?\/?test-results\/?$/,
      `${name} points outputDir at test-results itself (${outputDir[1]}). onEnd removes that `
        + 'directory recursively, which would take the json reports and gate screenshots with it.')
  }
})

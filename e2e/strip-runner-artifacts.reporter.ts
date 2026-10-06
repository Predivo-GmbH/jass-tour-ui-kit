import fs from 'node:fs'
import path from 'node:path'
import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter'

/**
 * NOTHING THIS SUITE WRITES SURVIVES THE RUN THAT WROTE IT, ON A RUNNER 19 REPOSITORIES SHARE.
 *
 * ══ WHY `trace/screenshot/video: 'off'` WAS NOT ENOUGH ════════════════════════════════════════
 *
 * Every playwright config in this repo turned all three recorders off on 2026-09-14, after a
 * trace of an authenticated setup step was found on the shared runner holding live staging
 * session tokens. That closed three channels and left a fourth open.
 *
 * Playwright writes an ERROR CONTEXT for any test that ends with errors. It is not a recorder and
 * none of the three switches reach it - node_modules/playwright/lib/index.js gates it on
 * `this._testInfo.errors.length > 0` and nothing else:
 *
 *     const filePath = this._testInfo.outputPath('error-context.md')
 *     await fs.promises.writeFile(filePath, errorContextContent, 'utf8')
 *
 * The content is `pageSnapshot` - an ARIA snapshot of the page as it stood when the test failed.
 * On an authenticated suite that is the signed-in application, including the contents of form
 * fields. A FAILING AUTH TEST PHOTOGRAPHS THE PASSWORD FIELD; an ARIA snapshot is the same
 * photograph in text, and the fleet rule is that a secret is never rendered anywhere.
 *
 * THIS IS NOT HYPOTHETICAL IN THIS FLEET. On 2026-09-01 production-monitor's Jass-Tour login spec
 * failed against production and Playwright wrote the monitor account's real password, in
 * plaintext, into test-results/<test>/error-context.md as `- textbox "Passwort" [ref=e27]: ...`;
 * actions/upload-artifact then published the whole directory as a downloadable CI artifact. Both
 * specs already carried `test.use({ trace: 'off' })`. It was not enough, for exactly this reason.
 *
 * ══ AND IT DOES NOT TAKE A FAILING RUN ═══════════════════════════════════════════════════════
 *
 * `retries` in CI means a FLAKY test writes one of these and the job still goes green. That is
 * what happened in cockpit run 34898267882, job 104159648677, which concluded SUCCESS:
 *
 *     ✘  20 [chromium] › e2e/monitoring-openable-counts.spec.ts:422:1 › ... (2.2m)
 *     ✓  21 [chromium] › e2e/monitoring-openable-counts.spec.ts:422:1 › ... (retry #1) (8.4s)
 *     1 flaky, 91 passed
 *
 * The green job left an ARIA snapshot of a signed-in page on a self-hosted runner, and the base
 * reporter announced its path in the log. So "the suite passed" never implied "the runner is
 * clean", and a sweep that finds the disk empty because a later checkout's `git clean -ffdx`
 * happened to run first is not a guard.
 *
 * ══ WHAT THIS DOES ═══════════════════════════════════════════════════════════════════════════
 *
 *   onTestEnd  every attachment whose file sits inside a project's outputDir is DELETED, and then
 *              removed from `result.attachments`. The removal is what keeps the path out of the
 *              log: the base reporter prints `Error Context: <path>` straight out of that array
 *              (runner/index.js), and a path in a CI log is a map to the file for the next 7 days
 *              even after the file itself is gone.
 *   onEnd      the outputDir itself is removed, which catches anything written but never attached.
 *
 * Registered FIRST in every playwright*.config.* in this repo, and THAT ORDER IS LOAD-BEARING.
 * Reporters are called in array order and share one TestResult, so mutating here is what the
 * reporter after it sees. Registering it after the base reporter would delete the file and still
 * publish the map to it.
 *
 * ══ WHY THE CONFIGS PIN outputDir TO A SUBDIRECTORY ══════════════════════════════════════════
 *
 * `outputDir` defaults to `test-results/`, and in this fleet that directory is NOT only
 * Playwright's. Configs write `test-results/results.json` and `test-results/*-report.json` there,
 * CI steps read those files after the suite, specs write `test-results/gateA-*.png`, and
 * workflows upload the directory. onEnd's sweep would take all of it with the error contexts.
 * Every config that registers this reporter therefore sets `outputDir` to a dedicated
 * subdirectory, so the sweep can be unconditional and still destroy only what Playwright itself
 * wrote. Do not point outputDir back at a directory something else reads.
 *
 * IT NEVER NAMES A PATH IN ITS OWN OUTPUT. Logging what it deleted would put the very string back
 * into the job log that deleting the file was meant to remove. It prints a COUNT, which is the
 * same rule the fleet uses for proving a secret exists without rendering it.
 *
 * IT NEVER OPENS WHAT IT DELETES. Reading an error context to check whether this one happened to
 * hold a credential is the leak, not the precaution.
 */
class StripRunnerArtifacts implements Reporter {
  private outputDirs: string[] = []
  private removed = 0

  /**
   * FALSE, AND IT IS NOT COSMETIC - IT IS WHY THIS REPORTER DOES NOT SILENCE THE SUITE.
   *
   * Playwright's wrapReporterAsV2 defaults a reporter that does not declare printsToStdio() to
   * TRUE (runner/index.js: `this._reporter.printsToStdio ? this._reporter.printsToStdio() : true`).
   * createReporters then does:
   *
   *     const someReporterPrintsToStdio = reporters.some(...)
   *     if (reporters.length && !someReporterPrintsToStdio) reporters.unshift(<list/line/dot>)
   *
   * So a silent reporter that claims otherwise takes the stdio slot and cancels the fallback
   * Playwright adds when nothing prints. Measured on BackOffice, whose only other reporter is
   * 'html' - which writes a file and prints nothing: `playwright test --list` printed every config
   * and spec load error before this reporter was added, and NOTHING AT ALL after. A suite whose
   * failures print nothing is worse than the leak this file exists to close.
   */
  printsToStdio(): boolean {
    return false
  }

  onBegin(config: FullConfig): void {
    for (const project of config.projects) {
      if (project.outputDir) this.outputDirs.push(path.resolve(project.outputDir))
    }
  }

  /** Is `file` inside one of the suite's own output directories? Never a path we were only given. */
  private isOurs(file: string): boolean {
    const resolved = path.resolve(file)
    return this.outputDirs.some((dir) => {
      const rel = path.relative(dir, resolved)
      return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
    })
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    for (let i = result.attachments.length - 1; i >= 0; i--) {
      const attachment = result.attachments[i]
      if (!attachment.path || !this.isOurs(attachment.path)) continue
      try {
        fs.rmSync(attachment.path, { force: true })
      } catch {
        // A file we cannot delete must still not be advertised in the log, so fall through to the
        // splice: onEnd's directory sweep is the second attempt, and the guard is the third.
      }
      result.attachments.splice(i, 1)
      this.removed++
    }
  }

  onEnd(): void {
    for (const dir of this.outputDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        // Best effort by design: this reporter must never be the reason a suite fails.
      }
    }
    if (this.removed > 0) {
      console.log(
        `strip-runner-artifacts: removed ${this.removed} attachment file(s) written by this run, `
          + `and swept ${this.outputDirs.length} output director(y/ies). Paths are deliberately not `
          + `printed - naming one in the job log is the exposure this removes.`,
      )
    }
  }
}

export default StripRunnerArtifacts

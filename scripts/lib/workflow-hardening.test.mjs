// SR-SUP-05/06/07: offline checks include .template files (unfilled placeholders are not valid YAML).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const directory = path.join(root, '.github/workflows')
function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name)
    assert.ok(!entry.isSymbolicLink(), `Unexpected workflow symlink: ${file}`)
    return entry.isDirectory() ? filesUnder(file) : [file]
  })
}

function assertWorkflow(source, label) {
  const lines = source.replaceAll('\r\n', '\n').split('\n')
  const untrusted = /\$\{\{[^}]*\bgithub\s*\.\s*(?:event\s*\.|head_ref\b)/
  let block = null
  let permissions = false
  for (const [index, line] of lines.entries()) {
    const indent = line.search(/\S/)
    if (block && (indent > block.indent || indent === -1)) {
      if (block.key === 'run') assert.doesNotMatch(line, untrusted, `${label}:${index + 1}: pass untrusted run inputs through env`)
      continue
    }
    block = null
    if (/^\s*(?:#|$)/.test(line)) continue
    const code = line.replace(/\s+#.*$/, '')
    if (/^permissions:\s*$/.test(code) && /^ {2}[\w-]+:\s*(?:read|write|none)\s*$/.test(lines[index + 1] ?? '')) permissions = true
    assert.doesNotMatch(code, /\bpull_request_target\b/, `${label}:${index + 1}: pull_request_target is forbidden`)
    const use = /(?:^|[\s{,])(?:['"]?uses['"]?):\s*['"]?([^\s'",}]+)/.exec(code)?.[1]
    if (use && !use.startsWith('./')) {
      assert.match(use, /^[^@\s]+@[a-f\d]{40}$/i, `${label}:${index + 1}: third-party uses must pin a full 40-hex commit`)
    }
    const field = /^(\s*)(-\s+)?(?:['"]?([\w-]+)['"]?):\s*(.*)$/.exec(code)
    if (!field) continue
    const [, spaces, dash, key, value] = field
    if (key === 'run') assert.doesNotMatch(value, untrusted, `${label}:${index + 1}: pass untrusted run inputs through env`)
    if (/^[|>][\d+-]*\s*$/.test(value)) block = { key, indent: spaces.length + (dash?.length ?? 0) }
    // Quoted multiline scalars can also contain shell scripts. Treat continuations like a block.
    else if (/^['"]/.test(value) && !new RegExp(`${value[0]}$`).test(value.slice(1))) block = { key, indent: spaces.length + (dash?.length ?? 0) }
  }
  assert.ok(permissions, `${label}: a top-level permissions block is required`)
  const top = /^permissions:\n((?:[ \t]+[^\n]*\n|\n)*)/m.exec(source.replaceAll('\r\n', '\n'))?.[1] ?? ''
  assert.match(top, /^  contents: read\s*$/m, `${label}: top-level contents must be read-only`)
  assert.doesNotMatch(top, /^  [\w-]+:\s*write\b/m, `${label}: elevate write permissions only per job`)
}

test('every workflow and workflow template is pinned, permission-scoped and safe from event injection', () => {
  const files = filesUnder(directory)
  assert.ok(files.length, 'no workflows found')
  for (const file of files) assertWorkflow(fs.readFileSync(file, 'utf8'), path.relative(root, file))
})

const fixture = `name: Offline mutation fixture
on: [pull_request]
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${'a'.repeat(40)} # synthetic parser fixture, never executed
      - name: Safe input
        env:
          TITLE: \${{ github.event.pull_request.title }}
        run: |
          echo "$TITLE"
`

test('valid workflow allows env inputs and local actions', () => {
  assert.doesNotThrow(() => assertWorkflow(fixture, 'fixture'))
  assert.doesNotThrow(() => assertWorkflow(fixture.replace(`actions/checkout@${'a'.repeat(40)}`, './.github/actions/local'), 'local'))
})

for (const ref of ['v5', 'main', 'abc123', 'a'.repeat(39), 'z'.repeat(40)]) {
  test(`action-pin mutation fails: ${ref}`, () => {
    assert.throws(() => assertWorkflow(fixture.replace('a'.repeat(40), ref), 'mutated'), /full 40-hex/)
  })
}

test('permissions mutation fails for absent or job-only permissions', () => {
  const absent = fixture.replace('permissions:\n  contents: read\n', '')
  assert.throws(() => assertWorkflow(absent, 'absent'), /top-level permissions/)
  assert.throws(() => assertWorkflow(absent.replace('    steps:', '    permissions:\n      contents: read\n    steps:'), 'job-only'), /top-level permissions/)
})

test('permissions mutation rejects a write default', () => {
  assert.throws(() => assertWorkflow(fixture.replace('contents: read', 'contents: write'), 'write-default'), /read-only/)
  assert.throws(() => assertWorkflow(fixture.replace('contents: read', 'contents: read\n  issues: write'), 'write-other'), /only per job/)
})

test('public Jass Tour workflows always run on GitHub-hosted runners with tagged action pins', () => {
  for (const file of filesUnder(directory)) {
    const text = fs.readFileSync(file, 'utf8')
    for (const [, runner] of text.matchAll(/^\s+runs-on:\s*([^#\n]+)/gm)) assert.equal(runner.trim(), 'ubuntu-latest', file)
    for (const [, use] of text.matchAll(/^\s+(?:- )?uses:\s*(.+)$/gm)) {
      if (!use.startsWith('./')) assert.match(use, /@[a-f\d]{40}\s+# v[\d.]+/, file)
    }
  }
})

test('pull_request_target mutation fails in block and flow triggers', () => {
  for (const on of ['on: [pull_request_target]', 'on:\n  pull_request_target:']) {
    assert.throws(() => assertWorkflow(fixture.replace('on: [pull_request]', on), 'mutated'), /pull_request_target is forbidden/)
  }
})

for (const expression of ['github.event.pull_request.title', 'github.event.issue.body', 'github.head_ref']) {
  test(`run interpolation mutation fails: ${expression}`, () => {
    for (const script of [`run: echo "\${{ ${expression} }}"`, `run: |\n          echo "\${{ ${expression} }}"`, `run: >-\n          echo "\${{ ${expression} }}"`]) {
      const broken = fixture.replace('run: |\n          echo "$TITLE"', script)
      assert.throws(() => assertWorkflow(broken, 'mutated'), /through env/)
    }
  })
}

function assertReleaseGates(text, label) {
  // Like the existing deploy guard, split at job indentation; preserve template placeholders.
  const jobs = text.replaceAll('\r\n', '\n').split(/^ {2}[\w-]+:\s*$/m)
  let uploads = 0
  for (const job of jobs) {
    if (!/mirror --reverse/.test(job)) continue
    uploads++
    const build = job.indexOf('run: npm run build')
    const guard = job.indexOf('node scripts/check-dist-private-files.mjs dist')
    const secrets = job.indexOf('gitleaks" dir dist --redact --exit-code 1')
    const upload = job.indexOf('mirror --reverse')
    assert.ok(build >= 0 && guard > build && secrets > guard && upload > secrets, `${label}: build, private-file guard, secret guard, upload must run in order`)
    const step = job.slice(job.lastIndexOf('      - name:', guard), job.indexOf('      - name:', secrets))
    assert.doesNotMatch(step, /continue-on-error:|\|\|\s*true|if:/, `${label}: built-output gate must block`)
    const assets = job.indexOf('run: node scripts/verify-live-assets.mjs')
    const headers = job.indexOf('run: node scripts/check-live-headers.mjs')
    assert.ok(headers > assets && assets > upload, `${label}: GET header gate must follow live-asset verification`)
  }
  assert.ok(uploads, `${label}: no upload jobs found`)
}

test('every deploy variant blocks private bundles and follows asset checks with GET header checks', () => {
  for (const file of filesUnder(directory).filter(file => /^deploy.*\.yml(?:\.template)?$/.test(path.basename(file)))) {
    const source = fs.readFileSync(file, 'utf8')
    assertReleaseGates(source, file)
    for (const command of ['node scripts/check-dist-private-files.mjs dist', 'gitleaks" dir dist --redact --exit-code 1', 'run: node scripts/check-live-headers.mjs']) {
      assert.throws(() => assertReleaseGates(source.replace(command, 'removed gate'), 'mutated'), /must run in order|must follow/)
    }
  }
})

#!/usr/bin/env node
/**
 * RECOGNISE FUNCTIONALITY — the machine that notices what a user can do.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every previous generation of the feature-coverage gate walked ONE direction: for each row a
 * human typed into docs/FEATURES.md, is there a test? None of them ever asked the other question:
 * is the list COMPLETE? That was always left to whoever was typing, which means a functionality
 * nobody wrote down ships untested and every gate stays green.
 *
 * Roger, 2026-09-17: "you do not know, in a new product, how many functions or functionalities it
 * has. This is something that develops over time, and you need to be the one that really asks the
 * question every single time we do anything with a product."
 *
 * So this does not try to know a total. It RECOGNISES — it reads the product (or just the added
 * lines of one change) and lists every distinct thing a user can do. Two modes:
 *
 *   --all                 scan the whole working tree (used to look at a product as it stands)
 *   --diff <gitrange>     scan only ADDED lines in that range (used as a per-change gate)
 *
 * THE UNIT. Roger's own example decides the granularity: clicking a column header to sort a table
 * IS a functionality and needs its own row and its own test. So the unit is not a page and not a
 * component — it is ONE THING A USER CAN DO that could independently break.
 *
 * FAIL CLOSED. Anything that looks interactive but cannot be classified is emitted as
 * `unclassified`. Unclassified is a FAILURE, never a silent pass — a recogniser that quietly drops
 * what it does not understand is the same lie as a test file that exists but never runs.
 *
 * ── WHAT CHANGED after the first run (2026-09-17), and why ──────────────────────────────────
 * The first version was run over a real product and produced three defects, all visible in its own
 * output. All three are fixed here:
 *
 * 1. IT NAMED THINGS BY THEIR HANDLER IDENTIFIER, NOT BY WHAT THE USER SEES. "Click the control
 *    that runs handleSave" is a machine's name, not a functionality; worse, `onClick={() =>
 *    document.getElementById(...)}` was reported as "runs document.getElementById" and
 *    `onClick={hasData ? a : b}` as "runs hasData" — a conditional read as a handler. FIX: the
 *    label now comes from what the user can SEE — the element's own text, its aria-label, its
 *    title, or its t('...') key — and falls back to the handler name only when there is no visible
 *    text at all.
 *
 * 2. IT COUNTED PASS-THROUGH PROPS AS FUNCTIONALITIES. `onClose`, `onCancel`, `onNavigate`,
 *    `onTabClick` are one component handing a callback to another, not a distinct thing a user can
 *    do; they are already counted at the place that supplies them. FIX: a handler whose identifier
 *    matches /^on[A-Z]/ and is NOT defined in the same file is a prop being forwarded, and is
 *    skipped.
 *
 * 3. IT COULD NOT SEE THE ONE EXAMPLE THAT DEFINED THE UNIT. Zero sort controls were found,
 *    because the rules looked for handler NAMES (onSort, setSortBy) and real code rarely uses them.
 *    FIX: sort / filter / pagination are now recognised by SHAPE — a click handler on a table
 *    header cell is a sort control whatever its handler is called, and a state setter whose name
 *    carries sort/order/filter/search/page is recognised wherever it appears.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, relative, sep } from 'path'
import { execFileSync } from 'child_process'

const args = process.argv.slice(2)
const ROOT = argValue('--root') || process.cwd()
const MODE_DIFF = argValue('--diff')
const AS_JSON = args.includes('--json')
// Imported by the fixture suite (recognise-functionality.test.mjs) instead of being run as a CLI.
// Without this the whole scan would execute on import and the tests could never load the rules.
const IS_CLI = process.argv[1] && process.argv[1].endsWith('recognise-functionality.mjs')

function argValue(flag) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : null
}

const CODE_EXT = /\.(tsx|jsx|ts|js)$/
const SKIP_DIR = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'playwright-report',
  'test-results', 'test-screenshots', 'e2e', 'tests', 'test', '__tests__', 'playwright',
])
const SKIP_FILE = /\.(test|spec|d)\.(tsx|jsx|ts|js)$/

function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    if (SKIP_DIR.has(name)) continue
    const full = join(dir, name)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) walk(full, out)
    else if (CODE_EXT.test(name) && !SKIP_FILE.test(name)) out.push(full)
  }
  return out
}

// ── DEFECT 2: which identifiers does this file actually DEFINE? ─────────────────────────────
// A handler called onClose/onCancel that the file never defines is a prop being forwarded from a
// parent. The functionality lives at the parent that supplies it, and is counted there.
function definedIdentifiers(src) {
  const set = new Set()
  const re = /(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?\(/g
  let m
  while ((m = re.exec(src))) set.add(m[1] || m[2])
  return set
}

// ── DEFECT 1: what does the USER see at this point in the file? ─────────────────────────────
// Look at the element that carries the handler and the text immediately inside it.
function visibleLabel(src, at) {
  const window = src.slice(Math.max(0, at - 400), Math.min(src.length, at + 400))
  // an explicit accessible name wins
  const aria = /aria-label=["'`]([^"'`]{2,60})["'`]/.exec(window)
  if (aria) return aria[1].trim()
  const title = /title=["'`]([^"'`]{2,60})["'`]/.exec(window)
  if (title) return title[1].trim()
  // a translation key is how this codebase names user-visible text
  const tkey = /\bt\(\s*["'`]([^"'`]{2,80})["'`]/.exec(window)
  if (tkey) return tkey[1].trim()
  // literal text between tags, e.g. >Download report<
  const text = />\s*([A-Z][^<>{}\n]{2,48}?)\s*</.exec(src.slice(at, Math.min(src.length, at + 400)))
  if (text) return text[1].trim()
  return null
}

function phrase(verb, label, fallback) {
  return label ? `${verb} "${label}"` : fallback
}

// ── recognisers ─────────────────────────────────────────────────────────────────────────────
function recogniseFile(src, file, found, only) {
  const defined = definedIdentifiers(src)
  const lineAt = (i) => src.slice(0, i).split('\n').length
  const add = (kind, label, i) => {
    if (only && !only.has(lineAt(i))) return
    const key = `${kind}::${label}`
    if (!found.has(key)) found.set(key, { kind, label, evidence: [] })
    const e = found.get(key).evidence
    const ref = `${relative(ROOT, file).split(sep).join('/')}:${lineAt(i)}`
    if (e.length < 3 && !e.includes(ref)) e.push(ref)
  }

  // routes
  for (const m of src.matchAll(/<Route\s[^>]*path=["'`]([^"'`]+)["'`]/g)) {
    add('route', `Open the page at ${m[1]}`, m.index)
  }
  // navigation targets
  for (const m of src.matchAll(/<(?:Link|NavLink)\s[^>]*to=["'`]([^"'`]+)["'`]/g)) {
    add('navigation', `Go to ${m[1]}`, m.index)
  }

  // DEFECT 3a — sort by SHAPE: a click handler on a table header cell, whatever it is called.
  for (const m of src.matchAll(/<(?:th|TableHead|Th)\b[^>]*onClick=/g)) {
    const label = visibleLabel(src, m.index)
    add('sort-control', phrase('Sort the table by the column', label, 'Sort the table by a column'), m.index)
  }
  // DEFECT 3b — sort/filter/pagination by the SHAPE OF THE STATE, not by handler name.
  for (const m of src.matchAll(/\bset([A-Z]\w*)\s*\(/g)) {
    const n = m[1].toLowerCase()
    if (/^(sort|order)/.test(n)) add('sort-control', `Change the sort order (${m[1]})`, m.index)
    else if (/^(filter|search|query)/.test(n)) add('filter-control', `Filter or search the list (${m[1]})`, m.index)
    else if (/^(page|pagesize|perpage|offset)/.test(n)) add('pagination', `Move through pages of a list (${m[1]})`, m.index)
  }

  // file upload
  for (const m of src.matchAll(/type=["'`]file["'`]|useDropzone|<Dropzone/g)) {
    add('file-upload', 'Upload a file', m.index)
  }

  // form submit
  for (const m of src.matchAll(/onSubmit=\{?\s*(?:\(\w*\)\s*=>\s*)?([A-Za-z_$][\w$.]*)?/g)) {
    const label = visibleLabel(src, m.index)
    add('form-submit', phrase('Submit the form', label, `Submit the form${m[1] ? ` (${m[1]})` : ''}`), m.index)
  }

  // form fields
  for (const m of src.matchAll(/<(?:input|textarea|select|Input|Textarea|Select|Checkbox|Switch|RadioGroup)\s[^>]*?(?:name|id)=["'`]([^"'`]+)["'`]/g)) {
    add('form-field', `Enter or choose "${m[1]}"`, m.index)
  }

  // clicks and changes — labelled by what the user sees, skipping forwarded props
  for (const m of src.matchAll(/\son(Click|Change|Blur|KeyDown|Toggle)=\{\s*(?:\(\w*\)\s*=>\s*)?([A-Za-z_$][\w$.]*)?/g)) {
    const [, evt, handler] = m
    if (handler) {
      const root = handler.split('.')[0]
      // DEFECT 2: a forwarded prop is counted where it is supplied, not here
      if (/^on[A-Z]/.test(root) && !defined.has(root)) continue
      // DEFECT 1: `document`/`window` expressions and bare conditionals are not handler names
      if (root === 'document' || root === 'window') {
        add('action-click', phrase('Use the in-page control', visibleLabel(src, m.index), 'Use an in-page navigation control'), m.index)
        continue
      }
    }
    const label = visibleLabel(src, m.index)
    const kind = evt === 'Click' ? 'action-click' : 'value-change'
    const verb = evt === 'Click' ? 'Click' : 'Change'
    add(kind, phrase(verb, label, handler ? `${verb} the control that runs ${handler}` : null) || `${verb} an unnamed control`, m.index)
  }

  // FAIL CLOSED — a handler prop shape this file does not know how to name at all
  for (const m of src.matchAll(/\son[A-Z][A-Za-z]+=\{/g)) {
    const known = /\son(Click|Change|Blur|KeyDown|Toggle|Submit)=/.test(m[0])
    if (!known) add('unclassified', `An interactive control this recogniser could not classify (${m[0].trim()})`, m.index)
  }
}

// DEFECT 5 (found 2026-09-17 by running across seven real products): the recogniser could only see
// INTERACTIVE surface, so a content product read as almost empty — predivo returned 21 against 134
// written-down rows because it is a marketing site whose functionality is pages, copy, SEO and
// language, not buttons. Content that a customer reads CAN break on its own (a post stops
// rendering, a translation falls back to the wrong language, a page loses its description and
// drops out of search), so by the written definition it is functionality and must be recognised.
function recogniseContent(found) {
  const add = (kind, label, evidence) => found.set(`${kind}::${label}`, { kind, label, evidence: [evidence] })

  // every article / document a customer can read
  for (const base of ['src/content', 'content', 'content-static', 'src/posts', 'posts']) {
    const dir = join(ROOT, base)
    if (!existsSync(dir)) continue
    const stack = [dir]
    while (stack.length) {
      const d = stack.pop()
      for (const name of readdirSync(d)) {
        const full = join(d, name)
        let st
        try { st = statSync(full) } catch { continue }
        if (st.isDirectory()) { stack.push(full); continue }
        if (!/\.(md|mdx)$/.test(name)) continue
        const rel = relative(ROOT, full).split(sep).join('/')
        add('content-page', `Read the page "${name.replace(/\.(md|mdx)$/, '')}"`, rel)
      }
    }
  }

  // every language the product claims to speak
  for (const base of ['src/locales', 'src/lib/i18n', 'src/i18n', 'public/locales', 'locales']) {
    const dir = join(ROOT, base)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      const m = /^([a-z]{2}(?:-[A-Z]{2})?)(\.[jt]sx?|\.json)?$/.exec(name)
      if (!m) continue
      add('language', `See the product in "${m[1]}"`, `${base}/${name}`)
    }
  }
}

function recogniseSeo(src, file, found) {
  // a page's title/description is what a customer finds it by; losing it is a break nobody sees
  for (const m of src.matchAll(/<(?:Helmet|PageMeta|Seo|SEO)\b|meta\s+name=["'`]description["'`]|document\.title\s*=/g)) {
    const key = `seo-metadata::Find the page in search (title and description)`
    if (!found.has(key)) {
      found.set(key, { kind: 'seo-metadata', label: 'Find the page in search (title and description)', evidence: [] })
    }
    const e = found.get(key).evidence
    const ref = relative(ROOT, file).split(sep).join('/')
    if (e.length < 3 && !e.includes(ref)) e.push(ref)
  }
}

function recogniseEdgeFunctions(found) {
  const dir = join(ROOT, 'supabase', 'functions')
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (name.startsWith('_')) continue
    let st
    try { st = statSync(join(dir, name)) } catch { continue }
    if (!st.isDirectory()) continue
    found.set(`edge-function::Server action: ${name}`, {
      kind: 'edge-function', label: `Server action: ${name}`, evidence: [`supabase/functions/${name}/`],
    })
  }
}

/**
 * The whole rule set, over one file's source. Exported so the fixture suite can assert what is
 * recognised and — just as important — what is NOT.
 */
/**
 * DEFECT 6 (found 2026-09-17 by the proof rig, before Roger saw it): ONE thing a user does was
 * reported as THREE. A column header that sorts produced a `sort-control` from the <th> click, a
 * second `sort-control` from the setSortBy state it changes, and an `action-click` for the same
 * click — so adding the one correct row could never satisfy the gate, and the gate would have been
 * unusable in practice. A gate that cries three times for one action is a gate people switch off.
 *
 * Two collapses, both conservative (they only ever merge things that are the SAME user action):
 *   a) at one source location, a specific kind wins over the generic click/change kinds;
 *   b) sort / filter / pagination collapse to one per file — a screen has one table, and the state
 *      setter and the header click are two halves of the same thing a user does.
 */
const SPECIFIC = ['sort-control', 'filter-control', 'pagination', 'file-upload', 'download-export',
  'form-submit', 'form-field', 'navigation', 'route']
const GENERIC = ['action-click', 'value-change']
const ONE_PER_FILE = ['sort-control', 'filter-control', 'pagination']

function collapse(items) {
  const specificAt = new Set()
  for (const i of items) {
    if (SPECIFIC.includes(i.kind)) for (const e of i.evidence) specificAt.add(e)
  }
  const kept = items.filter((i) => !(GENERIC.includes(i.kind) && i.evidence.every((e) => specificAt.has(e))))

  const seen = new Map()
  const out = []
  for (const i of kept) {
    if (!ONE_PER_FILE.includes(i.kind)) { out.push(i); continue }
    const file = (i.evidence[0] || '').split(':')[0]
    const key = `${i.kind}::${file}`
    if (seen.has(key)) {
      const first = seen.get(key)
      for (const e of i.evidence) if (first.evidence.length < 3 && !first.evidence.includes(e)) first.evidence.push(e)
      continue
    }
    seen.set(key, i)
    out.push(i)
  }
  return out
}

export function recogniseSource(src, file = 'fixture.tsx') {
  const found = new Map()
  recogniseFile(src, file, found, null)
  recogniseSeo(src, file, found)
  return collapse([...found.values()])
}

// ── collect ─────────────────────────────────────────────────────────────────────────────────
const found = new Map()

if (!IS_CLI) {
  // imported: expose the rules, run nothing
} else if (MODE_DIFF) {
  const diff = execFileSync('git', ['diff', '--unified=0', MODE_DIFF], {
    cwd: ROOT, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024,
  })
  const addedLines = new Map() // file -> Set(lineNo)
  let file = null, lineNo = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ b/')) { file = join(ROOT, raw.slice(6)); continue }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw)
    if (hunk) { lineNo = Number(hunk[1]); continue }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      if (file && CODE_EXT.test(file) && !SKIP_FILE.test(file)) {
        if (!addedLines.has(file)) addedLines.set(file, new Set())
        addedLines.get(file).add(lineNo)
      }
      lineNo++
    }
  }
  for (const [f, lines] of addedLines) {
    if (!existsSync(f)) continue
    recogniseFile(readFileSync(f, 'utf-8'), f, found, lines)
  }
} else {
  // DEFECT 4 (found 2026-09-17 by running across six real products, not by eye): the scan root was
  // hardcoded to src/. ChannelMover keeps its screens in app/ and components/ at the repository
  // root, so the recogniser saw 36 things in a product with 41 written-down rows — blind, and
  // silently so. Scan every conventional source root that actually exists.
  const ROOTS = ['src', 'app', 'components', 'pages', 'screens', 'features', 'lib']
    .map((d) => join(ROOT, d))
    .filter((d) => existsSync(d))
  if (ROOTS.length === 0) ROOTS.push(ROOT)
  for (const file of ROOTS.flatMap((d) => walk(d))) {
    const src = readFileSync(file, 'utf-8')
    recogniseFile(src, file, found, null)
    recogniseSeo(src, file, found)
  }
  recogniseEdgeFunctions(found)
  recogniseContent(found)
}

// ── report ──────────────────────────────────────────────────────────────────────────────────
if (!IS_CLI) { /* imported by the tests: no report, no exit */ } else {
const all = collapse([...found.values()]).sort((a, b) =>
  a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind.localeCompare(b.kind))
const unclassified = all.filter((f) => f.kind === 'unclassified')

if (AS_JSON) {
  console.log(JSON.stringify({ total: all.length, unclassified: unclassified.length, items: all }, null, 2))
} else {
  const byKind = new Map()
  for (const f of all) byKind.set(f.kind, (byKind.get(f.kind) || 0) + 1)
  console.log(`RECOGNISED ${all.length} things a user can do in ${relative(process.cwd(), ROOT) || '.'}\n`)
  for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${kind}`)
  }
  console.log('')
  for (const f of all) {
    console.log(`[${f.kind}] ${f.label}`)
    console.log(`        ${f.evidence.join('  ')}`)
  }
}

process.exit(unclassified.length > 0 ? 1 : 0)
}

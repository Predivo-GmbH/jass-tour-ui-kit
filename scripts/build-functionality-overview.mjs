#!/usr/bin/env node
/**
 * THE OVERVIEW — one page where Roger can see what a product actually does and how each thing is
 * checked.
 *
 * Roger, 2026-09-17: "Maybe also an overview somewhere where I can see what exactly you did, what
 * features are there for every product when it's checked, how it's checked, etc."
 *
 * GENERATED, never hand-written. A hand-written overview is just another claim, and this whole
 * system exists because claims were believed for four months. Everything on this page comes from
 * the same two sources the gate itself uses: the register, and the recogniser reading the code.
 *
 * It deliberately shows the uncomfortable parts:
 *   - what the code has that the register does not know about  (the gap that shipped untested)
 *   - what the register claims that the code no longer has     (rows that rotted)
 *   - what the recogniser could not classify at all            (fail-closed, in the open)
 *
 * Usage: node scripts/build-functionality-overview.mjs [--root <dir>] [--out <file.html>]
 */

import { readFileSync, existsSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const args = process.argv.slice(2)
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null }
const ROOT = resolve(val('--root') || process.cwd())
const OUT = resolve(val('--out') || join(ROOT, 'docs', 'FUNCTIONALITY-OVERVIEW.html'))

const product = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).name || 'this product'

// ── what the code has ───────────────────────────────────────────────────────────────────────
// fileURLToPath, never .pathname — see the note in check-new-functionality-registered.mjs
const recogniser = fileURLToPath(new URL('./recognise-functionality.mjs', import.meta.url))
let recognised = { total: 0, unclassified: 0, items: [] }
try {
  recognised = JSON.parse(execFileSync(process.execPath, [recogniser, '--root', ROOT, '--json'], {
    encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024,
  }))
} catch (e) {
  if (e.stdout) recognised = JSON.parse(e.stdout)
}

// ── what the register claims ────────────────────────────────────────────────────────────────
const REGISTRY = ['docs/FEATURES.md', 'docs/FEATURE_REGISTRY.md']
  .map((p) => join(ROOT, p))
  .find((p) => existsSync(p) && /^#{2,3} F-\d{3}:/m.test(readFileSync(p, 'utf-8')))

const rows = []
if (REGISTRY) {
  const reg = readFileSync(REGISTRY, 'utf-8')
  const marks = [...reg.matchAll(/^#{2,3} (F-\d{3}):\s*(.+)$/gm)]
  marks.forEach((m, i) => {
    const body = reg.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : reg.length)
    const status = (/\*\*Status:?\*\*:?\s*([a-z-]+)/i.exec(body) || [])[1] || 'unknown'
    const tests = [...body.matchAll(/`([^`]+\.(?:spec|test)\.[tj]sx?)`/g)].map((t) => t[1])
    rows.push({
      id: m[1], name: m[2].trim(), status, tests,
      missing: tests.filter((t) => !existsSync(join(ROOT, t))),
      speed: tests.some((t) => /e2e|staging|\.spec\./.test(t)) ? 'expensive' : 'cheap',
    })
  })
}

// ── where the two disagree ──────────────────────────────────────────────────────────────────
const STOP = new Set(['click', 'change', 'open', 'the', 'page', 'form', 'control', 'that', 'runs',
  'submit', 'enter', 'choose', 'value', 'server', 'action', 'read', 'see', 'product', 'find',
  'move', 'through', 'pages', 'list', 'something', 'unnamed', 'interactive'])
const toks = (s) => (s.toLowerCase().match(/[a-z0-9_\-/.]{3,}/g) || []).filter((t) => !STOP.has(t))
const regBlob = rows.map((r) => `${r.name} ${r.tests.join(' ')}`).join(' ').toLowerCase()

const inCodeNotRegistered = recognised.items.filter((i) => {
  if (i.kind === 'unclassified') return false
  const t = toks(i.label)
  return t.length > 0 && !t.some((x) => regBlob.includes(x))
})
const unclassified = recognised.items.filter((i) => i.kind === 'unclassified')

const byKind = {}
for (const i of recognised.items) byKind[i.kind] = (byKind[i.kind] || 0) + 1

// ── render ──────────────────────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const pct = rows.length ? Math.round((rows.filter((r) => r.tests.length && !r.missing.length).length / rows.length) * 100) : 0

const html = `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(product)} — what it does, and how each thing is checked</title>
<style>
 :root{--bg:#fbfbfa;--fg:#1a1a18;--dim:#6b6b66;--line:#e4e4e0;--bad:#b4341f;--ok:#1f6b3f;--warn:#8a6d00;--card:#fff}
 @media(prefers-color-scheme:dark){:root{--bg:#161615;--fg:#eceae6;--dim:#a0a09a;--line:#2e2e2b;--bad:#ff8a70;--ok:#6fd695;--warn:#e8c14a;--card:#1e1e1c}}
 body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
 main{max-width:60rem;margin:0 auto;padding:2.5rem 1.25rem 5rem}
 h1{font-size:1.6rem;margin:0 0 .25rem} h2{font-size:1.05rem;margin:2.5rem 0 .6rem;letter-spacing:.01em}
 .sub{color:var(--dim);margin:0 0 2rem}
 .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.75rem}
 .tile{background:var(--card);border:1px solid var(--line);border-radius:.6rem;padding:.9rem 1rem}
 .tile b{display:block;font-size:1.6rem;font-weight:650;line-height:1.1}
 .tile span{color:var(--dim);font-size:.82rem}
 table{border-collapse:collapse;width:100%;font-size:.88rem;background:var(--card);border:1px solid var(--line);border-radius:.6rem;overflow:hidden}
 th,td{text-align:left;padding:.5rem .7rem;border-bottom:1px solid var(--line);vertical-align:top}
 th{font-weight:600;color:var(--dim);font-size:.78rem;text-transform:uppercase;letter-spacing:.04em}
 tr:last-child td{border-bottom:0}
 code{font:12.5px ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dim)}
 .bad{color:var(--bad);font-weight:600}.ok{color:var(--ok);font-weight:600}.warn{color:var(--warn);font-weight:600}
 .wrap{overflow-x:auto}
 .note{color:var(--dim);font-size:.85rem;margin:.4rem 0 1rem}
</style>
<main>
<h1>${esc(product)} — what it does, and how each thing is checked</h1>
<p class="sub">Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} from the code and the register. Nothing here is typed by hand.</p>

<div class="tiles">
 <div class="tile"><b>${recognised.total}</b><span>things a user can do, found in the code</span></div>
 <div class="tile"><b>${rows.length}</b><span>written down in the register</span></div>
 <div class="tile"><b class="${inCodeNotRegistered.length ? 'bad' : 'ok'}">${inCodeNotRegistered.length}</b><span>in the code, <strong>not</strong> written down</span></div>
 <div class="tile"><b class="${unclassified.length ? 'warn' : 'ok'}">${unclassified.length}</b><span>could not be classified at all</span></div>
 <div class="tile"><b class="${pct === 100 ? 'ok' : 'warn'}">${pct}%</b><span>of written-down rows have a test file that exists</span></div>
</div>

<h2>What is written down, and how it is checked</h2>
${rows.length ? `<div class="wrap"><table>
<tr><th></th><th>What the user can do</th><th>Status</th><th>Checked by</th><th>Speed</th></tr>
${rows.map((r) => `<tr>
 <td><code>${r.id}</code></td>
 <td>${esc(r.name)}</td>
 <td>${esc(r.status)}</td>
 <td>${r.tests.length
    ? r.tests.map((t) => `<code${r.missing.includes(t) ? ' class="bad"' : ''}>${esc(t)}</code>`).join('<br>')
    : '<span class="bad">nothing</span>'}</td>
 <td>${r.tests.length ? (r.speed === 'expensive' ? 'runs when the change can reach it' : 'runs on every deploy') : '<span class="bad">—</span>'}</td>
</tr>`).join('\n')}
</table></div>` : '<p class="bad">This product has no feature register with a single F-XXX row.</p>'}

<h2>In the code, not written down — these ship with nobody checking them</h2>
<p class="note">Found by reading the product. Each one can break on its own and no test would notice.</p>
${inCodeNotRegistered.length ? `<div class="wrap"><table>
<tr><th>Kind</th><th>What the user can do</th><th>Where</th></tr>
${inCodeNotRegistered.map((i) => `<tr><td><code>${esc(i.kind)}</code></td><td>${esc(i.label)}</td><td><code>${esc(i.evidence.join(' '))}</code></td></tr>`).join('\n')}
</table></div>` : '<p class="ok">Nothing. Everything the code offers is written down.</p>'}

${unclassified.length ? `<h2>Could not be classified — refused rather than ignored</h2>
<p class="note">The recogniser will not pass what it does not understand. Each of these is either a functionality that needs a row, or a shape the recogniser must be taught with a fixture.</p>
<div class="wrap"><table>
<tr><th>What</th><th>Where</th></tr>
${unclassified.map((i) => `<tr><td>${esc(i.label)}</td><td><code>${esc(i.evidence.join(' '))}</code></td></tr>`).join('\n')}
</table></div>` : ''}

<h2>What was found, by kind</h2>
<div class="wrap"><table><tr><th>Kind</th><th>Count</th></tr>
${Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<tr><td><code>${esc(k)}</code></td><td>${n}</td></tr>`).join('\n')}
</table></div>

<p class="note" style="margin-top:2.5rem">What counts as a functionality is defined in <code>docs/WHAT-COUNTS-AS-A-FUNCTIONALITY.md</code>: something that can break on its own and that a customer would notice. If it is unclear, it counts.</p>
</main>`

writeFileSync(OUT, html)
console.log(`Overview written: ${OUT}`)
console.log(`  ${recognised.total} found in code | ${rows.length} written down | ${inCodeNotRegistered.length} not written down | ${unclassified.length} unclassified`)

#!/usr/bin/env node
// A DEPLOY NEVER DELETES A FILE THE LIVE SITE NEEDS, AND NEVER CALLS A BROKEN PAGE "ALIVE"
// (SignalScore incident 2026-10-02 -> 2026-10-05: signalscore.ch unstyled for three days).
//
//   node <this file>          (also runs under `node --test`; discovered by the scripts/*.test.mjs glob in test.yml)
//
// SignalScore's production run 37064814970 uploaded assets with `mirror --ignore-time` (an unchanged file is not
// re-sent, so it keeps its old server timestamp), then "Prune stale assets" deleted everything older
// than 14 days - including the stylesheet the new index.html linked. "Verify production is alive"
// only asked whether the home page answered 200, so it passed. Three guards close that, and this file
// proves each one, against a local server that reproduces the incident byte for byte:
//
//   1. scripts/verify-live-assets.mjs fails on "HTML 200, stylesheet 404" and names the file;
//   2. every "Prune stale assets" step in deploy.yml skips files present in ./dist/assets and deletes
//      nothing when ./dist/assets is missing;
//   3. the production deploy job verifies with verify-live-assets.mjs, AFTER the prune.
// The Beize Jass Tour runs the same age-based prune in its production deploy (deploy.yml; there is no
// staging deploy). Its upload does not use --ignore-time today, so the trap is not armed - but four
// fleet repos switched to --ignore-time on 2026-09-16 to make the upload faster, and the prune must
// stay safe the day someone does it here.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { referencedFiles, buildFingerprint, checkOnce } from './verify-live-assets.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
// CRLF in a Windows checkout must not change the verdict.
const WORKFLOWS = ['deploy.yml']
const workflow = (f) => fs.readFileSync(path.join(here, '..', '.github', 'workflows', f), 'utf8').replace(/\r\n/g, '\n')

const PAGE = (css, js) => `<!doctype html><html><head>
<link rel="canonical" href="https://signalscore.ch/de">
<link rel="alternate" hreflang="en" href="https://signalscore.ch">
<link rel="preconnect" href="https://ogdpgufptemcgyszmjek.supabase.co">
<link rel="preload" href="/fonts/inter-variable.woff2" as="font" crossorigin>
<script type="module" crossorigin src="${js}"></script>
<link rel="modulepreload" crossorigin href="/assets/react-vendor-Cf7uXjOc.js">
<link rel="stylesheet" crossorigin href="${css}">
<script src="https://eu-assets.i.posthog.com/static/array.js"></script>
</head><body><div id="root"></div></body></html>`

const LIVE = PAGE('/assets/index-CQEfUcOE.css', '/assets/index-BJnQv9jK.js')

// files: path -> [status, content-type]; anything absent answers like this host does: 404 text/html.
function serve(files) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname
      const hit = files[p]
      if (!hit) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>Page Not Found</h1>'); return }
      res.writeHead(hit[0], { 'content-type': hit[1] }); res.end(hit[2] ?? 'x')
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }))
  })
}
const healthy = {
  '/': [200, 'text/html', LIVE],
  '/de': [200, 'text/html', LIVE],
  '/assets/index-CQEfUcOE.css': [200, 'text/css'],
  '/assets/index-BJnQv9jK.js': [200, 'application/javascript'],
  '/assets/react-vendor-Cf7uXjOc.js': [200, 'application/javascript'],
  '/fonts/inter-variable.woff2': [200, 'font/woff2'],
}

test('referencedFiles: same-origin files only, never canonical/alternate/preconnect or third parties', () => {
  const got = referencedFiles(LIVE, 'https://signalscore.ch/de').map((u) => new URL(u).pathname)
  assert.deepEqual(got, ['/assets/index-BJnQv9jK.js', '/assets/index-CQEfUcOE.css', '/assets/react-vendor-Cf7uXjOc.js', '/fonts/inter-variable.woff2'])
})

test('THE INCIDENT: page answers 200 but its stylesheet is gone -> reported, naming the file', async () => {
  const files = { ...healthy }
  delete files['/assets/index-CQEfUcOE.css']
  const { server, base } = await serve(files)
  try {
    const problems = await checkOnce({ base, pages: ['/', '/de'] })
    assert.equal(problems.length, 2, problems.join('\n'))
    for (const p of problems) assert.match(p, /\/assets\/index-CQEfUcOE\.css HTTP 404/)
  } finally { server.close() }
})

test('a stylesheet "found" as an HTML fallback page (SPA rewrite) is still missing', async () => {
  const { server, base } = await serve({ ...healthy, '/assets/index-CQEfUcOE.css': [200, 'text/html'] })
  try {
    const problems = await checkOnce({ base, pages: ['/'] })
    assert.deepEqual(problems, ['/: /assets/index-CQEfUcOE.css served as text/html, not css'])
  } finally { server.close() }
})

test('a page that links no stylesheet at all is reported', async () => {
  const bare = '<!doctype html><html><head><script type="module" src="/assets/index-BJnQv9jK.js"></script></head></html>'
  const { server, base } = await serve({ ...healthy, '/': [200, 'text/html', bare] })
  try {
    assert.deepEqual(await checkOnce({ base, pages: ['/'] }), ['/: links no stylesheet at all'])
  } finally { server.close() }
})

test('everything present -> no problems (the check is not simply always red)', async () => {
  const { server, base } = await serve(healthy)
  try {
    assert.deepEqual(await checkOnce({ base, pages: ['/', '/de'], distHtml: LIVE }), [])
  } finally { server.close() }
})

test('the live home page is a DIFFERENT build than the one just uploaded -> reported', async () => {
  const { server, base } = await serve(healthy)
  try {
    const newBuild = PAGE('/assets/index-NEWHASH1.css', '/assets/index-NEWHASH2.js')
    const problems = await checkOnce({ base, pages: ['/'], distHtml: newBuild })
    assert.equal(problems.length, 1)
    assert.match(problems[0], /not the build just uploaded/)
    assert.deepEqual(buildFingerprint(newBuild), { css: ['/assets/index-NEWHASH1.css'], js: ['/assets/index-NEWHASH2.js'] })
  } finally { server.close() }
})

// ---- the workflow itself ---------------------------------------------------------------------
// Steps are split on "      - name:" (six spaces: a step inside a job). No YAML library, so this
// runs before `npm ci` as well.
function steps(src) {
  const out = []
  let cur = null
  for (const line of src.split('\n')) {
    const m = line.match(/^ {6}- name:\s*(.+)$/)
    if (m) { cur = { name: m[1].trim().replace(/^['"]|['"]$/g, ''), body: '' }; out.push(cur) } else if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(line)) { cur = null; out.push({ job: line.trim().slice(0, -1) }) } else if (cur) cur.body += line + '\n'
  }
  return out
}
const all = WORKFLOWS.flatMap((f) => steps(workflow(f)))
function jobSteps(job) {
  const i = all.findIndex((s) => s.job === job)
  assert.ok(i > -1, `job ${job} not found in ${WORKFLOWS.join(' / ')}`)
  const rest = all.slice(i + 1)
  const end = rest.findIndex((s) => s.job)
  return end === -1 ? rest : rest.slice(0, end)
}

test('every prune step protects the files of the build just uploaded', () => {
  const prunes = all.filter((s) => s.name && /prune/i.test(s.name))
  assert.ok(prunes.length >= 1, `expected the production prune step, found ${prunes.length}`)
  for (const p of prunes) {
    assert.match(p.body, /\[ -e "\.\/dist\/assets\/\$rel" \] && continue/, `"${p.name}" can delete a file the current build contains`)
    assert.match(p.body, /if \[ ! -d \.\/dist\/assets \]/, `"${p.name}" would prune blind when ./dist/assets is missing`)
    // With nothing left to probe, an empty MDTM run must not read as "the server does not support MDTM".
    assert.match(p.body, /if ! grep -q '\^quote MDTM ' "\$PROBE_SCRIPT"; then/, `"${p.name}" raises a false MDTM alarm when every file belongs to the build just uploaded`)
  }
})

for (const [job, base] of [['deploy', 'https://beize-jass-tour.mueller.ro']]) {
  test(`${job}: verifies every file the live pages need, AFTER the prune`, () => {
    const s = jobSteps(job)
    const prune = s.findIndex((x) => /prune/i.test(x.name || ''))
    // The invocation line, not a mention: the prune step's own comment names the script too.
    const verify = s.findIndex((x) => /^\s*run: node scripts\/verify-live-assets\.mjs /m.test(x.body || ''))
    assert.ok(verify > -1, `${job} never runs scripts/verify-live-assets.mjs`)
    assert.ok(prune > -1 && verify > prune, `${job} must verify AFTER "Prune stale assets" - it has to see what the prune left`)
    assert.ok(s[verify].body.includes(`--base ${base}`), `${job} verifies the wrong site`)
    assert.ok(s[verify].body.includes('--dist dist'), `${job} does not check that the live page is the build just uploaded`)
    assert.ok(!/continue-on-error:\s*true/.test(s[verify].body), `${job}: the asset check must be able to fail the deploy`)
  })
}

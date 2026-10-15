#!/usr/bin/env node
/**
 * EVERY FILE THE LIVE PAGE NEEDS MUST ACTUALLY LOAD (incident 2026-10-02 -> 2026-10-05).
 *
 *   node scripts/verify-live-assets.mjs --base https://signalscore.ch --pages /,/de,/pricing --dist dist
 *   VERIFY_BASIC_AUTH=user:pass node scripts/verify-live-assets.mjs --base https://staging... (staging)
 *
 * WHAT HAPPENED. Production run 37064814970 (2026-10-02 21:06Z) uploaded hashed assets with
 * `mirror --ignore-time`, which skips a file whose size already matches on the server. The
 * stylesheet index-CQEfUcOE.css had not changed for weeks, so it was skipped and its server
 * timestamp stayed old. Two minutes later "Prune stale assets" deleted every file in assets/
 * older than 14 days - 659 of them - including that stylesheet, which the index.html just
 * uploaded still pointed at. signalscore.ch rendered as unstyled text for three days.
 *
 * The step that should have caught it, "Verify production is alive", asked one question: does
 * https://signalscore.ch answer HTTP 200. It did - the HTML was fine, only the file it needs was
 * gone. A 200 on the HTML says nothing about whether the page works.
 *
 * WHAT THIS CHECKS, per page, against the live site:
 *   1. the page answers 200;
 *   2. every same-origin file the page references (stylesheets, scripts, modulepreloads, preloaded
 *      fonts, icons) answers 200, and a .css/.js answers with a css/javascript content type - this
 *      host serves its 404 page as text/html with a 404, and an SPA fallback would serve it with a
 *      200, so the content type is what tells "the file" from "a page saying it is missing";
 *   3. with --dist: the live home page links the SAME stylesheet and entry script as the build we
 *      just uploaded. Otherwise a deploy whose HTML never landed would check the previous build's
 *      files and pass.
 * It retries (default 6 x 15s) so a slow propagation is not a false alarm, and fails with the
 * exact missing paths otherwise. It exports its pieces for scripts/deploy-never-deletes-live-assets.test.mjs.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const NOT_FILES = /\brel\s*=\s*["'](?:canonical|alternate|preconnect|dns-prefetch)["']/i

/** Every same-origin file an HTML document references through <link href> or <script src>. */
export function referencedFiles(html, pageUrl) {
  const origin = new URL(pageUrl).origin
  const out = new Set()
  const re = /<(?:link|script)\b[^>]*?\b(?:href|src)\s*=\s*["']([^"']+)["'][^>]*>/gi
  let m
  while ((m = re.exec(html))) {
    if (NOT_FILES.test(m[0])) continue
    let u
    try { u = new URL(m[1], pageUrl) } catch { continue }
    if (u.origin !== origin) continue
    u.search = ''
    u.hash = ''
    out.add(u.href)
  }
  return [...out].sort()
}

/** The stylesheet(s) and module entry script(s) a document links - the build's fingerprint. */
export function buildFingerprint(html) {
  const css = [...html.matchAll(/<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>/gi)]
    .map((t) => (t[0].match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1]).filter(Boolean)
  const js = [...html.matchAll(/<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>/gi)]
    .map((t) => (t[0].match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1]).filter(Boolean)
  return { css: css.sort(), js: js.sort() }
}

function contentTypeProblem(url, status, contentType) {
  if (status !== 200) return `HTTP ${status}`
  const path = new URL(url).pathname
  if (path.endsWith('.css') && !/css/i.test(contentType)) return `served as ${contentType || 'nothing'}, not css`
  if (/\.m?js$/.test(path) && !/javascript|ecmascript/i.test(contentType)) return `served as ${contentType || 'nothing'}, not javascript`
  return null
}

/** One pass over the pages. Returns a list of problems; empty means everything loads. */
export async function checkOnce({ base, pages, distHtml, headers = {}, fetchImpl = fetch }) {
  const problems = []
  const bust = `verify=${Date.now()}`
  for (const page of pages) {
    const pageUrl = new URL(page, base).href
    let res, html
    try {
      res = await fetchImpl(`${pageUrl}${pageUrl.includes('?') ? '&' : '?'}${bust}`, { headers: { ...headers, 'cache-control': 'no-cache' }, redirect: 'follow' })
      html = await res.text()
    } catch (e) {
      problems.push(`${page}: page could not be fetched (${e.message})`)
      continue
    }
    if (res.status !== 200) { problems.push(`${page}: page answered HTTP ${res.status}`); continue }

    const files = referencedFiles(html, pageUrl)
    if (!files.some((f) => new URL(f).pathname.endsWith('.css'))) problems.push(`${page}: links no stylesheet at all`)
    await Promise.all(files.map(async (f) => {
      try {
        const r = await fetchImpl(f, { headers: { ...headers, 'cache-control': 'no-cache' } })
        await r.arrayBuffer()
        const why = contentTypeProblem(f, r.status, r.headers.get('content-type') || '')
        if (why) problems.push(`${page}: ${new URL(f).pathname} ${why}`)
      } catch (e) {
        problems.push(`${page}: ${new URL(f).pathname} could not be fetched (${e.message})`)
      }
    }))

    if (distHtml && new URL(pageUrl).pathname === '/') {
      const live = buildFingerprint(html)
      const built = buildFingerprint(distHtml)
      if (JSON.stringify(live) !== JSON.stringify(built)) {
        problems.push(`/: the live page is not the build just uploaded (live css ${live.css.join(',') || 'none'} js ${live.js.join(',') || 'none'}; built css ${built.css.join(',')} js ${built.js.join(',')})`)
      }
    }
  }
  return problems.sort()
}

export async function verify({ attempts = 6, delayMs = 15000, log = console.log, ...opts }) {
  let problems = []
  for (let i = 1; i <= attempts; i++) {
    problems = await checkOnce(opts)
    if (problems.length === 0) {
      log(`Live assets OK: ${opts.pages.length} page(s) on ${opts.base}, every referenced file loads (attempt ${i}).`)
      return []
    }
    if (i < attempts) {
      log(`::warning::Live-asset check attempt ${i}/${attempts}: ${problems.length} problem(s) - retrying in ${delayMs / 1000}s`)
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  return problems
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const base = arg('base')
  if (!base) { console.error('::error::verify-live-assets: --base is required'); process.exit(2) }
  const pages = arg('pages', '/').split(',').map((p) => p.trim()).filter(Boolean)
  const dist = arg('dist')
  let distHtml
  if (dist) {
    const p = join(dist, 'index.html')
    if (!existsSync(p)) { console.error(`::error::verify-live-assets: ${p} does not exist - cannot tell which build should be live`); process.exit(2) }
    distHtml = readFileSync(p, 'utf8')
  }
  const headers = {}
  if (process.env.VERIFY_BASIC_AUTH) headers.authorization = `Basic ${Buffer.from(process.env.VERIFY_BASIC_AUTH).toString('base64')}`
  const problems = await verify({
    base, pages, distHtml, headers,
    attempts: Number(arg('attempts', '6')),
    delayMs: Number(arg('delay-ms', '15000')),
  })
  if (problems.length) {
    console.error(`::error::The live site is missing files its pages need (${problems.length}):`)
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }
}

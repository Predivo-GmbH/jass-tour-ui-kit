#!/usr/bin/env node
// SR-HDR-01/02, SR-HOST-11: visitor GETs only. Plesk can send headers on HEAD but omit them on GET.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout } from 'node:timers/promises'
import { scannerPath } from './lib/scanner-path.mjs'

export const requiredHeaders = ['strict-transport-security', 'x-frame-options', 'x-content-type-options',
  'referrer-policy', 'permissions-policy', 'content-security-policy']

export function visitorUrl(value, base) {
  // Check BEFORE URL erases traversal, and again after resolution. Never follow a redirect implicitly.
  if (scannerPath(value) || /[\s\\]/.test(value)) throw new Error('Refuse scanner-style or malformed request path')
  const url = new URL(value, base)
  if (url.origin !== new URL(base).origin || !/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error('Refuse cross-origin request or URL credentials')
  }
  if (scannerPath(url.pathname)) throw new Error('Refuse scanner-style request path')
  url.hash = ''
  return url.href
}

// Decode HTML attribute entities before URL validation, so encoded paths cannot bypass the scanner guard.
function attribute(tag, name) {
  const raw = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  if (!raw) return undefined
  return (raw[1] ?? raw[2] ?? raw[3]).replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_, entity) => {
    if (entity.startsWith('#')) {
      const code = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
      return code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd'
    }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[entity.toLowerCase()]
  })
}

export function firstAssets(html, homeUrl) {
  const out = {}
  // Only opening tags count; comments and inline script text are not linked resources.
  const document = html.replace(/<!--[\s\S]*?-->/g, '').replace(/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi, '$1</script>')
  for (const match of document.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const kind = match[1].toLowerCase() === 'script' ? 'script' : 'stylesheet'
    if (out[kind]) continue
    if (kind === 'stylesheet' && !/\bstylesheet\b/i.test(attribute(match[0], 'rel') ?? '')) continue
    const raw = attribute(match[0], kind === 'script' ? 'src' : 'href')
    if (!raw) continue
    const url = new URL(raw, homeUrl)
    if (url.origin !== new URL(homeUrl).origin) continue
    out[kind] = visitorUrl(raw, homeUrl)
  }
  return out
}

function headerProblems(response, label) {
  const problems = []
  for (const header of requiredHeaders) {
    if (!response.headers.get(header)?.trim()) problems.push(`${label}: missing ${header}`)
  }
  const hsts = response.headers.get('strict-transport-security') ?? ''
  const age = /(?:^|;)\s*max-age\s*=\s*(\d+)\s*(?=;|$)/i.exec(hsts)?.[1]
  if (!age || Number(age) < 31536000) problems.push(`${label}: HSTS max-age must be at least 31536000`)
  return problems
}

/** One pass, with injected transport and clock for offline tests. No retry or automatic redirects. */
export async function checkOnce({ base, pages = ['/'], headers = {}, fetchImpl = fetch, waitImpl = setTimeout }) {
  if (new URL(base).protocol !== 'https:') throw new Error('The header check requires an HTTPS base')
  visitorUrl(base, base)
  // Validate ALL configured paths before the first request; always read home for linked CSS and JS.
  const urls = [...new Set(['/', ...pages].map(page => visitorUrl(page, base)))]
  const problems = []
  let homeHtml = ''
  const homeUrl = visitorUrl('/', base)
  const get = async (url, html) => {
    const label = new URL(url).pathname
    await waitImpl(1000)
    const response = await fetchImpl(url, {
      method: 'GET', redirect: 'manual', headers: { ...headers, 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(30000),
    })
    // Finish every body before waiting/requesting again, as in mitchind's checkOnce regression.
    const body = html ? await response.text() : await response.arrayBuffer()
    if (response.status !== 200) problems.push(`${label}: HTTP ${response.status} (redirects are not followed)`)
    problems.push(...headerProblems(response, label))
    return body
  }
  for (const url of urls) {
    const body = await get(url, true)
    if (url === homeUrl) homeHtml = body
  }
  const assets = firstAssets(homeHtml, homeUrl)
  for (const kind of ['script', 'stylesheet']) {
    if (!assets[kind]) problems.push(`/: links no same-origin ${kind}`)
    else await get(assets[kind], false)
  }
  return problems
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {}
    for (let i = 2; i < process.argv.length; i += 2) {
      const name = process.argv[i]
      if (!['--base', '--pages'].includes(name) || !process.argv[i + 1]) throw new Error('Expected --base URL --pages /,/pricing')
      options[name.slice(2)] = process.argv[i + 1]
    }
    if (!options.base) throw new Error('Expected --base https://beize-jass-tour.mueller.ro --pages /')
    const headers = {}
    if (process.env.VERIFY_BASIC_AUTH) headers.authorization = `Basic ${Buffer.from(process.env.VERIFY_BASIC_AUTH).toString('base64')}`
    const problems = await checkOnce({ base: options.base, pages: (options.pages ?? '/').split(','), headers })
    if (problems.length) throw new Error(problems.join('\n'))
    console.log('GET header checks passed for pages and home-page script/stylesheet.')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

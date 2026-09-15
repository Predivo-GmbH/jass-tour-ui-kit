/**
 * csp-allows-turnstile.test.ts — the site's Content-Security-Policy must let the sign-in captcha
 * exist at all.
 *
 * Measured live on 2026-09-15: captcha was switched on for production at 08:01Z, the bundle carried
 * the Turnstile site key and every build and deploy check was green — and a real browser on the
 * Login tab logged `Loading the script 'https://challenges.cloudflare.com/turnstile/v0/api.js'
 * violates the following Content Security Policy directive: "script-src 'self'"`. No widget, no
 * token, so every email+password login and every registration was refused by GoTrue.
 *
 * Turnstile loads a script from challenges.cloudflare.com, renders a cross-origin iframe from the
 * same host and talks back to it. Each of those three directives is checked through its own CSP
 * fallback chain (frame-src -> child-src -> default-src), the same rule production-monitor's
 * scripts/lib/turnstile-csp.mjs applies fleet-wide.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const TURNSTILE_HOST = 'challenges.cloudflare.com'

function cspFromHtaccess(): string {
  const htaccess = readFileSync(path.resolve(__dirname, '../../public/.htaccess'), 'utf8')
  const m = htaccess.match(/Header set Content-Security-Policy "([^"]+)"/)
  if (!m) throw new Error('public/.htaccess sets no Content-Security-Policy header — this test no longer knows what it guards')
  return m[1]
}

function directives(csp: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const part of csp.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/)
    if (name && !map.has(name.toLowerCase())) map.set(name.toLowerCase(), values)
  }
  return map
}

function effective(map: Map<string, string[]>, chain: string[]): string[] | undefined {
  for (const name of chain) if (map.has(name)) return map.get(name)
  return undefined
}

describe('the CSP lets the Turnstile sign-in captcha load', () => {
  const map = directives(cspFromHtaccess())

  it.each([
    ['script-src', ['script-src', 'default-src']],
    ['frame-src', ['frame-src', 'child-src', 'default-src']],
    ['connect-src', ['connect-src', 'default-src']],
  ])('%s allows challenges.cloudflare.com', (_name, chain) => {
    const values = effective(map, chain)
    // An absent directive with no default-src is unrestricted, which is fine.
    if (values === undefined) return
    expect(values.some((v) => v.includes(TURNSTILE_HOST))).toBe(true)
  })

  it('still refuses scripts from anywhere else', () => {
    const script = effective(map, ['script-src', 'default-src']) ?? []
    expect(script).not.toContain('*')
    expect(script).not.toContain('https:')
    expect(script).not.toContain("'unsafe-inline'")
  })
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const root = new URL('../../', import.meta.url)
const read = file => readFileSync(new URL(file, root), 'utf8')

test('Jass CSP permits its actual integrations without opening unrelated Supabase projects', () => {
  const config = read('public/.htaccess')
  const csp = /Header always set Content-Security-Policy "([^"]+)"/.exec(config)[1]
  const directives = new Map(csp.split(';').map(part => {
    const [name, ...values] = part.trim().split(/\s+/)
    return [name, values]
  }))
  for (const name of ['script-src', 'connect-src', 'frame-src']) {
    assert.ok(directives.get(name).includes('https://challenges.cloudflare.com'), name)
  }
  assert.deepEqual(directives.get('connect-src'), ["'self'", 'https://challenges.cloudflare.com',
    'https://uyksotlmrlxhmyeopktl.supabase.co', 'wss://uyksotlmrlxhmyeopktl.supabase.co'])
  for (const name of ['object-src', 'base-uri', 'frame-ancestors']) assert.deepEqual(directives.get(name), ["'none'"])
  assert.deepEqual(directives.get('form-action'), ["'self'"])
  assert.match(config, /Header always set Cross-Origin-Opener-Policy "same-origin"/)
  assert.match(config, /Header always unset X-Powered-By/)
  assert.doesNotMatch(config, /X-XSS-Protection|Expect-CT|Feature-Policy/)
  assert.match(config, /Strict-Transport-Security "max-age=63072000; includeSubDomains"/)
})

test('referrer and cache policies protect token landing pages and stable PWA entry files', () => {
  const config = read('public/.htaccess')
  assert.match(config, /Header always set Referrer-Policy "same-origin"/)
  const [block, pattern] = /<If "%\{THE_REQUEST\} =~ m#([^#]+)#">\s*Header always set Referrer-Policy "no-referrer"\s*<\/If>/.exec(config)
  assert.ok(block)
  const tokenPath = new RegExp(pattern)
  for (const page of ['/', '/auth', '/auth/', '/?code=fixture', '/auth?code=fixture']) assert.ok(tokenPath.test(`GET ${page} HTTP/1.1`))
  for (const page of ['/history', '/settings', '/rangliste', '/session', '/index.html']) assert.equal(tokenPath.test(`GET ${page} HTTP/1.1`), false)
  assert.match(config, /Cache-Control "no-cache, no-store, must-revalidate"/)
  assert.match(config, /Cache-Control "public, max-age=31536000, immutable"/)
  const stable = /<FilesMatch "([^"\n]*registerSW[^"\n]*)">\s*Header set Cache-Control "no-cache, must-revalidate"/.exec(config)
  assert.ok(stable)
  for (const name of ['sw.js', 'registerSW.js', 'manifest.webmanifest']) assert.ok(new RegExp(stable[1]).test(name))
})

test('security.txt uses the retrieved contact and the product canonical URL for less than a year', () => {
  const text = read('public/.well-known/security.txt')
  assert.match(text, /^Contact: mailto:security@predivo\.ch$/m)
  assert.match(text, /^Canonical: https:\/\/beize-jass-tour\.mueller\.ro\/\.well-known\/security\.txt$/m)
  const expires = Date.parse(/^Expires: (.+)$/m.exec(text)[1])
  assert.equal(expires, Date.parse('2027-11-03T00:00:00Z'))
  assert.ok(expires - Date.parse('2026-11-04T00:00:00Z') < 365 * 86400000)
})

test('password-verification answers and error paths are never cached (offline handler)', async () => {
  const source = read('supabase/functions/verify-jass-password/index.ts').replace(/^import .*;\r?\n/, '')
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  let handler
  let configured = true
  vm.runInNewContext(code, { serve: fn => { handler = fn }, Request, Response,
    Deno: { env: { get: () => configured ? 'offline-fixture' : undefined } }, console: { error() {} } })
  const cases = [
    { method: 'OPTIONS', status: 200 },
    { method: 'POST', body: JSON.stringify({ password: 'offline-fixture' }), status: 200, valid: true },
    { method: 'POST', body: JSON.stringify({ password: 'incorrect' }), status: 200, valid: false },
    { method: 'POST', body: 'invalid json', status: 400, valid: false },
    { method: 'POST', body: '{}', status: 500, valid: false, missingConfig: true },
  ]
  for (const { status, valid, missingConfig, ...init } of cases) {
    configured = !missingConfig
    const response = await handler(new Request('https://example.invalid/', init))
    assert.equal(response.status, status)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.ok(response.headers.has('access-control-allow-origin'))
    if (valid !== undefined) assert.equal((await response.json()).valid, valid)
  }
})

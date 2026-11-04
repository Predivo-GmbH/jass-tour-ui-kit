// SR-HOST-02/03, SR-HDR-01..05: offline denial and browser-header regressions.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const results = path.join(root, 'test-results')
fs.mkdirSync(results, { recursive: true })

function readPublicHtaccess() {
  const publicFile = path.join(root, 'public/.htaccess')
  if (fs.existsSync(publicFile)) return fs.readFileSync(publicFile, 'utf8')
  // The starter keeps its placeholders in .template; exercise the renamed file in an isolated fixture.
  const fixture = fs.mkdtempSync(path.join(results, 'security-public-'))
  try {
    fs.mkdirSync(path.join(fixture, 'public'))
    fs.copyFileSync(path.join(root, 'public/.htaccess.template'), path.join(fixture, 'public/.htaccess'))
    return fs.readFileSync(path.join(fixture, 'public/.htaccess'), 'utf8')
  } finally { fs.rmSync(fixture, { recursive: true, force: true }) }
}

const requiredHeaders = ['Strict-Transport-Security', 'X-Frame-Options', 'X-Content-Type-Options',
  'Referrer-Policy', 'Permissions-Policy', 'Content-Security-Policy']

function assertBrowserHeaders(text) {
  // A token-path override cannot stand in for the header required on EVERY response.
  const active = text.split(/\r?\n/).filter(line => !/^\s*#/.test(line)).join('\n')
    .replace(/<If\s[^>]*>[\s\S]*?<\/If>/g, '')
  for (const header of requiredHeaders) {
    assert.match(active, new RegExp(`^\\s*Header always set ${header} "[^"\\r\\n]+"\\s*$`, 'mi'),
      `${header} must use Header always set, including on errors and redirects`)
    assert.doesNotMatch(active, new RegExp(`^\\s*Header set ${header}\\b`, 'mi'), `${header} must not use plain Header set`)
  }
  assert.match(active, /^\s*Options -Indexes\s*$/m, 'Options -Indexes must prevent directory listings')
  const csp = /^\s*Header always set Content-Security-Policy "([^"]+)"/mi.exec(active)?.[1] ?? ''
  const script = /(?:^|;)\s*script-src\s+([^;]+)/i.exec(csp)?.[1]
  assert.ok(script, 'CSP must have an explicit script-src')
  assert.doesNotMatch(script, /'unsafe-(?:inline|eval)'|\*|(?:^|\s)https?:(?=\s|$)/i, 'script-src must forbid unsafe script sources')
}

// Evaluate the deny expressions themselves, including case sensitivity and the F flag, without HTTP.
function refusedByHtaccess(text, target) {
  const filename = path.posix.basename(target)
  const fileDenials = [...text.matchAll(/<FilesMatch "([^"]+)">\s*Require all denied\s*<\/FilesMatch>/g)]
    .some(([, pattern]) => new RegExp(pattern.replace(/^\(\?i\)/, ''), pattern.startsWith('(?i)') ? 'i' : '').test(filename))
  // The directory rule must be unconditional, enabled, and before the HTTPS/page redirects.
  const rewrite = text.split('RewriteEngine On')[1]?.split('RewriteCond')[0] ?? ''
  const directoryDenials = [...rewrite.matchAll(/^\s*RewriteRule (\S+) - \[([^\]]+)\]/gm)]
    .some(([, pattern, flags]) => flags.split(',').includes('F') && new RegExp(pattern, flags.split(',').includes('NC') ? 'i' : '').test(target.replace(/^\//, '')))
  return fileDenials || directoryDenials
}

function assertPrivateFilesRefused(text, label) {
  for (const target of ['/.env', '/.env.production', '/.git/config', '/.git/HEAD', '/.htaccess', '/.htpasswd', '/nested/.secret/file', '/docs/', '/docs/readme.txt', '/docs/Credentials.txt', '/DOCS/readme.txt', '/assets/app.js.map', '/assets/app.JS.MAP', '/.upload-manifest.json']) {
    assert.ok(refusedByHtaccess(text, target), `${label} must refuse ${target}`)
  }
  for (const target of ['/', '/login', '/assets/app.js', '/assets/app.css', '/data/ideas.json', '/.well-known/acme-challenge/token', '/.well-known/security.txt']) {
    assert.equal(refusedByHtaccess(text, target), false, `${label} must allow visitor/ACME path ${target}`)
  }
}

test('public .htaccess refuses dotfiles, docs, source maps and the upload manifest offline', () => {
  assertPrivateFilesRefused(readPublicHtaccess(), 'public/.htaccess')
  assertBrowserHeaders(readPublicHtaccess())
})

test('built .htaccess retains the private-file denials without probing the server', async () => {
  // The release-build check supplies dist/.htaccess. On a fresh checkout, exercise Vite's public-file copy
  // with a tiny build, so test:data also runs before the full app build (CI order), without skipped coverage.
  if (process.env.SECURITY_BUILT_HTACCESS) {
    assertPrivateFilesRefused(fs.readFileSync(process.env.SECURITY_BUILT_HTACCESS, 'utf8'), 'built .htaccess')
    assertBrowserHeaders(fs.readFileSync(process.env.SECURITY_BUILT_HTACCESS, 'utf8'))
    return
  }
  const fixture = fs.mkdtempSync(path.join(results, 'security-htaccess-'))
  try {
    fs.mkdirSync(path.join(fixture, 'public'))
    fs.writeFileSync(path.join(fixture, 'public/.htaccess'), readPublicHtaccess())
    fs.writeFileSync(path.join(fixture, 'index.html'), '<!doctype html><title>Offline build fixture</title>')
    const { build } = await import('vite')
    await build({ configFile: false, root: fixture, logLevel: 'silent', build: { outDir: 'dist' } })
    assertPrivateFilesRefused(fs.readFileSync(path.join(fixture, 'dist/.htaccess'), 'utf8'), 'Vite-built .htaccess')
    assertBrowserHeaders(fs.readFileSync(path.join(fixture, 'dist/.htaccess'), 'utf8'))
  } finally { fs.rmSync(fixture, { recursive: true, force: true }) }
})

test('offline denial checks detect a missing file rule, directory rule or forbidden flag', () => {
  const text = readPublicHtaccess()
  for (const broken of [text.replace('Require all denied', 'Require all granted'), text.replace('[F,L,NC]', '[L,NC]'), text.replace('RewriteEngine On', 'RewriteEngine Off')]) {
    assert.throws(() => assertPrivateFilesRefused(broken, 'mutated .htaccess'), /must refuse/)
  }
})

for (const header of requiredHeaders) {
  test(`header mutation: removing or downgrading ${header} fails`, () => {
    const text = readPublicHtaccess()
    for (const broken of [
      text.replace(new RegExp(`^\\s*Header always set ${header} .*\\r?\\n`, 'm'), ''),
      text.replace(`Header always set ${header}`, `Header set ${header}`),
    ]) assert.throws(() => assertBrowserHeaders(broken), /must use Header always set/)
  })
}

test('directory-listing mutation: missing or reversed Options -Indexes fails', () => {
  for (const replacement of ['', 'Options +Indexes']) {
    assert.throws(() => assertBrowserHeaders(readPublicHtaccess().replace('Options -Indexes', replacement)), /Options -Indexes/)
  }
})

for (const source of ["'unsafe-inline'", "'unsafe-eval'", '*', 'http:', 'https:']) {
  test(`CSP mutation: unsafe script source ${source} fails`, () => {
    const broken = readPublicHtaccess().replace("script-src 'self'", `script-src 'self' ${source}`)
    assert.throws(() => assertBrowserHeaders(broken), /script-src must forbid/)
  })
}

test('CSP mutation: absent script-src fails', () => {
  assert.throws(() => assertBrowserHeaders(readPublicHtaccess().replace(/script-src\s+[^;]+;/, '')), /explicit script-src/)
})

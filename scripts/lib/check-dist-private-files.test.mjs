import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { checkDist } from '../check-dist-private-files.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const results = path.join(root, 'test-results')
fs.mkdirSync(results, { recursive: true })
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(results, 'security-dist-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}
const cli = dir => spawnSync(process.execPath, [path.join(root, 'scripts/check-dist-private-files.mjs'), dir], { encoding: 'utf8', windowsHide: true })

for (const name of ['assets/app.js.map', 'assets/app.JS.MAP', '.env', '.env.production', '.git/config',
  '.secret', 'nested/.secret/file', '.prerender/output.js', '.upload-manifest.json', 'Credentials', 'Credentials-extra.txt',
  'package.json', 'package-lock.json', 'package-extra.json', 'dump.sql', 'index.html.bak', 'index.html.bak-old',
  'index.html.orig', 'index.html~', 'docs/readme.txt', 'node_modules/pkg/index.js', 'backup/index.html', 'tmp/work.txt',
  '.well-known/.secret']) {
  test(`planted private file fails before removal and passes after: ${name}`, t => {
    const dir = fixture(t)
    const file = path.join(dir, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'public test sentinel, never a credential')
    const bad = cli(dir)
    assert.equal(bad.status, 1, bad.stdout)
    // A forbidden ancestor directory is itself refused, even if it is empty.
    assert.ok(name.startsWith(bad.stderr.match(/Refuse unsafe public upload: (.+)/)?.[1] ?? '\0'), bad.stderr)
    fs.rmSync(path.join(dir, name.split('/')[0]), { recursive: true, force: true })
    const good = cli(dir)
    assert.equal(good.status, 0, good.stderr)
  })
}

for (const comment of ['//# sourceMappingURL=app.js.map', '/*# sourceMappingURL=data:application/json;base64,e30= */', '//@ sourceMappingURL=hidden']) {
  test(`planted JavaScript source-map comment fails: ${comment.split('=')[0]}`, t => {
    const dir = fixture(t)
    const file = path.join(dir, 'app.js')
    fs.writeFileSync(file, `console.log('public');\n${comment}`)
    const bad = cli(dir)
    assert.equal(bad.status, 1)
    assert.match(bad.stderr, /app\.js \(sourceMappingURL comment\)/)
    assert.ok(!bad.stderr.includes('base64'), 'do not expose file contents')
    fs.writeFileSync(file, "console.log('public');")
    assert.equal(cli(dir).status, 0)
  })
}

test('empty forbidden directories and symlinks also fail closed', t => {
  const dir = fixture(t)
  for (const name of ['docs', 'node_modules', 'backup', 'tmp', '.git', '.cache', '.htaccess']) {
    const entry = path.join(dir, name)
    fs.mkdirSync(entry)
    assert.throws(() => checkDist(dir), /Refuse unsafe public upload/)
    fs.rmdirSync(entry)
  }
  const target = fixture(t)
  fs.symlinkSync(target, path.join(dir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => checkDist(dir), /Refuse unsafe public upload: linked/)
  fs.unlinkSync(path.join(dir, 'linked'))
  assert.doesNotThrow(() => checkDist(dir))
})

test('public files, server config, security.txt and ACME tokens pass', t => {
  const dir = fixture(t)
  for (const name of ['index.html', '.htaccess', '.well-known/security.txt', '.well-known/acme-challenge/token', 'assets/app.js', 'assets/app.css']) {
    const file = path.join(dir, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'public fixture')
  }
  assert.equal(cli(dir).status, 0)
})

test('missing build output fails', t => {
  assert.equal(cli(path.join(fixture(t), 'missing')).status, 1)
})

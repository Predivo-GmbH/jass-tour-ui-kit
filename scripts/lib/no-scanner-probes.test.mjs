import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { scannerPath } from './scanner-path.mjs'

// SR-HOST-11: scanner probes can ban the office AND build laptop for about one hour.

const root = fileURLToPath(new URL('../../', import.meta.url))
const self = fileURLToPath(import.meta.url)
const reason = 'The shared host bans the office address, which is also the build laptop\'s. '
  + 'An audit needing scanner probes must run by hand from a switched address '
  + '(C:/ClaudeShared/scripts/change-our-ip-address.sh on), slowly.'
const projectDomain = 'beize-jass-tour.mueller.ro'.toLowerCase()
const sharedHost = /^(?:[\w.-]+\.)?(?:predivo\.ch|mitchind\.ch|replyflow\.help|signalscore\.ch|channelmover\.com|mueller\.ro)$|^80\.74\.145\.155$/i
const protectedHost = { test(host) {
  host = host.toLowerCase()
  return sharedHost.test(host) || (!projectDomain.includes('{{')
    && (host === projectDomain || host.endsWith('.' + projectDomain)))
} }


function scanSource(source, filename) {
  const js = /\.[cm]?[jt]sx?(?:\.template)?$/.test(filename)
  const literals = []
  let network = false
  let unknownRequestTarget = false
  if (js) {
    const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true)
    const constant = node => ts.isStringLiteralLike(node) ? node.text
      : ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken
        && constant(node.left) !== undefined && constant(node.right) !== undefined
        ? constant(node.left) + constant(node.right) : undefined
    const visit = (node) => {
      // Filesystem constructors can contain ../ and private fixture names, but cannot issue HTTP requests.
      if ((ts.isCallExpression(node) && /^(?:path\.)?(?:resolve|join)$|^(?:fs\.)?(?:readFileSync|writeFileSync|readFile|writeFile|mkdirSync|existsSync)$/.test(node.expression.getText(ast)))
        || (ts.isNewExpression(node) && node.expression.getText(ast) === 'URL' && node.arguments?.[1]?.getText(ast) === 'import.meta.url')) return
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(ast).replace(/\[['"](\w+)['"]\]/g, '.$1')
        if (/^(?:fetch|fetchImpl|axios)$|\b(?:request|https?|axios|got)\.(?:get|head|post|put|delete|fetch|request)$|\.(?:goto|fetch)$/.test(callee)) {
          network = true
          const target = node.arguments[0]
          const prefix = target && (constant(target) ?? (ts.isTemplateExpression(target) ? target.head.text : ''))
          if (target && !/^(?:https?:)?\/\/[\w.-]+(?=[:/]|$)/i.test(prefix)) unknownRequestTarget = true
        }
      }
      if (ts.isBinaryExpression(node) && constant(node) !== undefined) {
        literals.push({ value: constant(node), line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 })
      }
      if (ts.isTemplateExpression(node)) {
        const value = node.head.text + node.templateSpans.map(span => `DYNAMIC${span.literal.text}`).join('')
        literals.push({ value, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 })
      }
      if (ts.isStringLiteralLike(node)) {
        // Local imports and file I/O are not HTTP paths. Comments and regular expressions are not literals here.
        const parent = node.parent
        const local = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)
          || (ts.isCallExpression(parent) && /^(?:fs\.)?(?:readFileSync|writeFileSync|readFile|writeFile|mkdirSync|existsSync)$|^path\./.test(parent.expression.getText(ast)))
          || (ts.isCallExpression(parent) && /\.endsWith$/.test(parent.expression.getText(ast)) && /^\.[a-z]+$/i.test(node.text))
        if (!local) literals.push({ value: node.text, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 })
        if (/^(?:node:)?https?$|^axios$|\b(?:curl(?:\.exe)?|wget|Invoke-WebRequest|Invoke-RestMethod)\b/i.test(node.text)) {
          network = true
          for (const url of node.text.matchAll(/https?:\/\/[^\s"']+/g)) literals.push({ value: url[0], line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  } else {
    // Shell/PowerShell/Python and future helpers are covered too, without an extension allowlist.
    const code = source.replace(/^\s*#.*$/gm, '')
    network = /\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod|requests\.(?:get|head|post)|urlopen)\b/i.test(code)
    for (const [i, line] of code.split(/\r?\n/).entries()) {
      for (const match of line.matchAll(/(?:https?:\/\/[^\s"'`]+|["']([^"']+)["'])/g)) literals.push({ value: match[1] ?? match[0], line: i + 1 })
    }
  }
  if (!network) return []
  const hosts = literals.flatMap(({ value }) => [...value.matchAll(/https?:\/\/([\w.-]+)(?=[:/]|$)/gi)].map(m => m[1]))
  // Unknown/relative bases are fail-closed (CI may supply our host). Explicit loopback/other-host tests remain usable.
  const mayReachHost = unknownRequestTarget || hosts.length === 0 || hosts.some(host => protectedHost.test(host)) || filename.startsWith('e2e/staging/')
  return literals.filter(({ value }) => {
    const explicitHost = /^(?:https?:)?\/\/([\w.-]+)(?=[:/]|$)/i.exec(value)?.[1]
    return (explicitHost ? protectedHost.test(explicitHost) : mayReachHost) && scannerPath(value)
  }).map(({ line }) => `${filename}:${line}: scanner-style request path. ${reason}`)
}

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name)
    // Do not follow a junction outside the checked tree.
    assert.ok(!entry.isSymbolicLink(), `Unexpected symlink under the scanner guard: ${file}`)
    return entry.isDirectory() ? filesUnder(file) : [file]
  })
}

test('e2e and scripts cannot probe our shared hosts like an attack scanner', () => {
  const findings = ['e2e', 'scripts', '.github/workflows'].flatMap(dir => filesUnder(path.join(root, dir)))
    .filter(file => file !== self)
    .flatMap(file => scanSource(fs.readFileSync(file, 'utf8'), path.relative(root, file).replaceAll('\\', '/')))
  assert.equal(findings.length, 0, findings.join('\n'))
})

test('guard catches every forbidden path on every shared host, including encoded traversal', () => {
  for (const host of ['mitchind.ch', 'staging.mitchind.ch', 'portal.predivo.ch', 'a.b.predivo.ch', 'replyflow.help', 'staging.replyflow.help', 'signalscore.ch', 'staging.channelmover.com', 'a.b.mueller.ro', '80.74.145.155', ...(!projectDomain.includes('{{') ? [projectDomain, 'staging.' + projectDomain] : [])]) {
    for (const target of ['/.env', '/.env.production', '/.git', '/.git/config', '/wp-login.php', '/wp-config.php', '/phpmyadmin/', '/xmlrpc.php', '/docs/Credentials.txt', '/Credentials', '/.htaccess', '/.htpasswd', '/assets/app.js.map', '/file.bak', '/dump.sql', '/../private', '/%2e%2e/private', '/%252e%252e%252fprivate', '/.upload-manifest.json']) {
      assert.ok(scanSource(`await fetch('https://${host}${target}')`, 'scripts/audit.mjs').length, `${host}${target}`)
    }
  }
})

test('guard catches relative Playwright paths, loops, dynamic maps, curl and shell helpers', () => {
  for (const source of [
    "await request.get('/.env')", "await page.goto('/.git/config')",
    "for (const p of ['/.env', '/wp-config.php']) await request.head(p)",
    'await request.get(`${js}.map`)',
    "const base = process.env.BASE_URL; const paths = ['/backup.sql']; for (const p of paths) await fetch(base + p)",
    "spawnSync('curl.exe', ['https://staging.mitchind.ch/.env'])",
    "exec('curl --silent https://mitchind.ch/.env')",
    "await request['get']('/.' + 'env')",
    "import { get } from 'node:https'; get('https://mitchind.ch/.git/config')",
    "const unrelated = 'https://example.invalid/'; await request.get('/.env')",
  ]) assert.ok(scanSource(source, 'scripts/probe.mjs').length, source)
  for (const [file, source] of [
    ['scripts/probe.sh', 'curl https://mitchind.ch/.env'],
    ['scripts/probe.ps1', "Invoke-WebRequest 'https://anything.predivo.ch/.git/config'"],
    ['scripts/probe.py', "requests.get('https://80.74.145.155/backup.sql')"],
  ]) assert.ok(scanSource(source, file).length, file)
})

test('guard allows visitor requests, offline file assertions, comments and loopback canaries', () => {
  for (const source of [
    "for (const p of ['/', '/data/', '/anmelden/', '/assets/app.js', '/assets/app.css', '/favicon.svg']) await request.head(p)",
    "await fetch('https://mitchind.ch/.well-known/acme-challenge/token')",
    "await fetch('http://127.0.0.1:18087/.env')",
    "await fetch('https://example.invalid/app.js.map')",
    "import x from '../../helpers.js'; await request.get('/')",
    "// fetch('https://mitchind.ch/.env')\nawait request.get('/')",
    "const fixture = ['.env', 'docs/Credentials.txt', 'app.js.map']; assert.ok(fixture)",
    "fs.readFileSync('docs/Credentials.txt'); await fetch('https://mitchind.ch/')",
  ]) assert.deepEqual(scanSource(source, 'scripts/fixture.mjs'), [], source)
})

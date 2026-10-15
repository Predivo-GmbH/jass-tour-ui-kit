#!/usr/bin/env node
// THE FTP PASSWORD IS NEVER ON A COMMAND LINE (Cockpit audit 2026-09-30, prod-infra High #1, fleet-wide).
//
//   node <this file>          (also runs under `node --test`)
//
// Every deploy passed the fleet FTP password as an argument - `lftp -u "$FTP_USER,$FTP_PASS"`,
// `open -u $FTP_USER,$FTP_PASS` inside `lftp -e "…"`, `curl --user "$FTP_USER:$FTP_PASS"` - on a shared,
// long-lived self-hosted runner. An argument is readable by every process on that machine for as long
// as the command runs (/proc/<pid>/cmdline, `ps -ef`), and the runner also executes other repositories'
// code and their dependencies' install scripts. One FTP login writes every site in the account.
//
// Since 2026-10-01 the password reaches lftp through the environment (`--env-password` reads
// LFTP_PASSWORD) and curl through stdin (`-K -`). Proven against a real lftp 4.9.2 / curl and a
// throwaway FTP server on 2026-10-01: the old forms show the password in /proc/*/cmdline, the new ones
// log in with 0 samples showing it; a wrong password still exits 1 with "530" (lftp) and 67 (curl).
//
// This reads every workflow in .github/workflows and fails on any command line that carries the
// password again, or on a step that uses --env-password without LFTP_PASSWORD in its env (lftp would
// then try an anonymous login). It first proves its own rules catch the old forms, so it cannot pass
// by matching nothing. It prints file:line and the rule, never a value (workflows hold only
// `${{ secrets.X }}` references).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
let root = here
while (!fs.existsSync(path.join(root, '.github', 'workflows')) && path.dirname(root) !== root) root = path.dirname(root)
const dir = path.join(root, '.github', 'workflows')

const PASS = String.raw`(?:\$\{?(?:STAGING_)?FTP_PASS\}?|\$\{\{ ?secrets\.(?:STAGING_)?FTP_PASS ?\}\})`
const RULES = [
  ['lftp with the password as an argument', new RegExp(String.raw`\blftp\b.*` + PASS)],
  ['lftp `open -u user,password` (argv or a script file)', new RegExp(String.raw`\bopen\s+(?:--?\w[\w-]*\s+)*-u\s+\S*?,"?` + PASS)],
  ['curl with the password as an argument', new RegExp(String.raw`\bcurl\b.*` + PASS)],
  ['the password inside a URL', new RegExp(String.raw`ftps?://[^\s"']*:` + PASS)],
  ['the password secret written into a script', /\$\{\{ ?secrets\.(?:STAGING_)?FTP_PASS ?\}\}/],
]
// An env mapping (`  FTP_PASS: ${{ secrets.FTP_PASS }}`) is where the secret belongs, not a command.
const isEnvMapping = (l) => /^\s+[A-Za-z_][A-Za-z0-9_]*:\s*\$\{\{ ?secrets\.[A-Z0-9_]+ ?\}\}\s*$/.test(l)
// The rotate-staging-basic-auth workflows write `open -u user,password` into a mode-0600 script file with
// the printf BUILTIN (no process gets it as an argument) and delete it: the audit's own accepted form.
const isPrintfIntoFile = (l) => /^\s*printf\s+'open -u %s,%s %s\\n'\s+"\$FTP_USER"\s+"\$FTP_PASS"\s+"\$FTP_HOST"\s*$/.test(l)

function findings(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out = []
  const indent = (l) => l.match(/^ */)[0].length
  lines.forEach((l, i) => {
    if (/^\s*#/.test(l) || isEnvMapping(l) || isPrintfIntoFile(l)) return
    for (const [rule, re] of RULES) if (re.test(l)) { out.push([i + 1, rule]); break }
  })
  // Every step that uses --env-password must give lftp the password in its environment.
  lines.forEach((l, i) => {
    if (/^\s*#/.test(l) || !/--env-password/.test(l)) return
    let p = i; while (p >= 0 && !/^\s*- [\w-]+:/.test(lines[p])) p--
    let end = p + 1; while (end < lines.length && (lines[end].trim() === '' || indent(lines[end]) > indent(lines[p]))) end++
    let j = p; while (j >= 0 && !/^ {2}[\w-]+:\s*$/.test(lines[j])) j--
    const has = (a, b) => lines.slice(a, b).some((x) => /^\s+LFTP_PASSWORD:\s*\$\{\{ ?secrets\./.test(x))
    if (!has(p, end) && !(j >= 0 && has(j, p))) out.push([i + 1, '--env-password in a step without LFTP_PASSWORD in its env'])
  })
  return out
}

let failed = 0
const fail = (m) => { failed++; console.error('  FAIL ' + m) }
const ok = (m) => console.log('  ok   ' + m)

// 1. The rules catch the forms that leaked (so an empty result means something).
const OLD = [
  '          OUT=$(flock -w 240 /tmp/l timeout 420 lftp -u "$FTP_USER,$FTP_PASS" "ftp://$FTP_HOST" <<\'SCRIPT\' 2>&1',
  '            if flock -w 240 /tmp/l timeout 420 lftp -u "$FTP_USER","$FTP_PASS" "$FTP_HOST" -e "$CMDS"; then',
  '            echo "open -u $FTP_USER,$FTP_PASS ftp://$FTP_HOST"',
  '          open -u "$FTP_USER","$FTP_PASS" ftp://$FTP_HOST',
  '          FTP_CONN="set ftp:ssl-force yes; open -u ${{ secrets.FTP_USER }},${{ secrets.FTP_PASS }} ${{ secrets.FTP_HOST }};"',
  '            OUT=$(curl -sS --ssl-reqd --insecure --max-time 90 --user "$FTP_USER:$FTP_PASS" "ftp://$FTP_HOST/" 2>&1)',
]
const caught = OLD.filter((l) => findings(`jobs:\n  x:\n    steps:\n      - run: |\n${l}\n`).length > 0)
caught.length === OLD.length ? ok(`the rules catch all ${OLD.length} forms that put the password on a command line`)
  : fail(`the rules miss ${OLD.length - caught.length} of the old forms - this guard would pass over them`)
const NEW = [
  '          OUT=$(flock -w 240 /tmp/l timeout 420 lftp --env-password -u "$FTP_USER" "ftp://$FTP_HOST" <<\'SCRIPT\' 2>&1',
  '            OUT=$(printf \'%s\\n\' "$FTP_CURL_AUTH" | curl -sS --ssl-reqd --insecure --max-time 90 -K - "ftp://$FTP_HOST/" 2>&1)',
  '            FTP_CURL_AUTH="user = \\"$FTP_USER:$(printf \'%s\' "$FTP_PASS" | sed \'s/[\\\\"]/\\\\&/g\')\\""',
]
const clean = findings(`jobs:\n  x:\n    steps:\n      - env:\n          LFTP_PASSWORD: \${{ secrets.FTP_PASS }}\n        run: |\n${NEW.join('\n')}\n`)
clean.length === 0 ? ok('the forms that replaced them pass') : fail(`the replacement forms are flagged: ${clean.map((f) => f[1]).join('; ')}`)

// 2. Every workflow in this repository.
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)) : []
if (files.length === 0) fail(`no workflow found under ${path.relative(process.cwd(), dir) || dir} - absence is not success`)
let total = 0
for (const f of files) {
  const found = findings(fs.readFileSync(path.join(dir, f), 'utf8'))
  total += found.length
  for (const [line, rule] of found) fail(`.github/workflows/${f}:${line} - ${rule}`)
}
if (files.length && total === 0) ok(`${files.length} workflow(s): the FTP password is on no command line`)

if (failed > 0) { console.error(`\n${failed} failed`); process.exit(1) }
console.log('\nall passed')

#!/usr/bin/env node
/**
 * signin-captcha.prod.test.mjs — production regression guard for the sign-in bot-protection fix
 * on Beize Jass Tour. Direct port of ReplyFlow's supabase/functions/_shared/signin-captcha.prod.test.mjs
 * (see that repo's docs/CLOSEOUT-signin-bot-protection-2026-09-05.md for the full story) — same
 * shape, same order of operations, adapted to this product's single project.
 *
 * THE VULNERABILITY (measured live 2026-09-14): production project `uyksotlmrlxhmyeopktl` accepts
 * a TOKENLESS, unauthenticated POST /auth/v1/recover with HTTP 200, and a tokenless POST
 * /auth/v1/otp reaches GoTrue's user-lookup (422 otp_disabled) rather than being refused for
 * captcha. Its Auth config reads security_captcha_enabled=false. So today anyone on the internet
 * who knows an account holder's email address can make this product email them a password-reset
 * link or a login code, unlimited, from the Postmark sending reputation the whole fleet shares.
 *
 * THE ONLY LIVE PROJECT: `uyksotlmrlxhmyeopktl`, under account 11api@predivo.ch. There is an OLD,
 * ABANDONED project `dkxdlovwzsxnepoteebk` (under a *different* account, api@predivo.ch) that was
 * found empty on 2026-08-22. It is NEVER referenced here — probing the wrong project would report
 * "fine" with total confidence about a database nobody uses.
 *
 * THE FIX has two halves, same order as ReplyFlow:
 *   1. CLIENT: thread a Cloudflare Turnstile captchaToken through every captcha-protected auth
 *      entry point this app has — supabase.auth.signInWithPassword and supabase.auth.signUp in
 *      src/pages/Auth.tsx (this product has no signInWithOtp or resetPasswordForEmail call
 *      anywhere in the client). Render the widget via src/components/TurnstileWidget.tsx, which
 *      reads its site key from VITE_TURNSTILE_SITE_KEY and renders NOTHING (token stays
 *      undefined) until that env var is set. NO-OP until half 2 — safe to deploy alone.
 *   2. SERVER: enable CAPTCHA (Turnstile provider + secret) in the project's Auth settings. This
 *      is the switch that actually closes the hole. PROJECT-WIDE, so only safe once half 1 is
 *      live. NOT done by this change — it is a production change, Roger's gate, owned by a
 *      separate session.
 *
 * NO STAGING PROJECT EXISTS FOR THIS PRODUCT. Unlike ReplyFlow, the fleet inventory records no
 * staging Supabase project for Beize Jass Tour — there is exactly one project, and it is
 * production. This is stated explicitly, not left as a silent gap: there is nothing else to probe.
 *
 * CREDENTIAL-FREE by design: the anon/publishable key this needs is PUBLIC — it ships in every
 * visitor's browser. It is read from the live bundle at https://beize-jass-tour.mueller.ro first
 * (proves the key real browsers get); if that site cannot be reached, it falls back to the
 * Supabase Management API's own api-keys list (same PUBLIC publishable key, straight from the
 * project) using SUPABASE_ACCESS_TOKEN from the environment or docs/Credentials.txt (gitignored;
 * never printed). A project whose key cannot be obtained is SKIPPED LOUDLY — never a silent pass.
 *
 * The probe address (signin-captcha-guard@jasstour-test.local) uses the reserved .local TLD and
 * create_user:false, so a still-open endpoint cannot actually mail a real person. NEVER point this
 * at a real person's address.
 *
 * Run: node scripts/signin-captcha.prod.test.mjs
 * Exit 0 = production refuses a tokenless OTP request for captcha (the hole is closed).
 * Exit 1 = production still accepts a tokenless OTP request (the hole is NOT closed — expected
 *          today, 2026-09-14, until half 2 lands), or nothing could be probed at all.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const PROJECTS = [
  {
    name: 'production',
    ref: 'uyksotlmrlxhmyeopktl',
    site: 'https://beize-jass-tour.mueller.ro',
    anonEnv: 'SUPABASE_ANON_KEY',
    enforced: true,
  },
  // No staging project exists in the fleet inventory for this product — see header. Nothing to
  // add here; this is not an omission.
]

const PROBE_EMAIL = 'signin-captcha-guard@jasstour-test.local'

// Pull the public anon/publishable key out of a deployed frontend bundle — the same value every
// browser gets. Two formats: the newer `sb_publishable_...` key and the legacy anon JWT (role
// "anon").
function findKeyInSource(body) {
  const pub = body.match(/sb_publishable_[A-Za-z0-9_-]+/)
  if (pub) return pub[0]
  const jwts = body.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []
  for (const jwt of jwts) {
    try {
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'))
      if (payload.role === 'anon') return jwt
    } catch { /* not a JWT we can decode — keep looking */ }
  }
  return null
}

async function anonKeyFromSite(siteUrl) {
  const html = await (await fetch(siteUrl, { redirect: 'follow' })).text()
  const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => new URL(m[1], siteUrl).href)
  const seen = new Set(scripts)
  for (const js of scripts) {
    const body = await (await fetch(js)).text()
    const key = findKeyInSource(body)
    if (key) return key
    // The key may live in a lazily-imported chunk; queue chunk names referenced from this script.
    for (const name of new Set(body.match(/[A-Za-z0-9_]+-[A-Za-z0-9]+\.js/g) || [])) {
      const url = new URL(`assets/${name}`, siteUrl).href
      if (!seen.has(url)) { seen.add(url); scripts.push(url) }
    }
  }
  return null
}

/**
 * A Supabase management token, from the environment in CI and from the gitignored credentials
 * file on a developer machine. The value is never printed, never put on a command line and never
 * written anywhere; a missing file is simply "no token", so this stays silent and harmless on a
 * CI runner that has no such file.
 */
function managementToken() {
  const fromEnv = (process.env.SUPABASE_ACCESS_TOKEN || '').trim()
  if (fromEnv) return fromEnv
  try {
    const text = readFileSync(new URL('../docs/Credentials.txt', import.meta.url), 'utf-8')
    return (text.match(/sbp_[A-Za-z0-9]{20,}/) || [])[0] || ''
  } catch {
    return ''
  }
}

/**
 * The same PUBLIC publishable key, from the project itself rather than from the website. Used
 * only when the bundle scan cannot be reached. `reveal=true` is required or the value comes back
 * masked, and only the row whose type is `publishable` is taken.
 */
async function anonKeyFromManagementApi(ref) {
  const token = managementToken()
  if (!token) return null
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Management API api-keys -> HTTP ${res.status}`)
  const rows = await res.json()
  const pub = (Array.isArray(rows) ? rows : []).find((r) => r.type === 'publishable')
  return pub?.api_key?.trim() || null
}

async function anonKeyFor(project) {
  const fromEnv = process.env[project.anonEnv]?.trim()
  if (fromEnv) return { key: fromEnv, source: `$${project.anonEnv}` }
  if (project.site) {
    try {
      const key = await anonKeyFromSite(project.site)
      if (key) return { key, source: project.site }
    } catch (err) {
      // The website being unreachable says nothing about GoTrue, which is what we are testing.
      console.error(`note - ${project.site} could not be read (${err.message}); trying the project itself.`)
    }
  }
  const key = await anonKeyFromManagementApi(project.ref)
  if (key) return { key, source: 'the Supabase Management API (publishable key)' }
  return null
}

// A tokenless /otp request looks like the exact abuse: an OTP send with no captcha proof. GoTrue
// carries the captcha token in gotrue_meta_security.captcha_token; we deliberately omit it.
async function tokenlessOtpRefused(project, anon) {
  const res = await fetch(`https://${project.ref}.supabase.co/auth/v1/otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify({ email: PROBE_EMAIL, create_user: false }),
  })
  const text = await res.text()
  // Closed state: GoTrue rejects for a captcha reason (400 + captcha in the error).
  const looksLikeCaptchaRefusal = res.status === 400 && /captcha/i.test(text)
  return { ok: looksLikeCaptchaRefusal, status: res.status, body: text.slice(0, 300) }
}

let failures = 0
let covered = 0
let coveredEnforced = 0
for (const p of PROJECTS) {
  let found
  try {
    found = await anonKeyFor(p)
  } catch (err) {
    console.error(`SKIP - ${p.name} (${p.ref}): could not fetch anon key: ${err.message}`)
    continue
  }
  if (!found) {
    console.error(
      `SKIP - ${p.name} (${p.ref}): no anon key (set ${p.anonEnv}, or SUPABASE_ACCESS_TOKEN / docs/Credentials.txt to read the ` +
        'project\'s own publishable key). NOT counted as passing.'
    )
    continue
  }
  const { key: anon, source } = found
  covered++
  if (p.enforced) coveredEnforced++
  console.log(`     ${p.name}: probing with the public key from ${source}`)
  try {
    const r = await tokenlessOtpRefused(p, anon)
    assert.ok(
      r.status !== 401,
      `${p.name}: the key was REFUSED (401) — this run tested nothing about captcha. Body: ${r.body}`
    )
    if (p.enforced) {
      assert.ok(r.ok, `${p.name}: tokenless /otp must be refused for captcha (400/captcha); got ${r.status}: ${r.body}`)
      console.log(`ok - ${p.name} (${p.ref}): tokenless OTP request refused (captcha enforced)`)
    } else {
      assert.ok(
        !r.ok,
        `${p.name}: captcha is now ENFORCED here, and it was deliberately left OFF — investigate before trusting this.`
      )
      console.log(`ok - ${p.name} (${p.ref}): still OFF on purpose (${r.status})`)
    }
  } catch (err) {
    failures++
    console.error(`FAIL - ${p.name} (${p.ref}): ${err.message}`)
  }
}

if (covered === 0) {
  console.error('\nNo project could be probed (no anon key obtained). This guard proved nothing.')
  process.exit(1)
}
// COVERING ONLY THE PROJECT THAT IS SUPPOSED TO BE OPEN IS NOT COVERAGE. Without this, a run that
// could not reach any ENFORCED project would still exit 0 having proved nothing about the
// vulnerability this guard exists for.
if (coveredEnforced === 0) {
  console.error('\nNo ENFORCED project could be probed. Nothing was proved about the vulnerability this guard exists for.')
  process.exit(1)
}
if (failures > 0) {
  console.error(`\n${failures} project(s) are in the wrong captcha state — sign-in bot protection is NOT as recorded.`)
  process.exit(1)
}
console.log(
  `\nAll ${covered} covered project(s) are in the recorded state: ${coveredEnforced} enforcing captcha on ` +
    `tokenless OTP. Sign-in bot protection is enforced where it must be.`
)
process.exit(0)

#!/usr/bin/env node
/**
 * auth-captcha.mjs — read and flip Beize Jass Tour's Supabase Auth CAPTCHA switch, without ever
 * rendering a secret.
 *
 * WHY THIS FILE EXISTS
 * Closing the unauthenticated sign-in-email hole has two halves, and only one of them is code.
 * Half 1 — a Cloudflare Turnstile token threaded through signInWithPassword and signUp in
 * src/pages/Auth.tsx — ships with the deploy. Half 2 is NOT code and NOT a deploy: it is one
 * project-wide GoTrue setting (`security_captcha_enabled` + provider + secret). On ReplyFlow that
 * half sat undone behind a green deploy for four days while the board row read "shipped", because
 * nothing in the repo could touch it. A setting only a human can reach through a dashboard is a
 * setting that rots. This is how Beize Jass Tour's gets flipped, read back and rolled back, on the
 * record, by CI, with no secret rendered anywhere.
 *
 * WHICH PROJECT. `uyksotlmrlxhmyeopktl` is the LIVE one — it is what deploy.yml hardcodes as
 * VITE_SUPABASE_URL in every build, and it holds the real auth users. There is a SECOND project,
 * `dkxdlovwzsxnepoteebk`, that is an abandoned duplicate: its email provider is already off, so it
 * cannot mail anyone, and deleting it is a separate, deliberate decision. It is deliberately NOT
 * in the map below — flipping captcha on a project nothing deploys to would be a change that
 * protects nobody and confuses the next reader.
 *
 * WHAT IT DOES
 *   report   GET  /v1/projects/{ref}/config/auth and print ONLY booleans, names and value SHAPES
 *   enable   verify the secret against Cloudflare, then PATCH captcha on with provider=turnstile
 *   disable  PATCH captcha off — the rollback, instant and total
 *
 * THE SECRET IS NEVER LOOKED AT. It comes from $TURNSTILE_SECRET and is piped straight into the
 * PATCH body. It is never printed, never written to disk, never put on a command line and never
 * put in an error message. What IS printed about it is its length and character classes — the
 * safe-inspect contract — and, from Cloudflare, a verdict about whether it is the right one.
 *
 * WHY `enable` CALLS CLOUDFLARE FIRST, AND WHY THAT IS THE WHOLE POINT
 * A WRONG secret is indistinguishable from a right one by every check that does not leave the
 * building: it is a non-empty string of the correct shape, `gh secret list` shows it, and the
 * PATCH succeeds. GoTrue would then reject EVERY real sign-in with a captcha error while the
 * switch reads healthy — a total customer lockout that looks exactly like a successful rollout.
 * Cloudflare's siteverify distinguishes them for free and without rendering anything:
 *     wrong/empty secret -> error-codes ["invalid-input-secret"]
 *     correct secret     -> error-codes ["invalid-input-response"]  (our dummy token is bad, as intended)
 * So `enable` refuses to touch Supabase unless Cloudflare has confirmed the secret is real.
 *
 * ORDER MATTERS AND IT IS NOT NEGOTIABLE. Enabling captcha is PROJECT-WIDE: GoTrue then demands a
 * token on /token, /signup, /otp, /resend and /recover. This client only calls /token and /signup,
 * and both now carry a token — but /recover and /otp are open on the project whether or not this
 * client calls them, which is precisely the hole: a stranger with the publishable key can make
 * GoTrue mail a reset link to any address, 30/hour, against the Postmark reputation the whole
 * fleet shares. Enabling the switch closes them. Enable it before the client half is live and
 * every real sign-in and signup breaks. Prove the client half first — deploy.yml now asserts the
 * site key is actually inlined in the shipped bundle, in both the validate and the deploy job.
 *
 * THERE IS NO STAGING PROJECT for this product, which is why the map has one entry. A `--project
 * staging` invocation therefore fails the usage check rather than doing something surprising.
 *
 * Usage:
 *   node scripts/auth-captcha.mjs report  --project production
 *   node scripts/auth-captcha.mjs enable  --project production
 *   node scripts/auth-captcha.mjs disable --project production
 */

const PROJECTS = {
  production: { ref: 'uyksotlmrlxhmyeopktl', name: 'Beize Jass Tour production' },
}

/** PUBLIC Cloudflare Turnstile site key for Beize Jass Tour — safe to record, it ships in every bundle. */
const SITE_KEY = '0x4AAAAAAEz4uXEnV8i5NHlb'

/**
 * Management tokens in preference order. A token NAME is only a guess about which account still
 * opens a project, and the guess rots on its own, so only 401/403 falls through — any other status
 * is about the REQUEST and must surface unchanged rather than being retried away.
 */
const MGMT_CANDIDATES = [
  { name: 'SUPABASE_ACCESS_TOKEN', token: process.env.SUPABASE_ACCESS_TOKEN || '' },
  { name: 'JASS_MGMT_TOKEN', token: process.env.JASS_MGMT_TOKEN || '' },
].filter((c) => c.token)

let chosen = null

async function mgmt(path, init = {}) {
  if (!MGMT_CANDIDATES.length) {
    throw new Error('No Supabase management token in the environment (SUPABASE_ACCESS_TOKEN or JASS_MGMT_TOKEN).')
  }
  const candidates = chosen ? [chosen] : MGMT_CANDIDATES
  let last = null
  for (const c of candidates) {
    const res = await fetch(`https://api.supabase.com/v1${path}`, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${c.token}` },
    })
    if (res.status === 401 || res.status === 403) {
      last = { status: res.status, name: c.name }
      continue
    }
    if (!chosen) {
      chosen = c
      if (c.name !== MGMT_CANDIDATES[0].name) {
        console.log(`note - ${MGMT_CANDIDATES[0].name} was refused; ${c.name} answered. The pinned name is stale.`)
      }
    }
    return res
  }
  throw new Error(`every management token was refused (last: ${last?.name} HTTP ${last?.status}) for ${path}`)
}

/** What a value looks like, never what it is. The safe-inspect contract. */
function shape(v) {
  if (!v) return 'absent'
  const classes = []
  if (/[a-z]/.test(v)) classes.push('lower')
  if (/[A-Z]/.test(v)) classes.push('upper')
  if (/[0-9]/.test(v)) classes.push('digits')
  if (/[^a-zA-Z0-9]/.test(v)) classes.push('symbols')
  const digest = /^[0-9a-f]{64}$/.test(v) ? ' LOOKS LIKE A SHA-256 DIGEST, NOT A USABLE SECRET' : ''
  return `present len=${v.length} chars=${classes.join('+')}${digest}`
}

async function getAuthConfig(ref) {
  const res = await mgmt(`/projects/${ref}/config/auth`)
  if (!res.ok) throw new Error(`GET config/auth -> HTTP ${res.status}`)
  return res.json()
}

/**
 * The Turnstile secret, from the environment only.
 *
 * NOT from the project's own edge-function secrets: Supabase stores those write-only and
 * GET /v1/projects/{ref}/secrets hands back a SHA-256 DIGEST, not the value (measured on ReplyFlow
 * 2026-09-09, run 34355013617). A digest configured as the captcha secret would be accepted by the
 * PATCH and would then reject every real sign-in, so reading from there is worse than not reading
 * at all. The repository secret TURNSTILE_SECRET is the one usable source; Cloudflare's dashboard
 * is the other, and it is not machine-reachable from CI.
 */
function turnstileSecret() {
  const value = (process.env.TURNSTILE_SECRET || '').trim()
  if (!value) {
    throw new Error(
      'TURNSTILE_SECRET is not set. It is the Cloudflare Turnstile SECRET key for the Beize Jass ' +
        `Tour sign-in widget (site key ${SITE_KEY}). Add it as the repository secret ` +
        'TURNSTILE_SECRET; `enable` stops here rather than half-configuring the project.'
    )
  }
  if (/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(
      'TURNSTILE_SECRET looks like a SHA-256 digest, not a Turnstile secret key. Configuring that ' +
        'would switch captcha on with a secret that can never validate a token — a total lockout.'
    )
  }
  return value
}

/**
 * Ask CLOUDFLARE whether this secret is real, before Supabase is touched. Nothing about the secret
 * is printed; only Cloudflare's verdict is.
 *
 * A deliberately invalid token is sent, so a "success" is never expected and never possible here:
 * the whole signal is WHICH failure comes back.
 */
async function assertSecretIsRealAtCloudflare(secret) {
  const body = new URLSearchParams({ secret, response: 'not-a-real-token' })
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Cloudflare siteverify -> HTTP ${res.status}`)
  const json = await res.json()
  const codes = json['error-codes'] || []
  if (codes.includes('invalid-input-secret') || codes.includes('missing-input-secret')) {
    throw new Error(
      `Cloudflare REFUSED this secret (${codes.join(', ')}). TURNSTILE_SECRET is not the secret key ` +
        `for the Beize Jass Tour widget (site key ${SITE_KEY}). Enabling captcha with it would reject ` +
        'every real sign-in while the switch read healthy. Refusing to touch Supabase.'
    )
  }
  if (!codes.includes('invalid-input-response')) {
    throw new Error(
      `Cloudflare gave an unexpected verdict (${JSON.stringify(codes)}) for a deliberately invalid ` +
        'token. Expected invalid-input-response. Not proceeding on an answer nobody predicted.'
    )
  }
  console.log('ok - Cloudflare accepted the secret (it rejected only our deliberately invalid token).')
}

function printState(label, cfg) {
  console.log(`${label}:`)
  console.log(`  security_captcha_enabled  = ${cfg.security_captcha_enabled === true}`)
  console.log(`  security_captcha_provider = ${cfg.security_captcha_provider || '(none)'}`)
  console.log(`  security_captcha_secret   : ${shape(cfg.security_captcha_secret)}`)
}

async function main() {
  const [mode] = process.argv.slice(2)
  const idx = process.argv.indexOf('--project')
  const key = idx > -1 ? process.argv[idx + 1] : ''
  const project = PROJECTS[key]

  if (!['report', 'enable', 'disable'].includes(mode) || !project) {
    console.error('usage: node scripts/auth-captcha.mjs report|enable|disable --project production')
    console.error('(production is the only project: uyksotlmrlxhmyeopktl. There is no staging, and the')
    console.error(' retired duplicate dkxdlovwzsxnepoteebk is deliberately not reachable from here.)')
    process.exit(2)
  }

  console.log(`${project.name} (${project.ref}) — ${mode}\n`)
  const before = await getAuthConfig(project.ref)
  printState('before', before)

  if (mode === 'report') {
    // Also answer the question that actually blocks the flip, not only the one that is easy to
    // print: is a usable secret reachable at all, and does Cloudflare agree it is the right one.
    try {
      const secret = turnstileSecret()
      console.log(`\nTurnstile secret from $TURNSTILE_SECRET: ${shape(secret)}`)
      await assertSecretIsRealAtCloudflare(secret)
    } catch (err) {
      console.log(`\nTurnstile secret NOT usable: ${err.message}`)
    }
    process.exit(0)
  }

  let body
  if (mode === 'enable') {
    const secret = turnstileSecret()
    console.log(`\nusing the Turnstile secret from $TURNSTILE_SECRET: ${shape(secret)}`)
    await assertSecretIsRealAtCloudflare(secret)
    body = { security_captcha_enabled: true, security_captcha_provider: 'turnstile', security_captcha_secret: secret }
  } else {
    body = { security_captcha_enabled: false }
  }

  const res = await mgmt(`/projects/${project.ref}/config/auth`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    // The response body can echo what was sent. Never render it.
    throw new Error(`PATCH config/auth -> HTTP ${res.status}`)
  }

  const after = await getAuthConfig(project.ref)
  console.log('')
  printState('after', after)

  const want = mode === 'enable'
  if ((after.security_captcha_enabled === true) !== want) {
    console.error(`\nFAIL - the switch did not move: still enabled=${after.security_captcha_enabled === true}`)
    process.exit(1)
  }
  if (want && after.security_captcha_provider !== 'turnstile') {
    console.error(`\nFAIL - captcha is on but the provider is ${after.security_captcha_provider}, not turnstile`)
    process.exit(1)
  }
  console.log(`\nok - CAPTCHA is now ${want ? 'ENABLED' : 'DISABLED'} on ${project.name}.`)
  if (want) {
    console.log('Prove it with: node scripts/signin-captcha.prod.test.mjs')
    console.log('Roll it back with: node scripts/auth-captcha.mjs disable --project ' + key)
  }
}

main().catch((err) => {
  console.error(`ERROR - ${err.message}`)
  process.exit(1)
})

# Security rulebook Wave 2 — 2026-11-04

This change implements the repository part of `security-standard.md` §5 and
`PLAN-security-rulebook-fix-2026-11-04.md` Wave 2. It does not establish that the
production host is compliant: nothing was deployed and no product was probed.

## Browser and hosting rules

- **SR-HDR-01/02/03/04/05/06/07/08/09:** the six browser headers use `Header always set`.
  HSTS is two years with `includeSubDomains`, without opting mueller.ro into preload.
  The CSP retains Turnstile in script, frame and connect sources; the exact
  `uyksotlmrlxhmyeopktl.supabase.co` HTTPS and realtime origins remain. Source review
  found no other browser API, remote font, image, script or stylesheet origin.
  The unused Supabase wildcards are removed. React inline styles, local/data/blob
  images and the existing PWA remain allowed. There is no `<base>`, external form
  action, `window.open` or OAuth popup, so base/object/framing denial and COOP
  `same-origin` are appropriate. CORP applies to HTML, avoiding blanket image restrictions.
- **SR-HDR-06:** the default is `same-origin`. Only `/` and `/auth` use `no-referrer`,
  because the Supabase client consumes session links and the recorded auth Site URL
  is the root (see `FIX-auth-emails-pointed-at-localhost-2026-09-01.md`). The match uses
  the original HTTP request line so it survives rewriting to `index.html`.
- **SR-HDR-10:** HTML retains revalidation/no-store; hashed assets retain immutable
  caching. Stable PWA entry files revalidate. All responses of the only edge function,
  `verify-jass-password`, now carry `Cache-Control: no-store`, including error paths.
  The password comparison, authentication and database behavior are unchanged.
- **SR-HOST-02/03/04/05, SR-FE-01, SR-SUP-09:** starter private-file denials and upload
  guards are copied from project-starter PR #7, commit `ee73ba6`. The original routing,
  trailing-slash behavior and compression remain. The remote `.site-id` is still
  required before uploading, but is no longer copied into `dist`; the existing remote
  marker is pre-seeded and accessible only over FTP. Both private-file and gitleaks
  build scans block the upload. The GET header check follows the existing live-asset check.
- **SR-HOST-10:** the Contact line was copied verbatim from the single normal GET of
  [Predivo's security.txt](https://predivo.ch/.well-known/security.txt) on 2026-11-04.
  The product's file expires on 2027-11-03 and has its own canonical URL.
- **SR-HOST-11:** the starter scanner guard covers this product and the fleet's shared
  hosts. Private-file behavior is tested offline; header-check tests inject transport
  and time. Jass Tour has no staging harness, so the starter staging-template assertion
  is adapted to this repository's production check wiring; GET, redirect refusal and
  one-second pacing remain covered. Three existing Supabase health probes remain in
  `e2e/critical-path.spec.ts`, explicitly tagged `@live`; PR CI excludes them and uses
  loopback app/backend URLs with external browser requests blocked. Their assertions
  are preserved for authorised manual runs. Live CAPTCHA/infrastructure tests were not run.
- **SR-FE-08:** no Google Fonts are loaded. `src/index.css` uses the system font stack;
  there are no Google font origins to remove or font files to download.

## Workflow and supply-chain rules

- **SR-SUP-01/05/06/07/09/11:** CI installs with `npm ci`. Action tags were resolved
  with `git ls-remote` and pinned to full commit SHAs (annotated tags use the peeled
  commit), with readable version comments. Top-level permissions are `contents: read`;
  review jobs retain their documented comment/OIDC rights. Event data never enters
  shell code directly. Gitleaks 8.24.3 uses `$RUNNER_TEMP`, blocking event/tree/build
  scans and an advisory full-history scan. Semgrep remains blocking on production
  and also runs on PRs; the pinned zizmor action/tool reports without blocking.
  Enabling typecheck exposed stale local database types (columns already declared in
  `20260211140000_player_auth.sql`), the presence payload's missing generic, and test
  matcher/Node type setup. These were repaired without changing queries or migrations.
- **SR-SUP-08:** GitHub reports this repository as **public**, no repository variables,
  and **zero registered runners** on 2026-11-04. Every job stays explicitly on
  GitHub-hosted `ubuntu-latest`; the offline guard enforces that choice.
- **SR-SUP-12 — Roger's decision, 2026-11-04:** use the free workflow substitute for
  branch protection. Every push to `main` runs `main-pr`, with no path exclusions.
  A manual production release needs that job and is restricted to `main`. It checks
  `gh api repos/<repo>/commits/<sha>/pulls` and requires an exact merged PR into this
  repository's default branch, then checks the PR's own status rollup (including its
  test-merge checks). `critical-path`, `gitleaks` and `sast` must have succeeded before
  the merge; other checks cannot be failed/pending. Conditional optional jobs may
  be skipped/neutral. Missing evidence and API errors fail closed. Workflow ownership
  is recorded in `.github/CODEOWNERS`. This detects a direct push and blocks release;
  it cannot prevent the push or an administrator changing/removing the gate. No GitHub
  settings were changed. Rebase-only integration without an exact associated merge
  commit is intentionally refused; use the repository's normal PR merge/squash path.

## Remaining work and scope limits

- **SR-HOST-01 and the host portion of SR-HDR-01 remain open.** In Plesk, Roger must
  enable proxy mode and disable both smart static processing and direct nginx static
  serving for the product (and any future staging copy). nginx-generated redirects,
  authentication challenges and errors need their own `add_header ... always`
  directives. `.htaccess` cannot change those settings. The repository header rules
  and post-release GET gate are prepared, not claimed as live verification.
- **SR-HOST-06 remains open.** There is no staging deploy job, URL or staging credential
  configuration in this repository. Per the explicit staging-only instruction, all
  production FTP connection settings remain unchanged. A future staging job must use
  `tertia.sui-inter.net`, `ssl:verify-certificate yes` and `ftp:ssl-protect-data yes`.
  Production follows only after three successful staging deploys (deploy-standard §5d).
- **SR-SUP-03 remains open.** The installed npm is **11.6.2**, below the requested
  **11.10** threshold, so no unsupported `min-release-age` setting is added.
- Database, sign-in configuration, DNS, mail, production deployment and GitHub settings
  are outside this PR. Work-board and codebase graph MCP tools were unavailable in this
  session. Checks and exact counts are recorded in the pull request.

References for the gate and header semantics:
[GitHub commit-to-PR API](https://docs.github.com/en/rest/commits/commits#list-pull-requests-associated-with-a-commit),
[Apache expressions](https://httpd.apache.org/docs/2.4/expr.html),
[Apache Header directive](https://httpd.apache.org/docs/2.4/mod/mod_headers.html#header).

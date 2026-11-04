import test from 'node:test'
import assert from 'node:assert/strict'
import { assertGreenPullRequest, mergedPullRequest, checkMainPr, githubClient } from '../check-main-pr.mjs'
import fs from 'node:fs'

const sha = 'a'.repeat(40)
const options = { repo: 'Predivo-GmbH/jass-tour-ui-kit', sha, branch: 'main', ref: 'refs/heads/main' }
const pr = { number: 42, merged_at: '2026-11-04T10:00:00Z', state: 'closed', merge_commit_sha: sha,
  base: { ref: 'main', repo: { full_name: options.repo } }, head: { sha: 'b'.repeat(40) } }
const success = name => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion: 'SUCCESS', completedAt: '2026-11-04T09:00:00Z' })
const details = () => ({ headRefOid: pr.head.sha, statusCheckRollup: [success('critical-path'), success('gitleaks'), success('sast')] })

test('accepts the exact merged PR, including squash merges, with green checks', () => {
  assert.equal(mergedPullRequest([pr], options), pr)
  assert.doesNotThrow(() => assertGreenPullRequest(pr, details()))
})
test('direct pushes, other revisions, open PRs and wrong destinations fail closed', () => {
  for (const pulls of [[], [{ ...pr, merge_commit_sha: 'c'.repeat(40) }], [{ ...pr, merged_at: null }],
    [{ ...pr, state: 'open' }], [{ ...pr, base: { ...pr.base, ref: 'staging' } }],
    [{ ...pr, base: { ref: 'main', repo: { full_name: 'another/repo' } } }]]) {
    assert.throws(() => mergedPullRequest(pulls, options), /not a merged pull request/)
  }
})
test('absent, pending, failed, cancelled, unknown and late checks cannot approve a release', () => {
  for (const statusCheckRollup of [[], [success('unrelated')],
    ...['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE', 'SKIPPED', 'NEUTRAL']
      .map(conclusion => [success('critical-path'), success('sast'), { ...success('gitleaks'), conclusion }]),
    [success('critical-path'), success('sast'), { ...success('gitleaks'), status: 'IN_PROGRESS' }],
    [...details().statusCheckRollup, { __typename: 'StatusContext', context: 'legacy', state: 'PENDING' }],
    [...details().statusCheckRollup, { __typename: 'Unknown', name: 'unknown' }],
    [...details().statusCheckRollup, { ...success('optional'), name: undefined }],
    ...['2026-11-04T11:00:00Z', null, 'invalid'].map(completedAt =>
      [success('critical-path'), success('sast'), { ...success('gitleaks'), completedAt }])]) {
    assert.throws(() => assertGreenPullRequest(pr, { ...details(), statusCheckRollup }))
  }
  assert.throws(() => assertGreenPullRequest(pr, { ...details(), headRefOid: sha }), /head changed/)
  assert.throws(() => assertGreenPullRequest({ ...pr, merged_at: null }, details()), /merge time/)
})
test('optional skipped jobs do not replace the required successful security checks', () => {
  const detail = details()
  detail.statusCheckRollup.push({ ...success('optional'), conclusion: 'SKIPPED' })
  assert.doesNotThrow(() => assertGreenPullRequest(pr, detail))
})
test('the commit association and head checks decide the release, and bad input never reaches the API', async () => {
  const calls = []
  const github = {
    async pullsForCommit(repo, commit) { calls.push(['pulls', repo, commit]); return [pr] },
    async pullRequestChecks(repo, head) { calls.push(['checks', repo, head]); return details() },
  }
  assert.equal(await checkMainPr({ ...options, github }), 42)
  assert.deepEqual(calls, [['pulls', options.repo, sha], ['checks', options.repo, pr.head.sha]])
  const untouchable = { pullsForCommit() { assert.fail('must reject before API access') }, pullRequestChecks() { assert.fail('must reject before API access') } }
  for (const repo of ['../bad', 'owner/..', 'owner/.', 'a/b/c', '', undefined]) {
    await assert.rejects(checkMainPr({ repo, sha, github: untouchable }), /GITHUB_REPOSITORY/, String(repo))
  }
  await assert.rejects(checkMainPr({ ...options, sha: 'abc', github: untouchable }), /GITHUB_SHA/)
  await assert.rejects(checkMainPr({ ...options, github: { ...github, async pullsForCommit() { throw new Error('API unavailable') } } }), /API unavailable/)
})

// The BackOffice runner regression must stay covered even on our GitHub-hosted runner.
// The check must need nothing but Node, so these drive the real client through a fake fetch.
const json = (body, { status = 200, link } = {}) => ({ ok: status >= 200 && status < 300, status,
  headers: { get: name => (name.toLowerCase() === 'link' ? link ?? null : null) }, json: async () => body })
const checkRun = name => ({ name, head_sha: pr.head.sha, status: 'completed', conclusion: 'success', completed_at: '2026-11-04T09:00:00Z' })
const statusContext = { context: 'external-ci', state: 'success', created_at: '2026-11-04T08:00:00Z', updated_at: '2026-11-04T09:00:00Z' }
const endpoint = (commit, suffix) => `https://api.test/repos/${options.repo}/commits/${commit}/${suffix}`
const pullsUrl = endpoint(sha, 'pulls?per_page=100')
const checksUrl = endpoint(pr.head.sha, 'check-runs?filter=latest&per_page=100')
const statusUrl = endpoint(pr.head.sha, 'status?per_page=100')
const client = fetchImpl => githubClient({ token: 'offline-fixture', apiUrl: 'https://api.test', fetchImpl })
const routes = (overrides = {}) => async url => {
  const responses = {
    [pullsUrl]: json([pr]),
    [checksUrl]: json({ total_count: 3, check_runs: [checkRun('critical-path'), checkRun('gitleaks'), checkRun('sast')] }),
    [statusUrl]: json({ sha: pr.head.sha, total_count: 0, state: 'pending', statuses: [] }),
    ...overrides,
  }
  assert.ok(Object.hasOwn(responses, url), `Unexpected URL: ${url}`)
  return responses[url]
}

test('fetch-only REST gate accepts a green merged PR and reads every PR, check and status page', async () => {
  const requests = []
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url, init })
    return routes({
      [pullsUrl]: json([], { link: `<${pullsUrl}&page=2>; rel="next"` }),
      [`${pullsUrl}&page=2`]: json([pr]),
      [checksUrl]: json({ total_count: 3, check_runs: [checkRun('critical-path'), checkRun('sast')] }, { link: `<${checksUrl}&page=2>; rel="next"` }),
      [`${checksUrl}&page=2`]: json({ total_count: 3, check_runs: [checkRun('gitleaks')] }),
      [statusUrl]: json({ sha: pr.head.sha, total_count: 2, state: 'success', statuses: [statusContext] }, { link: `<${statusUrl}&page=2>; rel="next"` }),
      [`${statusUrl}&page=2`]: json({ sha: pr.head.sha, total_count: 2, state: 'success', statuses: [{ ...statusContext, context: 'other-ci' }] }),
    })(url)
  }
  assert.equal(await checkMainPr({ ...options, github: client(fetchImpl) }), 42)
  assert.equal(requests.length, 6)
  assert.ok(requests.every(r => r.init.method === 'GET' && r.init.headers.Authorization === 'Bearer offline-fixture'))
  assert.ok(requests.every(r => r.init.redirect === 'error' && r.init.signal instanceof AbortSignal))
})

test('injected fetch refuses a direct push before asking for any checks', async () => {
  let calls = 0
  const github = client(async url => {
    calls++
    assert.equal(url, pullsUrl)
    return json([])
  })
  await assert.rejects(checkMainPr({ ...options, github }), /not a merged pull request/)
  assert.equal(calls, 1)
})

test('successful check runs with no legacy statuses pass despite the empty combined pending state', async () => {
  assert.equal(await checkMainPr({ ...options, github: client(routes()) }), 42)
})

test('REST failures, missing or mismatched evidence, and failed or late head results block release', async () => {
  const badChecks = [
    json({ total_count: 0, check_runs: [] }),
    json({ total_count: 3, check_runs: [checkRun('critical-path'), checkRun('sast')] }),
    ...['failure', 'cancelled', 'timed_out', 'action_required'].map(conclusion => json({ total_count: 3, check_runs: [checkRun('critical-path'), checkRun('sast'), { ...checkRun('gitleaks'), conclusion }] })),
    ...[{ status: 'in_progress' }, { head_sha: sha }, { completed_at: '2026-11-04T11:00:00Z' }, { completed_at: null }]
      .map(patch => json({ total_count: 3, check_runs: [checkRun('critical-path'), checkRun('sast'), { ...checkRun('gitleaks'), ...patch }] })),
  ]
  const badStatuses = [
    ...['pending', 'failure', 'error'].map(state => json({ sha: pr.head.sha, total_count: 1, state, statuses: [{ ...statusContext, state }] })),
    json({ sha, total_count: 0, state: 'pending', statuses: [] }),
    json({ sha: pr.head.sha, total_count: 1, state: 'success', statuses: [] }),
    json({ sha: pr.head.sha, total_count: 1, state: 'success', statuses: [{ ...statusContext, updated_at: '2026-11-04T11:00:00Z' }] }),
  ]
  for (const overrides of [
    ...[pullsUrl, checksUrl, statusUrl].map(url => ({ [url]: json({}, { status: 403 }) })),
    { [pullsUrl]: json({}) }, { [pullsUrl]: json([{ ...pr, head: {} }]) },
    { [checksUrl]: json({}) }, { [statusUrl]: json({}) },
    ...badChecks.map(response => ({ [checksUrl]: response })),
    ...badStatuses.map(response => ({ [statusUrl]: response })),
  ]) await assert.rejects(checkMainPr({ ...options, github: client(routes(overrides)) }))
})

test('a failing second page cannot be hidden behind a green first page', async () => {
  await assert.rejects(checkMainPr({ ...options, github: client(routes({
    [checksUrl]: json({ total_count: 4, check_runs: [checkRun('critical-path'), checkRun('gitleaks'), checkRun('sast')] }, { link: `<${checksUrl}&page=2>; rel="next"` }),
    [`${checksUrl}&page=2`]: json({ total_count: 4, check_runs: [{ ...checkRun('unit'), conclusion: 'failure' }] }),
  })) }), /not green/)
})

test('pagination cannot leak the token to another origin or loop indefinitely', async () => {
  for (const next of ['https://untrusted.test/steal', pullsUrl, endpoint(sha, 'different')]) {
    await assert.rejects(checkMainPr({ ...options, github: client(routes({
      [pullsUrl]: json([], { link: `<${next}>; rel="next"` }),
    })) }), /unsafe pagination|repeated pages/)
  }
})

test('the release check never shells out, so it needs no CLI the runner might lack', () => {
  const source = fs.readFileSync(new URL('../check-main-pr.mjs', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(source, /child_process|execFile|spawn|['"]gh['"]/)
})

test('missing credentials and network errors fail closed', async () => {
  assert.throws(() => githubClient({ token: '', fetchImpl() { assert.fail('no request without a token') } }), /GITHUB_TOKEN/)
  await assert.rejects(checkMainPr({ ...options, github: client(async () => { throw new Error('network unavailable') }) }), /network unavailable/)
  await assert.rejects(checkMainPr({ ...options, github: client(async () => ({ ...json([]), json: async () => { throw new SyntaxError('Invalid JSON') } })) }), /Invalid JSON/)
})

test('default branch and ref validation refuses invalid manual release selections before fetching', async () => {
  for (const change of [{ ref: 'refs/heads/feature' }, { ref: 'refs/tags/release' }, { branch: '' }, { branch: undefined }]) {
    const github = client(() => assert.fail('invalid input must never fetch'))
    await assert.rejects(checkMainPr({ ...options, ...change, github }), /default branch/)
  }
})

test('required Actions checks cannot be replaced by successful legacy status contexts', () => {
  const detail = details()
  detail.statusCheckRollup[0] = { __typename: 'StatusContext', context: 'critical-path', state: 'SUCCESS', completedAt: '2026-11-04T09:00:00Z' }
  assert.throws(() => assertGreenPullRequest(pr, detail), /critical-path/)
  for (const name of ['critical-path', 'gitleaks', 'sast']) {
    assert.throws(() => assertGreenPullRequest(pr, { ...detail, statusCheckRollup: details().statusCheckRollup.filter(c => c.name !== name) }), /lacks a successful/)
  }
})

test('every main push and manual release use the blocking REST gate with a read-only token', () => {
  const workflow = fs.readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8')
  const trigger = workflow.split('concurrency:')[0]
  assert.match(trigger, /push:\s+branches: \[main\]/)
  assert.doesNotMatch(trigger, /paths(?:-ignore)?:/)
  assert.match(workflow, /needs: \[main-pr, validate, gate-security\]/)
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/)
  const gate = workflow.split('  main-pr:')[1].split('  validate:')[0]
  assert.match(gate, /run: node scripts\/check-main-pr\.mjs/)
  assert.match(gate, /GITHUB_TOKEN: \$\{\{ github.token \}\}/)
  for (const permission of ['contents', 'pull-requests', 'checks', 'statuses']) assert.match(gate, new RegExp(permission + ': read'))
  assert.doesNotMatch(gate, /continue-on-error:|\|\|\s*true/)
})

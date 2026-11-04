import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { assertGreenPullRequest, checkMainPr, requiredChecks } from '../check-main-pr.mjs'

const sha = 'a'.repeat(40)
const head = 'b'.repeat(40)
const options = { repo: 'owner/project', sha, branch: 'main', ref: 'refs/heads/main' }
const identity = { sha, head, branch: 'main' }
const fixture = () => ({ state: 'MERGED', baseRefName: 'main', mergeCommit: { oid: sha }, headRefOid: head,
  mergedAt: '2026-11-04T12:00:00Z', statusCheckRollup: requiredChecks.map(name => ({
    __typename: 'CheckRun', name, workflowName: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS',
    startedAt: '2026-11-04T11:00:00Z', completedAt: '2026-11-04T11:30:00Z',
  })) })
const associated = { number: 7, state: 'closed', merged_at: '2026-11-04T12:00:00Z', merge_commit_sha: sha,
  head: { sha: head }, base: { ref: 'main', repo: { full_name: 'owner/project' } } }

test('exact merged PR with the required checks green before merge passes', () => {
  assert.doesNotThrow(() => assertGreenPullRequest(fixture(), identity))
  const calls = []
  const run = (command, args) => {
    calls.push([command, args])
    return JSON.stringify(args[0] === 'api' ? [[], [associated]] : fixture())
  }
  assert.equal(checkMainPr({ ...options, run }), 7)
  assert.deepEqual(calls[0], ['gh', ['api', '--paginate', '--slurp', `repos/owner/project/commits/${sha}/pulls?per_page=100`]])
  assert.equal(calls[1][1][0], 'pr')
})

test('direct pushes, unmerged PRs, wrong base, contained commits and foreign repos fail', () => {
  for (const pr of [null, { ...associated, state: 'open' }, { ...associated, merged_at: null },
    { ...associated, merge_commit_sha: head }, { ...associated, base: { ...associated.base, ref: 'other' } },
    { ...associated, base: { ref: 'main', repo: { full_name: 'attacker/project' } } }]) {
    assert.throws(() => checkMainPr({ ...options, run: () => JSON.stringify([pr ? [pr] : []]) }), /merged pull request/)
  }
})

test('dispatches on other refs and malformed inputs fail before any GitHub call', () => {
  for (const change of [{ ref: 'refs/heads/feature' }, { ref: 'refs/tags/release' }, { sha: 'abc' },
    { branch: '' }, { repo: '../project' }]) {
    let calls = 0
    assert.throws(() => checkMainPr({ ...options, ...change, run: () => { calls++; return '[]' } }), /default branch|merged pull request/)
    assert.equal(calls, 0)
  }
})

test('API failure and malformed evidence fail closed without exposing command output', () => {
  for (const run of [() => { throw new Error('sensitive transport diagnostic') }, () => 'not json']) {
    assert.throws(() => checkMainPr({ ...options, run }), /^Error: GitHub could not provide/)
  }
})

test('rollup must belong to the same merged PR and commit', () => {
  for (const change of [{ state: 'OPEN' }, { baseRefName: 'other' }, { mergeCommit: { oid: head } },
    { headRefOid: sha }, { mergedAt: null }]) {
    assert.throws(() => assertGreenPullRequest({ ...fixture(), ...change }, identity), /exact merge|merge time/)
  }
})

test('absent, red, pending, cancelled, stale and post-merge checks cannot release', () => {
  for (const change of [{ status: 'IN_PROGRESS' }, { conclusion: 'FAILURE' }, { conclusion: 'CANCELLED' },
    { conclusion: 'TIMED_OUT' }, { conclusion: 'STALE' }, { conclusion: 'SKIPPED' }, { conclusion: 'NEUTRAL' },
    { completedAt: '2026-11-04T12:01:00Z' }, { completedAt: null }, { startedAt: null }]) {
    const pr = fixture()
    Object.assign(pr.statusCheckRollup[0], change)
    assert.throws(() => assertGreenPullRequest(pr, identity), /not green|not complete|Missing/)
  }
  for (const checks of [null, [], fixture().statusCheckRollup.slice(1)]) {
    assert.throws(() => assertGreenPullRequest({ ...fixture(), statusCheckRollup: checks }, identity), /no check evidence|Missing/)
  }
})

test('optional conditional jobs may skip; legacy statuses must pass and cannot replace Actions', () => {
  const pr = fixture()
  pr.statusCheckRollup.push({ ...pr.statusCheckRollup[0], name: 'design-review', conclusion: 'SKIPPED' })
  pr.statusCheckRollup.push({ __typename: 'StatusContext', context: 'legacy', state: 'SUCCESS', createdAt: '2026-11-04T11:30:00Z' })
  assert.doesNotThrow(() => assertGreenPullRequest(pr, identity))
  pr.statusCheckRollup.at(-1).state = 'PENDING'
  assert.throws(() => assertGreenPullRequest(pr, identity), /not green/)
  const spoof = fixture()
  spoof.statusCheckRollup[0] = { __typename: 'StatusContext', context: requiredChecks[0], state: 'SUCCESS', createdAt: '2026-11-04T11:30:00Z' }
  assert.throws(() => assertGreenPullRequest(spoof, identity), /Missing successful/)
})

test('a successful rerun supersedes a failure, but a new pending rerun fails', () => {
  const pr = fixture()
  pr.statusCheckRollup.push({ ...pr.statusCheckRollup[0], conclusion: 'FAILURE', startedAt: '2026-11-04T10:00:00Z' })
  assert.doesNotThrow(() => assertGreenPullRequest(pr, identity))
  pr.statusCheckRollup.push({ ...pr.statusCheckRollup[0], status: 'IN_PROGRESS', startedAt: '2026-11-04T11:45:00Z' })
  assert.throws(() => assertGreenPullRequest(pr, identity), /not green/)
})

test('every main push is checked and production depends on the provenance job', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8')
  const trigger = workflow.split('concurrency:')[0]
  assert.match(trigger, /push:\s+branches: \[main\]/)
  assert.doesNotMatch(trigger, /paths(?:-ignore)?:/)
  assert.match(workflow, /needs: \[main-pr, validate, gate-security\]/)
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /run: node scripts\/check-main-pr\.mjs/)
})

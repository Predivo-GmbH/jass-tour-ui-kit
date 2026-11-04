#!/usr/bin/env node
// SR-SUP-12: Roger's free release gate; it detects bypasses but cannot prevent a push.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const requiredChecks = ['critical-path', 'gitleaks', 'sast']

export function assertGreenPullRequest(pr, { sha, head, branch }) {
  if (pr.state !== 'MERGED' || pr.baseRefName !== branch || pr.mergeCommit?.oid !== sha || pr.headRefOid !== head) {
    throw new Error('The selected commit must be the exact merge of this pull request into the default branch')
  }
  const mergedAt = Date.parse(pr.mergedAt)
  if (!Number.isFinite(mergedAt)) throw new Error('Missing merge time')
  const checks = pr.statusCheckRollup
  if (!Array.isArray(checks) || !checks.length) throw new Error('Pull request has no check evidence')
  const latest = new Map()
  for (const check of checks) {
    const name = check.name ?? check.context
    if (!name) throw new Error('Unrecognised check evidence')
    const key = `${check.workflowName ?? ''}:${name}`
    const time = Date.parse(check.startedAt ?? check.createdAt)
    if (!Number.isFinite(time)) throw new Error(`Missing check time: ${name}`)
    if (!latest.has(key) || time >= latest.get(key).time) latest.set(key, { check, name, time })
  }
  const successful = new Set()
  for (const { check, name } of latest.values()) {
    const completed = Date.parse(check.completedAt ?? check.createdAt)
    if (!Number.isFinite(completed) || completed > mergedAt) throw new Error(`Check was not complete before merge: ${name}`)
    if (check.__typename === 'CheckRun') {
      if (check.status !== 'COMPLETED' || !['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(check.conclusion)) {
        throw new Error(`Pull request check is not green: ${name}`)
      }
      if (check.conclusion === 'SUCCESS') successful.add(name)
    } else if (check.__typename === 'StatusContext' && check.state === 'SUCCESS') {
      // Legacy statuses must be green too; they cannot impersonate the required Actions jobs.
    } else throw new Error(`Pull request status is not green: ${name}`)
  }
  for (const name of requiredChecks) {
    if (!successful.has(name)) throw new Error(`Missing successful required check: ${name}`)
  }
}

export function checkMainPr({ repo, sha, ref, branch, run = execFileSync }) {
  if (!/^[a-z\d][\w.-]*\/[a-z\d][\w.-]*$/i.test(repo ?? '') || !/^[a-f\d]{40}$/i.test(sha ?? '')
    || !branch || ref !== `refs/heads/${branch}`) {
    throw new Error('Release provenance requires a full commit SHA on the default branch')
  }
  const json = args => {
    try { return JSON.parse(run('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })) }
    catch { throw new Error('GitHub could not provide pull-request/check evidence; refusing release') }
  }
  // Paginate: merely finding a PR that contains this commit is not enough. It must have merged it.
  const pages = json(['api', '--paginate', '--slurp', `repos/${repo}/commits/${sha}/pulls?per_page=100`])
  const candidates = pages.flat().filter(pr => pr.state === 'closed' && pr.merged_at
    && pr.merge_commit_sha === sha && pr.base?.ref === branch && pr.base?.repo?.full_name === repo)
  if (!candidates.length) throw new Error('Commit did not reach the default branch through a merged pull request')
  const pr = candidates[0]
  // GitHub's PR rollup includes the checks run on the PR test-merge, unlike head-only REST checks.
  const evidence = json(['pr', 'view', String(pr.number), '--repo', repo,
    '--json', 'state,baseRefName,mergeCommit,headRefOid,mergedAt,statusCheckRollup'])
  assertGreenPullRequest(evidence, { sha, head: pr.head.sha, branch })
  return pr.number
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const number = checkMainPr({ repo: process.env.GITHUB_REPOSITORY, sha: process.env.GITHUB_SHA,
      ref: process.env.GITHUB_REF, branch: process.env.DEFAULT_BRANCH })
    console.log(`Release commit came from merged PR #${number}, with green checks before merge.`)
  } catch (error) {
    console.error(`::error::${error.message}`)
    process.exitCode = 1
  }
}

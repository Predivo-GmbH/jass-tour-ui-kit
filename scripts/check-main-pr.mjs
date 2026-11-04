#!/usr/bin/env node
// SR-SUP-12: Roger's blocking release gate; direct pushes cannot authorize a release.
// REST client adapted from BackOffice 56a98437: Node fetch needs no runner-installed gh CLI.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const requiredChecks = ['critical-path', 'gitleaks', 'sast']

export function mergedPullRequest(pulls, { repo, sha, branch = 'main' }) {
  const pr = pulls.find(p => p.merged_at && p.state === 'closed'
    && p.merge_commit_sha === sha && p.base?.ref === branch
    && p.base?.repo?.full_name?.toLowerCase() === repo.toLowerCase())
  if (!pr) throw new Error('Release refused: this exact commit is not a merged pull request to the default branch.')
  return pr
}

export function assertGreenPullRequest(pr, detail) {
  if (detail.headRefOid !== pr.head?.sha) throw new Error('Pull request head changed; checks do not prove this revision.')
  const mergedAt = Date.parse(pr.merged_at)
  if (!Number.isFinite(mergedAt)) throw new Error('Pull request has no valid merge time.')
  const checks = detail.statusCheckRollup
  if (!Array.isArray(checks) || checks.length === 0) throw new Error('Pull request has no checks.')
  // All three Actions jobs must succeed on the exact PR head before the merge.
  for (const name of requiredChecks) {
    if (!checks.some(c => c.__typename === 'CheckRun' && c.name === name && c.status === 'COMPLETED' && c.conclusion === 'SUCCESS')) {
      throw new Error(`Pull request lacks a successful ${name} check.`)
    }
  }
  for (const check of checks) {
    if (!(check.name ?? check.context)) throw new Error('Unrecognised check evidence.')
    const green = check.__typename === 'StatusContext'
      ? check.state === 'SUCCESS'
      : check.__typename === 'CheckRun' && check.status === 'COMPLETED'
        && ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(check.conclusion)
    if (!green) throw new Error(`Pull request check is not green: ${check.name ?? check.context ?? 'unknown'}`)
    // Do not let a later rerun turn a red-at-merge PR into permission to release.
    if (!Number.isFinite(Date.parse(check.completedAt))) throw new Error('Pull request check has no completion time.')
    if (Date.parse(check.completedAt) > mergedAt) {
      throw new Error('Pull request checks finished after the merge; a new green PR is required.')
    }
  }
}

const nextLink = header => /<([^>]+)>;\s*rel="next"/.exec(header ?? '')?.[1] ?? null

// Read only REST evidence for the immutable PR head, never the new merge commit's running jobs.
// Every non-2xx or malformed/incomplete response refuses the release.
export function githubClient({ token = process.env.GITHUB_TOKEN,
  apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com',
  fetchImpl = globalThis.fetch } = {}) {
  if (!token) throw new Error('GITHUB_TOKEN is not set; the pull request behind this commit cannot be read.')
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'jass-tour-check-main-pr' }
  const pages = async (endpoint, readPage) => {
    const first = new URL(`${apiUrl.replace(/\/$/, '')}${endpoint}`)
    const items = []
    let url = first.href
    let total
    const seen = new Set()
    while (url) {
      const next = new URL(url)
      if (next.origin !== first.origin || next.pathname !== first.pathname || next.username || next.password) {
        throw new Error('GitHub API returned an unsafe pagination link.')
      }
      if (seen.has(url) || seen.size >= 50) throw new Error('Too many or repeated pages of GitHub evidence.')
      seen.add(url)
      const response = await fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(30000) })
      if (!response.ok) throw new Error(`GitHub API answered ${response.status} for ${next.pathname}.`)
      const body = await response.json()
      const batch = readPage(body)
      if (!Array.isArray(batch)) throw new Error('GitHub API returned no evidence list.')
      if (!Array.isArray(body)) {
        if (!Number.isSafeInteger(body.total_count) || body.total_count < 0
          || (total !== undefined && total !== body.total_count)) throw new Error('GitHub evidence count changed or is missing.')
        total = body.total_count
      }
      items.push(...batch)
      url = nextLink(response.headers.get('link'))
    }
    if (total !== undefined && total !== items.length) throw new Error('GitHub API returned incomplete evidence.')
    return items
  }
  return {
    async pullsForCommit(repo, sha) {
      return pages(`/repos/${repo}/commits/${sha}/pulls?per_page=100`, body => body)
    },
    async pullRequestChecks(repo, headSha) {
      if (!/^[a-f\d]{40}$/i.test(headSha ?? '')) throw new Error('Pull request has no valid head SHA.')
      const checkRuns = await pages(`/repos/${repo}/commits/${headSha}/check-runs?filter=latest&per_page=100`, body => body?.check_runs)
      if (checkRuns.some(check => check.head_sha !== headSha)) throw new Error('Check runs do not prove the pull request head.')
      const statuses = await pages(`/repos/${repo}/commits/${headSha}/status?per_page=100`, body => {
        if (body?.sha !== headSha) throw new Error('Combined status does not prove the pull request head.')
        // GitHub returns pending when there are NO legacy status contexts. Check runs still decide.
        if (body.total_count > 0 && body.state !== 'success') throw new Error('Pull request combined status is not green.')
        return body.statuses
      })
      return { headRefOid: headSha, statusCheckRollup: [
        ...checkRuns.map(check => ({ __typename: 'CheckRun', name: check.name,
          status: check.status?.toUpperCase(), conclusion: check.conclusion?.toUpperCase(), completedAt: check.completed_at })),
        ...statuses.map(status => ({ __typename: 'StatusContext', context: status.context,
          state: status.state?.toUpperCase(), completedAt: status.updated_at ?? status.created_at })),
      ] }
    },
  }
}

export async function checkMainPr({ repo, sha, ref, branch, github }) {
  // Owner: letters, digits, hyphens. Name: never `.` or `..`, which would walk the API URL path.
  if (!/^[A-Za-z\d-]+\/(?!\.\.?$)[\w.-]+$/.test(repo ?? '') || !/^[a-f\d]{40}$/i.test(sha ?? '')) {
    throw new Error('Expected GITHUB_REPOSITORY and a full GITHUB_SHA.')
  }
  if (!branch || ref !== `refs/heads/${branch}`) {
    throw new Error('Release provenance requires the default branch ref.')
  }
  const client = github ?? githubClient()
  const pr = mergedPullRequest(await client.pullsForCommit(repo, sha), { repo, sha, branch })
  assertGreenPullRequest(pr, await client.pullRequestChecks(repo, pr.head?.sha))
  return pr.number
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const number = await checkMainPr({ repo: process.env.GITHUB_REPOSITORY, sha: process.env.GITHUB_SHA,
      ref: process.env.GITHUB_REF, branch: process.env.DEFAULT_BRANCH })
    console.log(`Release provenance passed: merged PR #${number} with green checks.`)
  } catch (error) {
    console.error(`::error::${error.message}`)
    process.exitCode = 1
  }
}

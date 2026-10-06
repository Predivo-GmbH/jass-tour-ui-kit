# Jass Tour UI Kit

## Stack
- React 18 + TypeScript + Vite 7 (port 8080), Tailwind 4 + shadcn/ui, TanStack Query
- Supabase backend
- PWA enabled (vite-plugin-pwa)
- Vitest + Testing Library for tests

## Dev Server
- URL: http://localhost:8080
- Start: `npm run dev`

---

## Visual Development

### Design References
- Design principles: `/context/design-principles.md`
- Brand style guide: `/context/style-guide.md`
- When making visual (front-end, UI/UX) changes, ALWAYS refer to these files for guidance

### Quick Visual Check
IMMEDIATELY after implementing any front-end change:
1. **Identify what changed** — Review the modified components/pages
2. **Navigate to affected pages** — Use `mcp__playwright__browser_navigate` to visit each changed view
3. **Verify design compliance** — Compare against `/context/design-principles.md` and `/context/style-guide.md`
4. **Validate feature implementation** — Ensure the change fulfills the user's specific request
5. **Check acceptance criteria** — Review any provided context files, UI mocks, or requirements
6. **Capture evidence** — Take full-page screenshot at desktop viewport (1440px) of each changed view
7. **Check for errors** — Run `mcp__playwright__browser_console_messages` and fix any errors before reporting completion

### Comprehensive Design Review
Invoke the `@design-review` agent for thorough design validation when:
- Completing significant UI/UX features
- Before finalizing PRs with visual changes
- Needing comprehensive accessibility and responsiveness testing

---

## Verification Loop (MANDATORY)

After ANY code change, verify before reporting completion:
1. **Build** — `npm run build` must pass with zero TypeScript errors
2. **Lint** — `npm run lint` must pass with zero errors
3. **Test** — `npm test -- --run` must pass (all green)
4. If any step fails, fix the issue before proceeding — do NOT move on with broken code
5. **Evidence rule**: Report actual command output (exit code, pass count, error text) — never use "should work" or "probably passes"
6. **New code rule**: Every new function, hook, or endpoint MUST have at least one test
7. **Stuck rule**: 3+ failed fix attempts on the same issue → STOP, reassess architecture, ask the user

For comprehensive validation, invoke the `@build-validator` agent.

### Plan Before Building
For non-trivial features (3+ files, new patterns, architectural changes):
- Run `/plan` first to create a structured implementation plan
- Wait for user approval before writing code

---

## Branch Strategy

- **Direct to `main`**: One-commit fixes with clear, bounded scope (typo, config tweak, single-file bug fix)
- **Feature branch**: Anything requiring 2+ commits, new features, risky or experimental changes
- **Branch naming**: `feature/<name>`, `fix/<name>`, `refactor/<name>`
- **Merge locally**: Solo dev — merge to `main` via `git merge`, no PRs needed unless explicitly requested
- **Cleanup**: Delete feature branch after successful merge and push

---

## Human QA Gate (MANDATORY)

After completing work AND all automated checks pass (build, lint, test):
1. **Present summary**: What changed (files, logic), test results with actual output, screenshot evidence for UI changes
2. **Start dev server** if UI changes were made — leave it running for manual inspection
3. **Ask explicitly**: "Would you like to test manually before I merge/deploy?"
4. **WAIT** for explicit user approval — do NOT proceed silently
5. If user reports issues → fix, re-run all checks, present updated summary, ask again
6. Only merge to `main` / push / deploy after receiving explicit "go ahead" or equivalent

**Exception**: User explicitly says upfront "just fix and deploy" — skip the gate for that task only.

This applies to ALL changes, no matter how small.

---

## Debugging Protocol

When encountering bugs or unexpected failures:

### Phase 1: Root Cause Investigation
- Read the FULL error message and stack trace — do not skim
- Reproduce the issue (run the failing command, navigate to the broken page)
- Check recent changes: `git diff`, `git log --oneline -5`

### Phase 2: Pattern Analysis
- Find a working example of similar functionality in this codebase
- Compare the working version to the broken version — identify the delta

### Phase 3: Hypothesis and Testing
- Form a specific hypothesis ("X fails because Y")
- Test ONE variable at a time — do not shotgun multiple changes

### Phase 4: Implementation
- Write a failing test that captures the bug (when applicable)
- Apply the fix
- Verify the test now passes, plus all existing tests still pass

### Guardrails
- **3+ failed fix attempts** → STOP. Reassess the architecture. Ask the user if the approach is wrong.
- **NEVER apply fixes without understanding root cause first** — "try this and see" is not acceptable

---

## Superpowers Workflow

- **Changes < 3 files** with clear requirements → skip brainstorming, proceed directly to implementation
- **Changes >= 3 files**, new features, or ambiguous requirements → use brainstorming → planning → implementation flow
- **Complex debugging** → always use the systematic debugging protocol above
- **TDD**: Write at least one test for every new function, hook, or API endpoint
- **Evidence-based language**: NEVER say "should work", "probably passes", or "likely fixed" — always cite the actual command output that proves the result

---

## Code Quality

### Before Creating PRs
- Run `/code-review` for a comprehensive code quality check
- Run `/security-review` for any changes touching auth, APIs, or data handling
- Run `/design-review` for any visual/UI changes
- Run `@build-validator` to verify build, tests, lint, and no debug artifacts

### Learn From Mistakes
After a PR review catches issues, run `/learn` to extract recurring patterns and propose additions to this file.

### Rules
- NO hardcoded hex colors or magic pixel values — use design tokens
- NO new frameworks or libraries without discussion
- All components must support light and dark mode
- Comments explain 'why', not 'what'

### Pipeline Checkpoint Rule
**Before declaring any phase/step complete or asking the user what's next, you MUST:**
1. Re-read the pipeline definition (handoff doc, plan, or this file) to verify ALL deliverables for the current phase are done
2. If any deliverable is missing, continue working — do not skip ahead or ask the user to decide
3. Only move to the next phase when every artifact listed for the current phase exists and is complete
4. Never rely on memory of the pipeline — always verify against the written source of truth

This applies to any multi-phase workflow: redesigns, refactors, feature rollouts, migration plans.

---

## Project-Specific Rules

- Do NOT deploy to Vercel unless explicitly asked — user tests locally
- Path alias: `@/` maps to `./src/`
- Use Vitest with `globals: true` — do NOT import from 'vitest' in test files

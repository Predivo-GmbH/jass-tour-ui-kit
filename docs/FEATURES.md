# Maintenance feature evidence

This is a scoped maintenance register, not an inventory of every existing application feature.

## F-M001: Tailwind 4 class composition and animation compatibility

Status: validated on the repair branch; not released.

Source: src/lib/utils.ts, src/components/ui/card.tsx, src/components/ui/select.tsx, src/components/ui/toast.tsx and src/index.css. Tests: src/test/tailwind-four-class-composition.test.tsx and test/tailwind-animation-compatibility.mjs. The existing Tests workflow runs the production CSS guard. The repair retains the original public access gate, fonts, Swiss red accent and control behavior. Build, lint, all 10 unit tests and independent light/dark and animation reviews passed. See RECORD-dependency-audit-repair-2026-10-06.md for measured results and limitations.

## F-M002: Full dependency audit maintenance check

Status: verified on the repair branch; not a new release policy.

Source and test: test/no-high-dependency-advisories-in-full-tree.mjs. Command: npm run test:dependency-audit. The final audit has zero high or critical advisories and four moderate advisories, including React Router and test tooling. The check is an explicit maintenance command, not a replacement for runtime release gates.

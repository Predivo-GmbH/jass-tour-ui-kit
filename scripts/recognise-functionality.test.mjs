/**
 * FIXTURE SUITE for the functionality recogniser.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Roger, 2026-09-17, after I found three bugs in the recogniser by reading its output with my eyes:
 * "we keep on working on it without building it. This keeps on happening, and I believe there are
 * more defects you will find. What we need to do first is to make sure that you do not find any
 * further defects."
 *
 * Reading output by eye has no floor — it surprises him forever. A fixture has a known answer
 * decided in advance, so a defect shows up as a red test in two seconds instead of as another
 * paragraph in a chat.
 *
 * THE RULE FOR THIS FILE: every defect ever found in the recogniser becomes a permanent fixture
 * here, so that class can never come back quietly. The first three (marked DEFECT 1/2/3) are the
 * ones found on the first real run, 2026-09-17.
 *
 * The definition every fixture is measured against lives in docs/WHAT-COUNTS-AS-A-FUNCTIONALITY.md:
 * "something that can break is a functionality", made operational as two questions.
 *
 * Run: node --test scripts/recognise-functionality.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recogniseSource } from './recognise-functionality.mjs'

const kinds = (src) => recogniseSource(src).map((f) => f.kind)
const labels = (src) => recogniseSource(src).map((f) => f.label)
const has = (src, kind) => kinds(src).includes(kind)
const countOf = (src, kind) => kinds(src).filter((k) => k === kind).length

// ── the example that defines the unit ───────────────────────────────────────────────────────

test('a table header you can click to sort IS a functionality (Roger\'s own example)', () => {
  const src = `
    <TableHead onClick={() => reorder('name')}>Company name</TableHead>
  `
  assert.ok(has(src, 'sort-control'), 'a clickable column header must be recognised as a sort control')
})

test('DEFECT 3 — sort is recognised by SHAPE, not by the handler being called onSort', () => {
  // The first version looked for handler NAMES (onSort/setSortBy) and found zero sort controls in
  // a real product. Real code rarely uses those names.
  const src = `<th onClick={flipTheOrder}>Score</th>`
  assert.ok(has(src, 'sort-control'), 'a th with a click handler is a sort control whatever the handler is called')
})

test('a static table header is NOT a functionality', () => {
  const src = `<th className="px-4">Score</th>`
  assert.ok(!has(src, 'sort-control'), 'a header with no click handler sorts nothing')
})

test('filtering and pagination are recognised from the state they change', () => {
  const src = `
    const onInput = (e) => setSearchQuery(e.target.value)
    const later = () => setPage(page + 1)
  `
  assert.ok(has(src, 'filter-control'), 'changing a search/filter state is a filter control')
  assert.ok(has(src, 'pagination'), 'changing a page state is pagination')
})

// ── DEFECT 1: named by what the user sees, not by internals ─────────────────────────────────

test('DEFECT 1 — a button is named by its visible text, not by its handler identifier', () => {
  const src = `<button onClick={handleSave} aria-label="Save changes">Save</button>`
  assert.ok(
    labels(src).some((l) => /Save changes|Save/.test(l)),
    'the label must come from what the user reads, not from handleSave'
  )
  assert.ok(
    !labels(src).some((l) => /runs handleSave/.test(l)),
    'a function name is not how a person describes a functionality'
  )
})

test('DEFECT 1 — a translation key is used as the name when there is no literal text', () => {
  const src = `<Button onClick={go}>{t('billing.upgrade')}</Button>`
  assert.ok(labels(src).some((l) => l.includes('billing.upgrade')))
})

test('DEFECT 1 — document.getElementById inside a handler is not reported as a handler name', () => {
  const src = `<a onClick={() => document.getElementById('pricing').scrollIntoView()}>Pricing</a>`
  assert.ok(
    !labels(src).some((l) => /document\.getElementById/.test(l)),
    'a DOM call is not the name of a functionality'
  )
  assert.ok(has(src, 'action-click'), 'it is still a thing the user can do, so it must be recognised')
})

test('DEFECT 1 — a conditional inside onClick is not mistaken for the handler', () => {
  const src = `<div onClick={hasData ? openReport : undefined}>Open</div>`
  assert.ok(!labels(src).some((l) => /runs hasData/.test(l)))
})

// ── DEFECT 2: a forwarded prop is not a second functionality ────────────────────────────────

test('DEFECT 2 — a callback passed down to a child is NOT counted again', () => {
  // Per docs/WHAT-COUNTS-AS-A-FUNCTIONALITY.md: it is the SAME functionality as the one that
  // supplies it. Counting it twice adds no protection and inflates the register.
  const src = `
    export function Modal({ onClose }) {
      return <button onClick={onClose}>x</button>
    }
  `
  assert.equal(countOf(src, 'action-click'), 0, 'onClose is a prop being forwarded, not a new functionality')
})

test('DEFECT 2 — a handler the file DEFINES is counted, even if it is called onSomething', () => {
  const src = `
    const onDelete = () => api.remove(id)
    return <button onClick={onDelete}>Delete</button>
  `
  assert.ok(has(src, 'action-click'), 'a locally defined handler is this file\'s own functionality')
})

// ── the ordinary surfaces ───────────────────────────────────────────────────────────────────

test('a route is a functionality', () => {
  assert.ok(has(`<Route path="/reports/:id" element={<Report/>} />`, 'route'))
})

test('a link to another page is a functionality', () => {
  assert.ok(has(`<Link to="/billing">Billing</Link>`, 'navigation'))
})

test('a form submission is a functionality', () => {
  assert.ok(has(`<form onSubmit={handleSubmit}>`, 'form-submit'))
})

test('a form field is a functionality', () => {
  assert.ok(has(`<input name="email" type="email" />`, 'form-field'))
})

test('a file upload is a functionality', () => {
  assert.ok(has(`<input type="file" onChange={take} />`, 'file-upload'))
})

test('typing into a field is ONE functionality (the field), not two', () => {
  // CHANGED 2026-09-17 when the Defect 6 collapse landed, and the change is deliberate: this
  // fixture used to demand a separate `value-change` for the textarea's onChange. That is the SAME
  // thing the user does as "enter a value for notes" — the field and its change handler are one
  // action, and counting both is the over-reporting that made the gate unusable. The assertion is
  // now that it is recognised exactly once, which is the truth about the user.
  const src = `
    const update = (e) => setDraft(e.target.value)
    return <textarea id="notes" onChange={update} />
  `
  const items = recogniseSource(src)
  assert.equal(items.length, 1, 'one field the user types into = one functionality')
  assert.equal(items[0].kind, 'form-field')
})

test('a change handler with no field of its own is still recognised', () => {
  const src = `
    const pick = (v) => setChoice(v)
    return <MyCombo onChange={pick} aria-label="Choose a plan" />
  `
  assert.ok(has(src, 'value-change'), 'nothing more specific claims it, so it must not vanish')
})

// ── fail closed ─────────────────────────────────────────────────────────────────────────────

test('an interactive prop it cannot name is reported as unclassified, never dropped', () => {
  const src = `<Widget onMysteryEvent={boom} />`
  assert.ok(has(src, 'unclassified'), 'silently dropping what it does not understand is the failure this exists to stop')
})

test('two identical controls in one file are one functionality, not two', () => {
  const src = `
    const save = () => go()
    <button onClick={save} aria-label="Save changes">Save</button>
    <button onClick={save} aria-label="Save changes">Save</button>
  `
  assert.equal(countOf(src, 'action-click'), 1)
})

test('plain markup with nothing interactive yields nothing', () => {
  assert.equal(recogniseSource(`<p className="text-sm">Hello</p>`).length, 0)
})

// ── DEFECT 5: content, language and search surfaces are functionality too ───────────────────
// Found 2026-09-17 by running across seven products: predivo returned 21 against 134 rows because
// its functionality is pages, copy, SEO and language, not buttons. By the written definition those
// can each break on their own and a customer notices, so they must be recognised.

test('DEFECT 5 — a page that only carries SEO metadata is still a functionality', () => {
  const src = `export default function About(){ return <PageMeta title="About us" /> }`
  assert.ok(has(src, 'seo-metadata'), 'losing a title/description drops the page out of search - that is a break')
})

test('DEFECT 5 — document.title assignment counts as the search surface too', () => {
  assert.ok(has(`useEffect(() => { document.title = 'Pricing' }, [])`, 'seo-metadata'))
})

test('a page with no metadata and no controls yields nothing', () => {
  assert.equal(recogniseSource(`export default () => <section>Hello</section>`).length, 0)
})

// ── DEFECT 6: one thing a user does is ONE functionality, not three ─────────────────────────
// Found 2026-09-17 by the proof rig: a sortable column header produced a sort-control from the
// <th>, a second sort-control from the setSortBy it calls, and an action-click for the same click.
// Adding the one correct row could then never satisfy the gate. A gate that cries three times for
// one action is a gate people switch off.

test('DEFECT 6 — a sortable column header is ONE functionality, not three', () => {
  const src = `
    export default function Table() {
      const reorder = (c) => setSortBy(c)
      return <th onClick={() => reorder('name')}>Company name</th>
    }
  `
  const items = recogniseSource(src)
  assert.equal(items.filter((i) => i.kind === 'sort-control').length, 1, 'one table, one sort functionality')
  assert.equal(items.filter((i) => i.kind === 'action-click').length, 0, 'the click IS the sort - not a second thing')
})

test('DEFECT 6 — an ordinary button is still counted when nothing more specific claims it', () => {
  const src = `
    const save = () => go()
    return <button onClick={save} aria-label="Save changes">Save</button>
  `
  assert.equal(recogniseSource(src).filter((i) => i.kind === 'action-click').length, 1)
})

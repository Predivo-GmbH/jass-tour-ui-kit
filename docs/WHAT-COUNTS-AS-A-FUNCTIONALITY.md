# What counts as a functionality

**The definition, in Roger's words (2026-09-17): _something that can break is a functionality._**
"That can be anything."

Everything below is that one sentence made operational. It is written so that the recogniser, a
build agent and a reviewer all decide the same way — not so that anyone has to be asked.

## The test — two questions

1. **Can it break while everything around it still works?**
2. **Would a customer notice, or be affected, when it does?**

Both yes → it is a functionality. It needs its own row in `docs/FEATURES.md` and its own test.

**If the answer is unclear, it IS a functionality.** Err inclusive, always. A row that turns out to
be unnecessary costs one test. A missing row costs a customer finding it.

## Why this is the right cut

Clicking a column header to sort a table passes both questions: the sort can stop working while the
page, the data, the login and every other control are fine, and a customer looking at the wrong
order is affected. That is why it is a functionality, and it is the example the whole system is
calibrated against.

## Things that are functionalities

- Every route or page a user can reach
- Every control that does something when clicked, changed, typed in, toggled or submitted
- Sorting, filtering, searching, pagination, page size, bulk selection, bulk actions
- Every form field's validation, and the form's submission
- Uploads, downloads, exports, print and share actions
- Every server action (edge function, API endpoint) a user's action can reach
- Every distinct state a user can be shown: empty, loading, error, no-results, over-quota, expired
- Every permission boundary: what a signed-out visitor sees, what a non-owner cannot do
- Money: price shown, plan change, checkout, cancellation, refund, invoice
- Mail a user's action causes to be sent

## Things that are NOT a separate functionality

These are not exemptions from testing — they are things already counted somewhere else, or things
with nothing of their own to break.

- **A callback handed to a child component.** `onClose`, `onCancel`, `onSelect` passed down as a
  prop is the SAME functionality as the one that supplies it. Counting it twice adds no protection
  and inflates the register, which is how a register stops being believed.
- **A styling-only change** with no behaviour attached. If it can only break how something looks
  and not what it does, it belongs to visual checking, not here. The moment it carries behaviour
  (a hover that reveals an action, a disabled state that blocks one), it is a functionality.
- **An internal refactor with identical observable behaviour.** Nothing new can break that was not
  already covered — but the existing rows must still pass, which is what the deploy gate is for.

## The rule this exists to prevent

Every earlier generation of this system left "is the list complete?" to whoever was typing. It is
now a written test that anybody — and any machine — applies the same way, and anything that cannot
be decided by it is treated as a functionality rather than quietly dropped.

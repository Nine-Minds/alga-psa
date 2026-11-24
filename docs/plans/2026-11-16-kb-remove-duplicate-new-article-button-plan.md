# Remove the duplicate "New Article" button on the Knowledge Base Articles tab

Ticket: alga-2026-0003236 (PBNJ Consulting Inc., Phill Hodgkinson). Card `8972aa1c`.

## Problem
The Articles tab renders two create buttons that call the same handler:
- `packages/documents/src/components/kb/KnowledgeBasePage.tsx:259` — header button, `id="kb-new-article"`.
- `packages/documents/src/components/kb/KBArticleList.tsx:311-316` — the list toolbar's own button, `id="kb-list-create"`, rendered whenever an `onCreateNew` prop is passed; `KnowledgeBasePage.tsx:315` passes `handleCreateNew`.

## Decision (design session, XO under the conn)
Remove the **list toolbar's** button and keep the page-header button. The `onCreateNew` prop stays, because it also drives the empty-state affordance (`KBArticleList.tsx:325-326`, `id="kb-list-create-empty"`), which is not the reported duplicate and is the natural call to action when there are no articles at all.

Chosen over "stop passing `onCreateNew`" for two reasons:
1. It keeps the empty-state create button working (acceptance criterion 3) instead of silently deleting it.
2. It is minimal: no prop plumbing changes, no behaviour change in any other flow.

## Scope of change
File: `packages/documents/src/components/kb/KBArticleList.tsx`
- Delete the toolbar button block (the `{onCreateNew && (...)}` block containing `id="kb-list-create"`, ~lines 308-317). Keep the surrounding toolbar container and the bulk-action controls intact.
- Leave the empty-state block (`id="kb-list-create-empty"`) untouched.
- Update the `onCreateNew` doc comment on the prop (line ~82) to say it is the empty-state create affordance only.

**Not doing**: no changes to `KnowledgeBasePage.tsx` (the header button and handler are correct), no renaming of props, no new components, no CSS/toolbar restructuring.

## Order
1. Edit `KBArticleList.tsx` as above.
2. `grep -rn "kb-list-create\b" packages ee` to prove nothing selects the removed id (I already verified on main that only the two source sites mention these ids; `KBArticleList` is used by `KnowledgeBasePage` and its own `KBArticleList.bulkDelete.test.tsx`, neither of which asserts the toolbar button).
3. `npx tsc --noEmit` in `packages/documents`, and the package's vitest suite (`KBArticleList.bulkDelete.test.tsx` and siblings) to prove no regression.
4. Manual look at the Articles tab on the card dev origin (`http://feature-knowledge-base-remove-duplicate-new-article-butt.localhost:3522`, login `qa@emeraldcity.oz` / `NineMinds1234!`): exactly one "New Article" button in the page header, clicking it opens creation.

## Acceptance
- Articles tab shows exactly one "New Article" button, in the page header.
- Creating an article works from that button.
- Empty-state ("no articles") create button still renders and works.
- No test or automation references `kb-list-create`.

## Risks
- Low. The only observable delta is one toolbar button disappearing.
- If a future consumer of `KBArticleList` wants its own inline create button, it can pass `onCreateNew` and add the affordance deliberately; today there is exactly one consumer.

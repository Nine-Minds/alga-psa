# Internal notes must not claim the contact will be notified

Ticket: alga0002120
Branch: `fix/internal-note-adjacent-text`

## Problem

In the bento ticket view, the Timeline tile's composer shows a heading directly above the
editor that reads "Reply to Andrew" (the contact's first name). The heading renders
unconditionally, so it stays in place when the agent switches the lane toggle to **Internal**
— telling them they are addressing the contact while they write a note the contact will never
receive. The Resolution lane has the same heading, where it is redundant with the close-status
and notification-suppression controls the lane already reveals.

Only the text is wrong. `composerLane` already drives `isInternal` on send, so internal notes
have always been *saved* correctly and no contact has ever been notified about one. This is a
UI-copy defect, not a notification defect.

## Change

Single component: `packages/tickets/src/components/ticket/bento/BentoTimelineTile.tsx`, the
`composer` block (currently lines 665–675).

Make the heading a function of `composerLane`:

- **Client lane** — unchanged. Renders `bento.timeline.replyTo` ("Reply to {{name}}") when
  `contactFirstName` is present, and falls back to `bento.timeline.writeReply` ("Write a
  reply") when the ticket has no contact.
- **Internal lane** — render no heading at all.
- **Resolution lane** — render no heading at all.

The `<p>` (and its `mb-1.5`) is omitted rather than blanked, so the editor collapses upward in
the two lanes that have no heading. The lane toggle sits immediately below the editor and is
always visible, so the composer's mode stays legible without the heading; the Resolution lane
additionally surfaces its own close-status selector and "Don't notify the customer" controls,
which state the notification consequences more precisely than a heading could.

No behavior changes, no new copy, and therefore no new i18n keys — `bento.timeline.replyTo`
and `bento.timeline.writeReply` keep their current meaning and remain in use in the client
lane, so the ten locale files under `server/public/locales/*/features/tickets.json` are
untouched.

## Test

Add `packages/tickets/src/components/ticket/bento/BentoTimelineTile.composerHeading.test.tsx`,
following the conventions already used in that directory (`BentoHero.unsavedChanges.test.tsx`,
`TicketActivityTimeline.silentAnnotation.test.tsx`): `/* @vitest-environment jsdom */`,
Testing Library, and `vi.mock` for `@alga-psa/ui/lib/i18n/client` so `t` returns its fallback
string.

Render `BentoTimelineTile` with `contactFirstName="Andrew"` and assert:

1. On first render (client lane is the default), the heading "Reply to Andrew" is present.
2. After clicking the **Internal** lane button (`#<id>-composer-lane-internal`), the heading is
   gone.
3. After clicking the **Resolution** lane button (`#<id>-composer-lane-resolution`), the
   heading is gone.
4. Returning to the **Client** lane brings the heading back.

A fifth case covers the no-contact ticket: with `contactFirstName` null or absent, the client
lane shows "Write a reply" and the other two lanes still show nothing.

Mock the tile's data dependencies (timeline entries, reactions, `TextEditor`) as the
neighbouring bento tests do, so the test exercises the composer chrome without booting the
editor.

## Verification

Run the tickets package unit tests, then confirm in the running dev stack (port 3919): open a
ticket with a contact in the bento view, click **Internal** in the composer, and see the "Reply
to <contact>" line disappear; click back to **Client** and see it return.

## Out of scope

- The internal-note save path, the ticket email/notification subscribers, and the
  notification-suppression controls — all correct today.
- `InlineReplyComposer` (threaded replies, both bento and classic views) — it has no
  person-named heading and inherits its parent comment's internal flag.
- The classic `TicketConversation` composer — it uses lane tabs, with no copy addressing the
  contact by name.

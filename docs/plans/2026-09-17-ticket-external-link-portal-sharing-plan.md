# Selected external links in the client portal

Ticket links are private unless an internal user with `ticket:update` explicitly shares them through the external-link dialog or dedicated link API. Origin, Mirror, and Reference remain independent of visibility. Comment links cannot be shared.

`external_entity_links.portal_visible` is a non-null boolean defaulting to false. The migration leaves existing rows private. An omitted update preserves visibility. Inline ticket/comment creation and import persistence always create private links; sharing requires a separate explicit operation. Existing clone paths do not copy external links.

The portal receives `portalExternalLinks: Array<{ label: string; url: string }>` only after its existing tenant, client, board, and contact ticket scope succeeds. Labels combine the readable system name and external record ID; no relationship control or additional customer label is needed for this slice. URLs use the existing safe resolver. Private rows and comment links are excluded in SQL. Internal actors, metadata, realms, and synchronization fields never enter this DTO.

The read-only section is absent when empty. Links open in a new tab with `noopener noreferrer`. Both portals explain that sharing does not grant access to the destination. MSP rows show visibility, and visibility transitions record old/new values, actor, and time in the existing internal-only ticket audit timeline.

Ordinary edits and sharing changes emit only the existing dedicated link events. No standard email, in-app, or ticket-webhook subscriber is added. Inline creation retains the parent feature's normal ticket-creation behavior.

Portal details and server bootstrap share `getClientTicketDetails`. Its database reads are uncached across requests; the page's React `cache` only deduplicates within a request. Reloading fetches current destinations and removes unshared/deleted links. An already-open page has no live revocation guarantee, and a previously seen URL cannot be recalled.

Validation covers defaults and explicit sharing for all relationships, omission-preserving updates, comment rejection, minimal responses, ticket/client/tenant isolation, unauthorized mutations, visibility audit, silent events, and reload persistence. Human review starts with an MSP ticket containing private and shared links, then the permitted customer's ticket and actual response; repeat with a customer lacking access and with no shared links.

Design provenance: the branch contained only the parent foundation plan. The Design Session artifact's recorded Mac path was unavailable during implementation, so this plan records the supplied task and durable dossier decisions rather than claiming to reproduce the missing packet.

## API usage

The dedicated `POST /api/v1/tickets/{id}/external-links` and `PATCH /api/v1/tickets/{id}/external-links/{linkId}` accept `portal_visible: true` or `false`. Creates without the field are private; patches without it preserve the stored value. Null, string, and numeric visibility values fail validation. Inline `external_links` on ticket/comment creation reject a visibility field and stay private. Comment sharing also fails persistence validation and a database CHECK constraint.

## Verification, 2026-09-17

- 110 tests passed across 13 focused suites (109 in the combined run, followed by the added migration test in a passing 25-test integration rerun): link persistence/API contracts, portal response isolation and client/board/contact/tenant scope, MSP controls, safe read-only portal rendering, and visibility audit presentation.
- The full server TypeScript check passed with `NODE_OPTIONS=--max-old-space-size=16384 npx tsc --noEmit --project tsconfig.json --incremental --tsBuildInfoFile /tmp/share-portal-typecheck.tsbuildinfo`. The default Node heap was insufficient.
- `npx tsup` in `packages/types` passed. Both real MSP and portal ticket routes compiled and returned successfully in the running dev server. A full production Next.js build was not run.
- The migration ran on PostgreSQL in the isolated integration database and the dev database. Citus compatibility follows the existing tenant distribution and uses only defaulted column DDL plus a row-local CHECK; no distributed-cluster execution was performed.
- A headed browser on port 3688 exercised manual private creation, share, URL edit, unshare, and removal through MSP dialogs. A permitted customer's actual HTML/RSC response contained the shared destination but no private destination, actor, metadata, or internal link IDs. Another customer's response denied the ticket and contained neither shared label nor destination.
- Reloading removed an unshared/deleted URL from the response and hid the empty section. Opening `https://github.com/settings/profile` in a new tab redirected to GitHub's login page, with `window.opener === null`.
- Light and dark views were inspected. A narrow MSP row layout was corrected so the label and visibility remain readable; all 17 affected UI/contract tests passed again. The seeded review ticket is left with one private and one shared link; demo account credentials and session state remain outside version control in the locations recorded on the workflow card.

Review the [MSP visibility rows](2026-09-17-ticket-external-link-sharing-evidence/msp-link-visibility.png), [sharing dialog](2026-09-17-ticket-external-link-sharing-evidence/msp-sharing-dialog.png), and [customer section](2026-09-17-ticket-external-link-sharing-evidence/portal-shared-link.png). Compare the [dark MSP dialog](2026-09-17-ticket-external-link-sharing-evidence/msp-sharing-dialog-dark.png) and [dark customer section](2026-09-17-ticket-external-link-sharing-evidence/portal-shared-link-dark.png). Repeat the journey with the seeded accounts and inspect the response body, not just the DOM. No live push revocation is promised.

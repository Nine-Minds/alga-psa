# alga0002208 CE upgrade prompt evidence

Validated on 2026-08-02 against the live Community Edition development server from this worktree at `http://localhost:3519`.

## Live-product results

| Surface | Hydrated browser evidence | Result |
| --- | --- | --- |
| Microsoft Teams tab | Opened `/teams/tab`; `#upgrade-teams-integration-button` was visible; the page contained “Microsoft Teams integration” and “Bring ticket context and technician workflows into Microsoft Teams.” | Pass |
| License purchase | Opened `/msp/licenses/purchase`; the route remained in-product instead of redirecting; `#upgrade-license-purchase-button` was visible; “Purchase Licenses,” the hosted-deployment pitch, and the CE unlimited-users context were present. | Pass |
| Extension runtime | Opened `/msp/extensions/smoke-extension-2208`; `#upgrade-extension-runtime-button` was visible; the specific “Install, configure, and manage extensions…” pitch and requested extension ID were present. | Pass |
| Email provider gate | Opened Settings → Email and clicked `#add-provider-btn`; the hydrated route resolved to `/msp/settings/email`; Gmail and IMAP setup buttons were visible; the Microsoft setup button was absent; `#upgrade-microsoft-email-provider-button` was visible. | Pass |
| Shared CTA | Every prompt above resolved to `https://www.nineminds.com/documentation/community-vs-enterprise-edition`, opened in a new tab with `noopener noreferrer`, and the destination returned HTTP 200 during verification. | Pass |

## Fidelity and disclosures

- This was a live Next.js development build using the running `alga-psa-local-test` PostgreSQL, PgBouncer, and Redis services. The tested prompt components and routes were not mocked.
- Browser assertions were read from the hydrated DOM through the Alga Dev browser controller, including visibility, copy, element IDs, link destination, and link target.
- No feature simulator or API mock was used. `smoke-extension-2208` is a synthetic route parameter used only to prove that the CE extension boundary preserves the requested extension context.
- The expired browser session required a temporary local-only Glinda password hash for authenticated checks. The exact original hash was preserved out of band, restored immediately after the smoke run, and restoration was verified against the same tenant row.
- Automated screenshot capture timed out in the cross-host browser controller. No image is presented as evidence; the results above are DOM-level live-product readbacks rather than screenshot claims.

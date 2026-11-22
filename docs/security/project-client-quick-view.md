# Projects client quick view

On **Projects**, click a visible client name to open the existing client details quick view. A reader with client update permission can save client edits and manage locations. A reader with ticket create permission can open **Add ticket**, select a board, and create a ticket for that client.

The server checks client read permission and record access before returning details. When the drawer opens from a project, it also checks access to that project and the visibility of its client name. It masks protected fields before returning data. Location reads, client saves, and location commands repeat these checks. Saves preserve protected stored values and return masked data. The ticket form uses the same client record decisions and location field masks.

The drawer receives capabilities from the server. Read-only users can inspect permitted details; client editing, **Manage Locations**, **Add ticket**, and deletion are gated separately. Client and location write actions enforce permissions even when invoked directly. Ticket creation retains its server-side ticket authorization.

## Walkthrough

Use the isolated `QuickView3048` fixtures created by `server/src/test/e2e/projects-client-quick-view.playwright.test.ts`. They leave existing users and roles unchanged. Run the suite only against an owned development tenant with normal reference data. It creates four accounts, two clients and projects, a location, and a ticket board. Fixture IDs use prefix `61713048-0000-4000-8000-`; subsequent runs reset only these fixtures. Created tickets remain available as persistence evidence.

1. Sign in as **quickview3048-authorized@example.test** and open `/msp/projects?searchQuery=QuickView3048`. Click the allowed project's client name. The drawer contains the existing detail form, **Save**, **Manage Locations**, and **Add ticket**. Change the client name and save. Close and reopen the drawer to check persistence.
2. Open **Manage Locations**, edit **QuickView3048 HQ**, change its name, and choose **Save Location**. Reopen the location to confirm the saved value. Close **Manage Locations** using its close button.
3. Choose **Add ticket**. Enter a title, select **QuickView3048 Support**, and choose **Create**. The ticket must persist for the chosen client. The test verifies the database row rather than relying on the toast.
4. Sign in as **quickview3048-readonly@example.test**. Open the same client. The detail form remains available with mutation controls disabled. Direct client, location, and ticket write requests must also be denied. No stored values change.
5. Sign in as **quickview3048-redacted@example.test**. The same full drawer remains usable, but client notes, tax data, billing email, location email, and address data are protected. Open **Manage Locations** and edit the location name. Protected address inputs are empty and disabled. Save and reopen: the visible edit persists, while protected values remain stored and absent from responses. Open **Add ticket** too; its client and location responses must not restore protected data.
6. Sign in as **quickview3048-noclient@example.test**. The project list remains available, but client names have no quick-view links. Direct detail requests are denied and the project client picker returns an empty list.

The browser suite captures HTML, RSC/action, and JSON response bodies throughout the redacted journey and checks the seeded protected values never appear. It also checks initial project loading and by-ID hydration: excluded projects are absent, and description and budget fields remain masked. Client picker responses contain only permitted picker fields.

## Running the regression

Configure `BASE_URL` to the application's canonical origin, `PORT` to its listener port, and `NEXTAUTH_SECRET` to the signing secret used by the running app. Supply the normal `DB_*` connection settings and `PROJECT_SECURITY_TENANT` for an owned development tenant. The existing Playwright session helper creates real signed sessions and database session rows; no product actions, policy decisions, or UI controls are mocked.

From `server/`:

```sh
PROJECT_SECURITY_TENANT=<owned-tenant-uuid> \
PLAYWRIGHT_SKIP_WEB_SERVER=true \
npx playwright test src/test/e2e/projects-client-quick-view.playwright.test.ts
```

Set `PROJECT_SECURITY_EVIDENCE_DIR` to save screenshots and the response audit. `PROJECT_SECURITY_MANIFEST` can select the running Next server's action manifest when its build directory differs from `.next-dev`. The suite resolves exported action IDs from that runtime registry to verify direct-request denial as well as UI gating.

This replaces the reduced name/type/status summary with the existing operational client quick view. Restricted readers retain permitted details and edits; redactions are enforced at response boundaries.

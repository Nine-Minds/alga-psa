# AlgaPSA Mobile 2.0 release notes

- Status: Draft — finalize after device smoke tests
- Target version: `2.0.0` (iOS build 39, Android versionCode 39)

## Store copy

AlgaPSA Mobile 2.0 opens on your day and makes projects and devices
first-class instead of side doors.

- A new Home screen: the timer still running, today's schedule, the open
  tickets assigned to you, activities due today or overdue, and one-tap
  actions for a new ticket, a scan, an interaction note or a timer.
- Projects: browse active projects, open one to see its phases with task
  counts and progress, add a task, and change a task's assignee, due date
  and priority from the phone.
- Devices: browse a client's assets by location, status and type, search by
  tag or serial, and open any device.
- Site audits: pick a client and location, walk the site scanning labels, and
  finish with a present / missing / unexpected summary. Each device's web
  history records the audit, and every missing device offers a one-tap ticket.
- Global search across tickets, clients, contacts, devices, projects and
  project tasks, with recent searches on the device.

## What the server needs

- The site audit requires the `asset_audits` / `asset_audit_items` migration
  and the `/api/v1/asset-audits` routes shipped with this release. Against an
  older server the Audit action is hidden (its capability is false) and the
  Devices tab still works.
- Projects and Devices appear only for PSA tenants whose user has
  `project:read` and `asset:read`; the Audit action also needs `asset:update`.

## Release validation

- [ ] Home cards, Projects, Devices, audit end-to-end (with a camera) and
  search smoke tests pass on iOS and Android.
- [ ] Deep links: `alga://project/<id>`, `alga://asset/<id>`, the hosted
  `/msp/projects/{id}` and `/msp/assets/{id}` pages, and push payloads
  carrying `projectId` or `assetId`.
- [x] Mobile lint, typecheck and the vitest suite pass.
- [x] Server audit service, route, OpenAPI and product-registry contract
  tests pass.
- [x] OpenAPI CE/EE specs, the MCP/chat registries and the route inventory
  regenerated and committed.
- [ ] Spec copy synced to nm-store via the `alga-openapi-sync` skill.
- [ ] TestFlight and Play Internal builds accepted by their stores.
- [ ] Accessibility, small-screen, dark-mode, offline and error-state checks
  for Home, Projects, Devices, the audit flow and Search.

## Store screenshots to refresh

1. Home with a running timer, today's visits and assigned tickets.
2. A project showing phases with "n of m done" and progress bars.
3. The Devices list filtered to one client location.
4. An audit session mid-walk, and the summary with a missing device.
5. Search results grouped by type.

Use real device dimensions for each store target and sample/demo tenant data
only. Do not capture customer names, ticket content, contact information, or
service credentials.

## Known issues

- Groups, assignments, status and procurement fields stay read-only on mobile.
- Projects and phases are still created on the web; mobile creates tasks only.
- An audit needs a connection: scans and marks are recorded server-side, and
  the session tells you when it cannot reach the server.
- The offline write queue (comments, time entries, interaction notes composed
  without signal) is deferred to a follow-up release.

## Customer follow-up

ECTS ticket `alga-2026-0002627` asked for the site audit on 2026-10-01 and
for create/edit parity on 2026-10-09. Reply once build 39 is on TestFlight.

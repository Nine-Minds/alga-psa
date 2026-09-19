# Notification template sources

Every system email and internal notification template is defined here, never
inline in a migration. Migrations only `require` a module and call
`upsertEmailTemplates` / `upsertInternalTemplates`.

Rules:

- A template ships copy for every locale in `_shared/constants.cjs`
  (`SUPPORTED_LANGUAGES`), which mirrors `packages/email/src/lib/localeConfig.ts`.
  `src/test/unit/migrations/templateLocaleParity.test.ts` fails otherwise.
- Editing copy in a module changes nothing in a deployed database on its own —
  always ship a migration that re-upserts the affected templates.
- Never merge a migration meant to be "parked" for later: merged means it runs
  on the next deploy.

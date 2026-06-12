# Standard invoice Letter margins design

## Goal
Update all bundled standard invoice templates shipped with the application so they use Letter print settings with 10.58mm margins.

## Scope
- Bundled standard invoice templates only:
  - `standard-default`
  - `standard-detailed`
  - `standard-grouped`
- Do not modify tenant-customized invoice templates.

## Approach
1. Update the TypeScript standard invoice AST source definitions to include `printSettings` metadata.
2. Add a migration that backfills the bundled rows in `standard_invoice_templates` so existing installs receive the same settings.
3. Extend regression coverage so all shipped standard invoice templates are included and their metadata round-trips through the designer pipeline.

## Print settings
- `paperPreset: 'Letter'`
- `marginMm: 10.58`

## Validation
- Run targeted invoice template regression tests.
- Verify bundled standard invoice template metadata includes the expected `printSettings`.

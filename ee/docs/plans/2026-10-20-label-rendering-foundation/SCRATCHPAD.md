# Scratchpad
- Analysis docs from origin/feature/physical-work-tags in ee/docs/plans/2026-10-20-physical-work-tags/.
- Rebuild types after editing: `cd packages/types && npx tsup`. Use NODE_OPTIONS=--max-old-space-size=12000 for tsc.
- Billing vitest has an explicit include list; add new test paths. Under heavy machine load use `--maxWorkers=4` (flaky timeouts otherwise).
- Mobile vitest cannot resolve expo here; run with a minimal config (`esbuild.tsconfigRaw '{}'`).
- Strict AST style schema: string-valued margin/flex/minWidth; no overflow/textTransform/letterSpacing.
- Label bindings contain clientName/tenantName, so documentKind checks work-tag (recordUrl+identifier) before quote.
- Pre-existing `qrcode` uses (MFA authenticator, MobileAppCard) are unrelated to the barcode node.

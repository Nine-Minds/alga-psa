# Scratchpad

- Existing investigation found production field labels render as plain spans in `packages/billing/src/lib/invoice-template-ast/react-renderer.tsx`.
- Designer canvas had preview-only `metadata.labelFontWeight`/`metadata.fontWeight` behavior for field labels.
- Scope confirmed: full label style controls, consistently for field labels and totals labels.
- Implemented `labelStyle?: TemplateNodeStyleRef` on `TemplateFieldNode` and `TemplateTotalsRow`.
- Designer field/subtotal/tax/discount/custom-total inspectors now expose label style controls under `metadata.labelStyle.inline.*`.
- Renderer applies label style only to label spans, leaving values/container styling independent.
- While validating round-trip tests, fixed export logic to avoid re-emitting imported default field `borderStyle: 'none'` when the original AST did not have a `borderStyle` property.
- Targeted package typecheck passed via `npm -w packages/billing run typecheck`.
- Targeted vitest run passed for schema, renderer, and workspace AST roundtrip. Full component schema suite still has an existing unrelated reciprocal hierarchy failure (`page` vs `field` allowedParents) when run without a test-name filter.

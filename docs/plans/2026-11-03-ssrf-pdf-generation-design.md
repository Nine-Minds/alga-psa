# Design Session — Security: ssrf in PDFGenerationService.generatePDFBuffer

## Asked
Design the fix for the security finding at the altitude Link Spec → implementation needs.

## Finding (confirmed on main)

`packages/billing/src/services/pdfGenerationService.ts:1206-1214` renders stored markdown through `marked` unsanitized and `:1273-1283` loads it in a network-enabled browser and prints it, so a document editor can store `<iframe src=...>`/`<img>` and make the server fetch internal resources.

## Approach

1. Sanitize rendered HTML with an allowlist before `page.setContent` (strip script/iframe/object/embed/link and event handlers; restrict img and CSS url() to data:).
2. Belt and braces: request interception aborting every non-allowlisted origin, so a sanitizer miss cannot reach the network.
3. Reuse the isolated-render helper the merged PR added for the other active-content path.
4. Tests: iframe/img to a private host produces no outbound request and no internal content; normal markdown unchanged.

## Files in scope

pdfGenerationService.ts, the shared sanitizer/allowlist helper, and PDF generation tests.

## Hand-off
Materialize this design as a file in the card worktree at the Link Spec step and record its repo-relative path in `state.psaSpecPaths`; never report `skipped-no-spec`.
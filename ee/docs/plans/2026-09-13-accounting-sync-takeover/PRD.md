# Accounting sync completion

This focused repair follows the primary specification in `docs/plans/2026-09-13-shared-accounting-sync-xero-two-way-plan.md`. The branch remains stacked on Co-Managed IT at `0af97e5c61`; its accounting capabilities and tenant-scoped data access remain authoritative. The original Design Session supplied a board fact, not a committed approved plan.

Users must see and run the provider selected in Accounting Integrations even when both providers are connected. Provider-scoped health must honor the selected default organisation, reject unavailable explicit targets, and display failed, aborted, or incomplete cycles truthfully. The server composition must supply separate provider-scoped health slots without introducing an integrations-to-billing dependency.

Xero must finish pagination before advancing the pre-poll watermark. Remove the fixed page ceiling that causes permanent replay starvation; detect repeated pages as a failed poll, preserving the cursor. Timestamp ties and missing update timestamps cannot control page progress. Existing QBO truncation remains fail-safe and visible.

Acceptance: behavioral settings/action tests verify provider selection, second-organisation persistence, unavailable targets and failed-cycle feedback; pagination tests exceed the former cap and recover after failure; existing HTTP-boundary, QBO, and DB reconciliation suites pass; affected packages typecheck. Outbound Xero payment/credit/void remain explicitly gated. No price sync, mapping-search UI, push, or PR is included.

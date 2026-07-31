# Scratchpad — Hudu Phase 2.1

- 2026-06-12: scope = all three integration items per Natallia; custom asset types split into its own Alga-core plan.
- Live assets columns: attributes jsonb (NinjaOne precedent), rmm_provider/rmm_device_id/agent_status/last_seen_at, notes_document_id (NOT used — link-only philosophy), asset_type text + client_id (schema evolved past 2024 migration).
- Hudu fields[] live shape: {id, label, value, position}.
- RMM ownership check = assets.rmm_provider IS NOT NULL.
- Groups share files (import/sync actions) -> implement SEQUENTIALLY, commit after each group.

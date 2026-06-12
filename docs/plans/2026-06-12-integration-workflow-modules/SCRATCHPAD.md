# Scratchpad — Integration Workflow Modules

Working notes for the implementation. Design authority:
`../2026-06-12-integration-workflow-modules-design.md`. PRD + feature/test
tracking live alongside this file.

## Verify-during-implementation list (from design)

- NinjaOne scripting-options discovery endpoint exact path (expected
  `GET /v2/device/{id}/scripting/options`).
- Tactical endpoint paths: `/scripts/`, `/agents/{agent_id}/runscript/`,
  `/agents/{agent_id}/cmd/`, `/agents/{agent_id}/reboot/` (and response
  shapes — run_script output retrieval may be task/poll based).
- Huntress incident-resolve write endpoint + payload (changelog announced;
  confirm at api.huntress.io/docs).
- Level `automations.list` response includes webhook tokens, or whether the
  separate "list automation webhooks" endpoint is needed for discovery.

## Implementation order (suggested)

1. Framework (F001–F005) + parity tests — everything else stacks on it.
2. Tactical (marquee actions; mock server exists for smoke).
3. Level, Huntress (thin clients, mostly reads + one write each).
4. Teams (createConversation is the heavy item — do last among modules).
5. scheduling.create_entry + icons/polish.

## Findings

(append as discovered)

# Target CE/OSS stub placement

This describes where the **CE/OSS stub** for workflow UI should live after migration.

## CE placement (`server/src/empty/**`)

- CE stub entrypoint file (aliased in Next config):
  - `server/src/empty/workflows/entry.tsx`
    - Exports a named `DnDFlow` export (same export shape as EE).
    - Renders the CE/OSS “Enterprise Feature” stub messaging.

- CE fallback components (existing):
  - `server/src/empty/components/flow/DnDFlow.tsx` can continue to exist as a generic empty fallback, but the authoritative stub for workflows should be the entry file above.

Rationale:

- CE bundles should not include EE UI code, and should deterministically render a stub (or hidden route) without “hybrid” behavior.
- Co-locates CE stubs alongside other `server/src/empty/**` components used for OSS/CE builds.


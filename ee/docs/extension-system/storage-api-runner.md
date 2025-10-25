# Runner Host API Implementation Plan

> **Status:** Archived. Runner-mediated storage calls have been replaced by direct access to the tenant storage service.

Extensions now call the public storage endpoints using the same credentials as any other integration. Review [docs/storage-system.md](../../../docs/storage-system.md) for the supported API surface and authentication model. Remove any runner host bindings (`alga.storage.*`) that remain in WASM modules—those shims are deprecated and will be removed in a future runner release.

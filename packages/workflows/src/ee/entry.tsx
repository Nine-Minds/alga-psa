'use client';

// Legacy shim: keep the historical `packages/workflows/src/ee/entry.tsx` entrypoint stable during the
// migration window while the canonical EE Workflow UI moves under `ee/server/src/**`.
export { DnDFlow, default } from '../../../../ee/server/src/workflows/entry';

import type { Router } from 'express';
import type { HostEnv } from '@alga-psa/emulator-host';
import type { ThreecxEmulatorCore } from './core';

/**
 * The 3CX emulator is a client, not a server: its actions dial the AlgaPSA
 * routes. The vendor surface is just a health endpoint so the host has a port
 * to bind and a liveness probe to hit.
 */
export function wire(router: Router, core: ThreecxEmulatorCore, _env: HostEnv): void {
  router.get('/', (_req, res) => {
    res.json({ ok: true, emulator: 'threecx', exchanges: core.exchanges.length });
  });
}

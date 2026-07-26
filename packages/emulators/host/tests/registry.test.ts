import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ControlError, EmulatorControls } from '../src/registry';

function controls(): EmulatorControls {
  const reg = new EmulatorControls();
  let tokenValid = true;
  reg.action({
    name: 'expire-token',
    description: 'Expire the token',
    run: () => {
      tokenValid = false;
      return { tokenValid };
    },
  });
  reg.fault({
    name: 'flaky',
    description: 'Fail some requests',
    params: z.object({ rate: z.number().min(0).max(1) }),
    arm: () => undefined,
    disarm: () => undefined,
  });
  reg.stateView({ name: 'token', description: 'Token validity', get: () => ({ tokenValid }) });
  return reg;
}

describe('EmulatorControls', () => {
  it('rejects duplicate registrations', () => {
    const reg = controls();
    expect(() => reg.action({ name: 'expire-token', description: 'dup', run: () => null })).toThrow(/Duplicate action/);
  });

  it('runs actions and reflects results in state views', async () => {
    const reg = controls();
    expect(reg.readState('token')).toEqual({ tokenValid: true });
    await reg.runAction('expire-token', undefined);
    expect(reg.readState('token')).toEqual({ tokenValid: false });
  });

  it('404s unknown names', async () => {
    const reg = controls();
    await expect(reg.runAction('nope', {})).rejects.toMatchObject({ status: 404 });
    expect(() => reg.readState('nope')).toThrow(ControlError);
  });

  it('validates fault params against the schema', async () => {
    const reg = controls();
    await expect(reg.armFault('flaky', { rate: 2 })).rejects.toMatchObject({ status: 400 });
    await reg.armFault('flaky', { rate: 0.5 });
    expect(reg.armedFaults()).toEqual([{ name: 'flaky', params: { rate: 0.5 } }]);
    await reg.disarmFault('flaky');
    expect(reg.armedFaults()).toEqual([]);
  });

  it('publishes a catalog with JSON schemas and armed flags', async () => {
    const reg = controls();
    await reg.armFault('flaky', { rate: 1 });
    const catalog = reg.catalog();
    expect(catalog.actions.map((a) => a.name)).toEqual(['expire-token']);
    expect(catalog.faults).toHaveLength(1);
    expect(catalog.faults[0]).toMatchObject({ name: 'flaky', armed: true });
    expect(catalog.faults[0].paramsSchema).toMatchObject({ type: 'object' });
    expect(catalog.stateViews).toEqual([{ name: 'token', description: 'Token validity' }]);
  });
});

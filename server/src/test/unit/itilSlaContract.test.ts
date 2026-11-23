/**
 * T214, T220, T227 (and the wiring of T213–T226) — F122–F129 of
 * `ee/plans/2026-11-21-itil-remediation` (`sla`).
 *
 * The SLA hooks are registered at startup and held where every bundle can see them; the ITIL
 * policy is found by its flag and its numbers come from one shared definition; the stage events
 * are built from the ticket's own SLA. The behaviour is in
 * `src/test/integration/itilSlaPolicy.integration.test.ts` and
 * `shared/services/tickets/__tests__/ticketSlaStageEvents.test.ts`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
}

describe('ITIL SLA wiring', () => {
  it('T214: two independently bundled copies of the hooks module share one registry', async () => {
    // The question this settles: a production build does NOT share a module instance between
    // startup code and a server action (the repo says so at
    // `packages/auth/src/lib/emailRegistry.ts`). Bundling the module twice, as Next does, is the
    // artefact-level form of that question — and the hooks survive it because they live on
    // `globalThis` under a `Symbol.for` key rather than in a module variable.
    const esbuild = await import('esbuild');
    const entry = path.resolve(REPO_ROOT, 'packages/tickets/src/lib/slaIntegrationHooks.ts');
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-sla-hooks-'));

    try {
      const bundles: string[] = [];
      for (const name of ['startup', 'serverAction']) {
        const outfile = path.join(outDir, `${name}.mjs`);
        await esbuild.build({
          entryPoints: [entry],
          outfile,
          bundle: true,
          format: 'esm',
          platform: 'node',
          logLevel: 'silent',
        });
        bundles.push(outfile);
      }

      const startup = await import(bundles[0]);
      const serverAction = await import(bundles[1]);
      expect(startup).not.toBe(serverAction);

      startup.clearSlaIntegrationHooksForTest();
      expect(serverAction.areSlaIntegrationHooksRegistered()).toBe(false);

      const configure = async () => ({ created: true });
      const cancel = async () => undefined;
      // Registered by the "startup" bundle, read by the "server action" bundle.
      startup.registerItilSlaConfigurationHook(configure);
      startup.registerSlaCancellationHook(cancel);

      expect(serverAction.getItilSlaConfigurationHook()).toBe(configure);
      expect(serverAction.getSlaCancellationHook()).toBe(cancel);
      expect(serverAction.areSlaIntegrationHooksRegistered()).toBe(true);
      expect(serverAction.assertSlaIntegrationRegistered('test')).toBe(true);

      startup.clearSlaIntegrationHooksForTest();
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('T213, T227: the integration is registered at startup, not from an MSP layout', () => {
    const init = source('server/src/lib/initializeApp.ts');
    expect(init).toContain("await import(\n        '@alga-psa/msp-composition/tickets/registerSlaIntegration'\n      )");
    expect(init).toContain('registerSlaIntegration();');
    expect(init).toContain("assertSlaIntegrationRegistered('server/initializeApp')");

    const layout = source('server/src/app/msp/_components/WorkspaceRouteLayout.tsx');
    expect(layout).not.toContain('registerSlaIntegration');

    // Neither hook is a module variable any more: both go through the globalThis store, so a
    // server action reaches what startup registered — including the cancellation a close needs.
    const actions = source('packages/tickets/src/actions/ticketActions.ts');
    expect(actions).toContain("import { getSlaCancellationHook, registerSlaCancellationHook } from '../lib/slaIntegrationHooks'");
    expect(actions).not.toContain('let _cancelSlaFn');
    expect((actions.match(/const cancelSla = getSlaCancellationHook\(\);/g) ?? []).length).toBe(2);

    const itilService = source('packages/tickets/src/services/itilStandardsService.ts');
    expect(itilService).not.toContain('let _configureItilSlaForBoardFn');
    expect(itilService).toContain('const configureItilSlaForBoard = getItilSlaConfigurationHook();');
  });

  it('T215: ITIL setup refuses to skip the SLA on a PSA tenant', () => {
    const itilService = source('packages/tickets/src/services/itilStandardsService.ts');
    const setup = itilService.slice(itilService.indexOf('static async handleItilConfiguration('));
    expect(setup).toContain("if (productCode === 'algadesk')");
    expect(setup).toContain('} else if (!configureItilSlaForBoard) {');
    expect(setup).toContain('registerSlaIntegration() at startup');
  });

  it('T216: the migration flags the ITIL policy and allows at most one per tenant', () => {
    const migration = source('server/migrations/20261123090000_flag_itil_standard_sla_policy.cjs');
    expect(migration).toContain("require('./utils/tenantDb.cjs')");
    expect(migration).toContain("table.boolean('is_itil_standard')");
    expect(migration).toContain("where({ policy_name: ITIL_POLICY_NAME })");
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS');
    expect(migration).toContain('ON sla_policies (tenant)');
    expect(migration).toContain('WHERE is_itil_standard = true');
    // D1: no migration assigns, creates or removes a policy.
    expect(migration).not.toContain('boards');
    expect(migration).not.toContain('.insert(');
    expect(migration).not.toContain('.del(');
  });

  it('T217, T218: both writers find the policy by its flag', () => {
    const service = source('packages/sla/src/services/itilSlaService.ts');
    expect(service).toContain("where({ is_itil_standard: true })");
    expect(service).not.toContain("where({ policy_name: ITIL_SLA_POLICY_NAME })");

    const parity = source('ee/temporal-workflows/src/db/product-upgrade-operations.ts');
    expect(parity).toContain('.where({ tenant: tenantId, is_itil_standard: true })');
    expect(parity).not.toContain('policy_name: ITIL_POLICY_NAME');

    // And the ITIL cleanup only retires the policy this product created.
    const itilService = source('packages/tickets/src/services/itilStandardsService.ts');
    expect(itilService).toContain('.where({ sla_policy_id: policyId, is_itil_standard: true })');
  });

  it('T220: both writers take their targets and thresholds from one definition', () => {
    const shared = 'shared/lib/sla/itilSlaDefaults.ts';
    const defaults = source(shared);
    expect(defaults).toContain('export const ITIL_SLA_TARGETS');
    expect(defaults).toContain('export const ITIL_SLA_NOTIFICATION_THRESHOLDS');
    expect(defaults).toContain('export const ITIL_SLA_ESCALATION_PERCENTS');

    for (const file of [
      'packages/sla/src/services/itilSlaService.ts',
      'ee/temporal-workflows/src/db/product-upgrade-operations.ts',
    ]) {
      const text = source(file);
      expect(text, `${file} must import the shared ITIL SLA defaults`).toContain(
        "from '@alga-psa/shared/lib/sla/itilSlaDefaults'"
      );
      // No second copy of the numbers.
      expect(text).not.toMatch(/responseTimeMinutes:\s*15/);
      expect(text).not.toMatch(/response:\s*15/);
      expect(text).not.toContain('escalation_1_percent: 70');
    }
  });

  it('T219: an existing policy is topped up, never rewritten', () => {
    const service = source('packages/sla/src/services/itilSlaService.ts');
    expect(service).toContain('export async function topUpItilSlaTargets(');
    const topUp = service.slice(service.indexOf('export async function topUpItilSlaTargets('));
    expect(topUp).toContain('const covered = new Set(existing.map(target => target.priority_id));');
    expect(topUp).toContain('if (covered.has(priority.priority_id)) continue;');
    // It inserts only; it never updates an existing target.
    expect(topUp.slice(0, topUp.indexOf('\n}\n'))).not.toContain('.update(');
  });

  it('T221: nothing but a board create assigns the ITIL policy', () => {
    const core = source('packages/tickets/src/services/boardLifecycle.ts');
    // The create runs ITIL setup (which assigns); the update and the switch do not.
    const create = core.slice(core.indexOf('export async function createBoardCore('), core.indexOf('export async function updateBoardCore('));
    expect(create).toContain('ItilStandardsService.handleItilConfiguration(');
    const rest = core.slice(core.indexOf('export async function updateBoardCore('));
    expect(rest).not.toContain('handleItilConfiguration');
    expect(rest).not.toContain('configureItilSlaForBoard');
  });

  it('T223–T225: the stage events read the ticket’s SLA, and the hard-coded hours are gone', () => {
    const events = source('shared/services/tickets/ticketSlaStageEvents.ts');
    expect(events).toContain('export interface TicketSlaFields');
    expect(events).toContain('if (!enteredAtIso || !targetAt || !args.slaPolicyId) return null;');
    expect(events).not.toContain('getSlaTarget');
    expect(events).not.toContain('addHoursToIso');
    expect(fs.existsSync(path.resolve(REPO_ROOT, 'shared/lib/itil/slaTargets.ts'))).toBe(false);

    // The entered event is published where the SLA starts, with the policy and due time stamped there.
    const subscriber = source('server/src/lib/eventBus/subscribers/slaSubscriber.ts');
    expect(subscriber).toContain('buildTicketResolutionSlaStageEnteredEvent({');
    expect(subscriber).toContain('slaPolicyId: startResult.sla_policy_id');
    expect(subscriber).toContain('slaResolutionDueAt: startResult.sla_resolution_due_at');

    // And the close paths compare the close time with the ticket's own due time.
    for (const file of [
      'packages/tickets/src/actions/ticketActions.ts',
      'packages/tickets/src/actions/optimizedTicketActions.ts',
      'packages/tickets/src/actions/ticketBundleUtils.ts',
    ]) {
      expect(source(file), `${file} completion event`).toMatch(/slaResolutionDueAt:/);
      expect(source(file), `${file} must not guess from a level`).not.toContain('itilPriorityLevel:');
    }
  });
});

import { describe, expect, it } from 'vitest';
import { evaluateAlertRules } from '@alga-psa/shared/rmm/alerts/ruleEvaluator';
import { persistRmmAlertMetadata, readPersistedRmmAlertDetails } from '@alga-psa/shared/rmm/alerts/metadata';
import type { RmmAlertRuleRow } from '@alga-psa/shared/rmm/alerts/contracts';
import { mapTacticalAlertToEvent } from './alertFetcher';

describe('Tactical alert detail arrival and replay parity', () => {
  it('preserves description even when message duplicates it and restores rule evaluation after persistence', () => {
    const arrived = mapTacticalAlertToEvent({
      id: 'alert-1', agent_id: 7, message: 'Sentinel service stopped', description: 'Sentinel service stopped',
    }, 'tenant', 'integration')!;
    expect(arrived.details).toBe('Sentinel service stopped');

    const metadata = JSON.parse(JSON.stringify(persistRmmAlertMetadata(arrived)));
    expect(metadata).toMatchObject({
      id: 'alert-1',
      message: 'Sentinel service stopped',
      description: 'Sentinel service stopped',
      _algaNormalized: { details: 'Sentinel service stopped' },
    });
    const replayed = { ...arrived, details: readPersistedRmmAlertDetails(metadata) };
    const rule: RmmAlertRuleRow = {
      tenant: 'tenant', rule_id: 'rule', integration_id: 'integration', name: 'details only',
      is_active: true, priority_order: 1,
      conditions: { join: 'and', clauses: [{ path: 'details', operator: 'contains_ci', value: 'SENTINEL' }] },
      actions: { createTicket: false, autoResolveTicket: false, resetAlertOnTicketClose: true },
    };
    expect(evaluateAlertRules([rule], arrived).rule).toBe(rule);
    expect(evaluateAlertRules([rule], replayed).rule).toBe(rule);
  });
});

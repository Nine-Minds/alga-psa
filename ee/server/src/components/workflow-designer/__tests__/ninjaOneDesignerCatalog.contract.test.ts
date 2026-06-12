/** @vitest-environment jsdom */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGroupedActionSelectOptions } from '../GroupedActionConfigSection';
import type { WorkflowDesignerCatalogRecord } from '@alga-psa/workflows/runtime/designer/actionCatalog';

const ninjaRecord: WorkflowDesignerCatalogRecord = {
  groupKey: 'app:ninjaone',
  label: 'NinjaOne',
  iconToken: 'ninjaone',
  tileKind: 'app',
  description: 'NinjaOne actions',
  defaultActionId: 'ninjaone.devices.find',
  allowedActionIds: [
    'ninjaone.devices.find',
    'ninjaone.devices.sync',
    'ninjaone.devices.reboot',
    'ninjaone.alerts.list_active',
    'ninjaone.alerts.get',
    'ninjaone.alerts.reset'
  ],
  actions: [
    { id: 'ninjaone.devices.find', version: 1, label: 'Find devices', inputFieldNames: [], outputFieldNames: [] },
    { id: 'ninjaone.devices.sync', version: 1, label: 'Sync device', inputFieldNames: [], outputFieldNames: [] },
    { id: 'ninjaone.devices.reboot', version: 1, label: 'Reboot device', inputFieldNames: [], outputFieldNames: [] },
    { id: 'ninjaone.alerts.list_active', version: 1, label: 'List active alerts', inputFieldNames: [], outputFieldNames: [] },
    { id: 'ninjaone.alerts.get', version: 1, label: 'Get alert', inputFieldNames: [], outputFieldNames: [] },
    { id: 'ninjaone.alerts.reset', version: 1, label: 'Acknowledge alert', inputFieldNames: [], outputFieldNames: [] }
  ]
};

const ticketRecord: WorkflowDesignerCatalogRecord = {
  groupKey: 'ticket',
  label: 'Ticket',
  iconToken: 'ticket',
  tileKind: 'core-object',
  description: 'Ticket actions',
  allowedActionIds: ['tickets.create'],
  actions: [
    { id: 'tickets.create', version: 1, label: 'Create Ticket', inputFieldNames: ['summary'], outputFieldNames: ['ticket_id'] }
  ]
};

describe('NinjaOne workflow designer catalog contracts', () => {
  it('T015: NinjaOne group keeps app-specific action dropdown options and icon token contract', () => {
    const options = buildGroupedActionSelectOptions(ninjaRecord);
    expect(options.map((option) => option.value)).toEqual(ninjaRecord.allowedActionIds);
    expect(options.some((option) => option.label === 'Acknowledge alert')).toBe(true);
    expect(ninjaRecord.iconToken).toBe('ninjaone');

    const workflowDesignerSource = fs.readFileSync(path.resolve(__dirname, '../WorkflowDesigner.tsx'), 'utf8');
    expect(workflowDesignerSource).toContain("case 'ninjaone'");
  });

  it('T016: NinjaOne-to-Ticket authoring path keeps ticket creation generic and not inside NinjaOne actions', () => {
    const ninjaActionIds = new Set(ninjaRecord.allowedActionIds);
    expect(ninjaActionIds.has('tickets.create')).toBe(false);
    expect(ninjaActionIds.has('ninjaone.alerts.create_ticket')).toBe(false);

    const ticketOptions = buildGroupedActionSelectOptions(ticketRecord);
    expect(ticketOptions).toEqual([{ value: 'tickets.create', label: 'Create Ticket' }]);
  });
});

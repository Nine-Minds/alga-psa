import { describe, expect, it } from 'vitest';
import {
  applyGroupedActionSelectionToStep,
  buildGroupedActionStepConfig,
  getGroupedActionCatalogRecordForStep,
} from '../groupedActionStep';
import type { WorkflowDesignerCatalogRecord } from '@shared/workflow/runtime/designer/actionCatalog';

const catalog: WorkflowDesignerCatalogRecord[] = [
  {
    groupKey: 'ticket',
    label: 'Ticket',
    iconToken: 'ticket',
    tileKind: 'core-object',
    allowedActionIds: ['tickets.create'],
    defaultActionId: 'tickets.create',
    description: 'Ticket actions',
    actions: [],
  },
  {
    groupKey: 'transform',
    label: 'Transform',
    iconToken: 'transform',
    tileKind: 'transform',
    allowedActionIds: [],
    description: 'Transform actions',
    actions: [],
  },
  {
    groupKey: 'app:slack',
    label: 'Slack',
    iconToken: 'slack',
    tileKind: 'app',
    allowedActionIds: ['slack.send_message'],
    description: 'Slack actions',
    actions: [],
  },
];

describe('workflow designer grouped action step helpers', () => {
  it('T070/T071/T072: grouped action config preserves runtime action fields and additive group metadata', () => {
    expect(
      buildGroupedActionStepConfig(
        {
          actionId: 'tickets.create',
          actionVersion: 2,
          groupKey: 'ticket',
          tileKind: 'core-object',
        },
        { generateSaveAsName: () => 'createTicket' }
      )
    ).toEqual({
      actionId: 'tickets.create',
      version: 2,
      saveAs: 'createTicket',
      designerGroupKey: 'ticket',
      designerTileKind: 'core-object',
    });
  });

  it('T073: app selections preserve additive app metadata', () => {
    expect(
      buildGroupedActionStepConfig({
        actionId: 'slack.send_message',
        groupKey: 'app:slack',
        tileKind: 'app',
      })
    ).toMatchObject({
      actionId: 'slack.send_message',
      designerGroupKey: 'app:slack',
      designerTileKind: 'app',
      designerAppKey: 'app:slack',
    });
  });

  it('supports grouped steps with no selected action yet', () => {
    const step = applyGroupedActionSelectionToStep(
      { id: 'step-1', type: 'action.call', name: '', config: {} },
      { groupKey: 'transform', groupLabel: 'Transform', tileKind: 'transform' }
    );

    expect(step.type).toBe('action.call');
    expect(step.name).toBe('Transform');
    expect(step.config).toMatchObject({
      designerGroupKey: 'transform',
      designerTileKind: 'transform',
    });
    expect((step.config as Record<string, unknown>).actionId).toBeUndefined();
  });

  it('T074: legacy action.call steps infer their group from actionId during hydration', () => {
    expect(
      getGroupedActionCatalogRecordForStep(
        { type: 'action.call', config: { actionId: 'tickets.create' } },
        catalog
      )?.groupKey
    ).toBe('ticket');
  });

  it('T075: legacy action.call app steps infer their app scope from actionId during hydration', () => {
    expect(
      getGroupedActionCatalogRecordForStep(
        { type: 'action.call', config: { actionId: 'slack.send_message' } },
        catalog
      )?.groupKey
    ).toBe('app:slack');
  });
});

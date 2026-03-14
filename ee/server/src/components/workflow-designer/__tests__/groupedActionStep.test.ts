import { describe, expect, it } from 'vitest';
import {
  applyGroupedActionSelectionToStep,
  buildGroupedActionStepConfig,
  getGroupedActionCatalogRecordForStep,
} from '../groupedActionStep';
import type { WorkflowDesignerCatalogRecord } from '@alga-psa/workflows/runtime/designer/actionCatalog';

const catalog: WorkflowDesignerCatalogRecord[] = [
  {
    groupKey: 'ai',
    label: 'AI',
    iconToken: 'ai',
    tileKind: 'ai',
    allowedActionIds: ['ai.infer'],
    defaultActionId: 'ai.infer',
    description: 'AI actions',
    actions: [],
  },
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
    allowedActionIds: ['transform.truncate_text'],
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
  it('T036/T037/T061/T064/T070/T071/T072: core grouped-tile insertion builds an action.call config with runtime action fields and additive group metadata', () => {
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

  it('T063/T066/T073: app grouped-tile insertion preserves additive app metadata without changing the action.call runtime contract', () => {
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

  it('T062/T065/T084: transform grouped-tile insertion can stay action-unselected while still scoping the action.call step to the transform group', () => {
    expect(
      buildGroupedActionStepConfig({
        groupKey: 'transform',
        tileKind: 'transform',
      })
    ).toEqual({
      designerGroupKey: 'transform',
      designerTileKind: 'transform',
    });
  });

  it('T085: grouped steps can preselect a declared default action when one is supplied during insertion', () => {
    const ticketRecord = catalog.find((record) => record.groupKey === 'ticket');
    expect(ticketRecord.defaultActionId).toBe('tickets.create');
    expect(
      buildGroupedActionStepConfig(
        {
          actionId: ticketRecord.defaultActionId,
          actionVersion: 1,
          groupKey: ticketRecord.groupKey,
          tileKind: ticketRecord.tileKind,
        },
        { generateSaveAsName: () => 'ticketsCreateResult' }
      )
    ).toEqual({
      actionId: 'tickets.create',
      version: 1,
      saveAs: 'ticketsCreateResult',
      designerGroupKey: 'ticket',
      designerTileKind: 'core-object',
    });
  });

  it('T225: transform grouped steps stay on action.call even before an action is chosen', () => {
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

  it('T003/T304: AI grouped steps insert as action.call with runtime action fields and additive AI metadata', () => {
    expect(
      buildGroupedActionStepConfig(
        {
          actionId: 'ai.infer',
          actionVersion: 1,
          groupKey: 'ai',
          tileKind: 'ai',
        },
        { generateSaveAsName: () => 'aiInferResult' }
      )
    ).toEqual({
      actionId: 'ai.infer',
      version: 1,
      saveAs: 'aiInferResult',
      designerGroupKey: 'ai',
      designerTileKind: 'ai',
    });
  });

  it('T233: legacy transform action.call steps infer the Transform group from actionId during hydration', () => {
    expect(
      getGroupedActionCatalogRecordForStep(
        { type: 'action.call', config: { actionId: 'transform.truncate_text' } },
        catalog
      )?.groupKey
    ).toBe('transform');
  });

  it('T074: legacy action.call steps infer their group from actionId during hydration', () => {
    expect(
      getGroupedActionCatalogRecordForStep(
        { type: 'action.call', config: { actionId: 'tickets.create' } },
        catalog
      )?.groupKey
    ).toBe('ticket');
  });

  it('T004/T305: legacy AI action.call steps infer the AI group from actionId during hydration', () => {
    expect(
      getGroupedActionCatalogRecordForStep(
        { type: 'action.call', config: { actionId: 'ai.infer' } },
        catalog
      )?.groupKey
    ).toBe('ai');
  });

  it('T075: legacy action.call app steps infer their app scope from actionId during hydration', () => {
    expect(
      getGroupedActionCatalogRecordForStep(
        { type: 'action.call', config: { actionId: 'slack.send_message' } },
        catalog
      )?.groupKey
    ).toBe('app:slack');
  });

  it('T292: app grouped steps hydrate through the same grouped-step model as built-ins', () => {
    const step = applyGroupedActionSelectionToStep(
      { id: 'step-app', type: 'action.call', name: 'Slack', config: {} },
      {
        actionId: 'slack.send_message',
        actionVersion: 1,
        groupKey: 'app:slack',
        groupLabel: 'Slack',
        tileKind: 'app',
      }
    );

    expect(getGroupedActionCatalogRecordForStep(step, catalog)?.groupKey).toBe('app:slack');
    expect(step.config).toMatchObject({
      actionId: 'slack.send_message',
      version: 1,
      designerGroupKey: 'app:slack',
      designerTileKind: 'app',
      designerAppKey: 'app:slack',
    });
  });
});

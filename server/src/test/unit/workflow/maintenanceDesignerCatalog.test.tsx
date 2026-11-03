/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { buildWorkflowDesignerActionCatalog } from '../../../../../shared/workflow/runtime/designer/actionCatalog';
import { getGroupedActionCatalogRecordForStep, applyGroupedActionSelectionToStep } from '../../../../../ee/server/src/components/workflow-designer/groupedActionStep';
import { applyCatalogActionChoiceToStep } from '../../../../../ee/server/src/components/workflow-designer/groupedActionSelection';
import { GroupedActionConfigSection } from '../../../../../ee/server/src/components/workflow-designer/GroupedActionConfigSection';

const actionFields = {
  get_maintenance: ['schedule_id', 'occurrence_id', 'ticket_id'],
  create_maintenance_ticket: ['occurrence_id', 'board_id', 'status_id', 'priority_id'],
  complete_maintenance: ['occurrence_id', 'performed_at', 'notes'],
  skip_maintenance: ['occurrence_id', 'reason'],
  set_maintenance_paused: ['schedule_id', 'paused'],
};
const catalog = buildWorkflowDesignerActionCatalog(Object.entries(actionFields).map(([name, fields]) => ({
  id: `assets.${name}`, version: 1, ui: { label: name },
  inputSchema: { type: 'object', properties: Object.fromEntries(fields.map((field) => [field, { type: 'string' }])) },
})));
const maintenance = catalog.find((record) => record.groupKey === 'maintenance')!;
afterEach(cleanup);

describe('Maintenance designer group', () => {
  it.each(Object.keys(actionFields))('hydrates an existing %s step into the editable Core group', (name) => {
    expect(getGroupedActionCatalogRecordForStep({
      type: 'action.call', config: { actionId: `assets.${name}` },
    }, catalog)).toBe(maintenance);
  });

  it('inserts a Core step with the default lookup and switches actions without retaining unrelated inputs', () => {
    const step = applyGroupedActionSelectionToStep(
      { id: 'maintenance-step', type: 'action.call', config: {} },
      {
        groupKey: maintenance.groupKey, groupLabel: maintenance.label,
        tileKind: maintenance.tileKind, actionId: maintenance.defaultActionId, actionVersion: 1,
      },
    );
    expect(step.config).toMatchObject({
      actionId: 'assets.get_maintenance', designerGroupKey: 'maintenance', designerTileKind: 'core-object',
    });

    const updated = applyCatalogActionChoiceToStep({
      ...step, config: { ...step.config, inputMapping: { ticket_id: 'ticket', occurrence_id: 'occurrence' } },
    }, maintenance.actions.find((action) => action.id === 'assets.complete_maintenance')!, {
      generateSaveAsName: () => 'maintenanceResult',
    });
    expect(updated.config).toMatchObject({
      actionId: 'assets.complete_maintenance', version: 1,
      inputMapping: { occurrence_id: 'occurrence' },
    });
    expect(updated.config?.inputMapping).not.toHaveProperty('ticket_id');
  });

  it('moves a saved maintenance action out of the old Assets app group even if that group still exists', () => {
    const withAssets = buildWorkflowDesignerActionCatalog([
      { id: 'assets.get_maintenance', version: 1 },
      { id: 'assets.some_other_action', version: 1 },
    ]);
    expect(getGroupedActionCatalogRecordForStep({
      type: 'action.call', config: {
        actionId: 'assets.get_maintenance', designerAppKey: 'app:assets', designerGroupKey: 'app:assets',
      },
    }, withAssets)?.groupKey).toBe('maintenance');
  });

  it('retains the saved group selector when an action is no longer available anywhere', () => {
    expect(getGroupedActionCatalogRecordForStep({
      type: 'action.call', config: {
        actionId: 'assets.removed_action', designerGroupKey: 'maintenance',
      },
    }, catalog)).toBe(maintenance);
  });

  it('offers every maintenance operation through the existing action selector', () => {
    const onActionChange = vi.fn();
    render(<GroupedActionConfigSection stepId="maintenance-step" record={maintenance}
      selectedActionId="assets.get_maintenance" onActionChange={onActionChange} />);
    const selector = document.getElementById('workflow-step-action-select-maintenance-step')!;
    expect(selector).toBeInTheDocument();
    fireEvent.click(selector);
    for (const name of Object.keys(actionFields)) {
      expect(screen.getByRole('option', { name, exact: true })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('option', { name: 'complete_maintenance' }));
    expect(onActionChange).toHaveBeenCalledWith('assets.complete_maintenance');
  });
});

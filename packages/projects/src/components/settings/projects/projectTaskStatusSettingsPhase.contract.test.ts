import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const settingsSource = readFileSync(
  path.resolve(__dirname, 'ProjectTaskStatusSettings.tsx'),
  'utf8'
);
const addControlsSource = readFileSync(
  path.resolve(__dirname, '../../status-columns/AddStatusColumnControls.tsx'),
  'utf8'
);
const actionsSource = readFileSync(
  path.resolve(__dirname, '../../../actions/projectTaskStatusActions.ts'),
  'utf8'
);

describe('phase-aware project status settings contracts', () => {
  it('T039/T040: phase selector includes project defaults and toggles phase default-vs-custom state', () => {
    expect(settingsSource).toContain("const DEFAULT_SCOPE = '__project_defaults__';");
    expect(settingsSource).toContain("{ value: DEFAULT_SCOPE, label: t('settings.statuses.scope_project_defaults') },");
    expect(settingsSource).toContain("{t('settings.statuses.scope_label')}");
    expect(settingsSource).toContain('const isUsingProjectDefaults = Boolean(selectedPhaseId) && !effectiveCustomStatuses;');
    expect(settingsSource).toContain("{t('settings.statuses.use_project_defaults')}");
    expect(settingsSource).toContain("{t('settings.statuses.custom_statuses')}");
  });

  it('T041/T042/T043: settings expose copy-from-defaults and revert-to-default flows for phases', () => {
    // Copying project defaults into a phase now happens via the
    // 'Custom statuses' toggle: both directions are confirmed and then staged,
    // and the write only happens when the host form saves (UX finding #11).
    expect(settingsSource).toContain('function handleEnableCustomStatuses() {');
    expect(settingsSource).toContain('await copyProjectStatusesToPhase(projectId, phaseId)');
    expect(settingsSource).toContain('setForkConfirmation(true);');
    expect(settingsSource).toContain('onConfirm={handleEnableCustomStatuses}');
    expect(settingsSource).toContain('function handleRevertToDefaults() {');
    expect(settingsSource).toContain('setRevertConfirmation(true);');
    expect(settingsSource).toContain('onConfirm={handleRevertToDefaults}');
    expect(settingsSource).toContain('await removePhaseStatuses(phaseId);');
  });

  it('scope and order edits are staged and only written by the host form save', () => {
    // UX finding #11: clicking a scope toggle used to persist the fork before
    // any save, and Cancel could not undo it. Both directions now stage.
    expect(settingsSource).toContain('function stagePhaseScope(mode: PendingScopeMode) {');
    expect(settingsSource).toContain('const commitPendingChanges = useCallback(async (): Promise<boolean> => {');
    expect(settingsSource).toContain('hasPendingChanges: () => hasPendingChanges,');
    expect(settingsSource).toContain('commitPendingChanges,');
    // A drag / arrow move only stages the new order.
    expect(settingsSource).toContain('onReorder={stageOrder}');
    expect(settingsSource).toContain('onReorderCommit={stageOrder}');
    // Staged work is visible before saving and named per phase.
    expect(settingsSource).toContain("id=\"project-status-pending-banner\"");
    expect(settingsSource).toContain("'settings.statuses.pending_fork'");
    expect(settingsSource).toContain("'settings.statuses.pending_revert'");
    expect(settingsSource).toContain("'settings.statuses.pending_apply_hint'");

    const drawerSource = readFileSync(path.resolve(__dirname, '../../ProjectDetailsEdit.tsx'), 'utf8');
    expect(drawerSource).toContain('statusSettingsRef.current?.commitPendingChanges()');
    expect(drawerSource).toContain('ref={statusSettingsRef}');

    const phaseItemSource = readFileSync(path.resolve(__dirname, '../../PhaseListItem.tsx'), 'utf8');
    expect(phaseItemSource).toContain('statusSettingsRef.current?.commitPendingChanges()');
    expect(phaseItemSource).toContain('onPendingChangesChange={setStatusChangesPending}');
  });

  it('T044/T045: the inline add controls forward the selected scope when adding phase statuses', () => {
    // AddStatusDialog was absorbed into the shared status-columns editor: the
    // library picker and the inline Create New flow now live in the editor and
    // add straight into the selected scope.
    expect(settingsSource).toContain('<AddStatusColumnControls');
    expect(settingsSource).toContain('onAddExisting={handleAddExisting}');
    expect(settingsSource).toContain('onStatusCreated={handleStatusCreated}');
    expect(settingsSource).toContain(
      'await addStatusToProject(projectId, { status_id: statusId }, selectedPhaseId);'
    );
    expect(addControlsSource).toContain('onAddExisting: (statusId: string) => void | Promise<void>;');
    expect(addControlsSource).toContain('onStatusCreated: (status: IStatus) => void | Promise<void>;');
    // Re-reads the library on open so a status created elsewhere shows up
    // without a page reload.
    expect(addControlsSource).toContain('await onRefresh?.();');
  });

  it('phase forking is confirmed before it persists and never submits a host form', () => {
    expect(settingsSource).toContain("id=\"confirm-phase-status-fork\"");
    expect(settingsSource).toContain("'settings.statuses.fork_message'");
    // The move/delete controls live in the shared editor, which marks every
    // control type="button" so the project edit drawer stops self-submitting.
    const editorSource = readFileSync(
      path.resolve(__dirname, '../../status-columns/StatusColumnsEditor.tsx'),
      'utf8'
    );
    const rawButtons = editorSource.match(/<button\b/g)?.length ?? 0;
    expect(rawButtons).toBeGreaterThan(0);
    expect(editorSource.match(/<button\s+type="button"/g)?.length).toBe(rawButtons);
  });

  it('rename impact widens the match set past status_id so divergent columns are found', () => {
    // UX finding #3: older projects label a column via custom_name pinned
    // against standard_statuses, so matching on status_id alone reported
    // "0 columns keep their current name" while a live project still showed
    // the old name. The match set has to include label-equal columns.
    expect(actionsSource).toContain(
      "orWhereRaw('lower(trim(COALESCE(psm.custom_name, s.name, ss.name))) = ?', ["
    );
    expect(actionsSource).toContain(
      "scoped.tenantJoin(query, 'standard_statuses as ss', 'psm.standard_status_id', 'ss.standard_status_id', { type: 'left' });"
    );
    expect(actionsSource).toContain('return bucketProjectStatusRenameImpact(rows, statusId, status.name);');
    // The dead standard_status_id lookup on `statuses` (no such column) is gone.
    expect(actionsSource).not.toContain('status.standard_status_id');

    const tenantSettingsSource = readFileSync(
      path.resolve(__dirname, 'TenantProjectTaskStatusSettings.tsx'),
      'utf8'
    );
    expect(tenantSettingsSource).toContain("'settings.statuses.rename_impact_following'");
    expect(tenantSettingsSource).toContain("'settings.statuses.rename_impact_keeping'");
    expect(tenantSettingsSource).toContain('formatProjectList(renameImpact.keeping.projects)');
    // Columns that keep the old name are a warning, not a neutral note.
    expect(tenantSettingsSource).toContain('renameImpact.keeping.columns > 0');
    expect(tenantSettingsSource).toContain('<AlertTriangle');
  });

  it('T062: status deletion still blocks removing the last remaining status mapping', () => {
    expect(actionsSource).toContain("const remainingQuery = tenantScopedTable(trx, 'project_status_mappings', tenant)");
    expect(actionsSource).toContain("const remainingCount = await remainingQuery.count('* as count').first();");
    expect(actionsSource).toContain("if (parseInt(remainingCount?.count as string) < 1) {");
    expect(actionsSource).toContain("throw new Error('Cannot delete the last status in a project');");
  });
});

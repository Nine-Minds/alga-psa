'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { TIER_FEATURES } from '@alga-psa/types';
import { useTierFeature } from 'server/src/context/TierContext';
import {
  archiveAuthorizationBundleAction,
  cloneAuthorizationBundleAction,
  deleteAuthorizationBundleDraftRuleAction,
  getAuthorizationBundleDraftEditorAction,
  listAuthorizationBundlesAction,
  listAuthorizationBundleAssignmentsAction,
  listAuthorizationSimulationPrincipalsAction,
  listAuthorizationSimulationRecordsAction,
  runAuthorizationBundleSimulationAction,
  seedStarterAuthorizationBundlesAction,
  upsertAuthorizationBundleDraftRuleAction,
  type AuthorizationBundleAssignmentViewerPayload,
  type AuthorizationBundleDraftEditorPayload,
  type AuthorizationBundleLibraryEntry,
  type AuthorizationBundleSimulationPayload,
  type AuthorizationSimulationOption,
} from 'ee/server/src/lib/actions/auth/authorizationBundleActions';

const RESOURCE_SECTIONS: Array<{ label: string; resourceType: string }> = [
  { label: 'Tickets', resourceType: 'ticket' },
  { label: 'Documents', resourceType: 'document' },
  { label: 'Time', resourceType: 'time_entry' },
  { label: 'Projects', resourceType: 'project' },
  { label: 'Assets', resourceType: 'asset' },
  { label: 'Billing', resourceType: 'billing' },
];

const ACTION_OPTIONS = ['read', 'create', 'update', 'delete', 'approve'];

interface RuleDraftFormState {
  action: string;
  templateKey: string;
  constraintKey: string;
}

const TEMPLATE_SUMMARIES: Record<string, string> = {
  own: 'records owned by the principal',
  assigned: 'records assigned to the principal',
  managed: 'records owned by managed users',
  own_or_assigned: 'records owned by or assigned to the principal',
  own_or_managed: 'records owned by the principal or managed users',
  same_client: 'records in the same client scope',
  client_portfolio: 'records for the principal client portfolio',
  selected_clients: 'records in selected client scopes',
  same_team: 'records owned by the same team',
  selected_boards: 'records in selected boards',
};

const CONSTRAINT_SUMMARIES: Record<string, string> = {
  not_self_approver: 'blocks self-approval',
  client_visible_only: 'requires client-visible records',
  hide_sensitive_fields: 'redacts sensitive fields',
};

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown';
  }
  return parsed.toLocaleString();
}

function summarizeRule(rule: {
  resourceType: string;
  action: string;
  templateKey: string;
  constraintKey: string | null;
}): string {
  const scope = TEMPLATE_SUMMARIES[rule.templateKey] ?? rule.templateKey;
  const base = `Narrow ${rule.resourceType} ${rule.action} to ${scope}`;
  if (!rule.constraintKey) {
    return base + '.';
  }
  const constraint = CONSTRAINT_SUMMARIES[rule.constraintKey] ?? rule.constraintKey;
  return `${base}; ${constraint}.`;
}

function buildInitialRuleDrafts(editorData: AuthorizationBundleDraftEditorPayload): Record<string, RuleDraftFormState> {
  return RESOURCE_SECTIONS.reduce<Record<string, RuleDraftFormState>>((drafts, section) => {
    drafts[section.resourceType] = {
      action: 'read',
      templateKey: editorData.availableTemplates[0] ?? 'own',
      constraintKey: '',
    };
    return drafts;
  }, {});
}

export default function PolicyManagement() {
  const hasBundleLibrary = useTierFeature(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
  const [entries, setEntries] = useState<AuthorizationBundleLibraryEntry[]>([]);
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyBundleId, setBusyBundleId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [editorBundleId, setEditorBundleId] = useState<string | null>(null);
  const [editorData, setEditorData] = useState<AuthorizationBundleDraftEditorPayload | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, RuleDraftFormState>>({});
  const [assignmentBundleId, setAssignmentBundleId] = useState<string | null>(null);
  const [assignmentData, setAssignmentData] = useState<AuthorizationBundleAssignmentViewerPayload | null>(null);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [simulatorBundleId, setSimulatorBundleId] = useState<string | null>(null);
  const [principalOptions, setPrincipalOptions] = useState<AuthorizationSimulationOption[]>([]);
  const [recordOptions, setRecordOptions] = useState<AuthorizationSimulationOption[]>([]);
  const [simulatorResourceType, setSimulatorResourceType] = useState('ticket');
  const [simulatorAction, setSimulatorAction] = useState('read');
  const [simulatorPrincipalId, setSimulatorPrincipalId] = useState('');
  const [simulatorRecordId, setSimulatorRecordId] = useState('');
  const [useSyntheticRecord, setUseSyntheticRecord] = useState(false);
  const [syntheticOwnerUserId, setSyntheticOwnerUserId] = useState('');
  const [syntheticClientId, setSyntheticClientId] = useState('');
  const [syntheticBoardId, setSyntheticBoardId] = useState('');
  const [syntheticClientVisible, setSyntheticClientVisible] = useState(false);
  const [simulatorLoading, setSimulatorLoading] = useState(false);
  const [simulationResult, setSimulationResult] = useState<AuthorizationBundleSimulationPayload | null>(null);

  const activeCount = useMemo(
    () => entries.filter((entry) => entry.status === 'active').length,
    [entries]
  );

  const fetchEntries = useCallback(async () => {
    if (!hasBundleLibrary) {
      setEntries([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextEntries = await listAuthorizationBundlesAction({
        search: search.trim() || undefined,
        includeArchived,
      });
      setEntries(nextEntries);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load bundles.');
    } finally {
      setLoading(false);
    }
  }, [hasBundleLibrary, search, includeArchived]);

  const loadEditor = useCallback(async (bundleId: string) => {
    setEditorLoading(true);
    setError(null);
    try {
      const payload = await getAuthorizationBundleDraftEditorAction(bundleId);
      setEditorData(payload);
      setRuleDrafts(buildInitialRuleDrafts(payload));
    } catch (editorError) {
      setError(editorError instanceof Error ? editorError.message : 'Failed to load bundle editor.');
      setEditorData(null);
    } finally {
      setEditorLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void fetchEntries();
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [fetchEntries]);

  useEffect(() => {
    if (!editorBundleId) {
      setEditorData(null);
      return;
    }
    void loadEditor(editorBundleId);
  }, [editorBundleId, loadEditor]);

  const loadAssignments = useCallback(async (bundleId: string) => {
    setAssignmentLoading(true);
    setError(null);
    try {
      const payload = await listAuthorizationBundleAssignmentsAction(bundleId);
      setAssignmentData(payload);
    } catch (assignmentError) {
      setError(assignmentError instanceof Error ? assignmentError.message : 'Failed to load bundle assignments.');
      setAssignmentData(null);
    } finally {
      setAssignmentLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!assignmentBundleId) {
      setAssignmentData(null);
      return;
    }
    void loadAssignments(assignmentBundleId);
  }, [assignmentBundleId, loadAssignments]);

  const loadSimulationReferenceData = useCallback(async (resourceType: string) => {
    const [principals, records] = await Promise.all([
      listAuthorizationSimulationPrincipalsAction(),
      listAuthorizationSimulationRecordsAction({ resourceType }),
    ]);
    setPrincipalOptions(principals);
    setRecordOptions(records);
    if (principals.length > 0) {
      setSimulatorPrincipalId((current) => current || principals[0].id);
    }
    if (records.length > 0) {
      setSimulatorRecordId((current) => current || records[0].id);
    }
  }, []);

  useEffect(() => {
    if (!simulatorBundleId) {
      setSimulationResult(null);
      return;
    }
    void loadSimulationReferenceData(simulatorResourceType);
  }, [simulatorBundleId, simulatorResourceType, loadSimulationReferenceData]);

  const handleClone = async (entry: AuthorizationBundleLibraryEntry): Promise<void> => {
    const clonedName = `${entry.name} Copy`;
    setBusyBundleId(entry.bundleId);
    setError(null);
    try {
      await cloneAuthorizationBundleAction({
        sourceBundleId: entry.bundleId,
        name: clonedName,
      });
      await fetchEntries();
    } catch (cloneError) {
      setError(cloneError instanceof Error ? cloneError.message : 'Failed to clone bundle.');
    } finally {
      setBusyBundleId(null);
    }
  };

  const handleArchive = async (entry: AuthorizationBundleLibraryEntry): Promise<void> => {
    setBusyBundleId(entry.bundleId);
    setError(null);
    try {
      await archiveAuthorizationBundleAction(entry.bundleId);
      await fetchEntries();
      if (editorBundleId === entry.bundleId) {
        setEditorBundleId(null);
      }
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'Failed to archive bundle.');
    } finally {
      setBusyBundleId(null);
    }
  };

  const handleSeedStarters = async (): Promise<void> => {
    setSeeding(true);
    setError(null);
    try {
      await seedStarterAuthorizationBundlesAction();
      await fetchEntries();
    } catch (seedError) {
      setError(seedError instanceof Error ? seedError.message : 'Failed to seed starter bundles.');
    } finally {
      setSeeding(false);
    }
  };

  const handleAddRule = async (resourceType: string): Promise<void> => {
    if (!editorData) {
      return;
    }
    const draft = ruleDrafts[resourceType];
    if (!draft?.templateKey) {
      setError('Select a template before adding a rule.');
      return;
    }

    setError(null);
    try {
      await upsertAuthorizationBundleDraftRuleAction({
        bundleId: editorData.bundle.bundleId,
        resourceType,
        action: draft.action,
        templateKey: draft.templateKey,
        constraintKey: draft.constraintKey || null,
        config: {},
      });
      await loadEditor(editorData.bundle.bundleId);
    } catch (ruleError) {
      setError(ruleError instanceof Error ? ruleError.message : 'Failed to save draft rule.');
    }
  };

  const handleDeleteRule = async (ruleId: string): Promise<void> => {
    if (!editorData) {
      return;
    }
    setError(null);
    try {
      await deleteAuthorizationBundleDraftRuleAction({
        bundleId: editorData.bundle.bundleId,
        ruleId,
      });
      await loadEditor(editorData.bundle.bundleId);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete draft rule.');
    }
  };

  const handleRunSimulation = async (): Promise<void> => {
    if (!simulatorBundleId || !simulatorPrincipalId) {
      setError('Select a principal before running simulation.');
      return;
    }

    if (!useSyntheticRecord && !simulatorRecordId) {
      setError('Select a record before running simulation.');
      return;
    }

    setSimulatorLoading(true);
    setError(null);
    setSimulationResult(null);
    try {
      const result = await runAuthorizationBundleSimulationAction({
        bundleId: simulatorBundleId,
        principalUserId: simulatorPrincipalId,
        resourceType: simulatorResourceType,
        action: simulatorAction,
        resourceId: useSyntheticRecord ? undefined : simulatorRecordId,
        syntheticRecord: useSyntheticRecord
          ? {
              ownerUserId: syntheticOwnerUserId || null,
              clientId: syntheticClientId || null,
              boardId: syntheticBoardId || null,
              isClientVisible: syntheticClientVisible,
            }
          : undefined,
      });
      setSimulationResult(result);
    } catch (simulationError) {
      setError(simulationError instanceof Error ? simulationError.message : 'Failed to run simulation.');
    } finally {
      setSimulatorLoading(false);
    }
  };

  const groupedAssignments = useMemo(() => {
    if (!assignmentData) {
      return new Map<string, AuthorizationBundleAssignmentViewerPayload['assignments']>();
    }
    const groups = new Map<string, AuthorizationBundleAssignmentViewerPayload['assignments']>();
    for (const assignment of assignmentData.assignments) {
      const current = groups.get(assignment.targetType) ?? [];
      current.push(assignment);
      groups.set(assignment.targetType, current);
    }
    return groups;
  }, [assignmentData]);

  if (!hasBundleLibrary) {
    return (
      <div className="space-y-4 rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
        <p className="font-semibold text-foreground">Authorization Bundle Library</p>
        <p>
          Advanced Authorization Bundle management is available on the Premium tier. Upgrade to manage reusable narrowing bundles.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">Authorization Bundle Library</h2>
            <p className="text-sm text-muted-foreground">
              Browse and manage reusable narrowing bundles. Active bundles: {activeCount}
            </p>
          </div>
          <Button size="sm" onClick={() => void handleSeedStarters()} disabled={seeding}>
            {seeding ? 'Adding starter bundles...' : 'Add Starter Bundles'}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="max-w-md"
            placeholder="Search bundles by name or description"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button
            size="sm"
            variant={includeArchived ? 'default' : 'outline'}
            onClick={() => setIncludeArchived((current) => !current)}
          >
            {includeArchived ? 'Showing archived' : 'Show archived'}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bundle</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Assignments</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-sm text-muted-foreground">
                  No authorization bundles found.
                </TableCell>
              </TableRow>
            ) : null}

            {entries.map((entry) => {
              const rowBusy = busyBundleId === entry.bundleId;
              const isEditing = editorBundleId === entry.bundleId;
              return (
                <TableRow key={entry.bundleId}>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-medium">{entry.name}</div>
                      {entry.description ? (
                        <div className="text-xs text-muted-foreground">{entry.description}</div>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          {entry.isSystem
                            ? 'System starter bundle.'
                            : 'Custom narrowing bundle for role/team/user/API-key assignments.'}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        Effective summary: {entry.status === 'active' ? 'active' : 'archived'} bundle with {entry.assignmentCount} active assignment(s).
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={entry.status === 'active' ? 'default' : 'secondary'}>
                      {entry.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{entry.isSystem ? 'System' : 'Custom'}</TableCell>
                  <TableCell>{entry.assignmentCount}</TableCell>
                  <TableCell>{formatDate(entry.updatedAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant={isEditing ? 'default' : 'outline'}
                        onClick={() => setEditorBundleId(isEditing ? null : entry.bundleId)}
                      >
                        {isEditing ? 'Close Editor' : 'Edit Draft'}
                      </Button>
                      <Button
                        size="sm"
                        variant={assignmentBundleId === entry.bundleId ? 'default' : 'outline'}
                        onClick={() =>
                          setAssignmentBundleId(
                            assignmentBundleId === entry.bundleId ? null : entry.bundleId
                          )
                        }
                      >
                        {assignmentBundleId === entry.bundleId ? 'Close Assignments' : 'Assignments'}
                      </Button>
                      <Button
                        size="sm"
                        variant={simulatorBundleId === entry.bundleId ? 'default' : 'outline'}
                        onClick={() =>
                          setSimulatorBundleId(simulatorBundleId === entry.bundleId ? null : entry.bundleId)
                        }
                      >
                        {simulatorBundleId === entry.bundleId ? 'Close Simulator' : 'Simulator'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={rowBusy}
                        onClick={() => void handleClone(entry)}
                      >
                        Clone
                      </Button>
                      {entry.status === 'active' ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={rowBusy}
                          onClick={() => void handleArchive(entry)}
                        >
                          Archive
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}

            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-sm text-muted-foreground">
                  Loading authorization bundles...
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {editorBundleId ? (
        <div className="space-y-4 rounded-md border p-4">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold">Bundle Editor</h3>
            {editorData ? (
              <p className="text-sm text-muted-foreground">
                Editing draft revision for <span className="font-medium text-foreground">{editorData.bundle.name}</span>.
                Changes stay in draft until published.
              </p>
            ) : null}
          </div>

          {editorLoading || !editorData ? (
            <div className="text-sm text-muted-foreground">Loading draft editor...</div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                Revision summary: {editorData.revisionChangeSummary}
              </div>

              {RESOURCE_SECTIONS.map((section) => {
                const sectionRules = editorData.rules.filter(
                  (rule) => rule.resourceType === section.resourceType
                );
                const draft = ruleDrafts[section.resourceType] ?? {
                  action: 'read',
                  templateKey: editorData.availableTemplates[0] ?? 'own',
                  constraintKey: '',
                };

                return (
                  <div key={section.resourceType} className="space-y-3 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-medium">{section.label}</h4>
                      <Badge variant="outline">{sectionRules.length} draft rule(s)</Badge>
                    </div>

                    <div className="space-y-2">
                      {sectionRules.length === 0 ? (
                        <div className="text-sm text-muted-foreground">
                          No draft rules yet for {section.label.toLowerCase()}.
                        </div>
                      ) : (
                        sectionRules.map((rule) => (
                          <div
                            key={rule.ruleId}
                            className="flex flex-wrap items-center justify-between gap-2 rounded border bg-muted/20 px-3 py-2 text-sm"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">{rule.action}</Badge>
                              <span className="font-medium">{rule.templateKey}</span>
                              {rule.constraintKey ? (
                                <span className="text-muted-foreground">constraint: {rule.constraintKey}</span>
                              ) : null}
                            </div>
                            <div className="w-full text-xs text-muted-foreground">
                              {summarizeRule(rule)}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleDeleteRule(rule.ruleId)}
                            >
                              Remove
                            </Button>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="grid gap-2 md:grid-cols-4">
                      <label className="text-sm">
                        <div className="mb-1 text-muted-foreground">Action</div>
                        <select
                          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                          value={draft.action}
                          onChange={(event) =>
                            setRuleDrafts((current) => ({
                              ...current,
                              [section.resourceType]: {
                                ...draft,
                                action: event.target.value,
                              },
                            }))
                          }
                        >
                          {ACTION_OPTIONS.map((action) => (
                            <option key={action} value={action}>
                              {action}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="text-sm">
                        <div className="mb-1 text-muted-foreground">Template</div>
                        <select
                          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                          value={draft.templateKey}
                          onChange={(event) =>
                            setRuleDrafts((current) => ({
                              ...current,
                              [section.resourceType]: {
                                ...draft,
                                templateKey: event.target.value,
                              },
                            }))
                          }
                        >
                          {editorData.availableTemplates.map((template) => (
                            <option key={template} value={template}>
                              {template}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="text-sm">
                        <div className="mb-1 text-muted-foreground">Constraint (optional)</div>
                        <select
                          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                          value={draft.constraintKey}
                          onChange={(event) =>
                            setRuleDrafts((current) => ({
                              ...current,
                              [section.resourceType]: {
                                ...draft,
                                constraintKey: event.target.value,
                              },
                            }))
                          }
                        >
                          <option value="">none</option>
                          {editorData.availableConstraints.map((constraint) => (
                            <option key={constraint} value={constraint}>
                              {constraint}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="flex items-end">
                        <Button
                          size="sm"
                          className="w-full"
                          onClick={() => void handleAddRule(section.resourceType)}
                        >
                          Add Draft Rule
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {assignmentBundleId ? (
        <div className="space-y-4 rounded-md border p-4">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold">Assignment Manager</h3>
            <p className="text-sm text-muted-foreground">
              View all role, team, user, and API-key targets currently affected by this bundle.
            </p>
          </div>

          {assignmentLoading || !assignmentData ? (
            <div className="text-sm text-muted-foreground">Loading assignments...</div>
          ) : assignmentData.assignments.length === 0 ? (
            <div className="text-sm text-muted-foreground">No assignments for this bundle yet.</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {(['role', 'team', 'user', 'api_key'] as const).map((targetType) => {
                const rows = groupedAssignments.get(targetType) ?? [];
                return (
                  <div key={targetType} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium capitalize">{targetType.replace('_', ' ')}</h4>
                      <Badge variant="outline">{rows.length}</Badge>
                    </div>
                    {rows.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No {targetType.replace('_', ' ')} assignments.</div>
                    ) : (
                      rows.map((assignment) => (
                        <div key={assignment.assignmentId} className="rounded border bg-muted/20 px-3 py-2 text-sm">
                          <div className="font-medium">{assignment.targetLabel}</div>
                          <div className="text-xs text-muted-foreground">
                            {assignment.targetId} · {assignment.status}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {simulatorBundleId ? (
        <div className="space-y-4 rounded-md border p-4">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold">Access Simulator</h3>
            <p className="text-sm text-muted-foreground">
              Simulate draft vs published bundle behavior against a real principal and existing record.
            </p>
          </div>

          <div className="grid gap-2 md:grid-cols-4">
            <label className="text-sm">
              <div className="mb-1 text-muted-foreground">Resource</div>
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={simulatorResourceType}
                onChange={(event) => {
                  setSimulatorResourceType(event.target.value);
                  setSimulatorRecordId('');
                  setSimulationResult(null);
                }}
              >
                {RESOURCE_SECTIONS.map((section) => (
                  <option key={section.resourceType} value={section.resourceType}>
                    {section.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <div className="mb-1 text-muted-foreground">Action</div>
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={simulatorAction}
                onChange={(event) => setSimulatorAction(event.target.value)}
              >
                {ACTION_OPTIONS.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <div className="mb-1 text-muted-foreground">Principal</div>
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={simulatorPrincipalId}
                onChange={(event) => setSimulatorPrincipalId(event.target.value)}
              >
                {principalOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <div className="mb-1 text-muted-foreground">Record</div>
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={simulatorRecordId}
                onChange={(event) => setSimulatorRecordId(event.target.value)}
              >
                {recordOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useSyntheticRecord}
                onChange={(event) => setUseSyntheticRecord(event.target.checked)}
              />
              Use synthetic record scenario
            </label>
            {useSyntheticRecord ? (
              <div className="grid gap-2 md:grid-cols-4">
                <Input
                  placeholder="Owner user ID (optional)"
                  value={syntheticOwnerUserId}
                  onChange={(event) => setSyntheticOwnerUserId(event.target.value)}
                />
                <Input
                  placeholder="Client ID (optional)"
                  value={syntheticClientId}
                  onChange={(event) => setSyntheticClientId(event.target.value)}
                />
                <Input
                  placeholder="Board ID (optional)"
                  value={syntheticBoardId}
                  onChange={(event) => setSyntheticBoardId(event.target.value)}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={syntheticClientVisible}
                    onChange={(event) => setSyntheticClientVisible(event.target.checked)}
                  />
                  Client visible
                </label>
              </div>
            ) : null}
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={() => void handleRunSimulation()} disabled={simulatorLoading}>
              {simulatorLoading ? 'Running simulation...' : 'Run Simulation'}
            </Button>
          </div>

          {simulationResult ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Draft Revision</h4>
                  <Badge variant={simulationResult.draft.allowed ? 'default' : 'destructive'}>
                    {simulationResult.draft.allowed ? 'allowed' : 'denied'}
                  </Badge>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {simulationResult.draft.reasonCodes.map((code) => (
                    <div key={code}>{code}</div>
                  ))}
                </div>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Published Revision</h4>
                  <Badge variant={simulationResult.published.allowed ? 'default' : 'destructive'}>
                    {simulationResult.published.allowed ? 'allowed' : 'denied'}
                  </Badge>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {simulationResult.published.reasonCodes.map((code) => (
                    <div key={code}>{code}</div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { TIER_FEATURES } from '@alga-psa/types';
import { useTierFeature } from 'server/src/context/TierContext';
import {
  archiveAuthorizationBundleAction,
  cloneAuthorizationBundleAction,
  createAuthorizationBundleAction,
  createAuthorizationBundleAssignmentAction,
  deleteAuthorizationBundleDraftRuleAction,
  getAuthorizationBundleDraftEditorAction,
  listAuthorizationBundlesAction,
  listAuthorizationBundleAssignmentsAction,
  listAuthorizationSimulationPrincipalsAction,
  listAuthorizationSimulationRecordsAction,
  publishAuthorizationBundleDraftAction,
  runAuthorizationBundleSimulationAction,
  seedStarterAuthorizationBundlesAction,
  setAuthorizationBundleAssignmentStatusAction,
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
const ASSIGNMENT_TARGET_TYPES = ['role', 'team', 'user', 'api_key'] as const;

type AssignmentTargetType = (typeof ASSIGNMENT_TARGET_TYPES)[number];
type EditorRule = AuthorizationBundleDraftEditorPayload['rules'][number];

interface RuleDraftFormState {
  ruleId?: string;
  action: string;
  templateKey: string;
  constraintKey: string;
  selectedClientIds: string[];
  selectedBoardIds: string[];
  redactedFieldsInput: string;
  pendingClientId: string;
  pendingBoardId: string;
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

const TARGET_TYPE_LABELS: Record<AssignmentTargetType, string> = {
  role: 'Role',
  team: 'Team',
  user: 'User',
  api_key: 'API Key',
};

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown';
  }
  return parsed.toLocaleString();
}

function parseDelimitedList(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

function formatDelimitedList(values: string[]): string {
  return values.join(', ');
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
    return `${base}.`;
  }
  const constraint = CONSTRAINT_SUMMARIES[rule.constraintKey] ?? rule.constraintKey;
  return `${base}; ${constraint}.`;
}

function buildEmptyRuleDraft(editorData: AuthorizationBundleDraftEditorPayload): RuleDraftFormState {
  return {
    action: 'read',
    templateKey: editorData.availableTemplates[0] ?? 'own',
    constraintKey: '',
    selectedClientIds: [],
    selectedBoardIds: [],
    redactedFieldsInput: '',
    pendingClientId: '',
    pendingBoardId: '',
  };
}

function buildInitialRuleDrafts(
  editorData: AuthorizationBundleDraftEditorPayload
): Record<string, RuleDraftFormState> {
  return RESOURCE_SECTIONS.reduce<Record<string, RuleDraftFormState>>((drafts, section) => {
    drafts[section.resourceType] = buildEmptyRuleDraft(editorData);
    return drafts;
  }, {});
}

function mapRuleToDraft(rule: EditorRule): RuleDraftFormState {
  return {
    ruleId: rule.ruleId,
    action: rule.action,
    templateKey: rule.templateKey,
    constraintKey: rule.constraintKey ?? '',
    selectedClientIds: rule.selectedClientIds ?? [],
    selectedBoardIds: rule.selectedBoardIds ?? [],
    redactedFieldsInput: formatDelimitedList(rule.redactedFields ?? []),
    pendingClientId: '',
    pendingBoardId: '',
  };
}

function buildRuleConfig(draft: RuleDraftFormState): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  if (draft.templateKey === 'selected_clients') {
    config.selectedClientIds = draft.selectedClientIds;
  }

  if (draft.templateKey === 'selected_boards') {
    config.selectedBoardIds = draft.selectedBoardIds;
  }

  if (draft.constraintKey === 'hide_sensitive_fields') {
    config.redactedFields = parseDelimitedList(draft.redactedFieldsInput);
  }

  return config;
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
  const [publishingBundleId, setPublishingBundleId] = useState<string | null>(null);
  const [assignmentBundleId, setAssignmentBundleId] = useState<string | null>(null);
  const [assignmentData, setAssignmentData] = useState<AuthorizationBundleAssignmentViewerPayload | null>(null);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [assignmentStatusBusyId, setAssignmentStatusBusyId] = useState<string | null>(null);
  const [assignmentTargetType, setAssignmentTargetType] = useState<AssignmentTargetType>('role');
  const [assignmentTargetId, setAssignmentTargetId] = useState('');
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
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newBundleName, setNewBundleName] = useState('');
  const [newBundleDescription, setNewBundleDescription] = useState('');
  const [creatingBundle, setCreatingBundle] = useState(false);

  const activeCount = useMemo(
    () => entries.filter((entry) => entry.status === 'active').length,
    [entries]
  );

  const clientNameById = useMemo(
    () =>
      new Map(
        (editorData?.availableClients ?? []).map((client) => [client.client_id, client.client_name])
      ),
    [editorData]
  );

  const boardNameById = useMemo(
    () =>
      new Map(
        (editorData?.availableBoards ?? []).map((board) => [board.board_id, board.board_name])
      ),
    [editorData]
  );

  const assignmentTargetOptions = useMemo(() => {
    return assignmentData?.availableTargets?.[assignmentTargetType] ?? [];
  }, [assignmentData, assignmentTargetType]);

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

  useEffect(() => {
    if (!assignmentBundleId) {
      setAssignmentData(null);
      return;
    }
    void loadAssignments(assignmentBundleId);
  }, [assignmentBundleId, loadAssignments]);

  useEffect(() => {
    if (!assignmentTargetOptions.some((option) => option.id === assignmentTargetId)) {
      setAssignmentTargetId(assignmentTargetOptions[0]?.id ?? '');
    }
  }, [assignmentTargetId, assignmentTargetOptions]);

  useEffect(() => {
    if (!simulatorBundleId) {
      setSimulationResult(null);
      return;
    }
    void loadSimulationReferenceData(simulatorResourceType);
  }, [simulatorBundleId, simulatorResourceType, loadSimulationReferenceData]);

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

  const actionOptions = useMemo<SelectOption[]>(
    () => ACTION_OPTIONS.map((action) => ({ value: action, label: action })),
    []
  );

  const assignmentTargetTypeOptions = useMemo<SelectOption[]>(
    () =>
      ASSIGNMENT_TARGET_TYPES.map((targetType) => ({
        value: targetType,
        label: TARGET_TYPE_LABELS[targetType],
      })),
    []
  );

  const updateRuleDraft = useCallback((resourceType: string, updates: Partial<RuleDraftFormState>) => {
    setRuleDrafts((current) => {
      const baseDraft =
        current[resourceType] ??
        (editorData ? buildEmptyRuleDraft(editorData) : {
          action: 'read',
          templateKey: 'own',
          constraintKey: '',
          selectedClientIds: [],
          selectedBoardIds: [],
          redactedFieldsInput: '',
          pendingClientId: '',
          pendingBoardId: '',
        });

      return {
        ...current,
        [resourceType]: {
          ...baseDraft,
          ...updates,
        },
      };
    });
  }, [editorData]);

  const resetRuleDraft = useCallback((resourceType: string) => {
    if (!editorData) {
      return;
    }
    updateRuleDraft(resourceType, buildEmptyRuleDraft(editorData));
  }, [editorData, updateRuleDraft]);

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
      if (assignmentBundleId === entry.bundleId) {
        setAssignmentBundleId(null);
      }
      if (simulatorBundleId === entry.bundleId) {
        setSimulatorBundleId(null);
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

  const handleCreateBundle = async (): Promise<void> => {
    const trimmedName = newBundleName.trim();
    if (!trimmedName) {
      setError('Bundle name is required.');
      return;
    }

    setCreatingBundle(true);
    setError(null);
    try {
      const created = await createAuthorizationBundleAction({
        name: trimmedName,
        description: newBundleDescription.trim() || null,
      });
      setIsCreateDialogOpen(false);
      setNewBundleName('');
      setNewBundleDescription('');
      await fetchEntries();
      setEditorBundleId(created.bundleId);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create bundle.');
    } finally {
      setCreatingBundle(false);
    }
  };

  const handlePublishDraft = async (): Promise<void> => {
    if (!editorData) {
      return;
    }

    setPublishingBundleId(editorData.bundle.bundleId);
    setError(null);
    try {
      await publishAuthorizationBundleDraftAction(editorData.bundle.bundleId);
      await fetchEntries();
      if (assignmentBundleId === editorData.bundle.bundleId) {
        await loadAssignments(editorData.bundle.bundleId);
      }
      setEditorBundleId(null);
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Failed to publish bundle draft.');
    } finally {
      setPublishingBundleId(null);
    }
  };

  const handleEditRule = (resourceType: string, rule: EditorRule): void => {
    updateRuleDraft(resourceType, mapRuleToDraft(rule));
  };

  const handleSaveRule = async (resourceType: string): Promise<void> => {
    if (!editorData) {
      return;
    }

    const draft = ruleDrafts[resourceType];
    if (!draft?.templateKey) {
      setError('Select a template before saving a rule.');
      return;
    }

    if (draft.templateKey === 'selected_clients' && draft.selectedClientIds.length === 0) {
      setError('Add at least one selected client before saving this rule.');
      return;
    }

    if (draft.templateKey === 'selected_boards' && draft.selectedBoardIds.length === 0) {
      setError('Add at least one selected board before saving this rule.');
      return;
    }

    if (
      draft.constraintKey === 'hide_sensitive_fields' &&
      parseDelimitedList(draft.redactedFieldsInput).length === 0
    ) {
      setError('Enter at least one redacted field before saving this rule.');
      return;
    }

    setError(null);
    try {
      await upsertAuthorizationBundleDraftRuleAction({
        bundleId: editorData.bundle.bundleId,
        ruleId: draft.ruleId,
        resourceType,
        action: draft.action,
        templateKey: draft.templateKey,
        constraintKey: draft.constraintKey || null,
        config: buildRuleConfig(draft),
      });
      await loadEditor(editorData.bundle.bundleId);
      resetRuleDraft(resourceType);
    } catch (ruleError) {
      setError(ruleError instanceof Error ? ruleError.message : 'Failed to save draft rule.');
    }
  };

  const handleDeleteRule = async (resourceType: string, ruleId: string): Promise<void> => {
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
      if (ruleDrafts[resourceType]?.ruleId === ruleId) {
        resetRuleDraft(resourceType);
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete draft rule.');
    }
  };

  const handleCreateAssignment = async (): Promise<void> => {
    if (!assignmentBundleId || !assignmentTargetId) {
      setError('Select a target before adding an assignment.');
      return;
    }

    setAssignmentSaving(true);
    setError(null);
    try {
      await createAuthorizationBundleAssignmentAction({
        bundleId: assignmentBundleId,
        targetType: assignmentTargetType,
        targetId: assignmentTargetId,
      });
      await Promise.all([loadAssignments(assignmentBundleId), fetchEntries()]);
    } catch (assignmentError) {
      setError(assignmentError instanceof Error ? assignmentError.message : 'Failed to add assignment.');
    } finally {
      setAssignmentSaving(false);
    }
  };

  const handleSetAssignmentStatus = async (
    assignmentId: string,
    status: 'active' | 'disabled'
  ): Promise<void> => {
    if (!assignmentBundleId) {
      return;
    }

    setAssignmentStatusBusyId(assignmentId);
    setError(null);
    try {
      await setAuthorizationBundleAssignmentStatusAction({ assignmentId, status });
      await Promise.all([loadAssignments(assignmentBundleId), fetchEntries()]);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Failed to update assignment status.');
    } finally {
      setAssignmentStatusBusyId(null);
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

  const renderNamedIds = (ids: string[], type: 'client' | 'board') => {
    const nameById = type === 'client' ? clientNameById : boardNameById;
    return ids.map((id) => nameById.get(id) ?? id);
  };

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
          <div className="flex flex-wrap gap-2">
            <Button
              id="authorization-bundle-create-button"
              size="sm"
              variant="outline"
              onClick={() => setIsCreateDialogOpen(true)}
            >
              New Bundle
            </Button>
            <Button
              id="authorization-bundle-seed-starters-button"
              size="sm"
              onClick={() => void handleSeedStarters()}
              disabled={seeding}
            >
              {seeding ? 'Adding starter bundles...' : 'Add Starter Bundles'}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Input
            id="authorization-bundle-search-input"
            className="max-w-md"
            placeholder="Search bundles by name or description"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button
            id="authorization-bundle-toggle-archived-button"
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
                        id={`authorization-bundle-edit-${entry.bundleId}`}
                        size="sm"
                        variant={isEditing ? 'default' : 'outline'}
                        onClick={() => setEditorBundleId(isEditing ? null : entry.bundleId)}
                      >
                        {isEditing ? 'Close Editor' : 'Edit Draft'}
                      </Button>
                      <Button
                        id={`authorization-bundle-assignments-${entry.bundleId}`}
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
                        id={`authorization-bundle-simulator-${entry.bundleId}`}
                        size="sm"
                        variant={simulatorBundleId === entry.bundleId ? 'default' : 'outline'}
                        onClick={() =>
                          setSimulatorBundleId(simulatorBundleId === entry.bundleId ? null : entry.bundleId)
                        }
                      >
                        {simulatorBundleId === entry.bundleId ? 'Close Simulator' : 'Simulator'}
                      </Button>
                      <Button
                        id={`authorization-bundle-clone-${entry.bundleId}`}
                        size="sm"
                        variant="outline"
                        disabled={rowBusy}
                        onClick={() => void handleClone(entry)}
                      >
                        Clone
                      </Button>
                      {entry.status === 'active' ? (
                        <Button
                          id={`authorization-bundle-archive-${entry.bundleId}`}
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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold">Bundle Editor</h3>
              {editorData ? (
                <p className="text-sm text-muted-foreground">
                  Editing draft revision for <span className="font-medium text-foreground">{editorData.bundle.name}</span>.{' '}
                  Changes stay in draft until published.
                </p>
              ) : null}
            </div>
            <Button
              id="authorization-bundle-publish-draft-button"
              size="sm"
              onClick={() => void handlePublishDraft()}
              disabled={!editorData || editorLoading || publishingBundleId === editorData?.bundle.bundleId}
            >
              {publishingBundleId === editorData?.bundle.bundleId ? 'Publishing...' : 'Publish Draft'}
            </Button>
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
                const draft = ruleDrafts[section.resourceType] ?? buildEmptyRuleDraft(editorData);
                const constraintOptions: SelectOption[] = [
                  { value: '', label: 'none' },
                  ...editorData.availableConstraints.map((constraint) => ({
                    value: constraint,
                    label: constraint,
                  })),
                ];
                const templateOptions: SelectOption[] = editorData.availableTemplates.map((template) => ({
                  value: template,
                  label: template,
                }));
                const clientOptions: SelectOption[] = editorData.availableClients.map((client) => ({
                  value: client.client_id,
                  label: client.client_name,
                  is_inactive: client.is_inactive,
                }));
                const boardOptions: SelectOption[] = editorData.availableBoards.map((board) => ({
                  value: board.board_id,
                  label: board.board_name,
                  is_inactive: board.is_inactive,
                }));
                const editingExistingRule = Boolean(draft.ruleId);

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
                            className="flex flex-wrap items-start justify-between gap-2 rounded border bg-muted/20 px-3 py-2 text-sm"
                          >
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline">{rule.action}</Badge>
                                <span className="font-medium">{rule.templateKey}</span>
                                {rule.constraintKey ? (
                                  <span className="text-muted-foreground">constraint: {rule.constraintKey}</span>
                                ) : null}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {summarizeRule(rule)}
                              </div>
                              {rule.selectedClientIds.length > 0 ? (
                                <div className="text-xs text-muted-foreground">
                                  Selected clients: {renderNamedIds(rule.selectedClientIds, 'client').join(', ')}
                                </div>
                              ) : null}
                              {rule.selectedBoardIds.length > 0 ? (
                                <div className="text-xs text-muted-foreground">
                                  Selected boards: {renderNamedIds(rule.selectedBoardIds, 'board').join(', ')}
                                </div>
                              ) : null}
                              {rule.redactedFields.length > 0 ? (
                                <div className="text-xs text-muted-foreground">
                                  Redacted fields: {rule.redactedFields.join(', ')}
                                </div>
                              ) : null}
                            </div>
                            <div className="flex gap-2">
                              <Button
                                id={`authorization-bundle-edit-rule-${rule.ruleId}`}
                                size="sm"
                                variant="outline"
                                onClick={() => handleEditRule(section.resourceType, rule)}
                              >
                                Edit
                              </Button>
                              <Button
                                id={`authorization-bundle-delete-rule-${rule.ruleId}`}
                                size="sm"
                                variant="outline"
                                onClick={() => void handleDeleteRule(section.resourceType, rule.ruleId)}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="space-y-3 rounded-md border border-dashed p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">
                          {editingExistingRule ? 'Edit Draft Rule' : 'Add Draft Rule'}
                        </div>
                        <Button
                          id={`authorization-bundle-reset-rule-form-${section.resourceType}`}
                          size="sm"
                          variant="outline"
                          onClick={() => resetRuleDraft(section.resourceType)}
                        >
                          Reset
                        </Button>
                      </div>

                      <div className="grid gap-2 md:grid-cols-3">
                        <label className="text-sm">
                          <div className="mb-1 text-muted-foreground">Action</div>
                          <CustomSelect
                            id={`authorization-bundle-rule-action-${section.resourceType}`}
                            options={actionOptions}
                            value={draft.action}
                            onValueChange={(value) => updateRuleDraft(section.resourceType, { action: value })}
                          />
                        </label>

                        <label className="text-sm">
                          <div className="mb-1 text-muted-foreground">Template</div>
                          <CustomSelect
                            id={`authorization-bundle-rule-template-${section.resourceType}`}
                            options={templateOptions}
                            value={draft.templateKey}
                            onValueChange={(value) => updateRuleDraft(section.resourceType, { templateKey: value })}
                          />
                        </label>

                        <label className="text-sm">
                          <div className="mb-1 text-muted-foreground">Constraint (optional)</div>
                          <CustomSelect
                            id={`authorization-bundle-rule-constraint-${section.resourceType}`}
                            options={constraintOptions}
                            value={draft.constraintKey}
                            onValueChange={(value) => updateRuleDraft(section.resourceType, { constraintKey: value })}
                          />
                        </label>
                      </div>

                      {draft.templateKey === 'selected_clients' ? (
                        <div className="space-y-2 rounded-md border bg-muted/10 p-3">
                          <div className="text-sm font-medium">Selected client scopes</div>
                          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                            <CustomSelect
                              id={`authorization-bundle-rule-client-scope-${section.resourceType}`}
                              options={clientOptions}
                              value={draft.pendingClientId}
                              onValueChange={(value) => updateRuleDraft(section.resourceType, { pendingClientId: value })}
                              placeholder="Select client"
                            />
                            <Button
                              id={`authorization-bundle-add-client-scope-${section.resourceType}`}
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                if (!draft.pendingClientId) {
                                  return;
                                }
                                updateRuleDraft(section.resourceType, {
                                  selectedClientIds: [...new Set([...draft.selectedClientIds, draft.pendingClientId])],
                                  pendingClientId: '',
                                });
                              }}
                            >
                              Add Client Scope
                            </Button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {draft.selectedClientIds.length === 0 ? (
                              <span className="text-xs text-muted-foreground">No client scopes added yet.</span>
                            ) : (
                              draft.selectedClientIds.map((clientId) => (
                                <div
                                  key={clientId}
                                  className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
                                >
                                  <span>{clientNameById.get(clientId) ?? clientId}</span>
                                  <button
                                    id={`authorization-bundle-remove-client-scope-${section.resourceType}-${clientId}`}
                                    type="button"
                                    className="text-muted-foreground hover:text-foreground"
                                    onClick={() =>
                                      updateRuleDraft(section.resourceType, {
                                        selectedClientIds: draft.selectedClientIds.filter((id) => id !== clientId),
                                      })
                                    }
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      ) : null}

                      {draft.templateKey === 'selected_boards' ? (
                        <div className="space-y-2 rounded-md border bg-muted/10 p-3">
                          <div className="text-sm font-medium">Selected board scopes</div>
                          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                            <CustomSelect
                              id={`authorization-bundle-rule-board-scope-${section.resourceType}`}
                              options={boardOptions}
                              value={draft.pendingBoardId}
                              onValueChange={(value) => updateRuleDraft(section.resourceType, { pendingBoardId: value })}
                              placeholder="Select board"
                            />
                            <Button
                              id={`authorization-bundle-add-board-scope-${section.resourceType}`}
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                if (!draft.pendingBoardId) {
                                  return;
                                }
                                updateRuleDraft(section.resourceType, {
                                  selectedBoardIds: [...new Set([...draft.selectedBoardIds, draft.pendingBoardId])],
                                  pendingBoardId: '',
                                });
                              }}
                            >
                              Add Board Scope
                            </Button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {draft.selectedBoardIds.length === 0 ? (
                              <span className="text-xs text-muted-foreground">No board scopes added yet.</span>
                            ) : (
                              draft.selectedBoardIds.map((boardId) => (
                                <div
                                  key={boardId}
                                  className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
                                >
                                  <span>{boardNameById.get(boardId) ?? boardId}</span>
                                  <button
                                    id={`authorization-bundle-remove-board-scope-${section.resourceType}-${boardId}`}
                                    type="button"
                                    className="text-muted-foreground hover:text-foreground"
                                    onClick={() =>
                                      updateRuleDraft(section.resourceType, {
                                        selectedBoardIds: draft.selectedBoardIds.filter((id) => id !== boardId),
                                      })
                                    }
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      ) : null}

                      {draft.constraintKey === 'hide_sensitive_fields' ? (
                        <label className="block text-sm">
                          <div className="mb-1 text-muted-foreground">Redacted fields</div>
                          <Input
                            id={`authorization-bundle-rule-redacted-fields-${section.resourceType}`}
                            placeholder="internal_cost, margin"
                            value={draft.redactedFieldsInput}
                            onChange={(event) =>
                              updateRuleDraft(section.resourceType, {
                                redactedFieldsInput: event.target.value,
                              })
                            }
                          />
                          <div className="mt-1 text-xs text-muted-foreground">
                            Comma-separated field names to redact when this rule allows access.
                          </div>
                        </label>
                      ) : null}

                      <div className="flex justify-end">
                        <Button
                          id={`authorization-bundle-save-rule-${section.resourceType}`}
                          size="sm"
                          onClick={() => void handleSaveRule(section.resourceType)}
                        >
                          {editingExistingRule ? 'Save Draft Rule' : 'Add Draft Rule'}
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
              View and manage role, team, user, and API-key targets currently affected by this bundle.
            </p>
          </div>

          {assignmentLoading || !assignmentData ? (
            <div className="text-sm text-muted-foreground">Loading assignments...</div>
          ) : (
            <>
              <div className="space-y-3 rounded-md border border-dashed p-3">
                <div className="text-sm font-medium">Add assignment</div>
                <div className="grid gap-2 md:grid-cols-[180px_minmax(0,1fr)_auto]">
                  <CustomSelect
                    id="authorization-bundle-assignment-target-type"
                    options={assignmentTargetTypeOptions}
                    value={assignmentTargetType}
                    onValueChange={(value) => setAssignmentTargetType(value as AssignmentTargetType)}
                  />
                  <CustomSelect
                    id="authorization-bundle-assignment-target-id"
                    options={assignmentTargetOptions.map((option) => ({
                      value: option.id,
                      label: option.label,
                    }))}
                    value={assignmentTargetId}
                    onValueChange={setAssignmentTargetId}
                    placeholder={`Select ${TARGET_TYPE_LABELS[assignmentTargetType].toLowerCase()}`}
                    disabled={assignmentTargetOptions.length === 0}
                  />
                  <Button
                    id="authorization-bundle-assignment-add-button"
                    size="sm"
                    onClick={() => void handleCreateAssignment()}
                    disabled={assignmentSaving || !assignmentTargetId}
                  >
                    {assignmentSaving ? 'Adding...' : 'Add Assignment'}
                  </Button>
                </div>
              </div>

              {assignmentData.assignments.length === 0 ? (
                <div className="text-sm text-muted-foreground">No assignments for this bundle yet.</div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {ASSIGNMENT_TARGET_TYPES.map((targetType) => {
                    const rows = groupedAssignments.get(targetType) ?? [];
                    return (
                      <div key={targetType} className="space-y-2 rounded-md border p-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium">{TARGET_TYPE_LABELS[targetType]}</h4>
                          <Badge variant="outline">{rows.length}</Badge>
                        </div>
                        {rows.length === 0 ? (
                          <div className="text-sm text-muted-foreground">No {TARGET_TYPE_LABELS[targetType].toLowerCase()} assignments.</div>
                        ) : (
                          rows.map((assignment) => {
                            const nextStatus = assignment.status === 'active' ? 'disabled' : 'active';
                            return (
                              <div key={assignment.assignmentId} className="rounded border bg-muted/20 px-3 py-2 text-sm">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <div className="font-medium">{assignment.targetLabel}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {assignment.targetId}
                                    </div>
                                  </div>
                                  <Badge variant={assignment.status === 'active' ? 'default' : 'secondary'}>
                                    {assignment.status}
                                  </Badge>
                                </div>
                                <div className="mt-2 flex justify-end">
                                  <Button
                                    id={`authorization-bundle-assignment-status-${assignment.assignmentId}`}
                                    size="sm"
                                    variant="outline"
                                    disabled={assignmentStatusBusyId === assignment.assignmentId}
                                    onClick={() =>
                                      void handleSetAssignmentStatus(assignment.assignmentId, nextStatus)
                                    }
                                  >
                                    {assignmentStatusBusyId === assignment.assignmentId
                                      ? 'Saving...'
                                      : nextStatus === 'disabled'
                                        ? 'Disable'
                                        : 'Enable'}
                                  </Button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
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
              <CustomSelect
                id="authorization-bundle-simulator-resource"
                options={RESOURCE_SECTIONS.map((section) => ({ value: section.resourceType, label: section.label }))}
                value={simulatorResourceType}
                onValueChange={(value) => {
                  setSimulatorResourceType(value);
                  setSimulatorRecordId('');
                  setSimulationResult(null);
                }}
              />
            </label>

            <label className="text-sm">
              <div className="mb-1 text-muted-foreground">Action</div>
              <CustomSelect
                id="authorization-bundle-simulator-action"
                options={actionOptions}
                value={simulatorAction}
                onValueChange={setSimulatorAction}
              />
            </label>

            <label className="text-sm">
              <div className="mb-1 text-muted-foreground">Principal</div>
              <CustomSelect
                id="authorization-bundle-simulator-principal"
                options={principalOptions.map((option) => ({ value: option.id, label: option.label }))}
                value={simulatorPrincipalId}
                onValueChange={setSimulatorPrincipalId}
              />
            </label>

            <label className="text-sm">
              <div className="mb-1 text-muted-foreground">Record</div>
              <CustomSelect
                id="authorization-bundle-simulator-record"
                options={recordOptions.map((option) => ({ value: option.id, label: option.label }))}
                value={simulatorRecordId}
                onValueChange={setSimulatorRecordId}
                disabled={useSyntheticRecord}
              />
            </label>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                id="authorization-bundle-simulator-use-synthetic"
                type="checkbox"
                checked={useSyntheticRecord}
                onChange={(event) => setUseSyntheticRecord(event.target.checked)}
              />
              Use synthetic record scenario
            </label>
            {useSyntheticRecord ? (
              <div className="grid gap-2 md:grid-cols-4">
                <Input
                  id="authorization-bundle-simulator-synthetic-owner"
                  placeholder="Owner user ID (optional)"
                  value={syntheticOwnerUserId}
                  onChange={(event) => setSyntheticOwnerUserId(event.target.value)}
                />
                <Input
                  id="authorization-bundle-simulator-synthetic-client"
                  placeholder="Client ID (optional)"
                  value={syntheticClientId}
                  onChange={(event) => setSyntheticClientId(event.target.value)}
                />
                <Input
                  id="authorization-bundle-simulator-synthetic-board"
                  placeholder="Board ID (optional)"
                  value={syntheticBoardId}
                  onChange={(event) => setSyntheticBoardId(event.target.value)}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    id="authorization-bundle-simulator-synthetic-client-visible"
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
            <Button
              id="authorization-bundle-simulator-run-button"
              size="sm"
              onClick={() => void handleRunSimulation()}
              disabled={simulatorLoading}
            >
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

      <Dialog
        id="authorization-bundle-create-dialog"
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        title="Create Authorization Bundle"
        className="max-w-lg"
        footer={(
          <div className="flex justify-end gap-2">
            <Button
              id="authorization-bundle-create-cancel"
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
              disabled={creatingBundle}
            >
              Cancel
            </Button>
            <Button
              id="authorization-bundle-create-confirm"
              onClick={() => void handleCreateBundle()}
              disabled={creatingBundle}
            >
              {creatingBundle ? 'Creating...' : 'Create Bundle'}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-4">
            <label className="block text-sm">
              <div className="mb-1 text-muted-foreground">Name</div>
              <Input
                id="authorization-bundle-create-name"
                value={newBundleName}
                onChange={(event) => setNewBundleName(event.target.value)}
                placeholder="Finance Reviewer West"
              />
            </label>
            <label className="block text-sm">
              <div className="mb-1 text-muted-foreground">Description</div>
              <TextArea
                id="authorization-bundle-create-description"
                value={newBundleDescription}
                onChange={(event) => setNewBundleDescription(event.target.value)}
                placeholder="Reusable narrowing bundle for a specific team, client group, or workflow."
                rows={4}
              />
            </label>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

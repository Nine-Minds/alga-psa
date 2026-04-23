'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  FlaskConical,
  Layers3,
  type LucideIcon,
  Search,
  Shield,
  Sparkles,
  Users,
} from 'lucide-react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import CustomTabs from '@alga-psa/ui/components/CustomTabs';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Switch } from '@alga-psa/ui/components/Switch';
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
type WorkspacePanel = 'editor' | 'assignments' | 'simulator';

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

function OverviewMetricCard({
  icon: Icon,
  title,
  value,
  subtitle,
}: {
  icon: LucideIcon;
  title: string;
  value: string | number;
  subtitle: string;
}) {
  return (
    <Card className="border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-text-500))]">
              {title}
            </div>
            <div className="text-2xl font-semibold tracking-[-0.02em] text-[rgb(var(--color-text-900))]">
              {value}
            </div>
            <p className="text-xs text-[rgb(var(--color-text-500))]">{subtitle}</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgb(var(--color-primary-100))] dark:bg-[rgb(var(--color-primary-400)/0.22)]">
            <Icon className="h-5 w-5 text-[rgb(var(--color-primary-700))] dark:text-[rgb(var(--color-primary-800))]" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
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

  const archivedCount = useMemo(
    () => entries.filter((entry) => entry.status === 'archived').length,
    [entries]
  );

  const starterCount = useMemo(
    () => entries.filter((entry) => entry.isSystem).length,
    [entries]
  );

  const totalAssignments = useMemo(
    () => entries.reduce((total, entry) => total + entry.assignmentCount, 0),
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

  const selectedBundleId = editorBundleId ?? assignmentBundleId ?? simulatorBundleId;

  const selectedBundleEntry = useMemo(
    () => entries.find((entry) => entry.bundleId === selectedBundleId) ?? null,
    [entries, selectedBundleId]
  );

  const activeWorkspacePanel: WorkspacePanel | null = editorBundleId
    ? 'editor'
    : assignmentBundleId
      ? 'assignments'
      : simulatorBundleId
        ? 'simulator'
        : null;

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

  const loadEditor = useCallback(async (
    bundleId: string,
    options?: { createDraftIfMissing?: boolean }
  ) => {
    setEditorLoading(true);
    setError(null);
    try {
      const payload = await getAuthorizationBundleDraftEditorAction({
        bundleId,
        createDraftIfMissing: options?.createDraftIfMissing ?? true,
      });
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

  const workspaceTabs = useMemo(
    () => [
      { id: 'editor', label: 'Draft editor', icon: Sparkles, content: <div /> },
      { id: 'assignments', label: 'Assignments', icon: Users, content: <div /> },
      { id: 'simulator', label: 'Simulator', icon: FlaskConical, content: <div /> },
    ],
    []
  );

  const editorHasPublishableDraft = useMemo(() => {
    if (!editorData) {
      return false;
    }

    return (
      !editorData.bundle.publishedRevisionId ||
      editorData.draftRevisionId !== editorData.bundle.publishedRevisionId
    );
  }, [editorData]);

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

  const openWorkspace = useCallback((bundleId: string, panel: WorkspacePanel) => {
    setEditorBundleId(panel === 'editor' ? bundleId : null);
    setAssignmentBundleId(panel === 'assignments' ? bundleId : null);
    setSimulatorBundleId(panel === 'simulator' ? bundleId : null);
  }, []);

  const closeWorkspace = useCallback(() => {
    setEditorBundleId(null);
    setAssignmentBundleId(null);
    setSimulatorBundleId(null);
  }, []);

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
      openWorkspace(created.bundleId, 'editor');
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

    const bundleId = editorData.bundle.bundleId;
    setPublishingBundleId(bundleId);
    setError(null);
    try {
      await publishAuthorizationBundleDraftAction(bundleId);
      await fetchEntries();
      if (assignmentBundleId === bundleId) {
        await loadAssignments(bundleId);
      }
      await loadEditor(bundleId, { createDraftIfMissing: false });
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
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to remove rule.');
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
      <Card className="border-dashed border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-card))]">
        <CardHeader>
          <CardTitle>Authorization bundles</CardTitle>
          <CardDescription>
            Advanced Authorization Bundle management is available on the Premium tier. Upgrade to manage reusable narrowing bundles.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-8">
      {!selectedBundleId ? (
        <>
          <div className="overflow-hidden rounded-2xl bg-[linear-gradient(90deg,rgb(var(--color-primary-600)),rgb(var(--color-secondary-500)))] text-white shadow-[0_24px_48px_rgb(var(--color-primary-500)/0.18)]">
            <div className="flex flex-col gap-8 p-7 lg:flex-row lg:items-center lg:justify-between lg:p-8">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/15">
                  <Shield className="h-6 w-6 text-white" />
                </div>
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/90">
                    Premium workspace
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-2xl font-semibold tracking-[-0.02em] text-white">Authorization bundles</h2>
                    <p className="max-w-2xl text-sm text-white/85">
                      Manage premium access narrowing with draft revisions, scoped assignments, and safe simulation from one control center.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  id="authorization-bundle-create-button"
                  size="sm"
                  variant="outline"
                  className="border-white/25 bg-white text-[rgb(var(--color-primary-700))] hover:bg-white/90 hover:text-[rgb(var(--color-primary-700))]"
                  onClick={() => setIsCreateDialogOpen(true)}
                >
                  New bundle
                </Button>
                <Button
                  id="authorization-bundle-seed-starters-button"
                  size="sm"
                  variant="outline"
                  className="border-white/25 bg-transparent text-white hover:bg-white/10"
                  onClick={() => void handleSeedStarters()}
                  disabled={seeding}
                >
                  {seeding ? 'Adding starter bundles...' : 'Add starter bundles'}
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <OverviewMetricCard
              icon={Layers3}
              title="Active bundles"
              value={activeCount}
              subtitle="Reusable narrowing bundles currently available to assign"
            />
            <OverviewMetricCard
              icon={Users}
              title="Active assignments"
              value={totalAssignments}
              subtitle="Live role, team, user, and API key rollouts"
            />
            <OverviewMetricCard
              icon={Sparkles}
              title="Starter bundles"
              value={starterCount}
              subtitle="Bundled relationship-first presets ready to adapt"
            />
            <OverviewMetricCard
              icon={Archive}
              title="Archived bundles"
              value={archivedCount}
              subtitle="Retired bundles preserved for audit and reuse"
            />
          </div>
        </>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-[rgb(var(--color-destructive)/0.25)] bg-[rgb(var(--color-destructive)/0.08)] px-4 py-3.5 text-sm text-[rgb(var(--color-destructive))] shadow-sm">
          {error}
        </div>
      ) : null}

      {!selectedBundleId ? (
        <Card className="overflow-hidden rounded-2xl border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] shadow-sm">
        <CardHeader className="gap-5 border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] pb-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-text-500))]">
                Library
              </div>
              <CardTitle>Authorization bundle library</CardTitle>
              <CardDescription>
                Browse bundle status, manage lifecycle changes, and open a focused workspace for one bundle at a time.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-full min-w-[320px] max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgb(var(--color-text-400))]" />
                <Input
                  id="authorization-bundle-search-input"
                  className="pl-9"
                  placeholder="Search bundles by name or description"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] px-3 py-2 dark:bg-[rgb(var(--color-border-50))]">
                <Switch
                  id="authorization-bundle-toggle-archived-button"
                  checked={includeArchived}
                  onCheckedChange={setIncludeArchived}
                  label="Show archived"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
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
                  <TableCell colSpan={6} className="px-6 py-10 text-center text-sm text-muted-foreground">
                    No authorization bundles found.
                  </TableCell>
                </TableRow>
              ) : null}

              {entries.map((entry) => {
                const rowBusy = busyBundleId === entry.bundleId;
                return (
                  <TableRow key={entry.bundleId}>
                    <TableCell>
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium text-[rgb(var(--color-text-900))]">{entry.name}</div>
                          {entry.isSystem ? <Badge variant="outline">Starter</Badge> : null}
                        </div>
                        <div className="text-xs text-[rgb(var(--color-text-500))]">
                          {entry.description || (entry.isSystem
                            ? 'System starter bundle.'
                            : 'Custom narrowing bundle for role, team, user, or API key assignments.')}
                        </div>
                        <div className="text-xs text-[rgb(var(--color-text-500))]">
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
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          id={`authorization-bundle-edit-${entry.bundleId}`}
                          size="sm"
                          onClick={() => openWorkspace(entry.bundleId, 'editor')}
                        >
                          Open editor
                        </Button>
                        <Button
                          id={`authorization-bundle-assignments-${entry.bundleId}`}
                          size="sm"
                          variant="outline"
                          onClick={() => openWorkspace(entry.bundleId, 'assignments')}
                        >
                          Assignments
                        </Button>
                        <Button
                          id={`authorization-bundle-simulator-${entry.bundleId}`}
                          size="sm"
                          variant="outline"
                          onClick={() => openWorkspace(entry.bundleId, 'simulator')}
                        >
                          Simulator
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
                  <TableCell colSpan={6} className="px-6 py-10 text-center text-sm text-muted-foreground">
                    Loading authorization bundles...
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
        </Card>
      ) : null}

      {selectedBundleId ? (
        <Card className="overflow-hidden rounded-2xl border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] shadow-[0_12px_28px_rgb(var(--color-primary-500)/0.08)]">
          <CardHeader className="gap-6 border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] pb-6">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  id="authorization-bundle-close-workspace-button"
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  onClick={() => closeWorkspace()}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to library
                </Button>
                <div className="text-xs text-[rgb(var(--color-text-500))]">
                  {selectedBundleEntry ? (
                    <>Updated {formatDate(selectedBundleEntry.updatedAt)} · {selectedBundleEntry.assignmentCount} active assignment(s)</>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-text-500))]">
                    Bundle workspace
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{selectedBundleEntry?.name ?? editorData?.bundle.name ?? 'Selected bundle'}</CardTitle>
                    {selectedBundleEntry ? (
                      <Badge variant={selectedBundleEntry.status === 'active' ? 'default' : 'secondary'}>
                        {selectedBundleEntry.status}
                      </Badge>
                    ) : null}
                    {selectedBundleEntry?.isSystem ? <Badge variant="outline">Starter</Badge> : null}
                  </div>
                  <CardDescription>
                    {selectedBundleEntry?.description || 'Use the draft editor, assignment manager, and simulator to ship safe narrowing changes.'}
                  </CardDescription>
                </div>
                <div className="min-w-0 xl:min-w-[420px]">
                  <CustomTabs
                    tabs={workspaceTabs}
                    idPrefix="authorization-bundle-workspace-tabs"
                    value={activeWorkspacePanel ?? 'editor'}
                    onTabChange={(tabValue) => openWorkspace(selectedBundleId, tabValue as WorkspacePanel)}
                    tabStyles={{
                      root: 'w-full',
                      list: 'mb-0 rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-1.5 shadow-sm dark:bg-[rgb(var(--color-border-50))]',
                      trigger: 'rounded-lg border-b-0 text-[rgb(var(--color-text-600))] hover:text-[rgb(var(--color-text-900))] data-[state=active]:bg-[rgb(var(--color-card))] data-[state=active]:text-[rgb(var(--color-primary-700))] data-[state=active]:shadow-sm',
                      activeTrigger: 'data-[state=active]:border-transparent',
                      content: 'hidden',
                    }}
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-8 p-6 lg:p-8">
            {activeWorkspacePanel === 'editor' ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-5 dark:bg-[rgb(var(--color-border-50))]">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-[rgb(var(--color-text-900))]">
                      <Sparkles className="h-4 w-4 text-[rgb(var(--color-primary-600))]" />
                      Bundle editor
                    </div>
                    {editorData ? (
                      <p className="text-sm text-muted-foreground">
                        {editorHasPublishableDraft ? (
                          <>
                            Editing draft revision for <span className="font-medium text-foreground">{editorData.bundle.name}</span>.{' '}
                            Changes stay in draft until published.
                          </>
                        ) : (
                          <>
                            Viewing the published revision for <span className="font-medium text-foreground">{editorData.bundle.name}</span>.{' '}
                            No active draft revision exists right now.
                          </>
                        )}
                      </p>
                    ) : null}
                  </div>
                  {editorHasPublishableDraft ? (
                    <Button
                      id="authorization-bundle-publish-draft-button"
                      size="sm"
                      onClick={() => void handlePublishDraft()}
                      disabled={!editorData || editorLoading || publishingBundleId === editorData?.bundle.bundleId}
                    >
                      {publishingBundleId === editorData?.bundle.bundleId ? 'Publishing...' : 'Publish Draft'}
                    </Button>
                  ) : (
                    <Badge variant="outline">Published</Badge>
                  )}
                </div>

                {editorLoading || !editorData ? (
                  <div className="text-sm text-muted-foreground">Loading draft editor...</div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-5 text-sm leading-6 text-muted-foreground dark:bg-[rgb(var(--color-border-50))]">
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
                      const ruleCountLabel = `${sectionRules.length} ${editorHasPublishableDraft ? 'draft' : 'published'} rule(s)`;
                      const emptyRulesLabel = `No ${editorHasPublishableDraft ? 'draft' : 'published'} rules yet for ${section.label.toLowerCase()}.`;
                      const ruleFormTitle = editorHasPublishableDraft
                        ? editingExistingRule
                          ? 'Edit Draft Rule'
                          : 'Add Draft Rule'
                        : editingExistingRule
                          ? 'Edit Published Rule as Draft'
                          : 'Create Draft Rule';
                      const ruleFormHelper = !editorHasPublishableDraft
                        ? editingExistingRule
                          ? 'Saving will create a new draft revision with your changes to this published rule.'
                          : 'Saving will create a new draft revision for this bundle.'
                        : null;
                      const saveRuleLabel = editorHasPublishableDraft
                        ? editingExistingRule
                          ? 'Save Draft Rule'
                          : 'Add Draft Rule'
                        : editingExistingRule
                          ? 'Save as Draft Change'
                          : 'Create Draft Rule';
                      const removeRuleLabel = editorHasPublishableDraft ? 'Remove' : 'Remove as Draft Change';
                      const removeRuleTitle = editorHasPublishableDraft
                        ? 'Remove this draft rule.'
                        : 'Create a new draft revision that removes this published rule.';

                      return (
                        <Card key={section.resourceType} className="border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] shadow-sm">
                          <CardHeader className="gap-3 border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] pb-5">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <CardTitle className="text-base">{section.label}</CardTitle>
                                <CardDescription className="mt-1">{emptyRulesLabel}</CardDescription>
                              </div>
                              <Badge variant="outline">{ruleCountLabel}</Badge>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-5 p-5 lg:p-6">
                            <div className="space-y-3">
                              {sectionRules.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-[rgb(var(--color-border-300))] px-4 py-6 text-sm text-muted-foreground">
                                  {emptyRulesLabel}
                                </div>
                              ) : (
                                sectionRules.map((rule) => (
                                  <div
                                    key={rule.ruleId}
                                    className="rounded-2xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-5 dark:bg-[rgb(var(--color-border-50))]"
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                      <div className="min-w-0 flex-1 space-y-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <Badge variant="outline">{rule.action}</Badge>
                                          <Badge variant="secondary">{rule.templateKey}</Badge>
                                          {rule.constraintKey ? (
                                            <Badge variant="outline">{rule.constraintKey}</Badge>
                                          ) : null}
                                        </div>
                                        <div className="text-sm text-[rgb(var(--color-text-700))]">
                                          {summarizeRule(rule)}
                                        </div>
                                        {rule.selectedClientIds.length > 0 ? (
                                          <div className="space-y-1">
                                            <div className="text-xs font-medium text-[rgb(var(--color-text-500))]">Selected client scopes</div>
                                            <div className="flex flex-wrap gap-2">
                                              {renderNamedIds(rule.selectedClientIds, 'client').map((clientName) => (
                                                <span key={clientName} className="rounded-full border border-[rgb(var(--color-primary-200))] bg-[rgb(var(--color-primary-50))] px-3 py-1 text-xs text-[rgb(var(--color-primary-700))] dark:bg-[rgb(var(--color-primary-400)/0.18)]">
                                                  {clientName}
                                                </span>
                                              ))}
                                            </div>
                                          </div>
                                        ) : null}
                                        {rule.selectedBoardIds.length > 0 ? (
                                          <div className="space-y-1">
                                            <div className="text-xs font-medium text-[rgb(var(--color-text-500))]">Selected board scopes</div>
                                            <div className="flex flex-wrap gap-2">
                                              {renderNamedIds(rule.selectedBoardIds, 'board').map((boardName) => (
                                                <span key={boardName} className="rounded-full border border-[rgb(var(--color-primary-200))] bg-[rgb(var(--color-primary-50))] px-3 py-1 text-xs text-[rgb(var(--color-primary-700))] dark:bg-[rgb(var(--color-primary-400)/0.18)]">
                                                  {boardName}
                                                </span>
                                              ))}
                                            </div>
                                          </div>
                                        ) : null}
                                        {rule.redactedFields.length > 0 ? (
                                          <div className="space-y-1">
                                            <div className="text-xs font-medium text-[rgb(var(--color-text-500))]">Redacted fields</div>
                                            <div className="flex flex-wrap gap-2">
                                              {rule.redactedFields.map((field) => (
                                                <span key={field} className="rounded-full border border-[rgb(var(--color-accent-200))] bg-[rgb(var(--color-accent-50))] px-3 py-1 text-xs text-[rgb(var(--color-accent-700))]">
                                                  {field}
                                                </span>
                                              ))}
                                            </div>
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
                                          title={removeRuleTitle}
                                          onClick={() => void handleDeleteRule(section.resourceType, rule.ruleId)}
                                        >
                                          {removeRuleLabel}
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>

                            <div className="space-y-5 rounded-2xl border border-dashed border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-card))] p-5">
                              <div className="flex items-center justify-between gap-2">
                                <div className="space-y-1">
                                  <div className="text-sm font-medium text-[rgb(var(--color-text-900))]">{ruleFormTitle}</div>
                                  {ruleFormHelper ? (
                                    <div className="text-xs text-muted-foreground">{ruleFormHelper}</div>
                                  ) : null}
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

                              <div className="grid gap-3 md:grid-cols-3">
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
                                <div className="space-y-3 rounded-2xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-5 dark:bg-[rgb(var(--color-border-50))]">
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
                                      Add client scope
                                    </Button>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {draft.selectedClientIds.length === 0 ? (
                                      <span className="text-xs text-muted-foreground">No client scopes added yet.</span>
                                    ) : (
                                      draft.selectedClientIds.map((clientId) => (
                                        <div
                                          key={clientId}
                                          className="flex items-center gap-2 rounded-full border border-[rgb(var(--color-primary-200))] bg-[rgb(var(--color-primary-50))] px-3 py-1 text-xs text-[rgb(var(--color-primary-700))] dark:bg-[rgb(var(--color-primary-400)/0.18)]"
                                        >
                                          <span>{clientNameById.get(clientId) ?? clientId}</span>
                                          <button
                                            id={`authorization-bundle-remove-client-scope-${section.resourceType}-${clientId}`}
                                            type="button"
                                            className="text-[rgb(var(--color-primary-700))] hover:text-[rgb(var(--color-primary-900))]"
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
                                <div className="space-y-3 rounded-2xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-5 dark:bg-[rgb(var(--color-border-50))]">
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
                                      Add board scope
                                    </Button>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {draft.selectedBoardIds.length === 0 ? (
                                      <span className="text-xs text-muted-foreground">No board scopes added yet.</span>
                                    ) : (
                                      draft.selectedBoardIds.map((boardId) => (
                                        <div
                                          key={boardId}
                                          className="flex items-center gap-2 rounded-full border border-[rgb(var(--color-primary-200))] bg-[rgb(var(--color-primary-50))] px-3 py-1 text-xs text-[rgb(var(--color-primary-700))] dark:bg-[rgb(var(--color-primary-400)/0.18)]"
                                        >
                                          <span>{boardNameById.get(boardId) ?? boardId}</span>
                                          <button
                                            id={`authorization-bundle-remove-board-scope-${section.resourceType}-${boardId}`}
                                            type="button"
                                            className="text-[rgb(var(--color-primary-700))] hover:text-[rgb(var(--color-primary-900))]"
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
                                  {saveRuleLabel}
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}

            {activeWorkspacePanel === 'assignments' ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-[rgb(var(--color-text-900))]">
                  <Users className="h-4 w-4 text-[rgb(var(--color-primary-600))]" />
                  Assignment manager
                </div>
                <p className="text-sm text-muted-foreground">
                  View and manage role, team, user, and API-key targets currently affected by this bundle.
                </p>

                {assignmentLoading || !assignmentData ? (
                  <div className="text-sm text-muted-foreground">Loading assignments...</div>
                ) : (
                  <>
                    <div className="rounded-2xl border border-dashed border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-card))] p-5">
                      <div className="mb-3 text-sm font-medium text-[rgb(var(--color-text-900))]">Add assignment</div>
                      <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto]">
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
                      <div className="rounded-xl border border-dashed border-[rgb(var(--color-border-300))] px-4 py-6 text-sm text-muted-foreground">
                        No assignments for this bundle yet.
                      </div>
                    ) : (
                      <div className="grid gap-4 lg:grid-cols-2">
                        {ASSIGNMENT_TARGET_TYPES.map((targetType) => {
                          const rows = groupedAssignments.get(targetType) ?? [];
                          return (
                            <Card key={targetType} className="border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]">
                              <CardHeader className="gap-2 border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] pb-5">
                                <div className="flex items-center justify-between gap-2">
                                  <CardTitle className="text-base">{TARGET_TYPE_LABELS[targetType]}</CardTitle>
                                  <Badge variant="outline">{rows.length}</Badge>
                                </div>
                              </CardHeader>
                              <CardContent className="space-y-3 p-4">
                                {rows.length === 0 ? (
                                  <div className="text-sm text-muted-foreground">No {TARGET_TYPE_LABELS[targetType].toLowerCase()} assignments.</div>
                                ) : (
                                  rows.map((assignment) => {
                                    const nextStatus = assignment.status === 'active' ? 'disabled' : 'active';
                                    return (
                                      <div key={assignment.assignmentId} className="rounded-2xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-5 dark:bg-[rgb(var(--color-border-50))]">
                                        <div className="flex items-start justify-between gap-3">
                                          <div className="space-y-1">
                                            <div className="font-medium text-[rgb(var(--color-text-900))]">{assignment.targetLabel}</div>
                                            <div className="text-xs text-muted-foreground">{assignment.targetId}</div>
                                          </div>
                                          <Badge variant={assignment.status === 'active' ? 'default' : 'secondary'}>
                                            {assignment.status}
                                          </Badge>
                                        </div>
                                        <div className="mt-3 flex justify-end">
                                          <Button
                                            id={`authorization-bundle-assignment-status-${assignment.assignmentId}`}
                                            size="sm"
                                            variant="outline"
                                            disabled={assignmentStatusBusyId === assignment.assignmentId}
                                            onClick={() => void handleSetAssignmentStatus(assignment.assignmentId, nextStatus)}
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
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : null}

            {activeWorkspacePanel === 'simulator' ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-[rgb(var(--color-text-900))]">
                  <FlaskConical className="h-4 w-4 text-[rgb(var(--color-primary-600))]" />
                  Access simulator
                </div>
                <p className="text-sm text-muted-foreground">
                  Simulate draft vs published bundle behavior against a real principal and existing record.
                </p>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-5 rounded-2xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-5 lg:p-6">
                    <div className="text-sm font-medium text-[rgb(var(--color-text-900))]">Simulation input</div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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

                    <div className="space-y-4 rounded-2xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-5 dark:bg-[rgb(var(--color-border-50))]">
                      <Switch
                        id="authorization-bundle-simulator-use-synthetic"
                        checked={useSyntheticRecord}
                        onCheckedChange={setUseSyntheticRecord}
                        label="Use synthetic record scenario"
                      />
                      {useSyntheticRecord ? (
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
                          <Switch
                            id="authorization-bundle-simulator-synthetic-client-visible"
                            checked={syntheticClientVisible}
                            onCheckedChange={setSyntheticClientVisible}
                            label="Client visible"
                          />
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
                        {simulatorLoading ? 'Running simulation...' : 'Run simulation'}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-5 rounded-2xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-5 lg:p-6">
                    <div className="text-sm font-medium text-[rgb(var(--color-text-900))]">Simulation result</div>
                    {simulationResult ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-4 rounded-2xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-5 dark:bg-[rgb(var(--color-border-50))]">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="font-medium text-[rgb(var(--color-text-900))]">Draft revision</h4>
                            <Badge variant={simulationResult.draft.allowed ? 'default' : 'error'}>
                              {simulationResult.draft.allowed ? 'Allowed' : 'Denied'}
                            </Badge>
                          </div>
                          <div className="space-y-1 text-xs text-muted-foreground">
                            {simulationResult.draft.reasonCodes.map((code) => (
                              <div key={code}>{code}</div>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-4 rounded-2xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-5 dark:bg-[rgb(var(--color-border-50))]">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="font-medium text-[rgb(var(--color-text-900))]">Published revision</h4>
                            <Badge variant={simulationResult.published.allowed ? 'default' : 'error'}>
                              {simulationResult.published.allowed ? 'Allowed' : 'Denied'}
                            </Badge>
                          </div>
                          <div className="space-y-1 text-xs text-muted-foreground">
                            {simulationResult.published.reasonCodes.map((code) => (
                              <div key={code}>{code}</div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-[rgb(var(--color-border-300))] px-4 py-8 text-sm text-muted-foreground">
                        Run a simulation to compare draft and published behavior.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
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

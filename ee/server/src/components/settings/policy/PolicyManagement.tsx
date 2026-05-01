'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  FlaskConical,
  Layers3,
  type LucideIcon,
  MoreVertical,
  Search,
  Shield,
  Sparkles,
  Users,
} from 'lucide-react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import ViewSwitcher, { type ViewSwitcherOption } from '@alga-psa/ui/components/ViewSwitcher';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Switch } from '@alga-psa/ui/components/Switch';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import UserAndTeamPicker from '@alga-psa/ui/components/UserAndTeamPicker';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@alga-psa/ui/components/DropdownMenu';
import { TIER_FEATURES, type ColumnDefinition, type IUserWithRoles, type ITeam } from '@alga-psa/types';
import { getAllUsers, getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { getTeams, getTeamAvatarUrlsBatchAction } from '@alga-psa/teams/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
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

const RESOURCE_SECTIONS: Array<{ labelKey: string; resourceType: string }> = [
  { labelKey: 'policyManagement.resourceSections.tickets', resourceType: 'ticket' },
  { labelKey: 'policyManagement.resourceSections.documents', resourceType: 'document' },
  { labelKey: 'policyManagement.resourceSections.time', resourceType: 'time_entry' },
  { labelKey: 'policyManagement.resourceSections.projects', resourceType: 'project' },
  { labelKey: 'policyManagement.resourceSections.assets', resourceType: 'asset' },
  { labelKey: 'policyManagement.resourceSections.billing', resourceType: 'billing' },
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

const TEMPLATE_SUMMARY_KEYS: Record<string, string> = {
  own: 'policyManagement.templateSummaries.own',
  assigned: 'policyManagement.templateSummaries.assigned',
  managed: 'policyManagement.templateSummaries.managed',
  own_or_assigned: 'policyManagement.templateSummaries.ownOrAssigned',
  own_or_managed: 'policyManagement.templateSummaries.ownOrManaged',
  same_client: 'policyManagement.templateSummaries.sameClient',
  client_portfolio: 'policyManagement.templateSummaries.clientPortfolio',
  selected_clients: 'policyManagement.templateSummaries.selectedClients',
  same_team: 'policyManagement.templateSummaries.sameTeam',
  selected_boards: 'policyManagement.templateSummaries.selectedBoards',
};

const CONSTRAINT_SUMMARY_KEYS: Record<string, string> = {
  not_self_approver: 'policyManagement.constraintSummaries.notSelfApprover',
  client_visible_only: 'policyManagement.constraintSummaries.clientVisibleOnly',
  hide_sensitive_fields: 'policyManagement.constraintSummaries.hideSensitiveFields',
};

const TARGET_TYPE_LABEL_KEYS: Record<AssignmentTargetType, string> = {
  role: 'policyManagement.targetTypes.role',
  team: 'policyManagement.targetTypes.team',
  user: 'policyManagement.targetTypes.user',
  api_key: 'policyManagement.targetTypes.apiKey',
};

function parseDelimitedList(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

function formatDelimitedList(values: string[]): string {
  return values.join(', ');
}

function makeFormatDate(t: (key: string) => string) {
  return function formatDate(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return t('policyManagement.dates.unknown');
    }
    return parsed.toLocaleString();
  };
}

function makeSummarizeRule(t: (key: string, opts?: Record<string, unknown>) => string) {
  return function summarizeRule(rule: {
    resourceType: string;
    action: string;
    templateKey: string;
    constraintKey: string | null;
  }): string {
    const scopeKey = TEMPLATE_SUMMARY_KEYS[rule.templateKey];
    const scope = scopeKey ? t(scopeKey) : rule.templateKey;
    if (!rule.constraintKey) {
      return t('policyManagement.ruleSummary.base', {
        resourceType: rule.resourceType,
        action: rule.action,
        scope,
      });
    }
    const constraintKey = CONSTRAINT_SUMMARY_KEYS[rule.constraintKey];
    const constraint = constraintKey ? t(constraintKey) : rule.constraintKey;
    return t('policyManagement.ruleSummary.withConstraint', {
      resourceType: rule.resourceType,
      action: rule.action,
      scope,
      constraint,
    });
  };
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
      <CardContent className="px-5 pb-5 pt-7">
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
  const { t } = useTranslation('msp/admin');
  const formatDate = useMemo(() => makeFormatDate(t), [t]);
  const summarizeRule = useMemo(() => makeSummarizeRule(t), [t]);
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
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [allUsers, setAllUsers] = useState<IUserWithRoles[]>([]);
  const [allTeams, setAllTeams] = useState<ITeam[]>([]);
  const [pickerDataLoaded, setPickerDataLoaded] = useState(false);

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [search, includeArchived]);

  useEffect(() => {
    const needsPickerData = Boolean(assignmentBundleId || simulatorBundleId);
    if (!needsPickerData || pickerDataLoaded) {
      return;
    }
    let cancelled = false;
    void Promise.all([getAllUsers(), getTeams()])
      .then(([users, teams]) => {
        if (cancelled) return;
        setAllUsers(users);
        setAllTeams(teams);
        setPickerDataLoaded(true);
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.error('Failed to load assignment picker data', loadError);
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentBundleId, simulatorBundleId, pickerDataLoaded]);

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
      setError(fetchError instanceof Error ? fetchError.message : t('policyManagement.errors.loadBundles'));
    } finally {
      setLoading(false);
    }
  }, [hasBundleLibrary, search, includeArchived, t]);

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
      setError(editorError instanceof Error ? editorError.message : t('policyManagement.errors.loadEditor'));
      setEditorData(null);
    } finally {
      setEditorLoading(false);
    }
  }, [t]);

  const loadAssignments = useCallback(async (bundleId: string) => {
    setAssignmentLoading(true);
    setError(null);
    try {
      const payload = await listAuthorizationBundleAssignmentsAction(bundleId);
      setAssignmentData(payload);
    } catch (assignmentError) {
      setError(assignmentError instanceof Error ? assignmentError.message : t('policyManagement.errors.loadAssignments'));
      setAssignmentData(null);
    } finally {
      setAssignmentLoading(false);
    }
  }, [t]);

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
        label: t(TARGET_TYPE_LABEL_KEYS[targetType]),
      })),
    [t]
  );

  const workspaceViewOptions = useMemo<ViewSwitcherOption<WorkspacePanel>[]>(
    () => [
      { value: 'editor', label: t('policyManagement.workspace.tabs.editor'), icon: Sparkles, id: 'authorization-bundle-workspace-tab-editor' },
      { value: 'assignments', label: t('policyManagement.workspace.tabs.assignments'), icon: Users, id: 'authorization-bundle-workspace-tab-assignments' },
      { value: 'simulator', label: t('policyManagement.workspace.tabs.simulator'), icon: FlaskConical, id: 'authorization-bundle-workspace-tab-simulator' },
    ],
    [t]
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
    const clonedName = t('policyManagement.clone.copySuffix', { name: entry.name });
    setBusyBundleId(entry.bundleId);
    setError(null);
    try {
      await cloneAuthorizationBundleAction({
        sourceBundleId: entry.bundleId,
        name: clonedName,
      });
      await fetchEntries();
    } catch (cloneError) {
      setError(cloneError instanceof Error ? cloneError.message : t('policyManagement.errors.cloneBundle'));
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
      setError(archiveError instanceof Error ? archiveError.message : t('policyManagement.errors.archiveBundle'));
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
      setError(seedError instanceof Error ? seedError.message : t('policyManagement.errors.seedStarters'));
    } finally {
      setSeeding(false);
    }
  };

  const handleCreateBundle = async (): Promise<void> => {
    const trimmedName = newBundleName.trim();
    if (!trimmedName) {
      setError(t('policyManagement.errors.bundleNameRequired'));
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
      setError(createError instanceof Error ? createError.message : t('policyManagement.errors.createBundle'));
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
      setError(publishError instanceof Error ? publishError.message : t('policyManagement.errors.publishDraft'));
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
      setError(t('policyManagement.errors.selectTemplate'));
      return;
    }

    if (draft.templateKey === 'selected_clients' && draft.selectedClientIds.length === 0) {
      setError(t('policyManagement.errors.selectClientRequired'));
      return;
    }

    if (draft.templateKey === 'selected_boards' && draft.selectedBoardIds.length === 0) {
      setError(t('policyManagement.errors.selectBoardRequired'));
      return;
    }

    if (
      draft.constraintKey === 'hide_sensitive_fields' &&
      parseDelimitedList(draft.redactedFieldsInput).length === 0
    ) {
      setError(t('policyManagement.errors.redactedFieldRequired'));
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
      setError(ruleError instanceof Error ? ruleError.message : t('policyManagement.errors.saveRule'));
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
      setError(deleteError instanceof Error ? deleteError.message : t('policyManagement.errors.removeRule'));
    }
  };

  const handleCreateAssignment = async (): Promise<void> => {
    if (!assignmentBundleId || !assignmentTargetId) {
      setError(t('policyManagement.errors.selectTarget'));
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
      setError(assignmentError instanceof Error ? assignmentError.message : t('policyManagement.errors.addAssignment'));
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
      setError(statusError instanceof Error ? statusError.message : t('policyManagement.errors.updateAssignmentStatus'));
    } finally {
      setAssignmentStatusBusyId(null);
    }
  };

  const handleRunSimulation = async (): Promise<void> => {
    if (!simulatorBundleId || !simulatorPrincipalId) {
      setError(t('policyManagement.errors.selectPrincipal'));
      return;
    }

    if (!useSyntheticRecord && !simulatorRecordId) {
      setError(t('policyManagement.errors.selectRecord'));
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
      if (result.ok === false) {
        // Map the server-provided error code to a translated message; fall
        // back to the server's English message for any unknown codes.
        const simulatorErrorKey: Record<string, string> = {
          unsupported_simulation_action: 'policyManagement.errors.simulator.unsupportedAction',
          unsupported_simulation_resource_type: 'policyManagement.errors.simulator.unsupportedResource',
          unsupported_ticket_client_principal_simulation:
            'policyManagement.errors.simulator.clientTicketNotSupported',
        };
        const translationKey = simulatorErrorKey[result.error.code];
        setError(translationKey ? t(translationKey) : result.error.message);
        return;
      }
      setSimulationResult(result.data);
    } catch (simulationError) {
      setError(simulationError instanceof Error ? simulationError.message : t('policyManagement.errors.runSimulation'));
    } finally {
      setSimulatorLoading(false);
    }
  };

  const renderNamedIds = (ids: string[], type: 'client' | 'board') => {
    const nameById = type === 'client' ? clientNameById : boardNameById;
    return ids.map((id) => nameById.get(id) ?? id);
  };

  const policyColumns: ColumnDefinition<AuthorizationBundleLibraryEntry>[] = [
    {
      title: t('policyManagement.library.columns.bundle'),
      dataIndex: 'name',
      width: '36%',
      render: (_, entry) => {
        const statusLabel = entry.status === 'active'
          ? t('policyManagement.library.statusLabels.active')
          : t('policyManagement.library.statusLabels.archived');
        return (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-medium text-[rgb(var(--color-text-900))]">{entry.name}</div>
              {entry.isSystem ? <Badge variant="outline">{t('policyManagement.library.badges.starter')}</Badge> : null}
            </div>
            <div className="text-xs text-[rgb(var(--color-text-500))]">
              {entry.description || (entry.isSystem
                ? t('policyManagement.library.descriptions.systemStarter')
                : t('policyManagement.library.descriptions.customBundle'))}
            </div>
            <div className="text-xs text-[rgb(var(--color-text-500))]">
              {t('policyManagement.library.effectiveSummary', { status: statusLabel, count: entry.assignmentCount })}
            </div>
          </div>
        );
      },
    },
    {
      title: t('policyManagement.library.columns.status'),
      dataIndex: 'status',
      width: '12%',
      render: (_, entry) => {
        const statusLabel = entry.status === 'active'
          ? t('policyManagement.library.statusLabels.active')
          : t('policyManagement.library.statusLabels.archived');
        return (
          <Badge variant={entry.status === 'active' ? 'default' : 'secondary'}>
            {statusLabel}
          </Badge>
        );
      },
    },
    {
      title: t('policyManagement.library.columns.type'),
      dataIndex: 'isSystem',
      width: '12%',
      render: (_, entry) => (
        entry.isSystem
          ? t('policyManagement.library.typeLabels.system')
          : t('policyManagement.library.typeLabels.custom')
      ),
    },
    {
      title: t('policyManagement.library.columns.assignments'),
      dataIndex: 'assignmentCount',
      width: '12%',
    },
    {
      title: t('policyManagement.library.columns.updated'),
      dataIndex: 'updatedAt',
      width: '20%',
      render: (value) => formatDate(value as string),
    },
    {
      title: t('policyManagement.library.columns.actions'),
      dataIndex: 'bundleId',
      width: '8%',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      sortable: false,
      render: (_, entry) => {
        const rowBusy = busyBundleId === entry.bundleId;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id={`authorization-bundle-actions-${entry.bundleId}`}
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="sr-only">
                  {t('policyManagement.library.actions.openMenu', { defaultValue: 'Open menu' })}
                </span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                id={`authorization-bundle-edit-${entry.bundleId}`}
                onClick={(event) => {
                  event.stopPropagation();
                  openWorkspace(entry.bundleId, 'editor');
                }}
              >
                {t('policyManagement.library.actions.openEditor')}
              </DropdownMenuItem>
              <DropdownMenuItem
                id={`authorization-bundle-assignments-${entry.bundleId}`}
                onClick={(event) => {
                  event.stopPropagation();
                  openWorkspace(entry.bundleId, 'assignments');
                }}
              >
                {t('policyManagement.library.actions.assignments')}
              </DropdownMenuItem>
              <DropdownMenuItem
                id={`authorization-bundle-simulator-${entry.bundleId}`}
                onClick={(event) => {
                  event.stopPropagation();
                  openWorkspace(entry.bundleId, 'simulator');
                }}
              >
                {t('policyManagement.library.actions.simulator')}
              </DropdownMenuItem>
              <DropdownMenuItem
                id={`authorization-bundle-clone-${entry.bundleId}`}
                disabled={rowBusy}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleClone(entry);
                }}
              >
                {t('policyManagement.library.actions.clone')}
              </DropdownMenuItem>
              {entry.status === 'active' ? (
                <DropdownMenuItem
                  id={`authorization-bundle-archive-${entry.bundleId}`}
                  className="text-destructive focus:text-destructive"
                  disabled={rowBusy}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleArchive(entry);
                  }}
                >
                  {t('policyManagement.library.actions.archive')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  if (!hasBundleLibrary) {
    return (
      <Card className="border-dashed border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-card))]">
        <CardHeader>
          <CardTitle>{t('policyManagement.upsell.title')}</CardTitle>
          <CardDescription>
            {t('policyManagement.upsell.description')}
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
                    {t('policyManagement.hero.badge')}
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-2xl font-semibold tracking-[-0.02em] text-white">{t('policyManagement.hero.title')}</h2>
                    <p className="max-w-2xl text-sm text-white/85">
                      {t('policyManagement.hero.subtitle')}
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
                  {t('policyManagement.hero.newBundle')}
                </Button>
                <Button
                  id="authorization-bundle-seed-starters-button"
                  size="sm"
                  variant="outline"
                  className="border-white/25 bg-transparent text-white hover:bg-white/10"
                  onClick={() => void handleSeedStarters()}
                  disabled={seeding}
                >
                  {seeding ? t('policyManagement.hero.addingStarters') : t('policyManagement.hero.addStarters')}
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <OverviewMetricCard
              icon={Layers3}
              title={t('policyManagement.metrics.activeBundles.title')}
              value={activeCount}
              subtitle={t('policyManagement.metrics.activeBundles.subtitle')}
            />
            <OverviewMetricCard
              icon={Users}
              title={t('policyManagement.metrics.activeAssignments.title')}
              value={totalAssignments}
              subtitle={t('policyManagement.metrics.activeAssignments.subtitle')}
            />
            <OverviewMetricCard
              icon={Sparkles}
              title={t('policyManagement.metrics.starterBundles.title')}
              value={starterCount}
              subtitle={t('policyManagement.metrics.starterBundles.subtitle')}
            />
            <OverviewMetricCard
              icon={Archive}
              title={t('policyManagement.metrics.archivedBundles.title')}
              value={archivedCount}
              subtitle={t('policyManagement.metrics.archivedBundles.subtitle')}
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
        <CardHeader className="gap-5 bg-[rgb(var(--color-card))] pb-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-text-500))]">
                {t('policyManagement.library.eyebrow')}
              </div>
              <CardTitle>{t('policyManagement.library.title')}</CardTitle>
              <CardDescription>
                {t('policyManagement.library.description')}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-full min-w-[320px] max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgb(var(--color-text-400))]" />
                <Input
                  id="authorization-bundle-search-input"
                  className="pl-9"
                  placeholder={t('policyManagement.library.searchPlaceholder')}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
                <Switch
                  id="authorization-bundle-toggle-archived-button"
                  checked={includeArchived}
                  onCheckedChange={setIncludeArchived}
                  label={t('policyManagement.library.showArchived')}
                />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading && entries.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              {t('policyManagement.library.loading')}
            </div>
          ) : entries.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              {t('policyManagement.library.empty')}
            </div>
          ) : (
            <DataTable
              id="authorization-bundles-table"
              data={entries}
              columns={policyColumns}
              pagination={true}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              pageSize={pageSize}
              onItemsPerPageChange={handlePageSizeChange}
              onRowClick={(entry) => openWorkspace(entry.bundleId, 'editor')}
            />
          )}
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
                  {t('policyManagement.workspace.backToLibrary')}
                </Button>
                <div className="text-xs text-[rgb(var(--color-text-500))]">
                  {selectedBundleEntry ? (
                    <>{t('policyManagement.workspace.updatedWithAssignments', { date: formatDate(selectedBundleEntry.updatedAt), count: selectedBundleEntry.assignmentCount })}</>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-text-500))]">
                    {t('policyManagement.workspace.eyebrow')}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{selectedBundleEntry?.name ?? editorData?.bundle.name ?? t('policyManagement.workspace.fallbackBundleName')}</CardTitle>
                    {selectedBundleEntry ? (
                      <Badge variant={selectedBundleEntry.status === 'active' ? 'default' : 'secondary'}>
                        {selectedBundleEntry.status === 'active'
                          ? t('policyManagement.library.statusLabels.active')
                          : t('policyManagement.library.statusLabels.archived')}
                      </Badge>
                    ) : null}
                    {selectedBundleEntry?.isSystem ? <Badge variant="outline">{t('policyManagement.library.badges.starter')}</Badge> : null}
                  </div>
                  <CardDescription>
                    {selectedBundleEntry?.description || t('policyManagement.workspace.fallbackDescription')}
                  </CardDescription>
                </div>
                <ViewSwitcher
                  currentView={activeWorkspacePanel ?? 'editor'}
                  options={workspaceViewOptions}
                  onChange={(view) => openWorkspace(selectedBundleId, view)}
                  aria-label={t('policyManagement.workspace.eyebrow')}
                />
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
                      {t('policyManagement.editor.header')}
                    </div>
                    {editorData ? (
                      <p className="text-sm text-muted-foreground">
                        {editorHasPublishableDraft ? (
                          <>
                            {t('policyManagement.editor.editingDraftPrefix')}<span className="font-medium text-foreground">{editorData.bundle.name}</span>{t('policyManagement.editor.editingDraftSuffix')}
                          </>
                        ) : (
                          <>
                            {t('policyManagement.editor.viewingPublishedPrefix')}<span className="font-medium text-foreground">{editorData.bundle.name}</span>{t('policyManagement.editor.viewingPublishedSuffix')}
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
                      {publishingBundleId === editorData?.bundle.bundleId ? t('policyManagement.editor.publishing') : t('policyManagement.editor.publishDraft')}
                    </Button>
                  ) : (
                    <Badge variant="outline">{t('policyManagement.editor.publishedBadge')}</Badge>
                  )}
                </div>

                {editorLoading || !editorData ? (
                  <div className="text-sm text-muted-foreground">{t('policyManagement.editor.loading')}</div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-5 text-sm leading-6 text-muted-foreground dark:bg-[rgb(var(--color-border-50))]">
                      {t('policyManagement.editor.revisionSummary', { summary: editorData.revisionChangeSummary })}
                    </div>

                    {RESOURCE_SECTIONS.map((section) => {
                      const sectionLabel = t(section.labelKey);
                      const sectionRules = editorData.rules.filter(
                        (rule) => rule.resourceType === section.resourceType
                      );
                      const draft = ruleDrafts[section.resourceType] ?? buildEmptyRuleDraft(editorData);
                      const constraintOptions: SelectOption[] = [
                        { value: '', label: t('policyManagement.editor.ruleForm.constraintNone') },
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
                      const revisionTypeLabel = editorHasPublishableDraft
                        ? t('policyManagement.editor.revisionType.draft')
                        : t('policyManagement.editor.revisionType.published');
                      const ruleCountLabel = t('policyManagement.editor.ruleCount', { count: sectionRules.length, revisionType: revisionTypeLabel });
                      const emptyRulesLabel = t('policyManagement.editor.emptyRules', { revisionType: revisionTypeLabel, resource: sectionLabel.toLowerCase() });
                      const ruleFormTitle = editorHasPublishableDraft
                        ? editingExistingRule
                          ? t('policyManagement.editor.ruleForm.editDraftTitle')
                          : t('policyManagement.editor.ruleForm.addDraftTitle')
                        : editingExistingRule
                          ? t('policyManagement.editor.ruleForm.editPublishedTitle')
                          : t('policyManagement.editor.ruleForm.createDraftTitle');
                      const ruleFormHelper = !editorHasPublishableDraft
                        ? editingExistingRule
                          ? t('policyManagement.editor.ruleForm.helperEditPublished')
                          : t('policyManagement.editor.ruleForm.helperCreateDraft')
                        : null;
                      const saveRuleLabel = editorHasPublishableDraft
                        ? editingExistingRule
                          ? t('policyManagement.editor.ruleForm.saveDraftRule')
                          : t('policyManagement.editor.ruleForm.addDraftRule')
                        : editingExistingRule
                          ? t('policyManagement.editor.ruleForm.saveAsDraftChange')
                          : t('policyManagement.editor.ruleForm.createDraftRule');
                      const removeRuleLabel = editorHasPublishableDraft
                        ? t('policyManagement.editor.rule.remove')
                        : t('policyManagement.editor.rule.removeAsDraft');
                      const removeRuleTitle = editorHasPublishableDraft
                        ? t('policyManagement.editor.rule.removeDraftTooltip')
                        : t('policyManagement.editor.rule.removePublishedTooltip');

                      return (
                        <Card key={section.resourceType} className="border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] shadow-sm">
                          <CardHeader className="gap-3 border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] pb-5">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <CardTitle className="text-base">{sectionLabel}</CardTitle>
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
                                            <div className="text-xs font-medium text-[rgb(var(--color-text-500))]">{t('policyManagement.editor.rule.selectedClientScopes')}</div>
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
                                            <div className="text-xs font-medium text-[rgb(var(--color-text-500))]">{t('policyManagement.editor.rule.selectedBoardScopes')}</div>
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
                                            <div className="text-xs font-medium text-[rgb(var(--color-text-500))]">{t('policyManagement.editor.rule.redactedFields')}</div>
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
                                          {t('policyManagement.editor.rule.edit')}
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
                                  {t('policyManagement.editor.ruleForm.reset')}
                                </Button>
                              </div>

                              <div className="grid gap-3 md:grid-cols-3">
                                <label className="text-sm">
                                  <div className="mb-1 text-muted-foreground">{t('policyManagement.editor.ruleForm.action')}</div>
                                  <CustomSelect
                                    id={`authorization-bundle-rule-action-${section.resourceType}`}
                                    options={actionOptions}
                                    value={draft.action}
                                    onValueChange={(value) => updateRuleDraft(section.resourceType, { action: value })}
                                  />
                                </label>

                                <label className="text-sm">
                                  <div className="mb-1 text-muted-foreground">{t('policyManagement.editor.ruleForm.template')}</div>
                                  <CustomSelect
                                    id={`authorization-bundle-rule-template-${section.resourceType}`}
                                    options={templateOptions}
                                    value={draft.templateKey}
                                    onValueChange={(value) => updateRuleDraft(section.resourceType, { templateKey: value })}
                                  />
                                </label>

                                <label className="text-sm">
                                  <div className="mb-1 text-muted-foreground">{t('policyManagement.editor.ruleForm.constraint')}</div>
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
                                  <div className="text-sm font-medium">{t('policyManagement.editor.scopes.clientTitle')}</div>
                                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                                    <CustomSelect
                                      id={`authorization-bundle-rule-client-scope-${section.resourceType}`}
                                      options={clientOptions}
                                      value={draft.pendingClientId}
                                      onValueChange={(value) => updateRuleDraft(section.resourceType, { pendingClientId: value })}
                                      placeholder={t('policyManagement.editor.scopes.selectClient')}
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
                                      {t('policyManagement.editor.scopes.addClientScope')}
                                    </Button>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {draft.selectedClientIds.length === 0 ? (
                                      <span className="text-xs text-muted-foreground">{t('policyManagement.editor.scopes.noClientScopes')}</span>
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
                                            {t('policyManagement.editor.scopes.remove')}
                                          </button>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>
                              ) : null}

                              {draft.templateKey === 'selected_boards' ? (
                                <div className="space-y-3 rounded-2xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-5 dark:bg-[rgb(var(--color-border-50))]">
                                  <div className="text-sm font-medium">{t('policyManagement.editor.scopes.boardTitle')}</div>
                                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                                    <CustomSelect
                                      id={`authorization-bundle-rule-board-scope-${section.resourceType}`}
                                      options={boardOptions}
                                      value={draft.pendingBoardId}
                                      onValueChange={(value) => updateRuleDraft(section.resourceType, { pendingBoardId: value })}
                                      placeholder={t('policyManagement.editor.scopes.selectBoard')}
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
                                      {t('policyManagement.editor.scopes.addBoardScope')}
                                    </Button>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {draft.selectedBoardIds.length === 0 ? (
                                      <span className="text-xs text-muted-foreground">{t('policyManagement.editor.scopes.noBoardScopes')}</span>
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
                                            {t('policyManagement.editor.scopes.remove')}
                                          </button>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>
                              ) : null}

                              {draft.constraintKey === 'hide_sensitive_fields' ? (
                                <label className="block text-sm">
                                  <div className="mb-1 text-muted-foreground">{t('policyManagement.editor.redaction.label')}</div>
                                  <Input
                                    id={`authorization-bundle-rule-redacted-fields-${section.resourceType}`}
                                    placeholder={t('policyManagement.editor.redaction.placeholder')}
                                    value={draft.redactedFieldsInput}
                                    onChange={(event) =>
                                      updateRuleDraft(section.resourceType, {
                                        redactedFieldsInput: event.target.value,
                                      })
                                    }
                                  />
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {t('policyManagement.editor.redaction.helper')}
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
                  {t('policyManagement.assignments.header')}
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('policyManagement.assignments.description')}
                </p>

                {assignmentLoading || !assignmentData ? (
                  <div className="text-sm text-muted-foreground">{t('policyManagement.assignments.loading')}</div>
                ) : (
                  <>
                    <div className="rounded-2xl border border-dashed border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-card))] p-5">
                      <div className="mb-3 text-sm font-medium text-[rgb(var(--color-text-900))]">{t('policyManagement.assignments.addAssignment')}</div>
                      <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto]">
                        <CustomSelect
                          id="authorization-bundle-assignment-target-type"
                          options={assignmentTargetTypeOptions}
                          value={assignmentTargetType}
                          onValueChange={(value) => setAssignmentTargetType(value as AssignmentTargetType)}
                        />
                        {assignmentTargetType === 'user' ? (
                          <UserPicker
                            id="authorization-bundle-assignment-target-id"
                            value={assignmentTargetId}
                            onValueChange={setAssignmentTargetId}
                            users={allUsers}
                            getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                            placeholder={t('policyManagement.assignments.selectTargetPlaceholder', { target: t(TARGET_TYPE_LABEL_KEYS[assignmentTargetType]).toLowerCase() })}
                            buttonWidth="full"
                            labelStyle="none"
                            userTypeFilter={null}
                          />
                        ) : assignmentTargetType === 'team' ? (
                          <UserAndTeamPicker
                            id="authorization-bundle-assignment-target-id"
                            value={assignmentTargetId}
                            onValueChange={() => { /* user selections disabled in team mode */ }}
                            onTeamSelect={(teamId) => setAssignmentTargetId(teamId)}
                            users={[]}
                            teams={allTeams}
                            getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
                            placeholder={t('policyManagement.assignments.selectTargetPlaceholder', { target: t(TARGET_TYPE_LABEL_KEYS[assignmentTargetType]).toLowerCase() })}
                            buttonWidth="full"
                            labelStyle="none"
                          />
                        ) : (
                          <CustomSelect
                            id="authorization-bundle-assignment-target-id"
                            options={assignmentTargetOptions.map((option) => ({
                              value: option.id,
                              label: option.label,
                              dropdownHint: option.subLabel,
                            }))}
                            value={assignmentTargetId}
                            onValueChange={setAssignmentTargetId}
                            placeholder={t('policyManagement.assignments.selectTargetPlaceholder', { target: t(TARGET_TYPE_LABEL_KEYS[assignmentTargetType]).toLowerCase() })}
                            disabled={assignmentTargetOptions.length === 0}
                          />
                        )}
                        <Button
                          id="authorization-bundle-assignment-add-button"
                          size="sm"
                          onClick={() => void handleCreateAssignment()}
                          disabled={assignmentSaving || !assignmentTargetId}
                        >
                          {assignmentSaving ? t('policyManagement.assignments.adding') : t('policyManagement.assignments.addButton')}
                        </Button>
                      </div>
                    </div>

                    {assignmentData.assignments.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[rgb(var(--color-border-300))] px-4 py-6 text-sm text-muted-foreground">
                        {t('policyManagement.assignments.empty')}
                      </div>
                    ) : (
                      <div className="grid gap-4 lg:grid-cols-2">
                        {ASSIGNMENT_TARGET_TYPES.map((targetType) => {
                          const rows = groupedAssignments.get(targetType) ?? [];
                          const targetLabel = t(TARGET_TYPE_LABEL_KEYS[targetType]);
                          return (
                            <Card key={targetType} className="border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]">
                              <CardHeader className="gap-2 border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] pb-5">
                                <div className="flex items-center justify-between gap-2">
                                  <CardTitle className="text-base">{targetLabel}</CardTitle>
                                  <Badge variant="outline">{rows.length}</Badge>
                                </div>
                              </CardHeader>
                              <CardContent className="space-y-3 p-4">
                                {rows.length === 0 ? (
                                  <div className="text-sm text-muted-foreground">{t('policyManagement.assignments.groupEmpty', { target: targetLabel.toLowerCase() })}</div>
                                ) : (
                                  rows.map((assignment) => {
                                    const nextStatus = assignment.status === 'active' ? 'disabled' : 'active';
                                    const statusLabel = assignment.status === 'active'
                                      ? t('policyManagement.assignments.statusLabels.active')
                                      : t('policyManagement.assignments.statusLabels.disabled');
                                    return (
                                      <div key={assignment.assignmentId} className="rounded-2xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-5 dark:bg-[rgb(var(--color-border-50))]">
                                        <div className="flex items-start justify-between gap-3">
                                          <div className="space-y-1">
                                            <div className="font-medium text-[rgb(var(--color-text-900))]">{assignment.targetLabel}</div>
                                            <div className="text-xs text-muted-foreground">{assignment.targetId}</div>
                                          </div>
                                          <Badge variant={assignment.status === 'active' ? 'default' : 'secondary'}>
                                            {statusLabel}
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
                                              ? t('policyManagement.assignments.statusActions.saving')
                                              : nextStatus === 'disabled'
                                                ? t('policyManagement.assignments.statusActions.disable')
                                                : t('policyManagement.assignments.statusActions.enable')}
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
                  {t('policyManagement.simulator.header')}
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('policyManagement.simulator.description')}
                </p>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                  <div className="space-y-5 rounded-2xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-5 lg:p-6">
                    <div className="text-sm font-medium text-[rgb(var(--color-text-900))]">{t('policyManagement.simulator.inputTitle')}</div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <label className="text-sm">
                        <div className="mb-1 text-muted-foreground">{t('policyManagement.simulator.resource')}</div>
                        <CustomSelect
                          id="authorization-bundle-simulator-resource"
                          options={RESOURCE_SECTIONS.map((section) => ({ value: section.resourceType, label: t(section.labelKey) }))}
                          value={simulatorResourceType}
                          onValueChange={(value) => {
                            setSimulatorResourceType(value);
                            setSimulatorRecordId('');
                            setSimulationResult(null);
                          }}
                        />
                      </label>

                      <label className="text-sm">
                        <div className="mb-1 text-muted-foreground">{t('policyManagement.simulator.action')}</div>
                        <CustomSelect
                          id="authorization-bundle-simulator-action"
                          options={actionOptions}
                          value={simulatorAction}
                          onValueChange={setSimulatorAction}
                        />
                      </label>

                      <label className="text-sm">
                        <div className="mb-1 text-muted-foreground">{t('policyManagement.simulator.principal')}</div>
                        <UserPicker
                          id="authorization-bundle-simulator-principal"
                          value={simulatorPrincipalId}
                          onValueChange={setSimulatorPrincipalId}
                          users={allUsers}
                          getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                          buttonWidth="full"
                          labelStyle="none"
                          userTypeFilter={null}
                        />
                      </label>

                      <label className="text-sm">
                        <div className="mb-1 text-muted-foreground">{t('policyManagement.simulator.record')}</div>
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
                        label={t('policyManagement.simulator.useSynthetic')}
                      />
                      {useSyntheticRecord ? (
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <Input
                            id="authorization-bundle-simulator-synthetic-owner"
                            placeholder={t('policyManagement.simulator.syntheticOwnerPlaceholder')}
                            value={syntheticOwnerUserId}
                            onChange={(event) => setSyntheticOwnerUserId(event.target.value)}
                          />
                          <Input
                            id="authorization-bundle-simulator-synthetic-client"
                            placeholder={t('policyManagement.simulator.syntheticClientPlaceholder')}
                            value={syntheticClientId}
                            onChange={(event) => setSyntheticClientId(event.target.value)}
                          />
                          <Input
                            id="authorization-bundle-simulator-synthetic-board"
                            placeholder={t('policyManagement.simulator.syntheticBoardPlaceholder')}
                            value={syntheticBoardId}
                            onChange={(event) => setSyntheticBoardId(event.target.value)}
                          />
                          <Switch
                            id="authorization-bundle-simulator-synthetic-client-visible"
                            checked={syntheticClientVisible}
                            onCheckedChange={setSyntheticClientVisible}
                            label={t('policyManagement.simulator.clientVisible')}
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
                        {simulatorLoading ? t('policyManagement.simulator.running') : t('policyManagement.simulator.run')}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-4 rounded-2xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4 lg:p-5">
                    <div className="text-sm font-medium text-[rgb(var(--color-text-900))]">{t('policyManagement.simulator.resultTitle')}</div>
                    {simulationResult ? (
                      <div className="grid gap-3">
                        <div className="space-y-3 rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-4 dark:bg-[rgb(var(--color-border-50))]">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="font-medium text-[rgb(var(--color-text-900))]">{t('policyManagement.simulator.draftRevision')}</h4>
                            <Badge variant={simulationResult.draft.allowed ? 'default' : 'error'}>
                              {simulationResult.draft.allowed ? t('policyManagement.simulator.allowed') : t('policyManagement.simulator.denied')}
                            </Badge>
                          </div>
                          <div className="space-y-1 text-xs text-muted-foreground">
                            {simulationResult.draft.reasonCodes.map((code) => (
                              <div key={code}>{code}</div>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-3 rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-4 dark:bg-[rgb(var(--color-border-50))]">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="font-medium text-[rgb(var(--color-text-900))]">{t('policyManagement.simulator.publishedRevision')}</h4>
                            <Badge variant={simulationResult.published.allowed ? 'default' : 'error'}>
                              {simulationResult.published.allowed ? t('policyManagement.simulator.allowed') : t('policyManagement.simulator.denied')}
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
                        {t('policyManagement.simulator.empty')}
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
        title={t('policyManagement.createDialog.title')}
        className="max-w-lg"
        footer={(
          <div className="flex justify-end gap-2">
            <Button
              id="authorization-bundle-create-cancel"
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
              disabled={creatingBundle}
            >
              {t('policyManagement.createDialog.cancel')}
            </Button>
            <Button
              id="authorization-bundle-create-confirm"
              onClick={() => void handleCreateBundle()}
              disabled={creatingBundle}
            >
              {creatingBundle ? t('policyManagement.createDialog.creating') : t('policyManagement.createDialog.create')}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-4">
            <label className="block text-sm">
              <div className="mb-1 text-muted-foreground">{t('policyManagement.createDialog.nameLabel')}</div>
              <Input
                id="authorization-bundle-create-name"
                value={newBundleName}
                onChange={(event) => setNewBundleName(event.target.value)}
                placeholder={t('policyManagement.createDialog.namePlaceholder')}
              />
            </label>
            <label className="block text-sm">
              <div className="mb-1 text-muted-foreground">{t('policyManagement.createDialog.descriptionLabel')}</div>
              <TextArea
                id="authorization-bundle-create-description"
                value={newBundleDescription}
                onChange={(event) => setNewBundleDescription(event.target.value)}
                placeholder={t('policyManagement.createDialog.descriptionPlaceholder')}
                rows={4}
              />
            </label>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

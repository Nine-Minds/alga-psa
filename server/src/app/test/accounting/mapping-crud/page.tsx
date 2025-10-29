'use client';

import { useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'server/src/components/ui/Tabs';
import {
  QboItemMappingTable,
  type QboItemMappingTableOverrides,
  type DisplayMapping
} from 'server/src/components/integrations/qbo/QboItemMappingTable';
import type { IService } from 'server/src/interfaces/billing.interfaces';
import type { QboItem } from 'server/src/lib/actions/integrations/qboActions';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Checkbox } from 'server/src/components/ui/Checkbox';

const MOCK_REALM_ID = 'realm-playwright-001';
const MOCK_TENANT_ID = 'tenant-playwright';

type MappingStore = {
  mappings: DisplayMapping[];
  services: IService[];
  items: QboItem[];
  nextSequence: number;
};

const seedServices: IService[] = [
  {
    service_id: 'svc-001',
    service_name: 'Managed Services',
    custom_service_type_id: 'srv-type-1',
    billing_method: 'fixed',
    default_rate: 1500,
    category_id: null,
    unit_of_measure: 'month',
    tax_rate_id: null,
    description: 'Recurring managed services subscription',
    service_type_name: 'Managed',
    tenant: MOCK_TENANT_ID,
  },
  {
    service_id: 'svc-002',
    service_name: 'Project Support',
    custom_service_type_id: 'srv-type-2',
    billing_method: 'hourly',
    default_rate: 225,
    category_id: null,
    unit_of_measure: 'hour',
    tax_rate_id: null,
    description: 'Project-based support hours',
    service_type_name: 'Project',
    tenant: MOCK_TENANT_ID,
  },
];

const seedItems: QboItem[] = [
  { id: 'qbo-item-consulting', name: 'Consulting' },
  { id: 'qbo-item-consulting-premium', name: 'Consulting - Premium' },
  { id: 'qbo-item-managed-services', name: 'Managed Services Bundle' },
];

type FallbackStrategyId = 'service' | 'category' | 'contract_line';

interface FallbackStrategy {
  id: FallbackStrategyId;
  label: string;
  enabled: boolean;
  config?: {
    category?: string;
  };
}

interface PreviewLineResult {
  id: string;
  name: string;
  mapping: {
    source: FallbackStrategyId;
    value: string;
  } | null;
}

type BatchStatus = 'pending' | 'validating' | 'ready' | 'delivered' | 'posted' | 'cancelled';

interface BatchRecord {
  id: string;
  displayName: string;
  status: BatchStatus;
  createdAt: string;
  adapter: string;
  invoiceCount: number;
  amount: string;
  createdBy: string;
  filterKey: string;
  timeline: { status: BatchStatus; at: string }[];
}

const formatTimestamp = (iso: string) => iso.replace('T', ' ').slice(0, 19);

const prettyStatus = (status: BatchStatus) =>
  status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const IS_DEV_ENV = process.env.NODE_ENV === 'development';

export default function MappingCrudPlaywrightPage(): JSX.Element {
  if (!IS_DEV_ENV) {
    return (
      <div className="container mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-2xl font-semibold mb-4">Playwright Harness Disabled</h1>
        <p>This page is only available while running the Next.js app in development mode.</p>
      </div>
    );
  }

  return <DevMappingCrudPage />;
}

function DevMappingCrudPage(): JSX.Element {
  const storeRef = useRef<MappingStore>({
    mappings: [],
    services: seedServices,
    items: seedItems,
    nextSequence: 1,
  });

  const [auditTrail, setAuditTrail] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [activeTab, setActiveTab] = useState('quickbooks');
  const [isFallbackDialogOpen, setFallbackDialogOpen] = useState(false);
  const [draggedFallbackId, setDraggedFallbackId] = useState<FallbackStrategyId | null>(null);
  const [draftFallbackConfig, setDraftFallbackConfig] = useState<FallbackStrategy[]>(() => [
    { id: 'service', label: 'Service', enabled: false },
    { id: 'category', label: 'Category', enabled: false, config: { category: 'Managed Services' } },
    { id: 'contract_line', label: 'Contract Line', enabled: true },
  ]);
  const [fallbackConfig, setFallbackConfig] = useState<FallbackStrategy[]>(draftFallbackConfig);
  const [fallbackPreview, setFallbackPreview] = useState<PreviewLineResult[] | null>(null);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const [fallbackSuccess, setFallbackSuccess] = useState<string | null>(null);
  const [mappingSuccess, setMappingSuccess] = useState<string | null>(null);

  const [isWizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<'filters' | 'preview'>('filters');
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [selectedAdapter, setSelectedAdapter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [lifecycleWizardOpen, setLifecycleWizardOpen] = useState(false);
  const [lifecycleWizardStep, setLifecycleWizardStep] = useState<'filters' | 'preview'>('filters');
  const [lifecycleAdapter, setLifecycleAdapter] = useState('');
  const [lifecycleStartDate, setLifecycleStartDate] = useState('');
  const [lifecycleEndDate, setLifecycleEndDate] = useState('');
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [lifecycleSuccess, setLifecycleSuccess] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [batchSequence, setBatchSequence] = useState(1);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [isBatchDrawerOpen, setBatchDrawerOpen] = useState(false);

  const requiredServiceId = 'svc-001';
  const sampleInvoice = {
    number: 'INV-1001',
    client: 'Acme Corp',
    total: '$1,500.00',
  };

  const hasServiceMapping = useMemo(
    () => storeRef.current.mappings.some((mapping) => mapping.alga_entity_id === requiredServiceId),
    [revision]
  );

  const pushAuditEntry = (entry: string) => {
    setAuditTrail((prev) => [entry, ...prev]);
  };

  const forceRefresh = () => {
    setRevision((prev) => prev + 1);
  };

  const handleOpenWizard = () => {
    setMappingSuccess(null);
    setWizardOpen(true);
    setWizardStep('filters');
    setWizardError(null);
  };

  const handleCloseWizard = () => {
    setWizardOpen(false);
    setWizardStep('filters');
    setWizardError(null);
  };

  const handlePreview = () => {
    setWizardStep('preview');
    setWizardError(null);
  };

  const handleBackToFilters = () => {
    setWizardStep('filters');
    setWizardError(null);
  };

  const handleConfirmExport = () => {
    if (!hasServiceMapping) {
      setWizardError('Mapping required for service svc-001 before exporting.');
      return;
    }
    setMappingSuccess('Export batch ready – mapping resolved for INV-1001.');
    setWizardOpen(false);
    setWizardStep('filters');
    setWizardError(null);
    setSelectedAdapter('');
    setStartDate('');
    setEndDate('');
  };

  const lifecycleFilterKey = (adapter: string, start: string, end: string) =>
    `${adapter || 'n/a'}|${start || 'n/a'}|${end || 'n/a'}`;

  const resetLifecycleWizard = () => {
    setLifecycleWizardStep('filters');
    setLifecycleAdapter('');
    setLifecycleStartDate('');
    setLifecycleEndDate('');
    setLifecycleError(null);
  };

  const handleOpenLifecycleWizard = () => {
    setLifecycleError(null);
    setLifecycleWizardOpen(true);
    setLifecycleWizardStep('filters');
  };

  const handleCloseLifecycleWizard = () => {
    setLifecycleWizardOpen(false);
    resetLifecycleWizard();
  };

  const handleLifecyclePreview = () => {
    if (!lifecycleAdapter || !lifecycleStartDate || !lifecycleEndDate) {
      setLifecycleError('Please select an adapter and date range before continuing.');
      return;
    }
    setLifecycleWizardStep('preview');
    setLifecycleError(null);
  };

  const appendTimeline = (batch: BatchRecord, status: BatchStatus): BatchRecord => ({
    ...batch,
    status,
    timeline: [
      ...batch.timeline,
      { status, at: new Date().toISOString() },
    ],
  });

  const updateBatchStatus = (ids: string[], status: BatchStatus) => {
    setBatches((prev) =>
      prev.map((batch) => (ids.includes(batch.id) ? appendTimeline(batch, status) : batch))
    );
  };

  const handleLifecycleConfirm = () => {
    const filterKey = lifecycleFilterKey(lifecycleAdapter, lifecycleStartDate, lifecycleEndDate);
    if (!lifecycleAdapter || !lifecycleStartDate || !lifecycleEndDate) {
      setLifecycleError('Please complete all fields before confirming.');
      return;
    }
    if (batches.some((batch) => batch.filterKey === filterKey)) {
      setLifecycleError('Batch already exists for the selected adapter and date range.');
      return;
    }

    const nextId = `BATCH-${String(batchSequence).padStart(3, '0')}`;
    const now = new Date().toISOString();
    const newBatch: BatchRecord = {
      id: nextId,
      displayName: `Export ${batchSequence}`,
      status: 'pending',
      createdAt: now,
      adapter: lifecycleAdapter,
      invoiceCount: 3,
      amount: '$4,250.00',
      createdBy: 'Automation Harness',
      filterKey,
      timeline: [
        { status: 'pending', at: now },
      ],
    };

    setBatches((prev) => [...prev, newBatch]);
    setBatchSequence((prev) => prev + 1);
    setLifecycleSuccess(`Created batch ${nextId} with status pending.`);
    setLifecycleWizardOpen(false);
    resetLifecycleWizard();
  };

  const runWorkerSimulation = () => {
    const targetIds = batches
      .filter((batch) => ['pending', 'validating', 'ready'].includes(batch.status))
      .map((batch) => batch.id);

    if (!targetIds.length) return;

    updateBatchStatus(targetIds, 'validating');
    setTimeout(() => updateBatchStatus(targetIds, 'ready'), 200);
    setTimeout(() => updateBatchStatus(targetIds, 'delivered'), 400);
  };

  const openBatchDrawer = (batchId: string) => {
    setSelectedBatchId(batchId);
    setBatchDrawerOpen(true);
  };

  const closeBatchDrawer = () => {
    setBatchDrawerOpen(false);
    setSelectedBatchId(null);
  };

  const selectedBatch = useMemo(
    () => batches.find((batch) => batch.id === selectedBatchId) ?? null,
    [batches, selectedBatchId]
  );

  const handleMarkPosted = () => {
    if (!selectedBatch || selectedBatch.status !== 'delivered') return;
    updateBatchStatus([selectedBatch.id], 'posted');
    setLifecycleSuccess(`Batch ${selectedBatch.id} marked as posted.`);
  };

  const handleCancelBatch = () => {
    if (!selectedBatch || !['pending', 'validating', 'ready'].includes(selectedBatch.status)) {
      return;
    }
    updateBatchStatus([selectedBatch.id], 'cancelled');
    setLifecycleSuccess(`Batch ${selectedBatch.id} cancelled.`);
  };

  const overrides = useMemo<QboItemMappingTableOverrides>(() => ({
    loadData: async () => {
      const snapshot = storeRef.current;
      return {
        mappings: [...snapshot.mappings],
        services: [...snapshot.services],
        items: [...snapshot.items],
      };
    },
    createMapping: async (data) => {
      const store = storeRef.current;
      const now = new Date().toISOString();
      const mappingId = `mapping-${store.nextSequence++}`;
      const service = store.services.find((svc) => svc.service_id === data.alga_entity_id);
      const item = store.items.find((itm) => itm.id === data.external_entity_id);

      const newMapping: DisplayMapping = {
        id: mappingId,
        tenant: MOCK_TENANT_ID,
        integration_type: data.integration_type,
        alga_entity_type: data.alga_entity_type,
        alga_entity_id: data.alga_entity_id,
        external_entity_id: data.external_entity_id,
        external_realm_id: data.external_realm_id ?? null,
        sync_status: data.sync_status ?? 'manual_link',
        last_synced_at: null,
        metadata: data.metadata ?? null,
        created_at: now,
        updated_at: now,
        algaEntityName: service?.service_name ?? data.alga_entity_id,
        externalEntityName: item?.name ?? data.external_entity_id,
      };

      storeRef.current = {
        ...store,
        mappings: [...store.mappings, newMapping],
        nextSequence: store.nextSequence,
      };

      pushAuditEntry(`Created mapping ${mappingId} (${newMapping.algaEntityName} → ${newMapping.externalEntityName})`);
      forceRefresh();
      return newMapping;
    },
    updateMapping: async (mappingId, updates) => {
      const store = storeRef.current;
      const current = store.mappings.find((mapping) => mapping.id === mappingId);
      if (!current) {
        throw new Error(`Mapping ${mappingId} not found in mock store`);
      }

      const nextExternalId = updates.external_entity_id ?? current.external_entity_id;
      const item = store.items.find((itm) => itm.id === nextExternalId);
      const updated: DisplayMapping = {
        ...current,
        external_entity_id: nextExternalId,
        metadata: updates.metadata ?? current.metadata,
        sync_status: updates.sync_status ?? current.sync_status,
        updated_at: new Date().toISOString(),
        externalEntityName: item?.name ?? nextExternalId,
      };

      storeRef.current = {
        ...store,
        mappings: store.mappings.map((mapping) => (mapping.id === mappingId ? updated : mapping)),
      };

      pushAuditEntry(`Updated mapping ${mappingId} (now ${updated.externalEntityName})`);
      forceRefresh();
      return updated;
    },
    deleteMapping: async (mappingId) => {
      const store = storeRef.current;
      const target = store.mappings.find((mapping) => mapping.id === mappingId);
      storeRef.current = {
        ...store,
        mappings: store.mappings.filter((mapping) => mapping.id !== mappingId),
      };

      pushAuditEntry(`Deleted mapping ${mappingId}${target?.algaEntityName ? ` (${target.algaEntityName})` : ''}`);
      forceRefresh();
    },
  }), []);

  const fallbackOrderLabel = fallbackConfig.map((item) => item.label).join(' → ');

  const sampleLines = useMemo(
    () => [
      {
        id: 'line-contract',
        name: 'Managed Contract Service',
        contractMapping: 'QBO Contract Support',
        serviceMapping: 'QBO Service Consulting',
        category: 'Managed Services',
      },
      {
        id: 'line-category',
        name: 'Category Only Service',
        contractMapping: null,
        serviceMapping: null,
        category: 'Managed Services',
      },
    ],
    []
  );

  const mappingBadgeClass = hasServiceMapping
    ? 'rounded-full border border-green-300 bg-green-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-green-700'
    : 'rounded-full border border-red-300 bg-red-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-700';

  const mappingBadgeText = hasServiceMapping ? 'Ready' : 'Mapping Required';

  const computeMappingForLine = (line: typeof sampleLines[number], strategies: FallbackStrategy[]) => {
    for (const strategy of strategies) {
      if (!strategy.enabled) continue;
      if (strategy.id === 'contract_line' && line.contractMapping) {
        return { source: strategy.id, value: line.contractMapping };
      }
      if (strategy.id === 'service' && line.serviceMapping) {
        return { source: strategy.id, value: line.serviceMapping };
      }
      if (strategy.id === 'category') {
        const selectedCategory = strategy.config?.category;
        if (selectedCategory && selectedCategory === line.category) {
          return { source: strategy.id, value: `QBO Category ${selectedCategory}` };
        }
      }
    }
    return null;
  };

  const runFallbackPreview = () => {
    const results = sampleLines.map((line) => ({
      id: line.id,
      name: line.name,
      mapping: computeMappingForLine(line, fallbackConfig),
    }));
    setFallbackPreview(results);
    setFallbackError(null);
    setFallbackSuccess(null);
  };

  const attemptFallbackBatch = () => {
    const results = sampleLines.map((line) => ({
      id: line.id,
      name: line.name,
      mapping: computeMappingForLine(line, fallbackConfig),
    }));
    const missing = results.filter((resultLine) => !resultLine.mapping);
    setFallbackPreview(results);
    if (missing.length > 0) {
      setFallbackError(
        `Mapping required for line "${missing[0].name}". Please add mapping before exporting.`
      );
      setFallbackSuccess(null);
    } else {
      setFallbackError(null);
      setFallbackSuccess('Batch ready for export. All lines resolved.');
    }
  };

  const openFallbackDialog = () => {
    setDraftFallbackConfig(fallbackConfig);
    setFallbackDialogOpen(true);
    setDraggedFallbackId(null);
  };

  const handleDragStart = (strategyId: FallbackStrategyId) => () => {
    setDraggedFallbackId(strategyId);
  };

  const reorderStrategies = (
    strategies: FallbackStrategy[],
    draggedId: FallbackStrategyId,
    targetId: FallbackStrategyId
  ) => {
    const draggedIndex = strategies.findIndex((item) => item.id === draggedId);
    const targetIndex = strategies.findIndex((item) => item.id === targetId);
    if (draggedIndex === -1 || targetIndex === -1) return strategies;
    const updated = [...strategies];
    const [removed] = updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, removed);
    return updated;
  };

  const handleDrop = (targetId: FallbackStrategyId) => (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!draggedFallbackId || draggedFallbackId === targetId) return;
    setDraftFallbackConfig((prev) => reorderStrategies(prev, draggedFallbackId, targetId));
    setDraggedFallbackId(null);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const toggleStrategyEnabled = (strategyId: FallbackStrategyId, enabled: boolean) => {
    setDraftFallbackConfig((prev) =>
      prev.map((strategy) =>
        strategy.id === strategyId
          ? {
              ...strategy,
              enabled,
            }
          : strategy
      )
    );
  };

  const updateCategorySelection = (category: string) => {
    setDraftFallbackConfig((prev) =>
      prev.map((strategy) =>
        strategy.id === 'category'
          ? {
              ...strategy,
              config: {
                ...strategy.config,
                category,
              },
            }
          : strategy
      )
    );
  };

  const saveFallbackConfig = () => {
    setFallbackConfig([...draftFallbackConfig]);
    setFallbackDialogOpen(false);
    setDraggedFallbackId(null);
  };

  return (
    <div className="container mx-auto max-w-5xl space-y-6 px-6 py-10">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Accounting Mapping Manager (Playwright Harness)</CardTitle>
          <p className="text-sm text-muted-foreground">
            Lightweight harness that injects mock data so browser tests can exercise QuickBooks mapping CRUD without external dependencies.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <div id="accounting-integration-tabs">
              <TabsList className="gap-2">
                <TabsTrigger value="quickbooks">QuickBooks Online</TabsTrigger>
                <TabsTrigger value="xero" disabled>
                  Xero (coming soon)
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="quickbooks" className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Use the controls below to add, edit, and delete mock mappings. Actions update the table and append entries to the audit log.
              </p>
              <QboItemMappingTable realmId={MOCK_REALM_ID} overrides={overrides} />
            </TabsContent>
            <TabsContent value="xero">
              <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                Xero mappings are not part of this harness. Select the QuickBooks Online tab to continue the test scenario.
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Audit Log</CardTitle>
          <span className="text-xs text-muted-foreground">Updates in real-time</span>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
              The list below mirrors the accounting audit trail spec for create / update / delete events.
            </div>
            <div className="h-px w-full bg-border" role="separator" />
            <ul id="audit-log" className="space-y-2">
              {auditTrail.length === 0 ? (
                <li className="text-sm text-muted-foreground" data-empty>
                  No audit entries yet. Perform an action above to populate the log.
                </li>
              ) : (
                auditTrail.map((entry, index) => (
                  <li
                    key={`${entry}-${index}`}
                    className="rounded border border-border bg-muted/40 px-3 py-2 text-sm"
                  >
                    {entry}
                  </li>
                ))
              )}
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Fallback Configuration Harness</CardTitle>
            <p className="text-sm text-muted-foreground">
              Adjust fallback priority and run simulated exports to verify resolver behavior.
            </p>
          </div>
          <Button
            variant="outline"
            id="configure-fallback"
            onClick={openFallbackDialog}
            className="self-start md:self-auto"
          >
            Configure Fallback
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded border border-dashed p-4">
            <p className="text-sm font-medium">Current fallback order</p>
            <p id="current-fallback-order" className="text-sm text-muted-foreground">
              {fallbackOrderLabel}
            </p>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <Button id="run-test-export" onClick={runFallbackPreview}>
              Run Test Export
            </Button>
            <Button id="attempt-batch" variant="secondary" onClick={attemptFallbackBatch}>
              Attempt Batch Creation
            </Button>
          </div>

          {fallbackPreview && (
            <div className="space-y-2 rounded border p-4">
              <h3 className="text-sm font-semibold">Preview Results</h3>
              {fallbackPreview.map((line) => (
                <div
                  key={line.id}
                  id={
                    line.id === 'line-contract'
                      ? 'export-result-line-contract'
                      : 'export-result-line-category'
                  }
                  className="rounded border border-border/50 bg-muted/40 px-3 py-2 text-sm"
                >
                  {line.mapping
                    ? `${line.name}: Resolved via ${line.mapping.source} → ${line.mapping.value}`
                    : `${line.name}: Unmapped`}
                </div>
              ))}
            </div>
          )}

          {fallbackError && (
            <div
              id="batch-error"
              className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {fallbackError}
            </div>
          )}

      {fallbackSuccess && (
        <div
          id="batch-success"
          className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700"
        >
          {fallbackSuccess}
        </div>
      )}
    </CardContent>
  </Card>

  <Card className="shadow-sm">
    <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div>
        <CardTitle>Accounting Export Wizard Harness</CardTitle>
        <p className="text-sm text-muted-foreground">
          Simulates the accounting export wizard to verify validation behavior for unmapped services.
        </p>
      </div>
      <Button id="open-export-wizard" onClick={handleOpenWizard}>
        New Export
      </Button>
    </CardHeader>
    <CardContent className="space-y-4">
      {mappingSuccess && (
        <div
          id="export-success-banner"
          className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700"
        >
          {mappingSuccess}
        </div>
      )}

      <Dialog
        isOpen={isWizardOpen}
        onClose={handleCloseWizard}
        id="export-wizard"
        title="Create Accounting Export"
      >
        <DialogContent className="space-y-4">
          {wizardStep === 'filters' && (
            <div id="wizard-filters" className="space-y-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="wizard-adapter" className="text-sm font-medium">
                  Adapter
                </Label>
                <select
                  id="wizard-adapter"
                  className="rounded border border-border px-3 py-2 text-sm"
                  value={selectedAdapter}
                  onChange={(event) => setSelectedAdapter(event.target.value)}
                >
                  <option value="">Select adapter</option>
                  <option value="quickbooks_online">QuickBooks Online</option>
                  <option value="xero">Xero</option>
                </select>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="wizard-date-start" className="text-sm font-medium">
                    Start Date
                  </Label>
                  <input
                    type="date"
                    id="wizard-date-start"
                    className="rounded border border-border px-3 py-2 text-sm"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="wizard-date-end" className="text-sm font-medium">
                    End Date
                  </Label>
                  <input
                    type="date"
                    id="wizard-date-end"
                    className="rounded border border-border px-3 py-2 text-sm"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Button id="wizard-cancel-button" variant="outline" onClick={handleCloseWizard}>
                  Cancel
                </Button>
                <Button id="wizard-preview-button" onClick={handlePreview}>
                  Preview
                </Button>
              </div>
            </div>
          )}

          {wizardStep === 'preview' && (
            <div id="wizard-preview" className="space-y-4">
              {wizardError && (
                <div
                  id="wizard-error-banner"
                  className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {wizardError}
                </div>
              )}
              <table
                className="w-full table-auto border border-border/60 text-sm"
                id="wizard-preview-table"
              >
                <thead className="bg-muted/60">
                  <tr>
                    <th className="border border-border/60 px-3 py-2 text-left font-medium">
                      Invoice
                    </th>
                    <th className="border border-border/60 px-3 py-2 text-left font-medium">
                      Client
                    </th>
                    <th className="border border-border/60 px-3 py-2 text-left font-medium">
                      Total
                    </th>
                    <th className="border border-border/60 px-3 py-2 text-left font-medium">
                      Mapping Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr id="preview-invoice-row">
                    <td className="border border-border/60 px-3 py-2">{sampleInvoice.number}</td>
                    <td className="border border-border/60 px-3 py-2">{sampleInvoice.client}</td>
                    <td className="border border-border/60 px-3 py-2">{sampleInvoice.total}</td>
                    <td className="border border-border/60 px-3 py-2">
                      <span id="preview-mapping-status" className={mappingBadgeClass}>
                        {mappingBadgeText}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <Button id="wizard-back-button" variant="outline" onClick={handleBackToFilters}>
                  Back
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    id="wizard-cancel-button"
                    variant="ghost"
                    onClick={handleCloseWizard}
                  >
                    Cancel
                  </Button>
                  <Button id="wizard-confirm-button" onClick={handleConfirmExport}>
                    Confirm Export
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </CardContent>
  </Card>


      <Card className="shadow-sm">
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Accounting Export Lifecycle Harness</CardTitle>
            <p className="text-sm text-muted-foreground">
              Simulates the accounting exports dashboard, worker transitions, and drawer actions.
            </p>
          </div>
          <div className="flex gap-2">
            <Button id="open-lifecycle-wizard" onClick={handleOpenLifecycleWizard}>
              New Export
            </Button>
            <Button id="run-worker-button" variant="secondary" onClick={runWorkerSimulation}>
              Run Worker
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {lifecycleSuccess && (
            <div
              id="lifecycle-success-banner"
              className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700"
            >
              {lifecycleSuccess}
            </div>
          )}

          <table className="w-full table-auto border border-border/60 text-sm" id="batch-table">
            <thead className="bg-muted/60">
              <tr>
                <th className="border border-border/60 px-3 py-2 text-left font-medium">Batch ID</th>
                <th className="border border-border/60 px-3 py-2 text-left font-medium">Created</th>
                <th className="border border-border/60 px-3 py-2 text-left font-medium">Adapter</th>
                <th className="border border-border/60 px-3 py-2 text-left font-medium">Amount</th>
                <th className="border border-border/60 px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {batches.length === 0 ? (
                <tr id="batch-empty-row">
                  <td
                    className="border border-border/60 px-3 py-4 text-center text-muted-foreground"
                    colSpan={5}
                  >
                    No batches created yet.
                  </td>
                </tr>
              ) : (
                batches.map((batch) => (
                  <tr
                    key={batch.id}
                    id={`batch-row-${batch.id}`}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => openBatchDrawer(batch.id)}
                  >
                    <td className="border border-border/60 px-3 py-2">{batch.id}</td>
                    <td className="border border-border/60 px-3 py-2">
                      {formatTimestamp(batch.createdAt)}
                    </td>
                    <td className="border border-border/60 px-3 py-2">{batch.adapter}</td>
                    <td className="border border-border/60 px-3 py-2">{batch.amount}</td>
                    <td
                      id={`batch-status-${batch.id}`}
                      data-status={batch.status}
                      className="border border-border/60 px-3 py-2 font-medium"
                    >
                      {prettyStatus(batch.status)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog
        isOpen={lifecycleWizardOpen}
        onClose={handleCloseLifecycleWizard}
        id="lifecycle-export-wizard"
        title="Create Accounting Export"
      >
        <DialogContent className="space-y-4">
          {lifecycleWizardStep === 'filters' && (
            <div id="lifecycle-wizard-filters" className="space-y-4">
              {lifecycleError && (
                <div
                  id="lifecycle-duplicate-warning"
                  className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {lifecycleError}
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="lifecycle-adapter" className="text-sm font-medium">
                  Adapter
                </Label>
                <select
                  id="lifecycle-adapter"
                  className="rounded border border-border px-3 py-2 text-sm"
                  value={lifecycleAdapter}
                  onChange={(event) => setLifecycleAdapter(event.target.value)}
                >
                  <option value="">Select adapter</option>
                  <option value="quickbooks_online">QuickBooks Online</option>
                  <option value="xero">Xero</option>
                </select>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="lifecycle-date-start" className="text-sm font-medium">
                    Start Date
                  </Label>
                  <input
                    type="date"
                    id="lifecycle-date-start"
                    className="rounded border border-border px-3 py-2 text-sm"
                    value={lifecycleStartDate}
                    onChange={(event) => setLifecycleStartDate(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="lifecycle-date-end" className="text-sm font-medium">
                    End Date
                  </Label>
                  <input
                    type="date"
                    id="lifecycle-date-end"
                    className="rounded border border-border px-3 py-2 text-sm"
                    value={lifecycleEndDate}
                    onChange={(event) => setLifecycleEndDate(event.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Button id="lifecycle-cancel-button" variant="outline" onClick={handleCloseLifecycleWizard}>
                  Cancel
                </Button>
                <Button id="lifecycle-preview-button" onClick={handleLifecyclePreview}>
                  Preview
                </Button>
              </div>
            </div>
          )}

          {lifecycleWizardStep === 'preview' && (
            <div id="lifecycle-wizard-preview" className="space-y-4">
              {lifecycleError && (
                <div
                  id="lifecycle-duplicate-warning"
                  className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {lifecycleError}
                </div>
              )}
              <table className="w-full table-auto border border-border/60 text-sm" id="lifecycle-preview-table">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="border border-border/60 px-3 py-2 text-left font-medium">Invoice</th>
                    <th className="border border-border/60 px-3 py-2 text-left font-medium">Client</th>
                    <th className="border border-border/60 px-3 py-2 text-left font-medium">Total</th>
                    <th className="border border-border/60 px-3 py-2 text-left font-medium">Mapping Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr id="lifecycle-preview-invoice-row">
                    <td className="border border-border/60 px-3 py-2">{sampleInvoice.number}</td>
                    <td className="border border-border/60 px-3 py-2">{sampleInvoice.client}</td>
                    <td className="border border-border/60 px-3 py-2">{sampleInvoice.total}</td>
                    <td className="border border-border/60 px-3 py-2">
                      <span id="lifecycle-preview-mapping-status" className={mappingBadgeClass}>
                        {mappingBadgeText}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <Button id="lifecycle-back-button" variant="outline" onClick={() => setLifecycleWizardStep('filters')}>
                  Back
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    id="lifecycle-cancel-preview-button"
                    variant="ghost"
                    onClick={handleCloseLifecycleWizard}
                  >
                    Cancel
                  </Button>
                  <Button id="lifecycle-confirm-button" onClick={handleLifecycleConfirm}>
                    Confirm Export
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        isOpen={isBatchDrawerOpen}
        onClose={closeBatchDrawer}
        id="batch-drawer"
        title={selectedBatch ? `Batch ${selectedBatch.id}` : 'Batch Detail'}
      >
        <DialogContent className="space-y-4">
          {selectedBatch ? (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <span id="batch-drawer-status" className="text-sm font-semibold">
                    {prettyStatus(selectedBatch.status)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Adapter</span>
                  <span>{selectedBatch.adapter}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Amount</span>
                  <span>{selectedBatch.amount}</span>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium">Timeline</h4>
                <ul id="batch-timeline" className="mt-2 space-y-1 text-sm">
                  {selectedBatch.timeline.map((entry, index) => (
                    <li key={`${entry.status}-${entry.at}-${index}`} className="flex justify-between">
                      <span>{prettyStatus(entry.status)}</span>
                      <time className="text-muted-foreground">{formatTimestamp(entry.at)}</time>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button
                  id="mark-posted-button"
                  onClick={handleMarkPosted}
                  disabled={selectedBatch.status !== 'delivered'}
                >
                  Mark as Posted
                </Button>
                <Button
                  id="cancel-batch-button"
                  variant="outline"
                  onClick={handleCancelBatch}
                  disabled={!['pending', 'validating', 'ready'].includes(selectedBatch.status)}
                >
                  Cancel Batch
                </Button>
              </div>
              <div className="flex justify-end">
                <Button id="close-batch-drawer" variant="ghost" onClick={closeBatchDrawer}>
                  Close
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Select a batch to view details.</p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog isOpen={isFallbackDialogOpen} onClose={() => setFallbackDialogOpen(false)} id="fallback-dialog" title="Configure Fallback Order">
        <DialogContent className="space-y-4">
          <div className="space-y-3">
            {draftFallbackConfig.map((strategy) => (
              <div
                key={strategy.id}
                id={`fallback-item-${strategy.id}`}
                draggable
                onDragStart={handleDragStart(strategy.id)}
                onDragOver={handleDragOver}
                onDrop={handleDrop(strategy.id)}
                className="flex items-center justify-between gap-4 rounded border border-dashed border-border/60 bg-muted/30 px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <span
                    id={`fallback-handle-${strategy.id}`}
                    className="cursor-grab text-lg"
                    aria-label={`Drag handle for ${strategy.label}`}
                  >
                    ☰
                  </span>
                  <span className="font-medium">{strategy.label}</span>
                </div>
                <div className="flex items-center gap-3">
                  {strategy.id === 'category' && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="fallback-category-select" className="text-xs uppercase text-muted-foreground">
                        Category
                      </Label>
                      <select
                        id="fallback-category-select"
                        className="rounded border border-border px-2 py-1 text-sm"
                        value={strategy.config?.category ?? 'Managed Services'}
                        onChange={(event) => updateCategorySelection(event.target.value)}
                      >
                        <option value="Managed Services">Managed Services</option>
                        <option value="Project Services">Project Services</option>
                        <option value="Cloud">Cloud</option>
                      </select>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`fallback-toggle-${strategy.id}`}
                      checked={strategy.enabled}
                      onChange={(event) =>
                        toggleStrategyEnabled(strategy.id, event.currentTarget.checked)
                      }
                    />
                    <Label htmlFor={`fallback-toggle-${strategy.id}`} className="text-sm">
                      Enabled
                    </Label>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
        <DialogFooter>
          <div className="flex w-full justify-end gap-2 border-t border-border/40 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              id="fallback-cancel-button"
              onClick={() => setFallbackDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" id="fallback-save-button" onClick={saveFallbackConfig}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

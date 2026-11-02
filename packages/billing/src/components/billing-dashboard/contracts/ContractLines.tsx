'use client';


import { resolveUnitOfMeasure } from '@alga-psa/core/unitOfMeasure';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Plus, ChevronDown, ChevronUp, Trash2, Package, Edit, Check, X, Loader2, MapPin, RotateCcw } from 'lucide-react';
import { IContract, IContractLineServiceRateTier } from '@alga-psa/types';
import { UsageServiceConfigPanel } from '../service-configurations/UsageServiceConfigPanel';
import { getNextContractServiceBoundary } from '@alga-psa/billing/actions/contractLineSemanticsActions';
import { hasContractLineProtectedHistory } from '@alga-psa/billing/actions/contractLineAction';
import {
  getContractLineEditVersion,
  saveContractLineEdit,
  type ContractLineEditDraft,
  type ContractLineEditMemberDraft,
} from '@alga-psa/billing/actions/contractLineSaveAction';
import { isContractLineConflict } from '../../../lib/billing/contractLineConflict';
import {
  getDetailedContractLines,
  removeContractLine,
  updateContractLineAssociation,
} from '@alga-psa/billing/actions/contractLineMappingActions';
import { resetContractLineRateToStandard, previewContractLineRateReset } from '@alga-psa/billing/actions/rateReviewActions';
import {
  getContractLineServicesWithConfigurations,
  getTemplateLineServicesWithConfigurations,
} from '@alga-psa/billing/actions/contractLineServiceActions';
import {
  getConfigurationWithDetails,
} from '@alga-psa/billing/actions/contractLineServiceConfigurationActions';
import {
  getActiveClientLocationsForBilling,
  type BillingLocationSummary,
} from '@alga-psa/billing/actions/billingClientLocationActions';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { AlertCircle } from 'lucide-react';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Badge } from '@alga-psa/ui/components/Badge';
import { AddContractLinesDialog } from './AddContractLinesDialog';
import { CreateCustomContractLineDialog } from './CreateCustomContractLineDialog';
import { BucketPoolEditor } from './BucketPoolEditor';
import { PrepaidBlockPanel } from './PrepaidBlockPanel';
import { RecurringUnitSchedulePanel } from './RecurringUnitSchedulePanel';
import {
  listBucketBusinessHoursSchedules,
  listBucketPoolsForLine,
} from '@alga-psa/billing/actions/bucketPoolActions';
import {
  ServiceSelectionDialog,
  type ContractLineServiceSelection,
} from '../service-config/ServiceSelectionDialog';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { BucketOverlayFields } from './BucketOverlayFields';
import { BucketOverlayInput } from './ContractWizard';
import { getCurrencySymbol } from '@alga-psa/core';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { toast } from 'react-hot-toast';
import { BillingProfilePicker } from '@alga-psa/ui/components/BillingProfilePicker';
import {
  assignContractLineBillingProfile,
  getClientBillingProfilesForBilling,
} from '@alga-psa/billing/actions/billingProfileActions';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFormatBillingFrequency, useFormatContractLineType } from '@alga-psa/billing/hooks/useBillingEnumOptions';
import { BillingTimingField } from './BillingTimingField';
import { getContractLineBillingTimingLabel } from './contractLineBillingTimingLabel';
import {
  isAdvanceTimingAllowedForLineType,
  resolveEffectiveBillingTiming,
} from '@shared/billingClients/contractLineTimingRule';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useClientBillingSchedule } from '../../../hooks/useClientBillingSchedule';
import { useProductCatalogRates } from '../../../hooks/useProductCatalogRates';
import { hasRecurringMemberRate, resolveRecurringMemberRate } from '../../../lib/billing/compute/recurringMemberRate';
import { productUnitMarginCents } from '../../../lib/productUnitMargin';
import { ArrearsFirstInvoiceHint } from './ArrearsFirstInvoiceHint';

interface ContractLinesProps {
  contract: IContract;
  /**
   * Client that owns this contract. Required to populate the location picker
   * for per-line location assignment. When null (e.g. system-managed defaults
   * with no owner), location controls are hidden.
   */
  clientId?: string | null;
  /**
   * The contract's start date (`YYYY-MM-DD`) for the client this tab is scoped to.
   * With `clientId`, lets Fixed lines say when their first partial period will invoice.
   */
  startDate?: string | null;
  onContractLinesChanged?: () => void;
  isReadOnly?: boolean;
  focusContractLineId?: string | null;
  /** One-shot request to open this line in edit mode (ignored when read-only). Plain focus links leave it unset. */
  editIntentLineId?: string | null;
  /** Called once the edit intent has been handled (applied or refused), so the parent clears it. */
  onEditIntentConsumed?: () => void;
}

interface DetailedContractLineMapping {
  tenant: string;
  contract_id: string;
  contract_line_id: string;
  display_order: number;
  custom_rate?: number | null;
  /** Who owns `custom_rate`; drives the Standard/Custom/Unreviewed badge. */
  rate_provenance?: 'custom' | 'inherited' | 'unreviewed' | null;
  created_at: string | Date;
  contract_line_name: string;
  billing_frequency: string;
  billing_timing?: 'arrears' | 'advance';
  cadence_owner?: 'client' | 'contract';
  contract_line_type: string;
  /** Derived label kind: 'PrepaidBlock' for Hourly lines with a prepaid block config. */
  display_kind?: string;
  default_rate?: number | null;
  minimum_billable_time?: number | null;
  round_up_to_nearest?: number | null;
  location_id?: string | null;
  /** Step 2 of the charge-attribution chain; overrides the contract's profile. */
  billing_profile_id?: string | null;
  /** Verbatim invoice line text; falls back to the line name when null. */
  invoice_line_description?: string | null;
  /** Authored line window (half-open), constrained to the client contract. */
  start_date?: string | null;
  end_date?: string | null;
}

/**
 * Sentinel value for a contract line that has no assigned location.
 * Used as a stable group key so unassigned lines can be grouped together
 * without colliding with a real location UUID.
 */
const UNASSIGNED_LOCATION_KEY = '__unassigned__';

const isReturnedActionError = (value: unknown): boolean =>
  isActionMessageError(value) || isActionPermissionError(value);

/**
 * Format a one-line address summary for a location group header.
 * Returns '' when no address components are present.
 */
const formatLocationAddress = (location?: BillingLocationSummary | null): string => {
  if (!location) return '';
  const parts: string[] = [];
  if (location.address_line1) parts.push(location.address_line1);
  const regionSegments = [
    location.city,
    [location.state_province, location.postal_code].filter(Boolean).join(' ').trim(),
  ].filter((segment): segment is string => Boolean(segment && segment.length > 0));
  if (regionSegments.length > 0) parts.push(regionSegments.join(', '));
  return parts.join(' · ');
};

interface ServiceConfiguration {
  service: {
    service_id: string;
    service_name: string;
    service_type?: string;
    billing_method?: string;
    /** `product` marks a catalog product billed through the recurring product path. */
    item_kind?: string | null;
  };
  configuration: {
    config_id: string;
    service_id: string;
    contract_line_id: string;
    configuration_type: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket';
    custom_rate?: number | null;
    quantity?: number;
  };
  typeConfig: any;
  rateTiers?: IContractLineServiceRateTier[];
  bucketConfig?: any; // Add bucketConfig property for merged bucket data
  /** Legacy `contract_line_services.custom_rate`; second link of the engine's member-rate chain. */
  service_line_custom_rate?: number | null;
}

interface PendingServiceAddition {
  selection: ContractLineServiceSelection;
  draftConfigurationId: string;
}

const DRAFT_SERVICE_CONFIG_PREFIX = 'draft-service-config:';

const loadBillingProfiles = (clientId: string) => getClientBillingProfilesForBilling(clientId);

const ContractLines: React.FC<ContractLinesProps> = ({ contract, clientId = null, startDate = null, onContractLinesChanged, isReadOnly = false, focusContractLineId = null, editIntentLineId = null, onEditIntentConsumed }) => {
  // One schedule fetch for the whole tab; every Fixed row's first-invoice hint reads it.
  const { schedule: clientSchedule } = useClientBillingSchedule(clientId, !!startDate);
  const { t } = useTranslation('msp/contracts');

  const handleAssignLineBillingProfile = async (
    contractLineId: string,
    billingProfileId: string | null,
  ) => {
    try {
      await assignContractLineBillingProfile({ contractLineId, billingProfileId });
      await fetchData();
      toast.success(t('contractLines.billingProfile.updated', { defaultValue: 'Billing profile updated' }));
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const { formatCurrency } = useFormatters();
  const formatBillingFrequency = useFormatBillingFrequency();
  const formatContractLineType = useFormatContractLineType();
  const [bucketSchedules, setBucketSchedules] = useState<Array<{
    schedule_id: string;
    schedule_name: string;
    is_default: boolean;
  }>>([]);
  const cadenceOwnerOptions = [
    {
      value: 'client',
      label: t('billing.cadenceOwner.client', { defaultValue: 'Client schedule' }),
    },
    {
      value: 'contract',
      label: t('billing.cadenceOwner.contract', { defaultValue: 'Contract anniversary' }),
    },
  ] as const;

  const [contractLines, setContractLines] = useState<DetailedContractLineMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Set when a save was refused because the line changed underneath the editor.
  const [conflictLineId, setConflictLineId] = useState<string | null>(null);
  const [expandedLines, setExpandedLines] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!focusContractLineId || !contractLines.some((line) => line.contract_line_id === focusContractLineId)) return;
    setExpandedLines((current) => ({ ...current, [focusContractLineId]: true }));
    requestAnimationFrame(() => document.getElementById(`contract-line-card-${focusContractLineId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [contractLines, focusContractLineId]);
  const [lineServices, setLineServices] = useState<Record<string, ServiceConfiguration[]>>({});
  const [loadingServices, setLoadingServices] = useState<Record<string, boolean>>({});
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showCreateCustomDialog, setShowCreateCustomDialog] = useState(false);
  const [showServiceSelectionDialog, setShowServiceSelectionDialog] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [editLineData, setEditLineData] = useState<Partial<DetailedContractLineMapping>>({});
  const [effectiveBoundary, setEffectiveBoundary] = useState('');
  const [requiresEffectiveBoundary, setRequiresEffectiveBoundary] = useState(false);
  const [pricingOnly, setPricingOnly] = useState(false);
  // Version token of the line as the editor loaded it (optimistic concurrency).
  const [editLineVersion, setEditLineVersion] = useState<string | null>(null);
  const [editServiceConfigs, setEditServiceConfigs] = useState<Record<string, any>>({});
  const [editBucketConfigs, setEditBucketConfigs] = useState<Record<string, BucketOverlayInput | null>>({});
  // Services whose bucket was already saved when this edit began. A null draft
  // only means "delete the overlay" for these; for the rest it means "never had
  // one".
  const [savedBucketOverlayServiceIds, setSavedBucketOverlayServiceIds] = useState<string[]>([]);
  const [pendingServiceAdditions, setPendingServiceAdditions] = useState<PendingServiceAddition[]>([]);
  const [pendingServiceRemovalIds, setPendingServiceRemovalIds] = useState<string[]>([]);
  // "Reset to standard" confirmation (plan §3.3): shows the current rate and the
  // catalog rate it will fall back to. Fetched from the resolver so the dialog
  // and the apply cannot disagree.
  const [resetConfirmation, setResetConfirmation] = useState<{
    line: DetailedContractLineMapping;
    currentRateCents: number | null;
    targetRateCents: number | null;
  } | null>(null);
  const [isPreparingReset, setIsPreparingReset] = useState(false);
  const [isResettingLine, setIsResettingLine] = useState(false);

  // Location grouping state
  const [clientLocations, setClientLocations] = useState<BillingLocationSummary[]>([]);
  /**
   * Transient location keys that have been added via "Add location" but do not
   * yet have any contract lines. Kept client-side only; once a contract line
   * is created with a matching location_id the group becomes real.
   */
  const [pendingLocationIds, setPendingLocationIds] = useState<string[]>([]);

  useEffect(() => {
    if (contract.contract_id) {
      void fetchData();
    }
  }, [contract.contract_id]);

  useEffect(() => {
    let isActive = true;
    void (async () => {
      try {
        const schedules = await listBucketBusinessHoursSchedules();
        if (isActive && Array.isArray(schedules)) {
          setBucketSchedules(schedules.map((schedule) => ({
            schedule_id: schedule.schedule_id,
            schedule_name: schedule.schedule_name,
            is_default: Boolean(schedule.is_default),
          })));
        }
      } catch {
        // The schedule list is a convenience for the after-hours rule; if it
        // cannot be loaded, the rule simply has no schedule to pick from.
      }
    })();
    return () => {
      isActive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let isActive = true;

    const loadLocations = async () => {
      if (!clientId) {
        setClientLocations([]);
        return;
      }
      try {
        const locations = await getActiveClientLocationsForBilling(clientId);
        if (isActionPermissionError(locations)) {
          if (isActive) {
            setClientLocations([]);
          }
          return;
        }
        if (isActive) {
          setClientLocations(locations);
        }
      } catch (err) {
        console.error('Error loading client locations for contract lines:', err);
        if (isActive) {
          setClientLocations([]);
        }
      }
    };

    void loadLocations();

    return () => {
      isActive = false;
    };
  }, [clientId]);

  /**
   * Lookup map of location_id -> location summary. Includes only active
   * locations; lines referencing deactivated locations will fall back to
   * the "Location" label in the group header.
   */
  const locationsById = useMemo<Record<string, BillingLocationSummary>>(() => {
    const map: Record<string, BillingLocationSummary> = {};
    for (const loc of clientLocations) {
      if (loc.location_id) {
        map[loc.location_id] = loc;
      }
    }
    return map;
  }, [clientLocations]);

  const defaultLocationId = useMemo<string | null>(() => {
    const def = clientLocations.find((loc) => loc.is_default);
    return def?.location_id ?? null;
  }, [clientLocations]);

  /**
   * Group contract lines by location_id. Groups preserve first-occurrence
   * order based on the lowest display_order in each group (so the UI ordering
   * reflects how lines were originally authored).
   *
   * Pending locations (added via "Add location" but without lines yet) appear
   * after real groups so the user can see where newly-created lines will land.
   */
  type LineGroup = {
    key: string;
    locationId: string | null;
    lines: DetailedContractLineMapping[];
    isPending: boolean;
  };

  const groupedLines = useMemo<LineGroup[]>(() => {
    const byKey = new Map<string, LineGroup>();
    for (const line of contractLines) {
      const locationId = line.location_id ?? null;
      const key = locationId ?? UNASSIGNED_LOCATION_KEY;
      if (!byKey.has(key)) {
        byKey.set(key, { key, locationId, lines: [], isPending: false });
      }
      byKey.get(key)!.lines.push(line);
    }
    const realGroups = Array.from(byKey.values());
    // Preserve first-occurrence ordering via the lowest display_order in each group.
    realGroups.sort((a, b) => {
      const orderA = Math.min(...a.lines.map((line) => line.display_order ?? Number.MAX_SAFE_INTEGER));
      const orderB = Math.min(...b.lines.map((line) => line.display_order ?? Number.MAX_SAFE_INTEGER));
      return orderA - orderB;
    });

    const pendingOnly = pendingLocationIds
      .filter((locId) => !byKey.has(locId))
      .map<LineGroup>((locId) => ({
        key: locId,
        locationId: locId,
        lines: [],
        isPending: true,
      }));

    return [...realGroups, ...pendingOnly];
  }, [contractLines, pendingLocationIds]);

  const distinctLocationCount = useMemo(() => {
    const ids = new Set<string>();
    for (const line of contractLines) {
      ids.add(line.location_id ?? UNASSIGNED_LOCATION_KEY);
    }
    // Pending groups count too, so users see the grouped layout as soon as
    // they click "Add location".
    for (const locId of pendingLocationIds) {
      ids.add(locId);
    }
    return ids.size;
  }, [contractLines, pendingLocationIds]);

  const shouldRenderGrouped = distinctLocationCount >= 2;

  /** Build dropdown options from active client locations. */
  const locationSelectOptions = useMemo(() => {
    return clientLocations
      .filter((loc): loc is BillingLocationSummary & { location_id: string } => Boolean(loc.location_id))
      .map((loc) => ({
        value: loc.location_id,
        label: loc.location_name
          ? `${loc.location_name}${loc.address_line1 ? ` — ${loc.address_line1}` : ''}`
          : (loc.address_line1 ?? t('contractLines.location.unnamed', { defaultValue: 'Location' })),
      }));
  }, [clientLocations, t]);

  const fetchData = async () => {
    if (!contract.contract_id) return;

    setIsLoading(true);
    setError(null);

    try {
      const detailedContractLines = await getDetailedContractLines(contract.contract_id);
      if (isReturnedActionError(detailedContractLines)) {
        setError(getErrorMessage(detailedContractLines));
        return;
      }
      setContractLines(detailedContractLines);
    } catch (err) {
      console.error('Error fetching contract lines:', err);
      setError(t('contractLines.errors.failedToLoad', { defaultValue: 'Failed to load contract lines' }));
    } finally {
      setIsLoading(false);
    }
  };

  const loadServicesForLine = async (contractLineId: string, forceReload: boolean = false): Promise<ServiceConfiguration[]> => {
    if (!forceReload && lineServices[contractLineId]) {
      return lineServices[contractLineId]; // Already loaded
    }

    if (!forceReload && loadingServices[contractLineId]) {
      return []; // Currently loading, return empty
    }

    setLoadingServices(prev => ({ ...prev, [contractLineId]: true }));

    try {
      const isTemplate = contract.is_template;
      const services = isTemplate
        ? await getTemplateLineServicesWithConfigurations(contractLineId)
        : await getContractLineServicesWithConfigurations(contractLineId);
      if (isReturnedActionError(services)) {
        setError(getErrorMessage(services));
        return [];
      }

      setLineServices(prev => ({ ...prev, [contractLineId]: services }));
      return services;
    } catch (err) {
      console.error(`Error loading services for contract line ${contractLineId}:`, err);
      return [];
    } finally {
      setLoadingServices(prev => ({ ...prev, [contractLineId]: false }));
    }
  };

  const toggleExpand = async (contractLineId: string) => {
    const isExpanded = expandedLines[contractLineId];

    setExpandedLines(prev => ({
      ...prev,
      [contractLineId]: !isExpanded
    }));

    if (!isExpanded) {
      await loadServicesForLine(contractLineId);
    }
  };

  /**
   * An enabled bucket is persisted as a single-member pool, not as a per-service
   * Bucket configuration row, so `bucketConfig` alone leaves the switch off for
   * every bucket saved from this screen. Read those pools back so a saved bucket
   * shows as enabled — otherwise turning it off is indistinguishable from never
   * having had one and the overlay can never be removed.
   */
  const loadSavedBucketOverlays = async (
    contractLineId: string,
  ): Promise<Record<string, BucketOverlayInput>> => {
    if (contract.is_template) return {};
    const overlays: Record<string, BucketOverlayInput> = {};
    try {
      const pools = await listBucketPoolsForLine(contractLineId);
      if (isReturnedActionError(pools)) return overlays;
      for (const pool of pools) {
        // Only a pool whose sole member is this service round-trips through the
        // single-service switch; a shared pool is edited in the pool editor.
        if (pool.members.length !== 1) continue;
        overlays[pool.members[0].service_id] = {
          total_minutes: pool.total_minutes,
          overage_rate: pool.overage_rate,
          allow_rollover: pool.allow_rollover,
          billing_period: pool.billing_period === 'weekly' ? 'weekly' : 'monthly',
        };
      }
    } catch {
      // The pool read only decides how the switch starts; failing it must not
      // block editing the rest of the line.
    }
    return overlays;
  };

  const initializeServiceConfigEdits = (
    services: ServiceConfiguration[],
    savedBucketOverlays: Record<string, BucketOverlayInput> = {},
  ) => {
    const serviceConfigsData: Record<string, any> = {};
    const bucketConfigsData: Record<string, BucketOverlayInput | null> = {};

    // Bucket configurations are represented by the bucketConfig property on
    // their parent service rather than as independently editable services.
    services.filter(s => s.configuration.configuration_type !== 'Bucket').forEach(serviceConfig => {
      const serviceId = serviceConfig.service.service_id;

      serviceConfigsData[serviceConfig.configuration.config_id] = {
        quantity: serviceConfig.configuration.quantity ?? 1,
        custom_rate: serviceConfig.configuration.custom_rate,
        hourly_rate: serviceConfig.typeConfig?.hourly_rate,
        base_rate: serviceConfig.configuration.configuration_type === 'Usage'
          ? serviceConfig.configuration.custom_rate ?? serviceConfig.typeConfig?.base_rate
          : serviceConfig.typeConfig?.base_rate,
        unit_of_measure: serviceConfig.typeConfig?.unit_of_measure,
        measurement_mode: serviceConfig.typeConfig?.measurement_mode ?? 'additive',
        minimum_usage: serviceConfig.typeConfig?.minimum_usage ?? 0,
        enable_tiered_pricing: serviceConfig.typeConfig?.enable_tiered_pricing ?? false,
        rateTiers: serviceConfig.rateTiers ?? [],
      };

      bucketConfigsData[serviceId] = serviceConfig.bucketConfig
        ? {
            total_minutes: serviceConfig.bucketConfig.total_minutes,
            overage_rate: serviceConfig.bucketConfig.overage_rate,
            allow_rollover: serviceConfig.bucketConfig.allow_rollover,
            billing_period: serviceConfig.bucketConfig.billing_period,
          }
        : savedBucketOverlays[serviceId] ?? null;
    });

    setEditServiceConfigs(serviceConfigsData);
    setEditBucketConfigs(bucketConfigsData);
    setSavedBucketOverlayServiceIds(
      Object.entries(bucketConfigsData)
        .filter(([, overlay]) => Boolean(overlay))
        .map(([serviceId]) => serviceId)
    );
  };

  const resetServiceMembershipDraft = () => {
    setPendingServiceAdditions([]);
    setPendingServiceRemovalIds([]);
  };

  const createDraftServiceConfiguration = (
    contractLineId: string,
    pendingAddition: PendingServiceAddition,
  ): ServiceConfiguration => ({
    service: {
      service_id: pendingAddition.selection.service.service_id,
      service_name: pendingAddition.selection.service.service_name,
      billing_method: pendingAddition.selection.service.billing_method,
    },
    configuration: {
      config_id: pendingAddition.draftConfigurationId,
      service_id: pendingAddition.selection.service.service_id,
      contract_line_id: contractLineId,
      configuration_type: pendingAddition.selection.configurationType,
      custom_rate: pendingAddition.selection.customRate,
      quantity: pendingAddition.selection.quantity,
    },
    typeConfig: pendingAddition.selection.typeConfig,
    bucketConfig: null,
  });

  const handleAddContractLines = async () => {
    if (!contract.contract_id) return;

    try {
      // Refresh the contract lines after presets are added
      await fetchData();
      onContractLinesChanged?.();
    } catch (err) {
      console.error('Error refreshing contract lines:', err);
      setError(t('contractLines.errors.failedToRefresh', { defaultValue: 'Failed to refresh contract lines' }));
      throw err;
    }
  };

  const handleRemoveContractLine = async (contractLineId: string) => {
    if (!contract.contract_id) return;

    try {
      const result = await removeContractLine(contract.contract_id, contractLineId);
      if (isReturnedActionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      await fetchData();
      onContractLinesChanged?.();
    } catch (err) {
      console.error('Error removing contract line:', err);
      setError(err instanceof Error
        ? err.message
        : t('contractLines.errors.failedToRemove', { defaultValue: 'Failed to remove contract line' }));
    }
  };

  const openResetConfirmation = async (line: DetailedContractLineMapping) => {
    setIsPreparingReset(true);
    try {
      const preview = await previewContractLineRateReset(line.contract_line_id);
      if (isReturnedActionError(preview)) {
        setError(getErrorMessage(preview));
        return;
      }
      if (preview.targetRateCents === null) {
        setError(preview.reason ?? t('contractLines.errors.failedToResetRate', {
          defaultValue: 'Failed to reset the line rate',
        }));
        return;
      }
      setResetConfirmation({
        line,
        currentRateCents: preview.currentRateCents,
        targetRateCents: preview.targetRateCents,
      });
    } catch (err) {
      console.error('Error preparing line rate reset:', err);
      setError(err instanceof Error
        ? err.message
        : t('contractLines.errors.failedToResetRate', { defaultValue: 'Failed to reset the line rate' }));
    } finally {
      setIsPreparingReset(false);
    }
  };

  const confirmResetLineRateToStandard = async () => {
    if (!resetConfirmation) return;
    setIsResettingLine(true);
    try {
      const result = await resetContractLineRateToStandard(resetConfirmation.line.contract_line_id);
      if ('refused' in result && result.refused.length > 0) {
        setError(result.refused[0].reason);
        return;
      }
      if (!('applied' in result)) {
        setError(getErrorMessage(result));
        return;
      }
      await fetchData();
      onContractLinesChanged?.();
      setResetConfirmation(null);
    } catch (err) {
      console.error('Error resetting line rate:', err);
      setError(err instanceof Error
        ? err.message
        : t('contractLines.errors.failedToResetRate', { defaultValue: 'Failed to reset the line rate' }));
    } finally {
      setIsResettingLine(false);
    }
  };

  const handleEditContractLine = async (line: DetailedContractLineMapping, forceServiceReload = false) => {
    if (!contract.contract_id) return;
    setConflictLineId(null);

    try {
      // Use line-level claimed/invoiced history to decide whether ordinary
      // terms stay locked while keeping the narrow text/window editor available.
      const hasInvoices = await hasContractLineProtectedHistory(line.contract_line_id);
      const version = await getContractLineEditVersion(line.contract_line_id);
      if (typeof version !== 'string') {
        setError(isReturnedActionError(version)
          ? getErrorMessage(version)
          : t('contractLines.errors.failedToCheckEditable', { defaultValue: 'Failed to check if contract can be edited' }));
        return;
      }

      const services = await loadServicesForLine(line.contract_line_id, forceServiceReload);
      setPricingOnly(Boolean(hasInvoices));
      const boundary = await getNextContractServiceBoundary(line.contract_line_id);
      if (isReturnedActionError(boundary)) { setError(getErrorMessage(boundary)); return; }
      setEffectiveBoundary(typeof boundary === 'string' ? boundary : '');
      setRequiresEffectiveBoundary(typeof boundary === 'string');
      const effectiveServices = typeof boundary === 'string' ? await Promise.all(services.map(async service => {
        if (service.typeConfig?.pricing_basis !== 'unit' && service.configuration.configuration_type !== 'Usage') return service;
        const details = await getConfigurationWithDetails(service.configuration.config_id, boundary);
        if (isReturnedActionError(details)) throw new Error(getErrorMessage(details));
        return {...service, configuration: {...service.configuration, ...details.baseConfig}, typeConfig: details.typeConfig, rateTiers: details.rateTiers};
      })) : services;
      // Expand the line if not already expanded (like clicking the caret)
      const isCurrentlyExpanded = expandedLines[line.contract_line_id];
      if (!isCurrentlyExpanded) {
        setExpandedLines(prev => ({
          ...prev,
          [line.contract_line_id]: true
        }));
      }

      // Load services for the line (returns cached if already loaded)
      // Start editing - populate edit data from the line
      setEditingLineId(line.contract_line_id);
      setEditLineVersion(version);
      setEditLineData({
        billing_timing: resolveEffectiveBillingTiming(line.contract_line_type, line.billing_timing),
        cadence_owner: line.cadence_owner ?? 'client',
        minimum_billable_time: line.minimum_billable_time,
        round_up_to_nearest: line.round_up_to_nearest,
        location_id: line.location_id ?? defaultLocationId ?? null,
        invoice_line_description: line.invoice_line_description ?? null,
        start_date: line.start_date ?? null,
        end_date: line.end_date ?? null,
      });
      initializeServiceConfigEdits(
        effectiveServices,
        await loadSavedBucketOverlays(line.contract_line_id),
      );
      resetServiceMembershipDraft();
    } catch (err) {
      console.error('Error checking contract invoices:', err);
      setError(t('contractLines.errors.failedToCheckEditable', {
        defaultValue: 'Failed to check if contract can be edited',
      }));
    }
  };

  // One-shot edit intent (Overview "Edit"): once the target line has loaded, open it in the
  // same edit mode the Edit button uses, then tell the parent to clear the intent. The ref
  // guards against refetches/re-renders re-running it while the async edit setup is in flight;
  // clearing the intent in the parent keeps later manual collapses from re-triggering edit mode.
  const handleEditRef = useRef(handleEditContractLine);
  handleEditRef.current = handleEditContractLine;
  const consumedEditIntentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editIntentLineId) {
      consumedEditIntentRef.current = null;
      return;
    }
    if (consumedEditIntentRef.current === editIntentLineId) return;
    const target = contractLines.find((line) => line.contract_line_id === editIntentLineId);
    if (!target) return; // lines not loaded yet; effect re-runs when they arrive
    consumedEditIntentRef.current = editIntentLineId;
    if (!isReadOnly) {
      void handleEditRef.current(target);
    }
    onEditIntentConsumed?.();
  }, [editIntentLineId, contractLines, isReadOnly, onEditIntentConsumed]);

  const handleEffectiveBoundaryChange = async (contractLineId: string, boundary: string) => {
    setEffectiveBoundary(boundary);
    if (!boundary) return;
    setSavingLineId(contractLineId);
    try {
      const services = lineServices[contractLineId] ?? [];
      const effectiveServices = await Promise.all(services.map(async service => {
        if (service.typeConfig?.pricing_basis !== 'unit' && service.configuration.configuration_type !== 'Usage') return service;
        const details = await getConfigurationWithDetails(service.configuration.config_id, boundary);
        if (isReturnedActionError(details)) throw new Error(getErrorMessage(details));
        return { ...service, configuration: { ...service.configuration, ...details.baseConfig }, typeConfig: details.typeConfig, rateTiers: details.rateTiers };
      }));
      initializeServiceConfigEdits(
        effectiveServices,
        await loadSavedBucketOverlays(contractLineId),
      );
    } catch (err) {
      setEffectiveBoundary('');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingLineId(null);
    }
  };

  const handleRemoveService = (contractLineId: string, serviceId: string, configId: string) => {
    setError(null);
    if (configId.startsWith(DRAFT_SERVICE_CONFIG_PREFIX)) {
      setPendingServiceAdditions((current) =>
        current.filter((addition) => addition.selection.service.service_id !== serviceId)
      );
      setEditServiceConfigs((current) => {
        const next = { ...current };
        delete next[configId];
        return next;
      });
      setEditBucketConfigs((current) => {
        const next = { ...current };
        delete next[serviceId];
        return next;
      });
      return;
    }

    if (!lineServices[contractLineId]?.some((service) => service.service.service_id === serviceId)) {
      return;
    }

    setPendingServiceRemovalIds((current) =>
      current.includes(serviceId) ? current : [...current, serviceId]
    );
  };

  const handleServicesSelected = (
    contractLineId: string,
    selections: ContractLineServiceSelection[],
  ) => {
    const persistedServiceIds = new Set(
      (lineServices[contractLineId] || []).map((service) => service.service.service_id)
    );
    const pendingServiceIds = new Set(
      pendingServiceAdditions.map((addition) => addition.selection.service.service_id)
    );
    const newSelections = selections.filter((selection) => {
      const serviceId = selection.service.service_id;
      return !persistedServiceIds.has(serviceId) && !pendingServiceIds.has(serviceId);
    });
    const newAdditions = newSelections.map((selection) => ({
      selection,
      draftConfigurationId: `${DRAFT_SERVICE_CONFIG_PREFIX}${selection.service.service_id}`,
    }));

    setPendingServiceRemovalIds((current) =>
      current.filter((serviceId) => !selections.some(
        (selection) => selection.service.service_id === serviceId && persistedServiceIds.has(serviceId)
      ))
    );
    setPendingServiceAdditions((current) => [...current, ...newAdditions]);
    setEditServiceConfigs((configs) => {
      const next = { ...configs };
      for (const addition of newAdditions) {
        const { selection, draftConfigurationId } = addition;
        next[draftConfigurationId] = {
          quantity: selection.quantity,
          custom_rate: selection.customRate,
          hourly_rate: 'hourly_rate' in selection.typeConfig
            ? selection.typeConfig.hourly_rate
            : undefined,
          base_rate: 'base_rate' in selection.typeConfig
            ? selection.typeConfig.base_rate
            : undefined,
          unit_of_measure: 'unit_of_measure' in selection.typeConfig
            ? selection.typeConfig.unit_of_measure
            : undefined,
        };
      }
      return next;
    });
    setEditBucketConfigs((configs) => {
      const next = { ...configs };
      for (const addition of newAdditions) {
        next[addition.selection.service.service_id] = null;
      }
      return next;
    });
  };

  // Conflict recovery: reload the line, its services and the version token, then
  // re-enter edit mode on the fresh state. The stale draft is discarded; the
  // user re-applies their edit against what is actually stored.
  const handleReloadAfterConflict = async () => {
    const lineId = conflictLineId;
    if (!lineId || !contract.contract_id) return;
    setError(null);
    setConflictLineId(null);
    try {
      const latest = await getDetailedContractLines(contract.contract_id);
      if (isReturnedActionError(latest)) {
        setError(getErrorMessage(latest));
        return;
      }
      setContractLines(latest);
      const line = latest.find((l) => l.contract_line_id === lineId);
      if (!line) return;
      setLineServices((prev) => {
        const next = { ...prev };
        delete next[lineId];
        return next;
      });
      await handleEditContractLine(line, true);
    } catch (err) {
      console.error('Error reloading contract line after conflict:', err);
      setError(t('contractLines.errors.failedToLoad', { defaultValue: 'Failed to load contract lines' }));
    }
  };

  const handleSaveContractLine = async (contractLineId: string) => {
    if (requiresEffectiveBoundary && !effectiveBoundary) return;
    if (!editLineVersion) {
      setError(t('contractLines.errors.failedToUpdate', { defaultValue: 'Failed to update contract line' }));
      return;
    }
    setSavingLineId(contractLineId);
    try {
      // The whole edit is one intent, applied by one server action in one
      // transaction: it either all happened or none of it did. Storage details
      // (base_rate_basis, revision vs in-place update) are the server's call.
      const narrowInvoiceEdit = {
        invoice_line_description: editLineData.invoice_line_description?.trim() || null,
        start_date: editLineData.start_date || null,
        end_date: editLineData.end_date || null,
      };
      const line: ContractLineEditDraft['line'] = pricingOnly ? narrowInvoiceEdit : {
        billing_timing: resolveEffectiveBillingTiming(
          contractLines.find((l) => l.contract_line_id === contractLineId)?.contract_line_type,
          editLineData.billing_timing,
        ),
        cadence_owner: editLineData.cadence_owner,
        minimum_billable_time: editLineData.minimum_billable_time,
        round_up_to_nearest: editLineData.round_up_to_nearest,
        location_id: editLineData.location_id ?? null,
        ...narrowInvoiceEdit,
      };

      const services = (lineServices[contractLineId] || []).filter(
        (service) => !pendingServiceRemovalIds.includes(service.service.service_id)
      );
      const serviceById = new Map(services.map((svc) => [svc.service.service_id, svc]));

      const members: ContractLineEditMemberDraft[] = [];
      for (const [configId, editData] of Object.entries(editServiceConfigs)) {
        if (configId.startsWith(DRAFT_SERVICE_CONFIG_PREFIX)) continue; // additions, below
        const serviceConfig = services.find((s) => s.configuration.config_id === configId);
        if (!serviceConfig || (pricingOnly && serviceConfig.typeConfig?.pricing_basis !== 'unit' && serviceConfig.configuration.configuration_type !== 'Usage')) continue;
        const configurationType = serviceConfig.configuration.configuration_type;
        const member: ContractLineEditMemberDraft = {
          config_id: configId,
          service_id: serviceConfig.service.service_id,
        };
        if (configurationType === 'Usage') {
          Object.assign(member, {
            base_rate: editData.base_rate,
            measurement_mode: editData.measurement_mode,
            minimum_usage: editData.minimum_usage,
            enable_tiered_pricing: editData.enable_tiered_pricing,
            unit_of_measure: editData.unit_of_measure,
            rateTiers: editData.rateTiers,
          });
        } else {
          member.quantity = editData.quantity;
          member.custom_rate = editData.custom_rate;
          if (configurationType === 'Hourly') member.hourly_rate = editData.hourly_rate;
          if (configurationType === 'Fixed') member.base_rate = editData.base_rate;
        }
        members.push(member);
      }

      const addedServiceIds: string[] = [];
      if (!pricingOnly) {
        for (const addition of pendingServiceAdditions) {
          const editData = editServiceConfigs[addition.draftConfigurationId] || {};
          const { selection } = addition;
          const type = selection.configurationType;
          addedServiceIds.push(selection.service.service_id);
          members.push({
            service_id: selection.service.service_id,
            configuration_type: type,
            quantity: editData.quantity ?? selection.quantity,
            custom_rate: editData.custom_rate ?? selection.customRate,
            ...(type === 'Hourly' ? { hourly_rate: editData.hourly_rate ?? selection.customRate } : {}),
            ...(type === 'Fixed' ? { base_rate: editData.base_rate ?? selection.customRate } : {}),
            ...(type === 'Usage'
              ? {
                  base_rate: editData.base_rate ?? selection.customRate,
                  measurement_mode: editData.measurement_mode ?? 'additive',
                  minimum_usage: editData.minimum_usage ?? 0,
                  enable_tiered_pricing: editData.enable_tiered_pricing ?? false,
                  unit_of_measure:
                    editData.unit_of_measure || selection.service.unit_of_measure || resolveUnitOfMeasure({ fallback: 'C62' }).label,
                  rateTiers: editData.rateTiers ?? [],
                }
              : {}),
          });
        }
      }

      const bucketOverlays: ContractLineEditDraft['bucket_overlays'] = [];
      for (const [serviceId, bucketConfig] of Object.entries(pricingOnly ? {} : editBucketConfigs)) {
        if (pendingServiceRemovalIds.includes(serviceId)) continue;
        if (bucketConfig && bucketConfig.total_minutes !== undefined && bucketConfig.overage_rate !== undefined) {
          bucketOverlays.push({
            service_id: serviceId,
            overlay: {
              total_minutes: bucketConfig.total_minutes,
              overage_rate: bucketConfig.overage_rate,
              allow_rollover: bucketConfig.allow_rollover ?? false,
              billing_period: bucketConfig.billing_period ?? 'monthly',
            },
          });
        } else if (!bucketConfig && (
          serviceById.get(serviceId)?.bucketConfig
          || savedBucketOverlayServiceIds.includes(serviceId)
        )) {
          // The switch was turned off on a service that has a saved overlay.
          bucketOverlays.push({ service_id: serviceId, overlay: null });
        }
      }

      const result = await saveContractLineEdit(contractLineId, {
        line,
        members,
        removed_config_ids: [],
        added_service_ids: addedServiceIds,
        removed_service_ids: pricingOnly ? [] : pendingServiceRemovalIds,
        bucket_overlays: bucketOverlays,
        effective_boundary: effectiveBoundary || null,
        expected_version: editLineVersion,
      });

      // Failure or conflict: nothing was written. Keep the editor open with the
      // draft intact and say why. No reload, no partial-failure path.
      if (isContractLineConflict(result)) {
        setError(t(result.messageKey, { defaultValue: result.message }));
        setConflictLineId(contractLineId);
        return;
      }
      if (isReturnedActionError(result)) {
        const actionFailure = result as { messageKey?: string; messageParams?: Record<string, string | number> };
        setError(actionFailure.messageKey
          ? t(actionFailure.messageKey, { ...(actionFailure.messageParams ?? {}), defaultValue: getErrorMessage(result) })
          : getErrorMessage(result));
        return;
      }

      // If the saved line adopts a pending location, drop it from the pending set
      // so the group is no longer rendered as a placeholder.
      if (editLineData.location_id) {
        setPendingLocationIds((prev) => prev.filter((id) => id !== editLineData.location_id));
      }

      // Clear cached services for this line and reload once.
      setLineServices(prev => {
        const updated = { ...prev };
        delete updated[contractLineId];
        return updated;
      });
      await loadServicesForLine(contractLineId, true);
      await fetchData();
      setEditingLineId(null);
      setEditLineData({});
      setEditLineVersion(null);
      setEditServiceConfigs({});
      setEditBucketConfigs({});
      setSavedBucketOverlayServiceIds([]);
      resetServiceMembershipDraft();
      setShowServiceSelectionDialog(false);
      onContractLinesChanged?.();
    } catch (err) {
      console.error('Error updating contract line:', err);
      setError(err instanceof Error ? err.message : t('contractLines.errors.failedToUpdate', { defaultValue: 'Failed to update contract line' }));
    } finally {
      setSavingLineId((current) => (current === contractLineId ? null : current));
    }
  };

  const handleCancelEdit = () => {
    setConflictLineId(null);
    setEditingLineId(null);
    setEditLineData({});
    setEditLineVersion(null);
    setEditServiceConfigs({});
    setEditBucketConfigs({});
    setSavedBucketOverlayServiceIds([]);
    resetServiceMembershipDraft();
    setShowServiceSelectionDialog(false);
  };

  const formatRate = (rate?: number | null) => {
    if (rate === undefined || rate === null) {
      return t('common.empty.notAvailable', { defaultValue: 'N/A' });
    }
    return formatCurrency(rate / 100, contract.currency_code || 'USD');
  };

  // Catalog-priced recurring product members have no stored rate; their effective unit price
  // comes from the shared resolver (the invoice engine's chain) fed by the shared catalog lookup.
  const { money: formatMinorMoney } = useCurrencyFormat();
  const recurringProductIds = useMemo(
    () => Object.values(lineServices)
      .flat()
      .filter((member) => member.service.item_kind === 'product')
      .map((member) => member.service.service_id),
    [lineServices],
  );
  const { rates: productCatalogRates, canViewCost: canViewProductCost } = useProductCatalogRates(
    contract.currency_code,
    recurringProductIds,
  );

  /** Read-only unit price of a recurring product member: price, catalog/override label, cost. */
  const renderRecurringProductRate = (serviceConfig: ServiceConfiguration) => {
    const currencyCode = contract.currency_code;
    const lookup = productCatalogRates[serviceConfig.service.service_id];
    // Exactly the engine's inputs (computeRecurringQuantityCharges): the fixed config's
    // base_rate is not one of them — the engine never reads it for a product member.
    const member = {
      configuration_custom_rate: serviceConfig.configuration.custom_rate,
      service_line_custom_rate: serviceConfig.service_line_custom_rate,
      price_rate: lookup?.currency_rate,
      default_rate: lookup?.default_rate,
    };
    if (!currencyCode) {
      return formatRate(null);
    }
    if (!hasRecurringMemberRate(member)) {
      // Still loading: claim nothing. Loaded with no rate anywhere in the chain: the engine
      // cannot bill this member, so say so instead of showing an amount it will not charge.
      return lookup
        ? (
          <span className="text-amber-700" data-testid={`recurring-product-missing-price-${serviceConfig.configuration.config_id}`}>
            {t('wizardProducts.validation.noCurrencyPriceEnterUnitPrice', {
              defaultValue: 'No {{currency}} price in the catalog. Enter a unit price.',
              currency: currencyCode,
            })}
          </span>
        )
        : formatRate(null);
    }
    const { rateCents, source } = resolveRecurringMemberRate(member);
    const isOverride = source !== 'currency catalog price';
    const showCost = canViewProductCost && lookup?.cost != null;
    const costCurrency = lookup?.cost_currency || currencyCode;
    const margin = showCost
      ? productUnitMarginCents(rateCents, lookup?.cost, lookup?.cost_currency, currencyCode)
      : null;
    return (
      <>
        <span data-testid={`recurring-product-price-${serviceConfig.configuration.config_id}`}>
          {formatMinorMoney(rateCents, currencyCode)}
        </span>{' '}
        <span className="text-xs text-muted-foreground">
          ({isOverride
            ? t('contractLines.pricing.override', { defaultValue: 'override' })
            : t('contractLines.pricing.catalog', { defaultValue: 'catalog' })})
        </span>
        {showCost ? (
          <span
            className="block text-xs text-muted-foreground"
            data-testid={`recurring-product-cost-${serviceConfig.configuration.config_id}`}
          >
            {costCurrency !== currencyCode
              ? t('contractLines.pricing.costInCurrency', {
                  defaultValue: 'Cost in {{currency}}: {{cost}}',
                  currency: costCurrency,
                  cost: formatMinorMoney(lookup?.cost ?? 0, costCurrency),
                })
              : t('contractLines.pricing.cost', {
                  defaultValue: 'Cost: {{cost}}',
                  cost: formatMinorMoney(lookup?.cost ?? 0, currencyCode),
                })}
            {margin !== null
              ? ` · ${t('contractLines.pricing.margin', {
                  defaultValue: 'Margin: {{margin}} per unit',
                  margin: formatMinorMoney(margin, currencyCode),
                })}`
              : ''}
          </span>
        ) : null}
      </>
    );
  };

  const editingLine = editingLineId
    ? contractLines.find((line) => line.contract_line_id === editingLineId)
    : undefined;
  const editingLineServiceIds = useMemo(() => editingLineId
    ? [
        ...(lineServices[editingLineId] || [])
          .filter(
            (service) =>
              service.configuration.configuration_type !== 'Bucket' &&
              !pendingServiceRemovalIds.includes(service.service.service_id)
          )
          .map((service) => service.service.service_id),
        ...pendingServiceAdditions.map((addition) => addition.selection.service.service_id),
      ]
    : [], [editingLineId, lineServices, pendingServiceAdditions, pendingServiceRemovalIds]);

  if (isLoading) {
    return (
      <Card size="2">
        <Box p="8">
          <LoadingIndicator
            layout="stacked"
            className="py-6 text-muted-foreground"
            spinnerProps={{ size: 'md' }}
            text={t('contractLines.loading.contractLines', { defaultValue: 'Loading contract lines' })}
          />
        </Box>
      </Card>
    );
  }

  return (
    <Card size="2">
      <Box p="4" className="space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-medium">
              {t('contractLines.title', { defaultValue: 'Contract Lines' })}
            </h3>
            <p className="text-sm text-muted-foreground">
              {isReadOnly
                ? t('contractLines.description.readOnly', {
                  defaultValue: 'This system-managed default contract is attribution-only. Contract line authoring is disabled.',
                })
                : t('contractLines.description.default', {
                  defaultValue: 'Manage the contract lines and services for this contract',
                })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {clientId && locationSelectOptions.length > 0 && (
              <CustomSelect
                id="add-location-group-select"
                value=""
                placeholder={t('contractLines.location.addLocation', { defaultValue: '+ Add location' })}
                options={locationSelectOptions.filter((opt) => {
                  // Only offer locations that aren't already represented as a group.
                  const usedIds = new Set<string | null>(
                    contractLines.map((line) => line.location_id ?? null),
                  );
                  for (const pending of pendingLocationIds) {
                    usedIds.add(pending);
                  }
                  return !usedIds.has(opt.value);
                })}
                onValueChange={(value) => {
                  if (value && !pendingLocationIds.includes(value)) {
                    setPendingLocationIds((prev) => [...prev, value]);
                  }
                }}
                disabled={isReadOnly}
                className="w-[220px]"
              />
            )}
            <Button
              id="add-contract-line-from-preset-btn"
              variant="outline"
              onClick={() => setShowAddDialog(true)}
              disabled={isReadOnly}
            >
              <Plus className="h-4 w-4 mr-2" />
              {t('contractLines.actions.addFromPresets', { defaultValue: 'Add from Presets' })}
            </Button>
            <Button
              id="create-custom-contract-line-btn"
              onClick={() => setShowCreateCustomDialog(true)}
              disabled={isReadOnly}
            >
              <Plus className="h-4 w-4 mr-2" />
              {t('contractLines.actions.createCustom', { defaultValue: 'Create Custom' })}
            </Button>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error}
              {conflictLineId && (
                <Button
                  id="contract-line-conflict-reload"
                  variant="outline"
                  size="sm"
                  className="ml-3"
                  onClick={() => { void handleReloadAfterConflict(); }}
                >
                  {t('contractLines.errors.reloadLatest', { defaultValue: 'Reload latest' })}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {contractLines.length === 0 && pendingLocationIds.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>{t('contractLines.empty.noneAdded', { defaultValue: 'No contract lines added yet.' })}</p>
            <p className="text-sm mt-1">
              {t('contractLines.empty.selectAbove', { defaultValue: 'Select a contract line above to get started.' })}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groupedLines.map((group) => {
              const location = group.locationId ? locationsById[group.locationId] : null;
              const headerAddress = formatLocationAddress(location);
              const headerName =
                location?.location_name
                  ?? (group.locationId
                    ? t('contractLines.location.fallback', { defaultValue: 'Location' })
                    : t('contractLines.location.unassigned', { defaultValue: 'No location assigned' }));
              const canRemovePendingGroup =
                group.isPending
                && !isReadOnly
                && group.locationId !== null
                && group.locationId !== defaultLocationId;

              return (
                <div
                  key={`group-${group.key}`}
                  className={shouldRenderGrouped ? 'space-y-2' : 'contents'}
                >
                  {shouldRenderGrouped && (
                    <div
                      id={`contract-line-location-group-${group.key}`}
                      className="flex items-start justify-between gap-3 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-primary-50))]/50 px-4 py-2"
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        <MapPin className="h-4 w-4 text-[rgb(var(--color-primary-600))] mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[rgb(var(--color-text-900))] truncate">
                            {headerName}
                          </p>
                          {headerAddress && (
                            <p className="text-xs text-muted-foreground truncate">
                              {headerAddress}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {group.lines.length === 1
                              ? t('contractLines.location.lineCountSingle', {
                                count: group.lines.length,
                                defaultValue: '{{count}} line',
                              })
                              : t('contractLines.location.lineCountPlural', {
                                count: group.lines.length,
                                defaultValue: '{{count}} lines',
                              })}
                          </p>
                        </div>
                      </div>
                      {canRemovePendingGroup && (
                        <Button
                          id={`remove-pending-location-group-${group.key}`}
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setPendingLocationIds((prev) =>
                              prev.filter((id) => id !== group.locationId),
                            )
                          }
                          className="h-7 text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-4 w-4" />
                          <span className="sr-only">
                            {t('contractLines.location.removePendingGroup', {
                              defaultValue: 'Remove empty location group',
                            })}
                          </span>
                        </Button>
                      )}
                    </div>
                  )}

                  {group.isPending && group.lines.length === 0 ? (
                    <div className="rounded-md border border-dashed border-[rgb(var(--color-border-200))] bg-muted/50 p-4 text-center text-sm text-muted-foreground">
                      {t('contractLines.location.pendingEmptyHint', {
                        defaultValue:
                          'No contract lines yet for this location. Add a line, then assign it to this location via its Edit panel.',
                      })}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {group.lines.map((line) => {
              const isExpanded = expandedLines[line.contract_line_id];
              const persistedServices = lineServices[line.contract_line_id] || [];
              const services = editingLineId === line.contract_line_id
                ? [
                    ...persistedServices.filter(
                      (service) => !pendingServiceRemovalIds.includes(service.service.service_id)
                    ),
                    ...pendingServiceAdditions.map((addition) =>
                      createDraftServiceConfiguration(line.contract_line_id, addition)
                    ),
                  ]
                : persistedServices;
              const isLoadingServices = loadingServices[line.contract_line_id];
              const isSavingLine = savingLineId === line.contract_line_id;

              return (
                <div
                  key={line.contract_line_id}
                  id={`contract-line-card-${line.contract_line_id}`}
                  className={`border rounded-lg overflow-hidden bg-card ${focusContractLineId === line.contract_line_id ? 'ring-2 ring-primary-500' : ''}`}
                >
                  {/* Header */}
                  <div className="flex items-center gap-3 p-4 bg-muted border-b">
                    <button
                      type="button"
                      onClick={() => toggleExpand(line.contract_line_id)}
                      className="p-1 hover:bg-muted rounded transition-colors"
                      aria-label={isExpanded
                        ? t('contractLines.actions.collapseLine', { defaultValue: 'Collapse contract line' })
                        : t('contractLines.actions.expandLine', { defaultValue: 'Expand contract line' })}
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-muted-foreground" />
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[rgb(var(--color-text-900))]">
                        <span className="sr-only">
                          {t('contractLines.columns.name', { defaultValue: 'Name' })}:{' '}
                        </span>
                        {line.contract_line_name}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <span>{t('contractLines.columns.type', { defaultValue: 'Type' })}:</span>
                        <Badge
                          variant={
                            line.display_kind === 'PrepaidBlock'
                              ? 'primary'
                              : line.contract_line_type === 'Fixed'
                              ? 'info'
                              : line.contract_line_type === 'Hourly'
                              ? 'success'
                              : line.contract_line_type === 'Usage'
                              ? 'warning'
                              : 'default-muted'
                          }
                          className="text-xs"
                        >
                          {formatContractLineType(line.display_kind ?? line.contract_line_type)}
                        </Badge>
                        <span>•</span>
                        <span>
                          {t('contractLines.columns.frequency', { defaultValue: 'Frequency' })}: {formatBillingFrequency(line.billing_frequency)}
                        </span>
                        <span>•</span>
                        <span data-testid={`contract-line-billing-timing-${line.contract_line_id}`}>
                          {t('billing.labels.timing', { defaultValue: 'Billing Timing' })}:{' '}
                          {getContractLineBillingTimingLabel(t, line.contract_line_type, line.billing_timing)}
                        </span>
                        {services.length > 0 && (
                          <>
                            <span>•</span>
                            <span>
                              {t('contractLines.columns.services', { defaultValue: 'Services' })}:{' '}
                              {services.length === 1
                                ? t('contractLines.serviceCountSingle', {
                                  count: services.length,
                                  defaultValue: '{{count}} service',
                                })
                                : t('contractLines.serviceCountPlural', {
                                  count: services.length,
                                  defaultValue: '{{count}} services',
                                })}
                            </span>
                          </>
                        )}
                        {line.default_rate !== null && line.default_rate !== undefined && (
                          <>
                            <span>•</span>
                            <span>
                              {t('contractLines.columns.rate', { defaultValue: 'Rate' })}: {formatRate(line.default_rate)}
                            </span>
                          </>
                        )}
                        {(() => {
                          const provenance = line.rate_provenance ?? null;
                          if (provenance === 'inherited') {
                            return (
                              <>
                                <span>•</span>
                                <Badge variant="default-muted">
                                  {t('contractLines.rateProvenance.standard', { defaultValue: 'Standard' })}
                                </Badge>
                              </>
                            );
                          }
                          if (provenance === 'unreviewed') {
                            return (
                              <>
                                <span>•</span>
                                <Badge variant="warning">
                                  {t('contractLines.rateProvenance.unreviewed', { defaultValue: 'Unreviewed' })}
                                </Badge>
                              </>
                            );
                          }
                          // A stored rate with no label is a pre-migration row;
                          // the resolver treats it as custom/unreviewed by rate
                          // presence, so the badge does the same.
                          const isCustom =
                            provenance === 'custom' ||
                            (provenance === null &&
                              line.custom_rate !== null &&
                              line.custom_rate !== undefined);
                          if (!isCustom) {
                            return null;
                          }
                          return (
                            <>
                              <span>•</span>
                              <span className="inline-flex items-center gap-1 font-medium text-[rgb(var(--color-primary-700))]">
                                <Badge variant="secondary">
                                  {t('contractLines.rateProvenance.custom', { defaultValue: 'Custom' })}
                                </Badge>
                                {formatRate(line.custom_rate)}
                              </span>
                            </>
                          );
                        })()}
                        {(line.start_date || line.end_date) && (
                          <>
                            <span>•</span>
                            <span>
                              {t('contractLines.columns.dates', { defaultValue: 'Dates' })}:{' '}
                              {line.start_date || '—'} → {line.end_date || '—'}
                            </span>
                          </>
                        )}
                        {line.location_id && (
                          <>
                            <span>•</span>
                            <span className="inline-flex items-center gap-1 text-[rgb(var(--color-primary-700))]">
                              <MapPin className="h-3 w-3" />
                              {locationsById[line.location_id]?.location_name
                                ?? locationsById[line.location_id]?.address_line1
                                ?? t('contractLines.location.fallback', { defaultValue: 'Location' })}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div
                      className="flex items-center gap-2"
                      aria-label={t('contractLines.columns.actions', { defaultValue: 'Actions' })}
                    >
                      <Button
                        id={`edit-${line.contract_line_id}`}
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditContractLine(line);
                        }}
                        className="h-8 text-muted-foreground hover:text-[rgb(var(--color-text-700))] hover:bg-muted"
                        disabled={isReadOnly}
                      >
                        <Edit className="h-4 w-4 mr-1" />
                        {t('common.actions.edit', { defaultValue: 'Edit' })}
                      </Button>
                      {line.custom_rate !== null && line.custom_rate !== undefined && (
                        <Button
                          id={`reset-line-rate-to-standard-${line.contract_line_id}`}
                          data-line-id={line.contract_line_id}
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            void openResetConfirmation(line);
                          }}
                          className="h-8 text-muted-foreground hover:text-[rgb(var(--color-text-700))] hover:bg-muted"
                          disabled={isReadOnly || isPreparingReset || isResettingLine}
                        >
                          <RotateCcw className="h-4 w-4 mr-1" />
                          {t('contractLines.actions.resetToStandard', { defaultValue: 'Reset to standard' })}
                        </Button>
                      )}
                      <Button
                        id={`remove-${line.contract_line_id}`}
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          const confirmed = window.confirm(t('contractLines.dialogs.confirmRemove', {
                            defaultValue: 'Remove contract line "{{name}}"?',
                            name: line.contract_line_name,
                          }));
                          if (!confirmed) return;
                          handleRemoveContractLine(line.contract_line_id);
                        }}
                        className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        disabled={isReadOnly}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        {t('common.actions.remove', { defaultValue: 'Remove' })}
                      </Button>
                    </div>
                  </div>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div className="p-4 bg-card border-t">
                      {isLoadingServices ? (
                        <div className="flex items-center justify-center py-8 text-muted-foreground">
                          <LoadingIndicator
                            layout="inline"
                            spinnerProps={{ size: 'sm' }}
                            text={t('contractLines.loading.inline', { defaultValue: 'Loading...' })}
                          />
                        </div>
                      ) : (
                        <div className="space-y-6">
                          {/* Contract Line Configuration Section */}
                          <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-muted p-4 space-y-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold text-[rgb(var(--color-text-900))]">
                                  {t('contractLines.configuration.title', { defaultValue: 'Contract Line Configuration' })}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {t('contractLines.configuration.description', {
                                    defaultValue: 'Settings that apply to this contract line',
                                  })}
                                </p>
                              </div>
                              {editingLineId === line.contract_line_id ? (
                                <div className="flex gap-2">
                                  <Button
                                    id={`save-line-${line.contract_line_id}`}
                                    type="button"
                                    size="sm"
                                    onClick={() => handleSaveContractLine(line.contract_line_id)}
                                    className="gap-2"
                                    disabled={isSavingLine || (requiresEffectiveBoundary && !effectiveBoundary)}
                                  >
                                    {isSavingLine ? (
                                      <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        {t('common.actions.saving', { defaultValue: 'Saving...' })}
                                      </>
                                    ) : (
                                      <>
                                        <Check className="h-4 w-4" />
                                        {t('common.actions.save', { defaultValue: 'Save' })}
                                      </>
                                    )}
                                  </Button>
                                  <Button
                                    id={`cancel-line-${line.contract_line_id}`}
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={handleCancelEdit}
                                    className="gap-2"
                                    disabled={isSavingLine}
                                  >
                                    <X className="h-4 w-4" />
                                    {t('common.actions.cancel', { defaultValue: 'Cancel' })}
                                  </Button>
                                </div>
                              ) : null}
                            </div>

                            {/* Location picker — only shown when the contract has an owning
                                client and at least one active location. Location is a
                                group-level assignment in the plan; per-row pickers are
                                explicitly forbidden, but each contract line is itself the
                                atomic billing unit that maps to exactly one location, so
                                this picker acts as the group-level selector for this line's
                                group. */}
                            {clientId && locationSelectOptions.length > 0 && (
                              <div className="grid gap-4 md:grid-cols-2">
                                <div className="md:col-span-2">
                                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                    {t('contractLines.location.label', { defaultValue: 'Location' })}
                                  </Label>
                                  {editingLineId === line.contract_line_id && !pricingOnly ? (
                                    <CustomSelect
                                      id={`location-${line.contract_line_id}`}
                                      value={editLineData.location_id ?? ''}
                                      onValueChange={(value) =>
                                        setEditLineData({
                                          ...editLineData,
                                          location_id: value ? value : null,
                                        })
                                      }
                                      options={locationSelectOptions}
                                      placeholder={t('contractLines.location.placeholder', {
                                        defaultValue: 'Select a location',
                                      })}
                                      className="mt-1"
                                    />
                                  ) : (
                                    <p className="mt-1 text-sm text-[rgb(var(--color-text-800))]">
                                      {line.location_id && locationsById[line.location_id]
                                        ? (locationsById[line.location_id].location_name
                                            ?? locationsById[line.location_id].address_line1
                                            ?? t('contractLines.location.fallback', { defaultValue: 'Location' }))
                                        : t('contractLines.location.none', { defaultValue: 'No location assigned' })}
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Billing profile (F045). Step 2 of the charge-attribution
                                chain and the most specific contract-side step: a line
                                assignment overrides its contract's. The picker renders
                                nothing while the client holds a single profile. */}
                            <BillingProfilePicker
                              id={`billing-profile-${line.contract_line_id}`}
                              clientId={clientId}
                              loadProfiles={loadBillingProfiles}
                              value={line.billing_profile_id ?? null}
                              onChange={(billingProfileId) =>
                                void handleAssignLineBillingProfile(line.contract_line_id, billingProfileId)
                              }
                              label={t('contractLines.billingProfile.label', { defaultValue: 'Billing profile' })}
                              unassignedLabel={t('contractLines.billingProfile.none', {
                                defaultValue: "Use the contract's profile",
                              })}
                              hint={t('contractLines.billingProfile.hint', {
                                defaultValue:
                                  'Charges from this line are billed to this profile, overriding the contract.',
                              })}
                              disabled={isReadOnly}
                            />

                            {/* Billing timing is editable for Fixed lines only (Hourly/Usage always bill in arrears); cadence owner applies to all recurring line types */}
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                  {t('billing.labels.timing', { defaultValue: 'Billing Timing' })}
                                </Label>
                                {editingLineId === line.contract_line_id && !pricingOnly ? (
                                  <BillingTimingField
                                    id={`billing-timing-${line.contract_line_id}`}
                                    lineType={line.contract_line_type}
                                    value={editLineData.billing_timing || line.billing_timing || 'arrears'}
                                    onChange={(value) => setEditLineData({
                                      ...editLineData,
                                      billing_timing: value
                                    })}
                                    hideHelp={isAdvanceTimingAllowedForLineType(line.contract_line_type)}
                                    className="mt-1"
                                  />
                                ) : (
                                  <p className="mt-1 text-sm text-[rgb(var(--color-text-800))]">
                                    {getContractLineBillingTimingLabel(t, line.contract_line_type, line.billing_timing)}
                                  </p>
                                )}
                                {line.contract_line_type === 'Fixed' && (
                                  <div className="mt-2">
                                    <ArrearsFirstInvoiceHint
                                      id={`first-invoice-hint-${line.contract_line_id}`}
                                      lineType={line.contract_line_type}
                                      cadenceOwner={
                                        editingLineId === line.contract_line_id && !pricingOnly
                                          ? editLineData.cadence_owner || line.cadence_owner || 'client'
                                          : line.cadence_owner || 'client'
                                      }
                                      billingTiming={
                                        editingLineId === line.contract_line_id && !pricingOnly
                                          ? editLineData.billing_timing || line.billing_timing || 'arrears'
                                          : line.billing_timing || 'arrears'
                                      }
                                      startDate={startDate}
                                      clientSchedule={clientSchedule}
                                      today={new Date()}
                                    />
                                  </div>
                                )}
                              </div>
                              <div>
                                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                  {t('billing.labels.cadenceOwner', { defaultValue: 'Cadence Owner' })}
                                </Label>
                                {editingLineId === line.contract_line_id && !pricingOnly ? (
                                  <CustomSelect
                                    id={`cadence-owner-${line.contract_line_id}`}
                                    value={editLineData.cadence_owner || line.cadence_owner || 'client'}
                                    onValueChange={(value) => setEditLineData({
                                      ...editLineData,
                                      cadence_owner: value as 'client' | 'contract'
                                    })}
                                    options={[...cadenceOwnerOptions]}
                                    className="mt-1"
                                  />
                                ) : (
                                  <p className="mt-1 text-sm text-[rgb(var(--color-text-800))]">
                                    {(line.cadence_owner || 'client') === 'contract'
                                      ? t('billing.cadenceOwner.contract', { defaultValue: 'Contract anniversary' })
                                      : t('billing.cadenceOwner.client', { defaultValue: 'Client schedule' })}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Invoice text and authored line window. The invoice
                                text prints verbatim on the recurring charge; the
                                dates bound this line inside the contract period. */}
                            <div className="grid gap-4 md:grid-cols-3">
                              <div className="md:col-span-1">
                                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                  {t('contractLines.configuration.invoiceText', { defaultValue: 'Invoice line text' })}
                                </Label>
                                {editingLineId === line.contract_line_id ? (
                                  <Input
                                    id={`invoice-text-${line.contract_line_id}`}
                                    value={editLineData.invoice_line_description ?? ''}
                                    onChange={(e) => setEditLineData({
                                      ...editLineData,
                                      invoice_line_description: e.target.value,
                                    })}
                                    placeholder={t('contractLines.configuration.invoiceTextPlaceholder', {
                                      defaultValue: 'Printed on the invoice; defaults to the line name',
                                    })}
                                    className="mt-1"
                                  />
                                ) : (
                                  <p className="mt-1 text-sm text-[rgb(var(--color-text-800))]">
                                    {line.invoice_line_description
                                      || t('contractLines.configuration.invoiceTextDefault', { defaultValue: 'Uses the line name' })}
                                  </p>
                                )}
                              </div>
                              <div>
                                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                  {t('contractLines.configuration.startDate', { defaultValue: 'Start date' })}
                                </Label>
                                {editingLineId === line.contract_line_id ? (
                                  <Input
                                    id={`line-start-date-${line.contract_line_id}`}
                                    type="date"
                                    value={editLineData.start_date ?? ''}
                                    onChange={(e) => setEditLineData({
                                      ...editLineData,
                                      start_date: e.target.value || null,
                                    })}
                                    className="mt-1"
                                  />
                                ) : (
                                  <p className="mt-1 text-sm text-[rgb(var(--color-text-800))]">
                                    {line.start_date || t('contractLines.configuration.inheritsContract', { defaultValue: 'Contract start' })}
                                  </p>
                                )}
                              </div>
                              <div>
                                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                  {t('contractLines.configuration.endDate', { defaultValue: 'End date' })}
                                </Label>
                                {editingLineId === line.contract_line_id ? (
                                  <Input
                                    id={`line-end-date-${line.contract_line_id}`}
                                    type="date"
                                    value={editLineData.end_date ?? ''}
                                    onChange={(e) => setEditLineData({
                                      ...editLineData,
                                      end_date: e.target.value || null,
                                    })}
                                    className="mt-1"
                                  />
                                ) : (
                                  <p className="mt-1 text-sm text-[rgb(var(--color-text-800))]">
                                    {line.end_date || t('contractLines.configuration.inheritsContractEnd', { defaultValue: 'Contract end' })}
                                  </p>
                                )}
                              </div>
                            </div>
                            {pricingOnly && editingLineId === line.contract_line_id && (
                              <p className="text-sm text-[rgb(var(--color-text-600))]">
                                {t('contractLines.configuration.billedEditExplanation', { defaultValue: 'After a line has billed, invoice text and line dates remain editable. Dates cannot exclude service periods already billed or claimed; rates and quantities use prospective changes.' })}
                              </p>
                            )}

                            <div className="grid gap-4 md:grid-cols-2">
                              {line.contract_line_type === 'Hourly' && (
                                <>
                                  <div>
                                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                      {t('contractLines.configuration.minimumBillableTime', {
                                        defaultValue: 'Minimum Billable Time (minutes)',
                                      })}
                                    </Label>
                                    {editingLineId === line.contract_line_id && !pricingOnly ? (
                                      <Input
                                        id={`min-billable-${line.contract_line_id}`}
                                        type="number"
                                        min="0"
                                        value={editLineData.minimum_billable_time ?? ''}
                                        onChange={(e) => setEditLineData({
                                          ...editLineData,
                                          minimum_billable_time: e.target.value ? parseInt(e.target.value) : undefined
                                        })}
                                        placeholder="15"
                                        onWheel={(e) => (e.target as HTMLInputElement).blur()}
                                        className="mt-1"
                                      />
                                    ) : (
                                      <p className="mt-1 text-sm text-[rgb(var(--color-text-800))]">
                                        {t('contractLines.configuration.minutesValue', {
                                          count: line.minimum_billable_time || 15,
                                          defaultValue: '{{count}} minutes',
                                        })}
                                      </p>
                                    )}
                                  </div>
                                  <div>
                                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                      {t('contractLines.configuration.roundUpToNearest', {
                                        defaultValue: 'Round Up To Nearest (minutes)',
                                      })}
                                    </Label>
                                    {editingLineId === line.contract_line_id && !pricingOnly ? (
                                      <Input
                                        id={`round-up-${line.contract_line_id}`}
                                        type="number"
                                        min="0"
                                        value={editLineData.round_up_to_nearest ?? ''}
                                        onChange={(e) => setEditLineData({
                                          ...editLineData,
                                          round_up_to_nearest: e.target.value ? parseInt(e.target.value) : undefined
                                        })}
                                        placeholder="15"
                                        onWheel={(e) => (e.target as HTMLInputElement).blur()}
                                        className="mt-1"
                                      />
                                    ) : (
                                      <p className="mt-1 text-sm text-[rgb(var(--color-text-800))]">
                                        {t('contractLines.configuration.minutesValue', {
                                          count: line.round_up_to_nearest || 15,
                                          defaultValue: '{{count}} minutes',
                                        })}
                                      </p>
                                    )}
                                  </div>
                                </>
                              )}

                              {/* Fixed contract line - show info message */}
                              {line.contract_line_type === 'Fixed' && !services.some(service => service.service.item_kind === 'product' || service.typeConfig?.pricing_basis === 'unit' || service.configuration.configuration_type === 'Usage') && (
                                <div className="col-span-2 space-y-2">
                                  <p className="text-sm text-muted-foreground">
                                    {t('contractLines.configuration.fixedInfo', {
                                      defaultValue: 'Fixed contract lines bill a flat recurring fee regardless of individual service rates.',
                                    })}
                                  </p>
                                  <Alert variant="info">
                                    <AlertDescription className="text-xs">
                                      <strong>
                                        {t('contractLines.configuration.fixedInfoHeading', {
                                          defaultValue: 'About service rates below:',
                                        })}
                                      </strong>{' '}
                                      {t('contractLines.configuration.fixedInfoDetails', {
                                        defaultValue: 'For fixed fee lines, the service rate and quantity are used only for tax allocation purposes. They determine how the fixed fee is proportionally attributed across services for tax calculations. The actual billed amount is the contract line\'s base rate shown above.',
                                      })}
                                    </AlertDescription>
                                  </Alert>
                                </div>
                              )}

                              {editingLineId === line.contract_line_id && services.some(service => service.typeConfig?.pricing_basis === 'unit' || service.configuration.configuration_type === 'Usage') && (
                                <div className="col-span-2">
                                  <Label htmlFor={`quantity-effective-${line.contract_line_id}`}>{t('contractLines.services.semanticsEffectiveFrom', {defaultValue: 'Service pricing and measurement changes effective from'})}</Label>
                                  <Input id={`quantity-effective-${line.contract_line_id}`} type="date" disabled={isSavingLine} value={effectiveBoundary} onChange={event => void handleEffectiveBoundaryChange(line.contract_line_id, event.target.value)} />
                                  <p className="text-sm text-muted-foreground">{t('contractLines.services.prospectiveSemanticsHelp', {defaultValue: 'Changes apply at this service-period boundary; earlier quantities, measurement and pricing are preserved. Changing the date reloads the applicable settings for review.'})}</p>
                                </div>
                              )}
                              {/* Usage contract line - show info message */}
                              {line.contract_line_type === 'Usage' && (
                                <div className="col-span-2">
                                  <p className="text-sm text-muted-foreground">
                                    {t('contractLines.configuration.usageInfo', {
                                      defaultValue: 'Usage-based contract lines are configured per service with unit rates.',
                                    })}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Services List Section */}
                          <div>
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <h4 className="text-sm font-medium text-[rgb(var(--color-text-700))]">
                                {t('contractLines.services.title', {
                                  count: services.filter(s => s.configuration.configuration_type !== 'Bucket').length,
                                  defaultValue: 'Services ({{count}})',
                                })}
                              </h4>
                              {editingLineId === line.contract_line_id && !pricingOnly && (
                                <Button
                                  id={`add-service-${line.contract_line_id}`}
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setShowServiceSelectionDialog(true)}
                                  disabled={isSavingLine}
                                >
                                  <Plus className="mr-1 h-4 w-4" />
                                  {t('createCustomLine.addItem', { defaultValue: 'Add Item' })}
                                </Button>
                              )}
                            </div>
                            {services.filter(s => s.configuration.configuration_type !== 'Bucket').length === 0 ? (
                              <div className="text-center py-8 text-muted-foreground bg-muted rounded-lg border border-[rgb(var(--color-border-200))]">
                                <p className="text-sm">
                                  {t('contractLines.services.empty', {
                                    defaultValue: 'No services configured for this contract line.',
                                  })}
                                </p>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {services.filter(s => s.configuration.configuration_type !== 'Bucket').map((serviceConfig, idx) => {
                                  const isUnitPriced = serviceConfig.typeConfig?.pricing_basis === 'unit';
                                  const isRecurringProduct = serviceConfig.service.item_kind === 'product';
                                  const isEditing = editingLineId === line.contract_line_id && (!pricingOnly || isUnitPriced || serviceConfig.configuration.configuration_type === 'Usage');
                                  const configId = serviceConfig.configuration.config_id;
                                  const editData = editServiceConfigs[configId] || {};

                                  return (
                                    <div
                                      key={`${serviceConfig.configuration.config_id}-${idx}`}
                                      className="rounded-lg border border-[rgb(var(--color-border-200))] bg-muted p-4 space-y-4"
                                    >
                                      <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="flex items-center gap-2">
                                          <div>
                                            <p className="font-semibold text-[rgb(var(--color-text-900))]">
                                              {serviceConfig.service.service_name}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                              {t('contractLines.services.typeLabel', {
                                                defaultValue: '{{type}} Service',
                                                type: formatContractLineType(serviceConfig.configuration.configuration_type),
                                              })}
                                            </p>
                                          </div>
                                          {/* Usage configs bill recorded usage, not a configured
                                              quantity — never badge a number billing ignores. */}
                                          {serviceConfig.configuration.configuration_type !== 'Hourly'
                                            && serviceConfig.configuration.configuration_type !== 'Usage' && (
                                            <Badge className="chip-primary border-[rgb(var(--color-primary-200))]">
                                              {t('contractLines.services.quantityShort', {
                                                defaultValue: 'Qty: {{quantity}}',
                                                quantity: isEditing
                                                  ? (editData.quantity ?? serviceConfig.configuration.quantity ?? 1)
                                                  : (serviceConfig.configuration.quantity ?? 1),
                                              })}
                                            </Badge>
                                          )}
                                        </div>
                                        {isEditing && !pricingOnly && (
                                          <Button
                                            id={`remove-service-${serviceConfig.configuration.config_id}`}
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleRemoveService(
                                              line.contract_line_id,
                                              serviceConfig.service.service_id,
                                              serviceConfig.configuration.config_id,
                                            )}
                                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                            disabled={isSavingLine}
                                          >
                                            <Trash2 className="mr-1 h-4 w-4" />
                                            {t('common.actions.remove', { defaultValue: 'Remove' })}
                                          </Button>
                                        )}
                                      </div>

                                      <div className="grid gap-4 md:grid-cols-2">
                                        {/* Quantity - Fixed-style allocations only. Hourly bills time
                                            entries and Usage bills recorded usage_tracking records, so
                                            neither consumes a configured quantity. */}
                                        {serviceConfig.configuration.configuration_type !== 'Hourly'
                                          && serviceConfig.configuration.configuration_type !== 'Usage' && (
                                          <div>
                                            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                              {isUnitPriced || isRecurringProduct ? t('contractLines.services.recurringUnits', {defaultValue: 'Recurring seats/units'}) : line.contract_line_type === 'Fixed'
                                                ? t('contractLines.services.quantityTaxAllocation', {
                                                  defaultValue: 'Quantity (for tax allocation)',
                                                })
                                                : t('contractLines.services.quantity', { defaultValue: 'Quantity' })}
                                            </Label>
                                            {isEditing ? (
                                              <Input
                                                id={`quantity-${serviceConfig.configuration.config_id}`}
                                                type="number"
                                                min={isUnitPriced ? "0" : "1"}
                                                value={editData.quantity ?? ''}
                                                onChange={(e) => setEditServiceConfigs({
                                                  ...editServiceConfigs,
                                                  [configId]: {
                                                    ...editData,
                                                    quantity: e.target.value ? parseInt(e.target.value) : undefined
                                                  }
                                                })}
                                                onWheel={(e) => (e.target as HTMLInputElement).blur()}
                                                className="mt-1"
                                              />
                                            ) : (
                                              <p className="mt-1 text-sm text-[rgb(var(--color-text-800))] font-semibold">
                                                {serviceConfig.configuration.quantity ?? 1}
                                              </p>
                                            )}
                                          </div>
                                        )}

                                        {/* Rate field - varies by type */}
                                        <div>
                                          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                            {serviceConfig.configuration.configuration_type === 'Hourly'
                                              ? t('contractLines.services.hourlyRate', { defaultValue: 'Hourly Rate' })
                                              : serviceConfig.configuration.configuration_type === 'Usage' || isUnitPriced || isRecurringProduct
                                              ? t('contractLines.services.unitRate', { defaultValue: 'Unit Rate' })
                                              : serviceConfig.typeConfig?.base_rate_basis === 'share'
                                              ? t('contractLines.services.shareOfLineFee', { defaultValue: 'Share of line fee' })
                                              : t('contractLines.services.unitRate', { defaultValue: 'Unit Rate' })}
                                          </Label>
                                          {isEditing ? (
                                            <Input
                                              leadingAdornment={getCurrencySymbol(contract.currency_code || 'USD')}
                                              containerClassName="mt-1"
                                              id={`rate-${serviceConfig.configuration.config_id}`}
                                              type="number"
                                              min="0"
                                              step="0.01"
                                              value={
                                                serviceConfig.configuration.configuration_type === 'Hourly'
                                                  ? (editData.hourly_rate !== undefined ? (editData.hourly_rate / 100).toFixed(2) : '')
                                                  : (editData.base_rate !== undefined ? (editData.base_rate / 100).toFixed(2) : '')
                                              }
                                              onChange={(e) => {
                                                const cents = e.target.value ? Math.round(parseFloat(e.target.value) * 100) : undefined;
                                                if (serviceConfig.configuration.configuration_type === 'Hourly') {
                                                  setEditServiceConfigs({
                                                    ...editServiceConfigs,
                                                    [configId]: {
                                                      ...editData,
                                                      hourly_rate: cents
                                                    }
                                                  });
                                                } else {
                                                  setEditServiceConfigs({
                                                    ...editServiceConfigs,
                                                    [configId]: {
                                                      ...editData,
                                                      base_rate: cents
                                                    }
                                                  });
                                                }
                                              }}
                                              onWheel={(e) => (e.target as HTMLInputElement).blur()}
                                            />
                                          ) : (
                                            <p className="mt-1 text-sm text-[rgb(var(--color-text-800))]">
                                              {isRecurringProduct
                                                ? renderRecurringProductRate(serviceConfig)
                                                : formatRate(serviceConfig.typeConfig?.hourly_rate || serviceConfig.typeConfig?.base_rate)}
                                            </p>
                                          )}
                                        </div>

                                      </div>
                                      {serviceConfig.configuration.configuration_type === 'Usage' && (
                                        <UsageServiceConfigPanel
                                          idPrefix={`${configId}-`}
                                          configuration={isEditing ? editData : serviceConfig.typeConfig ?? {}}
                                          rateTiers={isEditing ? editData.rateTiers : serviceConfig.rateTiers}
                                          onConfigurationChange={updates => setEditServiceConfigs(current => ({
                                            ...current, [configId]: { ...current[configId], ...updates },
                                          }))}
                                          onRateTiersChange={isEditing ? tiers => setEditServiceConfigs(current => ({
                                            ...current, [configId]: { ...current[configId], rateTiers: tiers },
                                          })) : undefined}
                                          disabled={!isEditing || isSavingLine}
                                        />
                                      )}

                                      {/* Bucket Configuration - Hourly and Usage services only */}
                                      {isEditing && !pricingOnly && (serviceConfig.configuration.configuration_type === 'Hourly' || serviceConfig.configuration.configuration_type === 'Usage') && (
                                        <div className="col-span-2 pt-4 border-t border-dashed border-[rgb(var(--color-border-200))]">
                                          <SwitchWithLabel
                                            label={t('contractLines.bucket.enableTracking', {
                                              defaultValue: 'Enable bucket usage tracking',
                                            })}
                                            checked={Boolean(editBucketConfigs[serviceConfig.service.service_id])}
                                            onCheckedChange={(checked) => {
                                              const serviceId = serviceConfig.service.service_id;
                                              if (checked) {
                                                // Initialize with default values
                                                setEditBucketConfigs({
                                                  ...editBucketConfigs,
                                                  [serviceId]: {
                                                    total_minutes: undefined,
                                                    overage_rate: undefined,
                                                    allow_rollover: false,
                                                    billing_period: line.billing_frequency === 'weekly' ? 'weekly' : 'monthly'
                                                  }
                                                });
                                              } else {
                                                // Remove bucket config
                                                setEditBucketConfigs({
                                                  ...editBucketConfigs,
                                                  [serviceId]: null
                                                });
                                              }
                                            }}
                                          />
                                          {editBucketConfigs[serviceConfig.service.service_id] && (
                                            <BucketOverlayFields
                                              currencyCode={contract.currency_code || 'USD'}
                                              mode={serviceConfig.configuration.configuration_type === 'Hourly' ? 'hours' : 'usage'}
                                              value={editBucketConfigs[serviceConfig.service.service_id] || {}}
                                              onChange={(next) => {
                                                const serviceId = serviceConfig.service.service_id;
                                                setEditBucketConfigs({
                                                  ...editBucketConfigs,
                                                  [serviceId]: next
                                                });
                                              }}
                                              unitLabel={serviceConfig.typeConfig?.unit_of_measure}
                                              billingFrequency={line.billing_frequency}
                                              automationId={`bucket-${serviceConfig.configuration.config_id}`}
                                            />
                                          )}
                                        </div>
                                      )}

                                      {/* Display bucket configuration in read-only mode */}
                                      {!isEditing && serviceConfig.bucketConfig && (
                                        <div className="col-span-2 pt-4 border-t border-dashed border-[rgb(var(--color-border-200))]">
                                          <div className="rounded-md border border-primary-100 bg-primary-50 p-4">
                                            <p className="text-sm font-medium text-primary-900 mb-2">
                                              {t('contractLines.bucket.title', { defaultValue: 'Bucket Configuration' })}
                                            </p>
                                            <div className="text-sm text-primary-800 space-y-1">
                                              {serviceConfig.bucketConfig.total_minutes && (
                                                <p>
                                                  {t('contractLines.bucket.included', {
                                                    defaultValue: 'Included: {{value}}',
                                                    value: serviceConfig.configuration.configuration_type === 'Hourly'
                                                      ? t('contractLines.bucket.hoursValue', {
                                                        defaultValue: '{{hours}} hours',
                                                        hours: (serviceConfig.bucketConfig.total_minutes / 60).toFixed(2),
                                                      })
                                                      : t('contractLines.bucket.unitsValue', {
                                                        defaultValue: '{{count}} {{units}}',
                                                        count: serviceConfig.bucketConfig.total_minutes,
                                                        units: serviceConfig.typeConfig?.unit_of_measure || t('contractLines.bucket.defaultUnits', { defaultValue: 'units' }),
                                                      }),
                                                  })}
                                                </p>
                                              )}
                                              {serviceConfig.bucketConfig.overage_rate && (
                                                <p>
                                                  {t('contractLines.bucket.overageRate', {
                                                    defaultValue: 'Overage Rate: {{rate}} per {{unit}}',
                                                    rate: formatRate(serviceConfig.bucketConfig.overage_rate),
                                                    unit: serviceConfig.configuration.configuration_type === 'Hourly'
                                                      ? t('contractLines.bucket.hour', { defaultValue: 'hour' })
                                                      : serviceConfig.typeConfig?.unit_of_measure || t('contractLines.bucket.defaultUnit', { defaultValue: 'unit' }),
                                                  })}
                                                </p>
                                              )}
                                              {serviceConfig.bucketConfig.billing_period && (
                                                <p>
                                                  {t('contractLines.bucket.billingPeriod', {
                                                    defaultValue: 'Billing Period: {{period}}',
                                                    period: formatBillingFrequency(serviceConfig.bucketConfig.billing_period),
                                                  })}
                                                </p>
                                              )}
                                              {serviceConfig.bucketConfig.allow_rollover && (
                                                <p>
                                                  {t('contractLines.bucket.rolloverEnabled', {
                                                    defaultValue: 'Rollover: Enabled',
                                                  })}
                                                </p>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      )}

                                      {serviceConfig.configuration.configuration_type === 'Fixed'
                                        && (serviceConfig.typeConfig?.pricing_basis === 'unit'
                                          || serviceConfig.service.item_kind === 'product') && (
                                        <details className="pt-2">
                                          <summary className="cursor-pointer text-sm font-medium text-[rgb(var(--color-primary-700))]">
                                            {t('contractLines.recurringSchedule.openPanel', {
                                              defaultValue: 'Schedule recurring change & history',
                                            })}
                                          </summary>
                                          <div className="mt-3">
                                            <RecurringUnitSchedulePanel
                                              contractLineId={line.contract_line_id}
                                              serviceId={serviceConfig.service.service_id}
                                              configId={serviceConfig.configuration.config_id}
                                              currencyCode={contract.currency_code || 'USD'}
                                              disabled={isSavingLine}
                                            />
                                          </div>
                                        </details>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {line.display_kind === 'PrepaidBlock' ? (
                        <PrepaidBlockPanel
                          contractLineId={line.contract_line_id}
                          currencyCode={contract.currency_code}
                          isReadOnly={isReadOnly}
                          onChanged={() => {
                            void loadServicesForLine(line.contract_line_id, true);
                          }}
                        />
                      ) : (
                      /* Line-level bucket pools (weighted-burn model). Not offered on Prepaid Block lines. */
                      <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-muted p-4">
                        <BucketPoolEditor
                          contractLineId={line.contract_line_id}
                          lineServices={services
                            .map((serviceConfig) => ({
                              service_id: serviceConfig.service.service_id,
                              service_name: serviceConfig.service.service_name,
                            }))}
                          allServices={services.map((serviceConfig) => ({
                            service_id: serviceConfig.service.service_id,
                            service_name: serviceConfig.service.service_name,
                          }))}
                          schedules={bucketSchedules}
                          currencyCode={contract.currency_code}
                          onChanged={() => {
                            void loadServicesForLine(line.contract_line_id, true);
                          }}
                        />
                      </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Box>

      {!isReadOnly ? (
        <>
          <AddContractLinesDialog
            isOpen={showAddDialog}
            onClose={() => setShowAddDialog(false)}
            contractId={contract.contract_id}
            onAdd={handleAddContractLines}
            currencyCode={contract.currency_code || 'USD'}
          />

          <CreateCustomContractLineDialog
            isOpen={showCreateCustomDialog}
            onClose={() => setShowCreateCustomDialog(false)}
            contractId={contract.contract_id}
            currencyCode={contract.currency_code}
            clientId={clientId}
            contractStartDate={startDate}
            onCreated={handleAddContractLines}
          />

          {editingLine && (
            <ServiceSelectionDialog
              isOpen={showServiceSelectionDialog}
              onClose={() => setShowServiceSelectionDialog(false)}
              contractLineType={editingLine.contract_line_type as 'Fixed' | 'Hourly' | 'Usage'}
              currencyCode={contract.currency_code || 'USD'}
              existingServiceIds={editingLineServiceIds}
              onServicesSelected={(selections) =>
                handleServicesSelected(editingLine.contract_line_id, selections)
              }
            />
          )}
        </>
      ) : null}

      <ConfirmationDialog
        isOpen={resetConfirmation !== null}
        onClose={() => setResetConfirmation(null)}
        onConfirm={confirmResetLineRateToStandard}
        isConfirming={isResettingLine}
        title={t('contractLines.actions.resetToStandard', { defaultValue: 'Reset to standard' })}
        message={
          <div className="space-y-2">
            <p>
              {t('contractLines.dialogs.confirmResetRate', {
                defaultValue: 'Reset this line to the standard catalog rate? The stored custom rate will be removed.',
              })}
            </p>
            {resetConfirmation && (
              <p className="font-medium text-foreground">
                {t('contractLines.columns.rate', { defaultValue: 'Rate' })}:{' '}
                {formatRate(resetConfirmation.currentRateCents)} &rarr;{' '}
                {formatRate(resetConfirmation.targetRateCents)}
              </p>
            )}
          </div>
        }
        confirmLabel={t('contractLines.actions.resetToStandard', { defaultValue: 'Reset to standard' })}
        cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
        id="reset-line-rate-to-standard-confirmation"
      />
    </Card>
  );
};

export default ContractLines;

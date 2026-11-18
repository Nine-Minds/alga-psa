"use client";

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import dynamic from "next/dynamic";
import { v4 as uuidv4 } from "uuid";
import type {
  ContractDraftDiscount,
  ContractDraftSimulationInput,
  ContractWizardFixedLine,
  FixedPricingBasis,
} from "@alga-psa/types";
import { Dialog } from "@alga-psa/ui/components/Dialog";
import { WizardProgress } from "@alga-psa/ui/components/onboarding/WizardProgress";
import { WizardNavigation } from "@alga-psa/ui/components/onboarding/WizardNavigation";
import { ConfirmationDialog } from "@alga-psa/ui/components/ConfirmationDialog";
import { Button } from "@alga-psa/ui/components/Button";
import { Checkbox } from "@alga-psa/ui/components/Checkbox";
import { ContractBasicsStep } from "./wizard-steps/ContractBasicsStep";
import { FixedFeeServicesStep } from "./wizard-steps/FixedFeeServicesStep";
import { ProductsStep } from "./wizard-steps/ProductsStep";
import { HourlyServicesStep } from "./wizard-steps/HourlyServicesStep";
import {
  prepaidLineDraftFromSubmission,
  prepaidLineDraftsToSubmission,
  type PrepaidBlockLineDraft,
  type PrepaidBlockLineSubmission,
} from "./prepaidBlockConfigDraft";
import { UsageBasedServicesStep } from "./wizard-steps/UsageBasedServicesStep";
import { ReviewContractStep } from "./wizard-steps/ReviewContractStep";
import { ContractDiscountsPanel } from "./wizard-steps/ContractDiscountsPanel";
import { ContractCreatedConfirmation } from "./wizard-steps/ContractCreatedConfirmation";
import { hasFirstInvoiceLines } from "./wizard-steps/firstInvoiceLines";
import {
  TemplateLinesStep,
  TemplateLinesReview,
} from "./wizard-steps/TemplateLinesStep";
import {
  findMissingTemplateAmounts,
  hasEditedPriceSetAmounts,
  hasMissingPriceSetSlots,
  missingTemplateAmountsMessage,
} from "./wizard-steps/templateLineAmounts";
import {
  createClientContractFromWizard,
  listContractTemplatesForWizard,
  getContractTemplateLinesForClientWizard,
  ClientContractWizardSubmission,
  ClientTemplateLineEditInput,
  ClientTemplateLinesView,
} from "@alga-psa/billing/actions/contractWizardActions";
import { isRecurringChangeConfirmation } from "@alga-psa/billing/actions/contractWizardActionErrors";
import { getDefaultBillingSettings } from "@alga-psa/billing/actions/billingSettingsActions";
import { getClientByIdForBilling } from "@alga-psa/billing/actions/billingClientsActions";
import {
  getErrorMessage,
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from "@alga-psa/ui/lib/errorHandling";
import {
  getUnsupportedRecurringAuthoringCombination,
  getUnsupportedRecurringAuthoringCombinationMessage,
} from "@shared/billingClients/recurringAuthoringValidation";
import { useFormatters, useTranslation } from "@alga-psa/ui/lib/i18n/client";
import type { ContractAuthoringRateSource } from "../../../lib/contractAuthoringRate";
import {
  createEmptyFixedLine,
  isServicelessFixedLine,
  meaningfulFixedLines,
  projectFixedLinesForSubmission,
} from "../../../lib/contractWizardFixedLines";
import {
  getFixedServiceBasisIssue,
  hasBundleFixedService,
} from "../../../lib/fixedServiceBasis";

const REQUIRED_STEPS = [0, 5];
const MIN_NOTICE_PERIOD_DAYS = 0;
const MAX_NOTICE_PERIOD_DAYS = 3650;
const HARD_DEFAULT_RENEWAL_MODE: NonNullable<
  ContractWizardData["renewal_mode"]
> = "manual";
const HARD_DEFAULT_NOTICE_PERIOD_DAYS = 30;
const RECURRING_LINE_TYPE_KEYS = {
  Fixed: "fixed",
  Product: "product",
  Hourly: "hourly",
  Usage: "usage",
} as const;

const ContractDraftSimulator = dynamic(
  async () => {
    const product = (await import("@product/billing/entry")) as unknown as {
      ContractDraftSimulator: React.ComponentType<{
        draft: ContractDraftSimulationInput;
      }>;
    };
    return product.ContractDraftSimulator;
  },
  { ssr: false },
);

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined)
    return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a === "object" && typeof b === "object") {
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
      if (!isEqual(objA[key], objB[key])) return false;
    }
    return true;
  }

  return false;
}

function deepClone<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => deepClone(item)) as T;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const cloned: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      cloned[key] = deepClone(obj[key]);
    }
    return cloned as T;
  }
  return value;
}

/**
 * Legacy per-service bucket overlay fields are mutually exclusive with the
 * flag-on pool payload: under the flag, a submission must never carry them.
 */
const withoutLegacyBucketOverlay = <T extends { bucket_overlay?: unknown }>(
  service: T,
): Omit<T, "bucket_overlay"> => {
  const { bucket_overlay: _legacyOverlay, ...rest } = service;
  return rest;
};

export interface BucketOverlayInput {
  total_minutes?: number;
  overage_rate?: number;
  allow_rollover?: boolean;
  billing_period?: "monthly" | "weekly";
}

export interface BucketPoolDraft {
  /** Which wizard line the pool belongs to ('hourly' | 'usage'). */
  line_key?: 'hourly' | 'usage';
  bucket_name?: string | null;
  total_minutes: number;
  overage_rate: number;
  allow_rollover: boolean;
  covers_all_services: boolean;
  after_hours_multiplier?: number | null;
  business_hours_schedule_id?: string | null;
  members: Array<{ service_id: string; service_name?: string; burn_multiplier: number }>;
}

export interface ContractWizardData {
  client_id: string;
  /** Billing profile the contract bills to; null falls back to the client default. */
  billing_profile_id?: string | null;
  contract_name: string;
  start_date: string;
  end_date?: string;
  renewal_mode?: "none" | "manual" | "auto";
  notice_period_days?: number;
  renewal_term_months?: number;
  use_tenant_renewal_defaults?: boolean;
  description?: string;
  cadence_owner?: "client" | "contract";
  billing_timing?: "arrears" | "advance";
  billing_frequency: string;
  currency_code: string;
  po_number?: string;
  po_amount?: number;
  po_required?: boolean;
  /** One entry per recurring Fixed contract line; a new wizard starts with one empty placeholder. */
  fixed_lines: ContractWizardFixedLine[];
  /** Server monthly fixed value of the saved draft being resumed; acknowledged on finalize if it changes. */
  recurring_baseline?: { monthly_cents: number };
  /** The products line's own billing timing; undefined inherits `billing_timing`. */
  product_billing_timing?: "arrears" | "advance";
  product_services: Array<{
    service_id: string;
    service_name?: string;
    quantity: number;
    /** Optional per-unit override in cents (contract currency). */
    custom_rate?: number;
    // No catalog price here: it is derived per (contract currency, service id) by
    // useProductCatalogRates, so a currency change or a resumed draft cannot carry a stale one.
  }>;
  enable_proration: boolean;
  hourly_services: Array<{
    service_id: string;
    service_name?: string;
    hourly_rate?: number;
    bucket_overlay?: BucketOverlayInput | null;
  }>;
  hourly_billing_frequency?: string;
  minimum_billable_time?: number;
  round_up_to_nearest?: number;
  usage_services?: Array<{
    service_id: string;
    service_name?: string;
    unit_rate?: number;
    unit_of_measure?: string;
    bucket_overlay?: BucketOverlayInput | null;
  }>;
  usage_billing_frequency?: string;
  /** Prepaid Block lines being authored (each becomes its own Hourly line plus block config). */
  prepaid_block_drafts?: PrepaidBlockLineDraft[];
  /**
   * Server-shaped Prepaid Block lines of a resumed draft contract. Only read by
   * `buildInitialContractWizardData`, which turns them into `prepaid_block_drafts`.
   */
  prepaid_block_lines?: PrepaidBlockLineSubmission[];
  /** Flag-on line-level bucket pools (weighted-burn model), materialized after the line is created. */
  bucket_pools?: BucketPoolDraft[];
  /**
   * Contract-wide automatic discounts authored here. They are written with the
   * contract on Finish Setup; a saved draft keeps its lines only.
   */
  discounts?: ContractDraftDiscount[];
  contract_id?: string;
  is_draft?: boolean;
  /**
   * Template the contract is created from. When set the server clones every
   * template line; the flat `*_services` arrays above are unused in this mode.
   */
  template_id?: string;
  /** Per-line edits (keyed by template line id) applied on top of the clone. */
  template_lines?: ClientTemplateLineEditInput[];
  /** Save the amounts entered for a non-base currency back to the template as a price set. */
  save_template_amounts?: boolean;
}

export const createDefaultContractWizardData = (): ContractWizardData => ({
  client_id: "",
  billing_profile_id: null,
  contract_name: "",
  start_date: "",
  end_date: undefined,
  renewal_mode: "manual",
  notice_period_days: 30,
  renewal_term_months: undefined,
  use_tenant_renewal_defaults: true,
  description: "",
  cadence_owner: "client",
  billing_timing: "arrears",
  billing_frequency: "monthly",
  currency_code: "USD",
  fixed_lines: [createEmptyFixedLine(true)],
  product_services: [],
  enable_proration: true,
  hourly_services: [],
  minimum_billable_time: undefined,
  round_up_to_nearest: undefined,
  usage_services: [],
  prepaid_block_drafts: [],
  bucket_pools: [],
  discounts: [],
  template_id: undefined,
  template_lines: undefined,
  save_template_amounts: false,
});

const normalizeRenewalMode = (
  value: unknown,
): ContractWizardData["renewal_mode"] | undefined => {
  return value === "none" || value === "manual" || value === "auto"
    ? value
    : undefined;
};

const normalizeNonNegativeInteger = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined;
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric))
    return undefined;
  return Math.max(0, Math.trunc(numeric));
};

const normalizePositiveInteger = (value: unknown): number | undefined => {
  const normalized = normalizeNonNegativeInteger(value);
  return normalized && normalized > 0 ? normalized : undefined;
};

export const buildInitialContractWizardData = (
  editingContract: ContractWizardData | null = null,
): ContractWizardData => {
  const initial: ContractWizardData = {
    ...createDefaultContractWizardData(),
    ...(editingContract ?? {}),
  };

  const renewalMode = normalizeRenewalMode(editingContract?.renewal_mode);
  const noticePeriodDays = normalizeNonNegativeInteger(
    editingContract?.notice_period_days,
  );
  const renewalTermMonths = normalizePositiveInteger(
    editingContract?.renewal_term_months,
  );

  if (renewalMode !== undefined) {
    initial.renewal_mode = renewalMode;
  }
  if (noticePeriodDays !== undefined) {
    initial.notice_period_days = noticePeriodDays;
  }
  if (renewalTermMonths !== undefined) {
    initial.renewal_term_months = renewalTermMonths;
  }
  if (typeof editingContract?.use_tenant_renewal_defaults === "boolean") {
    initial.use_tenant_renewal_defaults =
      editingContract.use_tenant_renewal_defaults;
  }

  if (!initial.fixed_lines || initial.fixed_lines.length === 0) {
    initial.fixed_lines = [createEmptyFixedLine(initial.enable_proration)];
  }

  if (editingContract?.prepaid_block_lines?.length) {
    initial.prepaid_block_drafts = editingContract.prepaid_block_lines.map(
      prepaidLineDraftFromSubmission,
    );
  }
  delete initial.prepaid_block_lines;

  return initial;
};

type TemplateOption = {
  contract_id: string;
  contract_name: string;
  contract_description?: string | null;
  billing_frequency?: string | null;
  currency_code?: string;
  price_set_currencies?: string[];
  incomplete_set_currencies?: string[];
};

interface ContractWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: (data: ContractWizardData) => void;
  editingContract?: ContractWizardData | null;
  initialClientId?: string;
}

export function ContractWizard({
  open,
  onOpenChange,
  onComplete,
  editingContract = null,
  initialClientId,
}: ContractWizardProps) {
  const { t } = useTranslation("msp/contracts");
  const { formatCurrency } = useFormatters();
  const money = (minorUnits: number, currencyCode: string) =>
    formatCurrency(minorUnits / 100, currencyCode || "USD", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const initialWizardDataRef = useRef<ContractWizardData | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [showUnsavedChangesDialog, setShowUnsavedChangesDialog] =
    useState(false);
  // Set when Save as Draft is pressed while wizard discounts are authored.
  const [showDraftDiscountsDialog, setShowDraftDiscountsDialog] =
    useState(false);
  // Set once a contract with fixed-fee or product lines is created; the wizard then shows
  // when it first invoices and only reports completion when that is dismissed.
  const [createdContract, setCreatedContract] =
    useState<ContractWizardData | null>(null);

  // Set when the server reports that finishing/saving would change the draft's
  // monthly recurring value; the operator must confirm before it is resubmitted.
  const [pendingRecurringChange, setPendingRecurringChange] = useState<{
    mode: "finish" | "draft";
    baselineMonthlyCents: number;
    resultingMonthlyCents: number;
  } | null>(null);

  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [isTemplateLoading] = useTransition();
  const [templateView, setTemplateView] =
    useState<ClientTemplateLinesView | null>(null);
  const [isTemplateViewLoading, setIsTemplateViewLoading] = useState(false);
  const templateViewCurrency = useRef<string | null>(null);
  const [templateViewError, setTemplateViewError] = useState<string | null>(
    null,
  );
  // Template whose name/description/frequency should seed the basics once its
  // per-line view has loaded (set on an explicit pick, not on draft resume).
  const applyTemplateDefaultsFor = useRef<string | null>(null);

  const [wizardData, setWizardData] = useState<ContractWizardData>(() => ({
    ...buildInitialContractWizardData(editingContract),
  }));
  const formatList = useMemo(
    () =>
      new Intl.ListFormat(undefined, { style: "long", type: "conjunction" }),
    [],
  );

  const isTemplateMode = Boolean(wizardData.template_id);

  const stepLabels = useMemo(
    () =>
      isTemplateMode
        ? [
            t("wizard.steps.contractBasics", { defaultValue: "Contract Basics" }),
            t("wizard.steps.templateLines", { defaultValue: "Template Lines" }),
            t("wizard.steps.reviewCreate", { defaultValue: "Review & Create" }),
          ]
        : [
      t("wizard.steps.contractBasics", { defaultValue: "Contract Basics" }),
      t("wizard.steps.fixedFeeServices", {
        defaultValue: "Fixed Fee Services",
      }),
      t("wizard.steps.products", { defaultValue: "Products" }),
      t("wizard.steps.hourlyServices", { defaultValue: "Hourly Services" }),
      t("wizard.steps.usageBasedServices", {
        defaultValue: "Usage-Based Services",
      }),
      t("wizard.steps.reviewCreate", { defaultValue: "Review & Create" }),
    ],
    [t, isTemplateMode],
  );

  // In template mode the per-type steps (fixed/products/hourly/usage) collapse
  // into the single per-line template step; `activeStep` maps the visible
  // position back to the logical step id the validation/rendering switch on.
  const activeStep = isTemplateMode ? [0, 1, 5][currentStep] ?? 0 : currentStep;

  useEffect(() => {
    if (!open) {
      initialWizardDataRef.current = null;
      setShowUnsavedChangesDialog(false);
      resetWizard();
      return;
    }

    setErrors({});
    setCompletedSteps(new Set());
    setCurrentStep(0);
    setCreatedContract(null);

    const initialWizardData = buildInitialContractWizardData(editingContract);
    if (!editingContract && initialClientId) {
      initialWizardData.client_id = initialClientId;
    }
    initialWizardDataRef.current = deepClone(initialWizardData);

    if (editingContract) {
      setWizardData(initialWizardData);
      setSelectedTemplateId(editingContract.template_id ?? null);
    } else {
      setWizardData(initialWizardData);
      setSelectedTemplateId(null);
    }

    setIsLoadingTemplates(true);
    setTemplateError(null);
    listContractTemplatesForWizard()
      .then((options) => {
        if (isActionMessageError(options) || isActionPermissionError(options)) {
          setTemplates([]);
          setTemplateError(getErrorMessage(options));
          return;
        }
        setTemplates(options);
      })
      .catch((error) => {
        console.error("Failed to load contract templates", error);
        setTemplateError(
          t("wizard.errors.failedToLoadTemplates", {
            defaultValue: "Failed to load templates",
          }),
        );
      })
      .finally(() => {
        setIsLoadingTemplates(false);
      });

    // For a new contract opened with a pre-selected client, seed the displayed currency from
    // that client's configured default currency (client takes precedence over the tenant
    // default, then 'USD'). When no client is pre-selected, ContractBasicsStep resolves the
    // currency when the user picks a client. The server (createClientContractFromWizard)
    // independently resolves the persisted currency the same way.
    if (!editingContract && initialClientId) {
      getClientByIdForBilling(initialClientId)
        .then(async (client) => {
          if (isActionMessageError(client) || isActionPermissionError(client)) {
            return;
          }
          let currency = client?.default_currency_code || "";
          if (!currency) {
            const settings = await getDefaultBillingSettings();
            currency = settings.defaultCurrencyCode || "USD";
          }
          setWizardData((prev) => ({ ...prev, currency_code: currency }));
        })
        .catch(() => {});
    }
  }, [open, editingContract, initialClientId, t]);

  const resetWizard = () => {
    setWizardData(createDefaultContractWizardData());
    setSelectedTemplateId(null);
    setErrors({});
    setCompletedSteps(new Set());
    setCurrentStep(0);
    setCreatedContract(null);
  };

  // A function update is resolved against the latest state inside the setter, so
  // async callers (e.g. catalog-price prefill) never write back a stale snapshot.
  const updateData = (
    data: Partial<ContractWizardData> | ((prev: ContractWizardData) => Partial<ContractWizardData>),
  ) => {
    setWizardData((prev) => ({ ...prev, ...(typeof data === 'function' ? data(prev) : data) }));
  };

  const hasUnsavedChanges = useMemo(() => {
    if (!open) return false;
    if (!initialWizardDataRef.current) return false;
    return !isEqual(wizardData, initialWizardDataRef.current);
  }, [open, wizardData]);

  // The simulator reloads its scenario whenever this input changes, so it is
  // tied to the draft itself: a re-render that leaves the draft alone (a step
  // change, a save in flight) must not disturb a projection on screen.
  const draftSimulationInput = useMemo(
    () =>
      ({
        ...wizardData,
        fixed_lines: meaningfulFixedLines(wizardData.fixed_lines),
        discounts: wizardData.discounts ?? [],
        bucket_pools: wizardData.bucket_pools ?? [],
        // Complete prepaid block lines only; incomplete drafts are not simulated (as on submit).
        prepaid_block_lines: (() => {
          const parsed = prepaidLineDraftsToSubmission(wizardData.prepaid_block_drafts);
          return "lines" in parsed ? parsed.lines : [];
        })(),
      }) satisfies ContractDraftSimulationInput,
    [wizardData],
  );

  const handleConfirmationDone = () => {
    const created = createdContract;
    setCreatedContract(null);
    if (created) {
      onComplete?.(created);
    }
    onOpenChange(false);
  };

  const handleCloseRequest = () => {
    if (createdContract) {
      handleConfirmationDone();
      return;
    }
    if (hasUnsavedChanges) {
      setShowUnsavedChangesDialog(true);
      return;
    }
    onOpenChange(false);
  };

  const handleTemplateSelect = (templateId: string | null) => {
    setSelectedTemplateId(templateId);
    setTemplateError(null);
    setTemplateViewError(null);
    if (!templateId) {
      applyTemplateDefaultsFor.current = null;
      setTemplateView(null);
      updateData({ template_id: undefined, template_lines: undefined, save_template_amounts: false });
      return;
    }

    // The template is cloned server-side line by line, so the flat per-type
    // wizard state is cleared: it must not also be submitted.
    applyTemplateDefaultsFor.current = templateId;
    updateData({
      template_id: templateId,
      template_lines: [],
      save_template_amounts: false,
      fixed_lines: [createEmptyFixedLine(wizardData.enable_proration)],
      product_services: [],
      hourly_services: [],
      usage_services: [],
      prepaid_block_drafts: [],
      bucket_pools: [],
    });
  };

  // Load the template's per-line view whenever the template or the client
  // (hence the contract currency) changes.
  useEffect(() => {
    const templateId = wizardData.template_id;
    if (!open || !templateId) {
      setTemplateView(null);
      return;
    }
    let cancelled = false;
    setIsTemplateViewLoading(true);
    setTemplateViewError(null);
    getContractTemplateLinesForClientWizard(
      templateId,
      wizardData.client_id || undefined,
    )
      .then((view) => {
        if (cancelled) return;
        if (isActionMessageError(view) || isActionPermissionError(view)) {
          const message = getErrorMessage(view);
          setTemplateView(null);
          setTemplateViewError(message);
          setTemplateError(message);
          return;
        }
        // Amount edits are denominated in the contract currency: a currency
        // change (new client) invalidates every entered or prefilled amount.
        const previousCurrency = templateViewCurrency.current;
        templateViewCurrency.current = view.currency_code;
        setTemplateView(view);
        if (previousCurrency && previousCurrency !== view.currency_code) {
          setWizardData((prev) => ({
            ...prev,
            template_lines: [],
            save_template_amounts: false,
          }));
        }
        if (applyTemplateDefaultsFor.current === templateId) {
          applyTemplateDefaultsFor.current = null;
          setWizardData((prev) => ({
            ...prev,
            contract_name: view.contract_name ?? prev.contract_name,
            description: view.description ?? prev.description,
            billing_frequency: view.billing_frequency ?? prev.billing_frequency,
          }));
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to load template lines", error);
        const message = t("wizard.errors.failedToLoadTemplateDetails", {
          defaultValue: "Failed to load template details",
        });
        setTemplateView(null);
        setTemplateViewError(message);
        setTemplateError(message);
      })
      .finally(() => {
        if (!cancelled) setIsTemplateViewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, wizardData.template_id, wizardData.client_id, t]);

  const buildSubmissionData =
    async (
      recurringChangeAck?: { baseline_monthly_cents: number },
      options?: { includeDiscounts?: boolean },
    ): Promise<ClientContractWizardSubmission> => {
      const useTenantDefaults = wizardData.use_tenant_renewal_defaults ?? true;

      let tenantDefaultRenewalMode:
        | ContractWizardData["renewal_mode"]
        | undefined;
      let tenantDefaultNoticePeriodDays: number | undefined;

      try {
        const tenantDefaults = await getDefaultBillingSettings();
        tenantDefaultRenewalMode = tenantDefaults.defaultRenewalMode;
        tenantDefaultNoticePeriodDays = tenantDefaults.defaultNoticePeriodDays;
      } catch (error) {
        console.warn(
          "Failed to load tenant renewal defaults for wizard submission",
          error,
        );
      }

      const resolvedRenewalMode: NonNullable<
        ContractWizardData["renewal_mode"]
      > = useTenantDefaults
        ? (tenantDefaultRenewalMode ?? HARD_DEFAULT_RENEWAL_MODE)
        : (wizardData.renewal_mode ??
          tenantDefaultRenewalMode ??
          HARD_DEFAULT_RENEWAL_MODE);

      const resolvedNoticePeriodDays = useTenantDefaults
        ? (tenantDefaultNoticePeriodDays ?? HARD_DEFAULT_NOTICE_PERIOD_DAYS)
        : (wizardData.notice_period_days ??
          tenantDefaultNoticePeriodDays ??
          HARD_DEFAULT_NOTICE_PERIOD_DAYS);

      const submission: ClientContractWizardSubmission = {
        contract_id: wizardData.contract_id,
        contract_name: wizardData.contract_name.trim(),
        description: wizardData.description?.trim() || undefined,
        client_id: wizardData.client_id || "",
        billing_profile_id: wizardData.billing_profile_id ?? null,
        start_date: wizardData.start_date,
        renewal_mode: resolvedRenewalMode,
        notice_period_days: resolvedNoticePeriodDays,
        renewal_term_months: wizardData.renewal_term_months,
        use_tenant_renewal_defaults: useTenantDefaults,
        cadence_owner: wizardData.cadence_owner ?? "client",
        billing_timing: wizardData.billing_timing ?? "arrears",
        end_date: wizardData.end_date,
        po_required: wizardData.po_required,
        po_number: wizardData.po_number,
        po_amount: wizardData.po_amount,
        enable_proration: wizardData.enable_proration,
        hourly_services: (wizardData.hourly_services ?? []).map(withoutLegacyBucketOverlay),
        hourly_billing_frequency: wizardData.hourly_billing_frequency,
        // Explicitly project the public fixed-line fields so draft-only
        // rate/source metadata never reaches the persisted submission.
        // In template mode the template's lines are cloned server-side.
        fixed_lines: wizardData.template_id ? [] : projectFixedLinesForSubmission(wizardData.fixed_lines ?? []),
        product_services: wizardData.product_services ?? [],
        product_billing_timing: wizardData.product_billing_timing,
        usage_services: (wizardData.usage_services ?? []).map(withoutLegacyBucketOverlay),
        usage_billing_frequency: wizardData.usage_billing_frequency,
        minimum_billable_time: wizardData.minimum_billable_time,
        round_up_to_nearest: wizardData.round_up_to_nearest,
        billing_frequency: wizardData.billing_frequency,
        currency_code: wizardData.currency_code,
        template_id: wizardData.template_id,
        template_lines: wizardData.template_id
          ? (wizardData.template_lines ?? [])
          : undefined,
        save_template_amounts: wizardData.template_id
          ? Boolean(wizardData.save_template_amounts)
          : undefined,
        // Standing discount terms are written only by Finish Setup; a draft
        // keeps its lines, so Save as Draft submits none (the operator
        // confirms that before it happens).
        discounts: options?.includeDiscounts
          ? (wizardData.discounts ?? [])
          : undefined,
      };

      // Prepaid Block lines are not cloned from a template; drafts with no service are dropped and
      // invalid ones block Next/Finish (see the step-5 validation), so only valid entries get here.
      if (!wizardData.template_id) {
        const prepaid = prepaidLineDraftsToSubmission(wizardData.prepaid_block_drafts);
        if ("lines" in prepaid && prepaid.lines.length > 0) {
          submission.prepaid_block_lines = prepaid.lines;
        }
      }

      // Bucket authoring is line-level pools; conflicting legacy
      // bucket_overlay fields are stripped from every service above.
      submission.bucket_pools = wizardData.bucket_pools ?? [];
      if (recurringChangeAck) {
        submission.recurring_change_ack = recurringChangeAck;
      }
      return submission;
    };

  const getRecurringAuthoringValidationError = (): string | null => {
    const unsupportedCombination = [
      ...meaningfulFixedLines(wizardData.fixed_lines).map((line) =>
        getUnsupportedRecurringAuthoringCombination({
          lineType: "Fixed",
          cadenceOwner: wizardData.cadence_owner,
          billingTiming: line.billing_timing ?? wizardData.billing_timing,
          billingFrequency: line.billing_frequency ?? wizardData.billing_frequency,
        }),
      ),
      wizardData.product_services.length > 0
        ? getUnsupportedRecurringAuthoringCombination({
            lineType: "Product",
            cadenceOwner: wizardData.cadence_owner,
            billingTiming: wizardData.product_billing_timing ?? wizardData.billing_timing,
            billingFrequency: wizardData.billing_frequency,
          })
        : null,
      wizardData.hourly_services.length > 0 ||
      (wizardData.prepaid_block_drafts ?? []).some((line) =>
        line.services.some((service) => service.service_id),
      )
        ? getUnsupportedRecurringAuthoringCombination({
            lineType: "Hourly",
            cadenceOwner: wizardData.cadence_owner,
            // Hourly lines always bill in arrears, whatever the contract-wide timing says.
            billingTiming: "arrears",
            billingFrequency:
              wizardData.hourly_billing_frequency ??
              wizardData.billing_frequency,
          })
        : null,
      (wizardData.usage_services?.length ?? 0) > 0
        ? getUnsupportedRecurringAuthoringCombination({
            lineType: "Usage",
            cadenceOwner: wizardData.cadence_owner,
            // Usage lines always bill in arrears, whatever the contract-wide timing says.
            billingTiming: "arrears",
            billingFrequency:
              wizardData.usage_billing_frequency ??
              wizardData.billing_frequency,
          })
        : null,
    ].find((combination) => Boolean(combination));

    if (!unsupportedCombination) {
      return null;
    }

    const supportedFrequencies =
      unsupportedCombination.supportedBillingFrequencies.map((value) =>
        t(`wizard.validation.recurring.frequency.${value}`, {
          defaultValue: value,
        }),
      );
    const recurringLineType = t(
      `wizard.validation.recurring.lineType.${RECURRING_LINE_TYPE_KEYS[unsupportedCombination.lineType]}`,
      { defaultValue: unsupportedCombination.lineType },
    );
    const unsupportedFrequency = t(
      `wizard.validation.recurring.frequency.${unsupportedCombination.billingFrequency}`,
      { defaultValue: unsupportedCombination.billingFrequency },
    );
    const defaultRecurringMessage =
      getUnsupportedRecurringAuthoringCombinationMessage({
        lineType: unsupportedCombination.lineType,
        cadenceOwner: "contract",
        billingTiming: wizardData.billing_timing,
        billingFrequency: unsupportedCombination.billingFrequency,
      });

    return t("wizard.validation.unsupportedRecurringAuthoringCombination", {
      defaultValue:
        defaultRecurringMessage ??
        "Unsupported recurring authoring combination for {{lineType}} services: contract anniversary cadence currently supports {{supportedFrequencies}} billing frequencies. {{billingFrequency}} is not supported yet. Use one of the supported frequencies or invoice on the client billing schedule instead.",
      lineType: recurringLineType,
      supportedFrequencies: formatList.format(supportedFrequencies),
      billingFrequency: unsupportedFrequency,
    });
  };

  // `stepIndex` selects the validation logic (logical step); `errorKey` is the
  // visible step index the dialog renders errors from (they differ in template mode).
  const validateStep = (stepIndex: number, errorKey: number = currentStep): boolean => {
    setErrors((prev) => ({ ...prev, [errorKey]: "" }));

    switch (stepIndex) {
      case 0:
        if (!wizardData.client_id) {
          setErrors((prev) => ({
            ...prev,
            [errorKey]: t("wizard.validation.clientRequired", {
              defaultValue: "Client is required",
            }),
          }));
          return false;
        }
        if (!wizardData.contract_name?.trim()) {
          setErrors((prev) => ({
            ...prev,
            [errorKey]: t("wizard.validation.contractNameRequired", {
              defaultValue: "Contract name is required",
            }),
          }));
          return false;
        }
        if (!wizardData.billing_frequency) {
          setErrors((prev) => ({
            ...prev,
            [errorKey]: t("wizard.validation.billingFrequencyRequired", {
              defaultValue: "Billing frequency is required",
            }),
          }));
          return false;
        }
        if (!wizardData.start_date) {
          setErrors((prev) => ({
            ...prev,
            [errorKey]: t("wizard.validation.startDateRequired", {
              defaultValue: "Start date is required",
            }),
          }));
          return false;
        }
        if (wizardData.end_date && !wizardData.renewal_mode) {
          setErrors((prev) => ({
            ...prev,
            [errorKey]: t("wizard.validation.renewalModeRequiredWithEndDate", {
              defaultValue: "Renewal mode is required when an end date is set",
            }),
          }));
          return false;
        }
        if (wizardData.renewal_mode && wizardData.renewal_mode !== "none") {
          if (!Number.isInteger(wizardData.notice_period_days)) {
            setErrors((prev) => ({
              ...prev,
              [errorKey]: t("wizard.validation.noticePeriodWholeNumber", {
                defaultValue: "Notice period must be a whole number of days",
              }),
            }));
            return false;
          }

          const noticePeriod = wizardData.notice_period_days as number;
          if (
            noticePeriod < MIN_NOTICE_PERIOD_DAYS ||
            noticePeriod > MAX_NOTICE_PERIOD_DAYS
          ) {
            setErrors((prev) => ({
              ...prev,
              [errorKey]: t("wizard.validation.noticePeriodRange", {
                defaultValue:
                  "Notice period must be between {{min}} and {{max}} days",
                min: MIN_NOTICE_PERIOD_DAYS,
                max: MAX_NOTICE_PERIOD_DAYS,
              }),
            }));
            return false;
          }
        }
        if (
          wizardData.renewal_term_months !== undefined &&
          wizardData.renewal_term_months !== null
        ) {
          if (
            !Number.isInteger(wizardData.renewal_term_months) ||
            wizardData.renewal_term_months <= 0
          ) {
            setErrors((prev) => ({
              ...prev,
              [errorKey]: t("wizard.validation.renewalTermPositiveWhole", {
                defaultValue:
                  "Renewal term months must be a positive whole number",
              }),
            }));
            return false;
          }
        }
        return true;
      case 1:
        {
        if (wizardData.template_id && templateView) {
          const missing = findMissingTemplateAmounts(
            templateView,
            wizardData.template_lines ?? [],
          );
          if (missing.length > 0) {
            setErrors((prev) => ({
              ...prev,
              [errorKey]: missingTemplateAmountsMessage(t, templateView, missing),
            }));
            return false;
          }
        }
          if (wizardData.template_id) return true;
          const lines = meaningfulFixedLines(wizardData.fixed_lines);
          const basisIssue = lines
            .flatMap((line) => line.services)
            .filter((service) => service.service_id)
            .map((service) => getFixedServiceBasisIssue(service))
            .find((issue) => issue !== null);
          if (basisIssue) {
            const message =
              basisIssue === "unit_rate_required"
                ? t("wizard.validation.recurringUnitRateRequired", {
                    defaultValue: "Enter a unit rate for each recurring service.",
                  })
                : basisIssue === "unit_quantity_not_whole"
                  ? t("wizard.validation.recurringQuantityWholeNumber", {
                      defaultValue: "Recurring quantity must be a whole number.",
                    })
                  : t("wizard.validation.fixedQuantityInvalid", {
                      defaultValue: "Quantity must be zero or greater.",
                    });
            setErrors((prev) => ({ ...prev, [errorKey]: message }));
            return false;
          }
          // Each line's base rate is its bundle total: required only when that
          // line has an allocation (bundle) member. Per-unit services bill
          // quantity × unit rate and carry no share of it.
          const lineMissingBaseRate = lines.find(
            (line) =>
              line.services.some((service) => service.service_id) &&
              hasBundleFixedService(line.services.filter((service) => service.service_id)) &&
              !line.base_rate,
          );
          if (lineMissingBaseRate) {
            setErrors((prev) => ({
              ...prev,
              [errorKey]: t(
                "wizard.validation.baseRateRequiredWhenFixedServices",
                {
                  defaultValue:
                    "Base rate is required when fixed services are included",
                },
              ),
            }));
            return false;
          }
        }
        return true;
      case 2: {
        const hasMissingProduct = (wizardData.product_services ?? []).some(
          (p) => !p?.service_id,
        );
        if (hasMissingProduct) {
          setErrors((prev) => ({
            ...prev,
            [errorKey]: t("wizard.validation.selectProductForEachLine", {
              defaultValue: "Please select a product for each product line",
            }),
          }));
          return false;
        }
        return true;
      }
      case 5: {
        if (wizardData.template_id) {
          // Template mode: the lines (and their services) come from the
          // template; recurring-combination checks were applied when the
          // template was authored and are not re-derived from flat state.
          if (
            !templateView ||
            !templateView.lines.some((line) => line.services.length > 0)
          ) {
            setErrors((prev) => ({
              ...prev,
              [errorKey]: t("wizard.validation.addAtLeastOneService", {
                defaultValue:
                  "Add at least one service before creating the contract",
              }),
            }));
            return false;
          }
          if (templateView) {
            const missing = findMissingTemplateAmounts(
              templateView,
              wizardData.template_lines ?? [],
            );
            if (missing.length > 0) {
              setErrors((prev) => ({
                ...prev,
                [errorKey]: missingTemplateAmountsMessage(t, templateView, missing),
              }));
              return false;
            }
          }
          return true;
        }
        const hasServices =
          meaningfulFixedLines(wizardData.fixed_lines).length > 0 ||
          wizardData.product_services.length > 0 ||
          wizardData.hourly_services.length > 0 ||
          (wizardData.prepaid_block_drafts ?? []).some((line) =>
            line.services.some((service) => service.service_id),
          ) ||
          !!(wizardData.usage_services && wizardData.usage_services.length > 0);
        if (!hasServices) {
          setErrors((prev) => ({
            ...prev,
            [errorKey]: t("wizard.validation.addAtLeastOneService", {
              defaultValue:
                "Add at least one service before creating the contract",
            }),
          }));
          return false;
        }
        const prepaidParsed = prepaidLineDraftsToSubmission(wizardData.prepaid_block_drafts);
        if ("errors" in prepaidParsed) {
          setErrors((prev) => ({
            ...prev,
            [stepIndex]: t("wizardPrepaidBlock.validation.invalidBlock", {
              defaultValue:
                "Complete the block size, price and trigger settings for every prepaid block line before finishing.",
            }),
          }));
          return false;
        }
        const unpricedPrepaid = prepaidParsed.lines
          .flatMap((line) => line.services)
          .find((service) => !(service.hourly_rate && service.hourly_rate > 0));
        if (unpricedPrepaid) {
          setErrors((prev) => ({
            ...prev,
            [stepIndex]: t("wizardPrepaidBlock.validation.rateRequired", {
              defaultValue:
                'Prepaid block service "{{serviceName}}" needs an hourly rate above zero (hours beyond the block bill at that rate).',
              serviceName: unpricedPrepaid.service_name || unpricedPrepaid.service_id,
            }),
          }));
          return false;
        }
        // A line with a recurring amount but no service cannot be billed, so it
        // blocks Finish. Save Draft keeps such a line as-is.
        const servicelessLine = wizardData.fixed_lines.find(isServicelessFixedLine);
        if (servicelessLine) {
          setErrors((prev) => ({
            ...prev,
            [errorKey]: t("wizard.validation.fixedLineNoService", {
              defaultValue:
                'Fixed line "{{lineName}}" has a recurring amount but no service to bill it on. Add a service before finishing.',
              lineName: servicelessLine.contract_line_name?.trim() || wizardData.contract_name,
            }),
          }));
          return false;
        }
        const recurringAuthoringError = getRecurringAuthoringValidationError();
        if (recurringAuthoringError) {
          setErrors((prev) => ({
            ...prev,
            [errorKey]: recurringAuthoringError,
          }));
          return false;
        }
        return true;
      }
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (!validateStep(activeStep)) {
      return;
    }
    if (currentStep < stepLabels.length - 1) {
      setCompletedSteps((prev) => new Set([...prev, currentStep]));
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  // Template mode: Skip on the Template Lines step is only allowed while no
  // required amount is missing (Finish would be blocked otherwise).
  const templateSkipBlocked =
    isTemplateMode &&
    activeStep === 1 &&
    Boolean(wizardData.template_id && templateView) &&
    findMissingTemplateAmounts(templateView!, wizardData.template_lines ?? [])
      .length > 0;

  // Review-step "save to template" option: null hides it.
  const saveTemplateRatesLabel = (() => {
    if (
      !templateView ||
      templateView.amount_source === "base" ||
      !templateView.can_save_template_amounts
    ) {
      return null;
    }
    const currency = templateView.currency_code;
    if (templateView.amount_source === "price_set") {
      if (hasMissingPriceSetSlots(templateView)) {
        return t("review.saveMissingTemplateRates", {
          defaultValue: "Add the missing {{currency}} rates to the template",
          currency,
        });
      }
      if (hasEditedPriceSetAmounts(templateView, wizardData.template_lines ?? [])) {
        return t("review.updateTemplateRates", {
          defaultValue: "Update the template's {{currency}} rates with these amounts",
          currency,
        });
      }
      return null;
    }
    return t("review.saveTemplateRates", {
      defaultValue: "Save these {{currency}} rates to the template",
      currency,
    });
  })();

  const handleSkip = () => {
    if (templateSkipBlocked) return;
    if (
      currentStep < stepLabels.length - 1 &&
      !REQUIRED_STEPS.includes(activeStep)
    ) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleStepClick = (stepIndex: number) => {
    if (
      stepIndex === 0 ||
      stepIndex === currentStep ||
      completedSteps.has(stepIndex) ||
      (stepIndex > 0 && completedSteps.has(stepIndex - 1))
    ) {
      setCurrentStep(stepIndex);
    }
  };

  const handleFinish = async (
    recurringChangeAck?: { baseline_monthly_cents: number },
  ) => {
    if (!validateStep(activeStep)) {
      return;
    }

    const recurringAuthoringError = getRecurringAuthoringValidationError();
    if (recurringAuthoringError) {
      setErrors((prev) => ({
        ...prev,
        [currentStep]: recurringAuthoringError,
      }));
      return;
    }

    setIsLoading(true);
    try {
      const submission = await buildSubmissionData(recurringChangeAck, {
        includeDiscounts: true,
      });
      const result = await createClientContractFromWizard(submission);

      if (isRecurringChangeConfirmation(result)) {
        setPendingRecurringChange({
          mode: "finish",
          baselineMonthlyCents: result.baseline_monthly_cents,
          resultingMonthlyCents: result.resulting_monthly_cents,
        });
        return;
      }
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }
      if (isActionMessageError(result)) {
        setErrors((prev) => ({
          ...prev,
          [currentStep]: getErrorMessage(result),
        }));
        return;
      }

      const completedData: ContractWizardData = {
        ...wizardData,
        contract_id: result.contract_id,
      };

      setWizardData(completedData);
      if (hasFirstInvoiceLines(completedData)) {
        setCreatedContract(completedData);
        return;
      }
      onComplete?.(completedData);
      onOpenChange(false);
    } catch (error) {
      console.error("Error creating contract", error);
      setErrors((prev) => ({
        ...prev,
        [currentStep]: t("wizard.errors.failedToCreateContract", {
          defaultValue: "Failed to create contract",
        }),
      }));
    } finally {
      setIsLoading(false);
    }
  };

  // Save as Draft is requested with discounts authored: the draft cannot hold
  // them, so the operator confirms dropping them before anything is written.
  const requestSaveDraft = () => {
    if ((wizardData.discounts?.length ?? 0) > 0) {
      setShowDraftDiscountsDialog(true);
      return;
    }
    void handleSaveDraft();
  };

  const handleSaveDraft = async (
    recurringChangeAck?: { baseline_monthly_cents: number },
  ) => {
    if (!validateStep(0, 0)) {
      setCurrentStep(0);
      return;
    }

    if (!wizardData.client_id) {
      setErrors((prev) => ({
        ...prev,
        [currentStep]: t("wizard.validation.selectClientBeforeDraft", {
          defaultValue: "Select a client before saving as draft",
        }),
      }));
      setCurrentStep(0);
      return;
    }

    const recurringAuthoringError = getRecurringAuthoringValidationError();
    if (recurringAuthoringError) {
      setErrors((prev) => ({
        ...prev,
        [currentStep]: recurringAuthoringError,
      }));
      return;
    }

    // An incomplete prepaid block line would be dropped from the draft, losing the author's work.
    if (
      !wizardData.template_id &&
      "errors" in prepaidLineDraftsToSubmission(wizardData.prepaid_block_drafts)
    ) {
      setErrors((prev) => ({
        ...prev,
        [currentStep]: t("wizardPrepaidBlock.validation.invalidBlock", {
          defaultValue:
            "Complete the block size, price and trigger settings for every prepaid block line before finishing.",
        }),
      }));
      return;
    }

    setIsLoading(true);
    try {
      const submission = await buildSubmissionData(recurringChangeAck);
      const result = await createClientContractFromWizard(submission, {
        isDraft: true,
      });

      if (isRecurringChangeConfirmation(result)) {
        setPendingRecurringChange({
          mode: "draft",
          baselineMonthlyCents: result.baseline_monthly_cents,
          resultingMonthlyCents: result.resulting_monthly_cents,
        });
        return;
      }
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }
      if (isActionMessageError(result)) {
        setErrors((prev) => ({
          ...prev,
          [currentStep]: getErrorMessage(result),
        }));
        return;
      }

      const draftData: ContractWizardData = {
        ...wizardData,
        contract_id: result.contract_id,
        client_id: wizardData.client_id || "",
        is_draft: true,
      };

      setWizardData(draftData);
      onComplete?.(draftData);
      onOpenChange(false);
    } catch (error) {
      console.error("Error saving contract draft", error);
      setErrors((prev) => ({
        ...prev,
        [currentStep]: t("wizard.errors.failedToSaveDraft", {
          defaultValue: "Failed to save draft",
        }),
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const renderStep = () => {
    switch (activeStep) {
      case 0:
        return (
          <ContractBasicsStep
            data={wizardData}
            updateData={updateData}
            templates={templates}
            isLoadingTemplates={isLoadingTemplates}
            selectedTemplateId={selectedTemplateId}
            onTemplateSelect={handleTemplateSelect}
            isTemplateLoading={isTemplateLoading || isTemplateViewLoading}
            templateError={templateError}
          />
        );
      case 1:
        if (isTemplateMode) {
          return (
            <TemplateLinesStep
              view={templateView}
              isLoading={isTemplateViewLoading}
              loadError={templateViewError}
              edits={wizardData.template_lines ?? []}
              onChange={(edits) => updateData({ template_lines: edits })}
            />
          );
        }
        return (
          <FixedFeeServicesStep data={wizardData} updateData={updateData} />
        );
      case 2:
        return <ProductsStep data={wizardData} updateData={updateData} />;
      case 3:
        return <HourlyServicesStep data={wizardData} updateData={updateData} />;
      case 4:
        return (
          <UsageBasedServicesStep data={wizardData} updateData={updateData} />
        );
      case 5:
        if (isTemplateMode) {
          // Simulation of a template-derived draft is deferred: the simulator
          // consumes the flat per-type payload, which template mode no longer builds.
          return (
            <div className="space-y-6">
              <div className="space-y-1">
                <h3 className="text-base font-semibold">
                  {wizardData.contract_name}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {wizardData.start_date} · {wizardData.currency_code}
                </p>
              </div>
              {templateView && (
                <TemplateLinesReview
                  view={templateView}
                  edits={wizardData.template_lines ?? []}
                />
              )}
              {templateView && saveTemplateRatesLabel && (
                <Checkbox
                  id="save-template-amounts"
                  checked={Boolean(wizardData.save_template_amounts)}
                  onChange={(event) =>
                    updateData({
                      save_template_amounts: event.target.checked,
                    })
                  }
                  label={saveTemplateRatesLabel}
                />
              )}
              <ContractDiscountsPanel
                discounts={wizardData.discounts ?? []}
                currencyCode={wizardData.currency_code}
                onChange={(discounts) => updateData({ discounts })}
              />

            </div>
          );
        }
        return (
          <div className="space-y-6">
            <ReviewContractStep data={wizardData} />
            <ContractDiscountsPanel
              discounts={wizardData.discounts ?? []}
              currencyCode={wizardData.currency_code}
              onChange={(discounts) => updateData({ discounts })}
            />
            <section
              aria-labelledby="draft-simulation-heading"
              className="space-y-3 border-t pt-6"
            >
              <h3
                id="draft-simulation-heading"
                className="text-base font-semibold"
              >
                {t("wizard.simulation.title", {
                  defaultValue: "Simulate before creating",
                })}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("wizard.simulation.description", {
                  defaultValue:
                    "Test this unsaved draft with assumed activity. Simulation does not save or issue anything.",
                })}
              </p>
              <ContractDraftSimulator draft={draftSimulationInput} />
            </section>
          </div>
        );
      default:
        return null;
    }
  };

  const wizardFooter = createdContract ? (
    <div className="flex justify-end">
      <Button
        id="contract-wizard-created-done"
        variant="default"
        onClick={handleConfirmationDone}
      >
        {t("wizardCreated.done", { defaultValue: "Done" })}
      </Button>
    </div>
  ) : (
    <WizardNavigation
      currentStep={currentStep}
      totalSteps={stepLabels.length}
      onBack={handleBack}
      onNext={handleNext}
      onSkip={handleSkip}
      onFinish={() => handleFinish()}
      onSaveDraft={() => requestSaveDraft()}
      isNextDisabled={isLoading}
      isSkipDisabled={REQUIRED_STEPS.includes(activeStep) || templateSkipBlocked}
      isLoading={isLoading}
      showSaveDraft
      backLabel={t("wizard.nav.back", { defaultValue: "Back" })}
      nextLabel={t("wizard.nav.next", { defaultValue: "Next" })}
      skipLabel={t("wizard.nav.skip", { defaultValue: "Skip" })}
      finishLabel={t("wizard.nav.finish", { defaultValue: "Finish Setup" })}
      saveDraftLabel={t("wizard.nav.saveDraft", {
        defaultValue: "Save as Draft",
      })}
      savingLabel={t("wizard.nav.saving", { defaultValue: "Saving..." })}
      completingLabel={t("wizard.nav.completing", {
        defaultValue: "Completing...",
      })}
    />
  );

  return (
    <>
      <Dialog
        isOpen={open}
        onClose={handleCloseRequest}
        title={
          createdContract
            ? t("wizardCreated.title", { defaultValue: "Contract Created" })
            : editingContract
              ? t("wizard.title.editContract", {
                  defaultValue: "Edit Contract",
                })
              : t("wizard.title.createNewContract", {
                  defaultValue: "Create New Contract",
                })
        }
        className="max-w-4xl max-h-[90vh]"
        disableFocusTrap
        footer={wizardFooter}
      >
        <div className="flex flex-col h-full">
          {!createdContract && (
            <div className="flex-shrink-0 px-6 pt-6">
              <WizardProgress
                steps={stepLabels as unknown as string[]}
                currentStep={currentStep}
                completedSteps={completedSteps}
                onStepClick={handleStepClick}
              />
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="mb-4">
              {createdContract ? (
                <ContractCreatedConfirmation data={createdContract} />
              ) : (
                renderStep()
              )}
            </div>

            {errors[currentStep] && (
              <div className="mb-4 p-3 bg-[rgb(var(--color-destructive)/0.1)] border border-[rgb(var(--color-destructive)/0.3)] rounded-md">
                <p className="text-[rgb(var(--color-destructive))] text-sm">
                  {errors[currentStep]}
                </p>
              </div>
            )}
          </div>
        </div>
      </Dialog>

      <ConfirmationDialog
        id="recurring-total-change-confirm"
        isOpen={pendingRecurringChange !== null}
        onClose={() => setPendingRecurringChange(null)}
        onConfirm={() => {
          const pending = pendingRecurringChange;
          setPendingRecurringChange(null);
          if (!pending) return;
          const ack = { baseline_monthly_cents: pending.baselineMonthlyCents };
          if (pending.mode === "draft") {
            void handleSaveDraft(ack);
          } else {
            void handleFinish(ack);
          }
        }}
        title={t("wizard.recurringChange.title", {
          defaultValue: "Confirm recurring total change",
        })}
        message={t("wizard.recurringChange.message", {
          defaultValue:
            "This changes the contract's estimated monthly recurring value from {{before}} to {{after}}.",
          before: money(
            pendingRecurringChange?.baselineMonthlyCents ?? 0,
            wizardData.currency_code,
          ),
          after: money(
            pendingRecurringChange?.resultingMonthlyCents ?? 0,
            wizardData.currency_code,
          ),
        })}
        confirmLabel={t("wizard.recurringChange.confirm", {
          defaultValue: "Confirm and continue",
        })}
        cancelLabel={t("wizard.recurringChange.cancel", {
          defaultValue: "Go back",
        })}
      />

      <ConfirmationDialog
        id="contract-wizard-draft-discounts"
        isOpen={showDraftDiscountsDialog}
        onClose={() => setShowDraftDiscountsDialog(false)}
        onConfirm={() => {
          setShowDraftDiscountsDialog(false);
          void handleSaveDraft();
        }}
        title={t("wizard.discounts.draftDialog.title", {
          defaultValue: "Save draft without discounts?",
        })}
        message={t("wizard.discounts.draftDialog.message", {
          defaultValue:
            "A saved draft keeps its lines only, so the discounts added here are not saved with it. Finish setup to create them with the contract, or add them later on the contract's Discounts tab.",
        })}
        confirmLabel={t("wizard.discounts.draftDialog.confirm", {
          defaultValue: "Save draft anyway",
        })}
        cancelLabel={t("wizard.dialogs.unsavedChanges.cancel", {
          defaultValue: "Stay",
        })}
      />

      <ConfirmationDialog
        id="contract-wizard-unsaved-changes"
        isOpen={showUnsavedChangesDialog}
        onClose={() => setShowUnsavedChangesDialog(false)}
        onConfirm={() => {
          setShowUnsavedChangesDialog(false);
          onOpenChange(false);
        }}
        title={t("wizard.dialogs.unsavedChanges.title", {
          defaultValue: "Discard changes?",
        })}
        message={t("wizard.dialogs.unsavedChanges.message", {
          defaultValue:
            "You have unsaved changes. If you close this dialog now, your changes will be discarded.",
        })}
        confirmLabel={t("wizard.dialogs.unsavedChanges.confirm", {
          defaultValue: "Discard Changes",
        })}
        cancelLabel={t("wizard.dialogs.unsavedChanges.cancel", {
          defaultValue: "Stay",
        })}
      />
    </>
  );
}

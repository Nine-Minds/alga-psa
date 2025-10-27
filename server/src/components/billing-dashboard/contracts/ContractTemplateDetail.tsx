'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Heading } from '@radix-ui/themes';
import { Badge } from 'server/src/components/ui/Badge';
import { Button } from 'server/src/components/ui/Button';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Layers3, ArrowLeft, Package, ListChecks, Pencil, StickyNote } from 'lucide-react';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import CustomSelect from 'server/src/components/ui/CustomSelect';

import { IContract, IContractAssignmentSummary } from 'server/src/interfaces/contract.interfaces';
import { IContractLineServiceBucketConfig, IContractLineServiceConfiguration, IContractLineServiceHourlyConfig, IContractLineServiceUsageConfig } from 'server/src/interfaces/contractLineServiceConfiguration.interfaces';
import { getContractById, getContractSummary, updateContract, getContractAssignments } from '@product/actions/contractActions';
import { getDetailedContractLines } from '@product/actions/contractLineMappingActions';
import {
  getContractLineServicesWithConfigurations,
  getTemplateLineServicesWithConfigurations,
} from '@product/actions/contractLineServiceActions';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';
import ContractLinesEditor from './ContractLines';

type TemplateMetadataService = {
  service_id?: string;
  service_name?: string;
  notes?: string;
  [key: string]: unknown;
};

type BucketOverlayInput = {
  total_minutes?: number;
  overage_rate?: number;
  allow_rollover?: boolean;
  billing_period?: 'monthly' | 'weekly';
};

type TemplateMetadata = {
  usage_notes?: string;
  recommended_services?: TemplateMetadataService[];
  recommended_billing_cadence?: string;
  tags?: Array<string | null | undefined>;
  [key: string]: unknown;
};

type TemplateLineService = {
  service_id: string;
  service_name: string;
  billing_method?: string | null;
  configuration: IContractLineServiceConfiguration;
  bucket_overlay?: BucketOverlayInput | null;
  unit_of_measure?: string | null;
  minimum_billable_time?: number | null;
  round_up_to_nearest?: number | null;
  quantity?: number | null;
};

type TemplateSummary = {
  contractLineCount: number;
  totalClientAssignments: number;
  activeClientCount: number;
  poRequiredCount: number;
};

type TemplateContractLine = {
  contract_line_id: string;
  contract_line_name: string;
  contract_line_type: string;
  billing_frequency: string;
  services: TemplateLineService[];
};

type DetailedContractLineRow = {
  contract_line_id: string;
  contract_line_name: string;
  contract_line_type: string;
  billing_frequency: string;
};

type RawContractSummary = Awaited<ReturnType<typeof getContractSummary>>;

type BasicsFormState = {
  contract_name: string;
  contract_description: string;
  billing_frequency: string;
};

type GuidanceFormState = {
  usageNotes: string;
  recommendedCadence: string;
  tags: string;
};

const formatDate = (value?: string | Date | null): string => {
  if (!value) {
    return '—';
  }

  try {
    const plainDate = toPlainDate(value);
    const displayDate = new Date(Date.UTC(plainDate.year, plainDate.month - 1, plainDate.day, 12));
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(displayDate);
  } catch (error) {
    console.error('Error formatting date:', error);
    return '—';
  }
};

const humanize = (value?: string | null): string => {
  if (!value) {
    return '';
  }

  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
};

function isBucketConfig(
  config: IContractLineServiceBucketConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | null
): config is IContractLineServiceBucketConfig {
  return Boolean(config && 'total_minutes' in config && 'overage_rate' in config);
}

function isHourlyConfig(
  config: IContractLineServiceBucketConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | null
): config is IContractLineServiceHourlyConfig {
  return Boolean(config && 'hourly_rate' in config && 'minimum_billable_time' in config);
}

function isUsageConfig(
  config: IContractLineServiceBucketConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | null
): config is IContractLineServiceUsageConfig {
  return Boolean(config && 'unit_of_measure' in config && 'enable_tiered_pricing' in config);
}

const ContractTemplateDetail: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const contractId = searchParams?.get('contractId') ?? undefined;

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [contract, setContract] = useState<IContract | null>(null);
  const [summary, setSummary] = useState<TemplateSummary | null>(null);
  const [templateLines, setTemplateLines] = useState<TemplateContractLine[]>([]);
  const [assignments, setAssignments] = useState<IContractAssignmentSummary[]>([]);

  const [isEditingBasics, setIsEditingBasics] = useState(false);
  const [basicsForm, setBasicsForm] = useState<BasicsFormState>({
    contract_name: '',
    contract_description: '',
    billing_frequency: 'monthly',
  });
  const [isSavingBasics, setIsSavingBasics] = useState(false);
  const [basicsError, setBasicsError] = useState<string | null>(null);

  const [isEditingGuidance, setIsEditingGuidance] = useState(false);
  const [guidanceForm, setGuidanceForm] = useState<GuidanceFormState>({
    usageNotes: '',
    recommendedCadence: '',
    tags: '',
  });
  const [isSavingGuidance, setIsSavingGuidance] = useState(false);
  const [guidanceError, setGuidanceError] = useState<string | null>(null);

  const [showServicesEditor, setShowServicesEditor] = useState(false);
  const lastContractIdRef = useRef<string | null>(null);

  const templateMetadata = useMemo<TemplateMetadata>(() => {
    if (!contract?.template_metadata) {
      return {};
    }

    if (typeof contract.template_metadata === 'object' && !Array.isArray(contract.template_metadata)) {
      return contract.template_metadata as TemplateMetadata;
    }

    if (typeof contract.template_metadata === 'string') {
      try {
        const parsed = JSON.parse(contract.template_metadata) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as TemplateMetadata;
        }
      } catch (metadataError) {
        console.warn('Unable to parse contract template metadata JSON', metadataError);
      }
    }

    return {};
  }, [contract]);

  const usageNotes = typeof templateMetadata.usage_notes === 'string' ? templateMetadata.usage_notes : '';
  const recommendedCadence = typeof templateMetadata.recommended_billing_cadence === 'string'
    ? humanize(templateMetadata.recommended_billing_cadence)
    : '';
  const recommendedServices = useMemo(
    () =>
      Array.isArray(templateMetadata.recommended_services)
        ? templateMetadata.recommended_services.filter(
            (service): service is TemplateMetadataService =>
              Boolean(service) && typeof service === 'object'
          )
        : [],
    [templateMetadata.recommended_services]
  );

  const templateTags = useMemo(
    () =>
      Array.isArray(templateMetadata.tags)
        ? templateMetadata.tags.filter(
            (tag): tag is string => typeof tag === 'string' && tag.trim().length > 0
          )
        : [],
    [templateMetadata.tags]
  );

  useEffect(() => {
    if (contract) {
      setBasicsForm({
        contract_name: contract.contract_name ?? '',
        contract_description: contract.contract_description ?? '',
        billing_frequency: contract.billing_frequency ?? 'monthly',
      });
    }
  }, [contract]);

  useEffect(() => {
    const currentContractId = contract?.contract_id ?? null;
    if (!currentContractId) {
      return;
    }

    if (lastContractIdRef.current !== currentContractId) {
      setShowServicesEditor(false);
      lastContractIdRef.current = currentContractId;
    }
  }, [contract?.contract_id]);

  useEffect(() => {
    setGuidanceForm({
      usageNotes: typeof templateMetadata.usage_notes === 'string' ? templateMetadata.usage_notes : '',
      recommendedCadence: typeof templateMetadata.recommended_billing_cadence === 'string'
        ? templateMetadata.recommended_billing_cadence
        : '',
      tags: templateTags.join(', '),
    });
  }, [templateMetadata, templateTags]);

  const handleNavigateBack = () => {
    router.push('/msp/billing?tab=contracts');
  };

  const enrichServices = useCallback(
    async (contractLineId: string, isTemplateContext: boolean): Promise<TemplateLineService[]> => {
      try {
        const servicesWithConfig = isTemplateContext
          ? await getTemplateLineServicesWithConfigurations(contractLineId)
          : await getContractLineServicesWithConfigurations(contractLineId);
        const serviceMap = new Map<string, TemplateLineService>();

        servicesWithConfig.forEach(({ service, configuration, typeConfig }) => {
          const base: TemplateLineService = serviceMap.get(configuration.service_id) ?? {
            service_id: service.service_id,
            service_name: service.service_name,
            billing_method: service.billing_method ?? null,
            configuration,
            bucket_overlay: null,
            unit_of_measure: null,
            minimum_billable_time: null,
            round_up_to_nearest: null,
            quantity: configuration.quantity ?? null,
          };

          if (configuration.configuration_type === 'Bucket' && isBucketConfig(typeConfig)) {
            base.bucket_overlay = {
              total_minutes: typeConfig.total_minutes ?? undefined,
              overage_rate: typeConfig.overage_rate ?? undefined,
              allow_rollover: Boolean(typeConfig.allow_rollover),
              billing_period: (typeConfig.billing_period as BucketOverlayInput['billing_period']) ?? 'monthly',
            };
            base.quantity = configuration.quantity ?? base.quantity;
          } else if (configuration.configuration_type === 'Hourly' && isHourlyConfig(typeConfig)) {
            base.minimum_billable_time = typeConfig.minimum_billable_time ?? base.minimum_billable_time;
            base.round_up_to_nearest = typeConfig.round_up_to_nearest ?? base.round_up_to_nearest;
          } else if (configuration.configuration_type === 'Usage' && isUsageConfig(typeConfig)) {
            base.unit_of_measure = typeConfig.unit_of_measure ?? base.unit_of_measure;
          } else if (configuration.configuration_type === 'Fixed') {
            base.quantity = configuration.quantity ?? base.quantity;
          }

          if (configuration.custom_rate != null) {
            base.configuration = { ...base.configuration, custom_rate: configuration.custom_rate };
          }

          serviceMap.set(configuration.service_id, base);
        });

        return Array.from(serviceMap.values());
      } catch (serviceError) {
        console.error(`Error fetching services for contract line ${contractLineId}`, serviceError);
        return [];
      }
    },
    []
  );

  const loadTemplate = useCallback(
    async (id: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const [contractData, summaryDataRaw, detailedLinesRaw, assignmentRows] = (await Promise.all([
          getContractById(id),
          getContractSummary(id),
          getDetailedContractLines(id),
          getContractAssignments(id),
        ])) as [IContract | null, RawContractSummary, DetailedContractLineRow[], IContractAssignmentSummary[]];

        if (!contractData) {
          setContract(null);
          setTemplateLines([]);
          setSummary(null);
          setAssignments([]);
          setError('Template not found');
          return;
        }

        const normalizedSummary: TemplateSummary | null = summaryDataRaw
          ? {
              contractLineCount: Number(summaryDataRaw.contractLineCount ?? 0),
              totalClientAssignments: Number(summaryDataRaw.totalClientAssignments ?? 0),
              activeClientCount: Number(summaryDataRaw.activeClientCount ?? 0),
              poRequiredCount: Number(summaryDataRaw.poRequiredCount ?? 0),
            }
          : null;

        const isTemplateContext = Boolean(contractData?.is_template);

        const linesWithServices = await Promise.all(
          detailedLinesRaw.map(async (line) => {
            const services = await enrichServices(line.contract_line_id, isTemplateContext);
            return {
              contract_line_id: line.contract_line_id,
              contract_line_name: line.contract_line_name,
              contract_line_type: line.contract_line_type,
              billing_frequency: line.billing_frequency,
              services,
            } as TemplateContractLine;
          })
        );

        setContract(contractData);
        setSummary(normalizedSummary);
        setTemplateLines(linesWithServices);
        setAssignments(assignmentRows);
      } catch (loadError) {
        console.error('Error loading contract template detail:', loadError);
        setError('Failed to load contract template');
        setAssignments([]);
      } finally {
        setIsLoading(false);
      }
    },
    [enrichServices]
  );

  const resetBasicsForm = useCallback(() => {
    if (!contract) {
      setBasicsForm({
        contract_name: '',
        contract_description: '',
        billing_frequency: 'monthly',
      });
      return;
    }

    setBasicsForm({
      contract_name: contract.contract_name ?? '',
      contract_description: contract.contract_description ?? '',
      billing_frequency: contract.billing_frequency ?? 'monthly',
    });
  }, [contract]);

  const resetGuidanceForm = useCallback(() => {
    setGuidanceForm({
      usageNotes: typeof templateMetadata.usage_notes === 'string' ? templateMetadata.usage_notes : '',
      recommendedCadence:
        typeof templateMetadata.recommended_billing_cadence === 'string'
          ? templateMetadata.recommended_billing_cadence
          : '',
      tags: templateTags.join(', '),
    });
  }, [templateMetadata, templateTags]);

  const handleSaveBasics = useCallback(async () => {
    if (!contract) {
      return;
    }

    if (!basicsForm.contract_name.trim()) {
      setBasicsError('Template name is required');
      return;
    }

    if (!basicsForm.billing_frequency) {
      setBasicsError('Billing frequency is required');
      return;
    }

    try {
      setIsSavingBasics(true);
      setBasicsError(null);

      await updateContract(contract.contract_id, {
        contract_name: basicsForm.contract_name.trim(),
        contract_description: basicsForm.contract_description.trim()
          ? basicsForm.contract_description.trim()
          : null,
        billing_frequency: basicsForm.billing_frequency,
      });

      if (contract.contract_id) {
        await loadTemplate(contract.contract_id);
      }

      setIsEditingBasics(false);
    } catch (saveError) {
      console.error('Failed to update template basics', saveError);
      setBasicsError(saveError instanceof Error ? saveError.message : 'Failed to update template basics');
    } finally {
      setIsSavingBasics(false);
    }
  }, [basicsForm, contract, loadTemplate]);

  const handleCancelBasics = useCallback(() => {
    setBasicsError(null);
    resetBasicsForm();
    setIsEditingBasics(false);
  }, [resetBasicsForm]);

  const handleSaveGuidance = useCallback(async () => {
    if (!contract) {
      return;
    }

    try {
      setIsSavingGuidance(true);
      setGuidanceError(null);

      const nextMetadata: TemplateMetadata = { ...templateMetadata };

      if (guidanceForm.usageNotes.trim()) {
        nextMetadata.usage_notes = guidanceForm.usageNotes.trim();
      } else {
        delete nextMetadata.usage_notes;
      }

      if (guidanceForm.recommendedCadence) {
        nextMetadata.recommended_billing_cadence = guidanceForm.recommendedCadence;
      } else {
        delete nextMetadata.recommended_billing_cadence;
      }

      const parsedTags = guidanceForm.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

      if (parsedTags.length > 0) {
        nextMetadata.tags = parsedTags;
      } else {
        delete nextMetadata.tags;
      }

      await updateContract(contract.contract_id, { template_metadata: nextMetadata });

      if (contract.contract_id) {
        await loadTemplate(contract.contract_id);
      }

      setIsEditingGuidance(false);
    } catch (saveError) {
      console.error('Failed to update template guidance', saveError);
      setGuidanceError(saveError instanceof Error ? saveError.message : 'Failed to update template guidance');
    } finally {
      setIsSavingGuidance(false);
    }
  }, [contract, guidanceForm, loadTemplate, templateMetadata]);

  const handleCancelGuidance = useCallback(() => {
    setGuidanceError(null);
    resetGuidanceForm();
    setIsEditingGuidance(false);
  }, [resetGuidanceForm]);

  useEffect(() => {
    if (contractId) {
      void loadTemplate(contractId);
    }
  }, [contractId, loadTemplate]);

  const groupedLines = useMemo(() => {
    return templateLines.reduce<Record<'Fixed' | 'Hourly' | 'Usage' | 'Other', TemplateContractLine[]>>(
      (acc, line) => {
        if (line.contract_line_type === 'Fixed') {
          acc.Fixed.push(line);
        } else if (line.contract_line_type === 'Hourly') {
          acc.Hourly.push(line);
        } else if (line.contract_line_type === 'Usage') {
          acc.Usage.push(line);
        } else {
          acc.Other.push(line);
        }
        return acc;
      },
      { Fixed: [], Hourly: [], Usage: [], Other: [] }
    );
  }, [templateLines]);

  const totalServices = useMemo(
    () => templateLines.reduce((count, line) => count + line.services.length, 0),
    [templateLines]
  );

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingIndicator
          className="py-12 text-gray-600"
          layout="stacked"
          spinnerProps={{ size: 'md' }}
          text="Loading template..."
        />
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="p-6 space-y-4">
        <Button
          id="back-to-contracts-error"
          variant="ghost"
          size="sm"
          onClick={handleNavigateBack}
          className="gap-2 px-0 text-sm text-blue-600 hover:text-blue-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Contracts
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{error || 'Contract template not found'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              id="back-to-contracts"
              variant="ghost"
              size="sm"
              onClick={handleNavigateBack}
              className="gap-2 px-0 text-sm text-blue-600 hover:text-blue-800"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Contracts
            </Button>
            <Badge
              className={(() => {
                const normalized = contract.status?.toLowerCase() ?? 'draft';
                const map: Record<string, string> = {
                  active: 'bg-green-100 text-green-800',
                  draft: 'bg-gray-100 text-gray-800',
                  terminated: 'bg-orange-100 text-orange-800',
                  expired: 'bg-red-100 text-red-800',
                  published: 'bg-green-100 text-green-800',
                  archived: 'bg-gray-200 text-gray-700',
                };
                return map[normalized] ?? map.draft;
              })()}
            >
              {humanize(contract.status)}
            </Badge>
            <Badge className="border border-blue-200 bg-blue-50 text-blue-800">Template</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Heading as="h2" size="7" className="text-gray-900">
              {contract.contract_name}
            </Heading>
            <Button
              id="toggle-basics-editor"
              size="sm"
              variant={isEditingBasics ? 'default' : 'ghost'}
              onClick={() => {
                if (isEditingBasics) {
                  handleCancelBasics();
                } else {
                  resetBasicsForm();
                  setIsEditingBasics(true);
                }
              }}
              className="h-8 px-2 text-xs gap-1.5"
            >
              <Pencil className="h-3.5 w-3.5" />
              {isEditingBasics ? 'Close' : 'Edit'}
            </Button>
          </div>
          {contract.contract_description && (
            <p className="text-sm text-gray-700 max-w-2xl">{contract.contract_description}</p>
          )}
        </div>

        {isEditingBasics && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold text-gray-800">Edit Template Basics</CardTitle>
            </CardHeader>
            <CardContent>
              {basicsError && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{basicsError}</AlertDescription>
                </Alert>
              )}
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSaveBasics();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="template-name-inline">Template Name *</Label>
                  <Input
                    id="template-name-inline"
                    value={basicsForm.contract_name}
                    onChange={(event) =>
                      setBasicsForm((prev) => ({ ...prev, contract_name: event.target.value }))
                    }
                    placeholder="Managed Services Starter, Premium Support Bundle, etc."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="template-description-inline">Internal Notes</Label>
                  <TextArea
                    id="template-description-inline"
                    value={basicsForm.contract_description}
                    onChange={(event) =>
                      setBasicsForm((prev) => ({ ...prev, contract_description: event.target.value }))
                    }
                    placeholder="Describe where this template applies, onboarding tips, or approval requirements."
                    className="min-h-[96px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="template-billing-frequency-inline">Recommended Billing Frequency *</Label>
                  <CustomSelect
                    id="template-billing-frequency-inline"
                    options={BILLING_FREQUENCY_OPTIONS}
                    value={basicsForm.billing_frequency}
                    onValueChange={(value) =>
                      setBasicsForm((prev) => ({ ...prev, billing_frequency: value }))
                    }
                    placeholder="Select billing cadence"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    id="cancel-template-basics-edit"
                    type="button"
                    variant="outline"
                    onClick={handleCancelBasics}
                    disabled={isSavingBasics}
                  >
                    Cancel
                  </Button>
                  <Button
                    id="save-template-basics"
                    type="submit"
                    disabled={isSavingBasics}
                    className="gap-2"
                  >
                    {isSavingBasics ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {isEditingGuidance && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold text-gray-800">Edit Template Guidance</CardTitle>
            </CardHeader>
            <CardContent>
              {guidanceError && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{guidanceError}</AlertDescription>
                </Alert>
              )}
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSaveGuidance();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="template-usage-notes-inline">Usage Notes</Label>
                  <TextArea
                    id="template-usage-notes-inline"
                    value={guidanceForm.usageNotes}
                    onChange={(event) =>
                      setGuidanceForm((prev) => ({ ...prev, usageNotes: event.target.value }))
                    }
                    placeholder="Add guidance to help others understand how to use this template."
                    className="min-h-[96px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="template-recommended-cadence-inline">Recommended Cadence</Label>
                  <CustomSelect
                    id="template-recommended-cadence-inline"
                    options={BILLING_FREQUENCY_OPTIONS}
                    value={guidanceForm.recommendedCadence}
                    onValueChange={(value) =>
                      setGuidanceForm((prev) => ({ ...prev, recommendedCadence: value }))
                    }
                    placeholder="Select a cadence"
                    allowClear
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="template-tags-inline">Tags</Label>
                  <Input
                    id="template-tags-inline"
                    value={guidanceForm.tags}
                    onChange={(event) =>
                      setGuidanceForm((prev) => ({ ...prev, tags: event.target.value }))
                    }
                    placeholder="Comma separated (e.g., onboarding, finance)"
                  />
                  <p className="text-xs text-gray-500">Tags help teams find relevant templates quickly.</p>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    id="cancel-template-guidance-edit"
                    type="button"
                    variant="outline"
                    onClick={handleCancelGuidance}
                    disabled={isSavingGuidance}
                  >
                    Cancel
                  </Button>
                  <Button
                    id="save-template-guidance"
                    type="submit"
                    disabled={isSavingGuidance}
                    className="gap-2"
                  >
                    {isSavingGuidance ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-gray-700">Template Snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-gray-700">
              <div className="flex items-center justify-between">
                <span>Billing Frequency</span>
                <span className="font-medium">{humanize(contract.billing_frequency)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Contract Lines</span>
                <span className="font-medium">{summary?.contractLineCount ?? templateLines.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Services</span>
                <span className="font-medium">{totalServices}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Created</span>
                <span className="font-medium">{formatDate(contract.created_at)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Last Updated</span>
                <span className="font-medium">{formatDate(contract.updated_at)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-gray-700">Client Assignments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-gray-700">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span>Total Assignments</span>
                  <span className="font-medium">{summary?.totalClientAssignments ?? assignments.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Active Clients</span>
                  <span className="font-medium">{summary?.activeClientCount ?? assignments.filter((assignment) => assignment.is_active).length}</span>
                </div>
                <div className="space-y-1">
                  <span className="text-xs uppercase tracking-wide text-gray-500">Purchase Orders</span>
                  <p className="text-sm text-gray-800">
                    {summary?.poRequiredCount || assignments.some((assignment) => assignment.po_required)
                      ? `${summary?.poRequiredCount ?? assignments.filter((assignment) => assignment.po_required).length} assignments require PO`
                      : 'No PO requirements captured.'}
                  </p>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-3">
                {assignments.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No client contracts are currently using this template.
                  </p>
                ) : (
                  <p className="text-sm text-gray-600">
                    Review the full assignment list in the details section below.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold text-gray-700">Template Guidance</CardTitle>
              <Button
                id="toggle-guidance-editor"
                size="sm"
                variant={isEditingGuidance ? 'default' : 'ghost'}
                onClick={() => {
                  if (isEditingGuidance) {
                    handleCancelGuidance();
                  } else {
                    resetGuidanceForm();
                    setIsEditingGuidance(true);
                  }
                }}
                className="h-8 px-2 text-xs gap-1.5"
              >
                <StickyNote className="h-3.5 w-3.5" />
                {isEditingGuidance ? 'Close' : 'Edit'}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-gray-700">
              <div>
                <span className="text-xs uppercase tracking-wide text-gray-500">Usage Notes</span>
                <p className={usageNotes ? 'text-gray-800' : 'text-gray-500 italic'}>
                  {usageNotes || 'Add guidance to help others understand how to use this template.'}
                </p>
              </div>
              <div>
                <span className="text-xs uppercase tracking-wide text-gray-500">Recommended Cadence</span>
                <p className={recommendedCadence ? 'text-gray-800' : 'text-gray-500 italic'}>
                  {recommendedCadence || 'No recommended cadence provided.'}
                </p>
              </div>
              {templateTags.length > 0 && (
                <div>
                  <span className="text-xs uppercase tracking-wide text-gray-500">Tags</span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {templateTags.map((tag) => (
                      <Badge key={tag} className="border border-gray-200 bg-gray-50 text-gray-700">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-gray-800">Assignment Details</CardTitle>
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <p className="text-sm text-gray-500">
              When client contracts adopt this template they will be listed here with purchase order context.
            </p>
          ) : (
            <div className="rounded-md border border-gray-200">
              <div className="max-h-96 overflow-y-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th scope="col" className="sticky top-0 z-10 bg-gray-50 px-4 py-2 text-left font-medium">
                        Client
                      </th>
                      <th scope="col" className="sticky top-0 z-10 bg-gray-50 px-4 py-2 text-left font-medium">
                        Status
                      </th>
                      <th scope="col" className="sticky top-0 z-10 bg-gray-50 px-4 py-2 text-left font-medium">
                        Start
                      </th>
                      <th scope="col" className="sticky top-0 z-10 bg-gray-50 px-4 py-2 text-left font-medium">
                        End
                      </th>
                      <th scope="col" className="sticky top-0 z-10 bg-gray-50 px-4 py-2 text-left font-medium">
                        PO Required
                      </th>
                      <th scope="col" className="sticky top-0 z-10 bg-gray-50 px-4 py-2 text-left font-medium">
                        PO Number
                      </th>
                      <th scope="col" className="sticky top-0 z-10 bg-gray-50 px-4 py-2 text-right font-medium">
                        PO Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {assignments.map((assignment) => {
                      const poAmount =
                        assignment.po_required && assignment.po_amount != null
                          ? `$${(Number(assignment.po_amount) / 100).toFixed(2)}`
                          : '—';

                      return (
                        <tr key={assignment.client_contract_id} className="bg-white hover:bg-gray-50">
                          <td className="whitespace-nowrap px-4 py-3">
                            <div className="flex flex-col">
                              <span className="font-medium text-gray-900">
                                {assignment.client_name || assignment.client_id}
                              </span>
                              <span className="text-xs text-gray-500">
                                Contract ID: {assignment.client_contract_id}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              className={
                                assignment.is_active
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-gray-100 text-gray-700'
                              }
                            >
                              {assignment.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-gray-900">
                            {assignment.start_date ? formatDate(assignment.start_date) : '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-gray-900">
                            {assignment.end_date ? formatDate(assignment.end_date) : 'Ongoing'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-gray-900">
                            {assignment.po_required ? 'Yes' : 'No'}
                          </td>
                          <td className="px-4 py-3 text-gray-900">
                            {assignment.po_required ? assignment.po_number || '—' : 'Not required'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-gray-900">
                            {poAmount}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {recommendedServices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-purple-600" />
              Recommended Services
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recommendedServices.map((service, index) => (
              <div key={`${service.service_id ?? index}`} className="border border-gray-200 rounded-md p-3">
                <p className="font-medium text-gray-900">{service.service_name || service.service_id || 'Unnamed Service'}</p>
                {service.notes && <p className="text-sm text-gray-600 mt-1">{service.notes}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {showServicesEditor && contract && (
        <ContractLinesEditor
          contract={contract}
          onContractLinesChanged={() => {
            if (contract.contract_id) {
              void loadTemplate(contract.contract_id);
            }
          }}
        />
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers3 className="h-4 w-4 text-blue-600" />
            <Heading as="h3" size="5" className="text-gray-900">
              Template Composition
            </Heading>
          </div>
          <Button
            id="toggle-services-editor"
            size="sm"
            variant={showServicesEditor ? 'default' : 'ghost'}
            onClick={() => setShowServicesEditor((prev) => !prev)}
            className="h-8 px-2 text-xs gap-1.5"
          >
            <Layers3 className="h-3.5 w-3.5" />
            {showServicesEditor ? 'Close Manager' : 'Manage Services'}
          </Button>
        </div>
        <div
          className={
            showServicesEditor
              ? 'space-y-4 transition-opacity duration-200 opacity-40 pointer-events-none'
              : 'space-y-4 transition-opacity duration-200'
          }
          aria-hidden={showServicesEditor}
        >
          {(['Fixed', 'Hourly', 'Usage', 'Other'] as const).map((type) => {
            const lines = groupedLines[type];
            if (!lines || lines.length === 0) {
              if (type === 'Other') {
                return null;
              }
              return (
                <Card key={type}>
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold">
                      {type === 'Fixed' ? 'Fixed Fee Bundles' : type === 'Hourly' ? 'Hourly Plans' : 'Usage-Based Plans'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-gray-500">
                      No {type === 'Fixed' ? 'fixed fee' : type === 'Hourly' ? 'hourly' : 'usage-based'} contract lines configured yet.
                    </p>
                  </CardContent>
                </Card>
              );
            }

            return (
              <Card key={type}>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">
                    {type === 'Fixed' ? 'Fixed Fee Bundles' : type === 'Hourly' ? 'Hourly Plans' : type === 'Usage' ? 'Usage-Based Plans' : 'Additional Plans'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {lines.map((line) => (
                    <div key={line.contract_line_id} className="border border-gray-200 rounded-md p-4 bg-gray-50">
                      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                        <div>
                          <p className="font-medium text-gray-900">{line.contract_line_name}</p>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">
                            {humanize(line.contract_line_type)} • {humanize(line.billing_frequency)}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {line.services.length} service{line.services.length === 1 ? '' : 's'}
                        </Badge>
                      </div>
                      <div className="mt-3 space-y-2">
                        {line.services.length === 0 ? (
                          <p className="text-sm text-gray-600 italic">No services assigned to this contract line.</p>
                        ) : (
                          line.services.map((service) => (
                            <div
                              key={`${line.contract_line_id}-${service.service_id}`}
                              className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 rounded-md bg-white p-3 border border-gray-200"
                            >
                              <div>
                                <p className="font-medium text-gray-900">{service.service_name}</p>
                                <p className="text-xs text-gray-500">
                                  {service.billing_method ? humanize(service.billing_method) : 'Service'} • {service.configuration.configuration_type}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-3 text-xs text-gray-600">
                                {service.quantity != null && (
                                  <span>Quantity: <span className="font-medium">{service.quantity}</span></span>
                                )}
                                {service.unit_of_measure && (
                                  <span>Unit: <span className="font-medium">{service.unit_of_measure}</span></span>
                                )}
                                {service.minimum_billable_time != null && (
                                  <span>Minimum Time: <span className="font-medium">{service.minimum_billable_time} min</span></span>
                                )}
                                {service.round_up_to_nearest != null && (
                                  <span>Round Up: <span className="font-medium">{service.round_up_to_nearest} min</span></span>
                                )}
                                {service.bucket_overlay && (
                                  <span className="flex items-center gap-1">
                                    <Package className="h-3 w-3 text-purple-500" />
                                    Bucket: {service.bucket_overlay.total_minutes ?? 0} min • Overage ${service.bucket_overlay.overage_rate ?? 0}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default ContractTemplateDetail;

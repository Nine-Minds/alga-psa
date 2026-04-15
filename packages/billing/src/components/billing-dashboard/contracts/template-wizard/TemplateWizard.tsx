'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { WizardProgress } from '@alga-psa/ui/components/onboarding/WizardProgress';
import { WizardNavigation } from '@alga-psa/ui/components/onboarding/WizardNavigation';
import { TemplateContractBasicsStep } from './steps/TemplateContractBasicsStep';
import { TemplateFixedFeeServicesStep } from './steps/TemplateFixedFeeServicesStep';
import { TemplateProductsStep } from './steps/TemplateProductsStep';
import { TemplateHourlyServicesStep } from './steps/TemplateHourlyServicesStep';
import { TemplateUsageBasedServicesStep } from './steps/TemplateUsageBasedServicesStep';
import { TemplateReviewContractStep } from './steps/TemplateReviewContractStep';
import { createContractTemplateFromWizard, ContractTemplateWizardSubmission, checkTemplateNameExists } from '@alga-psa/billing/actions/contractWizardActions';
import {
  getUnsupportedRecurringAuthoringCombination,
  getUnsupportedRecurringAuthoringCombinationMessage,
} from '@shared/billingClients/recurringAuthoringValidation';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const TEMPLATE_STEPS_COUNT = 6;
const RECURRING_LINE_TYPE_KEYS = {
  Fixed: 'fixed',
  Product: 'product',
  Hourly: 'hourly',
  Usage: 'usage',
} as const;

const REQUIRED_TEMPLATE_STEPS = [0, 5];

export interface BucketOverlayInput {
  total_minutes?: number;
  overage_rate?: number;
  allow_rollover?: boolean;
  billing_period?: 'monthly' | 'weekly';
}

export interface TemplateWizardData {
  contract_name: string;
  description?: string;
  billing_frequency: string;
  cadence_owner?: 'client' | 'contract';
  billing_timing?: 'arrears' | 'advance';
  // Templates are currency-neutral. Currency and rates are determined when a contract
  // is created from this template - rates come from the service's prices in the client's currency.
  enable_proration?: boolean;
  fixed_services: Array<{
    service_id: string;
    service_name?: string;
    quantity?: number;
  }>;
  product_services: Array<{
    service_id: string;
    service_name?: string;
    quantity?: number;
  }>;
  hourly_services: Array<{
    service_id: string;
    service_name?: string;
    bucket_overlay?: BucketOverlayInput | null;
  }>;
  usage_services?: Array<{
    service_id: string;
    service_name?: string;
    unit_of_measure?: string;
    bucket_overlay?: BucketOverlayInput | null;
  }>;
  minimum_billable_time?: number;
  round_up_to_nearest?: number;
}

interface TemplateWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: (data: TemplateWizardData) => void;
}

export function TemplateWizard({ open, onOpenChange, onComplete }: TemplateWizardProps) {
  const { t } = useTranslation('msp/contracts');
  const [currentStep, setCurrentStep] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [templateNameError, setTemplateNameError] = useState<string>('');

  const [wizardData, setWizardData] = useState<TemplateWizardData>({
    contract_name: '',
    description: '',
    billing_frequency: 'monthly',
    cadence_owner: 'client',
    billing_timing: 'arrears',
    enable_proration: false,
    // currency_code removed - templates are now currency-neutral
    fixed_services: [],
    product_services: [],
    hourly_services: [],
    usage_services: [],
  });
  const formatList = useMemo(
    () => new Intl.ListFormat(undefined, { style: 'long', type: 'conjunction' }),
    []
  );
  const stepLabels = useMemo(
    () => ([
      t('templateWizard.steps.templateBasics', { defaultValue: 'Template Basics' }),
      t('templateWizard.steps.fixedFeeBlocks', { defaultValue: 'Fixed Fee Blocks' }),
      t('templateWizard.steps.products', { defaultValue: 'Products' }),
      t('templateWizard.steps.hourlyBlocks', { defaultValue: 'Hourly Blocks' }),
      t('templateWizard.steps.usageBasedBlocks', { defaultValue: 'Usage-Based Blocks' }),
      t('templateWizard.steps.reviewPublish', { defaultValue: 'Review & Publish' }),
    ]),
    [t]
  );

  useEffect(() => {
    if (!open) {
      setWizardData({
        contract_name: '',
        description: '',
        billing_frequency: 'monthly',
        cadence_owner: 'client',
        billing_timing: 'arrears',
        enable_proration: false,
        // currency_code removed - templates are now currency-neutral
        fixed_services: [],
        product_services: [],
        hourly_services: [],
        usage_services: [],
      });
      setErrors({});
      setCompletedSteps(new Set());
      setCurrentStep(0);
      setTemplateNameError('');
    }
  }, [open]);

  const buildSubmissionData = (): ContractTemplateWizardSubmission => ({
    contract_name: wizardData.contract_name.trim(),
    description: wizardData.description?.trim() || undefined,
    cadence_owner: wizardData.cadence_owner ?? 'client',
    billing_timing: wizardData.billing_timing ?? 'arrears',
    enable_proration: wizardData.enable_proration ?? false,
    fixed_services: wizardData.fixed_services ?? [],
    product_services: wizardData.product_services ?? [],
    hourly_services: wizardData.hourly_services ?? [],
    usage_services: wizardData.usage_services ?? [],
    minimum_billable_time: wizardData.minimum_billable_time,
    round_up_to_nearest: wizardData.round_up_to_nearest,
    billing_frequency: wizardData.billing_frequency,
    // currency_code removed - templates are now currency-neutral
  });

  const updateData = (data: Partial<TemplateWizardData>) => {
    setWizardData((prev) => ({ ...prev, ...data }));
    // Clear template name error when user modifies the name
    if (data.contract_name !== undefined) {
      setTemplateNameError('');
    }
  };

  const getRecurringAuthoringValidationError = (): string | null => {
    const unsupportedCombination = [
      wizardData.fixed_services.length > 0
        ? getUnsupportedRecurringAuthoringCombination({
            lineType: 'Fixed',
            cadenceOwner: wizardData.cadence_owner,
            billingTiming: wizardData.billing_timing,
            billingFrequency: wizardData.billing_frequency,
          })
        : null,
      wizardData.product_services.length > 0
        ? getUnsupportedRecurringAuthoringCombination({
            lineType: 'Product',
            cadenceOwner: wizardData.cadence_owner,
            billingTiming: wizardData.billing_timing,
            billingFrequency: wizardData.billing_frequency,
          })
        : null,
      wizardData.hourly_services.length > 0
        ? getUnsupportedRecurringAuthoringCombination({
            lineType: 'Hourly',
            cadenceOwner: wizardData.cadence_owner,
            billingTiming: wizardData.billing_timing,
            billingFrequency: wizardData.billing_frequency,
          })
        : null,
      (wizardData.usage_services?.length ?? 0) > 0
        ? getUnsupportedRecurringAuthoringCombination({
            lineType: 'Usage',
            cadenceOwner: wizardData.cadence_owner,
            billingTiming: wizardData.billing_timing,
            billingFrequency: wizardData.billing_frequency,
          })
        : null,
    ].find((combination) => Boolean(combination));

    if (!unsupportedCombination) {
      return null;
    }

    const supportedFrequencies = unsupportedCombination.supportedBillingFrequencies.map((value) =>
      t(`templateWizard.validation.recurring.frequency.${value}`, { defaultValue: value })
    );
    const recurringLineType = t(
      `templateWizard.validation.recurring.lineType.${RECURRING_LINE_TYPE_KEYS[unsupportedCombination.lineType]}`,
      { defaultValue: unsupportedCombination.lineType }
    );
    const unsupportedFrequency = t(
      `templateWizard.validation.recurring.frequency.${unsupportedCombination.billingFrequency}`,
      { defaultValue: unsupportedCombination.billingFrequency }
    );
    const defaultRecurringMessage = getUnsupportedRecurringAuthoringCombinationMessage({
      lineType: unsupportedCombination.lineType,
      cadenceOwner: 'contract',
      billingTiming: wizardData.billing_timing,
      billingFrequency: unsupportedCombination.billingFrequency,
    });

    return t('templateWizard.validation.unsupportedRecurringAuthoringCombination', {
      defaultValue:
        defaultRecurringMessage ??
        'Unsupported recurring authoring combination for {{lineType}} services: contract anniversary cadence currently supports {{supportedFrequencies}} billing frequencies. {{billingFrequency}} is not supported yet. Use one of the supported frequencies or invoice on the client billing schedule instead.',
      lineType: recurringLineType,
      supportedFrequencies: formatList.format(supportedFrequencies),
      billingFrequency: unsupportedFrequency,
    });
  };

  const checkDuplicateTemplateName = async (name: string): Promise<boolean> => {
    if (!name?.trim()) {
      return false;
    }
    try {
      const exists = await checkTemplateNameExists(name);
      return exists;
    } catch (error) {
      console.error('Error checking for duplicate template name:', error);
      return false;
    }
  };

  const validateStep = async (stepIndex: number): Promise<boolean> => {
    setErrors((prev) => ({ ...prev, [stepIndex]: '' }));

    switch (stepIndex) {
      case 0: {
        if (!wizardData.contract_name?.trim()) {
          setErrors((prev) => ({
            ...prev,
            [stepIndex]: t('templateWizard.validation.templateNameRequired', {
              defaultValue: 'Template name is required',
            }),
          }));
          return false;
        }
        if (!wizardData.billing_frequency) {
          setErrors((prev) => ({
            ...prev,
            [stepIndex]: t('templateWizard.validation.billingFrequencyRequired', {
              defaultValue: 'Billing frequency is required',
            }),
          }));
          return false;
        }
        // Check for duplicate template name
        const isDuplicate = await checkDuplicateTemplateName(wizardData.contract_name);
        if (isDuplicate) {
          setTemplateNameError(
            t('templateWizard.validation.duplicateNameExists', {
              defaultValue: 'A template with this name already exists',
            })
          );
          setErrors((prev) => ({
            ...prev,
            [stepIndex]: t('templateWizard.validation.templateNameAlreadyInUse', {
              defaultValue: 'Template name is already in use',
            }),
          }));
          return false;
        }
        return true;
      }
      case 5: {
        const hasServices =
          wizardData.fixed_services.length > 0 ||
          wizardData.product_services.length > 0 ||
          wizardData.hourly_services.length > 0 ||
          !!(wizardData.usage_services && wizardData.usage_services.length > 0);

        if (!hasServices) {
          setErrors((prev) => ({
            ...prev,
            [stepIndex]: t('templateWizard.validation.atLeastOneServiceRequired', {
              defaultValue: 'At least one service is required',
            }),
          }));
          return false;
        }
        const recurringAuthoringError = getRecurringAuthoringValidationError();
        if (recurringAuthoringError) {
          setErrors((prev) => ({ ...prev, [stepIndex]: recurringAuthoringError }));
          return false;
        }
        return true;
      }
      default:
        return true;
    }
  };

  const handleNext = async () => {
    const isValid = await validateStep(currentStep);
    if (!isValid) {
      return;
    }
    if (currentStep < TEMPLATE_STEPS_COUNT - 1) {
      setCompletedSteps((prev) => new Set([...prev, currentStep]));
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleSkip = () => {
    if (currentStep < TEMPLATE_STEPS_COUNT - 1 && !REQUIRED_TEMPLATE_STEPS.includes(currentStep)) {
      setCompletedSteps((prev) => new Set([...prev, currentStep]));
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleStepClick = (stepIndex: number) => {
    if (
      stepIndex === 0 ||
      completedSteps.has(stepIndex) ||
      (stepIndex > 0 && completedSteps.has(stepIndex - 1))
    ) {
      setCurrentStep(stepIndex);
    }
  };

  const handleFinish = async () => {
    const isValid = await validateStep(currentStep);
    if (!isValid) {
      return;
    }

    setIsSaving(true);
    try {
      const submission = buildSubmissionData();
      await createContractTemplateFromWizard(submission);
      if (onComplete) {
        onComplete(wizardData);
      }
      onOpenChange(false);
      setCompletedSteps(new Set());
      setCurrentStep(0);
      setWizardData({
        contract_name: '',
        description: '',
        billing_frequency: 'monthly',
        cadence_owner: 'client',
        billing_timing: 'arrears',
        enable_proration: false,
        // currency_code removed - templates are now currency-neutral
        fixed_services: [],
        product_services: [],
        hourly_services: [],
        usage_services: [],
      });
    } catch (error) {
      console.error('Failed to create template from wizard', error);
      setErrors((prev) => ({
        ...prev,
        [currentStep]: t('templateWizard.errors.failedToCreateTemplate', {
          defaultValue: 'Failed to create template',
        }),
      }));
    } finally {
      setIsSaving(false);
    }
  };

  const wizardFooter = (
    <WizardNavigation
      currentStep={currentStep}
      totalSteps={stepLabels.length}
      onBack={handleBack}
      onNext={handleNext}
      onSkip={handleSkip}
      onFinish={handleFinish}
      isNextDisabled={isSaving}
      isSkipDisabled={REQUIRED_TEMPLATE_STEPS.includes(currentStep)}
      isLoading={isSaving}
      nextLabel={t('templateWizard.actions.continue', { defaultValue: 'Continue' })}
      finishLabel={t('templateWizard.actions.publishTemplate', { defaultValue: 'Publish Template' })}
    />
  );

  return (
    <Dialog
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title={t('templateWizard.title.createContractTemplate', { defaultValue: 'Create Contract Template' })}
      className="max-w-4xl max-h-[90vh]"
      footer={wizardFooter}
    >
      <div className="flex flex-col h-full bg-[rgb(var(--color-card))] rounded-lg">
        <div className="flex-shrink-0 px-6 pt-6">
          <WizardProgress
            steps={stepLabels}
            currentStep={currentStep}
            completedSteps={completedSteps}
            onStepClick={handleStepClick}
            canNavigateToStep={(stepIndex) =>
              stepIndex === 0 ||
              stepIndex === currentStep ||
              completedSteps.has(stepIndex) ||
              (stepIndex > 0 && completedSteps.has(stepIndex - 1))
            }
          />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
          {currentStep === 0 && (
            <TemplateContractBasicsStep
              data={wizardData}
              updateData={updateData}
              nameError={templateNameError}
            />
          )}
          {currentStep === 1 && (
            <TemplateFixedFeeServicesStep data={wizardData} updateData={updateData} />
          )}
          {currentStep === 2 && (
            <TemplateProductsStep data={wizardData} updateData={updateData} />
          )}
          {currentStep === 3 && (
            <TemplateHourlyServicesStep data={wizardData} updateData={updateData} />
          )}
          {currentStep === 4 && (
            <TemplateUsageBasedServicesStep data={wizardData} updateData={updateData} />
          )}
          {currentStep === 5 && (
            <TemplateReviewContractStep data={wizardData} updateData={updateData} />
          )}

          {errors[currentStep] && (
            <div className="bg-[rgb(var(--color-destructive)/0.1)] text-[rgb(var(--color-destructive))] px-4 py-3 rounded-md text-sm border border-[rgb(var(--color-destructive)/0.2)]">
              {errors[currentStep]}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

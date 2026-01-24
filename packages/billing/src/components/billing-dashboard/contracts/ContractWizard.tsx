'use client';

import React, { useEffect, useState, useTransition } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { WizardProgress } from '@alga-psa/ui/components/onboarding/WizardProgress';
import { WizardNavigation } from '@alga-psa/ui/components/onboarding/WizardNavigation';
import { ContractBasicsStep } from './wizard-steps/ContractBasicsStep';
import { FixedFeeServicesStep } from './wizard-steps/FixedFeeServicesStep';
import { ProductsStep } from './wizard-steps/ProductsStep';
import { HourlyServicesStep } from './wizard-steps/HourlyServicesStep';
import { UsageBasedServicesStep } from './wizard-steps/UsageBasedServicesStep';
import { ReviewContractStep } from './wizard-steps/ReviewContractStep';
import {
  createClientContractFromWizard,
  listContractTemplatesForWizard,
  getContractTemplateSnapshotForClientWizard,
  ClientContractWizardSubmission,
  ClientTemplateSnapshot,
} from '@alga-psa/billing/actions/contractWizardActions';

const STEPS = [
  'Contract Basics',
  'Fixed Fee Services',
  'Products',
  'Hourly Services',
  'Usage-Based Services',
  'Review & Create',
] as const;

const REQUIRED_STEPS = [0, 5];

export interface BucketOverlayInput {
  total_minutes?: number;
  overage_rate?: number;
  allow_rollover?: boolean;
  billing_period?: 'monthly' | 'weekly';
}

export interface ContractWizardData {
  client_id: string;
  contract_name: string;
  start_date: string;
  end_date?: string;
  description?: string;
  billing_frequency: string;
  currency_code: string;
  po_number?: string;
  po_amount?: number;
  po_required?: boolean;
  fixed_services: Array<{
    service_id: string;
    service_name?: string;
    quantity: number;
    bucket_overlay?: BucketOverlayInput | null;
  }>;
  product_services: Array<{
    service_id: string;
    service_name?: string;
    quantity: number;
    /** Optional per-unit override in cents (contract currency). */
    custom_rate?: number;
  }>;
  fixed_base_rate?: number;
  fixed_billing_frequency?: string;
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
  contract_id?: string;
  is_draft?: boolean;
  template_id?: string;
}

type TemplateOption = {
  contract_id: string;
  contract_name: string;
  contract_description?: string | null;
  billing_frequency?: string | null;
};

interface ContractWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: (data: ContractWizardData) => void;
  editingContract?: ContractWizardData | null;
}

export function ContractWizard({
  open,
  onOpenChange,
  onComplete,
  editingContract = null,
}: ContractWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [isTemplateLoading, startTemplateTransition] = useTransition();

  const defaultWizardData: ContractWizardData = {
    client_id: '',
    contract_name: '',
    start_date: '',
    end_date: undefined,
    description: '',
    billing_frequency: 'monthly',
    currency_code: 'USD',
    fixed_services: [],
    product_services: [],
    fixed_base_rate: undefined,
    enable_proration: true,
    hourly_services: [],
    minimum_billable_time: undefined,
    round_up_to_nearest: undefined,
    usage_services: [],
    template_id: undefined,
  };

  const [wizardData, setWizardData] = useState<ContractWizardData>(() => ({
    ...defaultWizardData,
    ...(editingContract ?? {}),
  }));

  useEffect(() => {
    if (!open) {
      resetWizard();
      return;
    }

    setErrors({});
    setCompletedSteps(new Set());
    setCurrentStep(0);

    if (editingContract) {
      setWizardData({ ...defaultWizardData, ...editingContract });
      setSelectedTemplateId(editingContract.template_id ?? null);
    } else {
      setWizardData(defaultWizardData);
      setSelectedTemplateId(null);
    }

    setIsLoadingTemplates(true);
    setTemplateError(null);
    listContractTemplatesForWizard()
      .then((options) => {
        setTemplates(options);
      })
      .catch((error) => {
        console.error('Failed to load contract templates', error);
        setTemplateError(
          error instanceof Error ? error.message : 'Failed to load templates'
        );
      })
      .finally(() => {
        setIsLoadingTemplates(false);
      });
  }, [open, editingContract]);

  const resetWizard = () => {
    setWizardData(defaultWizardData);
    setSelectedTemplateId(null);
    setErrors({});
    setCompletedSteps(new Set());
    setCurrentStep(0);
  };

  const updateData = (data: Partial<ContractWizardData>) => {
    setWizardData((prev) => ({ ...prev, ...data }));
  };

  const applyTemplateSnapshot = (snapshot: ClientTemplateSnapshot, templateId: string) => {
    setWizardData((prev) => ({
      ...prev,
      template_id: templateId,
      contract_name: snapshot.contract_name ?? prev.contract_name,
      description: snapshot.description ?? prev.description,
      billing_frequency: snapshot.billing_frequency ?? prev.billing_frequency,
      // currency_code is inherited from client, not from template (templates are currency-neutral)
      fixed_services: snapshot.fixed_services ?? [],
      product_services: snapshot.product_services ?? [],
      fixed_base_rate: snapshot.fixed_base_rate,
      enable_proration: snapshot.enable_proration ?? prev.enable_proration,
      hourly_services: snapshot.hourly_services ?? [],
      usage_services: snapshot.usage_services ?? [],
      minimum_billable_time: snapshot.minimum_billable_time ?? prev.minimum_billable_time,
      round_up_to_nearest: snapshot.round_up_to_nearest ?? prev.round_up_to_nearest,
    }));
  };

  const handleTemplateSelect = (templateId: string | null) => {
    setSelectedTemplateId(templateId);
    if (!templateId) {
      setTemplateError(null);
      updateData({ template_id: undefined });
      return;
    }

    setTemplateError(null);
    startTemplateTransition(async () => {
      try {
        const snapshot = await getContractTemplateSnapshotForClientWizard(templateId);
        applyTemplateSnapshot(snapshot, templateId);
      } catch (error) {
        console.error('Failed to load template snapshot', error);
        setTemplateError(
          error instanceof Error ? error.message : 'Failed to load template details'
        );
      }
    });
  };

  const buildSubmissionData = (): ClientContractWizardSubmission => ({
    contract_id: wizardData.contract_id,
    contract_name: wizardData.contract_name.trim(),
    description: wizardData.description?.trim() || undefined,
    client_id: wizardData.client_id || '',
    start_date: wizardData.start_date,
    end_date: wizardData.end_date,
    po_required: wizardData.po_required,
    po_number: wizardData.po_number,
    po_amount: wizardData.po_amount,
    fixed_base_rate: wizardData.fixed_base_rate,
    fixed_billing_frequency: wizardData.fixed_billing_frequency,
    enable_proration: wizardData.enable_proration,
    hourly_services: wizardData.hourly_services ?? [],
    hourly_billing_frequency: wizardData.hourly_billing_frequency,
    fixed_services: wizardData.fixed_services ?? [],
    product_services: wizardData.product_services ?? [],
    usage_services: wizardData.usage_services ?? [],
    usage_billing_frequency: wizardData.usage_billing_frequency,
    minimum_billable_time: wizardData.minimum_billable_time,
    round_up_to_nearest: wizardData.round_up_to_nearest,
    billing_frequency: wizardData.billing_frequency,
    currency_code: wizardData.currency_code,
    template_id: wizardData.template_id,
  });

  const validateStep = (stepIndex: number): boolean => {
    setErrors((prev) => ({ ...prev, [stepIndex]: '' }));

    switch (stepIndex) {
      case 0:
        if (!wizardData.client_id) {
          setErrors((prev) => ({ ...prev, [stepIndex]: 'Client is required' }));
          return false;
        }
        if (!wizardData.contract_name?.trim()) {
          setErrors((prev) => ({ ...prev, [stepIndex]: 'Contract name is required' }));
          return false;
        }
        if (!wizardData.billing_frequency) {
          setErrors((prev) => ({ ...prev, [stepIndex]: 'Billing frequency is required' }));
          return false;
        }
        if (!wizardData.start_date) {
          setErrors((prev) => ({ ...prev, [stepIndex]: 'Start date is required' }));
          return false;
        }
        return true;
      case 1:
        if (wizardData.fixed_services.length > 0 && !wizardData.fixed_base_rate) {
          setErrors((prev) => ({
            ...prev,
            [stepIndex]: 'Base rate is required when fixed services are included',
          }));
          return false;
        }
        return true;
      case 2: {
        const hasMissingProduct = (wizardData.product_services ?? []).some((p) => !p?.service_id);
        if (hasMissingProduct) {
          setErrors((prev) => ({
            ...prev,
            [stepIndex]: 'Please select a product for each product line',
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
            [stepIndex]: 'Add at least one service before creating the contract',
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
    if (!validateStep(currentStep)) {
      return;
    }
    if (currentStep < STEPS.length - 1) {
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
    if (currentStep < STEPS.length - 1 && !REQUIRED_STEPS.includes(currentStep)) {
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

  const handleFinish = async () => {
    if (!validateStep(currentStep)) {
      return;
    }

    setIsLoading(true);
    try {
      const submission = buildSubmissionData();
      const result = await createClientContractFromWizard(submission);

      const completedData: ContractWizardData = {
        ...wizardData,
        contract_id: result.contract_id,
      };

      setWizardData(completedData);
      onComplete?.(completedData);
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating contract', error);
      setErrors((prev) => ({
        ...prev,
        [currentStep]: error instanceof Error ? error.message : 'Failed to create contract',
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!validateStep(0)) {
      setCurrentStep(0);
      return;
    }

    if (!wizardData.client_id) {
      setErrors((prev) => ({
        ...prev,
        [currentStep]: 'Select a client before saving as draft',
      }));
      setCurrentStep(0);
      return;
    }

    setIsLoading(true);
    try {
      const submission = buildSubmissionData();
      const result = await createClientContractFromWizard(submission, { isDraft: true });

      const draftData: ContractWizardData = {
        ...wizardData,
        contract_id: result.contract_id,
        client_id: wizardData.client_id || '',
        is_draft: true,
      };

      setWizardData(draftData);
      onComplete?.(draftData);
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving contract draft', error);
      setErrors((prev) => ({
        ...prev,
        [currentStep]: error instanceof Error ? error.message : 'Failed to save draft',
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <ContractBasicsStep
            data={wizardData}
            updateData={updateData}
            templates={templates}
            isLoadingTemplates={isLoadingTemplates}
            selectedTemplateId={selectedTemplateId}
            onTemplateSelect={handleTemplateSelect}
            isTemplateLoading={isTemplateLoading}
            templateError={templateError}
          />
        );
      case 1:
        return <FixedFeeServicesStep data={wizardData} updateData={updateData} />;
      case 2:
        return <ProductsStep data={wizardData} updateData={updateData} />;
      case 3:
        return <HourlyServicesStep data={wizardData} updateData={updateData} />;
      case 4:
        return <UsageBasedServicesStep data={wizardData} updateData={updateData} />;
      case 5:
        return <ReviewContractStep data={wizardData} />;
      default:
        return null;
    }
  };

  return (
    <Dialog
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title={editingContract ? 'Edit Contract' : 'Create New Contract'}
      className="max-w-4xl max-h-[90vh]"
      disableFocusTrap
    >
      <div className="flex flex-col h-full">
        <div className="flex-shrink-0 px-6 pt-6">
          <WizardProgress
            steps={STEPS as unknown as string[]}
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

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mb-4">{renderStep()}</div>

          {errors[currentStep] && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-700 text-sm">{errors[currentStep]}</p>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 px-6 pb-6 border-t bg-white">
          <WizardNavigation
            currentStep={currentStep}
            totalSteps={STEPS.length}
            onBack={handleBack}
            onNext={handleNext}
            onSkip={handleSkip}
            onFinish={handleFinish}
            onSaveDraft={handleSaveDraft}
            isNextDisabled={isLoading}
            isSkipDisabled={REQUIRED_STEPS.includes(currentStep)}
            isLoading={isLoading}
            showSaveDraft
          />
        </div>
      </div>
    </Dialog>
  );
}

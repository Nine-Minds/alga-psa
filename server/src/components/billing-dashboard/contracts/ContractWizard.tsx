'use client';

import React, { useState, useEffect } from 'react';
import { Dialog } from 'server/src/components/ui/Dialog';
import { WizardProgress } from 'server/src/components/onboarding/WizardProgress';
import { WizardNavigation } from 'server/src/components/onboarding/WizardNavigation';
import { ContractBasicsStep } from './wizard-steps/ContractBasicsStep';
import { FixedFeeServicesStep } from './wizard-steps/FixedFeeServicesStep';
import { HourlyServicesStep } from './wizard-steps/HourlyServicesStep';
import { UsageBasedServicesStep } from './wizard-steps/UsageBasedServicesStep';
import { ReviewContractStep } from './wizard-steps/ReviewContractStep';
import { createContractFromWizard, ContractWizardSubmission } from 'server/src/lib/actions/contractWizardActions';

const STEPS = [
  'Contract Basics',
  'Fixed Fee Services',
  'Hourly Services',
  'Usage-Based Services',
  'Review & Create'
];

const REQUIRED_STEPS = [0, 4]; // Contract Basics and Review are required

export interface BucketOverlayInput {
  total_minutes?: number;
  overage_rate?: number;
  allow_rollover?: boolean;
  billing_period?: 'monthly' | 'weekly';
}

export interface ContractWizardData {
  contract_name: string;
  description?: string;
  billing_frequency: string;

  // Step 2: Fixed Fee Services
  fixed_services: Array<{
    service_id: string;
    service_name?: string;
    quantity?: number;
    bucket_overlay?: BucketOverlayInput | null;
  }>;

  // Step 3: Hourly Services
  hourly_services: Array<{
    service_id: string;
    service_name?: string;
    bucket_overlay?: BucketOverlayInput | null;
  }>;
  minimum_billable_time?: number;
  round_up_to_nearest?: number;

  // Step 4: Usage-Based Services
  usage_services?: Array<{
    service_id: string;
    service_name?: string;
    unit_of_measure?: string;
    bucket_overlay?: BucketOverlayInput | null;
  }>;

  // Internal tracking
  contract_id?: string;
  is_draft?: boolean;
}

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
  editingContract = null
}: ContractWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const [wizardData, setWizardData] = useState<ContractWizardData>({
    contract_name: '',
    description: '',
    billing_frequency: 'monthly',
    fixed_services: [],
    hourly_services: [],
    usage_services: [],
    minimum_billable_time: undefined,
    round_up_to_nearest: undefined,
    ...editingContract
  });

  const buildSubmissionData = (): ContractWizardSubmission => ({
    contract_name: wizardData.contract_name.trim(),
    description: wizardData.description?.trim() || undefined,
    fixed_services: wizardData.fixed_services ?? [],
    hourly_services: wizardData.hourly_services ?? [],
    usage_services: wizardData.usage_services ?? [],
    minimum_billable_time: wizardData.minimum_billable_time,
    round_up_to_nearest: wizardData.round_up_to_nearest,
    billing_frequency: wizardData.billing_frequency,
  });

  useEffect(() => {
    if (editingContract) {
      setWizardData((prev) => ({ ...prev, ...editingContract }));
    }
  }, [editingContract]);

  const updateData = (data: Partial<ContractWizardData>) => {
    setWizardData((prev) => ({ ...prev, ...data }));
  };

  const validateStep = (stepIndex: number): boolean => {
    setErrors(prev => ({ ...prev, [stepIndex]: '' }));

    switch (stepIndex) {
      case 0: // Contract Basics
        if (!wizardData.contract_name?.trim()) {
          setErrors(prev => ({ ...prev, [stepIndex]: 'Contract name is required' }));
          return false;
        }
        if (!wizardData.billing_frequency) {
          setErrors(prev => ({ ...prev, [stepIndex]: 'Billing frequency is required' }));
          return false;
        }
        return true;

      case 1: // Fixed Fee Services
        return true;

      case 2: // Hourly Services
        return true;

      case 3: // Usage-Based Services
        return true;

      case 4: { // Review
        const hasServices =
          wizardData.fixed_services.length > 0 ||
          wizardData.hourly_services.length > 0 ||
          !!(wizardData.usage_services && wizardData.usage_services.length > 0);

        if (!hasServices) {
          setErrors(prev => ({ ...prev, [stepIndex]: 'At least one service line is required' }));
          return false;
        }
        return true;
      }

      default:
        return true;
    }
  };

  const handleNext = async () => {
    if (!validateStep(currentStep)) {
      return;
    }

    if (currentStep < STEPS.length - 1) {
      setCompletedSteps(prev => new Set([...prev, currentStep]));
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = () => {
    if (currentStep < STEPS.length - 1 && !REQUIRED_STEPS.includes(currentStep)) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleStepClick = (stepIndex: number) => {
    // Allow navigation to completed steps or the next step after last completed
    if (stepIndex === 0 || completedSteps.has(stepIndex) ||
        (stepIndex > 0 && completedSteps.has(stepIndex - 1))) {
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

      const contractResult = await createContractFromWizard(submission);

      const completedData: ContractWizardData = {
        ...wizardData,
        contract_id: contractResult.contract_id,
      };

      setWizardData(completedData);
      onComplete?.(completedData);
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating contract:', error);
      setErrors(prev => ({
        ...prev,
        [currentStep]: error instanceof Error ? error.message : 'Failed to create contract'
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveDraft = async () => {
    const basicsValid = validateStep(0);
    if (!basicsValid) {
      setCurrentStep(0);
      return;
    }

    setIsLoading(true);
    try {
      const submission = buildSubmissionData();
      const contractResult = await createContractFromWizard(submission, { isDraft: true });

      const draftData: ContractWizardData = {
        ...wizardData,
        contract_id: contractResult.contract_id,
        is_draft: true,
      };

      setWizardData(draftData);
      onComplete?.(draftData);
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving contract draft:', error);
      setErrors(prev => ({
        ...prev,
        [currentStep]: error instanceof Error ? error.message : 'Failed to save draft'
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <ContractBasicsStep data={wizardData} updateData={updateData} />;
      case 1:
        return <FixedFeeServicesStep data={wizardData} updateData={updateData} />;
      case 2:
        return <HourlyServicesStep data={wizardData} updateData={updateData} />;
      case 3:
        return <UsageBasedServicesStep data={wizardData} updateData={updateData} />;
      case 4:
        return <ReviewContractStep data={wizardData} />;
      default:
        return null;
    }
  };

  return (
    <Dialog
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title={editingContract ? "Edit Template" : "Create Contract Template"}
      className="max-w-4xl max-h-[90vh]"
    >
      <div className="flex flex-col h-full">
        <div className="flex-shrink-0 px-6 pt-6">
          <WizardProgress
            steps={STEPS}
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
          <div className="mb-4">
            {renderStep()}
          </div>

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

'use client';

import React, { useState, useEffect } from 'react';
import { Dialog } from 'server/src/components/ui/Dialog';
import { WizardProgress } from 'server/src/components/onboarding/WizardProgress';
import { WizardNavigation } from 'server/src/components/onboarding/WizardNavigation';
import { ContractBasicsStep } from './wizard-steps/ContractBasicsStep';
import { FixedFeeServicesStep } from './wizard-steps/FixedFeeServicesStep';
import { HourlyServicesStep } from './wizard-steps/HourlyServicesStep';
import { BucketHoursStep } from './wizard-steps/BucketHoursStep';
import { UsageBasedServicesStep } from './wizard-steps/UsageBasedServicesStep';
import { ReviewContractStep } from './wizard-steps/ReviewContractStep';

const STEPS = [
  'Contract Basics',
  'Fixed Fee Services',
  'Hourly Services',
  'Bucket Hours',
  'Usage-Based Services',
  'Review & Create'
];

const REQUIRED_STEPS = [0, 5]; // Contract Basics and Review are required

export interface ContractWizardData {
  // Step 1: Contract Basics
  company_id: string;
  contract_name: string;
  billing_frequency: string;
  start_date: string;
  end_date?: string;
  description?: string;

  // Purchase Order fields
  po_number?: string;
  po_amount?: number;
  po_required?: boolean;

  // Step 2: Fixed Fee Services
  fixed_services: Array<{
    service_id: string;
    service_name?: string;
    quantity: number;
  }>;
  fixed_base_rate?: number;
  enable_proration: boolean;

  // Step 3: Hourly Services
  hourly_services: Array<{
    service_id: string;
    service_name?: string;
    hourly_rate?: number;
  }>;
  minimum_billable_time?: number;
  round_up_to_nearest?: number;

  // Step 4: Bucket Hours
  bucket_hours?: number;
  bucket_monthly_fee?: number;
  bucket_overage_rate?: number;
  bucket_services: Array<{
    service_id: string;
    service_name?: string;
  }>;

  // Step 5: Usage-Based Services
  usage_services?: Array<{
    service_id: string;
    service_name?: string;
    unit_rate?: number;
    unit_of_measure?: string;
  }>;

  // Internal tracking
  bundle_id?: string; // Set after creation
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
    company_id: '',
    contract_name: '',
    billing_frequency: 'monthly',
    start_date: '',
    end_date: undefined,
    description: '',
    fixed_services: [],
    fixed_base_rate: undefined,
    enable_proration: true,
    hourly_services: [],
    minimum_billable_time: undefined,
    round_up_to_nearest: undefined,
    bucket_hours: undefined,
    bucket_monthly_fee: undefined,
    bucket_overage_rate: undefined,
    bucket_services: [],
    usage_services: [],
    ...editingContract
  });

  useEffect(() => {
    if (editingContract) {
      setWizardData({ ...wizardData, ...editingContract });
    }
  }, [editingContract]);

  const updateData = (data: Partial<ContractWizardData>) => {
    setWizardData((prev) => ({ ...prev, ...data }));
  };

  const validateStep = (stepIndex: number): boolean => {
    setErrors(prev => ({ ...prev, [stepIndex]: '' }));

    switch (stepIndex) {
      case 0: // Contract Basics
        if (!wizardData.company_id) {
          setErrors(prev => ({ ...prev, [stepIndex]: 'Client is required' }));
          return false;
        }
        if (!wizardData.contract_name?.trim()) {
          setErrors(prev => ({ ...prev, [stepIndex]: 'Contract name is required' }));
          return false;
        }
        if (!wizardData.billing_frequency) {
          setErrors(prev => ({ ...prev, [stepIndex]: 'Billing frequency is required' }));
          return false;
        }
        if (!wizardData.start_date) {
          setErrors(prev => ({ ...prev, [stepIndex]: 'Start date is required' }));
          return false;
        }
        return true;

      case 1: // Fixed Fee Services
        // Optional step - validate only if user has added services
        if (wizardData.fixed_services.length > 0 && !wizardData.fixed_base_rate) {
          setErrors(prev => ({ ...prev, [stepIndex]: 'Base rate is required when services are selected' }));
          return false;
        }
        return true;

      case 2: // Hourly Services
        // Optional step
        return true;

      case 3: // Bucket Hours
        // Optional step - validate only if user has filled any bucket field
        const hasBucketData = wizardData.bucket_hours || wizardData.bucket_monthly_fee || wizardData.bucket_overage_rate;
        if (hasBucketData) {
          if (!wizardData.bucket_hours) {
            setErrors(prev => ({ ...prev, [stepIndex]: 'Bucket hours are required' }));
            return false;
          }
          if (!wizardData.bucket_monthly_fee) {
            setErrors(prev => ({ ...prev, [stepIndex]: 'Monthly fee is required' }));
            return false;
          }
          if (!wizardData.bucket_overage_rate) {
            setErrors(prev => ({ ...prev, [stepIndex]: 'Overage rate is required' }));
            return false;
          }
        }
        return true;

      case 4: // Usage-Based Services
        // Optional step
        return true;

      case 5: // Review
        // Check that at least one service type is configured
        const hasServices =
          wizardData.fixed_services.length > 0 ||
          wizardData.hourly_services.length > 0 ||
          (wizardData.bucket_hours && wizardData.bucket_services.length > 0) ||
          (wizardData.usage_services && wizardData.usage_services.length > 0);

        if (!hasServices) {
          setErrors(prev => ({ ...prev, [stepIndex]: 'At least one service line is required' }));
          return false;
        }
        return true;

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
      // TODO: Call backend to create contract
      // For now, just call onComplete with the data
      console.log('Creating contract with data:', wizardData);
      onComplete?.(wizardData);
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

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <ContractBasicsStep data={wizardData} updateData={updateData} />;
      case 1:
        return <FixedFeeServicesStep data={wizardData} updateData={updateData} />;
      case 2:
        return <HourlyServicesStep data={wizardData} updateData={updateData} />;
      case 3:
        return <BucketHoursStep data={wizardData} updateData={updateData} />;
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
      title={editingContract ? "Edit Contract" : "Create New Contract"}
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
            isNextDisabled={isLoading}
            isSkipDisabled={REQUIRED_STEPS.includes(currentStep)}
            isLoading={isLoading}
          />
        </div>
      </div>
    </Dialog>
  );
}
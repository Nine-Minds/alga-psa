'use client';

import React from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { ContractWizardData } from '../ContractWizard';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';
import { FileText, Repeat, StickyNote } from 'lucide-react';

interface ContractBasicsStepProps {
  data: ContractWizardData;
  updateData: (data: Partial<ContractWizardData>) => void;
}

export function ContractBasicsStep({ data, updateData }: ContractBasicsStepProps) {
  return (
    <div className="space-y-6" data-automation-id="contract-template-basics-step">
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Template Basics</h3>
        <p className="text-sm text-gray-600">
          Name this contract template and capture any helpful guidance for teammates.
          Pricing and client-specific terms will be collected when the template is applied to a client.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="template-name" className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Template Name *
        </Label>
        <Input
          id="template-name"
          type="text"
          value={data.contract_name}
          onChange={(e) => updateData({ contract_name: e.target.value })}
          placeholder="e.g., Managed Services Starter, Premium Support Bundle"
          className="w-full"
        />
        <p className="text-xs text-gray-500">
          Use a clear name so teams can quickly identify the right template.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="template-description" className="flex items-center gap-2">
          <StickyNote className="h-4 w-4" />
          Internal Notes (optional)
        </Label>
        <TextArea
          id="template-description"
          value={data.description ?? ''}
          onChange={(e) => updateData({ description: e.target.value })}
          placeholder="Describe where this template applies, onboarding tips, or approval requirements."
          className="min-h-[96px]"
        />
        <p className="text-xs text-gray-500">
          These notes stay with the template and help provide context during client assignments.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="template-billing-frequency" className="flex items-center gap-2">
          <Repeat className="h-4 w-4" />
          Recommended Billing Frequency *
        </Label>
        <CustomSelect
          id="template-billing-frequency"
          options={BILLING_FREQUENCY_OPTIONS}
          onValueChange={(value: string) => updateData({ billing_frequency: value })}
          value={data.billing_frequency}
          placeholder="Select billing cadence"
          className="w-full"
        />
        <p className="text-xs text-gray-500">
          This sets the default cadence when the template is applied. It can be adjusted per client if needed.
        </p>
      </div>
    </div>
  );
}

'use client';

import React from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';
import { FileText, Repeat, StickyNote } from 'lucide-react';
import { TemplateWizardData } from '../TemplateWizard';

interface TemplateContractBasicsStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
}

export function TemplateContractBasicsStep({
  data,
  updateData,
}: TemplateContractBasicsStepProps) {
  return (
    <div className="space-y-6" data-automation-id="template-contract-basics-step">
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Template Basics</h3>
        <p className="text-sm text-gray-600">
          Name this contract template and capture high-level guidance. Pricing and client
          specifics will be finalized when the template is applied to a client.
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
          onChange={(event) => updateData({ contract_name: event.target.value })}
          placeholder="Managed Services Starter, Premium Support Bundle, etc."
        />
        <p className="text-xs text-gray-500">
          Use a descriptive name so teams can quickly identify the right template.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="template-description" className="flex items-center gap-2">
          <StickyNote className="h-4 w-4" />
          Internal Notes
        </Label>
        <TextArea
          id="template-description"
          value={data.description ?? ''}
          onChange={(event) => updateData({ description: event.target.value })}
          placeholder="Describe where this template applies, onboarding tips, or approval requirements."
          className="min-h-[96px]"
        />
        <p className="text-xs text-gray-500">
          These notes stay with the template to provide context when teammates use it.
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
          value={data.billing_frequency}
          onValueChange={(value) => updateData({ billing_frequency: value })}
          placeholder="Select billing cadence"
        />
        <p className="text-xs text-gray-500">
          Sets the default cadence when the template is applied. It can still be adjusted per
          client.
        </p>
      </div>
    </div>
  );
}

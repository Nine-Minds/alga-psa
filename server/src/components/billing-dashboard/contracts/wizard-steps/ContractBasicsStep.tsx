'use client';

import React, { useState, useEffect } from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { ContractWizardData } from '../ContractWizard';
import { ICompany } from 'server/src/interfaces';
import { getAllCompanies } from 'server/src/lib/actions/company-actions/companyActions';
import { Calendar, Building2, FileText } from 'lucide-react';

interface ContractBasicsStepProps {
  data: ContractWizardData;
  updateData: (data: Partial<ContractWizardData>) => void;
}

export function ContractBasicsStep({ data, updateData }: ContractBasicsStepProps) {
  const [companies, setCompanies] = useState<ICompany[]>([]);
  const [isLoadingCompanies, setIsLoadingCompanies] = useState(true);

  useEffect(() => {
    loadCompanies();
  }, []);

  const loadCompanies = async () => {
    try {
      const fetchedCompanies = await getAllCompanies();
      setCompanies(fetchedCompanies);
    } catch (error) {
      console.error('Error loading companies:', error);
    } finally {
      setIsLoadingCompanies(false);
    }
  };

  const companyOptions = companies.map(company => ({
    value: company.company_id,
    label: company.company_name
  }));

  // Get today's date in YYYY-MM-DD format for min date
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Contract Basics</h3>
        <p className="text-sm text-gray-600">
          Start by selecting a client and naming this contract. You'll configure services in the next steps.
        </p>
      </div>

      {/* Client Selection */}
      <div className="space-y-2">
        <Label htmlFor="client" className="flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Client *
        </Label>
        <CustomSelect
          value={data.company_id}
          onValueChange={(value: string) => updateData({ company_id: value })}
          options={companyOptions}
          placeholder={isLoadingCompanies ? "Loading clients..." : "Select a client"}
          disabled={isLoadingCompanies}
          className="w-full"
        />
        {!data.company_id && (
          <p className="text-xs text-gray-500">
            Choose the client this contract is for
          </p>
        )}
      </div>

      {/* Contract Name */}
      <div className="space-y-2">
        <Label htmlFor="contract_name" className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Contract Name *
        </Label>
        <Input
          id="contract_name"
          type="text"
          value={data.contract_name}
          onChange={(e) => updateData({ contract_name: e.target.value })}
          placeholder="e.g., Standard MSP Services, Premium Support Package"
          className="w-full"
        />
        <p className="text-xs text-gray-500">
          Give this contract a descriptive name
        </p>
      </div>

      {/* Start Date */}
      <div className="space-y-2">
        <Label htmlFor="start_date" className="flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          Start Date *
        </Label>
        <Input
          id="start_date"
          type="date"
          value={data.start_date}
          onChange={(e) => updateData({ start_date: e.target.value })}
          min={today}
          className="w-full"
        />
        <p className="text-xs text-gray-500">
          When does this contract become active?
        </p>
      </div>

      {/* End Date (Optional) */}
      <div className="space-y-2">
        <Label htmlFor="end_date" className="flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          End Date (Optional)
        </Label>
        <Input
          id="end_date"
          type="date"
          value={data.end_date || ''}
          onChange={(e) => updateData({ end_date: e.target.value || undefined })}
          min={data.start_date || today}
          className="w-full"
        />
        <p className="text-xs text-gray-500">
          Leave blank for an ongoing contract with no end date
        </p>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">
          Description (Optional)
        </Label>
        <TextArea
          id="description"
          value={data.description || ''}
          onChange={(e) => updateData({ description: e.target.value })}
          placeholder="Add any additional notes about this contract..."
          className="min-h-[100px] w-full"
        />
        <p className="text-xs text-gray-500">
          Internal notes or contract details
        </p>
      </div>

      {/* Summary Card */}
      {data.company_id && data.contract_name && data.start_date && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">Contract Summary</h4>
          <div className="text-sm text-blue-800 space-y-1">
            <p><strong>Client:</strong> {companyOptions.find(c => c.value === data.company_id)?.label}</p>
            <p><strong>Contract:</strong> {data.contract_name}</p>
            <p><strong>Period:</strong> {new Date(data.start_date).toLocaleDateString()}
              {data.end_date ? ` - ${new Date(data.end_date).toLocaleDateString()}` : ' (Ongoing)'}</p>
          </div>
        </div>
      )}
    </div>
  );
}
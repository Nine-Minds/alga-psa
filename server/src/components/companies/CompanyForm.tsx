// server/src/components/CompanyForm.tsx
import React, { useState } from 'react';
import { ICompany } from '@/interfaces/company.interfaces';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import CustomSelect from '@/components/ui/CustomSelect';
import { TextArea } from '@/components/ui/TextArea';

interface CompanyFormProps {
  onSubmit: (data: Omit<ICompany, "company_id" | "created_at" | "updated_at">) => void;
}

const CompanyForm: React.FC<CompanyFormProps> = ({ onSubmit }) => {
  const [formData, setFormData] = useState({
    company_name: '',
    client_type: 'company',
    phone_no: '',
    email: '',
    url: '',
    address: '',
    notes: '',
    is_inactive: false,
    is_tax_exempt: false,
    billing_cycle: 'monthly' as const,
    properties: {
      industry: '',
      company_size: '',
      annual_revenue: ''
    },
    credit_balance: 0
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const handleChange = (field: string, value: string | boolean) => {
    if (field.startsWith('properties.')) {
      const propertyField = field.split('.')[1];
      setFormData(prev => ({
        ...prev,
        properties: {
          ...prev.properties,
          [propertyField]: value
        }
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [field]: value
      }));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-[600px]">
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto px-4 space-y-4 pb-4">
          <div>
            <Label htmlFor="company_name">Company Name</Label>
            <Input
              id="company_name"
              value={formData.company_name}
              onChange={(e) => handleChange('company_name', e.target.value)}
              required
            />
          </div>

          <div>
            <CustomSelect
              label="Client Type"
              options={[
                { value: 'company', label: 'Company' },
                { value: 'individual', label: 'Individual' }
              ]}
              value={formData.client_type}
              onValueChange={(value) => handleChange('client_type', value)}
            />
          </div>

          <div>
            <Label htmlFor="phone_no">Phone Number</Label>
            <Input
              id="phone_no"
              value={formData.phone_no}
              onChange={(e) => handleChange('phone_no', e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => handleChange('email', e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="url">URL</Label>
            <Input
              id="url"
              value={formData.url}
              onChange={(e) => handleChange('url', e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              value={formData.address}
              onChange={(e) => handleChange('address', e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="industry">Industry</Label>
            <Input
              id="industry"
              value={formData.properties.industry}
              onChange={(e) => handleChange('properties.industry', e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="company_size">Company Size</Label>
            <Input
              id="company_size"
              value={formData.properties.company_size}
              onChange={(e) => handleChange('properties.company_size', e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="annual_revenue">Annual Revenue</Label>
            <Input
              id="annual_revenue"
              value={formData.properties.annual_revenue}
              onChange={(e) => handleChange('properties.annual_revenue', e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="billing_cycle">Billing Cycle</Label>
            <CustomSelect
              options={[
                { value: 'weekly', label: 'Weekly' },
                { value: 'bi-weekly', label: 'Bi-Weekly' },
                { value: 'monthly', label: 'Monthly' },
                { value: 'quarterly', label: 'Quarterly' },
                { value: 'semi-annually', label: 'Semi-Annually' },
                { value: 'annually', label: 'Annually' }
              ]}
              value={formData.billing_cycle}
              onValueChange={(value) => handleChange('billing_cycle', value)}
            />
          </div>

          <div>
            <Label htmlFor="notes">Notes</Label>
            <TextArea
              id="notes"
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Add any additional notes"
            />
          </div>
        </div>
      </div>

      <div className="pt-4 mt-4 border-t">
        <Button id="create-company-btn" type="submit">
          Create Client
        </Button>
      </div>
    </form>
  );
};

export default CompanyForm;

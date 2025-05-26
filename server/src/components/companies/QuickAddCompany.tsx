// server/src/components/companies/QuickAddCompany.tsx
import React, { useState, useEffect } from 'react';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { TextArea } from 'server/src/components/ui/TextArea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter
} from 'server/src/components/ui/Dialog';
import UserPicker from 'server/src/components/ui/UserPicker';
import { getAllUsers } from 'server/src/lib/actions/user-actions/userActions';
import { createCompany } from 'server/src/lib/actions/companyActions';
import toast from 'react-hot-toast';

type CreateCompanyData = Omit<ICompany, "company_id" | "created_at" | "updated_at" | "notes_document_id" | "status" | "tenant" | "deleted_at" | "address">;

interface QuickAddCompanyProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompanyAdded: (company: ICompany) => void;
  trigger?: React.ReactNode;
}

const QuickAddCompany: React.FC<QuickAddCompanyProps> = ({
  open,
  onOpenChange,
  onCompanyAdded,
  trigger
}) => {
  const initialFormData: CreateCompanyData = {
    company_name: '',
    client_type: 'company',
    phone_no: '',
    email: '',
    url: '',
    notes: '',
    is_inactive: false,
    is_tax_exempt: false,
    billing_cycle: 'monthly' as const,
    properties: {
      industry: '',
      company_size: '',
      annual_revenue: '',
      website: '',
    },
    account_manager_id: null,
    credit_balance: 0,
  };

  const [formData, setFormData] = useState<CreateCompanyData>(initialFormData);
  const [internalUsers, setInternalUsers] = useState<IUserWithRoles[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);














  useEffect(() => {
    if (open) {
      const fetchUsers = async () => {
        // Avoid fetching if already loading or users are loaded
        if (isLoadingUsers || internalUsers.length > 0) return;
        setIsLoadingUsers(true);
        try {
          // Use getAllUsers and let UserPicker filter internally if needed
          const users = await getAllUsers();
          setInternalUsers(users);
        } catch (error: any) { // Add type annotation for error
          console.error("Error fetching internal users:", error);
          toast.error("Failed to load users for Account Manager selection.");
        } finally {
          setIsLoadingUsers(false);
        }
      };
      fetchUsers();
    } else {
      setFormData(initialFormData);
      setIsSubmitting(false);
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const dataToSend = {
        ...formData,
        properties: formData.properties,
        account_manager_id: formData.account_manager_id === '' ? null : formData.account_manager_id,
      };

      const newCompany = await createCompany(dataToSend);
      toast.success(`Company "${newCompany.company_name}" created successfully.`);
      onCompanyAdded(newCompany);
      onOpenChange(false);
    } catch (error: any) { // Add type annotation for error
      console.error("Error creating company:", error);
      const errorMessage = "Failed to create company. Please try again.";
      setError(errorMessage);
      toast.error(errorMessage);
      setIsSubmitting(false);
    }
  };

  const handleChange = (field: string, value: string | boolean | null) => {
    setFormData(prev => {
      const updatedState = { ...prev };

      if (field.startsWith('properties.') && field !== 'properties.account_manager_id') {
        const propertyField = field.split('.')[1];
        if (!updatedState.properties) {
          updatedState.properties = {};
        }
        (updatedState.properties as any)[propertyField] = value;

        if (propertyField === 'website') {
          updatedState.url = value as string;
        }
      } else if (field === 'url') {
        updatedState.url = value as string;
        if (!updatedState.properties) {
          updatedState.properties = {};
        }
        updatedState.properties.website = value as string;
      } else if (field !== 'address') { // Exclude address field
        (updatedState as any)[field] = value;
      }
      return updatedState;
    });
  };

  return (
    <Dialog
      id="quick-add-company-dialog"
      title="Add New Client"
      isOpen={open}
      onClose={() =>
      onOpenChange(false)}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Client</DialogTitle>
        </DialogHeader>
          <form onSubmit={handleSubmit} id="quick-add-company-form">
            <div className="max-h-[60vh] overflow-y-auto px-1 py-4 space-y-4">
            <div>
              <Label htmlFor="company_name">Company Name *</Label>
              <Input
                data-automation-id="company-name-input"
                value={formData.company_name}
                onChange={(e) => handleChange('company_name', e.target.value)}
                required
                disabled={isSubmitting}
              />
            </div>

            <div>
              <Label htmlFor="client_type_select">Client Type</Label>
              <CustomSelect
                data-automation-id="client_type_select"
                options={[
                  { value: 'company', label: 'Company' },
                  { value: 'individual', label: 'Individual' }
                ]}
                value={formData.client_type}
                onValueChange={(value) => handleChange('client_type', value)}
                disabled={isSubmitting}
              />
            </div>

            <div>
              <Label htmlFor="account_manager_picker">Account Manager</Label>
              <UserPicker
                data-automation-id="account_manager_picker"
                value={formData.account_manager_id || ''}
                onValueChange={(value) => handleChange('account_manager_id', value)}
                users={internalUsers}
                disabled={isLoadingUsers || isSubmitting}
                placeholder={isLoadingUsers ? "Loading users..." : "Select Account Manager"}
                buttonWidth="full"
              />
            </div>

            <div>
              <Label htmlFor="phone_no">Phone Number</Label>
              <Input
                data-automation-id="phone_no"
                value={formData.phone_no}
                onChange={(e) => handleChange('phone_no', e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                data-automation-id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleChange('email', e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div>
              <Label htmlFor="url">Website URL</Label>
              <Input
                data-automation-id="url"
                value={formData.url}
                onChange={(e) => handleChange('url', e.target.value)}
                placeholder="https://example.com"
                disabled={isSubmitting}
              />
              <p className="text-xs text-gray-500 mt-1">
                Updates both URL and Website property
              </p>
            </div>

            <div>
              <Label htmlFor="industry">Industry</Label>
              <Input
                data-automation-id="industry"
                value={formData.properties?.industry || ''}
                onChange={(e) => handleChange('properties.industry', e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div>
              <Label htmlFor="company_size">Company Size</Label>
              <Input
                data-automation-id="company_size"
                value={formData.properties?.company_size || ''}
                onChange={(e) => handleChange('properties.company_size', e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div>
              <Label htmlFor="annual_revenue">Annual Revenue</Label>
              <Input
                data-automation-id="annual_revenue"
                value={formData.properties?.annual_revenue || ''}
                onChange={(e) => handleChange('properties.annual_revenue', e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div>
              <Label htmlFor="billing_cycle">Billing Cycle</Label>
              <CustomSelect
                data-automation-id="billing_cycle"
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
                disabled={isSubmitting}
              />
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <TextArea
                data-automation-id="notes"
                value={formData.notes}
                onChange={(e) => handleChange('notes', e.target.value)}
                placeholder="Add any initial notes (optional)"
                disabled={isSubmitting}
              />
            </div>
          </div>
          </form>

        <DialogFooter>
            <Button
              id="cancel-quick-add-company-btn"
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
            >Cancel</Button>
          <Button
            id="create-company-btn"
            type="submit"
            form="quick-add-company-form"
            disabled={isSubmitting || !formData.company_name}
          >
            {isSubmitting ? 'Creating...' : 'Create Client'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default QuickAddCompany;

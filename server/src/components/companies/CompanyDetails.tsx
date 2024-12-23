'use client'

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ICompany } from '@/interfaces/company.interfaces';
import { IDocument } from '@/interfaces/document.interface';
import Documents from '@/components/documents/Documents';
import { IContact } from '@/interfaces/contact.interfaces';
import Contacts from '@/components/contacts/Contacts';
import { Card, Flex, Text, Heading } from '@radix-ui/themes';
import { Switch } from '@/components/ui/Switch';
import BillingConfiguration from './BillingConfiguration';
import { updateCompany } from '@/lib/actions/companyActions';
import CustomTabs from '@/components/ui/CustomTabs';
import { QuickAddTicket } from '../tickets/QuickAddTicket';
import { Button } from '@/components/ui/Button';
import { ITicket } from '@/interfaces';
import TaxSettingsForm from '@/components/TaxSettingsForm';
import InteractionsFeed from '../interactions/InteractionsFeed';
import { IInteraction } from '@/interfaces/interaction.interfaces';
import { useDrawer } from '@/context/DrawerContext';
import { ArrowLeft, Globe } from 'lucide-react';
import TimezonePicker from '@/components/ui/TimezonePicker';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { IUserWithRoles } from '@/interfaces/auth.interfaces';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { TextArea } from '@/components/ui/TextArea';
import CompanyAssets from './CompanyAssets';

interface CompanyDetailsProps {
  company: ICompany;
  documents?: IDocument[];
  contacts?: IContact[];
  isInDrawer?: boolean;
}

const TextDetailItem: React.FC<{ 
  label: string; 
  value: string; 
  onEdit: (value: string) => void;
}> = ({ label, value, onEdit }) => {
  const [localValue, setLocalValue] = useState(value);

  const handleBlur = () => {
    if (localValue !== value) {
      onEdit(localValue);
    }
  };
  
  return (
    <div className="space-y-2">
      <Text as="label" size="2" className="text-gray-700 font-medium">{label}</Text>
      <input
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
      />
    </div>
  );
};

const NotesDetailItem: React.FC<{ 
  value: string; 
  onEdit: (value: string) => void;
  onSave: () => void;
}> = ({ value, onEdit, onSave }) => {
  const [localValue, setLocalValue] = useState(value);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalValue(e.target.value);
    onEdit(e.target.value);
  };
  
  return (
    <div className="space-y-4">
      <Text as="label" size="2" className="text-gray-700 font-medium">Notes</Text>
      <TextArea
        value={localValue}
        onChange={handleChange}
        placeholder="Add notes about this company..."
      />
      <div className="flex justify-end">
        <Button 
          onClick={onSave}
          className="bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] transition-colors"
        >
          Save Notes
        </Button>
      </div>
    </div>
  );
};

const SwitchDetailItem: React.FC<{ 
  value: boolean; 
  onEdit: (value: boolean) => void;
}> = ({ value, onEdit }) => {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <div className="text-gray-900 font-medium">Status</div>
        <div className="text-sm text-gray-500">Set company status as active or inactive</div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-700">
          {value ? 'Inactive' : 'Active'}
        </span>
        <Switch
          checked={value}
          onCheckedChange={onEdit}
          className="data-[state=checked]:bg-primary-500"
        />
      </div>
    </div>
  );
};

const CompanyDetails: React.FC<CompanyDetailsProps> = ({ 
  company, 
  documents = [], 
  contacts = [],
  isInDrawer = false
}) => {
  const [editedCompany, setEditedCompany] = useState(company);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isQuickAddTicketOpen, setIsQuickAddTicketOpen] = useState(false);
  const [interactions, setInteractions] = useState<IInteraction[]>([]);
  const [currentUser, setCurrentUser] = useState<IUserWithRoles | null>(null);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const drawer = useDrawer();

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const user = await getCurrentUser();
        setCurrentUser(user);
      } catch (error) {
        console.error('Error fetching current user:', error);
      }
    };

    fetchUser();
  }, []);

  const handleBack = () => {
    if (isInDrawer) {
      drawer.goBack();
    } else {
      router.push('/msp/companies');
    }
  };

  const handleFieldChange = (field: string, value: string | boolean) => {
    setEditedCompany(prevCompany => {
      let updatedCompany;
      if (field.startsWith('properties.')) {
        const propertyField = field.split('.')[1] as keyof ICompany['properties'];
        updatedCompany = {
          ...prevCompany,
          properties: {
            ...prevCompany.properties,
            [propertyField]: value
          }
        };
      } else {
        updatedCompany = {
          ...prevCompany,
          [field]: value
        };
      }
      return updatedCompany;
    });
    setHasUnsavedChanges(true);
  };

  const handleSave = async () => {
    try {
      const updatedCompany = await updateCompany(company.company_id, editedCompany);
      setEditedCompany(updatedCompany);
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error('Error saving company:', error);
    }
  };

  const handleBillingConfigSave = async (updatedBillingConfig: Partial<ICompany>) => {
    try {
      const updatedCompany = await updateCompany(company.company_id, updatedBillingConfig);
      setEditedCompany(prevCompany => ({ ...prevCompany, ...updatedCompany }));
    } catch (error) {
      console.error('Error updating company:', error);
    }
  };

  const handleTicketAdded = (ticket: ITicket) => {
    setIsQuickAddTicketOpen(false);
  };

  const handleInteractionAdded = (newInteraction: IInteraction) => {
    setInteractions(prevInteractions => {
      const updatedInteractions = [newInteraction, ...prevInteractions];
      return updatedInteractions.filter((interaction, index, self) =>
        index === self.findIndex((t) => t.interaction_id === interaction.interaction_id)
      );
    });
  }

  const handleDocumentCreated = async (): Promise<void> => {
    // Handle the newly created document if needed
    console.log('New document created');
  };

  const handleTabChange = (tabValue: string) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('tab', tabValue);
    router.push(`${pathname}?${params.toString()}`);
  };

  const tabContent = [
    {
      label: "Details",
      content: (
        <div className="space-y-6 bg-white p-6 rounded-lg shadow-sm">
          <TextDetailItem 
            label="Client Name" 
            value={editedCompany.company_name}
            onEdit={(value) => handleFieldChange('company_name', value)}
          />
          <TextDetailItem 
            label="Account Manager" 
            value={editedCompany.properties?.account_manager_name || ''}
            onEdit={(value) => handleFieldChange('properties.account_manager_name', value)}
          />
          <div className="space-y-2">
            <Text size="2" className="text-gray-700 font-medium">Your company&apos;s point of contact</Text>
            <div>
              <Text size="2" className="text-gray-800">Client Services Manager</Text>
              <Text size="2" className="text-gray-500">Someone who you should contact if problems occur</Text>
            </div>
          </div>
          <TextDetailItem 
            label="Industry" 
            value={editedCompany.properties?.industry || ''}
            onEdit={(value) => handleFieldChange('properties.industry', value)}
          />
          <TextDetailItem 
            label="Phone" 
            value={editedCompany.phone_no || ''}
            onEdit={(value) => handleFieldChange('phone_no', value)}
          />
          <TextDetailItem 
            label="Email" 
            value={editedCompany.email || ''}
            onEdit={(value) => handleFieldChange('email', value)}
          />
          <TextDetailItem 
            label="Website" 
            value={editedCompany.properties?.website || ''}
            onEdit={(value) => handleFieldChange('properties.website', value)}
          />
          <TextDetailItem 
            label="Address" 
            value={editedCompany.address || ''}
            onEdit={(value) => handleFieldChange('address', value)}
          />
          <TextDetailItem 
            label="Company Size" 
            value={editedCompany.properties?.company_size || ''}
            onEdit={(value) => handleFieldChange('properties.company_size', value)}
          />
          <TextDetailItem 
            label="Annual Revenue" 
            value={editedCompany.properties?.annual_revenue || ''}
            onEdit={(value) => handleFieldChange('properties.annual_revenue', value)}
          />
          <SwitchDetailItem 
            value={editedCompany.is_inactive}
            onEdit={(value) => handleFieldChange('is_inactive', value)}
          />
          
          <Flex gap="4" justify="end" align="center" className="pt-6">
            <Button 
              onClick={handleSave} 
              className="bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] transition-colors"
            >
              Save Changes
            </Button>
            <Button 
              onClick={() => setIsQuickAddTicketOpen(true)} 
              className="bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] transition-colors"
            >
              Add Ticket
            </Button>
          </Flex>
        </div>
      )
    },
    {
      label: "Assets",
      content: (
        <CompanyAssets companyId={company.company_id} />
      )
    },
    {
      label: "Billing",
      content: (
        <BillingConfiguration company={editedCompany} onSave={handleBillingConfigSave} />
      )
    },
    {
      label: "Contacts",
      content: currentUser ? ( // Only render if we have the current user
        <Contacts
          initialContacts={contacts}
          companyId={company.company_id}
          preSelectedCompanyId={company.company_id}
        />
      ) : (
        <div>Loading...</div>
      )
    },
    {
      label: "Documents",
      content: currentUser ? (
        <Documents
          documents={documents}
          gridColumns={3}
          userId={currentUser.user_id}
          entityId={company.company_id}
          entityType="company"
          onDocumentCreated={handleDocumentCreated}
        />
      ) : (
        <div>Loading...</div>
      )
    },
    {
      label: "Tax Settings",
      content: (
        <TaxSettingsForm companyId={company.company_id} />
      )
    },
    {
      label: "Additional Info",
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
          <TextDetailItem 
            label="Tax ID" 
            value={editedCompany.properties?.tax_id ?? ""} 
            onEdit={(value) => handleFieldChange('properties.tax_id', value)}
          />
          <TextDetailItem 
            label="Payment Terms" 
            value={editedCompany.properties?.payment_terms ?? ""} 
            onEdit={(value) => handleFieldChange('properties.payment_terms', value)}
          />
          <TextDetailItem 
            label="Parent Company" 
            value={editedCompany.properties?.parent_company_name ?? ""} 
            onEdit={(value) => handleFieldChange('properties.parent_company_name', value)}
          />
          <div className="space-y-2">
            <Text as="label" size="2" className="text-gray-700 font-medium">Timezone</Text>
            <TimezonePicker
              value={editedCompany.timezone ?? ""}
              onValueChange={(value) => handleFieldChange('timezone', value)}
            />
          </div>
          <TextDetailItem 
            label="Last Contact Date" 
            value={editedCompany.properties?.last_contact_date ?? ""} 
            onEdit={(value) => handleFieldChange('properties.last_contact_date', value)}
          />
          </div>
          
          <Flex gap="4" justify="end" align="center">
            <Button 
              onClick={handleSave} 
              className="bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] transition-colors"
              disabled={!hasUnsavedChanges}
            >
              Save Changes
            </Button>
          </Flex>
        </div>
      )
    },
    {
      label: "Notes",
      content: (
        <NotesDetailItem 
          value={editedCompany.notes ?? ""}
          onEdit={(value) => handleFieldChange('notes', value)}
          onSave={handleSave}
        />
      )
    },
    {
      label: "Interactions",
      content: (
        <div>
          <InteractionsFeed 
            entityId={company.company_id} 
            entityType="company"
            interactions={interactions}
            setInteractions={setInteractions}
          />
        </div>
      )
    }
  ];

  // Find the matching tab label case-insensitively
  const findTabLabel = (urlTab: string | null | undefined): string => {
    if (!urlTab) return 'Details';
    
    const matchingTab = tabContent.find(
      tab => tab.label.toLowerCase() === urlTab.toLowerCase()
    );
    return matchingTab?.label || 'Details';
  };

  return (
    <div className="max-w-4xl mx-auto bg-gray-50 p-6 relative">
      <Button
        onClick={handleBack}
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 flex items-center gap-2"
      >
        <ArrowLeft className="h-4 w-4" />
        {isInDrawer ? 'Back' : 'Back to Companies'}
      </Button>
      <Heading size="6" className="mb-6 mt-12">{editedCompany.company_name}</Heading>

      <CustomTabs 
        tabs={tabContent} 
        defaultTab={findTabLabel(searchParams?.get('tab'))}
        onTabChange={handleTabChange}
      />

      <QuickAddTicket 
        open={isQuickAddTicketOpen}
        onOpenChange={setIsQuickAddTicketOpen}
        onTicketAdded={handleTicketAdded}
        prefilledCompany={{
          id: company.company_id,
          name: company.company_name
        }}
      />
    </div>
  );
};

export default CompanyDetails;

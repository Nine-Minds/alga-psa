'use client';

import React, { useState, useEffect } from 'react';
import { IDocument } from 'server/src/interfaces/document.interface';
import { PartialBlock } from '@blocknote/core';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { BillingCycleType } from 'server/src/interfaces/billing.interfaces';
import Documents from 'server/src/components/documents/Documents';
import Contacts from 'server/src/components/contacts/Contacts';
import { Flex, Text, Heading } from '@radix-ui/themes';
import { Switch } from 'server/src/components/ui/Switch';
import BillingConfiguration from './BillingConfiguration';
import { updateCompany } from 'server/src/lib/actions/companyActions';
import CustomTabs from 'server/src/components/ui/CustomTabs';
import { QuickAddTicket } from '../tickets/QuickAddTicket';
import { Button } from 'server/src/components/ui/Button';
import TaxSettingsForm from 'server/src/components/TaxSettingsForm';
import InteractionsFeed from '../interactions/InteractionsFeed';
import { IInteraction } from 'server/src/interfaces/interaction.interfaces';
import { useDrawer } from "server/src/context/DrawerContext";
import { ArrowLeft, Globe } from 'lucide-react';
import TimezonePicker from 'server/src/components/ui/TimezonePicker';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import CompanyAssets from './CompanyAssets';
import TextEditor, { DEFAULT_BLOCK } from '../editor/TextEditor';
import { ITicket } from 'server/src/interfaces';
import { Card } from 'server/src/components/ui/Card';
import { Input } from 'server/src/components/ui/Input';
import { withDataAutomationId } from 'server/src/types/ui-reflection/withDataAutomationId';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { createBlockDocument, updateBlockContent, getBlockContent } from 'server/src/lib/actions/document-actions/documentBlockContentActions';
import { getDocument } from 'server/src/lib/actions/document-actions/documentActions';

interface ICompany {
  company_id: string;
  company_name: string;
  notes_document_id?: string | null;
  properties?: {
    account_manager_name?: string;
    industry?: string;
    website?: string;
    company_size?: string;
    annual_revenue?: string;
    tax_id?: string;
    payment_terms?: string;
    parent_company_name?: string;
    last_contact_date?: string;
  };
  phone_no: string;
  email: string;
  address: string;
  is_inactive: boolean;
  timezone?: string;
  tenant?: string;
  credit_balance: number;
  url: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  status?: string;
  billing_cycle: BillingCycleType;
  is_tax_exempt: boolean;
}

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

interface CompanyDetailsProps {
  id?: string;
  company: ICompany;
  documents?: IDocument[];
  contacts?: IContact[];
  isInDrawer?: boolean;
}

const CompanyDetails: React.FC<CompanyDetailsProps> = ({
  id = 'company-details',
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
  const [isDocumentSelectorOpen, setIsDocumentSelectorOpen] = useState(false);
  const [hasUnsavedNoteChanges, setHasUnsavedNoteChanges] = useState(false);
  const [currentContent, setCurrentContent] = useState<PartialBlock[]>(DEFAULT_BLOCK);
  const [noteDocument, setNoteDocument] = useState<IDocument | null>(null);
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

  // Load note content and document metadata when component mounts
  useEffect(() => {
    const loadNoteContent = async () => {
      if (company.notes_document_id) {
        try {
          // Get the document metadata
          const document = await getDocument(company.notes_document_id);
          setNoteDocument(document);
          
          // Get the note content
          const content = await getBlockContent(company.notes_document_id);
          if (content && content.block_data) {
            // Parse the block data from JSON string
            const blockData = typeof content.block_data === 'string'
              ? JSON.parse(content.block_data)
              : content.block_data;
            
            setCurrentContent(blockData);
          }
        } catch (error) {
          console.error('Error loading note content:', error);
        }
      }
    };

    loadNoteContent();
  }, [company.notes_document_id]);

  const handleBack = () => {
    if (isInDrawer) {
      drawer.goBack();
    } else {
      router.push('/msp/companies');
    }
  };

  const handleFieldChange = (field: string, value: string | boolean) => {
    setEditedCompany(prevCompany => {
      // Create a deep copy of the previous company
      const updatedCompany = JSON.parse(JSON.stringify(prevCompany)) as ICompany;
      
      if (field.startsWith('properties.')) {
        const propertyField = field.split('.')[1];
        
        // Ensure properties object exists
        if (!updatedCompany.properties) {
          updatedCompany.properties = {};
        }
        
        // Update the specific property using type assertion
        (updatedCompany.properties as any)[propertyField] = value;
        
        // Sync url with properties.website when website is updated
        if (propertyField === 'website' && typeof value === 'string') {
          updatedCompany.url = value;
        }
      } else if (field === 'url') {
        // Update the URL field
        updatedCompany.url = value as string;
        
        // Sync properties.website with url
        if (!updatedCompany.properties) {
          updatedCompany.properties = {};
        }
        
        // Use type assertion to set the website property
        (updatedCompany.properties as any).website = value as string;
      } else {
        // For all other fields, use type assertion to update directly
        (updatedCompany as any)[field] = value;
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
      setEditedCompany(prevCompany => {
        const newCompany = { ...prevCompany };
        Object.keys(updatedBillingConfig).forEach(key => {
          (newCompany as any)[key] = (updatedCompany as any)[key];
        });
        return newCompany;
      });
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
  };

  const handleContentChange = (blocks: PartialBlock[]) => {
    setCurrentContent(blocks);
    setHasUnsavedNoteChanges(true);
  };

  const handleSaveNote = async () => {
    try {
      if (!currentUser) {
        console.error('Cannot save note: No current user');
        return;
      }

      // Convert blocks to JSON string
      const blockData = JSON.stringify(currentContent);
      
      if (company.notes_document_id) {
        // Update existing note document
        await updateBlockContent(company.notes_document_id, {
          block_data: blockData,
          user_id: currentUser.user_id
        });
      } else {
        // Create new note document
        const { document_id } = await createBlockDocument({
          document_name: `${company.company_name} Notes`,
          user_id: currentUser.user_id,
          block_data: blockData,
          entityId: company.company_id,
          entityType: 'company'
        });
        
        // Update company with the new notes_document_id
        await updateCompany(company.company_id, {
          notes_document_id: document_id
        });
        
        // Update local state
        setEditedCompany(prev => ({
          ...prev,
          notes_document_id: document_id
        }));
      }
      
      setHasUnsavedNoteChanges(false);
    } catch (error) {
      console.error('Error saving note:', error);
    }
  };

  const handleTabChange = async (tabValue: string) => {
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
            value={editedCompany.is_inactive || false}
            onEdit={(value) => handleFieldChange('is_inactive', value)}
          />
          
          <Flex gap="4" justify="end" align="center" className="pt-6">
            <Button
              id="save-company-changes-btn"
              onClick={handleSave}
              className="bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] transition-colors"
            >
              Save Changes
            </Button>
            <Button
              id="add-ticket-btn"
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
        <BillingConfiguration
          company={editedCompany}
          onSave={handleBillingConfigSave}
          contacts={contacts}
        />
      )
    },
    {
      label: "Contacts",
      content: currentUser ? (
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
          id={`${id}-documents`}
          documents={documents}
          gridColumns={3}
          userId={currentUser.user_id}
          entityId={company.company_id}
          entityType="company"
          onDocumentCreated={async () => {
            // Handle document creation if needed
            return Promise.resolve();
          }}
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
              id="save-additional-info-btn"
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
        <div className="space-y-4">
          {/* Note metadata */}
          {noteDocument && (
            <div className="bg-gray-50 p-4 rounded-md border border-gray-200 text-sm text-gray-600">
              <div className="flex justify-between items-center">
                <div>
                  <span className="font-medium">Created by:</span> {noteDocument.created_by_full_name || "Unknown"}
                  {noteDocument.entered_at && (
                    <span className="ml-2">
                      on {new Date(noteDocument.entered_at).toLocaleDateString()} at {new Date(noteDocument.entered_at).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                {noteDocument.updated_at && noteDocument.updated_at !== noteDocument.entered_at && (
                  <div>
                    <span className="font-medium">Last updated:</span> {new Date(noteDocument.updated_at).toLocaleDateString()} at {new Date(noteDocument.updated_at).toLocaleTimeString()}
                  </div>
                )}
              </div>
            </div>
          )}
          
          <TextEditor
            id={`${id}-editor`}
            initialContent={currentContent}
            onContentChange={handleContentChange}
          />
          <div className="flex justify-end space-x-2">
            <Button
              id={`${id}-save-note-btn`}
              onClick={handleSaveNote}
              disabled={!hasUnsavedNoteChanges}
              className={`text-white transition-colors ${
                hasUnsavedNoteChanges
                  ? "bg-[rgb(var(--color-primary-500))] hover:bg-[rgb(var(--color-primary-600))]"
                  : "bg-[rgb(var(--color-border-400))] cursor-not-allowed"
              }`}
            >
              Save Note
            </Button>
          </div>
        </div>
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
    <ReflectionContainer id={id} label="Company Details">
      <div className="max-w-4xl mx-auto bg-gray-50 p-6 relative">
        <Button
          id="back-to-companies-btn"
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
          id={`${id}-quick-add-ticket`}
          open={isQuickAddTicketOpen}
          onOpenChange={setIsQuickAddTicketOpen}
          onTicketAdded={handleTicketAdded}
          prefilledCompany={{
            id: company.company_id,
            name: company.company_name
          }}
        />
      </div>
    </ReflectionContainer>
  );
};

export default CompanyDetails;

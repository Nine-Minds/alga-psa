'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { IDocument } from 'server/src/interfaces/document.interface';
import { PartialBlock } from '@blocknote/core';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import UserPicker from 'server/src/components/ui/UserPicker';
import { TagManager } from 'server/src/components/tags';
import { useFeatureFlag } from 'server/src/hooks/useFeatureFlag';
import { FeaturePlaceholder } from '../FeaturePlaceholder';
import { findTagsByEntityId } from 'server/src/lib/actions/tagActions';
import { useTags } from 'server/src/context/TagContext';
import { getAllUsers } from 'server/src/lib/actions/user-actions/userActions';
import { BillingCycleType } from 'server/src/interfaces/billing.interfaces';
import Documents from 'server/src/components/documents/Documents';
import CompanyContactsList from 'server/src/components/contacts/CompanyContactsList';
import { Flex, Text, Heading } from '@radix-ui/themes';
import { Switch } from 'server/src/components/ui/Switch';
import BillingConfiguration from './BillingConfiguration';
import { updateCompany, uploadCompanyLogo, deleteCompanyLogo, getCompanyById } from 'server/src/lib/actions/company-actions/companyActions';
import CustomTabs from 'server/src/components/ui/CustomTabs';
import { QuickAddTicket } from '../tickets/QuickAddTicket';
import { Button } from 'server/src/components/ui/Button';
import { ExternalLink } from 'lucide-react';
import BackNav from 'server/src/components/ui/BackNav';
import TaxSettingsForm from 'server/src/components/TaxSettingsForm';
import InteractionsFeed from '../interactions/InteractionsFeed';
import { IInteraction } from 'server/src/interfaces/interaction.interfaces';
import { useDrawer } from "server/src/context/DrawerContext";
import TimezonePicker from 'server/src/components/ui/TimezonePicker';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import CompanyAssets from './CompanyAssets';
import CompanyTickets from './CompanyTickets';
import CompanyLocations from './CompanyLocations';
import TextEditor, { DEFAULT_BLOCK } from '../editor/TextEditor';
import { ITicket, ITicketCategory } from 'server/src/interfaces';
import { IChannel } from 'server/src/interfaces/channel.interface';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { Card } from 'server/src/components/ui/Card';
import { Input } from 'server/src/components/ui/Input';
import { withDataAutomationId } from 'server/src/types/ui-reflection/withDataAutomationId';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { FormFieldComponent } from 'server/src/types/ui-reflection/types';
import { createBlockDocument, updateBlockContent, getBlockContent } from 'server/src/lib/actions/document-actions/documentBlockContentActions';
import { getDocument, getImageUrl } from 'server/src/lib/actions/document-actions/documentActions';
import ClientBillingDashboard from '../billing-dashboard/ClientBillingDashboard';
import { useToast } from 'server/src/hooks/use-toast';
import EntityImageUpload from 'server/src/components/ui/EntityImageUpload';
import { getTicketFormOptions } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { Dialog, DialogContent } from 'server/src/components/ui/Dialog';


const SwitchDetailItem: React.FC<{
  value: boolean;
  onEdit: (value: boolean) => void;
  automationId?: string;
}> = ({ value, onEdit, automationId }) => {
  // Register for UI automation with meaningful label
  const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: automationId,
    type: 'formField',
    fieldType: 'checkbox',
    label: 'Company Status',
    value: value ? 'Active' : 'Inactive',
    helperText: 'Set company status as active or inactive'
  });

  return (
    <div className="flex items-center justify-between py-3" {...automationIdProps}>
      <div>
        <div className="text-gray-900 font-medium">Status</div>
        <div className="text-sm text-gray-500">Set company status as active or inactive</div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-700">
          {value ? 'Active' : 'Inactive'}
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
  automationId?: string;
}> = ({ label, value, onEdit, automationId }) => {
  const [localValue, setLocalValue] = useState(value);

  // Register for UI automation with meaningful label
  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
    id: automationId,
    type: 'formField',
    fieldType: 'textField',
    label: label,
    value: localValue,
    helperText: `Input field for ${label}`
  });

  // Update metadata when localValue changes
  useEffect(() => {
    if (updateMetadata) {
      updateMetadata({
        value: localValue,
        label: label
      });
    }
  }, [localValue, updateMetadata, label]);

  const handleBlur = () => {
    // Always call onEdit to allow parent to determine if changes should be tracked
    onEdit(localValue);
  };
  
  return (
    <div className="space-y-2" {...automationIdProps}>
      <Text as="label" size="2" className="text-gray-700 font-medium">{label}</Text>
      <Input
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
  quickView?: boolean;
}

const CompanyDetails: React.FC<CompanyDetailsProps> = ({
  id = 'company-details',
  company,
  documents = [],
  contacts = [],
  isInDrawer = false,
  quickView = false
}) => {
  const featureFlag = useFeatureFlag('billing-enabled');
  const isBillingEnabled = typeof featureFlag === 'boolean' ? featureFlag : featureFlag?.enabled;
  const [editedCompany, setEditedCompany] = useState<ICompany>(company);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isQuickAddTicketOpen, setIsQuickAddTicketOpen] = useState(false);
  const [interactions, setInteractions] = useState<IInteraction[]>([]);
  const [currentUser, setCurrentUser] = useState<IUserWithRoles | null>(null);
  const [internalUsers, setInternalUsers] = useState<IUserWithRoles[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isDocumentSelectorOpen, setIsDocumentSelectorOpen] = useState(false);
  const [hasUnsavedNoteChanges, setHasUnsavedNoteChanges] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isDeletingLogo, setIsDeletingLogo] = useState(false);
  const [isEditingLogo, setIsEditingLogo] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [currentContent, setCurrentContent] = useState<PartialBlock[]>(DEFAULT_BLOCK);
  const [noteDocument, setNoteDocument] = useState<IDocument | null>(null);
  const [ticketFormOptions, setTicketFormOptions] = useState<{
    statusOptions: SelectOption[];
    priorityOptions: SelectOption[];
    channelOptions: IChannel[];
    categories: ITicketCategory[];
  } | null>(null);
  const [isLocationsDialogOpen, setIsLocationsDialogOpen] = useState(false);
  const [tags, setTags] = useState<ITag[]>([]);
  const { tags: allTags } = useTags();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const drawer = useDrawer();


  // 1. Implement refreshCompanyData function
  const refreshCompanyData = useCallback(async () => {
    if (!company?.company_id) return; // Ensure company_id is available

    try {
      const latestCompanyData = await getCompanyById(company.company_id);
      if (latestCompanyData) {
        setEditedCompany(latestCompanyData);
      }
    } catch (error) {
      console.error('Error refreshing company data:', error);
      toast({
        title: "Refresh Failed",
        description: "Could not fetch latest company data.",
        variant: "destructive"
      });
    }
  }, [company?.company_id, toast]);

  // 2. Implement Initial Load Logic
  useEffect(() => {
    // Set initial state when the company prop changes
    setEditedCompany({
      ...company,
      // Ensure client_type has a value
      client_type: company.client_type || 'company'
    });
    // Reset unsaved changes flag when company prop changes
    setHasUnsavedChanges(false);
  }, [company]); // Dependency on the company prop
  
  useEffect(() => {
    if (editedCompany?.logoUrl !== company?.logoUrl) {
      // Logo URL has changed
    }
  }, [editedCompany?.logoUrl, company?.logoUrl]);

  // Existing useEffect for fetching user and users
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const user = await getCurrentUser();
        setCurrentUser(user);
      } catch (error) {
        console.error('Error fetching current user:', error);
      }
    };
    const fetchAllUsers = async () => {
      if (internalUsers.length > 0) return;
      setIsLoadingUsers(true);
      try {
        const users = await getAllUsers();
        setInternalUsers(users);
      } catch (error) {
        console.error("Error fetching internal users:", error);
      } finally {
        setIsLoadingUsers(false);
      }
    };

    fetchUser();
    fetchAllUsers();
  }, [internalUsers.length]);

  // Separate useEffect for ticket form options
  useEffect(() => {
    const fetchTicketFormOptions = async () => {
      if (!currentUser) return;
      try {
        const options = await getTicketFormOptions(currentUser);
        setTicketFormOptions({
          statusOptions: options.statusOptions,
          priorityOptions: options.priorityOptions,
          channelOptions: options.channelOptions,
          categories: options.categories
        });
      } catch (error) {
        console.error('Error fetching ticket form options:', error);
      }
    };

    if (currentUser) {
      fetchTicketFormOptions();
    }
  }, [currentUser]);

  // Fetch tags when component mounts
  useEffect(() => {
    const fetchTags = async () => {
      try {
        const companyTags = await findTagsByEntityId(company.company_id, 'company');
        setTags(companyTags);
      } catch (error) {
        console.error('Error fetching tags:', error);
      }
    };
    fetchTags();
  }, [company.company_id]);

  // Load note content and document metadata when component mounts
  useEffect(() => {
    const loadNoteContent = async () => {
      if (editedCompany.notes_document_id) {
        try {
          const document = await getDocument(editedCompany.notes_document_id);
          setNoteDocument(document);
          const content = await getBlockContent(editedCompany.notes_document_id);
          if (content && content.block_data) {
            const blockData = typeof content.block_data === 'string'
              ? JSON.parse(content.block_data)
              : content.block_data;
            setCurrentContent(blockData);
          } else {
             setCurrentContent(DEFAULT_BLOCK);
          }
        } catch (error) {
          console.error('Error loading note content:', error);
           setCurrentContent(DEFAULT_BLOCK);
        }
      } else {
         setCurrentContent(DEFAULT_BLOCK);
         setNoteDocument(null);
      }
    };

    loadNoteContent();
  }, [editedCompany.notes_document_id]);


  const handleFieldChange = (field: string, value: string | boolean) => {
    setEditedCompany(prevCompany => {
      // Create a deep copy of the previous company
      const updatedCompany = JSON.parse(JSON.stringify(prevCompany)) as ICompany;
      
      if (field.startsWith('properties.') && field !== 'properties.account_manager_id') {
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
    
    // Check if the updated company matches the original company
    setHasUnsavedChanges(() => {
      // Create a temporary copy to compare
      const tempCompany = JSON.parse(JSON.stringify(editedCompany)) as ICompany;
      
      // Apply the change to temp company for comparison
      if (field.startsWith('properties.') && field !== 'properties.account_manager_id') {
        const propertyField = field.split('.')[1];
        if (!tempCompany.properties) {
          tempCompany.properties = {};
        }
        (tempCompany.properties as any)[propertyField] = value;
        if (propertyField === 'website' && typeof value === 'string') {
          tempCompany.url = value;
        }
      } else if (field === 'url') {
        tempCompany.url = value as string;
        if (!tempCompany.properties) {
          tempCompany.properties = {};
        }
        (tempCompany.properties as any).website = value as string;
      } else {
        (tempCompany as any)[field] = value;
      }
      
      // Compare with original company to determine if there are unsaved changes
      return JSON.stringify(tempCompany) !== JSON.stringify(company);
    });
  };

  const handleSave = async () => {
    if (isSaving) return;
    
    setIsSaving(true);
    try {
      // Prepare data for update, removing computed fields
      const { 
        account_manager_full_name,
        ...restOfEditedCompany 
      } = editedCompany;
      const dataToUpdate: Partial<Omit<ICompany, 'account_manager_full_name'>> = {
        ...restOfEditedCompany,
        properties: restOfEditedCompany.properties ? { ...restOfEditedCompany.properties } : {},
        account_manager_id: editedCompany.account_manager_id === '' ? null : editedCompany.account_manager_id,
      };
      const updatedCompanyResult = await updateCompany(company.company_id, dataToUpdate);
      // Assuming updateCompany returns the full updated company object matching ICompany
      const updatedCompany = updatedCompanyResult as ICompany; // Cast if necessary, or adjust based on actual return type
      setEditedCompany(updatedCompany);
      setHasUnsavedChanges(false);
      toast({
        title: "Success",
        description: "Company details saved successfully.",
        variant: "default"
      });
    } catch (error) {
      console.error('Error saving company:', error);
      toast({
        title: "Error",
        description: "Failed to save company details. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
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

  const handleTagsChange = (updatedTags: ITag[]) => {
    setTags(updatedTags);
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
      
      if (editedCompany.notes_document_id) {
        // Update existing note document
        await updateBlockContent(editedCompany.notes_document_id, {
          block_data: blockData,
          user_id: currentUser.user_id
        });
        
        // Refresh document metadata to show updated timestamp
        const updatedDocument = await getDocument(editedCompany.notes_document_id);
        setNoteDocument(updatedDocument);
      } else {
        // Create new note document
        const { document_id } = await createBlockDocument({
          document_name: `${editedCompany.company_name} Notes`,
          user_id: currentUser.user_id,
          block_data: blockData,
          entityId: editedCompany.company_id,
          entityType: 'company'
        });
        
        // Update company with the new notes_document_id
        await updateCompany(editedCompany.company_id, {
          notes_document_id: document_id
        });
        
        // Update local state
        setEditedCompany(prev => ({
          ...prev,
          notes_document_id: document_id
        }));
        
        // Get the newly created document metadata
        const newDocument = await getDocument(document_id);
        setNoteDocument(newDocument);
      }
      
      setHasUnsavedNoteChanges(false);
      toast({
        title: "Success",
        description: "Note saved successfully.",
        variant: "default"
      });
    } catch (error) {
      console.error('Error saving note:', error);
      toast({
        title: "Error",
        description: "Failed to save note. Please try again.",
        variant: "destructive"
      });
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left Column - All Form Fields */}
            <div className="space-y-6">
              <TextDetailItem
                label="Client Name"
                value={editedCompany.company_name}
                onEdit={(value) => handleFieldChange('company_name', value)}
                automationId="client-name-field"
              />
                           
              <FieldContainer
                label="Account Manager"
                fieldType="select"
                value={editedCompany.account_manager_full_name || ''}
                helperText="Select the account manager for this company"
                automationId="account-manager-field"
              >
                <Text as="label" size="2" className="text-gray-700 font-medium">Account Manager</Text>
                <UserPicker
                  value={editedCompany.account_manager_id || ''}
                  onValueChange={(value) => handleFieldChange('account_manager_id', value)}
                  users={internalUsers}
                  disabled={isLoadingUsers}
                  placeholder={isLoadingUsers ? "Loading users..." : "Select Account Manager"}
                  buttonWidth="full"
                />
              </FieldContainer>
              
              <TextDetailItem
                label="Website"
                value={editedCompany.properties?.website || ''}
                onEdit={(value) => handleFieldChange('properties.website', value)}
                automationId="website-field"
              />

              <TextDetailItem
                label="Industry"
                value={editedCompany.properties?.industry || ''}
                onEdit={(value) => handleFieldChange('properties.industry', value)}
                automationId="industry-field"
              />

              <TextDetailItem
                label="Company Size"
                value={editedCompany.properties?.company_size || ''}
                onEdit={(value) => handleFieldChange('properties.company_size', value)}
                automationId="company-size-field"
              />
              
              <TextDetailItem
                label="Annual Revenue"
                value={editedCompany.properties?.annual_revenue || ''}
                onEdit={(value) => handleFieldChange('properties.annual_revenue', value)}
                automationId="annual-revenue-field"
              />

              {/* Status and Client Type in 2 columns */}
              <div className="grid grid-cols-5 gap-4">

                {/* Client Type */}
                <div className="space-y-2 col-span-2">
                  <Text as="label" size="2" className="text-gray-700 font-medium">Client Type</Text>
                  <CustomSelect
                    id="client-type-select"
                    value={editedCompany.client_type || 'company'}
                    onValueChange={(value) => handleFieldChange('client_type', value)}
                    options={[
                      { value: 'company', label: 'Company' },
                      { value: 'individual', label: 'Individual' }
                    ]}
                    placeholder="Select client type"
                    className="!w-fit"
                  />
                </div>
                <div className="col-span-3">
                  <SwitchDetailItem
                    value={!editedCompany.is_inactive || false}
                    onEdit={(isActive) => handleFieldChange('is_inactive', !isActive)}
                    automationId="company-status-field"
                  />
                </div>
              </div>

              {/* Tags */}
              <div className="space-y-2">
                <Text as="label" size="2" className="text-gray-700 font-medium">Tags</Text>
                <TagManager
                  id={`${id}-tags`}
                  entityId={editedCompany.company_id}
                  entityType="company"
                  initialTags={tags}
                  onTagsChange={handleTagsChange}
                  useInlineInput={isInDrawer}
                />
              </div>
            </div>
            
            {/* Right Column - Company Locations Only */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Text as="label" size="2" className="text-gray-700 font-medium">Company Locations</Text>
                <Button
                  id="locations-button"
                  size="sm"
                  variant="outline"
                  onClick={() => setIsLocationsDialogOpen(true)}
                  className="text-sm"
                >
                  Manage Locations
                </Button>
              </div>
              <div>
                <CompanyLocations 
                  companyId={editedCompany.company_id} 
                  isEditing={false}
                />
              </div>
            </div>
          </div>
          
          <Flex gap="4" justify="end" align="center" className="pt-6">
            <Button
              id="save-company-changes-btn"
              onClick={handleSave}
              disabled={isSaving || !hasUnsavedChanges}
              className="bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
            <Button
              id="add-ticket-btn"
              onClick={() => setIsQuickAddTicketOpen(true)}
              variant="default"
            >
              Add Ticket
            </Button>
          </Flex>
        </div>
      )
    },
    {
      label: "Tickets",
      content: (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          {ticketFormOptions ? (
            <CompanyTickets 
              companyId={company.company_id}
              companyName={company.company_name}
              initialChannels={ticketFormOptions.channelOptions}
              initialStatuses={ticketFormOptions.statusOptions}
              initialPriorities={ticketFormOptions.priorityOptions}
              initialCategories={ticketFormOptions.categories}
            />
          ) : (
            <div className="flex justify-center items-center h-32">
              <span>Loading ticket filters...</span>
            </div>
          )}
        </div>
      )
    },
    // {
    //   label: "Assets",
    //   content: (
    //     <CompanyAssets companyId={company.company_id} />
    //   )
    // },
    {
      label: "Billing",
      content: isBillingEnabled ? (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <BillingConfiguration
            company={editedCompany}
            onSave={handleBillingConfigSave}
            contacts={contacts}
          />
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden h-full">
          <FeaturePlaceholder />
        </div>
      )
    },
    {
      label: "Billing Dashboard",
      content: isBillingEnabled ? (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <ClientBillingDashboard companyId={company.company_id} />
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden h-full">
          <FeaturePlaceholder />
        </div>
      )
    },
    {
      label: "Contacts",
      content: (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <CompanyContactsList
            companyId={company.company_id}
            companies={[company]}
          />
        </div>
      )
    },
    {
      label: "Documents",
      content: (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          {currentUser ? (
            <Documents
              id={`${id}-documents`}
              documents={documents}
              gridColumns={3}
              userId={currentUser.user_id}
              entityId={company.company_id}
              entityType="company"
              onDocumentCreated={async () => {
                return Promise.resolve();
              }}
            />
          ) : (
            <div>Loading...</div>
          )}
        </div>
      )
    },
    {
      label: "Tax Settings",
      content: isBillingEnabled ? (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <TaxSettingsForm companyId={company.company_id} />
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden h-full">
          <FeaturePlaceholder />
        </div>
      )
    },
    {
      label: "Additional Info",
      content: (
        <div className="space-y-6 bg-white p-6 rounded-lg shadow-sm">
          <div className="grid grid-cols-2 gap-4">
            <TextDetailItem
              label="Tax ID"
              value={editedCompany.properties?.tax_id ?? ""}
              onEdit={(value) => handleFieldChange('properties.tax_id', value)}
              automationId="tax-id-field"
            />
            <TextDetailItem
              label="Payment Terms"
              value={editedCompany.properties?.payment_terms ?? ""}
              onEdit={(value) => handleFieldChange('properties.payment_terms', value)}
              automationId="payment-terms-field"
            />
            <TextDetailItem
              label="Parent Company"
              value={editedCompany.properties?.parent_company_name ?? ""}
              onEdit={(value) => handleFieldChange('properties.parent_company_name', value)}
              automationId="parent-company-field"
            />
            <FieldContainer
              label="Timezone"
              fieldType="select"
              value={editedCompany.timezone || ''}
              helperText="Select the timezone for this company"
              automationId="timezone-field"
            >
              <Text as="label" size="2" className="text-gray-700 font-medium">Timezone</Text>
              <TimezonePicker
                value={editedCompany.timezone ?? ""}
                onValueChange={(value) => handleFieldChange('timezone', value)}
              />
            </FieldContainer>
            <TextDetailItem
              label="Last Contact Date"
              value={editedCompany.properties?.last_contact_date ?? ""}
              onEdit={(value) => handleFieldChange('properties.last_contact_date', value)}
              automationId="last-contact-date-field"
            />
          </div>
          
          <Flex gap="4" justify="end" align="center">
            <Button
              id="save-additional-info-btn"
              onClick={handleSave}
              disabled={isSaving || !hasUnsavedChanges}
              className="bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </Flex>
        </div>
      )
    },
    {
      label: "Notes",
      content: (
        <div className="space-y-6 bg-white p-6 rounded-lg shadow-sm">
          {editedCompany.notes && editedCompany.notes.trim() !== '' && (
            <div className="bg-gray-100 border border-gray-200 rounded-md p-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Initial Note</h4>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{editedCompany.notes}</p>
            </div>
          )}

          {/* Rich Text Editor Section Label */}
          <h4 className="text-md font-semibold text-gray-800 pt-2">Formatted Notes</h4>

          {/* Note metadata */}
          {noteDocument && noteDocument.updated_at && (
            <div className="bg-gray-50 p-3 rounded-md border border-gray-200 text-xs text-gray-600">
              <div className="flex justify-between items-center flex-wrap gap-2"> 
                <div>
                  <span className="font-medium">Last updated:</span> {new Date(noteDocument.updated_at).toLocaleDateString()} at {new Date(noteDocument.updated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </div>
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
        <div className="bg-white p-6 rounded-lg shadow-sm">
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
      <div className="flex items-center space-x-5 mb-4 pt-2">
        {!quickView && (
          <BackNav href="/msp/companies">
            {isInDrawer ? 'Back' : 'Back to Clients'}
          </BackNav>
        )}
        
        {/* Logo Display and Edit Container */}
        <div className="flex items-center space-x-3">
          <EntityImageUpload
            entityType="company"
            entityId={editedCompany.company_id}
            entityName={editedCompany.company_name}
            imageUrl={editedCompany.logoUrl ?? null}
            uploadAction={uploadCompanyLogo}
            deleteAction={deleteCompanyLogo}
            onImageChange={async (newLogoUrl) => {
              setEditedCompany(prev => {
                if (!prev) return prev;
                return {
                  ...prev,
                  logoUrl: newLogoUrl
                };
              });
              
              // If logo was deleted (newLogoUrl is null), refresh company data to ensure consistency
              if (newLogoUrl === null) {
                await refreshCompanyData();
              }
            }}
            size="md"
          />
        </div>

        <div className="flex-1 flex items-center justify-between">
          <Heading size="6" tabIndex={quickView ? 0 : undefined} autoFocus={quickView}>
            {editedCompany.company_name}
          </Heading>
          
          {isInDrawer && (
            <Button
              id={`${id}-go-to-client-button`}
              onClick={() => window.open(`/msp/companies/${editedCompany.company_id}`, '_blank')}
              variant="soft"
              size="sm"
              className="flex items-center ml-4 mr-8"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Go to client
            </Button>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div>
        <CustomTabs
          tabs={quickView ? [tabContent[0]] : tabContent}
          defaultTab={findTabLabel(searchParams?.get('tab'))}
          onTabChange={handleTabChange}
        />

        <QuickAddTicket
          id={`${id}-quick-add-ticket`}
          open={isQuickAddTicketOpen}
          onOpenChange={setIsQuickAddTicketOpen}
          onTicketAdded={handleTicketAdded}
          prefilledCompany={{
            id: editedCompany.company_id,
            name: editedCompany.company_name
          }}
        />

        <Dialog 
          isOpen={isLocationsDialogOpen} 
          onClose={() => setIsLocationsDialogOpen(false)} 
          title={`Manage Locations - ${editedCompany.company_name}`}
        >
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <CompanyLocations 
              companyId={editedCompany.company_id} 
              isEditing={true}
            />
          </DialogContent>
        </Dialog>
      </div>
    </ReflectionContainer>
  );
};

const FieldContainer: React.FC<{
  label: string;
  fieldType: 'select' | 'textField';
  value: string;
  helperText: string;
  automationId?: string;
  children: React.ReactNode;
}> = ({ label, fieldType, value, helperText, automationId, children }) => {
  const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
    type: 'formField',
    fieldType,
    label,
    value,
    helperText
  }, true, automationId);

  return (
    <div className="space-y-2" {...automationIdProps}>
      {children}
    </div>
  );
};

export default CompanyDetails;

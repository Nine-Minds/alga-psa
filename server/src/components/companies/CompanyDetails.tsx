'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { IDocument } from 'server/src/interfaces/document.interface';
import { PartialBlock } from '@blocknote/core';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import UserPicker from 'server/src/components/ui/UserPicker';
import { getAllUsers } from 'server/src/lib/actions/user-actions/userActions';
import { BillingCycleType } from 'server/src/interfaces/billing.interfaces';
import Documents from 'server/src/components/documents/Documents';
import CompanyContactsList from 'server/src/components/contacts/CompanyContactsList';
import { Flex, Text, Heading } from '@radix-ui/themes';
import { Switch } from 'server/src/components/ui/Switch';
import BillingConfiguration from './BillingConfiguration';
import { updateCompany, uploadCompanyLogo, deleteCompanyLogo, getCompanyById } from 'server/src/lib/actions/companyActions';
import CustomTabs from 'server/src/components/ui/CustomTabs';
import { QuickAddTicket } from '../tickets/QuickAddTicket';
import { Button } from 'server/src/components/ui/Button';
import BackNav from 'server/src/components/ui/BackNav';
import TaxSettingsForm from 'server/src/components/TaxSettingsForm';
import InteractionsFeed from '../interactions/InteractionsFeed';
import { IInteraction } from 'server/src/interfaces/interaction.interfaces';
import { useDrawer } from "server/src/context/DrawerContext";
import { ArrowLeft, Globe, Upload, Trash2, Loader2, Pen } from 'lucide-react';
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
import { getDocument, getImageUrl } from 'server/src/lib/actions/document-actions/documentActions';
import ClientBillingDashboard from '../billing-dashboard/ClientBillingDashboard';
import CompanyAvatar from 'server/src/components/ui/CompanyAvatar';
import { useToast } from 'server/src/hooks/use-toast';


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
  const [currentContent, setCurrentContent] = useState<PartialBlock[]>(DEFAULT_BLOCK);
  const [noteDocument, setNoteDocument] = useState<IDocument | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const drawer = useDrawer();

  // 1. Implement refreshCompanyData function
  const refreshCompanyData = useCallback(async () => {
    if (!company?.company_id) return; // Ensure company_id is available

    console.log(`Refreshing company data for ID: ${company.company_id}`);
    try {
      const latestCompanyData = await getCompanyById(company.company_id);
      if (latestCompanyData) {
        const currentLogoUrl = editedCompany.logoUrl ?? null;
        const latestLogoUrl = latestCompanyData.logoUrl ?? null;

        if (currentLogoUrl !== latestLogoUrl) {
          console.log(`Logo URL changed. Old: ${currentLogoUrl}, New: ${latestLogoUrl}`);
          setEditedCompany(prev => ({ ...prev, logoUrl: latestLogoUrl }));
          // Optionally update other fields if needed, but focus is on logoUrl for now
          // setEditedCompany(latestCompanyData); // Uncomment to refresh all data
        } else {
           console.log('Logo URL unchanged.');
        }
      }
    } catch (error) {
      console.error('Error refreshing company data:', error);
      // Optionally show a toast notification for the error
      // toast({ title: "Refresh Failed", description: "Could not fetch latest company data.", variant: "destructive" });
    }
  }, [company?.company_id, editedCompany.logoUrl]); // Dependencies for useCallback

  // 2. Implement Initial Load Logic
  useEffect(() => {
    // Set initial state when the company prop changes
    setEditedCompany(company);
    // Reset unsaved changes flag when company prop changes
    setHasUnsavedChanges(false);
  }, [company]); // Dependency on the company prop

  // 3. Implement Refresh on Focus/Visibility Change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('Document became visible, refreshing data...');
        refreshCompanyData();
      }
    };

    const handleFocus = () => {
      console.log('Window gained focus, refreshing data...');
      refreshCompanyData();
    };

    console.log('Adding visibility and focus listeners');
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    // Cleanup function
    return () => {
      console.log('Removing visibility and focus listeners');
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [refreshCompanyData]); // Dependency on refreshCompanyData

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
  }, []);

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
    
    setHasUnsavedChanges(true);
  };

  const handleSave = async () => {
    try {
      // Prepare data for update, handling top-level account_manager_id
      const { account_manager_full_name, ...restOfEditedCompany } = editedCompany;
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
  
  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const fileInput = event.target; // Store the input element

    if (!file) {
      toast({
        title: "No file selected",
        description: "Please select an image file to upload.",
        variant: "destructive",
      });
      // Reset file input if no file is selected or selection is cancelled
      if (fileInput) fileInput.value = '';
      return;
    }

    // Client-side validation
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid File Type",
        description: "Please select an image file (e.g., JPG, PNG, GIF).",
        variant: "destructive",
      });
      if (fileInput) fileInput.value = ''; // Reset input
      return;
    }

    const maxSizeInBytes = 2 * 1024 * 1024; // 2MB
    if (file.size > maxSizeInBytes) {
      toast({
        title: "File Too Large",
        description: "Please select an image file smaller than 2MB.",
        variant: "destructive",
      });
      if (fileInput) fileInput.value = ''; // Reset input
      return;
    }

    setIsUploadingLogo(true);
    const formData = new FormData();
    formData.append('logo', file);

    try {
      const result = await uploadCompanyLogo(editedCompany.company_id, formData);
      if (result.success && result.logoUrl !== undefined) {
        setEditedCompany(prev => ({ ...prev, logoUrl: result.logoUrl ?? null }));
        toast({
          title: "Logo Uploaded",
          description: "Company logo updated successfully.",
        });
      } else {
        throw new Error(result.message || 'Failed to upload logo');
      }
    } catch (error: any) {
      console.error('Error uploading logo:', error);
      toast({
        title: "Upload Failed",
        description: error.message || "An error occurred while uploading the logo.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingLogo(false);
      // Reset file input value so the same file can be selected again if needed
      // Reset file input value using the stored reference
      if (fileInput) {
         fileInput.value = '';
      }
    }
  };

  const handleDeleteLogo = async () => {
    if (!editedCompany.logoUrl) {
        toast({ title: "No Logo Found", description: "There is no logo associated with this company to delete.", variant: "destructive" });
        return;
    }

    // Confirmation dialog
    if (!window.confirm("Are you sure you want to delete the company logo? This action cannot be undone.")) {
      return;
    }

    setIsDeletingLogo(true);
    try {
      const result = await deleteCompanyLogo(editedCompany.company_id);
      if (result.success) {
        setEditedCompany(prev => ({ ...prev, logoUrl: null }));
        toast({
          title: "Logo Deleted",
          description: "Company logo deleted successfully.",
        });
      } else {
        throw new Error(result.message || 'Failed to delete logo');
      }
    } catch (error: any) {
      console.error('Error deleting logo:', error);
      toast({
        title: "Deleting Failed",
        description: error.message || "An error occurred while deleting the logo.",
        variant: "destructive",
      });
    } finally {
      setIsDeletingLogo(false);
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
          <div className="space-y-1">
            <Text as="label" size="2" className="text-gray-700 font-medium">Account Manager</Text>
            <UserPicker
              value={editedCompany.account_manager_id || ''}
              onValueChange={(value) => handleFieldChange('account_manager_id', value)}
              users={internalUsers}
              disabled={isLoadingUsers}
              placeholder={isLoadingUsers ? "Loading users..." : "Select Account Manager"}
              buttonWidth="full"
            />
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
            value={!editedCompany.is_inactive || false}
            onEdit={(isActive) => handleFieldChange('is_inactive', !isActive)}
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
    // {
    //   label: "Assets",
    //   content: (
    //     <CompanyAssets companyId={company.company_id} />
    //   )
    // },
    {
      label: "Billing",
      content: (
        <div className="bg-white rounded-lg shadow-sm">
          <BillingConfiguration
            company={editedCompany}
            onSave={handleBillingConfigSave}
            contacts={contacts}
          />
        </div>
      )
    },
    {
      label: "Billing Dashboard",
      content: (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <ClientBillingDashboard companyId={company.company_id} />
        </div>
      )
    },
    {
      label: "Contacts",
      content: (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <CompanyContactsList
            companyId={company.company_id}
            companies={[]}
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
      content: (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <TaxSettingsForm companyId={company.company_id} />
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
          {noteDocument && (
            <div className="bg-gray-50 p-3 rounded-md border border-gray-200 text-xs text-gray-600">
              <div className="flex justify-between items-center flex-wrap gap-2"> 
                <div>
                  <span className="font-medium">Created by:</span> {noteDocument.created_by_full_name || "Unknown"}
                  {noteDocument.entered_at && (
                    <span className="ml-2">
                      on {new Date(noteDocument.entered_at).toLocaleDateString()} at {new Date(noteDocument.entered_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} {/* Formatted time */}
                    </span>
                  )}
                </div>
                {noteDocument.updated_at && noteDocument.updated_at !== noteDocument.entered_at && (
                  <div>
                    <span className="font-medium">Last updated:</span> {new Date(noteDocument.updated_at).toLocaleDateString()} at {new Date(noteDocument.updated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} {/* Formatted time */}
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
        <BackNav href={!isInDrawer ? "/msp/companies" : undefined}>
          {isInDrawer ? 'Back' : 'Back to Clients'}
        </BackNav>
        
        {/* Logo Display and Edit Container */}
        <div className="flex items-center space-x-3">
          <div className="relative">
            {/* Avatar Display */}
            <CompanyAvatar
              companyId={editedCompany.company_id}
              companyName={editedCompany.company_name}
              logoUrl={editedCompany.logoUrl ?? null}
              size="md"
            />
            {/* Loading Spinner Overlay */}
            {(isUploadingLogo || isDeletingLogo) && (
              <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center rounded-full">
                <Loader2 className="h-5 w-5 text-white animate-spin" />
              </div>
            )}
            {/* Edit Icon Button (only when not editing) */}
            {!isEditingLogo && !isUploadingLogo && !isDeletingLogo && (
              <button
                type="button"
                onClick={() => setIsEditingLogo(true)}
                className="absolute bottom-0 right-0 mb-[-2px] mr-[-6px] bg-white text-gray-600 p-1 rounded-full shadow-md hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary-500 transition-colors"
                aria-label="Edit company logo"
              >
                <Pen className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Edit Controls (only when editing) */}
          {isEditingLogo && (
            <div className="flex flex-col space-y-2">
              <Button
                id="upload-logo-button-details"
                type="button"
                variant="soft"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingLogo || isDeletingLogo}
                className="w-fit"
              >
                {isUploadingLogo ? 'Uploading...' : 'Upload New Logo'}
              </Button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleLogoUpload}
                accept="image/*"
                className="hidden"
                disabled={isUploadingLogo || isDeletingLogo}
              />
              <p className="text-xs text-gray-500">Max 2MB (PNG, JPG, GIF)</p>
              <div className="flex space-x-2 items-center">
                {editedCompany.logoUrl && (
                  <Button
                    id="delete-company-logo-details"
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteLogo}
                    disabled={isDeletingLogo || isUploadingLogo}
                    className="w-fit"
                  >
                    {isDeletingLogo ? 'Deleting...' : 'Delete Logo'}
                  </Button>
                )}
                <Button
                  id="cancel-edit-logo-details"
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditingLogo(false)}
                  disabled={isUploadingLogo || isDeletingLogo}
                  className="w-fit"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        <Heading size="6">{editedCompany.company_name}</Heading>
      </div>

      {/* Content Area */}
      <div>
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
            id: editedCompany.company_id,
            name: editedCompany.company_name
          }}
        />
      </div>
    </ReflectionContainer>
  );
};

export default CompanyDetails;

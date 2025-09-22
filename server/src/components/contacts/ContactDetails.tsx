'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { IDocument } from 'server/src/interfaces/document.interface';
import { IInteraction } from 'server/src/interfaces/interaction.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { Flex, Text, Heading } from '@radix-ui/themes';
import { Button } from '../ui/Button';
import { ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { Switch } from 'server/src/components/ui/Switch';
import { Input } from 'server/src/components/ui/Input';
import { DatePicker } from 'server/src/components/ui/DatePicker';import CustomTabs from 'server/src/components/ui/CustomTabs';
import BackNav from 'server/src/components/ui/BackNav';
import InteractionsFeed from '../interactions/InteractionsFeed';
import { useDrawer } from "server/src/context/DrawerContext";
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Card } from 'server/src/components/ui/Card';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { getContactAvatarUrlAction } from 'server/src/lib/actions/avatar-actions';
import { updateContact, deleteContact, getContactByContactNameId } from 'server/src/lib/actions/contact-actions/contactActions';
import Documents from 'server/src/components/documents/Documents';
import ContactDetailsEdit from './ContactDetailsEdit';
import { useToast } from 'server/src/hooks/use-toast';
import ContactTickets from './ContactTickets';
import { getTicketFormOptions } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import { IChannel } from 'server/src/interfaces/channel.interface';
import { SelectOption } from 'server/src/components/ui/CustomSelect';
import { CompanyPicker } from 'server/src/components/companies/CompanyPicker';
import { TagManager } from 'server/src/components/tags';
import { findTagsByEntityIds } from 'server/src/lib/actions/tagActions';
import { useTags } from 'server/src/context/TagContext';
import { validateContactName, validateEmailAddress, validatePhoneNumber, validateContactRole } from 'server/src/lib/utils/clientFormValidation';
import { PhoneInput } from 'server/src/components/ui/PhoneInput';
import { getAllCountries, ICountry } from 'server/src/lib/actions/company-actions/countryActions';
import ContactAvatarUpload from 'server/src/components/client-portal/contacts/ContactAvatarUpload';
import CompanyAvatar from 'server/src/components/ui/CompanyAvatar';
import { getCompanyById } from 'server/src/lib/actions/company-actions/companyActions';
import CompanyDetails from 'server/src/components/companies/CompanyDetails';
import { ContactPortalTab } from './ContactPortalTab';

const SwitchDetailItem: React.FC<{
  value: boolean;
  onEdit: (value: boolean) => void;
}> = ({ value, onEdit }) => {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <div className="text-gray-900 font-medium">Status</div>
        <div className="text-sm text-gray-500">Set contact status as active or inactive</div>
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
  fieldName?: string;
  validateField?: (fieldName: string, value: string) => void;
  error?: string;
  type?: string;
}> = ({ label, value, onEdit, fieldName, validateField, error, type = "text" }) => {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
    // Clear errors when user starts typing (professional SaaS pattern)
    if (error && fieldName && validateField) {
      validateField(fieldName, ''); // Clear the error
    }
  };

  const handleBlur = () => {
    // Professional SaaS validation pattern: validate on blur, not while typing
    if (validateField && fieldName) {
      validateField(fieldName, localValue);
    }

    // Always call onEdit to allow parent to determine if changes should be tracked
    onEdit(localValue);
  };

  return (
    <div className="space-y-2">
      <Text as="label" size="2" className="text-gray-700 font-medium">{label}</Text>
      <Input
        type={type}
        value={localValue}
        onChange={handleChange}
        onBlur={handleBlur}
        className={`w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 transition-all duration-200 ${
          error
            ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
            : 'border-gray-200 focus:ring-purple-500 focus:border-transparent'
        }`}
      />
      {error && (
        <p className="text-sm text-red-600 mt-1">{error}</p>
      )}
    </div>
  );
};

const DateDetailItem: React.FC<{
  label: string;
  value: string | null;
  onEdit: (value: string) => void;
}> = ({ label, value, onEdit }) => {
  const [localValue, setLocalValue] = useState<Date | undefined>(
    value ? new Date(value.split('T')[0]) : undefined
  );

  const handleChange = (date: Date | undefined) => {
    setLocalValue(date);
    if (date) {
      const dateString = date.toISOString().split('T')[0];
      if (dateString !== (value ? value.split('T')[0] : '')) {
        onEdit(dateString);
      }
    } else if (value) {
      onEdit('');
    }
  };
  
  return (
    <div className="space-y-2">
      <Text as="label" size="2" className="text-gray-700 font-medium">{label}</Text>
      <DatePicker
        value={localValue}
        onChange={handleChange}
        placeholder="Select date"
      />
    </div>
  );
};

interface ContactDetailsProps {
  id?: string;
  contact: IContact;
  companies: ICompany[];
  documents?: IDocument[];
  isInDrawer?: boolean;
  quickView?: boolean;
  userId?: string;
  onDocumentCreated?: () => Promise<void>;
  onContactUpdated?: () => Promise<void>;
  onChangesSaved?: () => void;
  userPermissions?: {
    canInvite: boolean;
    canUpdateRoles: boolean;
    canRead: boolean;
  };
}

const ContactDetails: React.FC<ContactDetailsProps> = ({
  id = 'contact-details',
  contact,
  companies,
  documents = [],
  isInDrawer = false,
  quickView = false,
  userId,
  onDocumentCreated,
  onContactUpdated,
  onChangesSaved,
  userPermissions = {
    canInvite: false,
    canUpdateRoles: false,
    canRead: false
  }
}) => {
  const [editedContact, setEditedContact] = useState<IContact>(contact);
  const [originalContact, setOriginalContact] = useState<IContact>(contact);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [interactions, setInteractions] = useState<IInteraction[]>([]);
  const [currentUser, setCurrentUser] = useState<IUserWithRoles | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [tags, setTags] = useState<ITag[]>([]);
  const { tags: allTags } = useTags();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isEditingCompany, setIsEditingCompany] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(contact.company_id || null);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [ticketFormOptions, setTicketFormOptions] = useState<{
    statusOptions: SelectOption[];
    priorityOptions: SelectOption[];
    channelOptions: IChannel[];
    categories: ITicketCategory[];
    tags?: string[];
  } | null>(null);
  const [countries, setCountries] = useState<ICountry[]>([]);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [countryCode, setCountryCode] = useState(() => {
    // Enterprise locale detection
    try {
      const locale = Intl.DateTimeFormat().resolvedOptions().locale;
      const parts = locale.split('-');
      const detectedCountry = parts[parts.length - 1]?.toUpperCase();

      if (detectedCountry && detectedCountry.length === 2 && /^[A-Z]{2}$/.test(detectedCountry)) {
        return detectedCountry;
      }
    } catch (e) {
      // Fallback to US if detection fails
    }
    return 'US';
  });
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const drawer = useDrawer();

  // Enterprise-grade field validation function (Microsoft/Meta/Salesforce style)
  const validateField = (fieldName: string, value: string) => {
    let error: string | null = null;

    switch (fieldName) {
      case 'full_name':
        error = validateContactName(value);
        break;
      case 'email':
        error = validateEmailAddress(value);
        break;
      case 'phone_number':
      case 'contact_phone':
        error = validatePhoneNumber(value);
        break;
      case 'role':
        error = validateContactRole(value);
        break;
      default:
        break;
    }

    setFieldErrors(prev => ({
      ...prev,
      [fieldName]: error || ''
    }));
  };

  // Implement refreshContactData function
  const refreshContactData = useCallback(async () => {
    if (!contact?.contact_name_id) return;

    console.log(`Refreshing contact data for ID: ${contact.contact_name_id}`);
    try {
      const latestContactData = await getContactByContactNameId(contact.contact_name_id);
      if (latestContactData) {
        setEditedContact(latestContactData);
        console.log('Contact data refreshed successfully');
      }
    } catch (error) {
      console.error('Error refreshing contact data:', error);
      toast({
        title: "Refresh Failed",
        description: "Could not fetch latest contact data.",
        variant: "destructive"
      });
    }
  }, [contact?.contact_name_id, toast]);

  // Initial Load Logic
  useEffect(() => {
    setEditedContact(contact);
    setOriginalContact(contact);
    setSelectedCompanyId(contact.company_id || null);
    setHasUnsavedChanges(false);
    setPhoneNumber(contact.phone_number || '');

    // Set initial country code based on existing phone number
    if (contact.phone_number && countries.length > 0) {
      const phoneNum = contact.phone_number.trim();
      // Try to match the phone number's country code with available countries
      const matchingCountry = countries.find(country =>
        country.phone_code && phoneNum.startsWith(country.phone_code)
      );
      if (matchingCountry) {
        setCountryCode(matchingCountry.code);
      }
    }
  }, [contact, countries]);

  // Fetch current user and countries
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const user = await getCurrentUser();
        setCurrentUser(user);
      } catch (error) {
        console.error('Error fetching current user:', error);
      }
    };

    const fetchCountries = async () => {
      try {
        const countriesData = await getAllCountries();
        setCountries(countriesData);
      } catch (error) {
        console.error('Error fetching countries:', error);
      }
    };

    fetchUser();
    fetchCountries();
  }, []);

  // Fetch ticket form options when user is available
  useEffect(() => {
    const fetchTicketFormOptions = async () => {
      if (!currentUser) return;
      try {
        const options = await getTicketFormOptions(currentUser);
        setTicketFormOptions({
          statusOptions: options.statusOptions,
          priorityOptions: options.priorityOptions,
          channelOptions: options.channelOptions,
          categories: options.categories,
          tags: options.tags
        });
      } catch (error) {
        console.error('Error fetching ticket form options:', error);
      }
    };

    if (currentUser) {
      fetchTicketFormOptions();
    }
  }, [currentUser]);

  // Fetch contact avatar URL and tags
  useEffect(() => {
    const fetchAvatarAndTags = async () => {
      if (userId && contact.tenant) {
        try {
          const [contactAvatarUrl, fetchedTags] = await Promise.all([
            getContactAvatarUrlAction(contact.contact_name_id, contact.tenant),
            findTagsByEntityIds([contact.contact_name_id], 'contact')
          ]);
          
          setAvatarUrl(contactAvatarUrl);
          setTags(fetchedTags);
        } catch (error) {
          console.error('Error fetching avatar and tags:', error);
        }
      }
    };
    fetchAvatarAndTags();
  }, [contact.contact_name_id, contact.tenant, userId]);

  const handleFieldChange = (field: string, value: string | boolean) => {
    setEditedContact(prevContact => ({
      ...prevContact,
      [field]: value
    }));
    setHasUnsavedChanges(true);
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteContact(editedContact.contact_name_id);
      toast({
        title: "Contact Deleted",
        description: "Contact has been deleted successfully.",
      });
      setIsDeleteDialogOpen(false);
      router.push('/msp/contacts');
    } catch (error) {
      console.error('Error deleting contact:', error);
      toast({
        title: "Delete Failed",
        description: "Could not delete contact. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSave = async () => {
    setHasAttemptedSubmit(true);

    // Professional PSA validation pattern: Check required fields
    const requiredFields = {
      full_name: editedContact.full_name?.trim() || '',
      email: editedContact.email?.trim() || ''
    };

    // Clear previous errors and validate required fields
    const newErrors: Record<string, string> = {};
    let hasValidationErrors = false;

    Object.entries(requiredFields).forEach(([field, value]) => {
      if (field === 'full_name') {
        const error = validateContactName(value);
        if (error) {
          newErrors[field] = error;
          hasValidationErrors = true;
        }
      } else if (field === 'email') {
        const error = validateEmailAddress(value);
        if (error) {
          newErrors[field] = error;
          hasValidationErrors = true;
        }
      }
    });

    setFieldErrors(newErrors);

    if (hasValidationErrors) {
      return;
    }

    try {
      // Make sure contact_name_id is included in the data being sent
      const dataToUpdate = {
        ...editedContact,
        contact_name_id: editedContact.contact_name_id
      };

      const updatedContact = await updateContact(dataToUpdate);
      setEditedContact(updatedContact);
      setOriginalContact(updatedContact);
      setHasUnsavedChanges(false);
      setHasAttemptedSubmit(false);

      toast({
        title: "Contact Updated",
        description: "Contact details have been saved successfully.",
      });

      // In quick view mode, mark that changes were saved (for refresh on drawer close)
      // In regular mode, refresh immediately to maintain existing behavior
      if (quickView && onChangesSaved) {
        onChangesSaved();
      } else if (!quickView && onContactUpdated) {
        await onContactUpdated();
      }
    } catch (error) {
      console.error('Error saving contact:', error);
      toast({
        title: "Save Failed",
        description: "Could not save contact details. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleTagsChange = (updatedTags: ITag[]) => {
    setTags(updatedTags);
  };

  const handleCountryChange = (newCountryCode: string) => {
    setCountryCode(newCountryCode);
    // Don't auto-populate area code - let PhoneInput component handle this naturally
  };

  const handleCompanyClick = async () => {
    if (editedContact.company_id) {
      try {
        const company = await getCompanyById(editedContact.company_id);
        if (company) {
          // In quick view mode, avoid URL manipulation to prevent navigation issues
          if (!quickView) {
            // Use router to temporarily set tab to details for the drawer
            const params = new URLSearchParams(searchParams?.toString() || '');
            params.set('tab', 'details');
            router.replace(`${pathname}?${params.toString()}`, { scroll: false });
          }
          
          // Small delay to ensure the URL is updated before opening drawer (only in non-quick view)
          const delay = quickView ? 0 : 10;
          setTimeout(() => {
            drawer.openDrawer(
              <CompanyDetails 
                company={company} 
                documents={[]} 
                contacts={[]} 
                isInDrawer={true}
                quickView={true}
              />
            );
          }, delay);
        } else {
          console.error('Company not found');
        }
      } catch (error) {
        console.error('Error fetching company details:', error);
      }
    } else {
      console.log('No company associated with this contact');
    }
  };

  const handleInteractionAdded = (newInteraction: IInteraction) => {
    setInteractions(prevInteractions => {
      const updatedInteractions = [newInteraction, ...prevInteractions];
      return updatedInteractions.filter((interaction, index, self) =>
        index === self.findIndex((t) => t.interaction_id === interaction.interaction_id)
      );
    });
  };

  const handleTabChange = async (tabValue: string) => {
    // In quick view mode, we don't need to handle tab changes since only Details tab is shown
    if (quickView) {
      return;
    }
    
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('tab', tabValue);
    router.push(`${pathname}?${params.toString()}`);
  };

  const getCompanyName = (companyId: string) => {
    const company = companies.find(c => c.company_id === companyId);
    return company ? company.company_name : 'Unknown Company';
  };

  const formatDateForDisplay = (dateString: string | null | undefined): string => {
    if (!dateString) return 'Not set';
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  const tabContent = [
    {
      label: "Details",
      content: (
        <div className="space-y-6 bg-white p-6 rounded-lg shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <TextDetailItem
              label="Full Name *"
              value={editedContact.full_name}
              onEdit={(value) => handleFieldChange('full_name', value)}
              fieldName="full_name"
              validateField={validateField}
              error={fieldErrors.full_name}
            />
            <div className="space-y-2">
              <Text as="label" size="2" className="text-gray-700 font-medium">Company (optional)</Text>
              {isEditingCompany ? (
                // Show company picker when editing
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <CompanyPicker
                      id="contact-company-picker"
                      onSelect={(companyId) => {
                        handleFieldChange('company_id', companyId || '');
                        setSelectedCompanyId(companyId);
                        setIsEditingCompany(false);
                      }}
                      selectedCompanyId={selectedCompanyId}
                      companies={companies}
                      filterState={filterState}
                      onFilterStateChange={setFilterState}
                      clientTypeFilter={clientTypeFilter}
                      onClientTypeFilterChange={setClientTypeFilter}
                    />
                  </div>
                </div>
              ) : (
                // Display company with edit button
                <div className="flex items-center justify-between">
                  {editedContact.company_id ? (
                    <div className="flex items-center gap-2 py-2 cursor-pointer hover:bg-gray-50 rounded px-2 flex-1" onClick={handleCompanyClick}>
                      <CompanyAvatar 
                        companyId={editedContact.company_id}
                        companyName={getCompanyName(editedContact.company_id)}
                        logoUrl={companies.find(c => c.company_id === editedContact.company_id)?.logoUrl || null}
                        size="sm"
                      />
                      <span className="text-blue-500 hover:underline text-sm">{getCompanyName(editedContact.company_id)}</span>
                    </div>
                  ) : (
                    <span className="text-gray-500 italic text-sm py-2 px-2">No company assigned</span>
                  )}
                  <Button
                    id="edit-company-btn"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsEditingCompany(true)}
                    className="p-1"
                  >
                    <Pencil className="h-3 w-3 text-gray-600" />
                  </Button>
                </div>
              )}
            </div>
            <TextDetailItem
              label="Email *"
              value={editedContact.email || ''}
              onEdit={(value) => handleFieldChange('email', value)}
              fieldName="email"
              validateField={validateField}
              error={fieldErrors.email}
              type="email"
            />
            <TextDetailItem
              label="Role (optional)"
              value={editedContact.role || ''}
              onEdit={(value) => handleFieldChange('role', value)}
              fieldName="role"
              validateField={validateField}
              error={fieldErrors.role}
            />
            <div>
              <PhoneInput
                id="contact-details-phone"
                label="Phone Number (optional)"
                value={phoneNumber}
                onChange={(value) => {
                  setPhoneNumber(value);
                  handleFieldChange('phone_number', value);
                  // Clear error when user starts typing, clears the field, or has only country code
                  const trimmedValue = value.trim();
                  const isCountryCodeOnly = /^\+\d{1,4}\s*$/.test(trimmedValue);

                  if (fieldErrors.contact_phone && (trimmedValue === '' || isCountryCodeOnly)) {
                    setFieldErrors(prev => ({ ...prev, contact_phone: '' }));
                  }
                }}
                onBlur={() => {
                  validateField('contact_phone', phoneNumber);
                }}
                countryCode={countryCode}
                phoneCode={countries.find(c => c.code === countryCode)?.phone_code}
                countries={countries}
                onCountryChange={handleCountryChange}
                error={!!fieldErrors.contact_phone}
                data-automation-id="contact-details-phone"
              />
              {fieldErrors.contact_phone && (
                <p className="text-sm text-red-600 mt-1">{fieldErrors.contact_phone}</p>
              )}
            </div>
            <SwitchDetailItem
              value={!editedContact.is_inactive || false}
              onEdit={(isActive) => handleFieldChange('is_inactive', !isActive)}
            />
          </div>

          {/* Tags Section */}
          <div className="space-y-2">
            <Text as="label" size="2" className="text-gray-700 font-medium">Tags (optional)</Text>
            <TagManager
              entityId={editedContact.contact_name_id}
              entityType="contact"
              initialTags={tags}
              onTagsChange={handleTagsChange}
              useInlineInput={isInDrawer}
            />
          </div>

          {editedContact.notes && (
            <div className="space-y-2">
              <Text as="label" size="2" className="text-gray-700 font-medium">Notes (optional)</Text>
              <div className="bg-gray-50 p-3 rounded-md border border-gray-200">
                <Text className="text-sm whitespace-pre-wrap">{editedContact.notes}</Text>
              </div>
            </div>
          )}
          
          <Flex gap="4" justify="end" align="center" className="pt-6">
            {hasAttemptedSubmit && Object.keys(fieldErrors).some(key => fieldErrors[key]) && (
              <Text size="2" className="text-red-600 mr-2" role="alert">
                Please fill in all required fields
              </Text>
            )}
            <Button
              id="save-contact-changes-btn"
              onClick={handleSave}
              className="bg-[rgb(var(--color-primary-500))] hover:bg-[rgb(var(--color-primary-600))] text-white transition-colors"
            >
              Save Changes
            </Button>
            <Button
              id="delete-contact-btn"
              onClick={() => setIsDeleteDialogOpen(true)}
              variant="outline"
              className="text-red-600 border-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Contact
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
            <ContactTickets 
              contactId={editedContact.contact_name_id}
              contactName={editedContact.full_name}
              companyId={editedContact.company_id || ''}
              companyName={getCompanyName(editedContact.company_id || '')}
              initialChannels={ticketFormOptions.channelOptions}
              initialStatuses={ticketFormOptions.statusOptions}
              initialPriorities={ticketFormOptions.priorityOptions}
              initialCategories={ticketFormOptions.categories}
              initialTags={ticketFormOptions.tags || []}
            />
          ) : (
            <div className="flex justify-center items-center h-32">
              <span>Loading ticket filters...</span>
            </div>
          )}
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
              entityId={editedContact.contact_name_id}
              entityType="contact"
              onDocumentCreated={onDocumentCreated || (async () => {})}
            />
          ) : (
            <div>Loading...</div>
          )}
        </div>
      )
    },
    {
      label: "Interactions",
      content: (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <InteractionsFeed
            entityId={editedContact.contact_name_id}
            entityType="contact"
            companyId={editedContact.company_id!}
            interactions={interactions}
            setInteractions={setInteractions}
          />
        </div>
      )
    },
    {
      label: "Portal",
      content: (
        <ContactPortalTab
          contact={editedContact}
          currentUserPermissions={userPermissions}
        />
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
    <ReflectionContainer id={id} label="Contact Details">
      <div className="flex items-center space-x-5 mb-4 pt-2">
        {!quickView && (
          <BackNav href={!isInDrawer ? "/msp/contacts" : undefined}>
            {isInDrawer ? 'Back' : 'Back to Contacts'}
          </BackNav>
        )}
        
        {/* Contact Avatar Upload */}
        <div className="mr-4">
          <ContactAvatarUpload
            contactId={editedContact.contact_name_id}
            contactName={editedContact.full_name}
            avatarUrl={avatarUrl}
            userType="internal"
            onAvatarChange={(newAvatarUrl) => {
              console.log("ContactDetails: Avatar URL changed:", newAvatarUrl);
              setAvatarUrl(newAvatarUrl);
            }}
          />
        </div>
        
        <Heading size="6">{editedContact.full_name}</Heading>
        
        {isInDrawer && (
          <Button
            id={`${id}-go-to-contact-button`}
            onClick={() => window.open(`/msp/contacts/${editedContact.contact_name_id}`, '_blank')}
            variant="soft"
            size="sm"
            className="flex items-center ml-4 mr-8"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Go to contact
          </Button>
        )}
      </div>

      {/* Content Area */}
      <div>
        <CustomTabs
          tabs={quickView ? [tabContent[0]] : tabContent}
          defaultTab={findTabLabel(searchParams?.get('tab'))}
          onTabChange={handleTabChange}
        />

        {/* Delete Confirmation Dialog */}
        <ConfirmationDialog
          id="delete-contact-confirmation-dialog"
          isOpen={isDeleteDialogOpen}
          onClose={() => setIsDeleteDialogOpen(false)}
          onConfirm={handleDelete}
          title="Delete Contact"
          message={`Are you sure you want to delete "${editedContact.full_name || editedContact.email}"? This action cannot be undone and will remove all associated data.`}
          confirmLabel={isDeleting ? 'Deleting...' : 'Delete Contact'}
          cancelLabel="Cancel"
          isConfirming={isDeleting}
        />
      </div>
    </ReflectionContainer>
  );
};

export default ContactDetails;
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type { ContactPhoneNumberInput, CreateContactInput, DeletionValidationResult, IContact } from '@alga-psa/types';
import type { IClient } from '@alga-psa/types';
import type { IDocument } from '@alga-psa/types';
import { IInteraction } from '@alga-psa/types';
import { IUserWithRoles, IUser } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import { Flex, Text, Heading } from '@radix-ui/themes';
import { Button } from '@alga-psa/ui/components/Button';
import { ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Input } from '@alga-psa/ui/components/Input';
import CustomTabs from '@alga-psa/ui/components/CustomTabs';
import BackNav from '@alga-psa/ui/components/BackNav';
import InteractionsFeed from '../interactions/InteractionsFeed';
import { useDrawer, useClientDrawer } from "@alga-psa/ui";
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getCurrentUserAsync, getContactAvatarUrlActionAsync } from '../../lib/usersHelpers';
import { updateContact, deleteContact, listInboundTicketDestinationOptions, listContactPhoneTypeSuggestions } from '@alga-psa/clients/actions';
import { preCheckDeletion } from '@alga-psa/auth/lib/preCheckDeletion';
import { validateContactName, validateRole } from '@alga-psa/validation';
import { useDocumentsCrossFeature } from '@alga-psa/core/context/DocumentsCrossFeatureContext';
import { useToast } from '@alga-psa/ui';
import { useClientCrossFeature } from '../../context/ClientCrossFeatureContext';
import { ITicketCategory } from '@alga-psa/types';
import { IBoard } from '@alga-psa/types';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { TagManager } from '@alga-psa/tags/components';
import { findTagsByEntityIds } from '@alga-psa/tags/actions';
import ContactAvatarUpload from './ContactAvatarUpload';
import ClientAvatar from '@alga-psa/ui/components/ClientAvatar';
import { getClientById } from '@alga-psa/clients/actions';
import { getAllCountries, ICountry } from '@alga-psa/clients/actions';
import ClientDetails from '../clients/ClientDetails';
import { ContactPortalTab } from './ContactPortalTab';
import { ContactNotesPanel } from './panels/ContactNotesPanel';
import ContactPhoneNumbersEditor, { compactContactPhoneNumbers, validateContactPhoneNumbers } from './ContactPhoneNumbersEditor';
import ContactEmailAddressesEditor, {
  compactContactEmailAddresses,
  validateContactEmailAddresses,
} from './ContactEmailAddressesEditor';

type EditableContact = IContact & {
  primary_email_custom_type?: string | null;
  additional_email_addresses: NonNullable<IContact['additional_email_addresses']>;
};

const SwitchDetailItem: React.FC<{
  value: boolean;
  label: string;
  helperText: string;
  activeLabel: string;
  inactiveLabel: string;
  onEdit: (value: boolean) => void;
}> = ({ value, label, helperText, activeLabel, inactiveLabel, onEdit }) => {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <div className="text-gray-900 font-medium">{label}</div>
        <div className="text-sm text-gray-500">{helperText}</div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-700">
          {value ? activeLabel : inactiveLabel}
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
  validate?: (value: string) => string | null;
}> = ({ label, value, onEdit, automationId, validate }) => {
  const [localValue, setLocalValue] = useState(value);
  const [error, setError] = useState<string | null>(null);

  const handleBlur = () => {
    // Professional SaaS validation pattern: validate on blur, not while typing
    if (validate) {
      const validationError = validate(localValue);
      setError(validationError);
    }

    if (localValue !== value) {
      onEdit(localValue);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
    // Clear error while typing
    if (error) {
      setError(null);
    }
  };

  return (
    <div className="space-y-2">
      <Text as="label" size="2" className="text-gray-700 font-medium">{label}</Text>
      <Input
        type="text"
        value={localValue}
        onChange={handleChange}
        onBlur={handleBlur}
        className={`w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent ${
          error ? 'border-red-500' : 'border-gray-200'
        }`}
        data-automation-id={automationId}
      />
      {error && (
        <div className="text-red-500 text-xs mt-1">{error}</div>
      )}
    </div>
  );
};

interface ContactDetailsProps {
  id?: string;
  contact: IContact;
  clients: IClient[];
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
  clients,
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
  const [editedContact, setEditedContact] = useState<EditableContact>(() => ({
    ...contact,
    additional_email_addresses: contact.additional_email_addresses ?? [],
  }));
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [interactions, setInteractions] = useState<IInteraction[]>([]);
  const [currentUser, setCurrentUser] = useState<IUserWithRoles | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [tags, setTags] = useState<ITag[]>([]);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);
  const [isEditingClient, setIsEditingClient] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(contact.client_id || null);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [ticketFormOptions, setTicketFormOptions] = useState<{
    statusOptions: SelectOption[];
    priorityOptions: SelectOption[];
    boardOptions: IBoard[];
    categories: ITicketCategory[];
    tags?: ITag[];
    users?: IUser[];
  } | null>(null);
  const [countries, setCountries] = useState<ICountry[]>([]);
  const [customPhoneTypeSuggestions, setCustomPhoneTypeSuggestions] = useState<string[]>([]);
  const [phoneValidationErrors, setPhoneValidationErrors] = useState<string[]>([]);
  const [emailValidationErrors, setEmailValidationErrors] = useState<string[]>([]);
  const [inboundDestinationOptions, setInboundDestinationOptions] = useState<SelectOption[]>([]);
  const [isInboundDestinationOptionsLoading, setIsInboundDestinationOptionsLoading] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const drawer = useDrawer();
  const clientDrawer = useClientDrawer();
  const { t } = useTranslation('msp/contacts');
  const { getTicketFormOptions, renderContactTickets } = useClientCrossFeature();
  const { renderDocuments } = useDocumentsCrossFeature();

  // Initial Load Logic
  useEffect(() => {
    setEditedContact({
      ...contact,
      additional_email_addresses: contact.additional_email_addresses ?? [],
    });
    setSelectedClientId(contact.client_id || null);
    setHasUnsavedChanges(false);
    setPhoneValidationErrors([]);
    setEmailValidationErrors([]);
  }, [contact]);

  // Fetch current user
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const user = await getCurrentUserAsync();
        setCurrentUser(user);
      } catch (error) {
        console.error('Error fetching current user:', error);
      }
    };
    fetchUser();
  }, []);

  // Fetch ticket form options when user is available
  useEffect(() => {
    const fetchTicketFormOptions = async () => {
      if (!currentUser) return;
      try {
        const options = await getTicketFormOptions();
        setTicketFormOptions({
          statusOptions: options.statusOptions,
          priorityOptions: options.priorityOptions,
          boardOptions: options.boardOptions,
          categories: options.categories,
          tags: options.tags,
          users: options.users
        });
      } catch (error) {
        console.error('Error fetching ticket form options:', error);
      }
    };

    if (currentUser) {
      fetchTicketFormOptions();
    }
  }, [currentUser]);

  // Load countries
  useEffect(() => {
    const fetchCountries = async () => {
      try {
        const [countriesData, suggestionLabels] = await Promise.all([
          countries.length > 0 ? Promise.resolve(countries) : getAllCountries(),
          listContactPhoneTypeSuggestions(),
        ]);
        setCountries(countriesData);
        setCustomPhoneTypeSuggestions(suggestionLabels);
      } catch (error: any) {
        console.error('Error fetching countries:', error);
      }
    };
    fetchCountries();
  }, [countries.length]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsInboundDestinationOptionsLoading(true);
      try {
        const rows = await listInboundTicketDestinationOptions();
        if (cancelled) return;
        setInboundDestinationOptions(
          (rows ?? []).map((row: any) => ({
            value: row.id,
            label: row.is_active
              ? `${row.display_name} (${row.short_name})`
              : `${row.display_name} (${row.short_name}) [${t('contactDetails.inactiveBadge', { defaultValue: 'inactive' })}]`,
          }))
        );
      } catch (error) {
        if (!cancelled) {
          console.error('Error loading inbound ticket destination options:', error);
          setInboundDestinationOptions([]);
        }
      } finally {
        if (!cancelled) {
          setIsInboundDestinationOptionsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  // Fetch contact avatar URL and tags
  useEffect(() => {
    const fetchAvatarAndTags = async () => {
      if (userId && contact.tenant) {
        try {
          const [contactAvatarUrl, fetchedTags] = await Promise.all([
            getContactAvatarUrlActionAsync(contact.contact_name_id, contact.tenant),
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

  const handleFieldChange = (field: string, value: string | boolean | ContactPhoneNumberInput[]) => {
    setEditedContact(prevContact => ({
      ...prevContact,
      [field]: value
    }));
    setHasUnsavedChanges(true);
  };

  const handleEmailAddressesChange = (value: Pick<
    CreateContactInput,
    'email' | 'primary_email_canonical_type' | 'primary_email_custom_type' | 'additional_email_addresses'
  >) => {
    setEditedContact((prev) => ({
      ...prev,
      ...value,
    }));
    setHasUnsavedChanges(true);
  };

  const runDeleteValidation = useCallback(async () => {
    if (!editedContact.contact_name_id) {
      return;
    }

    setIsDeleteValidating(true);
    try {
      const result = await preCheckDeletion('contact', editedContact.contact_name_id);
      setDeleteValidation(result);
    } catch (error: any) {
      console.error('Failed to validate contact deletion:', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: t('contactDetails.delete.validationFailed', { defaultValue: 'Failed to validate deletion. Please try again.' }),
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteValidating(false);
    }
  }, [editedContact.contact_name_id, t]);

  const handleDeleteContact = () => {
    setIsDeleteDialogOpen(true);
    void runDeleteValidation();
  };

  const resetDeleteState = () => {
    setIsDeleteDialogOpen(false);
    setDeleteValidation(null);
  };

  const confirmDelete = async () => {
    setIsDeleteProcessing(true);
    try {
      const result = await deleteContact(editedContact.contact_name_id);

      if (!result.success) {
        setDeleteValidation(result);
        return;
      }

      resetDeleteState();

      toast({
        title: t('contactDetails.delete.successTitle', { defaultValue: 'Contact Deleted' }),
        description: t('contactDetails.delete.successDescription', { defaultValue: 'Contact has been deleted successfully.' }),
      });

      if (isInDrawer) {
        drawer.closeDrawer();
      } else {
        router.push('/msp/contacts');
      }
    } catch (error: any) {
      console.error('Failed to delete contact:', error);
      const errorMessage = error.message || t('contactDetails.delete.failed', { defaultValue: 'Failed to delete contact. Please try again.' });
      toast({
        title: t('contactDetails.error.title', { defaultValue: 'Error' }),
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsDeleteProcessing(false);
    }
  };

  const handleDeleteAlternativeAction = async (action: string) => {
    if (action !== 'deactivate') {
      return;
    }

    setIsDeleteProcessing(true);
    try {
      await handleMarkContactInactive();
    } finally {
      setIsDeleteProcessing(false);
    }
  };

  const handleMarkContactInactive = async () => {
    try {
      const updatedContact = await updateContact({
        ...editedContact,
        is_inactive: true
      });

      setIsDeleteDialogOpen(false);

      // Update local state immediately
      setEditedContact({
        ...updatedContact,
        additional_email_addresses: updatedContact.additional_email_addresses ?? [],
      });

      toast({
        title: t('contactDetails.deactivate.successTitle', { defaultValue: 'Contact Deactivated' }),
        description: t('contactDetails.deactivate.successDescription', { defaultValue: 'Contact has been marked as inactive successfully.' }),
      });
      router.refresh();
    } catch (error: any) {
      console.error('Error marking contact as inactive:', error);
      const errorMessage = error.message?.toLowerCase().includes('permission denied')
        ? t('contactDetails.errors.permissionDenied', { defaultValue: 'Permission denied. Please contact your administrator if you need additional access.' })
        : t('contactDetails.errors.markInactiveFailed', { defaultValue: 'An error occurred while marking the contact as inactive. Please try again.' });
      toast({
        title: t('contactDetails.error.title', { defaultValue: 'Error' }),
        description: errorMessage,
        variant: "destructive"
      });
    }
  };

  const handleSave = async () => {
    try {
      const currentEmailErrors = validateContactEmailAddresses(editedContact);
      setEmailValidationErrors(currentEmailErrors);
      if (currentEmailErrors.length > 0) {
        toast({
          title: t('contactDetails.saveFailed.title', { defaultValue: 'Save Failed' }),
          description: currentEmailErrors[0],
          variant: 'destructive',
        });
        return;
      }

      const currentPhoneErrors = validateContactPhoneNumbers(editedContact.phone_numbers);
      setPhoneValidationErrors(currentPhoneErrors);
      if (currentPhoneErrors.length > 0) {
        toast({
          title: t('contactDetails.saveFailed.title', { defaultValue: 'Save Failed' }),
          description: currentPhoneErrors[0],
          variant: "destructive"
        });
        return;
      }

      const compactedEmails = compactContactEmailAddresses(editedContact);

      // Make sure contact_name_id is included in the data being sent
      const dataToUpdate = {
        ...editedContact,
        ...compactedEmails,
        phone_numbers: compactContactPhoneNumbers(editedContact.phone_numbers),
        contact_name_id: editedContact.contact_name_id
      };

      const updatedContact = await updateContact(dataToUpdate);
      setEditedContact({
        ...updatedContact,
        additional_email_addresses: updatedContact.additional_email_addresses ?? [],
      });
      setHasUnsavedChanges(false);

      toast({
        title: t('contactDetails.update.successTitle', { defaultValue: 'Contact Updated' }),
        description: t('contactDetails.update.successDescription', { defaultValue: 'Contact details have been saved successfully.' }),
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
        title: t('contactDetails.saveFailed.title', { defaultValue: 'Save Failed' }),
        description: t('contactDetails.saveFailed.description', { defaultValue: 'Could not save contact details. Please try again.' }),
        variant: "destructive"
      });
    }
  };

  const handleTagsChange = (updatedTags: ITag[]) => {
    setTags(updatedTags);
  };

  const handleClientClick = async () => {
    if (editedContact.client_id) {
      if (clientDrawer) {
        clientDrawer.openClientDrawer(editedContact.client_id);
        return;
      }
      try {
        const client = await getClientById(editedContact.client_id);
        if (client) {
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
              <ClientDetails
                client={client}
                documents={[]}
                contacts={[]}
                isInDrawer={true}
                quickView={true}
              />
            );
          }, delay);
        } else {
          console.error('Client not found');
        }
      } catch (error) {
        console.error('Error fetching client details:', error);
      }
    } else {
      console.log('No client associated with this contact');
    }
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

  const getClientName = (clientId: string) => {
    const client = clients.find(c => c.client_id === clientId);
    return client ? client.client_name : t('contactDetails.empty.unknownClient', { defaultValue: 'Unknown Client' });
  };

  const tabContent = [
    {
      id: 'details',
      label: t('contactDetails.tabs.details', { defaultValue: 'Details' }),
      content: (
        <div className="space-y-6 bg-white p-6 rounded-lg shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <TextDetailItem
              label={t('contactDetails.fields.fullName', { defaultValue: 'Full Name' })}
              value={editedContact.full_name}
              onEdit={(value) => handleFieldChange('full_name', value)}
              automationId="full-name-field"
              validate={validateContactName}
            />
            <div className="space-y-2">
              <Text as="label" size="2" className="text-gray-700 font-medium">{t('contactDetails.fields.client', { defaultValue: 'Client' })}</Text>
              {isEditingClient ? (
                // Show client picker when editing
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <ClientPicker
                      id="contact-client-picker"
                      onSelect={(clientId) => {
                        handleFieldChange('client_id', clientId || '');
                        setSelectedClientId(clientId);
                        setIsEditingClient(false);
                      }}
                      selectedClientId={selectedClientId}
                      clients={clients}
                      filterState={filterState}
                      onFilterStateChange={setFilterState}
                      clientTypeFilter={clientTypeFilter}
                      onClientTypeFilterChange={setClientTypeFilter}
                    />
                  </div>
                </div>
              ) : (
                // Display client with edit button
                <div className="flex items-center justify-between">
                  {editedContact.client_id ? (
                    <div className="flex items-center gap-2 py-2 cursor-pointer hover:bg-gray-50 rounded px-2 flex-1" onClick={handleClientClick}>
                      <ClientAvatar 
                        clientId={editedContact.client_id}
                        clientName={getClientName(editedContact.client_id)}
                        logoUrl={clients.find(c => c.client_id === editedContact.client_id)?.logoUrl || null}
                        size="sm"
                      />
                      <span className="text-blue-500 hover:underline text-sm">{getClientName(editedContact.client_id)}</span>
                    </div>
                  ) : (
                    <span className="text-gray-500 italic text-sm py-2 px-2">{t('contactDetails.client.noClientAssigned', { defaultValue: 'No client assigned' })}</span>
                  )}
                  <Button
                    id="edit-client-btn"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsEditingClient(true)}
                    className="p-1"
                  >
                    <Pencil className="h-3 w-3 text-gray-600" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-surface-25,250_250_250))] p-4 shadow-sm">
            <ContactEmailAddressesEditor
              id="contact-details-email"
              primaryEmailInputId="email-field"
              compactAdditionalRows
              value={editedContact}
              onChange={handleEmailAddressesChange}
              customTypeSuggestions={[]}
              errorMessages={emailValidationErrors}
              onValidationChange={setEmailValidationErrors}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <TextDetailItem
              label={t('contactDetails.fields.role', { defaultValue: 'Role' })}
              value={editedContact.role || ''}
              onEdit={(value) => handleFieldChange('role', value)}
              automationId="role-field"
              validate={validateRole}
            />
            <div className="space-y-2">
              <Text as="label" size="2" className="text-gray-700 font-medium">{t('contactDetails.fields.inboundTicketDestinationOverride', { defaultValue: 'Inbound ticket destination override' })}</Text>
              <CustomSelect
                id="contact-inbound-ticket-destination-select"
                value={(editedContact as any).inbound_ticket_defaults_id || ''}
                onValueChange={(value) => handleFieldChange('inbound_ticket_defaults_id', value)}
                options={inboundDestinationOptions}
                allowClear={true}
                placeholder={
                  isInboundDestinationOptionsLoading
                    ? t('contactDetails.loading.destinations', { defaultValue: 'Loading destinations...' })
                    : t('contactDetails.fields.useClientDestination', { defaultValue: 'Use client destination' })
                }
                disabled={isInboundDestinationOptionsLoading}
              />
              <Text size="1" className="text-gray-500">
                {t('contactDetails.fields.inboundTicketDestinationHelp', { defaultValue: 'If set, this overrides the client destination for this exact sender contact. Precedence: Contact override -> Client destination -> Provider default.' })}
              </Text>
            </div>
            <div className="space-y-2">
              <ContactPhoneNumbersEditor
                id="contact-phone-number"
                value={editedContact.phone_numbers}
                onChange={(rows) => handleFieldChange('phone_numbers', rows)}
                countries={countries}
                customTypeSuggestions={customPhoneTypeSuggestions}
                errorMessages={phoneValidationErrors}
                onValidationChange={setPhoneValidationErrors}
              />
            </div>
            <SwitchDetailItem
              value={!editedContact.is_inactive || false}
              label={t('contactDetails.status.label', { defaultValue: 'Status' })}
              helperText={t('contactDetails.status.helper', { defaultValue: 'Set contact status as active or inactive' })}
              activeLabel={t('contactDetails.status.active', { defaultValue: 'Active' })}
              inactiveLabel={t('contactDetails.status.inactive', { defaultValue: 'Inactive' })}
              onEdit={(isActive) => handleFieldChange('is_inactive', !isActive)}
            />
          </div>

          {/* Tags Section */}
          <div className="space-y-2">
            <Text as="label" size="2" className="text-gray-700 font-medium">{t('contactDetails.fields.tags', { defaultValue: 'Tags' })}</Text>
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
              <Text as="label" size="2" className="text-gray-700 font-medium">{t('contactDetails.fields.notes', { defaultValue: 'Notes' })}</Text>
              <div className="bg-gray-50 p-3 rounded-md border border-gray-200">
                <Text className="text-sm whitespace-pre-wrap">{editedContact.notes}</Text>
              </div>
            </div>
          )}
          
          <Flex gap="4" justify="end" align="center" className="pt-6">
            <Button
              id="save-contact-changes-btn"
              onClick={handleSave}
              disabled={!hasUnsavedChanges}
              className={`text-white transition-colors ${
                hasUnsavedChanges
                  ? "bg-[rgb(var(--color-primary-500))] hover:bg-[rgb(var(--color-primary-600))]"
                  : "bg-[rgb(var(--color-border-400))] cursor-not-allowed"
              }`}
            >
              {t('contactDetails.actions.saveChanges', { defaultValue: 'Save Changes' })}
            </Button>
          </Flex>
        </div>
      )
    },
    {
      id: 'tickets',
      label: t('contactDetails.tabs.tickets', { defaultValue: 'Tickets' }),
      content: (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          {ticketFormOptions ? (
            renderContactTickets({
              contactId: editedContact.contact_name_id,
              contactName: editedContact.full_name,
              clientId: editedContact.client_id || '',
              clientName: getClientName(editedContact.client_id || ''),
              initialBoards: ticketFormOptions.boardOptions,
              initialStatuses: ticketFormOptions.statusOptions,
              initialPriorities: ticketFormOptions.priorityOptions,
              initialCategories: ticketFormOptions.categories,
              initialTags: ticketFormOptions.tags || [],
              initialUsers: ticketFormOptions.users || [],
            })
          ) : (
            <div className="flex justify-center items-center h-32">
              <span>{t('contactDetails.loading.ticketFilters', { defaultValue: 'Loading ticket filters...' })}</span>
            </div>
          )}
        </div>
      )
    },
    {
      id: 'documents',
      label: t('contactDetails.tabs.documents', { defaultValue: 'Documents' }),
      content: (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          {currentUser ? renderDocuments({
              id: `${id}-documents`,
              documents,
              gridColumns: 3,
              userId: currentUser.user_id,
              entityId: editedContact.contact_name_id,
            entityType: 'contact',
            onDocumentCreated: onDocumentCreated || (async () => {}),
          }) : (
            <div>{t('common.states.loading', { defaultValue: 'Loading...' })}</div>
          )}
        </div>
      )
    },
    {
      id: 'interactions',
      label: t('contactDetails.tabs.interactions', { defaultValue: 'Interactions' }),
      content: (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <InteractionsFeed
            entityId={editedContact.contact_name_id}
            entityType="contact"
            clientId={editedContact.client_id!}
            interactions={interactions}
            setInteractions={setInteractions}
          />
        </div>
      )
    },
    {
      id: 'notes',
      label: t('contactDetails.tabs.notes', { defaultValue: 'Notes' }),
      content: (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <ContactNotesPanel
            contactId={editedContact.contact_name_id}
            legacyNotes={editedContact.notes}
          />
        </div>
      )
    },
    {
      id: 'portal',
      label: t('contactDetails.tabs.portal', { defaultValue: 'Portal' }),
      content: (
        <ContactPortalTab
          contact={editedContact}
          currentUserPermissions={userPermissions}
        />
      )
    }
  ];

  return (
    <ReflectionContainer id={id} label={t('contactDetails.title', { defaultValue: 'Contact Details' })}>
      <div className="flex items-center space-x-5 mb-4 pt-2">
        {!quickView && (
          <BackNav href={!isInDrawer ? "/msp/contacts" : undefined}>
            {isInDrawer
              ? t('common.actions.back', { defaultValue: 'Back' })
              : t('contactDetails.backToContacts', { defaultValue: 'Back to Contacts' })}
          </BackNav>
        )}
        
        {/* Contact Avatar Upload */}
        <div className="mr-4">
          <ContactAvatarUpload
            contactId={editedContact.contact_name_id}
            contactName={editedContact.full_name}
            currentAvatarUrl={avatarUrl}
            onAvatarUpdated={(newAvatarUrl) => {
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
            className="flex items-center ml-4 mr-2"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            {t('contactDetails.actions.goToContact', { defaultValue: 'Go to contact' })}
          </Button>
        )}

        <div className="flex items-center gap-2 mr-8">
          <Button
            id={`${id}-delete-contact-button`}
            onClick={handleDeleteContact}
            variant="destructive"
            size="sm"
            className="flex items-center"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {t('common.actions.delete', { defaultValue: 'Delete' })}
          </Button>
        </div>
      </div>

      {/* Content Area */}
      <div>
        <CustomTabs
          tabs={quickView ? [tabContent[0]] : tabContent}
          defaultTab={searchParams?.get('tab')?.toLowerCase() || 'details'}
          onTabChange={handleTabChange}
        />
      </div>

      {/* Delete Confirmation Dialog */}
      <DeleteEntityDialog
        id="delete-contact-dialog"
        isOpen={isDeleteDialogOpen}
        onClose={resetDeleteState}
        onConfirmDelete={confirmDelete}
        onAlternativeAction={handleDeleteAlternativeAction}
        entityName={`${editedContact.full_name}`}
        validationResult={deleteValidation}
        isValidating={isDeleteValidating}
        isDeleting={isDeleteProcessing}
      />
    </ReflectionContainer>
  );
};

export default ContactDetails;

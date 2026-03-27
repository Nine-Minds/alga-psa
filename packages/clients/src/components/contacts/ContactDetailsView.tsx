'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { IContact } from '@alga-psa/types';
import { Flex, Text, Heading } from '@radix-ui/themes';
import { QuickAddInteraction } from '../interactions/QuickAddInteraction';
import { Button } from '@alga-psa/ui/components/Button';
import { Pen, Plus, ArrowLeft, ExternalLink } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useDrawer, useClientDrawer } from '@alga-psa/ui';
import ContactDetailsEdit from './ContactDetailsEdit';
import { ITag } from '@alga-psa/types';
import type { IClient } from '@alga-psa/types';
import ClientDetails from '../clients/ClientDetails';
import InteractionsFeed from '../interactions/InteractionsFeed';
import { IInteraction } from '@alga-psa/types';
import { TagManager } from '@alga-psa/tags/components';
import { getClientById } from '@alga-psa/clients/actions';
import { updateContact } from '@alga-psa/clients/actions';
import { useDocumentsCrossFeature } from '@alga-psa/core/context/DocumentsCrossFeatureContext';
import type { IDocument } from '@alga-psa/types';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { ButtonComponent, ContainerComponent } from '@alga-psa/ui/ui-reflection/types';
import ContactAvatar from '@alga-psa/ui/components/ContactAvatar';
import { getContactAvatarUrlActionAsync } from '../../lib/usersHelpers';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

// Stable empty array reference to avoid infinite re-render loops
// when the `documents` prop is not passed (default `= []` creates a new ref each render).
const EMPTY_DOCUMENTS: IDocument[] = [];

interface ContactDetailsViewProps {
  id?: string; // Made optional to maintain backward compatibility
  initialContact: IContact;
  clients: IClient[];
  isInDrawer?: boolean;
  userId?: string;
  documents?: IDocument[];
  onDocumentCreated?: () => Promise<void>;
  quickView?: boolean;
  showDocuments?: boolean;
  showInteractions?: boolean;
  clientReadOnly?: boolean; // When true, prevents editing the client (e.g., when opened from a ticket)
}

interface TableRowProps {
  label: string;
  value: string;
  onClick?: () => void;
}

const TableRow: React.FC<TableRowProps> = ({ label, value, onClick }) => (
  <tr>
    <td className="py-2 font-semibold">{label}:</td>
    <td className="py-2">
      {onClick ? (
        <button
          onClick={onClick}
          className="text-blue-600 hover:underline focus:outline-none"
        >
          {value}
        </button>
      ) : (
        value
      )}
    </td>
  </tr>
);

const ContactDetailsView: React.FC<ContactDetailsViewProps> = ({
  id = 'contact-details',
  initialContact,
  clients,
  isInDrawer = false,
  userId,
  documents: initialDocuments = EMPTY_DOCUMENTS,
  onDocumentCreated,
  quickView = false,
  showDocuments = !quickView,
  showInteractions = !quickView,
  clientReadOnly = false
}) => {
  const { t } = useTranslation('msp/contacts');
  const [contact, setContact] = useState<IContact>(initialContact);
  const [interactions, setInteractions] = useState<IInteraction[]>([]);
  const [documents, setDocuments] = useState<IDocument[]>(initialDocuments);
  const [error, setError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isEditingClient, setIsEditingClient] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(contact.client_id || null);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const { openDrawer, goBack } = useDrawer();
  const clientDrawer = useClientDrawer();
  const { renderDocuments } = useDocumentsCrossFeature();

  useEffect(() => {
    const fetchData = async () => {
      try {
        setError(null);
        
        // Fetch contact avatar URL
        if (userId && contact.tenant) {
          const contactAvatarUrl = await getContactAvatarUrlActionAsync(contact.contact_name_id, contact.tenant);
          setAvatarUrl(contactAvatarUrl);
        }
      } catch (err) {
        console.error('Error fetching tags:', err);
        if (err instanceof Error) {
          if (err.message.includes('SYSTEM_ERROR:')) {
            setError(t('contactDetailsView.errors.loadTagsSystem', {
              defaultValue: 'An unexpected error occurred while loading tags. Please try again or contact support.'
            }));
          } else {
            setError(t('contactDetailsView.errors.loadTagsFailed', {
              defaultValue: 'Failed to load tags. Please try refreshing the page.'
            }));
          }
        } else {
          setError(t('contactDetailsView.errors.unexpected', {
            defaultValue: 'An unexpected error occurred. Please try again.'
          }));
        }
      }
    };
    fetchData();
  }, [contact.contact_name_id, contact.tenant, userId, t]);

  // Update documents when initialDocuments changes
  useEffect(() => {
    setDocuments(initialDocuments);
  }, [initialDocuments]);
  
  const router = useRouter();

  // Function to refresh documents when new ones are created
  const handleDocumentCreated = useCallback(async () => {
    if (onDocumentCreated) {
      await onDocumentCreated();
    } else {
      router.refresh();
    }
  }, [onDocumentCreated, router]);

  const formatDateForDisplay = (dateString: string | null | undefined): string => {
    if (!dateString) return t('contactDetailsView.empty.notSet', { defaultValue: 'Not set' });
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  const getPhoneTypeLabel = (phone: IContact['phone_numbers'][number]): string => {
    if (phone.custom_type) {
      return phone.custom_type;
    }

    if (phone.canonical_type) {
      return t(`contactDetailsView.phoneTypes.${phone.canonical_type}`, {
        defaultValue: phone.canonical_type.charAt(0).toUpperCase() + phone.canonical_type.slice(1)
      });
    }

    return t('contactDetailsView.phoneTypes.other', { defaultValue: 'Other' });
  };

  const handleEditContact = () => {
    openDrawer(
      <ContactDetailsEdit
        id={`${id}-edit`}
        initialContact={contact}
        clients={clients}
        isInDrawer={true}
        onSave={(updatedContact) => {
          setContact(updatedContact);
          openDrawer(
            <ContactDetailsView 
              id={id}
              initialContact={updatedContact} 
              clients={clients}
              isInDrawer={true}
              userId={userId}
              documents={documents}
              onDocumentCreated={onDocumentCreated}
            />
          );
        }}
        onCancel={() => openDrawer(
          <ContactDetailsView 
            id={id}
            initialContact={contact} 
            clients={clients}
            isInDrawer={true}
            userId={userId}
            documents={documents}
            onDocumentCreated={onDocumentCreated}
          />
        )}
      />
    );
  };


  const getClientName = (clientId: string) => {
    const client = clients.find(c => c.client_id === clientId);
    return client ? client.client_name : t('contactDetailsView.empty.unknownClient', { defaultValue: 'Unknown Client' });
  };

  const handleClientClick = async () => {
    if (contact.client_id) {
      if (clientDrawer) {
        clientDrawer.openClientDrawer(contact.client_id);
        return;
      }
      try {
        setError(null);
        const client = await getClientById(contact.client_id);
        if (client) {
          openDrawer(
            <ClientDetails
              id={`${id}-client-details`}
              client={client}
              documents={[]}
              contacts={[]}
              isInDrawer={true}
              quickView={true}
            />
          );
        } else {
          setError(t('contactDetailsView.errors.clientNotFound', {
            defaultValue: 'Client not found. The client may have been deleted.'
          }));
        }
      } catch (err) {
        console.error('Error fetching client details:', err);
        if (err instanceof Error) {
          if (err.message.includes('SYSTEM_ERROR:')) {
            setError(t('contactDetailsView.errors.loadClientSystem', {
              defaultValue: 'An unexpected error occurred while loading client details. Please try again or contact support.'
            }));
          } else if (err.message.includes('FOREIGN_KEY_ERROR:')) {
            setError(t('contactDetailsView.errors.clientMissing', {
              defaultValue: 'The client no longer exists in the system.'
            }));
          } else {
            setError(t('contactDetailsView.errors.loadClientFailed', {
              defaultValue: 'Failed to load client details. Please try again.'
            }));
          }
        } else {
          setError(t('contactDetailsView.errors.unexpected', {
            defaultValue: 'An unexpected error occurred. Please try again.'
          }));
        }
      }
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

  const handleClientChange = async (clientId: string | null) => {
    try {
      setError(null);
      setSelectedClientId(clientId);
      
      const updatedContact = await updateContact({
        ...contact,
        client_id: clientId || ''
      });
      
      setContact(updatedContact);
      setIsEditingClient(false);
    } catch (err) {
      console.error('Error updating client:', err);
      if (err instanceof Error) {
        setError(t('contactDetailsView.errors.updateClientFailedWithMessage', {
          defaultValue: 'Failed to update client: {{message}}',
          message: err.message
        }));
      } else {
        setError(t('contactDetailsView.errors.updateClientFailed', {
          defaultValue: 'Failed to update client. Please try again.'
        }));
      }
      // Revert the selection on error
      setSelectedClientId(contact.client_id || null);
    }
  };
  
  return (
    <ReflectionContainer
      id={id}
      label={t('contactDetailsView.title', {
        defaultValue: 'Contact Details - {{name}}',
        name: contact.full_name
      })}
    >
      <div className="p-6 bg-white shadow rounded-lg">
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center">
              {/* Contact Avatar */}
              {userId && (
                <div className="mr-4">
                  <ContactAvatar
                    contactId={contact.contact_name_id}
                    contactName={contact.full_name}
                    avatarUrl={avatarUrl}
                    size="lg"
                  />
                </div>
              )}
              <Heading size="6">{contact.full_name}</Heading>
            </div>
            <div className="flex items-center space-x-2">
              {(!quickView || isInDrawer) && (
                <Button
                  id={`${id}-back-button`}
                  onClick={goBack}
                  variant="ghost"
                  size="sm"
                  className="flex items-center"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t('common.actions.back', { defaultValue: 'Back' })}
                </Button>
              )}
              {isInDrawer && (
                <Button
                  id={`${id}-go-to-contact-button`}
                  onClick={() => window.open(`/msp/contacts/${contact.contact_name_id}`, '_blank')}
                  variant="soft"
                  size="sm"
                  className="flex items-center"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {t('contactDetailsView.actions.goToContact', { defaultValue: 'Go to contact' })}
                </Button>
              )}
              {!isInDrawer && (
                <Button
                  id={`${id}-edit-button`}
                  variant="soft"
                  size="sm"
                  onClick={handleEditContact}
                  className="flex items-center"
                >
                  <Pen className="h-4 w-4 mr-2" />
                  {t('common.actions.edit', { defaultValue: 'Edit' })}
                </Button>
              )}
            </div>
          </div>
        </div>
        <table className="min-w-full">
          <tbody>
            <TableRow label={t('contactDetailsView.fields.fullName', { defaultValue: 'Full Name' })} value={contact.full_name} />
            <TableRow label={t('contactDetailsView.fields.email', { defaultValue: 'Email' })} value={contact.email ?? t('common.states.na', { defaultValue: 'N/A' })} />
            <tr>
              <td className="py-2 font-semibold align-top">{t('contactDetailsView.fields.phone', { defaultValue: 'Phone:' })}</td>
              <td className="py-2">
                {contact.phone_numbers.length === 0 ? (
                  t('common.states.na', { defaultValue: 'N/A' })
                ) : (
                  <div className="space-y-2">
                    {contact.phone_numbers.map((phone) => (
                      <div key={phone.contact_phone_number_id} className="rounded-md border border-gray-200 px-3 py-2">
                        <div className="text-sm font-medium text-gray-900">{phone.phone_number}</div>
                        <div className="text-xs text-gray-500">
                          {getPhoneTypeLabel(phone)}
                          {phone.is_default ? ` • ${t('contactDetailsView.fields.defaultPhone', { defaultValue: 'Default' })}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </td>
            </tr>
            <tr>
              <td className="py-2 font-semibold">{t('contactDetailsView.fields.client', { defaultValue: 'Client:' })}</td>
              <td className="py-2">
                {isEditingClient ? (
                  <div className="flex-1">
                    <ClientPicker
                      id="contact-client-picker"
                      clients={clients}
                      onSelect={handleClientChange}
                      selectedClientId={selectedClientId}
                      filterState={filterState}
                      onFilterStateChange={setFilterState}
                      clientTypeFilter={clientTypeFilter}
                      onClientTypeFilterChange={setClientTypeFilter}
                      fitContent={false}
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {contact.client_id ? (
                      <button
                        onClick={handleClientClick}
                        className="text-blue-600 hover:underline focus:outline-none"
                      >
                        {getClientName(contact.client_id)}
                      </button>
                    ) : (
                      <span className="text-gray-500 italic">{t('contactDetailsView.fields.noClientAssigned', { defaultValue: 'No client assigned' })}</span>
                    )}
                    {!clientReadOnly && (
                      <Button
                        id="edit-client-btn"
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsEditingClient(true)}
                        className="p-1 ml-2"
                      >
                        <Pen className="h-3 w-3 text-gray-600" />
                      </Button>
                    )}
                  </div>
                )}
              </td>
            </tr>
            <TableRow label={t('contactDetailsView.fields.role', { defaultValue: 'Role' })} value={contact.role || t('contactDetailsView.empty.notSet', { defaultValue: 'Not set' })} />
            <TableRow label={t('contactDetailsView.fields.status', { defaultValue: 'Status' })} value={contact.is_inactive ? t('contactDetailsView.status.inactive', { defaultValue: 'Inactive' }) : t('contactDetailsView.status.active', { defaultValue: 'Active' })} />
            <TableRow label={t('contactDetailsView.fields.createdAt', { defaultValue: 'Created At' })} value={new Date(contact.created_at).toLocaleString()} />
            <TableRow label={t('contactDetailsView.fields.updatedAt', { defaultValue: 'Updated At' })} value={new Date(contact.updated_at).toLocaleString()} />
            {contact.notes && (
              <tr>
                <td className="py-2 font-semibold align-top">{t('contactDetailsView.fields.notes', { defaultValue: 'Notes:' })}</td>
                <td className="py-2 whitespace-pre-wrap">{contact.notes}</td>
              </tr>
            )}
            <tr>
              <td className="py-2 font-semibold">{t('contactDetailsView.fields.tags', { defaultValue: 'Tags:' })}</td>
              <td className="py-2">
                <TagManager
                  id={`${id}-tags`}
                  entityId={contact.contact_name_id}
                  entityType="contact"
                  initialTags={contact.tags || []}
                  useInlineInput={isInDrawer}
                />
              </td>
            </tr>
          </tbody>
        </table>

        {showDocuments && userId && (
          <div className="mt-6">
            <Heading size="4" className="mb-4">{t('contactDetailsView.sections.documents', { defaultValue: 'Documents' })}</Heading>
            {renderDocuments({
              id: `${id}-documents`,
              documents,
              userId,
              entityId: contact.contact_name_id,
              entityType: 'contact',
              onDocumentCreated: handleDocumentCreated,
              isInDrawer,
            })}
          </div>
        )}

        {showInteractions && (
          <div className="mt-6">
            <InteractionsFeed 
              id={`${id}-interactions`}
              entityId={contact.contact_name_id} 
              entityType="contact"
              clientId={contact.client_id!}
              interactions={interactions}
              setInteractions={setInteractions}
            />
          </div>
        )}
      </div>
    </ReflectionContainer>
  );
};

export default ContactDetailsView;

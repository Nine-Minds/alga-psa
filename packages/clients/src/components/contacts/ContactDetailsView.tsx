'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { IContact } from '@alga-psa/types';
import { Flex, Text, Heading } from '@radix-ui/themes';
import { QuickAddInteraction } from '../interactions/QuickAddInteraction';
import { Button } from '@alga-psa/ui/components/Button';
import { Pen, Plus, ArrowLeft, ExternalLink } from 'lucide-react';
import { useDrawer } from '@alga-psa/ui';
import ContactDetailsEdit from './ContactDetailsEdit';
import { ITag } from '@alga-psa/types';
import type { IClient } from '@alga-psa/types';
import ClientDetails from '../clients/ClientDetails';
import InteractionsFeed from '../interactions/InteractionsFeed';
import { IInteraction } from '@alga-psa/types';
import { TagManager } from '@alga-psa/ui/components';
import { getClientById } from '@alga-psa/clients/actions';
import { updateContact } from '@alga-psa/clients/actions';
import Documents from '@alga-psa/documents/components/Documents';
import type { IDocument } from '@alga-psa/types';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { ButtonComponent, ContainerComponent } from '@alga-psa/ui/ui-reflection/types';
import ContactAvatar from '@alga-psa/ui/components/ContactAvatar';
import { getContactAvatarUrlActionAsync } from '../../lib/usersHelpers';
import { ClientPicker } from '../clients/ClientPicker';

interface ContactDetailsViewProps {
  id?: string; // Made optional to maintain backward compatibility
  initialContact: IContact;
  clients: IClient[];
  isInDrawer?: boolean;
  userId?: string;
  documents?: IDocument[];
  onDocumentCreated?: () => Promise<void>;
  quickView?: boolean;
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
  documents: initialDocuments = [],
  onDocumentCreated,
  quickView = false,
  clientReadOnly = false
}) => {
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
            setError('An unexpected error occurred while loading tags. Please try again or contact support.');
          } else {
            setError('Failed to load tags. Please try refreshing the page.');
          }
        } else {
          setError('An unexpected error occurred. Please try again.');
        }
      }
    };
    fetchData();
  }, [contact.contact_name_id, contact.tenant, userId]);

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
    if (!dateString) return 'Not set';
    const date = new Date(dateString);
    return date.toLocaleDateString();
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
    return client ? client.client_name : 'Unknown Client';
  };

  const handleClientClick = async () => {
    if (contact.client_id) {
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
          setError('Client not found. The client may have been deleted.');
        }
      } catch (err) {
        console.error('Error fetching client details:', err);
        if (err instanceof Error) {
          if (err.message.includes('SYSTEM_ERROR:')) {
            setError('An unexpected error occurred while loading client details. Please try again or contact support.');
          } else if (err.message.includes('FOREIGN_KEY_ERROR:')) {
            setError('The client no longer exists in the system.');
          } else {
            setError('Failed to load client details. Please try again.');
          }
        } else {
          setError('An unexpected error occurred. Please try again.');
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
        setError(`Failed to update client: ${err.message}`);
      } else {
        setError('Failed to update client. Please try again.');
      }
      // Revert the selection on error
      setSelectedClientId(contact.client_id || null);
    }
  };
  
  return (
    <ReflectionContainer id={id} label={`Contact Details - ${contact.full_name}`}>
      <div className="p-6 bg-white shadow rounded-lg">
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-red-800">{error}</p>
          </div>
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
              {!quickView && (
                <Button
                  id={`${id}-back-button`}
                  onClick={goBack}
                  variant="ghost"
                  size="sm"
                  className="flex items-center"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
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
                  Go to contact
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
                  Edit
                </Button>
              )}
            </div>
          </div>
        </div>
        <table className="min-w-full">
          <tbody>
            <TableRow label="Full Name" value={contact.full_name} />
            <TableRow label="Email" value={contact.email} />
            <TableRow label="Phone" value={contact.phone_number || 'N/A'} />
            <tr>
              <td className="py-2 font-semibold">Client:</td>
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
                      <span className="text-gray-500 italic">No client assigned</span>
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
            <TableRow label="Role" value={contact.role || 'Not set'} />
            <TableRow label="Status" value={contact.is_inactive ? 'Inactive' : 'Active'} />
            <TableRow label="Created At" value={new Date(contact.created_at).toLocaleString()} />
            <TableRow label="Updated At" value={new Date(contact.updated_at).toLocaleString()} />
            {contact.notes && (
              <tr>
                <td className="py-2 font-semibold align-top">Notes:</td>
                <td className="py-2 whitespace-pre-wrap">{contact.notes}</td>
              </tr>
            )}
            <tr>
              <td className="py-2 font-semibold">Tags:</td>
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

        {!quickView && userId && (
          <div className="mt-6">
            <Heading size="4" className="mb-4">Documents</Heading>
            <Documents
              id={`${id}-documents`}
              documents={documents}
              userId={userId}
              entityId={contact.contact_name_id}
              entityType="contact"
              onDocumentCreated={handleDocumentCreated}
              isInDrawer={isInDrawer}
            />
          </div>
        )}

        {!quickView && (
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

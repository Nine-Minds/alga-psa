'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DocumentAssociationEntityType, IClient, IContact } from '@alga-psa/types';
import SearchableSelect, { type SelectOption as SearchableSelectOption } from '@alga-psa/ui/components/SearchableSelect';
import AsyncSearchableSelect, { type SelectOption as AsyncSelectOption } from '@alga-psa/ui/components/AsyncSearchableSelect';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getDocumentAssociationClientsForPicker,
  getDocumentAssociationContactsForPicker,
  searchDocumentAssociationEntities,
} from '../actions/documentActions';

export type PickerAssociationEntityType = Extract<
  DocumentAssociationEntityType,
  'client' | 'contact' | 'ticket' | 'asset' | 'project_task' | 'contract' | 'quote'
>;

interface AssociatedEntityPickerProps {
  id: string;
  entityType: string;
  entityId?: string;
  selectedEntityLabel?: string;
  onEntityTypeChange: (entityType: string) => void;
  onEntityChange: (entityId: string, entityLabel?: string) => void;
  entityTypeOptions?: Array<{ value: string; label: string | ReactNode }>;
  allowedEntityTypes?: string[];
  noEntityTypeValue?: string;
  noEntityTypeLabel?: string;
  entityTypeLabel?: string;
  entityLabel?: string;
  disabled?: boolean;
}

const SEARCHABLE_ENTITY_TYPES = new Set<string>([
  'client',
  'contact',
  'ticket',
  'asset',
  'project_task',
  'contract',
  'quote',
]);

const DEFAULT_ENTITY_TYPES: PickerAssociationEntityType[] = [
  'client',
  'contact',
  'ticket',
  'asset',
  'project_task',
  'contract',
  'quote',
];

function formatEntityTypeLabel(entityType: string): string {
  return entityType
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

export default function AssociatedEntityPicker({
  id,
  entityType,
  entityId,
  selectedEntityLabel,
  onEntityTypeChange,
  onEntityChange,
  entityTypeOptions,
  allowedEntityTypes,
  noEntityTypeValue = '',
  noEntityTypeLabel,
  entityTypeLabel,
  entityLabel: entityPickerLabel,
  disabled = false,
}: AssociatedEntityPickerProps): React.JSX.Element {
  const { t } = useTranslation('common');
  const [clients, setClients] = useState<IClient[]>([]);
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const allowedSet = useMemo(() => allowedEntityTypes ? new Set<string>(allowedEntityTypes) : null, [allowedEntityTypes]);
  const selectedEntityType = !allowedSet || allowedSet.has(entityType) ? entityType : '';
  const selectedSearchableEntityType = SEARCHABLE_ENTITY_TYPES.has(selectedEntityType)
    ? selectedEntityType as PickerAssociationEntityType
    : undefined;
  const emptyTypeLabel = noEntityTypeLabel ?? t('documents.associatedEntityPicker.allEntities', 'All Entities');
  const typeLabel = entityTypeLabel ?? t('documents.associatedEntityPicker.typeLabel', 'Associated Entity Type');
  const selectedEntityTypeLabel = selectedEntityType ? formatEntityTypeLabel(selectedEntityType) : '';

  const typeOptions = useMemo<SearchableSelectOption[]>(() => {
    const sourceOptions = entityTypeOptions?.length
      ? entityTypeOptions
      : DEFAULT_ENTITY_TYPES.map((value) => ({ value, label: formatEntityTypeLabel(value) }));

    const normalizedOptions = sourceOptions
      .map((option) => ({
        label: typeof option.label === 'string' ? option.label : formatEntityTypeLabel(option.value),
        value: option.value === 'all_entities' ? noEntityTypeValue : option.value,
      }))
      .filter((option) => option.value === noEntityTypeValue || !allowedSet || allowedSet.has(option.value));

    const hasEmptyOption = normalizedOptions.some((option) => option.value === noEntityTypeValue);
    return hasEmptyOption
      ? normalizedOptions
      : [{ value: noEntityTypeValue, label: emptyTypeLabel }, ...normalizedOptions];
  }, [allowedEntityTypes, allowedSet, emptyTypeLabel, entityTypeOptions, noEntityTypeValue]);

  const loadOptions = useCallback(async ({ search, page, limit }: { search: string; page: number; limit: number }) => {
    if (!selectedSearchableEntityType) {
      return { options: [], total: 0 };
    }

    return searchDocumentAssociationEntities(selectedSearchableEntityType, search, page, limit);
  }, [selectedSearchableEntityType]);

  useEffect(() => {
    if (selectedEntityType !== 'client') {
      return;
    }

    let cancelled = false;
    setClientsLoading(true);
    getDocumentAssociationClientsForPicker()
      .then((rows) => {
        if (!cancelled) {
          setClients(rows);
        }
      })
      .catch((error) => {
        console.error('[AssociatedEntityPicker] Failed to load clients:', error);
        if (!cancelled) {
          setClients([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setClientsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedEntityType]);

  useEffect(() => {
    if (selectedEntityType !== 'contact') {
      return;
    }

    let cancelled = false;
    setContactsLoading(true);
    getDocumentAssociationContactsForPicker()
      .then((rows) => {
        if (!cancelled) {
          setContacts(rows);
        }
      })
      .catch((error) => {
        console.error('[AssociatedEntityPicker] Failed to load contacts:', error);
        if (!cancelled) {
          setContacts([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setContactsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedEntityType]);

  const handleTypeChange = useCallback((value: string) => {
    onEntityChange('', undefined);
    onEntityTypeChange(value === noEntityTypeValue ? '' : value);
  }, [noEntityTypeValue, onEntityChange, onEntityTypeChange]);

  const handleEntityChange = useCallback((value: string, option?: AsyncSelectOption) => {
    onEntityChange(value, option?.label);
  }, [onEntityChange]);

  return (
    <div className="space-y-3">
      <SearchableSelect
        id={`${id}-entity-type`}
        label={typeLabel}
        options={typeOptions}
        value={selectedEntityType || noEntityTypeValue}
        onChange={handleTypeChange}
        placeholder={t('documents.associatedEntityPicker.typePlaceholder', 'Select entity type')}
        searchPlaceholder={t('documents.associatedEntityPicker.typeSearchPlaceholder', 'Search entity types...')}
        emptyMessage={t('documents.associatedEntityPicker.noEntityTypes', 'No entity types found')}
        dropdownMode="overlay"
        disabled={disabled}
        className="w-full"
      />

      {selectedSearchableEntityType && (
        selectedSearchableEntityType === 'client' ? (
          <div>
            <label className="block text-sm font-medium text-[rgb(var(--color-text-600))] mb-1">
              {entityPickerLabel ?? t('documents.associatedEntityPicker.entityLabel', {
                entityType: selectedEntityTypeLabel,
                defaultValue: selectedEntityTypeLabel,
              })}
            </label>
            <ClientPicker
              id={`${id}-entity`}
              clients={clients}
              selectedClientId={entityId || null}
              onSelect={(clientId) => {
                const selectedClient = clients.find((client) => client.client_id === clientId);
                onEntityChange(clientId ?? '', selectedClient?.client_name);
              }}
              filterState={clientFilterState}
              onFilterStateChange={setClientFilterState}
              clientTypeFilter={clientTypeFilter}
              onClientTypeFilterChange={setClientTypeFilter}
              placeholder={clientsLoading
                ? t('documents.associatedEntityPicker.loadingClients', 'Loading clients...')
                : t('documents.associatedEntityPicker.entityPlaceholder', {
                    entityType: selectedEntityTypeLabel.toLowerCase(),
                    defaultValue: `Select ${selectedEntityTypeLabel.toLowerCase()}`,
                  })}
              disabled={disabled || clientsLoading}
              className="w-full"
            />
          </div>
        ) : selectedSearchableEntityType === 'contact' ? (
          <div>
            <label className="block text-sm font-medium text-[rgb(var(--color-text-600))] mb-1">
              {entityPickerLabel ?? t('documents.associatedEntityPicker.entityLabel', {
                entityType: selectedEntityTypeLabel,
                defaultValue: selectedEntityTypeLabel,
              })}
            </label>
            <ContactPicker
              id={`${id}-entity`}
              contacts={contacts}
              value={entityId || ''}
              onValueChange={(contactId) => {
                const selectedContact = contacts.find((contact) => contact.contact_name_id === contactId);
                onEntityChange(contactId, selectedContact?.full_name);
              }}
              placeholder={contactsLoading
                ? t('documents.associatedEntityPicker.loadingContacts', 'Loading contacts...')
                : t('documents.associatedEntityPicker.entityPlaceholder', {
                    entityType: selectedEntityTypeLabel.toLowerCase(),
                    defaultValue: `Select ${selectedEntityTypeLabel.toLowerCase()}`,
                  })}
              disabled={disabled || contactsLoading}
              buttonWidth="full"
            />
          </div>
        ) : (
          <AsyncSearchableSelect
            id={`${id}-entity`}
            label={entityPickerLabel ?? t('documents.associatedEntityPicker.entityLabel', {
              entityType: selectedEntityTypeLabel,
              defaultValue: selectedEntityTypeLabel,
            })}
            value={entityId || ''}
            selectedLabel={selectedEntityLabel}
            onChange={handleEntityChange}
            loadOptions={loadOptions}
            placeholder={t('documents.associatedEntityPicker.entityPlaceholder', {
              entityType: selectedEntityTypeLabel.toLowerCase(),
              defaultValue: `Select ${selectedEntityTypeLabel.toLowerCase()}`,
            })}
            searchPlaceholder={t('documents.associatedEntityPicker.entitySearchPlaceholder', {
              entityType: selectedEntityTypeLabel.toLowerCase(),
              defaultValue: `Search ${selectedEntityTypeLabel.toLowerCase()}...`,
            })}
            emptyMessage={t('documents.associatedEntityPicker.noEntities', {
              entityType: selectedEntityTypeLabel.toLowerCase(),
              defaultValue: `No ${selectedEntityTypeLabel.toLowerCase()} found`,
            })}
            dropdownMode="overlay"
            disabled={disabled}
            className="w-full"
          />
        )
      )}
    </div>
  );
}

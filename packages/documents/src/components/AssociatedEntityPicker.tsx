'use client';

import { useCallback, useMemo, type ReactNode } from 'react';
import type { DocumentAssociationEntityType } from '@alga-psa/types';
import SearchableSelect, { type SelectOption as SearchableSelectOption } from '@alga-psa/ui/components/SearchableSelect';
import AsyncSearchableSelect, { type SelectOption as AsyncSelectOption } from '@alga-psa/ui/components/AsyncSearchableSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { searchDocumentAssociationEntities } from '../actions/documentActions';

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
      )}
    </div>
  );
}

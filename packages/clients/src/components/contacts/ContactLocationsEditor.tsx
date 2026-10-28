'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ContactLocationInput,
  ContactWorkArrangement,
  IContactLocation,
} from '@alga-psa/types';
import { CONTACT_WORK_ARRANGEMENTS } from '@alga-psa/types';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Text } from '@radix-ui/themes';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getClientLocations } from '../../actions/clientLocationActions';

/**
 * The one editor for a contact's locations, shared by the contact edit form, the bento edit drawer
 * and quick add. It owns no save: the parent holds `work_arrangement` and `locations` and sends them
 * with the rest of the contact, so the links land in the same transaction as the person.
 *
 * Locations belong to the client, so the editor is disabled with a hint until a client is chosen,
 * and the options are that client's *active* locations plus any inactive one the contact is still
 * linked to (marked) — dropping a link silently just because the site was deactivated would be the
 * data loss this whole feature is trying to avoid.
 */

export interface ContactLocationsEditorProps {
  id?: string;
  clientId: string | null | undefined;
  /** The contact's current links, used to keep an inactive linked location listed. */
  currentLocations?: IContactLocation[];
  workArrangement: ContactWorkArrangement | null | undefined;
  onWorkArrangementChange: (value: ContactWorkArrangement | null) => void;
  value: ContactLocationInput[];
  onChange: (value: ContactLocationInput[]) => void;
  disabled?: boolean;
}

type Option = {
  location_id: string;
  location_name: string;
  is_active: boolean;
  is_default: boolean;
};

export function locationLabel(location: {
  location_name?: string | null;
  address_line1?: string | null;
  city?: string | null;
}): string {
  const name = location.location_name?.trim();
  if (name) return name;
  return [location.address_line1?.trim(), location.city?.trim()].filter(Boolean).join(', ') || '—';
}

/** At most one primary; a lone link is primary. Mirrors replaceContactLocations. */
export function normalizeContactLocationSelection(links: ContactLocationInput[]): ContactLocationInput[] {
  if (links.length === 1) return [{ location_id: links[0].location_id, is_primary: true }];
  const primary = links.find((link) => link.is_primary)?.location_id ?? null;
  return links.map((link) => ({ location_id: link.location_id, is_primary: link.location_id === primary }));
}

export function contactLocationSelectionError(links: ContactLocationInput[]): 'multiplePrimary' | null {
  return links.filter((link) => link.is_primary).length > 1 ? 'multiplePrimary' : null;
}

const ContactLocationsEditor: React.FC<ContactLocationsEditorProps> = ({
  id = 'contact-locations-editor',
  clientId,
  currentLocations = [],
  workArrangement,
  onWorkArrangementChange,
  value,
  onChange,
  disabled = false,
}) => {
  const { t } = useTranslation('msp/contacts');
  const [options, setOptions] = useState<Option[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!clientId) {
      setOptions([]);
      return;
    }
    setIsLoading(true);
    (async () => {
      try {
        const rows = await getClientLocations(clientId);
        if (cancelled) return;
        setOptions(Array.isArray(rows)
          ? rows.map((row) => ({
            location_id: row.location_id,
            location_name: locationLabel(row),
            is_active: row.is_active !== false,
            is_default: Boolean(row.is_default),
          }))
          : []);
      } catch (error) {
        if (!cancelled) {
          console.error('Error loading client locations for the contact editor:', error);
          setOptions([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // A linked location that has since been deactivated stays listed and marked, so saving the form
  // cannot quietly drop it.
  const allOptions = useMemo<Option[]>(() => {
    const byId = new Map(options.map((option) => [option.location_id, option]));
    for (const link of currentLocations) {
      if (byId.has(link.location_id)) continue;
      byId.set(link.location_id, {
        location_id: link.location_id,
        location_name: locationLabel(link),
        is_active: link.is_active !== false,
        is_default: false,
      });
    }
    return [...byId.values()].sort((left, right) => left.location_name.localeCompare(right.location_name));
  }, [options, currentLocations]);

  const selectedIds = useMemo(() => new Set(value.map((link) => link.location_id)), [value]);
  const primaryId = value.find((link) => link.is_primary)?.location_id ?? null;

  const toggle = useCallback((locationId: string, checked: boolean) => {
    const next = checked
      ? [...value, { location_id: locationId, is_primary: false }]
      : value.filter((link) => link.location_id !== locationId);
    onChange(normalizeContactLocationSelection(next));
  }, [value, onChange]);

  const setPrimary = useCallback((locationId: string) => {
    onChange(value.map((link) => ({ location_id: link.location_id, is_primary: link.location_id === locationId })));
  }, [value, onChange]);

  const arrangementOptions = useMemo(() => ([
    { value: 'unset', label: t('contactLocations.arrangement.unset', { defaultValue: 'Not set' }) },
    ...CONTACT_WORK_ARRANGEMENTS.map((arrangement) => ({
      value: arrangement,
      label: t(`contactLocations.arrangement.${arrangement}`, {
        defaultValue: arrangement === 'on_site' ? 'On site' : arrangement === 'hybrid' ? 'Hybrid' : 'Remote',
      }),
    })),
  ]), [t]);

  const isDisabled = disabled || !clientId;

  return (
    <div id={id} className="space-y-3">
      <div>
        <Text as="label" size="2" weight="medium" className="block mb-1">
          {t('contactLocations.workArrangement', { defaultValue: 'Work arrangement' })}
        </Text>
        <CustomSelect
          id={`${id}-work-arrangement`}
          value={workArrangement ?? 'unset'}
          onValueChange={(next) => onWorkArrangementChange(next === 'unset' ? null : (next as ContactWorkArrangement))}
          options={arrangementOptions}
          disabled={disabled}
        />
      </div>

      <div>
        <Text as="label" size="2" weight="medium" className="block mb-1">
          {t('contactLocations.locations', { defaultValue: 'Locations' })}
        </Text>
        {isDisabled ? (
          <Text size="1" className="text-gray-500 block" id={`${id}-no-client-hint`}>
            {t('contactLocations.chooseClientFirst', { defaultValue: 'Choose a client first to pick its locations.' })}
          </Text>
        ) : isLoading ? (
          <Text size="1" className="text-gray-500 block">
            {t('contactLocations.loading', { defaultValue: 'Loading locations…' })}
          </Text>
        ) : allOptions.length === 0 ? (
          <Text size="1" className="text-gray-500 block" id={`${id}-empty`}>
            {t('contactLocations.noneForClient', { defaultValue: 'This client has no locations yet.' })}
          </Text>
        ) : (
          <div className="space-y-1">
            {allOptions.map((option) => {
              const isSelected = selectedIds.has(option.location_id);
              return (
                <div key={option.location_id} className="flex items-center gap-2">
                  <Checkbox
                    id={`${id}-option-${option.location_id}`}
                    label={option.location_name}
                    checked={isSelected}
                    onChange={(event) => toggle(option.location_id, event.target.checked)}
                  />
                  {!option.is_active && (
                    <Text size="1" className="text-gray-500">
                      {t('contactLocations.inactiveMarker', { defaultValue: '(inactive)' })}
                    </Text>
                  )}
                  {isSelected && (
                    <label className="flex items-center gap-1 text-xs text-gray-600 ml-2">
                      <input
                        id={`${id}-primary-${option.location_id}`}
                        type="radio"
                        name={`${id}-primary`}
                        checked={primaryId === option.location_id}
                        onChange={() => setPrimary(option.location_id)}
                      />
                      {t('contactLocations.primary', { defaultValue: 'Primary' })}
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ContactLocationsEditor;

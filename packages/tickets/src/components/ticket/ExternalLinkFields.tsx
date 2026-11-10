'use client';

import React, { useMemo } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ExternalSystemDefinition } from '@alga-psa/types';
import { renderExternalLinkUrl } from '../../lib/externalSystems';
import type { ExternalSystemOption } from '../../actions/externalLinks/externalLinkActions';

/**
 * The identity fields of an external link (system, external id, realm, URL, title) with the
 * resolved-URL preview. Shared by the ticket "External links" dialog and the template editor's
 * "Documentation links" dialog so the two forms cannot drift.
 */

export interface ExternalLinkFieldsValue {
  system: string;
  externalId: string;
  realm: string;
  url: string;
  title: string;
}

export const EMPTY_EXTERNAL_LINK_FIELDS: ExternalLinkFieldsValue = {
  system: '',
  externalId: '',
  realm: '',
  url: '',
  title: '',
};

/** The URL a link would open: an explicit URL, else the system's template filled in. Null if neither resolves. */
export function resolveExternalLinkPreview(
  system: ExternalSystemOption | null | undefined,
  value: Pick<ExternalLinkFieldsValue, 'externalId' | 'realm' | 'url'>,
): string | null {
  if (!system) return null;
  return renderExternalLinkUrl(system as unknown as ExternalSystemDefinition, {
    external_id: value.externalId.trim(),
    realm: value.realm.trim() || null,
    url: value.url.trim() || null,
  });
}

interface ExternalLinkFieldsProps {
  id: string;
  systems: ExternalSystemOption[];
  systemsLoading?: boolean;
  value: ExternalLinkFieldsValue;
  onChange: (patch: Partial<ExternalLinkFieldsValue>) => void;
  /** System, external id and realm are immutable once a link exists. */
  lockIdentity?: boolean;
  /** Show the optional title input (the ticket dialog and the template editor both do). */
  showTitle?: boolean;
  disabled?: boolean;
}

export function ExternalLinkFields({
  id,
  systems,
  systemsLoading = false,
  value,
  onChange,
  lockIdentity = false,
  showTitle = true,
  disabled = false,
}: ExternalLinkFieldsProps) {
  const { t } = useTranslation('features/tickets');

  const systemOptions = useMemo(() => {
    const optionFor = (system: ExternalSystemOption) => ({ value: system.key, label: system.label });
    const builtIns = systems.filter((system) => !system.isCustom).map(optionFor);
    const customs = systems.filter((system) => system.isCustom).map(optionFor);
    const options: { value: string; label: string; disabled?: boolean }[] = [];
    if (builtIns.length > 0) {
      options.push({
        value: '__group-builtin',
        label: t('externalLinks.fields.builtInGroup', 'Built-in systems'),
        disabled: true,
      });
      options.push(...builtIns);
    }
    if (customs.length > 0) {
      options.push({
        value: '__group-custom',
        label: t('externalLinks.fields.customGroup', 'Custom systems'),
        disabled: true,
      });
      options.push(...customs);
    }
    return options;
  }, [systems, t]);

  const selectedSystem = useMemo(
    () => systems.find((system) => system.key === value.system) ?? null,
    [systems, value.system],
  );

  // A realm input is shown when the definition names one, or when its template consumes `{realm}`
  // even though no human label was declared (custom systems). Otherwise a `custom:<slug>` template
  // with `{realm}` could never be completed here and would demand an explicit URL override.
  const realmField = useMemo(() => {
    if (!selectedSystem) return null;
    const needsRealm = selectedSystem.urlTemplate?.includes('{realm}') ?? false;
    if (!selectedSystem.realmLabel && !needsRealm) return null;
    return { label: selectedSystem.realmLabel ?? t('externalLinks.fields.realm', 'Realm') };
  }, [selectedSystem, t]);

  const previewHref = useMemo(
    () => resolveExternalLinkPreview(selectedSystem, value),
    [selectedSystem, value],
  );

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${id}-system`}>{t('externalLinks.fields.system', 'System')}</Label>
        <CustomSelect
          id={`${id}-system`}
          options={systemOptions}
          value={value.system}
          onValueChange={(next) => onChange({ system: next })}
          placeholder={
            systemsLoading
              ? t('externalLinks.fields.loadingSystems', 'Loading systems...')
              : t('externalLinks.fields.selectSystem', 'Select a system')
          }
          disabled={disabled || lockIdentity || systemsLoading}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${id}-external-id`}>{t('externalLinks.fields.externalId', 'External ID')}</Label>
        <Input
          id={`${id}-external-id`}
          value={value.externalId}
          onChange={(event) => onChange({ externalId: event.target.value })}
          disabled={disabled || lockIdentity}
          placeholder={t('externalLinks.fields.externalIdPlaceholder', 'e.g. 42 or 1234567890')}
        />
      </div>

      {realmField ? (
        <div className="space-y-2">
          <Label htmlFor={`${id}-realm`}>{realmField.label}</Label>
          <Input
            id={`${id}-realm`}
            value={value.realm}
            onChange={(event) => onChange({ realm: event.target.value })}
            disabled={disabled || lockIdentity}
          />
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor={`${id}-url`}>{t('externalLinks.fields.url', 'URL')}</Label>
        <Input
          id={`${id}-url`}
          type="url"
          value={value.url}
          onChange={(event) => onChange({ url: event.target.value })}
          disabled={disabled}
          placeholder={
            selectedSystem?.urlTemplate
              ? t('externalLinks.fields.urlOptional', 'Optional override')
              : t('externalLinks.fields.urlRequired', 'https://...')
          }
        />
        {previewHref ? (
          <p className="break-all text-xs text-[rgb(var(--color-text-500))]">
            {t('externalLinks.fields.urlPreview', 'Opens:')}{' '}
            <span className="text-[rgb(var(--color-text-600))]">{previewHref}</span>
          </p>
        ) : selectedSystem?.urlTemplate ? (
          <p className="text-xs text-[rgb(var(--color-text-500))]">
            {t('externalLinks.fields.urlPreviewIncomplete', 'Fill in the fields above to preview the link.')}
          </p>
        ) : null}
      </div>

      {showTitle ? (
        <div className="space-y-2">
          <Label htmlFor={`${id}-title`}>{t('externalLinks.fields.title', 'Title')}</Label>
          <Input
            id={`${id}-title`}
            value={value.title}
            maxLength={500}
            onChange={(event) => onChange({ title: event.target.value })}
            disabled={disabled}
            placeholder={t('externalLinks.fields.titlePlaceholder', 'Optional, e.g. the article name')}
          />
        </div>
      ) : null}
    </>
  );
}

export default ExternalLinkFields;

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { useQuickAddClient } from '@alga-psa/ui/context/QuickAddClientContext';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IContact } from '@alga-psa/types';
import type { CoManagedSeatContactChoice } from '@alga-psa/co-managed';
import { getCoManagedSeatContactChoicesAction } from '@/lib/actions/coManagedSeatActions';

/**
 * Picks a seat technician from the arrangement's client's contacts, and offers the standard quick-add
 * contact dialog (client preset) for someone who is not a contact yet. Which contacts can be invited
 * comes from the server (`getCoManagedSeatContactChoicesAction`); contacts that cannot are left out of
 * the picker and counted below it. A contact created through quick-add is selected as soon as the
 * server confirms it is eligible. There is no free-text path.
 *
 * `version` changes when the seats do (an invitation was sent or withdrawn), so the list is read again.
 */
export default function CoManagedSeatContactField({ clientId, idPrefix, value, onChange, disabled, version = 0 }: {
  clientId: string;
  idPrefix: string;
  value: string;
  onChange: (contactId: string) => void;
  disabled?: boolean;
  version?: number;
}) {
  const { t } = useTranslation('msp/licensing');
  const { renderQuickAddContact } = useQuickAddClient();
  const [choices, setChoices] = useState<CoManagedSeatContactChoice[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getCoManagedSeatContactChoicesAction(clientId);
      setChoices(next); setLoadFailed(false);
      return next;
    } catch { setLoadFailed(true); return null; }
  }, [clientId]);

  useEffect(() => { void load(); }, [load, version]);

  // A selection the server no longer offers (the contact took a seat meanwhile) is dropped.
  useEffect(() => {
    if (choices && value && !choices.some((choice) => choice.contactId === value && !choice.blocker)) onChange('');
  }, [choices, value, onChange]);

  const eligible = useMemo(() => (choices ?? []).filter((choice) => !choice.blocker), [choices]);
  const blockedCount = (choices?.length ?? 0) - eligible.length;
  const contacts = useMemo(() => eligible.map((choice) => ({
    contact_name_id: choice.contactId, full_name: choice.name, email: choice.email, client_id: clientId,
    is_inactive: false, tenant: '', phone_numbers: [], role: null, notes: null, created_at: '', updated_at: '',
  }) as IContact), [eligible, clientId]);

  const onContactAdded = async (contact: IContact) => {
    setAdding(false);
    const next = await load();
    const added = next?.find((choice) => choice.contactId === contact.contact_name_id);
    if (!added) return;
    if (added.blocker) {
      setNotice(added.blocker === 'NO_EMAIL'
        ? t('coManaged.seat.contact.addedNoEmail', { defaultValue: '{{name}} was added but has no email address, so they cannot be invited yet.', name: added.name })
        : t('coManaged.seat.contact.addedUnavailable', { defaultValue: '{{name}} was added but cannot be invited.', name: added.name }));
      return;
    }
    setNotice(null);
    onChange(added.contactId);
  };

  return (
    <div className="space-y-2">
      <ContactPicker
        id={`${idPrefix}-technician-contact`}
        label={t('coManaged.seat.contact.label', { defaultValue: 'Technician' })}
        placeholder={t('coManaged.seat.contact.placeholder', { defaultValue: 'Choose a contact' })}
        contacts={contacts}
        clientId={clientId}
        value={value}
        onValueChange={(next) => { setNotice(null); onChange(next); }}
        disabled={disabled || choices === null}
        onAddNew={() => setAdding(true)}
        modal
      />
      {loadFailed && <p className="text-sm text-destructive" role="status">{t('coManaged.seat.error.load', { defaultValue: 'Could not load the choices. Refresh and try again.' })}</p>}
      {notice && <p id={`${idPrefix}-technician-contact-notice`} className="text-sm text-muted-foreground" role="status">{notice}</p>}
      {blockedCount > 0 && (
        <p id={`${idPrefix}-technician-contact-hint`} className="text-sm text-muted-foreground">
          {t('coManaged.seat.contact.unavailable', {
            defaultValue: 'Not listed because they are inactive, have no email address, or already hold a seat or invitation: {{count}}.',
            count: blockedCount,
          })}
        </p>
      )}
      {renderQuickAddContact({ isOpen: adding, onClose: () => setAdding(false), onContactAdded: (contact) => { void onContactAdded(contact); }, selectedClientId: clientId })}
    </div>
  );
}

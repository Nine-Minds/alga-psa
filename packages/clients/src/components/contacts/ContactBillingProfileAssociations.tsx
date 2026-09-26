'use client';

import React, { useEffect, useState } from 'react';
import { Label } from '@alga-psa/ui/components/Label';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { getContactBillingProfiles } from '../../actions/billingProfileContactActions';

/**
 * The billing profiles this contact belongs to, read-only.
 *
 * Deliberately not editable here. The membership and the ticket grant are
 * properties of the *profile* — "who is in the north plant segment" — and are
 * edited where the profile is, so that an MSP setting one up sees the whole
 * segment at once instead of visiting each contact in turn. This panel exists
 * because the answer is otherwise invisible from the contact record, which is
 * where someone asks "why can Dana see these tickets?".
 */

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

interface ContactBillingProfileAssociationsProps {
  contactNameId: string;
}

interface Association {
  billingProfileId: string;
  name: string;
  isManager: boolean;
  canViewProfileTickets: boolean;
}

export function ContactBillingProfileAssociations({
  contactNameId,
}: ContactBillingProfileAssociationsProps) {
  const { t } = useTranslation('msp/clients');
  const [associations, setAssociations] = useState<Association[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await getContactBillingProfiles({ contactNameId });
        if (cancelled || isReturnedActionError(result)) return;
        setAssociations(result);
      } catch {
        // A contact with no associations and a failed read look the same to the
        // user; neither is worth a toast on a read-only panel.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contactNameId]);

  // Nothing to say for the overwhelming majority of contacts.
  if (associations.length === 0) return null;

  return (
    <div className="p-3 rounded-lg border bg-gray-50">
      <Label className="text-sm font-medium">
        {t('contactBillingProfiles.label', { defaultValue: 'Billing profiles' })}
      </Label>
      <ul className="mt-2 space-y-1">
        {associations.map((association) => (
          <li key={association.billingProfileId} className="flex items-center gap-2 text-sm">
            <span>{association.name}</span>
            {association.isManager && (
              <Badge variant="secondary">
                {t('contactBillingProfiles.manager', { defaultValue: 'Manager' })}
              </Badge>
            )}
            {association.canViewProfileTickets && (
              <Badge variant="default">
                {t('contactBillingProfiles.seesTickets', { defaultValue: 'Sees profile tickets' })}
              </Badge>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        {t('contactBillingProfiles.editHint', {
          defaultValue: 'Edit these on the billing profile, under the client\'s billing settings.',
        })}
      </p>
    </div>
  );
}

export default ContactBillingProfileAssociations;

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  getBillingProfileContacts,
  setBillingProfileContacts,
  type BillingProfileContactsState,
} from '../../actions/billingProfileContactActions';

/**
 * Who belongs to a billing profile, who runs it, and who may read its tickets.
 *
 * The manager designation and the ticket grant are two separate checkboxes
 * because they answer two separate questions. Recording that Dana runs the
 * north plant is an organisational fact an MSP will want on file regardless;
 * letting Dana read her colleagues' tickets is a permission someone has to
 * decide to give. A single "manager" toggle that did both would force the MSP
 * to choose between an accurate record and a correct permission.
 */

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

interface BillingProfileContactsProps {
  billingProfileId: string;
}

interface Row {
  selected: boolean;
  isManager: boolean;
  canViewProfileTickets: boolean;
}

export function BillingProfileContacts({ billingProfileId }: BillingProfileContactsProps) {
  const { t } = useTranslation('msp/clients');
  const [state, setState] = useState<BillingProfileContactsState | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getBillingProfileContacts({ billingProfileId });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      setState(result);
      setRows(Object.fromEntries(result.candidates.map((candidate) => {
        const existing = result.contacts.find((contact) => contact.contactNameId === candidate.contactNameId);
        return [candidate.contactNameId, {
          selected: Boolean(existing),
          isManager: Boolean(existing?.isManager),
          canViewProfileTickets: Boolean(existing?.canViewProfileTickets),
        }];
      })));
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [billingProfileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (contactNameId: string, patch: Partial<Row>) => {
    setRows((current) => {
      const next = { ...current, [contactNameId]: { ...current[contactNameId], ...patch } };
      // Exactly one manager per profile is a database constraint, so the editor
      // moves the flag rather than letting the save fail.
      if (patch.isManager) {
        for (const key of Object.keys(next)) {
          if (key !== contactNameId) next[key] = { ...next[key], isManager: false };
        }
      }
      // A contact who is not in the profile cannot hold its flags.
      if (patch.selected === false) {
        next[contactNameId] = { selected: false, isManager: false, canViewProfileTickets: false };
      }
      return next;
    });
  };

  const save = async () => {
    setIsSaving(true);
    try {
      const result = await setBillingProfileContacts({
        billingProfileId,
        contacts: Object.entries(rows)
          .filter(([, row]) => row.selected)
          .map(([contactNameId, row]) => ({
            contactNameId,
            isManager: row.isManager,
            canViewProfileTickets: row.canViewProfileTickets,
          })),
      });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('billingProfileContacts.saved', { defaultValue: 'Profile contacts saved' }));
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <p className="text-sm text-gray-500">
        {t('billingProfileContacts.loading', { defaultValue: 'Loading profile contacts…' })}
      </p>
    );
  }

  if (!state || state.candidates.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        {t('billingProfileContacts.noContacts', { defaultValue: 'This client has no contacts yet.' })}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-medium">
          {t('billingProfileContacts.title', { defaultValue: 'Profile contacts' })}
        </h4>
        <p className="text-xs text-gray-500">
          {t('billingProfileContacts.description', {
            defaultValue:
              'The people who belong to this billing segment. Naming a manager records who runs it; the ticket checkbox is a separate grant that lets them see every ticket attributed to this profile in the client portal.',
          })}
        </p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="py-1">{t('billingProfileContacts.contact', { defaultValue: 'Contact' })}</th>
            <th className="w-24 py-1">{t('billingProfileContacts.inProfile', { defaultValue: 'In profile' })}</th>
            <th className="w-24 py-1">{t('billingProfileContacts.manager', { defaultValue: 'Manager' })}</th>
            <th className="w-40 py-1">
              {t('billingProfileContacts.seesTickets', { defaultValue: 'Sees profile tickets' })}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {state.candidates.map((candidate) => {
            const row = rows[candidate.contactNameId] ?? {
              selected: false,
              isManager: false,
              canViewProfileTickets: false,
            };
            return (
              <tr key={candidate.contactNameId}>
                <td className="py-1.5">
                  <span className="font-medium">{candidate.fullName}</span>
                  {candidate.email && <span className="ml-2 text-xs text-gray-500">{candidate.email}</span>}
                </td>
                <td>
                  <Checkbox
                    id={`profile-contact-${candidate.contactNameId}`}
                    checked={row.selected}
                    onChange={(event) => update(candidate.contactNameId, { selected: event.target.checked })}
                  />
                </td>
                <td>
                  <Checkbox
                    id={`profile-contact-manager-${candidate.contactNameId}`}
                    checked={row.isManager}
                    disabled={!row.selected}
                    onChange={(event) => update(candidate.contactNameId, { isManager: event.target.checked })}
                  />
                </td>
                <td>
                  <Checkbox
                    id={`profile-contact-tickets-${candidate.contactNameId}`}
                    checked={row.canViewProfileTickets}
                    disabled={!row.selected}
                    onChange={(event) =>
                      update(candidate.contactNameId, { canViewProfileTickets: event.target.checked })
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Button
        id="save-billing-profile-contacts"
        variant="secondary"
        disabled={isSaving}
        onClick={() => void save()}
      >
        {t('common.actions.save', { defaultValue: 'Save' })}
      </Button>
    </div>
  );
}

export default BillingProfileContacts;

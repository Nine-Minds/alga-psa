'use client';

import { useCallback, useEffect, useState } from 'react';
import type { IContact } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import { RMM_CONTACT_ASSIGNMENT_MODES } from '@alga-psa/shared/rmm/contactAssignmentModes';
import {
  listRmmSignedInUsers,
  mapRmmSignedInUserToContact,
} from '../../../actions/integrations/rmmUserMappingActions';

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

const DEFAULT_LABELS: Record<string, string> = {
  off: 'Off',
  suggest: 'Suggest',
  auto: 'Auto-assign',
};

/**
 * FR-D8: the per-organization People mode options, shared by the Tactical
 * mapping UI and the four EE mapping managers so the wording cannot drift.
 */
export function buildRmmPeopleModeOptions(t: TranslateFn): Array<{ value: string; label: string }> {
  return RMM_CONTACT_ASSIGNMENT_MODES.map((mode) => ({
    value: mode,
    label: t(`integrations.rmm.peopleMode.options.${mode}`, { defaultValue: DEFAULT_LABELS[mode] ?? mode }),
  }));
}


type SignedInUserRow = {
  rawUser: string;
  key: string;
  contactId: string | null;
  contactName: string | null;
  method: 'mapped' | 'email' | 'username' | 'name' | null;
  deviceCount: number;
  samples: string[];
};

/**
 * FR-D8: the shared Signed-in users panel, used by the Tactical mapping UI (CE)
 * and the four EE mapping managers.
 *
 * One row per distinct normalized signed-in user in the organization: how many
 * devices report it, which contact it currently resolves to and how, and a
 * picker that saves (or clears) an explicit mapping. `CORP\jdoe` and
 * `jdoe@acme.com` stay separate rows on purpose — they are different
 * identifiers and an MSP may want to map them to different people.
 */
export function RmmUserContactMappingPanel({
  mappingId,
  clientId,
  contacts,
  idPrefix = 'rmm-user-mapping',
}: {
  /** The organization mapping row; the action derives integration and provider. */
  mappingId: string;
  clientId: string | null;
  contacts: IContact[];
  idPrefix?: string;
}) {
  const { t } = useTranslation('msp/integrations');
  const [rows, setRows] = useState<SignedInUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!mappingId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listRmmSignedInUsers({ mappingId });
      if (!result.success) {
        setError(result.error ?? t('integrations.rmm.signedInUsers.loadFailed', { defaultValue: 'Unable to load signed-in users.' }));
        return;
      }
      setRows((result.users ?? []) as SignedInUserRow[]);
    } finally {
      setLoading(false);
    }
  }, [mappingId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (row: SignedInUserRow, contactId: string | null) => {
    setError(null);
    const result = await mapRmmSignedInUserToContact({
      mappingId,
      rawUser: row.rawUser,
      contactId,
    });
    if (!result.success) {
      setError(result.error ?? t('integrations.rmm.signedInUsers.saveFailed', { defaultValue: 'Unable to save the mapping.' }));
      return;
    }
    await load();
  };

  const methodLabel = (method: SignedInUserRow['method']): string => {
    if (!method) return t('integrations.rmm.signedInUsers.methods.none', { defaultValue: 'No match' });
    return t(`integrations.rmm.signedInUsers.methods.${method}`, { defaultValue: method });
  };

  const columns: ColumnDefinition<SignedInUserRow>[] = [
    {
      title: t('integrations.rmm.signedInUsers.columns.user', { defaultValue: 'Signed-in user' }),
      dataIndex: 'key',
      sortable: false,
      render: (_value, row) => (
        <span className="font-mono text-sm" title={row.samples.join(', ')}>{row.rawUser}</span>
      ),
    },
    {
      title: t('integrations.rmm.signedInUsers.columns.devices', { defaultValue: 'Devices' }),
      dataIndex: 'deviceCount',
      sortable: false,
      render: (value: number) => <span className="text-sm">{value}</span>,
    },
    {
      title: t('integrations.rmm.signedInUsers.columns.method', { defaultValue: 'Matched by' }),
      dataIndex: 'method',
      sortable: false,
      render: (_value, row) => <span className="text-sm">{methodLabel(row.method)}</span>,
    },
    {
      title: t('integrations.rmm.signedInUsers.columns.contact', { defaultValue: 'Contact' }),
      dataIndex: 'contactId',
      sortable: false,
      render: (_value, row) => (
        <ContactPicker
          id={`${idPrefix}-contact-${row.key.replace(/[^a-z0-9]+/gi, '-')}`}
          contacts={contacts}
          value={row.contactId ?? ''}
          onValueChange={(contactId) => void save(row, contactId || null)}
          clientId={clientId ?? undefined}
          disabled={!clientId}
          buttonWidth="fit"
          placeholder={t('integrations.rmm.signedInUsers.selectContact', { defaultValue: 'Select contact' })}
          className="min-w-[220px]"
        />
      ),
    },
  ];

  if (!clientId) {
    return (
      <p className="text-sm text-[rgb(var(--color-text-500))]">
        {t('integrations.rmm.signedInUsers.noClient', {
          defaultValue: 'Map this organization to a client before mapping its signed-in users.',
        })}
      </p>
    );
  }

  return (
    <div id={`${idPrefix}-panel`} className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">
            {t('integrations.rmm.signedInUsers.title', { defaultValue: 'Signed-in users' })}
          </h4>
          <p className="text-xs text-[rgb(var(--color-text-500))]">
            {t('integrations.rmm.signedInUsers.description', {
              defaultValue: 'The user names this organization’s devices report, and the contact each one resolves to.',
            })}
          </p>
        </div>
        <Button id={`${idPrefix}-refresh`} variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>
          {t('integrations.rmm.signedInUsers.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-[rgb(var(--color-text-500))]">
          {t('integrations.rmm.signedInUsers.empty', { defaultValue: 'No signed-in users reported yet.' })}
        </p>
      ) : (
        <DataTable id={`${idPrefix}-table`} data={rows} columns={columns} pagination={false} />
      )}
    </div>
  );
}

export default RmmUserContactMappingPanel;

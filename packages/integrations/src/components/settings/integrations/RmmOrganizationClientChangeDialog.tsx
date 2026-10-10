'use client';

import { useEffect, useState } from 'react';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { countRmmOrganizationAssets } from '../../../actions/integrations/rmmUserMappingActions';

/**
 * FR-G4: the confirmation an RMM mapping UI shows before re-pointing an
 * organization at another client.
 *
 * The count matters: clearing assignees, groups and billing profiles on 37
 * devices is not something to do blind, and the move is immediate rather than
 * drifting in on the next sync.
 */
export function RmmOrganizationClientChangeDialog({
  mappingId,
  pendingClientName,
  isOpen,
  onCancel,
  onConfirm,
  isConfirming,
}: {
  mappingId: string | null;
  pendingClientName: string | null;
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  isConfirming?: boolean;
}) {
  const { t } = useTranslation('msp/integrations');
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen || !mappingId) {
      setCount(null);
      return;
    }
    let mounted = true;
    void (async () => {
      const result = await countRmmOrganizationAssets({ mappingId });
      if (mounted) setCount(result.success ? result.count ?? 0 : 0);
    })();
    return () => {
      mounted = false;
    };
  }, [isOpen, mappingId]);

  return (
    <ConfirmationDialog
      id="rmm-org-client-change-dialog"
      isOpen={isOpen}
      onClose={onCancel}
      onConfirm={onConfirm}
      title={t('integrations.rmm.clientChange.title', { defaultValue: 'Move this organization\u2019s devices?' })}
      message={t('integrations.rmm.clientChange.message', {
        defaultValue: '{{count}} asset(s) will move to {{client}}. Assignees, groups and billing profiles that belong to the previous client will be cleared.',
        count: count ?? 0,
        client: pendingClientName ?? '',
      })}
      confirmLabel={t('integrations.rmm.clientChange.confirm', { defaultValue: 'Move devices' })}
      cancelLabel={t('common:actions.cancel', { defaultValue: 'Cancel' })}
      isConfirming={isConfirming}
    />
  );
}

export default RmmOrganizationClientChangeDialog;

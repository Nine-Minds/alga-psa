/**
 * CE Stub for Reduce Licenses Modal
 * In CE builds, '@ee/components/licensing/ReduceLicensesModal' resolves here
 */
'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ReduceLicensesModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLicenseCount: number;
  activeUserCount: number;
  onSuccess?: () => void;
}

export default function ReduceLicensesModal({
  isOpen,
  onClose,
}: ReduceLicensesModalProps) {
  const { t } = useTranslation('msp/licensing');
  const { t: tCommon } = useTranslation('common');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md">
        <h2 className="text-xl font-semibold mb-4">
          {t('reduceModal.title', { defaultValue: 'Reduce Licenses' })}
        </h2>
        <p className="text-muted-foreground mb-4">
          {t('reduceModal.enterpriseOnly', {
            defaultValue: 'This feature is only available in the Enterprise Edition.'
          })}
        </p>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90"
        >
          {tCommon('actions.close', { defaultValue: 'Close' })}
        </button>
      </div>
    </div>
  );
}

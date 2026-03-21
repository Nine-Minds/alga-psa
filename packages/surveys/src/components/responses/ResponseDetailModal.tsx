'use client';

import { useMemo } from 'react';

import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import type { SurveyResponseListItem } from '@alga-psa/types';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

type ResponseDetailModalProps = {
  response: SurveyResponseListItem | null;
  isOpen: boolean;
  onClose: () => void;
};

export default function ResponseDetailModal({
  response,
  isOpen,
  onClose,
}: ResponseDetailModalProps) {
  const { t } = useTranslation('msp/surveys');
  const { formatDate } = useFormatters();

  const metadata = useMemo(() => {
    if (!response) {
      return null;
    }

    return [
      {
        label: t('responses.detail.labels.submittedAt', { defaultValue: 'Submitted At' }),
        value: formatDate(response.submittedAt, { dateStyle: 'medium', timeStyle: 'short' }),
      },
      {
        label: t('responses.detail.labels.client', { defaultValue: 'Client' }),
        value: response.clientName ?? t('responses.detail.fallbacks.unknown', { defaultValue: 'Unknown' }),
      },
      {
        label: t('responses.detail.labels.contact', { defaultValue: 'Contact' }),
        value: response.contactName ?? t('responses.detail.fallbacks.none', { defaultValue: '-' }),
      },
      {
        label: t('responses.detail.labels.technician', { defaultValue: 'Technician' }),
        value: response.technicianName ?? t('responses.detail.fallbacks.unassigned', { defaultValue: 'Unassigned' }),
      },
      { label: t('responses.detail.labels.ticket', { defaultValue: 'Ticket' }), value: response.ticketNumber ?? response.ticketId },
      { label: t('responses.detail.labels.rating', { defaultValue: 'Rating' }), value: `${response.rating} ★` },
    ];
  }, [formatDate, response, t]);

  return (
    <Dialog
      id="survey-response-detail-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={t('responses.detail.title', { defaultValue: 'Survey Response Detail' })}
      className="max-w-xl"
      hideCloseButton={false}
    >
      <DialogContent className="space-y-4">
        {!response ? (
          <div className="text-sm text-muted-foreground">
            {t('responses.detail.empty', { defaultValue: 'No response selected.' })}
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {metadata?.map((item) => (
                <div key={item.label} className="flex text-sm">
                  <span className="w-32 font-medium text-gray-700">{item.label}</span>
                  <span className="text-gray-900">{item.value}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-muted p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('responses.detail.labels.comment', { defaultValue: 'Comment' })}
              </div>
              <p className="mt-2 text-sm text-gray-800">
                {response.comment?.trim()
                  ? response.comment
                  : t('responses.detail.fallbacks.noComment', { defaultValue: 'No comment provided.' })}
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useMemo } from 'react';

import { Dialog, DialogContent } from 'server/src/components/ui/Dialog';
import type { SurveyResponseListItem } from 'server/src/interfaces/survey.interface';

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
  const metadata = useMemo(() => {
    if (!response) {
      return null;
    }

    return [
      { label: 'Submitted At', value: new Date(response.submittedAt).toLocaleString() },
      { label: 'Client', value: response.clientName ?? 'Unknown' },
      { label: 'Contact', value: response.contactName ?? '—' },
      { label: 'Technician', value: response.technicianName ?? 'Unassigned' },
      { label: 'Ticket', value: response.ticketNumber ?? response.ticketId },
      { label: 'Rating', value: `${response.rating} ★` },
    ];
  }, [response]);

  return (
    <Dialog
      id="survey-response-detail-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title="Survey Response Detail"
      className="max-w-xl"
      hideCloseButton={false}
    >
      <DialogContent className="space-y-4">
        {!response ? (
          <div className="text-sm text-muted-foreground">No response selected.</div>
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
                Comment
              </div>
              <p className="mt-2 text-sm text-gray-800">
                {response.comment?.trim() ? response.comment : 'No comment provided.'}
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useState } from 'react';
import { ITimeSheet } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { TextArea } from '@alga-psa/ui/components/TextArea';

interface ApprovalActionsProps {
  timeSheet: ITimeSheet;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onRequestChanges: (changes: { entry_id: string; reason: string }[]) => void;
}

export function ApprovalActions({ timeSheet, onApprove, onReject, onRequestChanges }: ApprovalActionsProps) {
  const { t } = useTranslation('msp/time-entry');
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [isChangesDialogOpen, setIsChangesDialogOpen] = useState(false);
  const [changeRequests, setChangeRequests] = useState<{ entry_id: string; reason: string }[]>([]);

  const handleApprove = () => {
    onApprove();
  };

  const handleReject = () => {
    onReject(rejectReason);
    setIsRejectDialogOpen(false);
    setRejectReason('');
  };

  const handleRequestChanges = () => {
    onRequestChanges(changeRequests);
    setIsChangesDialogOpen(false);
    setChangeRequests([]);
  };

  const rejectFooter = (
    <div className="flex justify-end space-x-2">
      <Button id="cancel-reject-btn" onClick={() => setIsRejectDialogOpen(false)}>
        {t('common.actions.cancel', { defaultValue: 'Cancel' })}
      </Button>
      <Button id="confirm-reject-btn" onClick={handleReject}>
        {t('approvalActions.confirm.reject', { defaultValue: 'Confirm Reject' })}
      </Button>
    </div>
  );

  const changesFooter = (
    <div className="flex justify-end space-x-2">
      <Button id="cancel-changes-btn" onClick={() => setIsChangesDialogOpen(false)}>
        {t('common.actions.cancel', { defaultValue: 'Cancel' })}
      </Button>
      <Button id="confirm-changes-btn" onClick={handleRequestChanges}>
        {t('approvalActions.confirm.changes', { defaultValue: 'Confirm Changes' })}
      </Button>
    </div>
  );

  return (
    <div className="mb-4 flex space-x-2">
      <Button id="approve-timesheet-btn" onClick={handleApprove}>
        {t('common.actions.approve', { defaultValue: 'Approve' })}
      </Button>
      <Button id="reject-timesheet-btn" onClick={() => setIsRejectDialogOpen(true)}>
        {t('common.actions.reject', { defaultValue: 'Reject' })}
      </Button>
      <Button id="request-changes-btn" onClick={() => setIsChangesDialogOpen(true)}>
        {t('common.actions.requestChanges', { defaultValue: 'Request Changes' })}
      </Button>

      <Dialog
        isOpen={isRejectDialogOpen}
        onClose={() => setIsRejectDialogOpen(false)}
        title={t('approvalActions.dialogs.rejectTitle', { defaultValue: 'Reject Time Sheet' })}
        footer={rejectFooter}
      >
        <DialogContent>
          <TextArea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder={t('approvalActions.placeholders.rejectionReason', {
              defaultValue: 'Enter reason for rejection'
            })}
            label={t('approvalActions.labels.rejectionReason', { defaultValue: 'Rejection Reason' })}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        isOpen={isChangesDialogOpen}
        onClose={() => setIsChangesDialogOpen(false)}
        title={t('approvalActions.dialogs.requestChangesTitle', { defaultValue: 'Request Changes' })}
        footer={changesFooter}
      >
        <DialogContent>
            <></>
          {/* Implement a form or interface for specifying change requests */}
        </DialogContent>
      </Dialog>
    </div>
  );
}

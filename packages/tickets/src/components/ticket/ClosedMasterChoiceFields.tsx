'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ClosedMasterChoice } from '../../lib/ticketBundlePolicy';

export interface ClosedMasterChoiceFieldsProps {
  /** Prefix for DOM ids so the two surfaces (detail dialog, list dialog) stay unique. */
  idPrefix: string;
  allowedChoices: ClosedMasterChoice[];
  value: ClosedMasterChoice | null;
  onChange: (choice: ClosedMasterChoice) => void;
  hasResolutionComment: boolean;
  masterStatusName: string | null;
  disabled?: boolean;
}

/**
 * Radio group for the closed-master add policy. Renders only the choices the
 * board allows, defaults to keep_closed when it is offered, and adapts the
 * apply_resolution helper to whether the master actually has a public
 * resolution comment. Shared by the ticket-detail dialog and the list dialog.
 */
export function ClosedMasterChoiceFields({
  idPrefix,
  allowedChoices,
  value,
  onChange,
  hasResolutionComment,
  masterStatusName,
  disabled = false,
}: ClosedMasterChoiceFieldsProps) {
  const { t } = useTranslation('features/tickets');
  const statusLabel = masterStatusName || t('details.bundle.childClosedStatus', 'Closed');
  const keepClosedGated = !allowedChoices.includes('keep_closed');

  const renderChoice = (
    choice: ClosedMasterChoice,
    label: string,
    help: string,
  ) => (
    <label
      key={choice}
      htmlFor={`${idPrefix}-${choice}`}
      className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 p-3 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
    >
      <input
        id={`${idPrefix}-${choice}`}
        name={idPrefix}
        type="radio"
        className="mt-1"
        value={choice}
        checked={value === choice}
        onChange={() => onChange(choice)}
        disabled={disabled}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{label}</span>
        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{help}</span>
      </span>
    </label>
  );

  return (
    <div className="space-y-2" id={`${idPrefix}-fields`}>
      {allowedChoices.includes('keep_closed') &&
        renderChoice(
          'keep_closed',
          t('details.bundle.keepClosedLabel', 'Add and keep master closed'),
          t(
            'details.bundle.keepClosedHelp',
            'The child stays open with its own SLA clock. The bundle will show as inconsistent until the child is resolved.',
          ),
        )}
      {allowedChoices.includes('apply_resolution') &&
        renderChoice(
          'apply_resolution',
          t('details.bundle.applyResolutionLabel', "Add and apply the master's resolution to this child"),
          hasResolutionComment
            ? t(
                'details.bundle.applyResolutionHelp',
                "Closes the child with status {{status}} and posts the master's resolution to the child as a public comment.",
                { status: statusLabel },
              )
            : t(
                'details.bundle.applyResolutionHelpNoComment',
                'Closes the child with status {{status}}. The master has no public resolution comment to post.',
                { status: statusLabel },
              ),
        )}
      {allowedChoices.includes('reopen_master') &&
        renderChoice(
          'reopen_master',
          t('details.bundle.reopenMasterLabel', 'Add and reopen master'),
          t(
            'details.bundle.reopenMasterHelp',
            'Reopens only the master. Already-closed children in this bundle stay closed; reopen notifications and SLA apply to the master.',
          ),
        )}
      {keepClosedGated && (
        <p className="text-xs text-amber-700 dark:text-amber-300" id={`${idPrefix}-gating`}>
          {t(
            'details.bundle.closedMasterGating',
            "The board's close rules do not allow open children under a closed master, so keeping the master closed is not an option.",
          )}
        </p>
      )}
    </div>
  );
}

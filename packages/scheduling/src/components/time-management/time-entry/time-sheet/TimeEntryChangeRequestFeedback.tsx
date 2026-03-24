'use client';

import { Check, MessageSquareText, X } from 'lucide-react';
import { format } from 'date-fns';
import { ITimeEntryChangeRequest, TimeEntryChangeRequestState } from '@alga-psa/types';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getProminentTimeEntryChangeRequest,
  getTimeEntryChangeRequestState,
} from '../../../../lib/timeEntryChangeRequests';

interface TimeEntryChangeRequestIndicatorProps {
  changeRequests?: ITimeEntryChangeRequest[];
  stateOverride?: TimeEntryChangeRequestState | null;
  showLabel?: boolean;
  className?: string;
}

function getStateLabel(
  state: TimeEntryChangeRequestState,
  t: ReturnType<typeof useTranslation>['t']
): string {
  return state === 'unresolved'
    ? t('common.states.changeRequested', { defaultValue: 'Change requested' })
    : t('common.states.addressed', { defaultValue: 'Addressed' });
}

function getStateClasses(state: TimeEntryChangeRequestState): string {
  return state === 'unresolved'
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : 'border-emerald-200 bg-emerald-50 text-emerald-800';
}

function getHistory(changeRequests?: ITimeEntryChangeRequest[]): ITimeEntryChangeRequest[] {
  return [...(changeRequests ?? [])].sort(
    (left, right) =>
      new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
  );
}

export function TimeEntryChangeRequestIndicator({
  changeRequests,
  stateOverride,
  showLabel = false,
  className = '',
}: TimeEntryChangeRequestIndicatorProps): React.JSX.Element | null {
  const { t } = useTranslation('msp/time-entry');
  const state = stateOverride ?? getTimeEntryChangeRequestState(changeRequests);
  const prominentChangeRequest = getProminentTimeEntryChangeRequest(changeRequests);

  if (!state) {
    return null;
  }

  const Icon = state === 'unresolved' ? X : Check;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${getStateClasses(state)} ${className}`.trim()}
      title={prominentChangeRequest?.comment}
      data-feedback-state={state}
      aria-label={getStateLabel(state, t)}
    >
      <Icon className="h-3 w-3" />
      {showLabel ? getStateLabel(state, t) : null}
    </span>
  );
}

interface TimeEntryChangeRequestPanelProps {
  changeRequests?: ITimeEntryChangeRequest[];
}

export function TimeEntryChangeRequestPanel({
  changeRequests,
}: TimeEntryChangeRequestPanelProps): React.JSX.Element | null {
  const { t } = useTranslation('msp/time-entry');
  const { formatDate } = useFormatters();
  const prominentChangeRequest = getProminentTimeEntryChangeRequest(changeRequests);
  const state = getTimeEntryChangeRequestState(changeRequests);
  const history = getHistory(changeRequests);

  if (!prominentChangeRequest || !state) {
    return null;
  }

  return (
    <div
      className={`rounded-lg border px-4 py-3 ${state === 'unresolved'
        ? 'border-amber-200 bg-amber-50'
        : 'border-emerald-200 bg-emerald-50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <MessageSquareText className="h-4 w-4" />
            <span>{t('feedback.approverFeedback', { defaultValue: 'Approver feedback' })}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">
            {prominentChangeRequest.comment}
          </p>
          <p className="mt-2 text-xs text-gray-500">
            {t('feedback.approverOn', {
              defaultValue: '{{name}} on {{value}}',
              name: prominentChangeRequest.created_by_name || t('approval.labels.approver', { defaultValue: 'Approver' }),
              value: formatDate(new Date(prominentChangeRequest.created_at), { dateStyle: 'medium', timeStyle: 'short' })
            })}
          </p>
        </div>
        <TimeEntryChangeRequestIndicator changeRequests={changeRequests} showLabel />
      </div>

      {history.length > 1 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">
            {t('feedback.viewHistory', { defaultValue: 'View feedback history' })}
          </summary>
          <div className="mt-3 space-y-3">
            {history.map((changeRequest) => {
              const itemState: TimeEntryChangeRequestState = changeRequest.handled_at ? 'handled' : 'unresolved';

              return (
                <div
                  key={changeRequest.change_request_id}
                  className="rounded-md border border-white/70 bg-white/70 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-gray-500">
                      {t('feedback.approverOn', {
                        defaultValue: '{{name}} on {{value}}',
                        name: changeRequest.created_by_name || t('approval.labels.approver', { defaultValue: 'Approver' }),
                        value: formatDate(new Date(changeRequest.created_at), { dateStyle: 'medium', timeStyle: 'short' })
                      })}
                    </p>
                    <TimeEntryChangeRequestIndicator
                      changeRequests={[changeRequest]}
                      stateOverride={itemState}
                      showLabel
                    />
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">
                    {changeRequest.comment}
                  </p>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}

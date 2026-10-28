'use client';

import React, { useMemo } from 'react';
import { Lightbulb } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import type { TimeEntrySuggestion } from '../../../../lib/workTrail/deriveSuggestions';
import { suggestionActivityKinds } from '../../../../lib/workTrail/suggestionTimes';

interface SuggestedEntriesSectionProps {
  suggestions: TimeEntrySuggestion[];
  isLoading?: boolean;
  /** Disables the row actions while a dismiss/refetch is in flight. */
  isBusy?: boolean;
  onLogTime: (suggestion: TimeEntrySuggestion) => void;
  onDismiss: (suggestion: TimeEntrySuggestion) => void;
  onDismissDay: (workDate: string) => void;
}

/**
 * Time entries suggested from the user's own ticket activity (plan D15). Replaces the interval
 * section on the time sheet. Presentational: the sheet owns fetching, dismissing and opening the
 * time entry dialog. Display names only; raw ids never appear in the text.
 */
export function SuggestedEntriesSection({
  suggestions,
  isLoading = false,
  isBusy = false,
  onLogTime,
  onDismiss,
  onDismissDay,
}: SuggestedEntriesSectionProps): React.JSX.Element {
  const { t, i18n } = useTranslation('msp/time-entry');
  const locale = i18n?.language || 'en';

  const days = useMemo(() => {
    const byDate = new Map<string, TimeEntrySuggestion[]>();
    for (const suggestion of suggestions) {
      const list = byDate.get(suggestion.work_date) ?? [];
      list.push(suggestion);
      byDate.set(suggestion.work_date, list);
    }
    return [...byDate.entries()];
  }, [suggestions]);

  const formatTime = (iso: string, timeZone: string) =>
    new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
  const formatDay = (workDate: string) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${workDate}T12:00:00Z`));

  return (
    <Card id="time-sheet-suggestions-section" className="p-4">
      <div className="mb-1 flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-[rgb(var(--color-primary-500))]" />
        <h2 className="text-lg font-semibold">{t('suggestions.title', { defaultValue: 'Suggestions' })}</h2>
        {suggestions.length > 0 && (
          <Badge id="time-sheet-suggestions-count" variant="info">{suggestions.length}</Badge>
        )}
      </div>
      <p className="mb-4 text-sm text-gray-600">
        {t('suggestions.description', {
          defaultValue: 'Tickets you worked on in this period that have no time logged yet. Nothing is logged until you choose Log time.',
        })}
      </p>

      {isLoading ? (
        <div className="py-6 text-center text-sm text-gray-500">
          {t('suggestions.loading', { defaultValue: 'Loading suggestions...' })}
        </div>
      ) : days.length === 0 ? (
        <div className="py-6 text-center text-sm text-gray-500">
          {t('suggestions.empty', { defaultValue: 'No suggestions for this period' })}
        </div>
      ) : (
        <div className="space-y-4">
          {days.map(([workDate, daySuggestions]) => (
            <div key={workDate} className="rounded border">
              <div className="flex items-center justify-between border-b bg-gray-50 px-3 py-2">
                <span className="text-sm font-medium">{formatDay(workDate)}</span>
                <Button
                  id={`time-sheet-suggestions-dismiss-day-${workDate}`}
                  variant="ghost"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => onDismissDay(workDate)}
                >
                  {t('suggestions.dismissAllForDay', { defaultValue: 'Dismiss all for this day' })}
                </Button>
              </div>
              <ul className="divide-y">
                {daySuggestions.map((suggestion) => {
                  const rowKey = `${suggestion.ticket_id}-${suggestion.work_date}`;
                  const kinds = suggestionActivityKinds(suggestion.event_kinds)
                    .map((kind) => t(`suggestions.kinds.${kind}`, { defaultValue: kind }))
                    .join(', ');
                  return (
                    <li
                      key={rowKey}
                      id={`time-sheet-suggestion-${rowKey}`}
                      className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          #{suggestion.ticket_number} {suggestion.title}
                        </div>
                        {suggestion.client_name && (
                          <div className="truncate text-xs text-gray-600">{suggestion.client_name}</div>
                        )}
                        <div className="text-xs text-gray-500">
                          {t('suggestions.activitySummary', {
                            defaultValue: 'first activity {{first}} · last {{last}} · {{count}} actions ({{kinds}})',
                            first: formatTime(suggestion.first_touch, suggestion.time_zone),
                            last: formatTime(suggestion.last_touch, suggestion.time_zone),
                            count: suggestion.event_count,
                            kinds,
                          })}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          id={`time-sheet-suggestion-${rowKey}-log`}
                          size="sm"
                          disabled={isBusy}
                          onClick={() => onLogTime(suggestion)}
                        >
                          {t('suggestions.logTime', { defaultValue: 'Log time' })}
                        </Button>
                        <Button
                          id={`time-sheet-suggestion-${rowKey}-dismiss`}
                          variant="outline"
                          size="sm"
                          disabled={isBusy}
                          onClick={() => onDismiss(suggestion)}
                        >
                          {t('suggestions.dismiss', { defaultValue: 'Dismiss' })}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default SuggestedEntriesSection;

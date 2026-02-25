'use client';

import React, { useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { normalizeEmailAddress } from '@shared/lib/email/addressUtils';
import {
  mergeTicketWatchListRecipients,
  parseTicketWatchListAttributes,
  type TicketWatchListEntry,
} from '@shared/lib/tickets/watchList';
import styles from './TicketDetails.module.css';

interface TicketWatchListCardProps {
  id: string;
  attributes: unknown;
  onUpdateWatchList?: (watchList: TicketWatchListEntry[]) => Promise<boolean>;
  watchListSaving?: boolean;
}

const TicketWatchListCard: React.FC<TicketWatchListCardProps> = ({
  id,
  attributes,
  onUpdateWatchList,
  watchListSaving = false,
}) => {
  const [watchListInput, setWatchListInput] = useState('');
  const [watchListError, setWatchListError] = useState<string | null>(null);
  const [watchListSavingInternal, setWatchListSavingInternal] = useState(false);
  const watchList = React.useMemo(() => parseTicketWatchListAttributes(attributes), [attributes]);
  const isWatchListSaving = watchListSaving || watchListSavingInternal;

  const persistWatchList = async (nextWatchList: TicketWatchListEntry[]): Promise<boolean> => {
    if (!onUpdateWatchList || isWatchListSaving) {
      return false;
    }

    setWatchListError(null);
    setWatchListSavingInternal(true);
    try {
      const updated = await onUpdateWatchList(nextWatchList);
      if (!updated) {
        setWatchListError('Unable to update watch list. Please try again.');
      }
      return updated;
    } catch (error) {
      console.error('Failed to update watch list:', error);
      setWatchListError('Unable to update watch list. Please try again.');
      return false;
    } finally {
      setWatchListSavingInternal(false);
    }
  };

  const handleAddWatcher = async () => {
    const normalizedEmail = normalizeEmailAddress(watchListInput);
    if (!normalizedEmail) {
      setWatchListError('Enter a valid email address.');
      return;
    }

    const mergedWatchList = mergeTicketWatchListRecipients(watchList, [
      {
        email: normalizedEmail,
        source: 'manual',
      },
    ]);

    if (JSON.stringify(mergedWatchList) === JSON.stringify(watchList)) {
      setWatchListError(null);
      setWatchListInput('');
      return;
    }

    const success = await persistWatchList(mergedWatchList);
    if (success) {
      setWatchListInput('');
    }
  };

  const handleToggleWatcher = async (email: string, active: boolean) => {
    const nextWatchList = watchList.map((entry) =>
      entry.email === email ? { ...entry, active } : entry
    );
    await persistWatchList(nextWatchList);
  };

  const handleRemoveWatcher = async (email: string) => {
    const nextWatchList = watchList.filter((entry) => entry.email !== email);
    await persistWatchList(nextWatchList);
  };

  return (
    <div className={`${styles['card']} p-6 space-y-4`}>
      <h2 className={styles['panel-header']}>Watch List</h2>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Input
            {...withDataAutomationId({ id: `${id}-email-input` })}
            value={watchListInput}
            onChange={(event) => setWatchListInput(event.target.value)}
            placeholder="name@example.com"
            disabled={isWatchListSaving}
            onKeyDown={async (event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                await handleAddWatcher();
              }
            }}
          />
          <Button
            {...withDataAutomationId({ id: `${id}-add-btn` })}
            type="button"
            onClick={handleAddWatcher}
            disabled={isWatchListSaving}
            size="sm"
          >
            Add
          </Button>
        </div>

        {watchListError ? (
          <p className="text-sm text-red-600 flex items-center gap-1">
            <AlertCircle className="h-4 w-4" />
            {watchListError}
          </p>
        ) : null}

        {watchList.length === 0 ? (
          <p className="text-sm text-gray-500">No watchers added.</p>
        ) : (
          <div className="space-y-2">
            {watchList.map((entry) => (
              <div
                key={entry.email}
                className="flex items-center justify-between gap-3 border border-gray-200 rounded px-3 py-2"
              >
                <label className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={entry.active}
                    disabled={isWatchListSaving}
                    onChange={(event) => void handleToggleWatcher(entry.email, event.target.checked)}
                  />
                  <span className={`text-sm ${entry.active ? 'text-gray-900' : 'text-gray-500'}`}>
                    {entry.email}
                  </span>
                </label>
                <Button
                  {...withDataAutomationId({ id: `${id}-remove-btn-${entry.email}` })}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isWatchListSaving}
                  onClick={() => void handleRemoveWatcher(entry.email)}
                >
                  <X className="h-3 w-3 mr-1" />
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TicketWatchListCard;

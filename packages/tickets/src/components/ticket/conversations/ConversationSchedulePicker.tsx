'use client';

import { useEffect, useState } from 'react';
import { DateTimePicker } from '@alga-psa/ui/components/DateTimePicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { utcToLocal, dateToWallTimeString, zonedWallTimeToUtc } from '@alga-psa/core';
import type { RequesterPublicationOptions } from '@alga-psa/shared/lib/tickets/requesterPublicationOptions';

export type ConversationSchedule = NonNullable<RequesterPublicationOptions['schedule']>;
export function formatConversationSchedule(schedule: ConversationSchedule) {
  return new Date(schedule.at).toLocaleString(undefined, { timeZone: schedule.timeZone, year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}
export function ConversationSchedulePicker({ id, value, disabled, onChange }: {
  id: string; value: ConversationSchedule; disabled?: boolean; onChange: (value: ConversationSchedule | null) => void;
}) {
  const { t } = useTranslation('features/tickets');
  const [wall, setWall] = useState<Date | undefined>(() => utcToLocal(value.at, value.timeZone));
  const [invalid, setInvalid] = useState(Date.parse(value.at) <= Date.now());
  useEffect(() => { setWall(utcToLocal(value.at, value.timeZone)); setInvalid(Date.parse(value.at) <= Date.now()); }, [value.at, value.timeZone]);
  return <div className="space-y-1">
    <DateTimePicker id={id} label={`${t('conversation.publishAt', 'Publish at')} (${value.timeZone})`} value={wall} disabled={disabled} clearable
      onChange={date => {
        setWall(date);
        try {
          if (!date) throw new Error('Missing time');
          const at = zonedWallTimeToUtc(dateToWallTimeString(date), value.timeZone);
          if (at.getTime() <= Date.now()) throw new Error('Past time');
          setInvalid(false); onChange({ at: at.toISOString(), timeZone: value.timeZone });
        } catch { setInvalid(true); onChange(null); }
      }} />
    {invalid && <p role="alert" className="text-sm text-destructive">{t('conversation.invalidScheduleTime', 'Choose an unambiguous future time in this time zone.')}</p>}
  </div>;
}

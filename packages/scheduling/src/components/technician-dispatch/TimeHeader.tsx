import React from 'react';
import { isWorkingHour } from './utils';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface TimeHeaderProps {
  timeSlots: string[];
}

const TimeHeader: React.FC<TimeHeaderProps> = ({ timeSlots }) => {
  const { t } = useTranslation('msp/dispatch');

  return (
    <div className="grid grid-cols-24 gap-0 h-8 sticky top-0 z-10 bg-white">
      {timeSlots.filter((_, index) => index % 4 === 0).map((slot: string): React.JSX.Element => {
        const hour = parseInt(slot);
        const isWorking = isWorkingHour(hour);
        return (
          <div
            key={slot}
            className={`text-center text-xs font-semibold ${isWorking ? 'time-header-working' : 'time-header-non-working'}`}
          >
            {`${parseInt(slot) === 0 ? 12 : parseInt(slot) > 12 ? parseInt(slot) - 12 : parseInt(slot)}${
              parseInt(slot) >= 12
                ? t('time.suffixes.pm', { defaultValue: ' PM' })
                : t('time.suffixes.am', { defaultValue: ' AM' })
            }`}
          </div>
        );
      })}
    </div>
  );
};

export default TimeHeader;

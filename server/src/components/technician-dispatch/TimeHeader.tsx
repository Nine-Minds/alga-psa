import React from 'react';
import { isWorkingHour } from './utils';

interface TimeHeaderProps {
  timeSlots: string[];
}

const TimeHeader: React.FC<TimeHeaderProps> = ({ timeSlots }) => {
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
            {`${parseInt(slot) === 0 ? 12 : parseInt(slot) > 12 ? parseInt(slot) - 12 : parseInt(slot)}${parseInt(slot) >= 12 ? ' PM' : ' AM'}`}
          </div>
        );
      })}
    </div>
  );
};

export default TimeHeader;

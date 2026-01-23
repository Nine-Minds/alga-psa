import React from 'react';

interface TimeSlotProps {
  timeSlot: string;
  isHourBoundary: boolean;
  isHighlighted: boolean;
  isWorkingHour: boolean;
  onMouseOver: (e: React.MouseEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

const TimeSlot: React.FC<TimeSlotProps> = ({
  timeSlot,
  isHourBoundary,
  isHighlighted,
  isWorkingHour,
  onMouseOver,
  onDragOver,
  onDrop,
}) => {
  return (
    <div
      className={`h-full relative ${isHourBoundary ? 'border-l border-[rgb(var(--color-border-200))]' : ''} 
      ${isHighlighted ? 'bg-[rgb(var(--color-primary-100))]' : ''} 
      ${!isWorkingHour ? 'bg-gray-100' : ''} transition-colors duration-150`}
      data-time={timeSlot}
      onMouseOver={onMouseOver}
      onDragOver={onDragOver}
      onDrop={onDrop}
    />
  );
};

export default TimeSlot;

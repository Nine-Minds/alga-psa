import React from 'react';
import { Calendar, CalendarProps } from 'react-big-calendar';
import withDragAndDrop, { withDragAndDropProps } from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import 'react-big-calendar/lib/css/react-big-calendar.css';

// Create the DnD Calendar component
const DnDCalendar = withDragAndDrop(Calendar);

interface DynamicBigCalendarProps extends CalendarProps<any, any>, Partial<withDragAndDropProps<any, any>> {
  [key: string]: any;
  // Add any additional props specific to the drag-and-drop calendar
  draggableAccessor?: (event: any) => boolean;
  resizableAccessor?: (event: any) => boolean;
  onEventResize?: (args: any) => void;
  onEventDrop?: (args: any) => void;
  dragFromOutsideItem?: () => any;
  onDropFromOutside?: (args: any) => void;
}

const DynamicBigCalendar: React.FC<DynamicBigCalendarProps> = (props) => {
  // Custom drag behavior for multi-day events
  const customProps = {
    ...props,
    // Prevent the calendar from expanding events when dragging
    dragFromOutsideItem: props.dragFromOutsideItem || undefined,
    onDropFromOutside: props.onDropFromOutside || undefined,
    // Allow dragging across week boundaries
    droppableMonthDay: true,
  };

  return <DnDCalendar {...customProps as any} />;
};

export default DynamicBigCalendar;
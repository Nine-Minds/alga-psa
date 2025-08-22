import React from 'react';
import { Calendar, CalendarProps } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import 'react-big-calendar/lib/css/react-big-calendar.css';

// Create the DnD Calendar component
const DnDCalendar = withDragAndDrop(Calendar);

interface DynamicBigCalendarProps extends CalendarProps<any, any> {
  [key: string]: any;
  // Add any additional props specific to the drag-and-drop calendar
  draggableAccessor?: (event: any) => boolean;
  resizableAccessor?: (event: any) => boolean;
  onEventResize?: (args: any) => void;
  onEventDrop?: (args: any) => void;
}

const DynamicBigCalendar: React.FC<DynamicBigCalendarProps> = (props) => {
  return <DnDCalendar {...props as any} />;
};

export default DynamicBigCalendar;
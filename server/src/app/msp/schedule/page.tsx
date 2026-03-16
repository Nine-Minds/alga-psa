import type { Metadata } from 'next';
import SchedulePage from '@alga-psa/scheduling/components/schedule/SchedulePage';

export const metadata: Metadata = {
  title: 'Schedule',
};

export default function SchedulePageWrapper() {
  return <SchedulePage />;
}

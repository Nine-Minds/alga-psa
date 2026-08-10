import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import SchedulePage from '@alga-psa/scheduling/components/schedule/SchedulePage';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.schedule.title', { defaultValue: 'Schedule' }),
  };
}

export default function SchedulePageWrapper() {
  return <SchedulePage />;
}

import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedProjectTaskQueue from '@/components/co-managed/CoManagedProjectTaskQueue';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.coManagement.tasks.title', { defaultValue: 'Project Task Queues' }),
  };
}
export default function CoManagedProjectTaskQueuePage() {
  return <CoManagedFeatureBoundary><CoManagedProjectTaskQueue /></CoManagedFeatureBoundary>;
}

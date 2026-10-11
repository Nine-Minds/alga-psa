'use client';
import Link from 'next/link';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { CoManagedFeatureBoundary } from './CoManagedFeatureBoundary';
export default function CoManagedProjectTaskQueueLink() {
  const { t } = useTranslation('msp/licensing');
  return <CoManagedFeatureBoundary><div className="px-6 py-3"><Link id="co-managed-task-queues" className="text-primary underline" href="/msp/co-management/tasks">{t('coManaged.projects.queue.title')}</Link></div></CoManagedFeatureBoundary>;
}

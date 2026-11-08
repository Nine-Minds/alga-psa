'use client';

import Link from 'next/link';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { CoManagedFeatureBoundary } from './CoManagedFeatureBoundary';

/**
 * Entry to the Shared Tasks queue. Mounted from a server page, but the answer comes from the capability
 * bootstrap the layout already serialised, so it costs no extra statement and renders nothing for a
 * tenant whose co-managed capability is not served.
 */
export default function CoManagedProjectTaskQueueLink() {
  const { t } = useTranslation('msp/licensing');
  return <CoManagedFeatureBoundary mode="serves">
    <div className="mb-3 flex justify-end">
      <Button id="co-managed-shared-tasks-link" asChild variant="outline" size="sm">
        <Link href="/msp/co-management/tasks">{t('coManaged.sharedTasks.link', { defaultValue: 'Shared Tasks' })}</Link>
      </Button>
    </div>
  </CoManagedFeatureBoundary>;
}

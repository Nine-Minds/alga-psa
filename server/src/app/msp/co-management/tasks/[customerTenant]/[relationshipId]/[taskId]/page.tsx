import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { locateCoManagedSharedTaskAction } from '@/lib/actions/coManagedProjectTaskActions';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.coManagement.sharedTasks.taskTitle', { defaultValue: 'Shared Task' }) };
}

/**
 * A task link names only a task. The task's project is resolved through the authorized task read, then the
 * request continues to the native shared project screen, which opens the task drawer from ?taskId.
 */
export default async function CoManagedSharedTaskPage({ params }: { params: Promise<{ customerTenant: string; relationshipId: string; taskId: string }> }) {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  if (!tenant || !session?.user?.id) notFound();
  await requireCapabilityForPage('co-managed', tenant, 'serves');
  const { customerTenant, relationshipId, taskId } = await params;
  const located = await locateCoManagedSharedTaskAction(customerTenant, relationshipId, taskId);
  if (!located) notFound();
  const part = encodeURIComponent;
  redirect(`/msp/co-management/projects/${part(customerTenant)}/${part(relationshipId)}/${part(located.projectId)}?taskId=${part(taskId)}`);
}

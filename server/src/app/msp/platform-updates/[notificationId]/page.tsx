import { notFound } from 'next/navigation';
import { getActivePlatformNotifications } from '@enterprise/lib/platformNotifications/actions';
import { PlatformUpdateDetail } from '@/components/platform-updates/PlatformUpdateDetail';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ notificationId: string }>;
}

export default async function PlatformUpdatePage({ params }: PageProps) {
  const { notificationId } = await params;

  const activeNotifications = await getActivePlatformNotifications();
  const notification = activeNotifications.find(
    (n: { notification_id: string }) => n.notification_id === notificationId
  );

  if (!notification) {
    notFound();
  }

  // View recording is done client-side in PlatformUpdateDetail to avoid
  // overcounting from Next.js prefetch/RSC renders
  return (
    <PlatformUpdateDetail
      notificationId={notification.notification_id}
      title={notification.title}
      detailContent={notification.detail_content}
      priority={notification.priority}
      createdAt={notification.created_at instanceof Date ? notification.created_at.toISOString() : String(notification.created_at)}
    />
  );
}

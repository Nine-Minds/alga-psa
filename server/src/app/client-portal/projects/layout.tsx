import { getCurrentUser, hasPermission } from '@alga-psa/auth';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

interface LayoutProps {
  children: React.ReactNode;
}

export default async function Layout({ children }: Readonly<LayoutProps>) {
  const boundary = await enforceServerProductRoute({ pathname: '/client-portal/projects', scope: 'client-portal' });
  if (boundary) {
    return boundary;
  }

  // Role-based gate on top of the row-level project visibility filter: a portal
  // role without project:read never renders the list or detail client
  // components, even on a direct URL hit.
  const user = await getCurrentUser();
  const canRead = user ? await hasPermission(user, 'project', 'read') : false;
  if (!canRead) {
    const { t } = await getServerTranslation(undefined, 'common');
    return (
      <Alert id="project-permission-error" variant="destructive">
        <AlertDescription>
          {t('errors.permissions.projects.read', {
            defaultValue: 'Insufficient permissions to view projects',
          })}
        </AlertDescription>
      </Alert>
    );
  }

  return children;
}

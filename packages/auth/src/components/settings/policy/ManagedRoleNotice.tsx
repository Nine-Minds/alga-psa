'use client';

// Read-only presentation of a capability-owned ("managed") role: the label, why it cannot be
// edited here, and where its holders' access is managed.

import Link from 'next/link';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { MANAGED_ROLE_MANAGE_PATHS, type ManagedRoleMarker } from '../../../lib/managedRoles';

/** "Managed by Co-managed IT": the label every read-only surface shows beside the role. */
export function ManagedRoleBadge({ role }: { role: ManagedRoleMarker }) {
  const { t } = useTranslation('msp/settings');
  if (!role.managed_by) return null;
  return <Badge variant="secondary" size="sm" className="shrink-0 whitespace-nowrap">{t('managedRole.badge')}</Badge>;
}

/**
 * Explains a managed role and points at the client arrangement, where board and project scope is
 * managed. `roleName` is shown when the notice is about the permissions of one role.
 */
export function ManagedRoleNotice({ role, roleName }: { role: ManagedRoleMarker; roleName?: string }) {
  const { t } = useTranslation('msp/settings');
  if (!role.managed_by) return null;
  const manageHref = MANAGED_ROLE_MANAGE_PATHS[role.managed_by];
  return (
    <Alert variant="info" id={`managed-role-notice-${role.managed_by}`}>
      <AlertDescription>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <ManagedRoleBadge role={role} />
            <span className="min-w-0 flex-1">{roleName ? t('managedRole.permissionsLocked', { role: roleName }) : t('managedRole.readOnlyNotice')}</span>
          </div>
          <span>
            {t('managedRole.scopeHint')}{' '}
            {manageHref && (
              <Link href={manageHref} className="text-primary-600 underline" id="managed-role-open-arrangement">
                {t('managedRole.openArrangement')}
              </Link>
            )}
          </span>
        </div>
      </AlertDescription>
    </Alert>
  );
}

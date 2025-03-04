'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getServerSession } from "next-auth/next";
import { getCurrentUser, getUserRolesWithPermissions, getUserCompanyId } from 'server/src/lib/actions/user-actions/userActions';
import { getCompanyEmailSettings } from 'server/src/lib/actions/company-settings/emailSettings';
import { ICompanyEmailSettings } from 'server/src/interfaces/company.interfaces';
import { IRoleWithPermissions, IPermission } from 'server/src/interfaces/auth.interfaces';
import { Alert } from 'server/src/components/ui/Alert';
import EmailRegistrationSettings from './EmailRegistrationSettings';

export default function EmailRegistrationContainer() {
  const router = useRouter();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [emailSettings, setEmailSettings] = useState<ICompanyEmailSettings[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        // Get current user and their roles with permissions
        const user = await getCurrentUser();
        if (!user) {
          router.push('/auth/signin');
          return;
        }

        const rolesWithPermissions = await getUserRolesWithPermissions(user.user_id);
        
        // Check if user has Client Admin role with required permissions
        const hasRequiredPermissions = rolesWithPermissions.some(role => 
          role.permissions.some((permission: IPermission) => 
            `${permission.resource}.${permission.action}` === 'company_setting.read' || 
            `${permission.resource}.${permission.action}` === 'company_setting.update'
          )
        );

        if (!hasRequiredPermissions) {
          setError('You do not have permission to access email registration settings');
          return;
        }

        // Get company ID
        const userCompanyId = await getUserCompanyId(user.user_id);
        if (!userCompanyId) {
          setError('Company not found');
          return;
        }

        setCompanyId(userCompanyId);

        // Load email settings
        const settings = await getCompanyEmailSettings(userCompanyId);
        setEmailSettings(settings || []);
      } catch (error) {
        console.error('Error loading email settings:', error);
        setError('Failed to load email registration settings');
      }
    }

    loadData();
  }, [router]);

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <p className="text-red-800">{error}</p>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
        <div className="h-32 bg-gray-200 rounded"></div>
      </div>
    );
  }

  return (
    <EmailRegistrationSettings
      companyId={companyId}
      initialSuffixes={emailSettings}
    />
  );
}

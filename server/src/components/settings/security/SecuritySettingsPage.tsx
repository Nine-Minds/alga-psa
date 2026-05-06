'use client';

// Auth-owned security settings UI (moved out of @alga-psa/ui to avoid cycles).

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';
import CustomTabs, { TabContent } from "@alga-psa/ui/components/CustomTabs";
import { useSearchParams } from 'next/navigation';
import SettingsTabSkeleton from '@alga-psa/ui/components/skeletons/SettingsTabSkeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

function RoleManagementLoading() {
  const { t } = useTranslation('msp/profile');
  return <SettingsTabSkeleton title={t('security.tabs.roles', { defaultValue: 'Roles' })} description={t('security.loading.roles', { defaultValue: 'Loading role configuration...' })} />;
}

// Dynamic imports for heavy settings components
const RoleManagement = dynamic(() => import('@alga-psa/auth/components/settings/policy/RoleManagement'), {
  loading: RoleManagementLoading,
  ssr: false
});

function PermissionsLoading() {
  const { t } = useTranslation('msp/profile');
  return <SettingsTabSkeleton title={t('security.tabs.permissions', { defaultValue: 'Permissions' })} description={t('security.loading.permissions', { defaultValue: 'Loading permissions configuration...' })} showTable={true} showForm={false} />;
}

const PermissionsMatrix = dynamic(() => import('@alga-psa/auth/components/settings/policy/PermissionsMatrix'), {
  loading: PermissionsLoading,
  ssr: false
});

function UserRolesLoading() {
  const { t } = useTranslation('msp/profile');
  return <SettingsTabSkeleton title={t('security.tabs.userRoles', { defaultValue: 'User Roles' })} description={t('security.loading.userRoles', { defaultValue: 'Loading user role configuration...' })} showDropdowns={true} />;
}

const UserRoleAssignment = dynamic(() => import('./UserRoleAssignment'), {
  loading: UserRolesLoading,
  ssr: false
});

function PoliciesLoading() {
  const { t } = useTranslation('msp/profile');
  return <SettingsTabSkeleton title={t('security.tabs.policies', { defaultValue: 'Policies' })} description={t('security.loading.policies', { defaultValue: 'Loading policy configuration...' })} showTextArea={true} showTable={true} noCard={true} />;
}

const PolicyManagement = dynamic(() => import('@enterprise/components/settings/policy/PolicyManagement'), {
  loading: PoliciesLoading,
  ssr: false
});

function ApiKeysLoading() {
  const { t } = useTranslation('msp/profile');
  return <SettingsTabSkeleton title={t('security.tabs.apiKeys', { defaultValue: 'API Keys' })} description={t('security.loading.apiKeys', { defaultValue: 'Loading API key configuration...' })} />;
}

const AdminApiKeysSetup = dynamic(() => import('@alga-psa/auth/components/settings/api/AdminApiKeysSetup'), {
  loading: ApiKeysLoading,
  ssr: false
});

function WebhooksLoading() {
  const { t } = useTranslation('msp/profile');
  return <SettingsTabSkeleton title={t('security.tabs.webhooks', { defaultValue: 'Webhooks' })} description={t('security.loading.webhooks', { defaultValue: 'Loading webhook configuration...' })} />;
}

const AdminWebhooksSetup = dynamic(() => import('@alga-psa/auth/components/settings/api/AdminWebhooksSetup'), {
  loading: WebhooksLoading,
  ssr: false
});

function SsoLoading() {
  const { t } = useTranslation('msp/profile');
  return (
    <SettingsTabSkeleton
      title={t('security.tabs.sso', { defaultValue: 'Single Sign-On' })}
      description={t('security.loading.sso', { defaultValue: 'Loading SSO management tools...' })}
      showTable
    />
  );
}

const SsoBulkAssignment = dynamic(
  () => import('@enterprise/components/settings/security/SsoBulkAssignment'),
  {
    loading: SsoLoading,
    ssr: false,
  },
);

function SessionsLoading() {
  const { t } = useTranslation('msp/profile');
  return <SettingsTabSkeleton title={t('security.tabs.sessions', { defaultValue: 'Sessions' })} description={t('security.loading.sessions', { defaultValue: 'Loading active sessions...' })} showTable={true} />;
}

const AdminSessionManagement = dynamic(() => import('./AdminSessionManagement'), {
  loading: SessionsLoading,
  ssr: false
});

const SECURITY_TAB_IDS = ['roles', 'sessions', 'single-sign-on', 'permissions', 'user-roles', 'policies', 'api-keys', 'webhooks'] as const;
const DEFAULT_SECURITY_TAB = 'roles';

const SecuritySettingsPage = (): React.JSX.Element => {
  const { t } = useTranslation('msp/profile');
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');

  // Determine initial active tab based on URL parameter
  const [activeTab, setActiveTab] = React.useState<string>(() => {
    const requestedTab = tabParam?.toLowerCase();
    return requestedTab && SECURITY_TAB_IDS.includes(requestedTab as typeof SECURITY_TAB_IDS[number])
      ? requestedTab
      : DEFAULT_SECURITY_TAB;
  });

  // Update active tab when URL parameter changes
  React.useEffect(() => {
    const requestedTab = tabParam?.toLowerCase();
    const targetTab = requestedTab && SECURITY_TAB_IDS.includes(requestedTab as typeof SECURITY_TAB_IDS[number])
      ? requestedTab
      : DEFAULT_SECURITY_TAB;
    // Only update state if the derived tab is different from the current state
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [tabParam]); // Correct dependency array

  const tabContent: TabContent[] = [
    {
      id: 'roles',
      label: t('security.tabs.roles', { defaultValue: 'Roles' }),
      content: (
        <Suspense fallback={<RoleManagementLoading />}>
          <RoleManagement />
        </Suspense>
      ),
    },
    {
      id: 'sessions',
      label: t('security.tabs.sessions', { defaultValue: 'Sessions' }),
      content: (
        <Suspense fallback={<SessionsLoading />}>
          <AdminSessionManagement />
        </Suspense>
      ),
    },
    {
      id: 'single-sign-on',
      label: t('security.tabs.sso', { defaultValue: 'Single Sign-On' }),
      content: (
        <Suspense fallback={<SsoLoading />}>
          <SsoBulkAssignment />
        </Suspense>
      ),
    },
    {
      id: 'permissions',
      label: t('security.tabs.permissions', { defaultValue: 'Permissions' }),
      content: (
        <Suspense fallback={<PermissionsLoading />}>
          <PermissionsMatrix />
        </Suspense>
      ),
    },
    {
      id: 'user-roles',
      label: t('security.tabs.userRoles', { defaultValue: 'User Roles' }),
      content: (
        <Suspense fallback={<UserRolesLoading />}>
          <UserRoleAssignment />
        </Suspense>
      ),
    },
    {
      id: 'policies',
      label: t('security.tabs.policies', { defaultValue: 'Policies' }),
      content: (
        <Suspense fallback={<PoliciesLoading />}>
          <PolicyManagement />
        </Suspense>
      ),
    },
    {
      id: 'api-keys',
      label: t('security.tabs.apiKeys', { defaultValue: 'API Keys' }),
      content: (
        <Suspense fallback={<ApiKeysLoading />}>
          <AdminApiKeysSetup />
        </Suspense>
      ),
    },
    {
      id: 'webhooks',
      label: t('security.tabs.webhooks', { defaultValue: 'Webhooks' }),
      content: (
        <Suspense fallback={<WebhooksLoading />}>
          <AdminWebhooksSetup />
        </Suspense>
      ),
    },
    /* {
      label: "Security",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Security Settings</CardTitle>
            <CardDescription>Manage security options for your organization</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="flex items-center space-x-2">
                <Switch
                  id="two-factor-auth"
                  checked={twoFactorAuth}
                  onCheckedChange={setTwoFactorAuth}
                />
                <Label htmlFor="two-factor-auth">Two-Factor Authentication</Label>
              </div>
            </div>
          </CardContent>
        </Card>
      ),
    } */
  ];

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">{t('security.title')}</h1>
      <CustomTabs 
        tabs={tabContent}
        defaultTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);

          // Update URL using pushState to avoid full page reload
          // Default to '/msp/security-settings' if the slug is 'roles'
          const newUrl = tab !== DEFAULT_SECURITY_TAB
            ? `/msp/security-settings?tab=${tab}`
            : '/msp/security-settings';

          window.history.pushState({}, '', newUrl);
        }}
      />
    </div>
  );
};

export default SecuritySettingsPage;

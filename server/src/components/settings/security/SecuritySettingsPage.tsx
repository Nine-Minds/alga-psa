'use client';

// Auth-owned security settings UI (moved out of @alga-psa/ui to avoid cycles).

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';
import CustomTabs, { TabContent } from "@alga-psa/ui/components/CustomTabs";
import { useSearchParams } from 'next/navigation';
import SettingsTabSkeleton from '@alga-psa/ui/components/skeletons/SettingsTabSkeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

// Dynamic imports for heavy settings components
const RoleManagement = dynamic(() => import('@alga-psa/auth/components/settings/policy/RoleManagement'), {
  loading: () => <SettingsTabSkeleton title="Role Management" description="Loading role configuration..." />,
  ssr: false
});

const PermissionsMatrix = dynamic(() => import('@alga-psa/auth/components/settings/policy/PermissionsMatrix'), {
  loading: () => <SettingsTabSkeleton title="Permissions Matrix" description="Loading permissions configuration..." showTable={true} showForm={false} />,
  ssr: false
});

const UserRoleAssignment = dynamic(() => import('./UserRoleAssignment'), {
  loading: () => <SettingsTabSkeleton title="User Role Assignment" description="Loading user role configuration..." showDropdowns={true} />,
  ssr: false
});

const PolicyManagement = dynamic(() => import('@enterprise/components/settings/policy/PolicyManagement'), {
  loading: () => <SettingsTabSkeleton title="Policy Management" description="Loading policy configuration..." showTextArea={true} showTable={true} noCard={true} />,
  ssr: false
});

const AdminApiKeysSetup = dynamic(() => import('@alga-psa/auth/components/settings/api/AdminApiKeysSetup'), {
  loading: () => <SettingsTabSkeleton title="API Keys" description="Loading API key configuration..." />,
  ssr: false
});

const SsoBulkAssignment = dynamic(
  () => import('@enterprise/components/settings/security/SsoBulkAssignment'),
  {
    loading: () => (
      <SettingsTabSkeleton
        title="Single Sign-On"
        description="Loading SSO management tools..."
        showTable
      />
    ),
    ssr: false,
  },
);

const AdminSessionManagement = dynamic(() => import('./AdminSessionManagement'), {
  loading: () => <SettingsTabSkeleton title="Sessions" description="Loading active sessions..." showTable={true} />,
  ssr: false
});

const SECURITY_TAB_IDS = ['roles', 'sessions', 'single-sign-on', 'permissions', 'user-roles', 'policies', 'api-keys'] as const;
const DEFAULT_SECURITY_TAB = 'roles';

const SecuritySettingsPage = (): React.JSX.Element => {
  const { t } = useTranslation('msp/settings');
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
      label: "Roles",
      content: (
        <Suspense fallback={<SettingsTabSkeleton title="Roles" description="Loading role configuration..." />}>
          <RoleManagement />
        </Suspense>
      ),
    },
    {
      id: 'sessions',
      label: "Sessions",
      content: (
        <Suspense fallback={<SettingsTabSkeleton title="Sessions" description="Loading active sessions..." />}>
          <AdminSessionManagement />
        </Suspense>
      ),
    },
    {
      id: 'single-sign-on',
      label: "Single Sign-On",
      content: (
        <Suspense fallback={<SettingsTabSkeleton title="Single Sign-On" description="Loading SSO management tools..." />}>
          <SsoBulkAssignment />
        </Suspense>
      ),
    },
    {
      id: 'permissions',
      label: "Permissions",
      content: (
        <Suspense fallback={<SettingsTabSkeleton title="Permissions" description="Loading permissions configuration..." />}>
          <PermissionsMatrix />
        </Suspense>
      ),
    },
    {
      id: 'user-roles',
      label: "User Roles",
      content: (
        <Suspense fallback={<SettingsTabSkeleton title="User Roles" description="Loading user role configuration..." />}>
          <UserRoleAssignment />
        </Suspense>
      ),
    },
    {
      id: 'policies',
      label: "Policies",
      content: (
        <Suspense fallback={<SettingsTabSkeleton title="Policies" description="Loading policy configuration..." />}>
          <PolicyManagement />
        </Suspense>
      ),
    },
    {
      id: 'api-keys',
      label: "API Keys",
      content: (
        <Suspense fallback={<SettingsTabSkeleton title="API Keys" description="Loading API key configuration..." />}>
          <AdminApiKeysSetup />
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

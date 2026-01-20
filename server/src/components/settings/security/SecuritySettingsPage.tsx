'use client';

// Auth-owned security settings UI (moved out of @alga-psa/ui to avoid cycles).

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';
import CustomTabs, { TabContent } from "@alga-psa/ui/components/CustomTabs";
import { useSearchParams } from 'next/navigation';
import SettingsTabSkeleton from '@alga-psa/ui/components/skeletons/SettingsTabSkeleton';

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

const PolicyManagement = dynamic(() => import('@alga-psa/auth/components/settings/policy/PolicyManagement'), {
  loading: () => <SettingsTabSkeleton title="Policy Management" description="Loading policy configuration..." showTextArea={true} showTable={true} noCard={true} />,
  ssr: false
});

const AdminApiKeysSetup = dynamic(() => import('@alga-psa/auth/components/settings/api/AdminApiKeysSetup'), {
  loading: () => <SettingsTabSkeleton title="API Keys" description="Loading API key configuration..." />,
  ssr: false
});

const SsoBulkAssignment = dynamic(
  () => import('@ee/components/settings/security/SsoBulkAssignment'),
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

const SecuritySettingsPage = (): React.JSX.Element => {
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');

  // Map URL slugs (kebab-case) to Tab Labels
  const slugToLabelMap: Record<string, string> = {
    'roles': 'Roles',
    'sessions': 'Sessions',
    'permissions': 'Permissions',
    'user-roles': 'User Roles',
    'policies': 'Policies',
    'api-keys': 'API Keys',
    'single-sign-on': 'Single Sign-On',
  };

  // Determine initial active tab based on URL parameter
  const [activeTab, setActiveTab] = React.useState<string>(() => {
    const initialLabel = tabParam ? slugToLabelMap[tabParam.toLowerCase()] : undefined;
    return initialLabel || 'Roles'; // Default to 'Roles' if param is missing or invalid
  });

  // Update active tab when URL parameter changes
  React.useEffect(() => {
    const currentLabel = tabParam ? slugToLabelMap[tabParam.toLowerCase()] : undefined;
    const targetTab = currentLabel || 'Roles';
    // Only update state if the derived tab is different from the current state
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [tabParam]); // Correct dependency array

  const tabContent: TabContent[] = [
    {
      label: "Roles",
      content: (
        <Suspense fallback={<SettingsTabSkeleton title="Role Management" description="Loading role configuration..." />}>
          <RoleManagement />
        </Suspense>
      ),
    },
    {
      label: "Sessions",
      content: (
        <Suspense fallback={<SettingsTabSkeleton title="Active Sessions" description="Loading active sessions..." />}>
          <AdminSessionManagement />
        </Suspense>
      ),
    },
    {
      label: "Single Sign-On",
      content: (
        <Suspense fallback={<SettingsTabSkeleton title="Single Sign-On" description="Loading SSO management tools..." />}>
          <SsoBulkAssignment />
        </Suspense>
      ),
    },
    {
      label: "Permissions",
      content: (
        <Suspense fallback={<SettingsTabSkeleton title="Permissions Matrix" description="Loading permissions configuration..." />}>
          <PermissionsMatrix />
        </Suspense>
      ),
    },
    {
      label: "User Roles",
      content: (
        <Suspense fallback={<SettingsTabSkeleton title="User Role Assignment" description="Loading user role configuration..." />}>
          <UserRoleAssignment />
        </Suspense>
      ),
    },
    {
      label: "Policies",
      content: (
        <Suspense fallback={<SettingsTabSkeleton title="Policy Management" description="Loading policy configuration..." />}>
          <PolicyManagement />
        </Suspense>
      ),
    },
    {
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
      <h1 className="text-3xl font-bold mb-6">Security Settings</h1>
      <CustomTabs 
        tabs={tabContent}
        defaultTab={activeTab}
        onTabChange={(tab) => {
          // Map Tab Labels back to URL slugs (kebab-case)
          const labelToSlugMap: Record<string, string> = Object.entries(slugToLabelMap).reduce((acc, [slug, label]) => {
            acc[label] = slug;
            return acc;
          }, {} as Record<string, string>);

          // Re-add immediate state update on tab change
          setActiveTab(tab);

          const urlSlug = labelToSlugMap[tab];
          // Update URL using pushState to avoid full page reload
          // Default to '/msp/security-settings' if the slug is 'roles' or not found
          const newUrl = urlSlug && urlSlug !== 'roles'
            ? `/msp/security-settings?tab=${urlSlug}`
            : '/msp/security-settings';

          window.history.pushState({}, '', newUrl);
        }}
      />
    </div>
  );
};

export default SecuritySettingsPage;

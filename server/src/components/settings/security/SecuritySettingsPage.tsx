'use client'

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';
import CustomTabs, { TabContent } from "server/src/components/ui/CustomTabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "server/src/components/ui/Card";
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import { Switch } from "server/src/components/ui/Switch";
import { Label } from "server/src/components/ui/Label";
import SettingsTabSkeleton from 'server/src/components/ui/skeletons/SettingsTabSkeleton';

// Dynamic imports for heavy settings components
const RoleManagement = dynamic(() => import('../policy/RoleManagement'), {
  loading: () => <SettingsTabSkeleton title="Role Management" description="Loading role configuration..." />,
  ssr: false
});

const PermissionsMatrix = dynamic(() => import('../policy/PermissionsMatrix'), {
  loading: () => <SettingsTabSkeleton title="Permissions Matrix" description="Loading permissions configuration..." showTable={true} showForm={false} />,
  ssr: false
});

const UserRoleAssignment = dynamic(() => import('../policy/UserRoleAssignment'), {
  loading: () => <SettingsTabSkeleton title="User Role Assignment" description="Loading user role configuration..." showDropdowns={true} />,
  ssr: false
});

const PolicyManagement = dynamic(() => import('../policy/PolicyManagement'), {
  loading: () => <SettingsTabSkeleton title="Policy Management" description="Loading policy configuration..." showTextArea={true} showTable={true} noCard={true} />,
  ssr: false
});

const AdminApiKeysSetup = dynamic(() => import('../api/AdminApiKeysSetup'), {
  loading: () => <SettingsTabSkeleton title="API Keys" description="Loading API key configuration..." />,
  ssr: false
});

const SecuritySettingsPage = (): JSX.Element => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');
  const [twoFactorAuth, setTwoFactorAuth] = React.useState(false);

  // Map URL slugs (kebab-case) to Tab Labels
  const slugToLabelMap: Record<string, string> = {
    'roles': 'Roles',
    'permissions': 'Permissions',
    'user-roles': 'User Roles',
    'policies': 'Policies',
    'api-keys': 'API Keys',
    'security': 'Security'
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
    {
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
              {/* Add more security settings here */}
            </div>
          </CardContent>
        </Card>
      ),
    }
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
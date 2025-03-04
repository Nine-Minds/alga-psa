'use client';

import { useState, useEffect } from 'react';
import { Card, Flex, Heading } from '@radix-ui/themes';
import * as Tabs from '@radix-ui/react-tabs';
import RoleManagement from 'server/src/components/settings/policy/RoleManagement';
import PermissionManagement from 'server/src/components/settings/policy/PermissionManagement';
import UserRoleAssignment from 'server/src/components/settings/policy/UserRoleAssignment';
import PolicyManagement from 'server/src/components/settings/policy/PolicyManagement';
import AdminApiKeysSetup from 'server/src/components/settings/api/AdminApiKeysSetup';
import { Switch } from "server/src/components/ui/Switch";
import { Label } from "server/src/components/ui/Label";

export default function SecuritySettingsPage() {
  const [twoFactorAuth, setTwoFactorAuth] = useState(false);

  return (
    <Card className="m-4 p-4">
      <Heading size="4" className="mb-4">Security Settings</Heading>
      <Tabs.Root defaultValue="roles" className="w-full">
        <Tabs.List className="flex border-b mb-4">
          <Tabs.Trigger value="roles" className="px-4 py-2 border-b-2 border-transparent hover:border-gray-300 focus:outline-none">Roles</Tabs.Trigger>
          <Tabs.Trigger value="permissions" className="px-4 py-2 border-b-2 border-transparent hover:border-gray-300 focus:outline-none">Permissions</Tabs.Trigger>
          <Tabs.Trigger value="user-roles" className="px-4 py-2 border-b-2 border-transparent hover:border-gray-300 focus:outline-none">User Roles</Tabs.Trigger>
          <Tabs.Trigger value="policies" className="px-4 py-2 border-b-2 border-transparent hover:border-gray-300 focus:outline-none">Policies</Tabs.Trigger>
          <Tabs.Trigger value="api-keys" className="px-4 py-2 border-b-2 border-transparent hover:border-gray-300 focus:outline-none">API Keys</Tabs.Trigger>
          <Tabs.Trigger value="security" className="px-4 py-2 border-b-2 border-transparent hover:border-gray-300 focus:outline-none">Security</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="roles">
          <RoleManagement />
        </Tabs.Content>
        <Tabs.Content value="permissions">
          <PermissionManagement />
        </Tabs.Content>
        <Tabs.Content value="user-roles">
          <UserRoleAssignment />
        </Tabs.Content>
        <Tabs.Content value="policies">
          <PolicyManagement />
        </Tabs.Content>
        <Tabs.Content value="api-keys">
          <AdminApiKeysSetup />
        </Tabs.Content>
        <Tabs.Content value="security">
          <Card>
            <div className="p-4">
              <h2 className="text-lg font-semibold mb-2">Security Settings</h2>
              <p className="text-sm text-gray-600 mb-4">Manage security options for your account</p>
              <div className="flex items-center space-x-2">
                <Switch
                  id="two-factor-auth"
                  checked={twoFactorAuth}
                  onCheckedChange={setTwoFactorAuth}
                />
                <Label htmlFor="two-factor-auth">Two-Factor Authentication</Label>
              </div>
              {/* Add more security settings */}
            </div>
          </Card>
        </Tabs.Content>
      </Tabs.Root>
    </Card>
  );
}

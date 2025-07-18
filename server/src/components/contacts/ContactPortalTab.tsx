'use client';

import React, { useEffect, useState } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Switch } from 'server/src/components/ui/Switch';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Mail, Shield, User } from 'lucide-react';
import { IContact } from 'server/src/interfaces';
import { 
  updateContactPortalAdminStatus, 
  getUserByContactId 
} from 'server/src/lib/actions/contact-actions/contactActions';
import { 
  assignRoleToUser, 
  removeRoleFromUser,
  getRoles 
} from 'server/src/lib/actions/policyActions';
import { updateClientUser } from 'server/src/lib/actions/client-portal-actions/clientUserActions';
import toast from 'react-hot-toast';
import SettingsTabSkeleton from 'server/src/components/ui/skeletons/SettingsTabSkeleton';

interface ContactPortalTabProps {
  contact: IContact;
  currentUserPermissions: {
    canInvite: boolean;
    canUpdateRoles: boolean;
    canRead: boolean;
  };
}

interface ClientRole {
  role_id: string;
  role_name: string;
}

interface UserRole {
  role_id: string;
  role_name: string;
}

export function ContactPortalTab({ contact, currentUserPermissions }: ContactPortalTabProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [existingUser, setExistingUser] = useState<any>(null);
  const [isPortalAdmin, setIsPortalAdmin] = useState(contact.is_client_admin || false);
  const [clientRoles, setClientRoles] = useState<ClientRole[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);

  useEffect(() => {
    loadData();
  }, [contact.contact_name_id]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      // Check for existing user
      const { user, error } = await getUserByContactId(contact.contact_name_id);
      if (!error && user) {
        setExistingUser(user);
        // Set user roles
        if (user.roles && Array.isArray(user.roles)) {
          setUserRoles(user.roles);
        }
      }

      // Load available client roles
      const roles = await getRoles();
      const clientPortalRoles = roles.filter(role => role.client && !role.msp);
      setClientRoles(clientPortalRoles);
    } catch (error) {
      console.error('Error loading portal tab data:', error);
      toast.error("Failed to load portal information");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendInvitation = async () => {
    if (!currentUserPermissions.canInvite) {
      toast.error("You do not have permission to send invitations");
      return;
    }

    // For now, just show a message that this feature is coming soon
    toast("Client portal invitation feature will be available soon", {
      icon: '🚧'
    });
  };

  const handlePortalAdminToggle = async (checked: boolean) => {
    if (!currentUserPermissions.canUpdateRoles) {
      toast.error("You do not have permission to update client settings");
      return;
    }

    setIsUpdating(true);
    try {
      const result = await updateContactPortalAdminStatus(contact.contact_name_id, checked);
      if (result.success) {
        setIsPortalAdmin(checked);
        toast.success(checked ? "Contact marked as admin for client portal" : "Contact unmarked as admin for client portal");
      } else {
        toast.error(result.error || "Failed to update status");
      }
    } catch (error) {
      console.error('Error updating portal admin status:', error);
      toast.error("Failed to update admin flag");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAddRole = async () => {
    if (!currentUserPermissions.canUpdateRoles || !existingUser || !selectedRoleId) {
      toast.error("You do not have permission to update user roles");
      return;
    }

    setIsUpdating(true);
    try {
      await assignRoleToUser(existingUser.user_id, selectedRoleId);
      
      toast.success("Role added successfully");
      setSelectedRoleId('');
      
      // Reload user data
      await loadData();
    } catch (error) {
      console.error('Error adding role:', error);
      toast.error("Failed to add role");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleRemoveRole = async (roleId: string) => {
    if (!currentUserPermissions.canUpdateRoles || !existingUser) {
      toast.error("You do not have permission to update user roles");
      return;
    }

    setIsUpdating(true);
    try {
      await removeRoleFromUser(existingUser.user_id, roleId);
      
      toast.success("Role removed successfully");
      
      // Reload user data
      await loadData();
    } catch (error) {
      console.error('Error removing role:', error);
      toast.error("Failed to remove role");
    } finally {
      setIsUpdating(false);
    }
  };

  if (isLoading) {
    return (
      <SettingsTabSkeleton
        title="Client Portal Access"
        description="Loading portal information..."
        showForm={true}
        showTable={false}
        noCard={false}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Client Portal Access
          </CardTitle>
          <CardDescription>
            Manage client portal access and permissions for this contact
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* User Status and Actions */}
          {!existingUser ? (
            <div className="space-y-6">
              {/* Portal Admin Setting - Only shows when no user exists */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="portal-admin" className="text-base">
                    Portal Administrator
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    When invited, users with this flag will be created with admin role in the client portal
                  </p>
                </div>
                <Switch
                  id="portal-admin"
                  checked={isPortalAdmin}
                  onCheckedChange={handlePortalAdminToggle}
                  disabled={!currentUserPermissions.canUpdateRoles || isUpdating}
                />
              </div>
              
              <div className="border-t pt-6">
                <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-medium">No Portal Access</h4>
                    <p className="text-sm text-muted-foreground">
                      This contact does not have client portal access yet
                    </p>
                  </div>
                  <Button
                    id="send-invite-button"
                    onClick={handleSendInvitation}
                    disabled={!currentUserPermissions.canInvite || !isPortalAdmin}
                    className="flex items-center gap-2"
                    title={!isPortalAdmin ? "Enable Portal Administrator to send invitation" : undefined}
                  >
                    <Mail className="h-4 w-4" />
                    Send Portal Invitation
                  </Button>
                </div>
                {!isPortalAdmin && (
                  <Alert>
                    <AlertDescription>
                      Enable Portal Administrator to send an invitation. Currently, only admin invitations are supported.
                    </AlertDescription>
                  </Alert>
                )}
                </div>
              </div>
            </div>
          ) : (
            <div className="border-t pt-6">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="h-4 w-4" />
                  <span>Portal access active</span>
                </div>
                
                {/* Role Management */}
                <div className="space-y-2">
                  <Label>Portal Roles</Label>
                  
                  {/* Display current roles */}
                  <div className="space-y-2">
                    {userRoles.length > 0 ? (
                      userRoles.map((role) => (
                        <div key={role.role_id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                          <span className="text-sm">{role.role_name}</span>
                          <Button
                            id="remove-permission-button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveRole(role.role_id)}
                            disabled={!currentUserPermissions.canUpdateRoles || isUpdating}
                            className="text-red-500 hover:text-red-600"
                          >
                            Remove
                          </Button>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No roles assigned</p>
                    )}
                  </div>
                  
                  {/* Add new role */}
                  <div className="flex gap-2">
                    <CustomSelect
                      id="add-role"
                      value={selectedRoleId}
                      onValueChange={setSelectedRoleId}
                      disabled={!currentUserPermissions.canUpdateRoles || isUpdating}
                      options={clientRoles
                        .filter(role => !userRoles.some(userRole => userRole.role_id === role.role_id))
                        .map(role => ({
                          value: role.role_id,
                          label: role.role_name
                        }))}
                      placeholder="Select role to add"
                      className="flex-1"
                    />
                    {selectedRoleId && (
                      <Button
                        id="add-role-button"
                        onClick={handleAddRole}
                        disabled={!currentUserPermissions.canUpdateRoles || isUpdating}
                        size="sm"
                      >
                        Add Role
                      </Button>
                    )}
                  </div>
                </div>

                {/* User Status */}
                <div className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <Label htmlFor="user-status">User Status</Label>
                    <p className="text-sm text-muted-foreground">
                      {existingUser.is_inactive ? 'User is currently inactive' : 'User is currently active'}
                    </p>
                  </div>
                  <Switch
                    id="user-status"
                    checked={!existingUser.is_inactive}
                    onCheckedChange={async (checked) => {
                      if (!currentUserPermissions.canUpdateRoles) {
                        toast.error("You do not have permission to update user status");
                        return;
                      }
                      setIsUpdating(true);
                      try {
                        await updateClientUser(existingUser.user_id, { is_inactive: !checked });
                        toast.success(`User ${checked ? 'activated' : 'deactivated'} successfully`);
                        await loadData();
                      } catch (error) {
                        console.error('Error updating user status:', error);
                        toast.error("Failed to update user status");
                      } finally {
                        setIsUpdating(false);
                      }
                    }}
                    disabled={!currentUserPermissions.canUpdateRoles || isUpdating}
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
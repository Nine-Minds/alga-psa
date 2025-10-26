'use client';

import React, { useEffect, useState } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Switch } from 'server/src/components/ui/Switch';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Mail, Shield, User, Info } from 'lucide-react';
import { IContact } from 'server/src/interfaces';
import { 
  updateContactPortalAdminStatus, 
  getUserByContactId 
} from 'server/src/lib/actions/contact-actions/contactActions';
import { 
  sendPortalInvitation,
  getPortalInvitations,
  revokePortalInvitation,
  InvitationHistoryItem
} from 'server/src/lib/actions/portal-actions/portalInvitationActions';
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
  const [isSendingInvitation, setIsSendingInvitation] = useState(false);
  const [existingUser, setExistingUser] = useState<any>(null);
  const [isPortalAdmin, setIsPortalAdmin] = useState(contact.is_client_admin || false);
  const [clientRoles, setClientRoles] = useState<ClientRole[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [invitationHistory, setInvitationHistory] = useState<InvitationHistoryItem[]>([]);
  const [resendingInvitationId, setResendingInvitationId] = useState<string | null>(null);

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

      // Load invitation history
      const invitations = await getPortalInvitations(contact.contact_name_id);
      setInvitationHistory(invitations);
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

    setIsSendingInvitation(true);
    try {
      const result = await sendPortalInvitation(contact.contact_name_id);
      
      if (result.success) {
        toast.success(result.message || "Portal invitation sent successfully!");
        // Reload invitation history to show the new invitation
        await loadData();
      } else {
        toast.error(
          <div>
            <p>{result.error || "Failed to send invitation"}</p>
            {result.error?.includes('default location') && (
              <p className="text-sm mt-1">
                Configure a default location with email in Client Settings → Locations
              </p>
            )}
          </div>
        );
      }
    } catch (error) {
      console.error('Error sending portal invitation:', error);
      toast.error("Failed to send invitation");
    } finally {
      setIsSendingInvitation(false);
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    try {
      setIsUpdating(true);
      const result = await revokePortalInvitation(invitationId);
      
      if (result.success) {
        toast.success("Invitation revoked successfully");
        // Reload invitation history
        await loadData();
      } else {
        toast.error(result.error || "Failed to revoke invitation");
      }
    } catch (error) {
      console.error('Error revoking invitation:', error);
      toast.error("Failed to revoke invitation");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleResendInvitation = async (invitationId: string) => {
    if (!currentUserPermissions.canInvite) {
      toast.error("You do not have permission to send invitations");
      return;
    }

    setResendingInvitationId(invitationId);
    try {
      const result = await sendPortalInvitation(contact.contact_name_id);

      if (result.success) {
        toast.success(result.message || "Portal invitation resent successfully!");
        await loadData();
      } else {
        toast.error(
          <div>
            <p>{result.error || "Failed to resend invitation"}</p>
            {result.error?.includes('default location') && (
              <p className="text-sm mt-1">
                Configure a default location with email in Client Settings → Locations
              </p>
            )}
          </div>
        );
      }
    } catch (error) {
      console.error('Error resending portal invitation:', error);
      toast.error("Failed to resend invitation");
    } finally {
      setResendingInvitationId(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (status: string) => {
    const baseClasses = "inline-flex px-2 py-1 text-xs font-medium rounded-full";
    switch (status) {
      case 'pending':
        return `${baseClasses} bg-yellow-100 text-yellow-800`;
      case 'used':
        return `${baseClasses} bg-green-100 text-green-800`;
      case 'expired':
        return `${baseClasses} bg-red-100 text-red-800`;
      case 'revoked':
        return `${baseClasses} bg-gray-100 text-gray-800`;
      default:
        return `${baseClasses} bg-gray-100 text-gray-800`;
    }
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
                    When enabled, the user will be created with Client Admin role. When disabled, they'll get Client User role.
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
                <Alert className="mb-4">
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Invitation emails will be sent from your organization's email system. 
                    Replies will go to your client's default location email address.
                  </AlertDescription>
                </Alert>
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
                    disabled={!currentUserPermissions.canInvite || isSendingInvitation}
                    className="flex items-center gap-2"
                  >
                    <Mail className="h-4 w-4" />
                    {isSendingInvitation ? "Sending..." : "Send Portal Invitation"}
                  </Button>
                </div>
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

          {/* Invitation History */}
          {invitationHistory.length > 0 && (
            <div className="border-t pt-6">
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium">Invitation History</h4>
                  <p className="text-sm text-muted-foreground">
                    Recent portal invitations sent to this contact
                  </p>
                </div>
                
                <div className="space-y-2">
                  {invitationHistory.map((invitation) => (
                    <div key={invitation.invitation_id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{invitation.email}</span>
                          <span className={getStatusBadge(invitation.status)}>
                            {invitation.status}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Sent: {formatDate(invitation.created_at)}
                          {invitation.status === 'pending' && (
                            <span> • Expires: {formatDate(invitation.expires_at)}</span>
                          )}
                          {invitation.used_at && (
                            <span> • Used: {formatDate(invitation.used_at)}</span>
                          )}
                        </div>
                      </div>
                      
                      {currentUserPermissions.canInvite && (
                        <div className="flex items-center gap-2">
                          {(invitation.status === 'pending' || invitation.status === 'expired' || invitation.status === 'revoked' || invitation.status === 'used') && (
                            <Button
                              id={`resend-invitation-${invitation.invitation_id}`}
                              variant="outline"
                              size="sm"
                              onClick={() => handleResendInvitation(invitation.invitation_id)}
                              disabled={resendingInvitationId === invitation.invitation_id}
                            >
                              {resendingInvitationId === invitation.invitation_id ? 'Resending...' : 'Resend'}
                            </Button>
                          )}
                          {invitation.status === 'pending' && (
                            <Button
                              id={`revoke-invitation-${invitation.invitation_id}`}
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRevokeInvitation(invitation.invitation_id)}
                              disabled={isUpdating}
                              className="text-red-500 hover:text-red-600"
                            >
                              Revoke
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

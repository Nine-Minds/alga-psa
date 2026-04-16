'use client';

import { useEffect, useState } from 'react';
import type { IBoard } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Mail, Shield, User, Info, RefreshCw } from 'lucide-react';
import { Badge } from '@alga-psa/ui/components/Badge';
import type { BadgeVariant } from '@alga-psa/ui/components/Badge';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import type { IContact } from '@alga-psa/types';
import {
  updateContactPortalAdminStatus,
  getUserByContactId,
  getClientPortalVisibilityBoardsByClient,
  getClientPortalVisibilityGroupById,
  getClientPortalVisibilityGroupsForContact,
  assignClientPortalVisibilityGroupToContact,
  createClientPortalVisibilityGroupForContact,
  updateClientPortalVisibilityGroupForContact,
  deleteClientPortalVisibilityGroupForContact
} from '../../actions/contact-actions/contactActions';
import {
  assignRoleToUser,
  removeRoleFromUser,
  getRoles
} from '@alga-psa/auth/actions';
import {
  sendPortalInvitation,
  getPortalInvitations,
  revokePortalInvitation,
  updateClientUser
} from '../../actions/contact-actions/portalInvitationBridgeActions';
import type { InvitationHistoryItem } from '@alga-psa/portal-shared/types';
import { useToast } from '@alga-psa/ui';
import SettingsTabSkeleton from '@alga-psa/ui/components/skeletons/SettingsTabSkeleton';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const FULL_ACCESS_VALUE = '__full_access__';

interface VisibilityGroup {
  group_id: string;
  name: string;
  description: string | null;
  board_count: number;
}

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
  const { t } = useTranslation('msp/contacts');
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
  const [isRefreshingInvitationHistory, setIsRefreshingInvitationHistory] = useState(false);
  const [visibilityGroups, setVisibilityGroups] = useState<VisibilityGroup[]>([]);
  const [visibilityBoards, setVisibilityBoards] = useState<IBoard[]>([]);
  const [selectedVisibilityGroupId, setSelectedVisibilityGroupId] = useState<string | null>(
    contact.portal_visibility_group_id || null
  );
  const [visibilityGroupName, setVisibilityGroupName] = useState('');
  const [visibilityGroupDescription, setVisibilityGroupDescription] = useState('');
  const [visibilityGroupBoardIds, setVisibilityGroupBoardIds] = useState<string[]>([]);
  const [editingVisibilityGroupId, setEditingVisibilityGroupId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, [contact.contact_name_id]);

  const loadInvitationHistory = async () => {
    const invitations = await getPortalInvitations(contact.contact_name_id);
    setInvitationHistory(invitations);
  };

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

      const [groupRows, boardRows] = await Promise.all([
        getClientPortalVisibilityGroupsForContact(contact.contact_name_id),
        getClientPortalVisibilityBoardsByClient(contact.contact_name_id),
      ]);

      setVisibilityGroups(groupRows || []);
      setVisibilityBoards(boardRows || []);
      setSelectedVisibilityGroupId(contact.portal_visibility_group_id || null);

      // Load invitation history
      await loadInvitationHistory();
    } catch (error) {
      console.error('Error loading portal tab data:', error);
      toast({
        title: t('contactPortalTab.toast.errorTitle', { defaultValue: 'Error' }),
        description: t('contactPortalTab.toast.loadError', { defaultValue: 'Failed to load portal information' }),
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const resetVisibilityGroupForm = () => {
    setEditingVisibilityGroupId(null);
    setVisibilityGroupName('');
    setVisibilityGroupDescription('');
    setVisibilityGroupBoardIds([]);
  };

  const handleVisibilityGroupSelect = async (selectedValue: string) => {
    const groupId = selectedValue === FULL_ACCESS_VALUE ? null : selectedValue;
    const previousValue = selectedVisibilityGroupId;
    setSelectedVisibilityGroupId(groupId);

    try {
      setIsUpdating(true);
      await assignClientPortalVisibilityGroupToContact(contact.contact_name_id, groupId);
      toast({
        title: 'Success',
        description: 'Contact visibility assignment updated'
      });
    } catch (error) {
      setSelectedVisibilityGroupId(previousValue);
      console.error('Error assigning visibility group:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to assign visibility group',
        variant: 'destructive'
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleToggleGroupBoard = (boardId: string) => {
    setVisibilityGroupBoardIds((current) =>
      current.includes(boardId)
        ? current.filter((value) => value !== boardId)
        : [...current, boardId]
    );
  };

  const handleSaveVisibilityGroup = async () => {
    const trimmedName = visibilityGroupName.trim();
    if (!trimmedName) {
      toast({
        title: 'Validation Error',
        description: 'Visibility group name is required',
        variant: 'destructive'
      });
      return;
    }

    setIsUpdating(true);
    try {
      if (editingVisibilityGroupId) {
        await updateClientPortalVisibilityGroupForContact(contact.contact_name_id, editingVisibilityGroupId, {
          name: trimmedName,
          description: visibilityGroupDescription.trim() || null,
          boardIds: visibilityGroupBoardIds
        });
        toast({ title: 'Success', description: 'Visibility group updated' });
      } else {
        await createClientPortalVisibilityGroupForContact(contact.contact_name_id, {
          name: trimmedName,
          description: visibilityGroupDescription.trim() || null,
          boardIds: visibilityGroupBoardIds
        });
        toast({ title: 'Success', description: 'Visibility group created' });
      }

      resetVisibilityGroupForm();
      const updatedGroups = await getClientPortalVisibilityGroupsForContact(contact.contact_name_id);
      setVisibilityGroups(updatedGroups || []);
    } catch (error) {
      console.error('Failed to save visibility group:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save visibility group',
        variant: 'destructive'
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleEditVisibilityGroup = async (groupId: string) => {
    try {
      const group = await getClientPortalVisibilityGroupById(contact.contact_name_id, groupId);
      setEditingVisibilityGroupId(group.group_id);
      setVisibilityGroupName(group.name);
      setVisibilityGroupDescription(group.description || '');
      setVisibilityGroupBoardIds(group.board_ids || []);
    } catch (error) {
      console.error('Failed to load visibility group:', error);
      toast({
        title: 'Error',
        description: 'Failed to load visibility group for editing',
        variant: 'destructive'
      });
    }
  };

  const handleDeleteVisibilityGroup = async (groupId: string) => {
    if (!confirm('Delete this visibility group?')) {
      return;
    }

    setIsUpdating(true);
    try {
      await deleteClientPortalVisibilityGroupForContact(contact.contact_name_id, groupId);
      if (selectedVisibilityGroupId === groupId) {
        setSelectedVisibilityGroupId(null);
      }
      const updatedGroups = await getClientPortalVisibilityGroupsForContact(contact.contact_name_id);
      setVisibilityGroups(updatedGroups || []);
      toast({ title: 'Success', description: 'Visibility group deleted' });
    } catch (error) {
      console.error('Failed to delete visibility group:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete visibility group',
        variant: 'destructive'
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleRefreshInvitationHistory = async () => {
    setIsRefreshingInvitationHistory(true);
    try {
      await loadInvitationHistory();
    } catch (error) {
      console.error('Error refreshing invitation history:', error);
      toast({
        title: t('contactPortalTab.toast.errorTitle', { defaultValue: 'Error' }),
        description: t('contactPortalTab.toast.refreshHistoryError', { defaultValue: 'Failed to refresh invitation history' }),
        variant: "destructive"
      });
    } finally {
      setIsRefreshingInvitationHistory(false);
    }
  };

  const handleSendInvitation = async () => {
    if (!currentUserPermissions.canInvite) {
      toast({
        title: t('contactPortalTab.toast.permissionDeniedTitle', { defaultValue: 'Permission Denied' }),
        description: t('contactPortalTab.toast.sendInvitePermissionDenied', { defaultValue: 'You do not have permission to send invitations' }),
        variant: "destructive"
      });
      return;
    }

    setIsSendingInvitation(true);
    try {
      const result = await sendPortalInvitation(contact.contact_name_id);

      if (result.success) {
        toast({
          title: t('contactPortalTab.toast.successTitle', { defaultValue: 'Success' }),
          description: result.message || t('contactPortalTab.toast.sendInviteSuccess', { defaultValue: 'Portal invitation sent successfully!' })
        });
        // Reload invitation history to show the new invitation
        await loadData();
      } else {
        toast({
          title: t('contactPortalTab.toast.errorTitle', { defaultValue: 'Error' }),
          description: result.error || result.message || t('contactPortalTab.toast.sendInviteFailed', { defaultValue: 'Failed to send invitation' }),
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Error sending portal invitation:', error);
      toast({
        title: t('contactPortalTab.toast.errorTitle', { defaultValue: 'Error' }),
        description: t('contactPortalTab.toast.sendInviteFailed', { defaultValue: 'Failed to send invitation' }),
        variant: "destructive"
      });
    } finally {
      setIsSendingInvitation(false);
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    try {
      setIsUpdating(true);
      const result = await revokePortalInvitation(invitationId);

      if (result.success) {
        toast({
          title: t('contactPortalTab.toast.successTitle', { defaultValue: 'Success' }),
          description: t('contactPortalTab.toast.revokeInviteSuccess', { defaultValue: 'Invitation revoked successfully' })
        });
        // Reload invitation history
        await loadData();
      } else {
        toast({
          title: t('contactPortalTab.toast.errorTitle', { defaultValue: 'Error' }),
          description: result.error || t('contactPortalTab.toast.revokeInviteFailed', { defaultValue: 'Failed to revoke invitation' }),
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Error revoking invitation:', error);
      toast({
        title: t('contactPortalTab.toast.errorTitle', { defaultValue: 'Error' }),
        description: t('contactPortalTab.toast.revokeInviteFailed', { defaultValue: 'Failed to revoke invitation' }),
        variant: "destructive"
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleResendInvitation = async (invitationId: string) => {
    if (!currentUserPermissions.canInvite) {
      toast({
        title: t('contactPortalTab.toast.permissionDeniedTitle', { defaultValue: 'Permission Denied' }),
        description: t('contactPortalTab.toast.sendInvitePermissionDenied', { defaultValue: 'You do not have permission to send invitations' }),
        variant: "destructive"
      });
      return;
    }

    setResendingInvitationId(invitationId);
    try {
      const result = await sendPortalInvitation(contact.contact_name_id);

      if (result.success) {
        toast({
          title: t('contactPortalTab.toast.successTitle', { defaultValue: 'Success' }),
          description: result.message || t('contactPortalTab.toast.resendInviteSuccess', { defaultValue: 'Portal invitation resent successfully!' })
        });
        await loadData();
      } else {
        toast({
          title: t('contactPortalTab.toast.errorTitle', { defaultValue: 'Error' }),
          description: result.error || result.message || t('contactPortalTab.toast.resendInviteFailed', { defaultValue: 'Failed to resend invitation' }),
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Error resending portal invitation:', error);
      toast({
        title: t('contactPortalTab.toast.errorTitle', { defaultValue: 'Error' }),
        description: t('contactPortalTab.toast.resendInviteFailed', { defaultValue: 'Failed to resend invitation' }),
        variant: "destructive"
      });
    } finally {
      setResendingInvitationId(null);
    }
  };

  const formatDate = (dateValue: string | Date) => {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadgeVariant = (status: string): BadgeVariant => {
    switch (status) {
      case 'pending':
        return 'warning';
      case 'used':
        return 'success';
      case 'expired':
        return 'error';
      case 'revoked':
        return 'default-muted';
      default:
        return 'default-muted';
    }
  };

  const visibilityGroupSelectOptions = [
    { value: FULL_ACCESS_VALUE, label: 'Full access' },
    ...visibilityGroups.map((group) => ({
      value: group.group_id,
      label: `${group.name} (${group.board_count} boards)`
    }))
  ];

  const handlePortalAdminToggle = async (checked: boolean) => {
    if (!currentUserPermissions.canUpdateRoles) {
      toast({
        title: t('contactPortalTab.toast.permissionDeniedTitle', { defaultValue: 'Permission Denied' }),
        description: t('contactPortalTab.toast.updatePortalSettingsPermissionDenied', { defaultValue: 'You do not have permission to update client settings' }),
        variant: "destructive"
      });
      return;
    }

    setIsUpdating(true);
    try {
      const result = await updateContactPortalAdminStatus(contact.contact_name_id, checked);
      if (result.success) {
        setIsPortalAdmin(checked);
        toast({
          title: t('contactPortalTab.toast.successTitle', { defaultValue: 'Success' }),
          description: checked
            ? t('contactPortalTab.toast.portalAdminEnabled', { defaultValue: 'Contact marked as admin for client portal' })
            : t('contactPortalTab.toast.portalAdminDisabled', { defaultValue: 'Contact unmarked as admin for client portal' })
        });
      } else {
        toast({
          title: t('contactPortalTab.toast.errorTitle', { defaultValue: 'Error' }),
          description: result.error || t('contactPortalTab.toast.updatePortalAdminFailed', { defaultValue: 'Failed to update status' }),
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Error updating portal admin status:', error);
      toast({
        title: t('contactPortalTab.toast.errorTitle', { defaultValue: 'Error' }),
        description: t('contactPortalTab.toast.updateAdminFailed', { defaultValue: 'Failed to update admin flag' }),
        variant: "destructive"
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAddRole = async () => {
    if (!currentUserPermissions.canUpdateRoles || !existingUser || !selectedRoleId) {
      toast({
        title: t('contactPortalTab.toast.permissionDeniedTitle', { defaultValue: 'Permission Denied' }),
        description: t('contactPortalTab.toast.updateRolesPermissionDenied', { defaultValue: 'You do not have permission to update user roles' }),
        variant: "destructive"
      });
      return;
    }

    setIsUpdating(true);
    try {
      await assignRoleToUser(existingUser.user_id, selectedRoleId);

      toast({
        title: t('contactPortalTab.toast.successTitle', { defaultValue: 'Success' }),
        description: t('contactPortalTab.toast.roleAdded', { defaultValue: 'Role added successfully' })
      });
      setSelectedRoleId('');

      // Reload user data
      await loadData();
    } catch (error) {
      console.error('Error adding role:', error);
      toast({
        title: t('contactPortalTab.toast.errorTitle', { defaultValue: 'Error' }),
        description: t('contactPortalTab.toast.addRoleFailed', { defaultValue: 'Failed to add role' }),
        variant: "destructive"
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleRemoveRole = async (roleId: string) => {
    if (!currentUserPermissions.canUpdateRoles || !existingUser) {
      toast({
        title: t('contactPortalTab.toast.permissionDeniedTitle', { defaultValue: 'Permission Denied' }),
        description: t('contactPortalTab.toast.updateRolesPermissionDenied', { defaultValue: 'You do not have permission to update user roles' }),
        variant: "destructive"
      });
      return;
    }

    setIsUpdating(true);
    try {
      await removeRoleFromUser(existingUser.user_id, roleId);

      toast({
        title: t('contactPortalTab.toast.successTitle', { defaultValue: 'Success' }),
        description: t('contactPortalTab.toast.roleRemoved', { defaultValue: 'Role removed successfully' })
      });

      // Reload user data
      await loadData();
    } catch (error) {
      console.error('Error removing role:', error);
      toast({
        title: t('contactPortalTab.toast.errorTitle', { defaultValue: 'Error' }),
        description: t('contactPortalTab.toast.removeRoleFailed', { defaultValue: 'Failed to remove role' }),
        variant: "destructive"
      });
    } finally {
      setIsUpdating(false);
    }
  };

  if (isLoading) {
    return (
      <SettingsTabSkeleton
        title={t('contactPortalTab.title', { defaultValue: 'Client Portal Access' })}
        description={t('contactPortalTab.loadingDescription', { defaultValue: 'Loading portal information...' })}
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
            {t('contactPortalTab.title', { defaultValue: 'Client Portal Access' })}
          </CardTitle>
          <CardDescription>
            {t('contactPortalTab.description', { defaultValue: 'Manage client portal access and permissions for this contact' })}
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
                    {t('contactPortalTab.portalAdmin.label', { defaultValue: 'Portal Administrator' })}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t('contactPortalTab.portalAdmin.helper', { defaultValue: 'When enabled, the user will be created with Client Admin role. When disabled, they\'ll get Client User role.' })}
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
                    {t('contactPortalTab.information', {
                      defaultValue:
                        'Invitation emails will be sent from your organization\'s email system. Replies will go to your client\'s default location email address.'
                    })}
                  </AlertDescription>
                </Alert>
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-medium">{t('contactPortalTab.noAccess.title', { defaultValue: 'No Portal Access' })}</h4>
                    <p className="text-sm text-muted-foreground">
                      {t('contactPortalTab.noAccess.description', { defaultValue: 'This contact does not have client portal access yet' })}
                    </p>
                  </div>
                  <Button
                    id="send-invite-button"
                    onClick={handleSendInvitation}
                    disabled={!currentUserPermissions.canInvite || isSendingInvitation}
                    className="flex items-center gap-2"
                    >
                      <Mail className="h-4 w-4" />
                    {isSendingInvitation
                      ? t('contactPortalTab.actions.sending', { defaultValue: 'Sending...' })
                      : t('contactPortalTab.actions.sendInvitation', { defaultValue: 'Send Portal Invitation' })}
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
                  <span>{t('contactPortalTab.activeAccess', { defaultValue: 'Portal access active' })}</span>
                </div>

                {/* Role Management */}
                <div className="space-y-2">
                  <Label>{t('contactPortalTab.roles.label', { defaultValue: 'Portal Roles' })}</Label>

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
                            {t('common.actions.remove', { defaultValue: 'Remove' })}
                          </Button>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">{t('contactPortalTab.roles.none', { defaultValue: 'No roles assigned' })}</p>
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
                      placeholder={t('contactPortalTab.roles.placeholder', { defaultValue: 'Select role to add' })}
                      className="flex-1"
                    />
                    {selectedRoleId && (
                      <Button
                        id="add-role-button"
                        onClick={handleAddRole}
                        disabled={!currentUserPermissions.canUpdateRoles || isUpdating}
                        size="sm"
                      >
                        {t('contactPortalTab.roles.addButton', { defaultValue: 'Add Role' })}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Last Login Info */}
                {existingUser.last_login_at && (
                  <div className="p-3 rounded-lg border bg-gray-50">
                    <Label className="text-sm font-medium">{t('contactPortalTab.lastLogin.label', { defaultValue: 'Last Login' })}</Label>
                    <div className="mt-1 space-y-1">
                      <p className="text-sm text-muted-foreground">
                        {formatDate(existingUser.last_login_at)}
                      </p>
                      {existingUser.last_login_method && (
                        <p className="text-xs text-muted-foreground">
                          {t('contactPortalTab.lastLogin.via', { defaultValue: 'via {{method}}', method: existingUser.last_login_method })}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* User Status */}
                <div className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <Label htmlFor="user-status">{t('contactPortalTab.userStatus.label', { defaultValue: 'User Status' })}</Label>
                    <p className="text-sm text-muted-foreground">
                      {existingUser.is_inactive
                        ? t('contactPortalTab.userStatus.inactive', { defaultValue: 'User is currently inactive' })
                        : t('contactPortalTab.userStatus.active', { defaultValue: 'User is currently active' })}
                    </p>
                  </div>
                  <Switch
                    id="user-status"
                    checked={!existingUser.is_inactive}
                    onCheckedChange={async (checked) => {
                      if (!currentUserPermissions.canUpdateRoles) {
                        toast({
                          title: t('contactPortalTab.toast.permissionDeniedTitle', { defaultValue: 'Permission Denied' }),
                          description: t('contactPortalTab.toast.updateStatusPermissionDenied', { defaultValue: 'You do not have permission to update user status' }),
                          variant: "destructive"
                        });
                        return;
                      }
                      setIsUpdating(true);
                      try {
                        await updateClientUser(existingUser.user_id, { is_inactive: !checked });
                        toast({
                          title: t('contactPortalTab.toast.successTitle', { defaultValue: 'Success' }),
                          description: checked
                            ? t('contactPortalTab.toast.userActivated', { defaultValue: 'User activated successfully' })
                            : t('contactPortalTab.toast.userDeactivated', { defaultValue: 'User deactivated successfully' })
                        });
                        await loadData();
                      } catch (error) {
                        console.error('Error updating user status:', error);
                        toast({
                          title: t('contactPortalTab.toast.errorTitle', { defaultValue: 'Error' }),
                          description: t('contactPortalTab.toast.updateUserStatusFailed', { defaultValue: 'Failed to update user status' }),
                          variant: "destructive"
                        });
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

          <div className="border-t pt-6">
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Ticket visibility group</Label>
                <p className="text-sm text-muted-foreground">
                  Assign a visibility group for this contact, or keep full access.
                </p>
              </div>
              <CustomSelect
                id="visibility-group-assignment"
                value={selectedVisibilityGroupId || FULL_ACCESS_VALUE}
                onValueChange={handleVisibilityGroupSelect}
                disabled={!currentUserPermissions.canUpdateRoles || isUpdating}
                options={visibilityGroupSelectOptions}
                placeholder="Select visibility assignment"
              />

              <div>
                <Label className="text-sm font-medium">Visibility groups for client</Label>
                <p className="text-sm text-muted-foreground">
                  Create or edit groups of boards and use them for contact assignments.
                </p>
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="visibility-group-name">Group name</Label>
                  <Input
                    id="visibility-group-name"
                    value={visibilityGroupName}
                    onChange={(event) => setVisibilityGroupName(event.target.value)}
                    placeholder="Group name"
                    disabled={isUpdating}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="visibility-group-description">Description</Label>
                  <TextArea
                    id="visibility-group-description"
                    value={visibilityGroupDescription}
                    onChange={(event) => setVisibilityGroupDescription(event.target.value)}
                    placeholder="Optional description"
                    rows={3}
                    disabled={isUpdating}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Boards</Label>
                  {visibilityBoards.length > 0 ? (
                    <div className="space-y-2 rounded-lg border p-3 max-h-56 overflow-y-auto">
                      {visibilityBoards.map((board) => {
                        if (!board.board_id) {
                          return null;
                        }

                        const checked = visibilityGroupBoardIds.includes(board.board_id);
                        return (
                          <label
                            key={board.board_id}
                            className="flex items-center space-x-2 text-sm"
                          >
                            <Checkbox
                              id={`visibility-group-board-${board.board_id}`}
                              checked={checked}
                              onChange={() => handleToggleGroupBoard(board.board_id!)}
                              disabled={isUpdating}
                            />
                            <span>{board.board_name}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No boards available</p>
                  )}
                </div>

                <div className="flex items-end justify-end gap-2">
                  {editingVisibilityGroupId && (
                    <Button
                      id="visibility-group-cancel-button"
                      variant="outline"
                      size="sm"
                      onClick={resetVisibilityGroupForm}
                      disabled={isUpdating}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button
                    id="visibility-group-save-button"
                    size="sm"
                    onClick={handleSaveVisibilityGroup}
                    disabled={isUpdating || !visibilityGroupName.trim()}
                  >
                    {editingVisibilityGroupId ? 'Update group' : 'Create group'}
                  </Button>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {visibilityGroups.length > 0 ? (
                visibilityGroups.map((group) => (
                  <div key={group.group_id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">{group.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {group.board_count} board{group.board_count === 1 ? '' : 's'}
                        </p>
                        {group.description ? (
                          <p className="text-xs text-muted-foreground">{group.description}</p>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          id={`visibility-group-edit-${group.group_id}`}
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditVisibilityGroup(group.group_id)}
                          disabled={isUpdating}
                        >
                          Edit
                        </Button>
                        <Button
                          id={`visibility-group-delete-${group.group_id}`}
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteVisibilityGroup(group.group_id)}
                          disabled={isUpdating}
                          className="text-red-600"
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No visibility groups yet</p>
              )}
            </div>
          </div>

          {/* Invitation History */}
          <div className="border-t pt-6">
            <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                  <h4 className="text-sm font-medium">{t('contactPortalTab.history.title', { defaultValue: 'Invitation History' })}</h4>
                  <p className="text-sm text-muted-foreground">
                    {t('contactPortalTab.history.description', { defaultValue: 'Recent portal invitations sent to this contact' })}
                  </p>
                </div>
                <Button
                  id="refresh-invitation-history-button"
                  variant="outline"
                  size="sm"
                  onClick={handleRefreshInvitationHistory}
                  disabled={isRefreshingInvitationHistory}
                  className="flex items-center gap-2"
                  >
                  <RefreshCw className={`h-4 w-4 ${isRefreshingInvitationHistory ? 'animate-spin' : ''}`} />
                  {isRefreshingInvitationHistory
                    ? t('contactPortalTab.actions.refreshing', { defaultValue: 'Refreshing...' })
                    : t('contactPortalTab.actions.refresh', { defaultValue: 'Refresh' })}
                </Button>
              </div>

              {invitationHistory.length > 0 ? (
                <div className="space-y-2">
                  {invitationHistory.map((invitation) => (
                    <div key={invitation.invitation_id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{invitation.email}</span>
                          <Badge variant={getStatusBadgeVariant(invitation.status)} size="sm">
                            {t(`contactPortalTab.history.status.${invitation.status}`, {
                              defaultValue: invitation.status
                            })}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t('contactPortalTab.history.sentPrefix', { defaultValue: 'Sent:' })} {formatDate(invitation.created_at)}
                          {invitation.status === 'pending' && (
                            <span> • {t('contactPortalTab.history.expiresPrefix', { defaultValue: 'Expires:' })} {formatDate(invitation.expires_at)}</span>
                          )}
                          {invitation.used_at && (
                            <span> • {t('contactPortalTab.history.usedPrefix', { defaultValue: 'Used:' })} {formatDate(invitation.used_at)}</span>
                          )}
                        </div>
                      </div>

                      {currentUserPermissions.canInvite && (
                        <div className="flex items-center gap-2">
                          {(invitation.status === 'pending' || invitation.status === 'expired' || invitation.status === 'revoked') && (
                            <Button
                              id={`resend-invitation-${invitation.invitation_id}`}
                              variant="outline"
                              size="sm"
                              onClick={() => handleResendInvitation(invitation.invitation_id)}
                              disabled={resendingInvitationId === invitation.invitation_id}
                            >
                              {resendingInvitationId === invitation.invitation_id
                                ? t('contactPortalTab.actions.resending', { defaultValue: 'Resending...' })
                                : t('contactPortalTab.actions.resend', { defaultValue: 'Resend' })}
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
                              {t('contactPortalTab.actions.revoke', { defaultValue: 'Revoke' })}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('contactPortalTab.history.empty', { defaultValue: 'No portal invitations have been sent to this contact yet.' })}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

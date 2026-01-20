'use client';

import React, { useState, useEffect } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IPermission, IUserWithRoles } from '@alga-psa/types';
import { IUser, IRole } from '@shared/interfaces/user.interfaces';
import { getCurrentUser, getUserRolesWithPermissions } from '@alga-psa/users/actions';
import { 
  getClientUserById, 
  updateClientUser, 
  resetClientUserPassword,
  getClientPortalRoles,
  getClientUserRoles,
  assignClientUserRole,
  removeClientUserRole
} from '@alga-psa/client-portal/actions';
import { useDrawer } from "@alga-psa/ui";
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { Eye, EyeOff, ChevronDown, ChevronUp, X } from 'lucide-react';
import ClientPasswordChangeForm from './ClientPasswordChangeForm';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';

interface ClientUserDetailsProps {
  userId: string;
  onUpdate: () => void;
}

const ClientUserDetails: React.FC<ClientUserDetailsProps> = ({ userId, onUpdate }) => {
  const { t } = useTranslation('clientPortal');
  const [user, setUser] = useState<IUser | null>(null);
  const [currentUser, setCurrentUser] = useState<IUserWithRoles | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { closeDrawer } = useDrawer();

  // Password reset states
  const [canResetPassword, setCanResetPassword] = useState(false);
  const [adminNewPassword, setAdminNewPassword] = useState('');
  const [showAdminNewPassword, setShowAdminNewPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [isOwnProfile, setIsOwnProfile] = useState(false);
  const [isAdminPasswordExpanded, setIsAdminPasswordExpanded] = useState(false);
  
  // Role management states
  const [userRoles, setUserRoles] = useState<IRole[]>([]);
  const [availableRoles, setAvailableRoles] = useState<IRole[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [canManageRoles, setCanManageRoles] = useState(false);

  useEffect(() => {
    fetchUserDetails();
    fetchCurrentUser();
  }, [userId]);

  const fetchCurrentUser = async () => {
    try {
      const user = await getCurrentUser();
      setCurrentUser(user);
      if (user) {
        // Check if user has permission to reset passwords
        const rolesWithPermissions = await getUserRolesWithPermissions(user.user_id);
        
        const hasPasswordResetPermission = rolesWithPermissions.some(role => 
          role.permissions.some((permission: IPermission) => 
            `${permission.resource}.${permission.action}` === 'user.reset_password'
          )
        );
        
        const hasRoleManagementPermission = rolesWithPermissions.some(role => 
          role.permissions.some((permission: IPermission) => 
            `${permission.resource}.${permission.action}` === 'user.update' ||
            `${permission.resource}.${permission.action}` === 'role.assign'
          )
        );
        
        setCanResetPassword(hasPasswordResetPermission);
        setCanManageRoles(hasRoleManagementPermission);
        setIsOwnProfile(user.user_id === userId);
        
        console.log('Current user roles:', user.roles?.map(r => r.role_name));
        console.log('Has password reset permission:', hasPasswordResetPermission);
        console.log('Has role management permission:', hasRoleManagementPermission);
        console.log('Is own profile:', user.user_id === userId);
      }
    } catch (err) {
      console.error('Error fetching current user:', err);
    }
  };

  const fetchUserDetails = async () => {
    try {
      setLoading(true);
      setError(null);
      const fetchedUser = await getClientUserById(userId);
      if (fetchedUser) {
        setUser(fetchedUser);
        setFirstName(fetchedUser.first_name || '');
        setLastName(fetchedUser.last_name || '');
        setEmail(fetchedUser.email);
        setIsActive(!fetchedUser.is_inactive);
        
        // Fetch user's current roles
        const roles = await getClientUserRoles(userId);
        setUserRoles(roles);
        
        // Fetch available roles for assignment
        const allRoles = await getClientPortalRoles();
        setAvailableRoles(allRoles);
      } else {
        setError(t('clientSettings.users.userNotFound', 'User not found'));
      }
    } catch (err) {
      console.error('Error fetching user details:', err);
      setError(t('clientSettings.users.failedToLoad', 'Failed to load user details. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (user) {
      try {
        const updatedUserData: Partial<IUser> = {
          first_name: firstName,
          last_name: lastName,
          email: email,
          is_inactive: !isActive,
        };
        
        const updatedUser = await updateClientUser(user.user_id, updatedUserData);
        if (updatedUser) {
          setUser(updatedUser);
          onUpdate();
          closeDrawer();
        } else {
          setError(t('clientSettings.users.failedToUpdate', 'Failed to update user. User not found.'));
        }
      } catch (err) {
        console.error('Error updating user:', err);
        setError(t('clientSettings.users.failedToUpdate', 'Failed to update user. Please try again.'));
      }
    }
  };

  const handleAssignRole = async () => {
    if (!selectedRoleId) return;
    
    try {
      await assignClientUserRole(userId, selectedRoleId);
      // Refresh user roles
      const updatedRoles = await getClientUserRoles(userId);
      setUserRoles(updatedRoles);
      setSelectedRoleId('');
    } catch (err) {
      console.error('Error assigning role:', err);
      setError(t('clientSettings.users.failedToAssignRole', 'Failed to assign role'));
    }
  };
  
  const handleRemoveRole = async (roleId: string) => {
    try {
      await removeClientUserRole(userId, roleId);
      // Refresh user roles
      const updatedRoles = await getClientUserRoles(userId);
      setUserRoles(updatedRoles);
    } catch (err) {
      console.error('Error removing role:', err);
      setError(t('clientSettings.users.failedToRemoveRole', 'Failed to remove role'));
    }
  };

  const handleAdminResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (adminNewPassword.length < 8) {
      setPasswordError(t('profile.changePassword.requirements'));
      return;
    }

    try {
      const result = await resetClientUserPassword(userId, adminNewPassword);
      if (result.success) {
        setPasswordSuccess(t('profile.changePassword.success'));
        setAdminNewPassword('');
        // Collapse the form after successful password change
        setTimeout(() => {
          setIsAdminPasswordExpanded(false);
          setPasswordSuccess(null);
        }, 2000);
      } else {
        setPasswordError(result.error || t('profile.changePassword.error'));
      }
    } catch (err) {
      setPasswordError(t('profile.changePassword.error'));
    }
  };

  if (loading) {
    return (
      <Card className="p-6">
        <CardContent>
          <div className="text-sm">{t('common.loading')}</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <CardContent>
          <div className="text-sm text-red-500">{t('common.error')}: {error}</div>
        </CardContent>
      </Card>
    );
  }

  if (!user) {
    return (
      <Card className="p-6">
        <CardContent>
          <div className="text-sm">{t('clientSettings.users.userNotFound', 'No user found')}</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="space-y-6 p-6">
      <h2 className="text-xl font-bold mb-6">{t('clientSettings.users.editUser')}</h2>
      
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-sm font-medium mb-2 block">
            {t('clientSettings.users.firstName')}
          </label>
          <Input
            id={`user-${userId}-first-name`}
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder={t('clientSettings.users.firstName')}
            className="w-full"
          />
        </div>

        <div>
          <label className="text-sm font-medium mb-2 block">
            {t('clientSettings.users.lastName')}
          </label>
          <Input
            id={`user-${userId}-last-name`}
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder={t('clientSettings.users.lastName')}
            className="w-full"
          />
        </div>

        <div>
          <label className="text-sm font-medium mb-2 block">
            {t('clientSettings.users.email')}
          </label>
          <Input
            id={`user-${userId}-email`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('clientSettings.users.email')}
            className="w-full"
          />
        </div>

        <div className="flex items-center justify-between py-3">
          <div className="flex-1">
            <div className="text-sm font-medium">{t('clientSettings.users.status')}</div>
            <div className="text-sm text-gray-500 block">{t('clientSettings.users.statusDescription', 'Set user account status')}</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm text-gray-500">
              {isActive ? t('clientSettings.users.active') : t('clientSettings.users.inactive')}
            </div>
            <Switch
              checked={isActive}
              onCheckedChange={(checked) => setIsActive(checked)}
              className="data-[state=checked]:bg-green-500"
            />
          </div>
        </div>

        {/* Role Management Section */}
        {canManageRoles && (
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                {t('clientSettings.users.roles')}
              </label>
              
              {/* Current Roles */}
              <div className="space-y-2 mb-4">
                {userRoles.length > 0 ? (
                  userRoles.map((role) => (
                    <div key={role.role_id} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                      <span className="text-sm">{role.role_name}</span>
                      <Button
                        id={`remove-role-${role.role_id}`}
                        onClick={() => handleRemoveRole(role.role_id)}
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500">{t('clientSettings.users.noRolesAssigned', 'No roles assigned')}</p>
                )}
              </div>
              
              {/* Add Role */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <CustomSelect
                    value={selectedRoleId}
                    onValueChange={setSelectedRoleId}
                    options={availableRoles
                      .filter(role => !userRoles.some(ur => ur.role_id === role.role_id))
                      .map((role): SelectOption => ({
                        value: role.role_id,
                        label: role.role_name
                      }))}
                    placeholder={t('clientSettings.users.selectRole')}
                  />
                </div>
                <Button
                  id="assign-role-btn"
                  onClick={handleAssignRole}
                  disabled={!selectedRoleId}
                  size="sm"
                >
                  {t('clientSettings.users.assignRole', 'Assign Role')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Password Change Section */}
        {isOwnProfile && (
          <ClientPasswordChangeForm className="mt-4" />
        )}
        
        {/* Admin Password Reset Section - shown for users with permission when viewing other users */}
        {canResetPassword && !isOwnProfile && (
          <Card className="mt-4">
            <div className="p-4">
              <button
                type="button"
                onClick={() => setIsAdminPasswordExpanded(!isAdminPasswordExpanded)}
                className="w-full flex items-center justify-between text-left hover:bg-gray-50 p-2 rounded-md transition-colors"
              >
                <span className="text-base font-medium">{t('clientSettings.users.resetPassword', 'Reset User Password')}</span>
                {isAdminPasswordExpanded ? (
                  <ChevronUp className="h-5 w-5 text-gray-500" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-gray-500" />
                )}
              </button>
            </div>
            {isAdminPasswordExpanded && (
              <CardContent className="pt-0">
                <form onSubmit={handleAdminResetPassword} className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">
                      {t('profile.changePassword.new')}
                    </label>
                    <div className="relative">
                      <Input
                        id="admin-new-password"
                        type={showAdminNewPassword ? "text" : "password"}
                        value={adminNewPassword}
                        onChange={(e) => setAdminNewPassword(e.target.value)}
                        className="w-full pr-10"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowAdminNewPassword(!showAdminNewPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center"
                      >
                        {showAdminNewPassword ? (
                          <Eye className="h-5 w-5 text-gray-400" />
                        ) : (
                          <EyeOff className="h-5 w-5 text-gray-400" />
                        )}
                      </button>
                    </div>
                  </div>
                  <Button id='reset-password-btn' type="submit" variant="default">
                    {t('clientSettings.users.resetPassword', 'Reset Password')}
                  </Button>
                </form>
              </CardContent>
            )}
          </Card>
        )}

        {passwordError && (
          <div className="text-red-500 text-sm mt-2">
            {passwordError}
          </div>
        )}

        {passwordSuccess && (
          <div className="text-green-500 text-sm mt-2">
            {passwordSuccess}
          </div>
        )}
      </div>

      <div className="flex justify-end space-x-2 mt-6">
        <Button
          id="close-button"
          onClick={closeDrawer}
          variant="outline"
        >
          {t('common.cancel')}
        </Button>
        <Button
          id='save-changes-btn'
          onClick={handleSave}
          variant="default"
        >
          {t('clientSettings.messages.saveChanges')}
        </Button>
      </div>
    </Card>
  );
};

export default ClientUserDetails;

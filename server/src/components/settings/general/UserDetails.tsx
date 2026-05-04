'use client';

import React, { useState, useEffect } from 'react';
import { IUser, IUserWithRoles, IRole } from '@alga-psa/types';
import { findUserById, getCurrentUser, getAllUsers, getUserRoles, getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { updateUser, adminChangeUserPassword, getRoles, assignRoleToUser, removeRoleFromUser } from '@alga-psa/users/actions';
import { useDrawer } from "@alga-psa/ui";
import { Text, Flex } from '@radix-ui/themes';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Card } from '@alga-psa/ui/components/Card';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Eye, EyeOff, ChevronDown, ChevronUp } from 'lucide-react';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import CollapsiblePasswordChangeForm from './CollapsiblePasswordChangeForm';
import { getLicenseUsageAction } from '@alga-psa/licensing/actions';
import toast from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface UserDetailsProps {
  userId: string;
  onUpdate: () => void;
}

const UserDetails: React.FC<UserDetailsProps> = ({ userId, onUpdate }) => {
  const { t } = useTranslation('msp/settings');
  const [user, setUser] = useState<IUserWithRoles | null>(null);
  const [currentUser, setCurrentUser] = useState<IUserWithRoles | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [roles, setRoles] = useState<IRole[]>([]);
  const [availableRoles, setAvailableRoles] = useState<IRole[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [reportsTo, setReportsTo] = useState<string>('');
  const [reportsToOptions, setReportsToOptions] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { closeDrawer } = useDrawer();

  // Admin password change states
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminNewPassword, setAdminNewPassword] = useState('');
  const [showAdminNewPassword, setShowAdminNewPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [isAdminPasswordExpanded, setIsAdminPasswordExpanded] = useState(false);

  useEffect(() => {
    fetchUserDetails();
    fetchCurrentUser();
  }, [userId]);

  // Fetch available roles after user is loaded to get correct role type
  useEffect(() => {
    if (user) {
      fetchAvailableRoles();
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      setReportsTo(user.reports_to || '');
    }
  }, [user]);

  useEffect(() => {
    const fetchReportsToOptions = async () => {
      try {
        const allUsers = await getAllUsers(false, 'internal');
        const filteredUsers = allUsers.filter((item) => item.user_id !== userId && !item.is_inactive);

        // Batch fetch avatar URLs
        const userIds = filteredUsers.map((u) => u.user_id);
        let avatarUrls: Record<string, string | null> = {};
        if (userIds.length > 0 && filteredUsers[0]?.tenant) {
          const result = await getUserAvatarUrlsBatchAction(userIds, filteredUsers[0].tenant);
          if (result && typeof (result as Map<string, string | null>).forEach === 'function') {
            (result as Map<string, string | null>).forEach((value, key) => {
              avatarUrls[key] = value;
            });
          } else {
            avatarUrls = result as unknown as Record<string, string | null>;
          }
        }

        const options: SelectOption[] = filteredUsers.map((item) => {
          const displayName = [item.first_name, item.last_name].filter(Boolean).join(' ').trim();
          const nameLabel = displayName || item.email;
          const avatarUrl = avatarUrls[item.user_id] ?? null;
          return {
            value: item.user_id,
            label: (
              <span className="flex items-center gap-2">
                <UserAvatar
                  userId={item.user_id}
                  userName={nameLabel}
                  avatarUrl={avatarUrl}
                  size="sm"
                />
                <span className={item.is_inactive ? 'text-muted-foreground' : ''}>
                  {item.is_inactive ? `${nameLabel} ${t('userDetails.status.inactiveTag')}` : nameLabel}
                </span>
              </span>
            ),
            textValue: item.is_inactive ? `${nameLabel} ${t('userDetails.status.inactiveTag')}` : nameLabel,
            is_inactive: item.is_inactive,
          };
        });
        setReportsToOptions(options);
      } catch (err) {
        console.error('Error fetching reports_to options:', err);
      }
    };

    fetchReportsToOptions();
  }, [userId]);

  const fetchCurrentUser = async () => {
    try {
      const user = await getCurrentUser();
      setCurrentUser(user);
      if (user) {
        // Fetch roles using policyActions to ensure proper tenant context
        const userRoles = await getUserRoles(user.user_id);
        setIsAdmin(userRoles.some(role => role.role_name.toLowerCase() === 'admin'));
      }
    } catch (err) {
      console.error('Error fetching current user:', err);
    }
  };

  const fetchUserDetails = async () => {
    try {
      setLoading(true);
      setError(null);
      const fetchedUser = await findUserById(userId);
      if (fetchedUser) {
        const userRoles = await getUserRoles(userId);
        const userWithRoles: IUserWithRoles = { ...fetchedUser, roles: userRoles };
        setUser(userWithRoles);
        setFirstName(userWithRoles.first_name || '');
        setLastName(userWithRoles.last_name || '');
        setEmail(userWithRoles.email);
        setIsActive(!userWithRoles.is_inactive);
        setRoles(userRoles);
      } else {
        setError(t('userDetails.messages.error.userNotFound'));
      }
    } catch (err) {
      console.error('Error fetching user details:', err);
      setError(t('userDetails.messages.error.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableRoles = async () => {
    try {
      const allRoles = await getRoles();
      // Filter roles based on user type
      if (user) {
        const isClientUser = user.user_type === 'client';
        const filteredRoles = isClientUser 
          ? allRoles.filter(role => role.client)
          : allRoles.filter(role => role.msp);
        setAvailableRoles(filteredRoles);
      } else {
        // Default to MSP roles if user not loaded yet
        const mspRoles = allRoles.filter(role => role.msp);
        setAvailableRoles(mspRoles);
      }
    } catch (err) {
      console.error('Error fetching available roles:', err);
      setError(t('userDetails.messages.error.loadFailed'));
    }
  };

  const handleAddRole = async () => {
    if (!user || !selectedRole) return;

    try {
      await assignRoleToUser(user.user_id, selectedRole);
      const updatedRoles = await getUserRoles(user.user_id);
      setRoles(updatedRoles);
      setSelectedRole('');
    } catch (err) {
      console.error('Error adding role:', err);
      setError(t('userDetails.messages.error.addRoleFailed'));
    }
  };

  const handleRemoveRole = async (roleId: string) => {
    if (!user) return;

    try {
      await removeRoleFromUser(user.user_id, roleId);
      const updatedRoles = await getUserRoles(user.user_id);
      setRoles(updatedRoles);
    } catch (err) {
      console.error('Error removing role:', err);
      setError(t('userDetails.messages.error.removeRoleFailed'));
    }
  };

  const handleSave = async () => {
    if (user) {
      try {
        // Check license limit if trying to activate an MSP user
        if (user.user_type === 'internal' && user.is_inactive && isActive) {
          const licenseResult = await getLicenseUsageAction();
          if (licenseResult.success && licenseResult.data) {
            const { limit, remaining } = licenseResult.data;
            if (limit !== null && remaining === 0) {
              toast.error(t('users.messages.error.licenseLimit'));
              return;
            }
          }
        }

        const updatedUserData: Partial<IUser> = {
          first_name: firstName,
          last_name: lastName,
          email: email,
          is_inactive: !isActive,
          reports_to: reportsTo || null,
        };

        const result = await updateUser(user.user_id, updatedUserData);
        if (!result.success) {
          const errorKeys: Record<typeof result.code, string> = {
            EMAIL_ALREADY_EXISTS: 'userDetails.messages.error.emailAlreadyExists',
            REPORTS_TO_SELF: 'userDetails.messages.error.reportsToSelf',
            REPORTS_TO_CYCLE: 'userDetails.messages.error.reportsToCycle',
          };
          toast.error(t(errorKeys[result.code], { defaultValue: result.error }));
          return;
        }
        if (result.user) {
          setUser(result.user);
          onUpdate();
          closeDrawer();
          toast.success(t('userDetails.messages.success.userUpdated'));
        } else {
          setError(t('userDetails.messages.error.updateUserNotFound'));
        }
      } catch (err) {
        console.error('Error updating user:', err);
        setError(t('userDetails.messages.error.updateFailed'));
      }
    }
  };

  const handleAdminChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (adminNewPassword.length < 8) {
      setPasswordError(t('userDetails.messages.error.passwordTooShort'));
      return;
    }

    try {
      const result = await adminChangeUserPassword(userId, adminNewPassword);
      if (result.success) {
        setPasswordSuccess(t('userDetails.messages.success.passwordChanged'));
        setAdminNewPassword('');
        // Collapse the form after successful password change
        setTimeout(() => {
          setIsAdminPasswordExpanded(false);
          setPasswordSuccess(null);
        }, 2000);
      } else {
        setPasswordError(result.error || t('userDetails.messages.error.passwordChangeFailed'));
      }
    } catch (err) {
      setPasswordError(t('userDetails.messages.error.passwordChangeError'));
    }
  };

  const isOwnProfile = currentUser?.user_id === userId;

  if (loading) {
    return (
      <Card className="p-6">
        <Text size="2">{t('userDetails.loading')}</Text>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <Text size="2" color="red">Error: {error}</Text>
      </Card>
    );
  }

  if (!user) {
    return (
      <Card className="p-6">
        <Text size="2">{t('userDetails.messages.error.userNotFound')}</Text>
      </Card>
    );
  }

  const availableRoleOptions = availableRoles
    .filter((role: IRole): boolean => !roles.some(userRole => userRole.role_id === role.role_id))
    .map((role: IRole): { value: string; label: string } => ({
      value: role.role_id,
      label: role.role_name
    }));

  return (
    <Card className="space-y-6 p-6">
      <Text size="5" weight="bold" className="mb-6">{t('userDetails.title')}</Text>
      
      <Flex direction="column" gap="4">
        <div>
          <Text as="label" size="2" weight="medium" className="mb-2 block">
            {t('userDetails.fields.firstName.label')}
          </Text>
          <Input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder={t('userDetails.fields.firstName.placeholder')}
            className="w-full"
          />
        </div>

        <div>
          <Text as="label" size="2" weight="medium" className="mb-2 block">
            {t('userDetails.fields.lastName.label')}
          </Text>
          <Input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder={t('userDetails.fields.lastName.placeholder')}
            className="w-full"
          />
        </div>

        <div>
          <Text as="label" size="2" weight="medium" className="mb-2 block">
            {t('userDetails.fields.email.label')}
          </Text>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('userDetails.fields.email.placeholder')}
            className="w-full"
          />
        </div>

        <div>
          <Text as="label" size="2" weight="medium" className="mb-2 block">
            {t('userDetails.fields.reportsTo.label')}
          </Text>
          <CustomSelect
            options={reportsToOptions}
            value={reportsTo}
            onValueChange={setReportsTo}
            className="w-full"
            placeholder={t('userDetails.fields.reportsTo.placeholder')}
            allowClear
          />
        </div>

        {/* Last Login Info */}
        {user?.last_login_at && (
          <div className="p-3 rounded-lg border bg-gray-50">
            <Text as="label" size="2" weight="medium" className="block mb-1">
              {t('userDetails.fields.lastLogin')}
            </Text>
            <Text size="2" color="gray" className="block">
              {new Date(user.last_login_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </Text>
            {user.last_login_method && (
              <Text size="1" color="gray" className="block mt-1">
                {t('users.table.viaMethod', { method: user.last_login_method })}
              </Text>
            )}
          </div>
        )}

        <div>
          <Text as="label" size="2" weight="medium" className="mb-2 block">
            {t('userDetails.fields.roles')}
          </Text>
          <div className="space-y-2">
            {roles.map((role: IRole): React.JSX.Element => (
              <div key={role.role_id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                <Text size="2">{role.role_name}</Text>
                <Button
                  id={`remove-role-${role.role_id}`}
                  variant="ghost"
                  onClick={() => handleRemoveRole(role.role_id)}
                  className="text-destructive hover:text-destructive"
                >
                  {t('userDetails.actions.removeRole')}
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <CustomSelect
              options={availableRoleOptions}
              value={selectedRole}
              onValueChange={setSelectedRole}
              className="flex-1"
              placeholder={t('userDetails.actions.selectRoleToAdd')}
            />
            {selectedRole && (
              <Button
                id={`add-role-btn`}
                onClick={handleAddRole}
                variant="default"
              >
                {t('userDetails.actions.addRole')}
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between py-3">
          <div className="flex-1">
            <Text size="2" weight="medium">{t('userDetails.fields.status')}</Text>
            <Text size="2" color="gray" className="block">{t('userDetails.fields.statusHelp')}</Text>
          </div>
          <div className="flex items-center gap-3">
            <Text size="2" color="gray">
              {isActive ? t('userDetails.status.active') : t('userDetails.status.inactive')}
            </Text>
            <Switch
              checked={isActive}
              onCheckedChange={async (checked) => {
                // Check license limit if trying to activate an MSP user
                if (user && user.user_type === 'internal' && user.is_inactive && checked) {
                  const licenseResult = await getLicenseUsageAction();
                  if (licenseResult.success && licenseResult.data) {
                    const { limit, remaining } = licenseResult.data;
                    if (limit !== null && remaining === 0) {
                      toast.error(t('users.messages.error.licenseLimit'));
                      return;
                    }
                  }
                }
                setIsActive(checked);
              }}
            />
          </div>
        </div>

      {/* Password Change Section */}
      {isOwnProfile ? (
        <CollapsiblePasswordChangeForm />
      ) : isAdmin && (
        <Card className="mt-4">
          <div className="p-4">
            <button
              type="button"
              onClick={() => setIsAdminPasswordExpanded(!isAdminPasswordExpanded)}
              className="w-full flex items-center justify-between text-left hover:bg-gray-50 p-2 rounded-md transition-colors"
            >
              <span className="text-base font-medium">{t('userDetails.dialog.setPassword.title')}</span>
              {isAdminPasswordExpanded ? (
                <ChevronUp className="h-5 w-5 text-gray-500" />
              ) : (
                <ChevronDown className="h-5 w-5 text-gray-500" />
              )}
            </button>
          </div>
          {isAdminPasswordExpanded && (
            <div className="px-4 pb-4">
              <form onSubmit={handleAdminChangePassword} className="space-y-4">
                <div>
                  <Text as="label" size="2" weight="medium" className="mb-2 block">
                    {t('userDetails.fields.newPassword')}
                  </Text>
                  <div className="relative">
                    <Input
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
                <Button id='set-password-btn' type="submit" variant="default">
                  {t('userDetails.actions.setPassword')}
                </Button>
              </form>
            </div>
          )}
        </Card>
      )}

        {passwordError && (
          <Text size="2" color="red" className="mt-2">
            {passwordError}
          </Text>
        )}

        {passwordSuccess && (
          <Text size="2" color="green" className="mt-2">
            {passwordSuccess}
          </Text>
        )}
      </Flex>

      <div className="flex justify-end space-x-2 mt-6">
        <Button
          id="close-button"
          onClick={closeDrawer}
          variant="outline"
        >
          {t('userDetails.actions.cancel')}
        </Button>
        <Button
          id='save-changes-btn'
          onClick={handleSave}
          variant="default"
        >
          {t('userDetails.actions.saveChanges')}
        </Button>
      </div>
    </Card>
  );
};

export default UserDetails;

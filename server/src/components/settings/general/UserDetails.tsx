'use client';
import React, { useState, useEffect } from 'react';
import { IUser, IUserWithRoles, IRole } from 'server/src/interfaces/auth.interfaces';
import { findUserById, updateUser, adminChangeUserPassword, getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { getRoles, getUserRoles, assignRoleToUser, removeRoleFromUser } from 'server/src/lib/actions/policyActions';
import { useDrawer } from "server/src/context/DrawerContext";
import { Text, Flex } from '@radix-ui/themes';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { Switch } from 'server/src/components/ui/Switch';
import { Card } from 'server/src/components/ui/Card';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { EyeOpenIcon, EyeClosedIcon } from '@radix-ui/react-icons';
import PasswordChangeForm from './PasswordChangeForm';

interface UserDetailsProps {
  userId: string;
  onUpdate: () => void;
}

const UserDetails: React.FC<UserDetailsProps> = ({ userId, onUpdate }) => {
  const [user, setUser] = useState<IUserWithRoles | null>(null);
  const [currentUser, setCurrentUser] = useState<IUserWithRoles | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [roles, setRoles] = useState<IRole[]>([]);
  const [availableRoles, setAvailableRoles] = useState<IRole[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { closeDrawer } = useDrawer();

  // Admin password change states
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminNewPassword, setAdminNewPassword] = useState('');
  const [showAdminNewPassword, setShowAdminNewPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchUserDetails();
    fetchAvailableRoles();
    fetchCurrentUser();
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
        setError('User not found');
      }
    } catch (err) {
      console.error('Error fetching user details:', err);
      setError('Failed to load user details. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableRoles = async () => {
    try {
      const allRoles = await getRoles();
      setAvailableRoles(allRoles);
    } catch (err) {
      console.error('Error fetching available roles:', err);
      setError('Failed to load available roles.');
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
      setError('Failed to add role. Please try again.');
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
      setError('Failed to remove role. Please try again.');
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
        
        const updatedUser = await updateUser(user.user_id, updatedUserData);
        if (updatedUser) {
          setUser(updatedUser);
          onUpdate();
          closeDrawer();
        } else {
          setError('Failed to update user. User not found.');
        }
      } catch (err) {
        console.error('Error updating user:', err);
        setError('Failed to update user. Please try again.');
      }
    }
  };

  const handleAdminChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (adminNewPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters long');
      return;
    }

    try {
      const result = await adminChangeUserPassword(userId, adminNewPassword);
      if (result.success) {
        setPasswordSuccess('Password changed successfully');
        setAdminNewPassword('');
      } else {
        setPasswordError(result.error || 'Failed to change password');
      }
    } catch (err) {
      setPasswordError('An error occurred while changing password');
    }
  };

  const isOwnProfile = currentUser?.user_id === userId;

  if (loading) {
    return (
      <Card className="p-6">
        <Text size="2">Loading user details...</Text>
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
        <Text size="2">No user found</Text>
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
      <Text size="5" weight="bold" className="mb-6">User Details</Text>
      
      <Flex direction="column" gap="4">
        <div>
          <Text as="label" size="2" weight="medium" className="mb-2 block">
            First Name
          </Text>
          <Input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Enter first name"
            className="w-full"
          />
        </div>

        <div>
          <Text as="label" size="2" weight="medium" className="mb-2 block">
            Last Name
          </Text>
          <Input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Enter last name"
            className="w-full"
          />
        </div>

        <div>
          <Text as="label" size="2" weight="medium" className="mb-2 block">
            Email
          </Text>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter email"
            className="w-full"
          />
        </div>

        <div>
          <Text as="label" size="2" weight="medium" className="mb-2 block">
            Roles
          </Text>
          <div className="space-y-2">
            {roles.map((role: IRole): JSX.Element => (
              <div key={role.role_id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                <Text size="2">{role.role_name}</Text>
                <Button
                  id={`remove-role-${role.role_id}`}
                  variant="ghost"
                  onClick={() => handleRemoveRole(role.role_id)}
                  className="text-red-500 hover:text-red-600"
                >
                  Remove
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
              placeholder="Select role to add"
            />
            <Button
              id={`add-role-btn`}
              onClick={handleAddRole}
              variant="outline"
              disabled={!selectedRole}
            >
              Add Role
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between py-3">
          <div>
            <Text size="2" weight="medium">Status</Text>
            <Text size="2" color="gray">Set user account status</Text>
          </div>
          <div className="flex items-center gap-2">
            <Text size="2" color="gray">
              {isActive ? 'Active' : 'Inactive'}
            </Text>
            <Switch
              checked={!isActive}
              onCheckedChange={(checked) => setIsActive(!checked)}
              className="data-[state=checked]:bg-primary-500"
            />
          </div>
        </div>

      {/* Password Change Section */}
      {isOwnProfile ? (
        <PasswordChangeForm />
      ) : isAdmin && (
        <Card className="p-4 mt-4">
          <Text size="3" weight="medium" className="mb-4">Set User Password (Admin)</Text>
          <form onSubmit={handleAdminChangePassword} className="space-y-4">
            <div>
              <Text as="label" size="2" weight="medium" className="mb-2 block">
                New Password
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
                    <EyeOpenIcon className="h-5 w-5 text-gray-400" />
                  ) : (
                    <EyeClosedIcon className="h-5 w-5 text-gray-400" />
                  )}
                </button>
              </div>
            </div>
            <Button id='set-password-btn' type="submit" variant="default">
              Set Password
            </Button>
          </form>
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
          Cancel
        </Button>
        <Button
          id='save-changes-btn'
          onClick={handleSave}
          variant="default"
        >
          Save Changes
        </Button>
      </div>
    </Card>
  );
};

export default UserDetails;

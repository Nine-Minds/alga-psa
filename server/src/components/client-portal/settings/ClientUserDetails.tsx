'use client';

import React, { useState, useEffect } from 'react';
import { IUser, IPermission } from 'server/src/interfaces/auth.interfaces';
import { getCurrentUser, getUserRolesWithPermissions } from 'server/src/lib/actions/user-actions/userActions';
import { getClientUserById, updateClientUser, resetClientUserPassword } from 'server/src/lib/actions/client-portal-actions/clientUserActions';
import { useDrawer } from "server/src/context/DrawerContext";
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { Switch } from 'server/src/components/ui/Switch';
import { Card, CardContent } from 'server/src/components/ui/Card';
import { Eye, EyeOff } from 'lucide-react';
import ClientPasswordChangeForm from './ClientPasswordChangeForm';

interface ClientUserDetailsProps {
  userId: string;
  onUpdate: () => void;
}

const ClientUserDetails: React.FC<ClientUserDetailsProps> = ({ userId, onUpdate }) => {
  const [user, setUser] = useState<IUser | null>(null);
  const [currentUser, setCurrentUser] = useState<IUser | null>(null);
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
            `${permission.resource}.${permission.action}` === 'client_password.update'
          )
        );
        
        setCanResetPassword(hasPasswordResetPermission);
        setIsOwnProfile(user.user_id === userId);
        
        console.log('Current user roles:', user.roles?.map(r => r.role_name));
        console.log('Has password reset permission:', hasPasswordResetPermission);
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
          setError('Failed to update user. User not found.');
        }
      } catch (err) {
        console.error('Error updating user:', err);
        setError('Failed to update user. Please try again.');
      }
    }
  };

  const handleAdminResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (adminNewPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters long');
      return;
    }

    try {
      const result = await resetClientUserPassword(userId, adminNewPassword);
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

  if (loading) {
    return (
      <Card className="p-6">
        <CardContent>
          <div className="text-sm">Loading user details...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <CardContent>
          <div className="text-sm text-red-500">Error: {error}</div>
        </CardContent>
      </Card>
    );
  }

  if (!user) {
    return (
      <Card className="p-6">
        <CardContent>
          <div className="text-sm">No user found</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="space-y-6 p-6">
      <h2 className="text-xl font-bold mb-6">User Details</h2>
      
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-sm font-medium mb-2 block">
            First Name
          </label>
          <Input
            id={`user-${userId}-first-name`}
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Enter first name"
            className="w-full"
          />
        </div>

        <div>
          <label className="text-sm font-medium mb-2 block">
            Last Name
          </label>
          <Input
            id={`user-${userId}-last-name`}
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Enter last name"
            className="w-full"
          />
        </div>

        <div>
          <label className="text-sm font-medium mb-2 block">
            Email
          </label>
          <Input
            id={`user-${userId}-email`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter email"
            className="w-full"
          />
        </div>

        <div className="flex items-center justify-between py-3">
          <div>
            <div className="text-sm font-medium">Status</div>
            <div className="text-sm text-gray-500">Set user account status</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-sm text-gray-500">
              {isActive ? 'Active' : 'Inactive'}
            </div>
            <Switch
              checked={!isActive}
              onCheckedChange={(checked) => setIsActive(!checked)}
              className="data-[state=checked]:bg-primary-500"
            />
          </div>
        </div>

        {/* Password Change Section */}
        {isOwnProfile && (
          <ClientPasswordChangeForm className="mt-4" />
        )}
        
        {/* Admin Password Reset Section - shown for users with permission when viewing other users */}
        {canResetPassword && !isOwnProfile && (
          <Card className="p-4 mt-4">
            <CardContent>
              <h3 className="text-md font-medium mb-4">Reset User Password</h3>
              <form onSubmit={handleAdminResetPassword} className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    New Password
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
                  Reset Password
                </Button>
              </form>
            </CardContent>
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

export default ClientUserDetails;

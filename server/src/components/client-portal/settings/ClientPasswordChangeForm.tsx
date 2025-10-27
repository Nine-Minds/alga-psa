'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Button } from 'server/src/components/ui/Button';
import { Eye, EyeOff } from 'lucide-react';
import { changeOwnPassword, checkPasswordResetStatus } from '@product/actions/user-actions/userActions';
import { useTranslation } from '@/lib/i18n/client';
import { PasswordResetWarning } from 'server/src/components/ui/PasswordResetWarning';

interface ClientPasswordChangeFormProps {
  onSuccess?: () => void;
  className?: string;
}

export default function ClientPasswordChangeForm({ onSuccess, className }: ClientPasswordChangeFormProps) {
  const { t } = useTranslation('clientPortal');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [needsPasswordReset, setNeedsPasswordReset] = useState(false);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const status = await checkPasswordResetStatus();
        setNeedsPasswordReset(!status.hasResetPassword);
      } catch (error) {
        console.error('Error checking password reset status:', error);
        // Default to not showing warning if there's an error
        setNeedsPasswordReset(false);
      }
    };
    checkStatus();
  }, []);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword !== confirmPassword) {
      setPasswordError(t('profile.changePassword.passwordMismatch', 'New passwords do not match'));
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError(t('profile.changePassword.requirements', 'Password must be at least 8 characters long'));
      return;
    }

    try {
      const result = await changeOwnPassword(currentPassword, newPassword);
      if (result.success) {
        setPasswordSuccess(t('profile.changePassword.success', 'Password changed successfully'));
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setNeedsPasswordReset(false);
        onSuccess?.();
      } else {
        setPasswordError(result.error || t('profile.changePassword.error', 'Failed to change password'));
      }
    } catch (err) {
      setPasswordError(t('profile.changePassword.unknownError', 'An error occurred while changing password'));
    }
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Change Password</CardTitle>
      </CardHeader>
      <CardContent>
        {needsPasswordReset && (
          <PasswordResetWarning className="mb-4" />
        )}
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <Label htmlFor="client-current-password">Current Password</Label>
            <div className="relative">
              <Input
                id="client-current-password"
                type={showCurrentPassword ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="pr-10"
                required
              />
              <button
                type="button"
                id="toggle-current-password-visibility"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                {showCurrentPassword ? (
                  <Eye className="h-5 w-5 text-gray-400" />
                ) : (
                  <EyeOff className="h-5 w-5 text-gray-400" />
                )}
              </button>
            </div>
          </div>
          <div>
            <Label htmlFor="client-new-password">New Password</Label>
            <div className="relative">
              <Input
                id="client-new-password"
                type={showNewPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="pr-10"
                required
              />
              <button
                type="button"
                id="toggle-new-password-visibility"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                {showNewPassword ? (
                  <Eye className="h-5 w-5 text-gray-400" />
                ) : (
                  <EyeOff className="h-5 w-5 text-gray-400" />
                )}
              </button>
            </div>
          </div>
          <div>
            <Label htmlFor="client-confirm-password">Confirm New Password</Label>
            <div className="relative">
              <Input
                id="client-confirm-password"
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="pr-10"
                required
              />
              <button
                type="button"
                id="toggle-confirm-password-visibility"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                {showConfirmPassword ? (
                  <Eye className="h-5 w-5 text-gray-400" />
                ) : (
                  <EyeOff className="h-5 w-5 text-gray-400" />
                )}
              </button>
            </div>
          </div>
          {passwordError && (
            <div className="text-red-500 text-sm">{passwordError}</div>
          )}
          {passwordSuccess && (
            <div className="text-green-500 text-sm">{passwordSuccess}</div>
          )}
          <Button id="change-password-button" type="submit" variant="default">
            Change Password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

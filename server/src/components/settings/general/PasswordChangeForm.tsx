'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Button } from '@/components/ui/Button';
import { EyeOpenIcon, EyeClosedIcon } from '@radix-ui/react-icons';
import { changeOwnPassword } from '@/lib/actions/user-actions/userActions';

interface PasswordChangeFormProps {
  onSuccess?: () => void;
  className?: string;
}

export default function PasswordChangeForm({ onSuccess, className }: PasswordChangeFormProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters long');
      return;
    }

    try {
      const result = await changeOwnPassword(currentPassword, newPassword);
      if (result.success) {
        setPasswordSuccess('Password changed successfully');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        onSuccess?.();
      } else {
        setPasswordError(result.error || 'Failed to change password');
      }
    } catch (err) {
      setPasswordError('An error occurred while changing password');
    }
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Change Password</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <Label htmlFor="currentPassword">Current Password</Label>
            <div className="relative">
              <Input
                id="currentPassword"
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
                  <EyeOpenIcon className="h-5 w-5 text-gray-400" />
                ) : (
                  <EyeClosedIcon className="h-5 w-5 text-gray-400" />
                )}
              </button>
            </div>
          </div>
          <div>
            <Label htmlFor="newPassword">New Password</Label>
            <div className="relative">
              <Input
                id="newPassword"
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
                  <EyeOpenIcon className="h-5 w-5 text-gray-400" />
                ) : (
                  <EyeClosedIcon className="h-5 w-5 text-gray-400" />
                )}
              </button>
            </div>
          </div>
          <div>
            <Label htmlFor="confirmPassword">Confirm New Password</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
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
                  <EyeOpenIcon className="h-5 w-5 text-gray-400" />
                ) : (
                  <EyeClosedIcon className="h-5 w-5 text-gray-400" />
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

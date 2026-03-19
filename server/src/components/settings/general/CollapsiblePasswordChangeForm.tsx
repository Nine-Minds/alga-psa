'use client';


import React, { useState } from 'react';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button';
import { Eye, EyeOff, ChevronDown, ChevronUp } from 'lucide-react';
import { changeOwnPassword } from '@alga-psa/users/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface CollapsiblePasswordChangeFormProps {
  onSuccess?: () => void;
  className?: string;
}

export default function CollapsiblePasswordChangeForm({ onSuccess, className }: CollapsiblePasswordChangeFormProps) {
  const { t } = useTranslation('msp/settings');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword !== confirmPassword) {
      setPasswordError(t('password.messages.error.mismatch'));
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError(t('password.messages.error.tooShort'));
      return;
    }

    try {
      const result = await changeOwnPassword(currentPassword, newPassword);
      if (result.success) {
        setPasswordSuccess(t('password.messages.success.changed'));
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        onSuccess?.();
        // Collapse the form after successful password change
        setTimeout(() => {
          setIsExpanded(false);
          setPasswordSuccess(null);
        }, 2000);
      } else {
        setPasswordError(result.error || t('password.messages.error.changeFailed'));
      }
    } catch (err) {
      setPasswordError(t('password.messages.error.changeFailed'));
    }
  };

  return (
    <Card className={className}>
      <div className="p-4">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between text-left hover:bg-gray-50 p-2 rounded-md transition-colors"
        >
          <span className="text-base font-medium">{t('password.changePassword')}</span>
          {isExpanded ? (
            <ChevronUp className="h-5 w-5 text-gray-500" />
          ) : (
            <ChevronDown className="h-5 w-5 text-gray-500" />
          )}
        </button>
      </div>
      {isExpanded && (
        <CardContent className="pt-0">
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <Label htmlFor="currentPassword">{t('password.fields.currentPassword')}</Label>
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
                    <Eye className="h-5 w-5 text-gray-400" />
                  ) : (
                    <EyeOff className="h-5 w-5 text-gray-400" />
                  )}
                </button>
              </div>
            </div>
            <div>
              <Label htmlFor="newPassword">{t('password.fields.newPassword')}</Label>
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
                    <Eye className="h-5 w-5 text-gray-400" />
                  ) : (
                    <EyeOff className="h-5 w-5 text-gray-400" />
                  )}
                </button>
              </div>
            </div>
            <div>
              <Label htmlFor="confirmPassword">{t('password.fields.confirmNewPassword')}</Label>
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
                    <Eye className="h-5 w-5 text-gray-400" />
                  ) : (
                    <EyeOff className="h-5 w-5 text-gray-400" />
                  )}
                </button>
              </div>
            </div>
            {passwordError && (
              <div className="text-destructive text-sm">{passwordError}</div>
            )}
            {passwordSuccess && (
              <div className="text-success text-sm">{passwordSuccess}</div>
            )}
            <Button id="change-password-button" type="submit" variant="default">
              {t('password.changePassword')}
            </Button>
          </form>
        </CardContent>
      )}
    </Card>
  );
}

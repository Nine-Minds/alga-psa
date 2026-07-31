'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Eye, EyeOff, Lock, User, Briefcase } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  verifyUserInvitationToken,
  completeUserInvitationSetup
} from '@alga-psa/users/actions/user-actions/userInvitationActions';
import { signIn } from 'next-auth/react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { I18nWrapper } from '@alga-psa/tenancy/components';
import { validatePassword as validatePasswordPolicy, getPasswordRequirements } from '@alga-psa/validation';

interface InviteeInfo {
  email: string;
  first_name: string;
  last_name: string;
  role_name: string | null;
}

function TeamSetupContent() {
  const { t } = useTranslation('msp/onboarding');

  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') || '';

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [invitee, setInvitee] = useState<InviteeInfo | null>(null);
  const [error, setError] = useState<string>('');

  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: ''
  });

  const [passwordRequirements, setPasswordRequirements] = useState({
    minLength: false,
    hasUppercase: false,
    hasLowercase: false,
    hasNumber: false,
    hasSpecialChar: false,
    passwordsMatch: false
  });

  useEffect(() => {
    if (!token) {
      setError(t('teamSetup.errors.noToken', { defaultValue: 'No invitation token provided' }));
      setIsLoading(false);
      return;
    }

    verifyToken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    validatePassword();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.password, formData.confirmPassword]);

  const verifyToken = async () => {
    try {
      const result = await verifyUserInvitationToken(token);
      if (result.success && result.invitee) {
        setInvitee(result.invitee);
      } else {
        setError(result.error || t('teamSetup.errors.invalidOrExpired', { defaultValue: 'Invalid or expired invitation token' }));
      }
    } catch (err) {
      console.error('Team invitation token verification error:', err);
      setError(t('teamSetup.errors.verificationFailed', { defaultValue: 'Failed to verify invitation token' }));
    } finally {
      setIsLoading(false);
    }
  };

  const validatePassword = () => {
    const { password, confirmPassword } = formData;
    const reqs = getPasswordRequirements(password);

    setPasswordRequirements({
      minLength: reqs.minLength,
      hasUppercase: reqs.hasUpper,
      hasLowercase: reqs.hasLower,
      hasNumber: reqs.hasNumber,
      hasSpecialChar: reqs.hasSpecial,
      passwordsMatch: password === confirmPassword && password.length > 0
    });
  };

  const isPasswordValid = () =>
    passwordRequirements.passwordsMatch && validatePasswordPolicy(formData.password) === null;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isPasswordValid()) {
      const policyError = validatePasswordPolicy(formData.password);
      toast.error(policyError ?? t('teamSetup.errors.requirementsNotMet', { defaultValue: 'Please ensure all password requirements are met' }));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await completeUserInvitationSetup(token, formData.password);

      if (result.success) {
        try {
          const signinRes = await signIn('credentials', {
            username: result.username,
            password: formData.password,
            redirect: false
          });
          if (signinRes && (signinRes as any).error) {
            toast.success(t('teamSetup.accountReady', { defaultValue: 'Account ready. Please sign in.' }));
            router.push('/auth/msp/signin');
          } else {
            toast.success(t('teamSetup.welcome', { defaultValue: 'Welcome to the team!' }));
            router.push('/msp/dashboard');
          }
        } catch (signinError) {
          toast.success(t('teamSetup.accountReady', { defaultValue: 'Account ready. Please sign in.' }));
          router.push('/auth/msp/signin');
        }
      } else {
        toast.error(result.error || t('teamSetup.errors.createFailed', { defaultValue: 'Failed to create account' }));
      }
    } catch (err) {
      console.error('Team setup completion error:', err);
      toast.error(t('teamSetup.errors.createFailed', { defaultValue: 'Failed to create account' }));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[rgb(var(--color-background-50))]">
        <Card className="w-full max-w-md">
          <CardContent className="p-6">
            <div className="animate-pulse space-y-4">
              <div className="h-8 bg-[rgb(var(--color-border-200))] rounded"></div>
              <div className="h-4 bg-[rgb(var(--color-border-200))] rounded w-3/4"></div>
              <div className="h-32 bg-[rgb(var(--color-border-200))] rounded"></div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !invitee) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[rgb(var(--color-background-50))]">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-destructive">
              {t('teamSetup.invalidInvitation', { defaultValue: 'Invalid Invitation' })}
            </CardTitle>
            <CardDescription>
              {t('teamSetup.invalidInvitationDescription', { defaultValue: 'There was a problem with your team invitation' })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertDescription>
                {error || t('teamSetup.invalidTokenMessage', { defaultValue: 'The invitation link is invalid or has expired. Please ask your admin to resend the invitation.' })}
              </AlertDescription>
            </Alert>
            <Button onClick={() => router.push('/auth/msp/signin')} id="btn-signin" className="w-full">
              {t('teamSetup.goToSignIn', { defaultValue: 'Go to Sign In' })}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[rgb(var(--color-background-50))] p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            {t('teamSetup.title', { defaultValue: 'Set Up Your Account' })}
          </CardTitle>
          <CardDescription>
            {t('teamSetup.subtitle', { defaultValue: 'Complete your team member account setup' })}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-4 p-4 bg-[rgb(var(--color-background-50))] rounded-lg">
            <div className="flex items-center gap-2 text-sm font-medium">
              <User className="h-4 w-4" />
              {t('teamSetup.accountInformation', { defaultValue: 'Account Information' })}
            </div>

            <div className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">{t('teamSetup.name', { defaultValue: 'Name:' })}</span>{' '}
                {invitee.first_name} {invitee.last_name}
              </div>
              <div>
                <span className="text-muted-foreground">{t('teamSetup.email', { defaultValue: 'Email:' })}</span> {invitee.email}
              </div>
              {invitee.role_name && (
                <div className="flex items-center gap-1">
                  <Briefcase className="h-3 w-3" />
                  <span className="text-muted-foreground">{t('teamSetup.role', { defaultValue: 'Role:' })}</span> {invitee.role_name}
                </div>
              )}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">{t('teamSetup.password', { defaultValue: 'Password' })}</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder={t('teamSetup.passwordPlaceholder', { defaultValue: 'Enter your password' })}
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  id={showPassword ? 'hide-password-button' : 'show-password-button'}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-[rgb(var(--color-text-400))]" />
                  ) : (
                    <Eye className="h-4 w-4 text-[rgb(var(--color-text-400))]" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t('teamSetup.confirmPassword', { defaultValue: 'Confirm Password' })}</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  placeholder={t('teamSetup.confirmPasswordPlaceholder', { defaultValue: 'Confirm your password' })}
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  id={showConfirmPassword ? 'hide-confirm-password-button' : 'show-confirm-password-button'}
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4 text-[rgb(var(--color-text-400))]" />
                  ) : (
                    <Eye className="h-4 w-4 text-[rgb(var(--color-text-400))]" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">{t('teamSetup.passwordRequirements', { defaultValue: 'Password Requirements' })}</Label>
              <div className="space-y-1 text-xs">
                <div className={`flex items-center gap-2 ${passwordRequirements.minLength ? 'text-success' : 'text-[rgb(var(--color-text-500))]'}`}>
                  <div className={`w-2 h-2 rounded-full ${passwordRequirements.minLength ? 'bg-success' : 'bg-[rgb(var(--color-border-300))]'}`}></div>
                  {t('teamSetup.requirements.minLength', { defaultValue: 'At least 8 characters' })}
                </div>
                <div className={`flex items-center gap-2 ${passwordRequirements.hasUppercase ? 'text-success' : 'text-[rgb(var(--color-text-500))]'}`}>
                  <div className={`w-2 h-2 rounded-full ${passwordRequirements.hasUppercase ? 'bg-success' : 'bg-[rgb(var(--color-border-300))]'}`}></div>
                  {t('teamSetup.requirements.hasUppercase', { defaultValue: 'One uppercase letter' })}
                </div>
                <div className={`flex items-center gap-2 ${passwordRequirements.hasLowercase ? 'text-success' : 'text-[rgb(var(--color-text-500))]'}`}>
                  <div className={`w-2 h-2 rounded-full ${passwordRequirements.hasLowercase ? 'bg-success' : 'bg-[rgb(var(--color-border-300))]'}`}></div>
                  {t('teamSetup.requirements.hasLowercase', { defaultValue: 'One lowercase letter' })}
                </div>
                <div className={`flex items-center gap-2 ${passwordRequirements.hasNumber ? 'text-success' : 'text-[rgb(var(--color-text-500))]'}`}>
                  <div className={`w-2 h-2 rounded-full ${passwordRequirements.hasNumber ? 'bg-success' : 'bg-[rgb(var(--color-border-300))]'}`}></div>
                  {t('teamSetup.requirements.hasNumber', { defaultValue: 'One number' })}
                </div>
                <div className={`flex items-center gap-2 ${passwordRequirements.hasSpecialChar ? 'text-success' : 'text-[rgb(var(--color-text-500))]'}`}>
                  <div className={`w-2 h-2 rounded-full ${passwordRequirements.hasSpecialChar ? 'bg-success' : 'bg-[rgb(var(--color-border-300))]'}`}></div>
                  {t('teamSetup.requirements.hasSpecialChar', { defaultValue: 'One special character' })}
                </div>
                <div className={`flex items-center gap-2 ${passwordRequirements.passwordsMatch ? 'text-success' : 'text-[rgb(var(--color-text-500))]'}`}>
                  <div className={`w-2 h-2 rounded-full ${passwordRequirements.passwordsMatch ? 'bg-success' : 'bg-[rgb(var(--color-border-300))]'}`}></div>
                  {t('teamSetup.requirements.passwordsMatch', { defaultValue: 'Passwords match' })}
                </div>
              </div>
            </div>

            <Button
              id="create-team-account-button"
              type="submit"
              className="w-full"
              disabled={!isPasswordValid() || isSubmitting}
            >
              {isSubmitting
                ? t('teamSetup.creatingAccount', { defaultValue: 'Creating Account...' })
                : t('teamSetup.createAccount', { defaultValue: 'Create Account' })}
            </Button>
          </form>

          <div className="text-center text-xs text-muted-foreground">
            {t('teamSetup.alreadyHaveAccount', { defaultValue: 'Already have an account?' })}{' '}
            <button
              onClick={() => router.push('/auth/msp/signin')}
              className="text-[rgb(var(--color-primary-500))] hover:underline"
            >
              {t('teamSetup.signIn', { defaultValue: 'Sign in' })}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function TeamSetupPage() {
  return (
    <I18nWrapper portal="msp">
      <TeamSetupContent />
    </I18nWrapper>
  );
}

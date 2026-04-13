'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { completeApplianceClaimAction, verifyApplianceClaimTokenAction } from '@alga-psa/auth/actions';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';

type ApplianceClaimVerifyStatus =
  | 'valid'
  | 'missing_token'
  | 'appliance_mode_disabled'
  | 'invalid_token'
  | 'expired_token'
  | 'already_used'
  | 'already_claimed'
  | 'bootstrap_state_inconsistent';

const STATUS_MESSAGES: Record<Exclude<ApplianceClaimVerifyStatus, 'valid'>, { title: string; description: string }> = {
  missing_token: {
    title: 'Missing claim token',
    description:
      'This appliance claim link is missing a token. Ask your operator for the appliance claim URL from the bootstrap runbook.',
  },
  appliance_mode_disabled: {
    title: 'Appliance claim is unavailable',
    description: 'This route is only available in appliance mode.',
  },
  invalid_token: {
    title: 'Invalid claim token',
    description: 'This claim token is not recognized. Ask your operator to retrieve the current token from Kubernetes.',
  },
  expired_token: {
    title: 'Expired claim token',
    description: 'This token has expired. Ask your operator to rotate the appliance claim token using operator procedures.',
  },
  already_used: {
    title: 'Claim token already used',
    description: 'This claim link has already been consumed. Sign in with your MSP credentials.',
  },
  already_claimed: {
    title: 'Appliance already claimed',
    description: 'An MSP admin already exists for this appliance. Continue with normal MSP sign-in.',
  },
  bootstrap_state_inconsistent: {
    title: 'Claim flow unavailable',
    description: 'Appliance bootstrap state is inconsistent. Ask your operator to review appliance bootstrap logs and runbooks.',
  },
};

export default function ApplianceClaimPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams?.get('token')?.trim() || '', [searchParams]);

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<ApplianceClaimVerifyStatus>('missing_token');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    organizationName: '',
    password: '',
    confirmPassword: '',
  });

  useEffect(() => {
    const verify = async () => {
      if (!token) {
        setStatus('missing_token');
        setIsLoading(false);
        return;
      }

      try {
        const result = await verifyApplianceClaimTokenAction(token);
        setStatus(result.status);
      } catch (error) {
        console.error('Failed to verify appliance claim token', error);
        setStatus('bootstrap_state_inconsistent');
      } finally {
        setIsLoading(false);
      }
    };

    void verify();
  }, [token]);

  const canSubmit = status === 'valid' && !isSubmitting;

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await completeApplianceClaimAction({
        token,
        fullName: formData.fullName,
        email: formData.email,
        organizationName: formData.organizationName,
        password: formData.password,
        confirmPassword: formData.confirmPassword,
      });

      if (!result.success || !result.username) {
        if (!result.recoverable) {
          setStatus(result.status);
        }
        toast.error(result.error || STATUS_MESSAGES[result.status]?.description || 'Failed to claim appliance.');
        return;
      }

      const signInResult = await signIn('credentials', {
        email: result.username,
        password: formData.password,
        userType: 'internal',
        redirect: false,
      });

      if (signInResult?.error) {
        toast.success('Appliance claimed. Please sign in with your new MSP admin account.');
        router.push('/auth/msp/signin');
        return;
      }

      toast.success('Appliance claimed successfully.');
      router.push('/msp/onboarding');
    } catch (error) {
      console.error('Failed to complete appliance claim', error);
      setStatus('bootstrap_state_inconsistent');
      toast.error('Failed to complete appliance claim.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[rgb(var(--color-background-50))] p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="p-6">
            <div className="animate-pulse space-y-4">
              <div className="h-7 bg-[rgb(var(--color-border-200))] rounded" />
              <div className="h-4 bg-[rgb(var(--color-border-200))] rounded w-2/3" />
              <div className="h-32 bg-[rgb(var(--color-border-200))] rounded" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status !== 'valid') {
    const message = STATUS_MESSAGES[status];
    return (
      <div className="min-h-screen flex items-center justify-center bg-[rgb(var(--color-background-50))] p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle className="text-destructive">{message.title}</CardTitle>
            <CardDescription>{message.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertDescription>
                For appliance installs, claim access is operator-controlled. Public registration is disabled.
              </AlertDescription>
            </Alert>
            <Button className="w-full" onClick={() => router.push('/auth/msp/signin')}>
              Go to MSP Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[rgb(var(--color-background-50))] p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Claim Appliance MSP Admin
          </CardTitle>
          <CardDescription>
            This creates the first MSP administrator account for this appliance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full name</Label>
              <Input
                id="fullName"
                name="fullName"
                value={formData.fullName}
                onChange={handleInputChange}
                placeholder="Jane Doe"
                autoComplete="name"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="admin@example.com"
                autoComplete="email"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="organizationName">Organization / company name</Label>
              <Input
                id="organizationName"
                name="organizationName"
                value={formData.organizationName}
                onChange={handleInputChange}
                placeholder="Acme MSP"
                autoComplete="organization"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={handleInputChange}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex items-center pr-3"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
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
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex items-center pr-3"
                  onClick={() => setShowConfirmPassword((current) => !current)}
                  aria-label={showConfirmPassword ? 'Hide password confirmation' : 'Show password confirmation'}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4 text-[rgb(var(--color-text-400))]" />
                  ) : (
                    <Eye className="h-4 w-4 text-[rgb(var(--color-text-400))]" />
                  )}
                </button>
              </div>
            </div>

            <Button className="w-full" type="submit" disabled={!canSubmit}>
              {isSubmitting ? 'Claiming appliance...' : 'Claim appliance'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { verifyContactEmail } from 'server/src/lib/actions/user-actions/userActions';
import { initiateRegistration } from 'server/src/lib/actions/user-actions/registrationActions';
import { verifyEmailSuffix } from 'server/src/lib/actions/company-settings/emailSettings';

export default function RegisterForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);
  const [showNameFields, setShowNameFields] = useState(false);
  const [emailStatus, setEmailStatus] = useState<'checking' | 'valid' | 'invalid' | null>(null);
  const [passwordStrength, setPasswordStrength] = useState<'weak' | 'medium' | 'strong' | null>(null);
  const router = useRouter();

  // Password strength validation
  useEffect(() => {
    if (!password) {
      setPasswordStrength(null);
      return;
    }

    const hasLowerCase = /[a-z]/.test(password);
    const hasUpperCase = /[A-Z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
    const isLongEnough = password.length >= 8;

    const score = [hasLowerCase, hasUpperCase, hasNumber, hasSpecialChar, isLongEnough]
      .filter(Boolean).length;

    if (score <= 2) setPasswordStrength('weak');
    else if (score <= 4) setPasswordStrength('medium');
    else setPasswordStrength('strong');
  }, [password]);

  // Debounced email check
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!email || !email.includes('@')) return;

      setIsCheckingEmail(true);
      setEmailStatus('checking');
      try {
        const [verifyResult, isValidSuffix] = await Promise.all([
          verifyContactEmail(email),
          verifyEmailSuffix(email)
        ]);

        if (verifyResult.exists) {
          setShowNameFields(false);
          setEmailStatus('valid');
        } else if (isValidSuffix) {
          setShowNameFields(true);
          setEmailStatus('valid');
        } else {
          setEmailStatus('invalid');
          setShowNameFields(false);
        }
      } catch (error) {
        console.error('Email verification error:', error);
        setEmailStatus('invalid');
      } finally {
        setIsCheckingEmail(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [email]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (emailStatus !== 'valid') {
        setError("Please enter a valid email address");
        setIsLoading(false);
        return;
      }

      // For both contact-based and email suffix registration
      const result = await initiateRegistration(
        email,
        password,
        firstName,
        lastName
      );

      if (!result.success) {
        setError(result.error || 'Registration failed');
      } else if (result.registrationId) {
        // Email suffix registration - needs verification
        router.push(`/auth/verify?registrationId=${result.registrationId}`);
      } else {
        // Contact-based registration - direct to login
        router.push('/auth/signin?registered=true&callbackUrl=/client-portal/dashboard');
      }
    } catch (error) {
      setError('An unexpected error occurred during registration.');
      console.error('Registration error:', error);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email address</Label>
        <div className="relative">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
            className={`mt-1 ${
              emailStatus === 'valid' ? 'border-green-500' :
              emailStatus === 'invalid' ? 'border-red-500' : ''
            }`}
            placeholder="Enter your email"
            aria-describedby="email-status"
          />
          {isCheckingEmail && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          )}
        </div>
        <div id="email-status" className="text-sm mt-1">
          {emailStatus === 'checking' && (
            <p className="text-gray-500">Checking email...</p>
          )}
          {emailStatus === 'invalid' && (
            <p className="text-red-500">
              This email domain is not authorized for registration
            </p>
          )}
          {emailStatus === 'valid' && showNameFields && (
            <p className="text-green-500">
              Email domain verified. Please provide your details.
            </p>
          )}
        </div>
      </div>

      {showNameFields && (
        <>
          <div className="space-y-2">
            <Label htmlFor="firstName">First Name</Label>
            <Input
              id="firstName"
              name="firstName"
              type="text"
              autoComplete="given-name"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={isLoading}
              className="mt-1"
              placeholder="Enter your first name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="lastName">Last Name</Label>
            <Input
              id="lastName"
              name="lastName"
              type="text"
              autoComplete="family-name"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={isLoading}
              className="mt-1"
              placeholder="Enter your last name"
            />
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isLoading}
          className={`mt-1 ${
            passwordStrength === 'strong' ? 'border-green-500' :
            passwordStrength === 'medium' ? 'border-yellow-500' :
            passwordStrength === 'weak' ? 'border-red-500' : ''
          }`}
          placeholder="Create a password"
          aria-describedby="password-requirements"
        />
        <div id="password-requirements" className="text-sm mt-1">
          <p className="text-gray-500">Password must contain:</p>
          <ul className="list-disc list-inside space-y-1">
            <li className={password.length >= 8 ? 'text-green-500' : 'text-gray-500'}>
              At least 8 characters
            </li>
            <li className={/[A-Z]/.test(password) ? 'text-green-500' : 'text-gray-500'}>
              One uppercase letter
            </li>
            <li className={/[a-z]/.test(password) ? 'text-green-500' : 'text-gray-500'}>
              One lowercase letter
            </li>
            <li className={/\d/.test(password) ? 'text-green-500' : 'text-gray-500'}>
              One number
            </li>
            <li className={/[!@#$%^&*(),.?":{}|<>]/.test(password) ? 'text-green-500' : 'text-gray-500'}>
              One special character
            </li>
          </ul>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button
        id='register-button'
        type="submit"
        className="w-full"
        disabled={isLoading || emailStatus !== 'valid' || !passwordStrength || passwordStrength === 'weak'}
      >
        {isLoading ? (
          <>
            <span className="animate-spin mr-2">⚬</span>
            Creating account...
          </>
        ) : 'Create account'}
      </Button>
    </form>
  );
}

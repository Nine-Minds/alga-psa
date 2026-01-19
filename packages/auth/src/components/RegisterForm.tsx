'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Eye, EyeOff } from 'lucide-react';
import { verifyContactEmail } from '@alga-psa/users/actions';
import { initiateRegistration } from '@alga-psa/users/actions';
import { usePostHog } from 'posthog-js/react';
import { validateEmailAddress, validatePassword, getPasswordRequirements } from '@alga-psa/validation';

export default function RegisterForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<'checking' | 'valid' | 'invalid' | null>(null);
  const [passwordStrength, setPasswordStrength] = useState<'weak' | 'medium' | 'strong' | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const router = useRouter();
  const posthog = usePostHog();
  const journeyStartTime = useRef<number>(Date.now());
  const emailEnteredTime = useRef<number | null>(null);
  const passwordEnteredTime = useRef<number | null>(null);

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

  // Track form load
  useEffect(() => {
    posthog?.capture('registration_form_viewed', {
      form_type: 'standard_registration'
    });
  }, [posthog]);

  // Debounced email check
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!email || !email.includes('@')) return;

      // Track email entered if not already tracked
      if (!emailEnteredTime.current && email.length > 3) {
        emailEnteredTime.current = Date.now();
        posthog?.capture('registration_email_entered', {
          time_to_enter_email: emailEnteredTime.current - journeyStartTime.current
        });
      }

      setIsCheckingEmail(true);
      setEmailStatus('checking');
      try {
        const verifyResult = await verifyContactEmail(email);

        if (verifyResult.exists) {
          setEmailStatus('valid');
          posthog?.capture('registration_email_verified', {
            verification_type: 'existing_contact',
            email_domain: email.split('@')[1]
          });
        } else {
          // Registration only allowed for existing contacts
          setEmailStatus('invalid');
          posthog?.capture('registration_email_rejected', {
            rejection_reason: 'not_a_contact',
            email_domain: email.split('@')[1]
          });
        }
      } catch (error) {
        console.error('Email verification error:', error);
        setEmailStatus('invalid');
        posthog?.capture('registration_email_verification_error', {
          error_type: 'email_check_failed'
        });
      } finally {
        setIsCheckingEmail(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [email, posthog]);

  const validateForm = () => {
    const validationErrors: string[] = [];
    if (!email.trim()) validationErrors.push('Email');
    if (!email.includes('@')) validationErrors.push('Valid email address');
    if (emailStatus !== 'valid') validationErrors.push('Verified contact email');

    const passwordError = validatePassword(password);
    if (passwordError) validationErrors.push('Valid password');

    return validationErrors;
  };

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setError('');
    }
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setHasAttemptedSubmit(true);

    const validationErrors = validateForm();
    if (validationErrors.length > 0) {
      setError(`Please complete the following: ${validationErrors.join(', ')}`);
      posthog?.capture('registration_validation_failed', {
        validation_errors: validationErrors,
        form_completion_time: Date.now() - journeyStartTime.current
      });
      return;
    }

    setIsLoading(true);
    const submissionStartTime = Date.now();

    posthog?.capture('registration_submitted', {
      form_completion_time: Date.now() - journeyStartTime.current,
      password_strength: passwordStrength,
      registration_type: 'existing_contact'
    });

    try {
      // For contact-based registration only
      const result = await initiateRegistration(
        email,
        password
      );

      if (!result.success) {
        setError(result.error || 'Registration failed');
        posthog?.capture('registration_failed', {
          error_message: result.error,
          submission_duration: Date.now() - submissionStartTime,
          registration_type: 'existing_contact'
        });
      } else {
        // Contact-based registration - direct to login
        posthog?.capture('registration_success_immediate', {
          submission_duration: Date.now() - submissionStartTime,
          total_journey_time: Date.now() - journeyStartTime.current
        });
        router.push('/auth/signin?registered=true&callbackUrl=/client-portal/dashboard');
      }
    } catch (error) {
      setError('An unexpected error occurred during registration.');
      console.error('Registration error:', error);
      posthog?.capture('registration_error', {
        error_type: 'unexpected_error',
        submission_duration: Date.now() - submissionStartTime
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="registration-email-input">Email address *</Label>
        <div className="relative">
          <Input
            id="registration-email-input"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearErrorIfSubmitted();
              // Clear error when user starts typing
              if (fieldErrors.email) {
                setFieldErrors(prev => ({ ...prev, email: '' }));
              }
            }}
            onBlur={() => {
              const error = validateEmailAddress(email);
              setFieldErrors(prev => ({ ...prev, email: error || '' }));
            }}
            onFocus={() => {
              posthog?.capture('registration_field_focused', {
                field_name: 'email'
              });
            }}
            disabled={isLoading}
            className={`mt-1 ${
              hasAttemptedSubmit && (!email.trim() || emailStatus === 'invalid') ? 'border-red-500' : ''
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
              Registration is only available for existing contacts. Please contact your administrator.
            </p>
          )}
          {emailStatus === 'valid' && (
            <p className="text-green-500">
              Contact verified. Please create your password.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
          <Label htmlFor="registration-password-input">Password *</Label>
          <div className="relative">
            <Input
              id="registration-password-input"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearErrorIfSubmitted();
              }}
              disabled={isLoading}
              className={`mt-1 pr-10 ${
                hasAttemptedSubmit && (!password.trim() || passwordStrength === 'weak') ? 'border-red-500' :
                passwordStrength === 'strong' ? 'border-green-500' :
                passwordStrength === 'medium' ? 'border-yellow-500' :
                passwordStrength === 'weak' ? 'border-red-500' : ''
              }`}
              placeholder="Create a password"
              aria-describedby="password-requirements"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center"
              disabled={isLoading}
            >
              {showPassword ? (
                <Eye className="h-5 w-5 text-gray-400" />
            ) : (
                <EyeOff className="h-5 w-5 text-gray-400" />
              )}
            </button>
          </div>
          
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

      {hasAttemptedSubmit && error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>
            <p className="font-medium mb-2">Please fill in the required fields:</p>
            <ul className="list-disc list-inside space-y-1">
              {error.split(', ').map((err, index) => (
                <li key={index}>{err}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Button
        id='register-button'
        type="submit"
        disabled={isLoading}
        className={`w-full ${
          !email.trim() || emailStatus !== 'valid' || validatePassword(password)
            ? 'opacity-50' : ''
        }`}
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

"use client";
import { useState, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { EyeOpenIcon, EyeClosedIcon } from '@radix-ui/react-icons';
import Link from 'next/link';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { AlertProps } from '../../interfaces/general.interfaces';
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent';
import { FormComponent, FormFieldComponent, ButtonComponent } from '../../types/ui-reflection/types';
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId';

interface MspLoginFormProps {
  callbackUrl: string;
  onError: (alertInfo: AlertProps) => void;
  onTwoFactorRequired: () => void;
}

export default function MspLoginForm({ callbackUrl, onError, onTwoFactorRequired }: MspLoginFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Register the form component
  const updateForm = useRegisterUIComponent<FormComponent>({
    id: 'msp-login-form',
    type: 'form',
    label: 'MSP Login'
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
        callbackUrl,
      });

      if (result?.error === '2FA_REQUIRED') {
        onTwoFactorRequired();
      } else if (result?.error) {
        onError({ 
          type: 'error', 
          title: 'Sign-in Failed', 
          message: 'Invalid email or password. Please try again.' 
        });
      } else if (result?.url) {
        window.location.href = result.url;
      }
    } catch (error) {
      onError({ 
        type: 'error', 
        title: 'Error', 
        message: 'An unexpected error occurred. Please try again.' 
      });
    } finally {
      // Re-enable form elements after submission
      const isFormValid = email.length > 0 && password.length > 0 && termsAccepted;
    }
  };

  const handleGoogleSignIn = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      await signIn('google', { 
        callbackUrl,
        redirect: true
      });
    } catch (error) {
      onError({ 
        type: 'error', 
        title: 'Error', 
        message: 'An unexpected error occurred with Google sign-in.' 
      });
    }
  };

  return (
    <form className="mt-8 space-y-6" {...withDataAutomationId({ id: 'msp-login-form' })}>
      <div className="space-y-4">
        <Input
          type="email"
          id="msp-email-field"
          label="Email"
          placeholder="Enter your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <div className="relative">
          <Input
            type={showPassword ? "text" : "password"}
            id="msp-password-field"
            label="Password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute inset-y-0 right-0 pr-3 flex items-center top-7"
            onClick={() => setShowPassword(!showPassword)}
            id="msp-toggle-password-visibility"
          >
            {showPassword ? (
              <EyeOpenIcon className="h-5 w-5 text-gray-400" />
            ) : (
              <EyeClosedIcon className="h-5 w-5 text-gray-400" />
            )}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Checkbox
          id="msp-terms-checkbox"
          label="Agree to Terms and Conditions"
          checked={termsAccepted}
          onChange={(e) => setTermsAccepted(e.target.checked)}
        />
        <div className="text-sm">
          <Link href="/auth/forgot_password" className="font-medium text-purple-600 hover:text-purple-500" {...withDataAutomationId({ id: 'msp-forgot-password-link' })}>
            Forgot password?
          </Link>
        </div>
      </div>

      <div>
        <Button
          type="submit"
          onClick={handleSubmit}
          className="w-full"
          id="msp-sign-in-button"
        >
          Sign in
        </Button>
      </div>

      <div>
        <Button
          type="button"
          variant="outline"
          onClick={handleGoogleSignIn}
          className="w-full"
          id="msp-google-sign-in-button"
        >
          <svg className="w-5 h-5 mr-2" viewBox="0 0 21 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20.3081 10.2303C20.3081 9.55056 20.253 8.86711 20.1354 8.19836H10.7031V12.0492H16.1046C15.8804 13.2911 15.1602 14.3898 14.1057 15.0879V17.5866H17.3282C19.2205 15.8449 20.3081 13.2728 20.3081 10.2303Z" fill="#3F83F8"/>
            <path d="M10.7019 20.0006C13.3989 20.0006 15.6734 19.1151 17.3306 17.5865L14.1081 15.0879C13.2115 15.6979 12.0541 16.0433 10.7056 16.0433C8.09669 16.0433 5.88468 14.2832 5.091 11.9169H1.76562V14.4927C3.46322 17.8695 6.92087 20.0006 10.7019 20.0006V20.0006Z" fill="#34A853"/>
            <path d="M5.08857 11.9169C4.66969 10.6749 4.66969 9.33008 5.08857 8.08811V5.51233H1.76688C0.348541 8.33798 0.348541 11.667 1.76688 14.4927L5.08857 11.9169V11.9169Z" fill="#FBBC04"/>
            <path d="M10.7019 3.95805C12.1276 3.936 13.5055 4.47247 14.538 5.45722L17.393 2.60218C15.5852 0.904587 13.1858 -0.0287217 10.7019 0.000673888C6.92087 0.000673888 3.46322 2.13185 1.76562 5.51234L5.08732 8.08813C5.87733 5.71811 8.09302 3.95805 10.7019 3.95805V3.95805Z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </Button>
      </div>
    </form>
  );
}

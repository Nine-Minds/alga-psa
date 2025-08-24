"use client";
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { Label } from 'server/src/components/ui/Label';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { AlertProps } from '../../interfaces/general.interfaces';
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent';
import { FormComponent, FormFieldComponent } from '../../types/ui-reflection/types';
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
        userType: 'internal',
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
      const isFormValid = email.length > 0 && password.length > 0;
    }
  };


  return (
    <form 
      className="mt-8 space-y-6" 
      onSubmit={handleSubmit}
      method="POST"
      {...withDataAutomationId({ id: 'msp-login-form' })}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="msp-email-field">Email</Label>
          <Input
            type="email"
            id="msp-email-field"
            name="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div className="space-y-2 relative">
          <Label htmlFor="msp-password-field">Password</Label>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              id="msp-password-field"
              name="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full"
              autoComplete="current-password"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute inset-y-0 right-0 pr-3 flex items-center hover:bg-transparent"
              onClick={() => setShowPassword(!showPassword)}
              id="msp-toggle-password-visibility"
            >
              {showPassword ? (
                <Eye className="h-5 w-5 text-gray-400" />
              ) : (
                <EyeOff className="h-5 w-5 text-gray-400" />
              )}
            </Button>
          </div>
        </div>
      </div>

        <div className="text-sm text-right">
          <Link href="/auth/forgot-password"
          className="font-medium text-purple-600 hover:text-purple-500"
          {...withDataAutomationId({ id: 'msp-forgot-password-link' })}>
            Forgot password?
          </Link>
        </div>

      <div>
        <Button
          type="submit"
          className="w-full"
          id="msp-sign-in-button"
        >
          Sign in
        </Button>
      </div>

    </form>
  );
}

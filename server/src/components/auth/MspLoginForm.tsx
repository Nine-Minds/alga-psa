"use client";
import { useState, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { EyeOpenIcon, EyeClosedIcon } from '@radix-ui/react-icons';
import { Checkbox, Text, Flex } from '@radix-ui/themes';
import * as Form from '@radix-ui/react-form';
import Link from 'next/link';
import { AlertProps } from '@/interfaces';
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

  // Register the form component
  const updateForm = useRegisterUIComponent<FormComponent>({
    id: 'msp-login-form',
    type: 'form',
    label: 'MSP Login'
  });

  // Register email field as child of form
  const updateEmailField = useRegisterUIComponent<FormFieldComponent>({
    id: 'msp-email-field',
    type: 'formField',
    fieldType: 'textField',
    label: 'Email',
    value: email,
    required: true,
    parentId: 'msp-login-form'
  });

  // Register password field as child of form
  const updatePasswordField = useRegisterUIComponent<FormFieldComponent>({
    id: 'msp-password-field',
    type: 'formField',
    fieldType: 'textField',
    label: 'Password',
    value: password,
    required: true,
    parentId: 'msp-login-form'
  });

  // Register sign in button as child of form
  const updateSignInButton = useRegisterUIComponent<ButtonComponent>({
    id: 'msp-sign-in-button',
    type: 'button',
    label: 'Sign in',
    disabled: false,
    actions: ['click'],
    parentId: 'msp-login-form'
  });

  // Register Google sign in button as child of form
  const updateGoogleButton = useRegisterUIComponent<ButtonComponent>({
    id: 'msp-google-sign-in-button',
    type: 'button',
    label: 'Sign in with Google',
    disabled: false,
    actions: ['click'],
    parentId: 'msp-login-form'
  });

  // Register terms checkbox as child of form
  const updateTermsCheckbox = useRegisterUIComponent<FormFieldComponent>({
    id: 'msp-terms-checkbox',
    type: 'formField',
    fieldType: 'checkbox',
    label: 'Agree to Terms and Conditions',
    value: true,
    required: true,
    parentId: 'msp-login-form'
  });

  // Update field values when they change
  useEffect(() => {
    updateEmailField({ value: email });
    updatePasswordField({ value: password });
  }, [email, password, updateEmailField, updatePasswordField]);

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
    <Form.Root className="mt-8 space-y-6" {...withDataAutomationId({ id: 'msp-login-form' })}>
      <div className="space-y-4">
        <Form.Field name="email">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Form.Message className="FormMessage" match="valueMissing">
              Please enter your email
            </Form.Message>
            <Form.Message className="FormMessage" match="typeMismatch">
              Please provide a valid email
            </Form.Message>
          </div>
          <Form.Control asChild>
            <input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="appearance-none rounded-md relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-purple-500 focus:border-purple-500 focus:z-10 sm:text-sm"
              {...withDataAutomationId({ id: 'msp-email-field' })}
            />
          </Form.Control>
        </Form.Field>
        <Form.Field name="password">
          <div className="relative">
            <Form.Control asChild>
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="appearance-none rounded-md relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-purple-500 focus:border-purple-500 focus:z-10 sm:text-sm pr-10"
                {...withDataAutomationId({ id: 'msp-password-field' })}
              />
            </Form.Control>
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center"
              {...withDataAutomationId({ id: 'msp-toggle-password-visibility' })}
            >
              {showPassword ? (
                <EyeOpenIcon className="h-5 w-5 text-gray-400" />
              ) : (
                <EyeClosedIcon className="h-5 w-5 text-gray-400" />
              )}
            </button>
          </div>
        </Form.Field>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <Text as="label" size="2">
            <Flex gap="2">
              <Checkbox color="purple" defaultChecked {...withDataAutomationId({ id: 'msp-terms-checkbox' })} />
              Agree to Terms and Conditions
            </Flex>
          </Text>
        </div>
        <div className="text-sm">
          <Link href="/auth/forgot_password" className="font-medium text-purple-600 hover:text-purple-500" {...withDataAutomationId({ id: 'msp-forgot-password-link' })}>
            Forgot password?
          </Link>
        </div>
      </div>

      <div>
        <button
          type="submit"
          onClick={handleSubmit}
          className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
          {...withDataAutomationId({ id: 'msp-sign-in-button' })}
        >
          Sign in
        </button>
      </div>

      <div>
        <button
          type="button"
          onClick={handleGoogleSignIn}
          className="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
          {...withDataAutomationId({ id: 'msp-google-sign-in-button' })}
        >
          <svg className="w-5 h-5 mr-2" viewBox="0 0 21 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20.3081 10.2303C20.3081 9.55056 20.253 8.86711 20.1354 8.19836H10.7031V12.0492H16.1046C15.8804 13.2911 15.1602 14.3898 14.1057 15.0879V17.5866H17.3282C19.2205 15.8449 20.3081 13.2728 20.3081 10.2303Z" fill="#3F83F8"/>
            <path d="M10.7019 20.0006C13.3989 20.0006 15.6734 19.1151 17.3306 17.5865L14.1081 15.0879C13.2115 15.6979 12.0541 16.0433 10.7056 16.0433C8.09669 16.0433 5.88468 14.2832 5.091 11.9169H1.76562V14.4927C3.46322 17.8695 6.92087 20.0006 10.7019 20.0006V20.0006Z" fill="#34A853"/>
            <path d="M5.08857 11.9169C4.66969 10.6749 4.66969 9.33008 5.08857 8.08811V5.51233H1.76688C0.348541 8.33798 0.348541 11.667 1.76688 14.4927L5.08857 11.9169V11.9169Z" fill="#FBBC04"/>
            <path d="M10.7019 3.95805C12.1276 3.936 13.5055 4.47247 14.538 5.45722L17.393 2.60218C15.5852 0.904587 13.1858 -0.0287217 10.7019 0.000673888C6.92087 0.000673888 3.46322 2.13185 1.76562 5.51234L5.08732 8.08813C5.87733 5.71811 8.09302 3.95805 10.7019 3.95805V3.95805Z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </button>
      </div>
    </Form.Root>
  );
}

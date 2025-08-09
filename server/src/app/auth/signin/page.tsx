"use client";
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { useRegisterUIComponent } from '../../../types/ui-reflection/useRegisterUIComponent';
import { ContainerComponent, CardComponent, DialogComponent, FormComponent, ButtonComponent, FormFieldComponent } from '../../../types/ui-reflection/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/Card';
import MspLoginForm from '../../../components/auth/MspLoginForm';
import ClientLoginForm from '../../../components/auth/ClientLoginForm';
import RegisterForm from '../../../components/auth/RegisterForm';
import TwoFactorInput from '../../../components/auth/TwoFA';
import Alert from '../../../components/auth/Alert';
import { AlertProps } from '../../../interfaces';

export default function SignIn() {
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [alertInfo, setAlertInfo] = useState<AlertProps>({ type: 'success', title: '', message: '' });
  const [isOpen2FA, setIsOpen2FA] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const searchParams = useSearchParams();

  const callbackUrl = searchParams?.get('callbackUrl') || '';
  const isClientPortal = callbackUrl.includes('/client-portal');
  const error = searchParams?.get('error');
  const registered = searchParams?.get('registered');

  // Register the page container
  const updatePage = useRegisterUIComponent<ContainerComponent>({
    id: 'signin-page',
    type: 'container',
    label: isClientPortal ? 'Client Portal Login' : 'MSP Login'
  });

  // Register alert dialog
  const updateAlert = useRegisterUIComponent<DialogComponent>({
    id: 'signin-alert',
    type: 'dialog',
    title: alertInfo.title,
    open: isAlertOpen,
    parentId: 'signin-page'
  });

  // Register 2FA dialog
  const update2FA = useRegisterUIComponent<DialogComponent>({
    id: 'signin-2fa',
    type: 'dialog',
    title: '2FA Verification',
    open: isOpen2FA,
    parentId: 'signin-page'
  });

  // Register 2FA close button
  const update2FACloseButton = useRegisterUIComponent<ButtonComponent>({
    id: 'signin-2fa-close-button',
    type: 'button',
    label: 'Close 2FA Dialog',
    parentId: 'signin-2fa'
  });

  // Register main card
  const updateCard = useRegisterUIComponent<CardComponent>({
    id: 'signin-card',
    type: 'card',
    label: isClientPortal ? 
      (showRegister ? 'Create Account' : 'Client Portal Login') : 
      'MSP Dashboard Login',
    parentId: 'signin-page'
  });

  // Handle error and success messages from URL parameters
  useEffect(() => {
    if (error === 'AccessDenied') {
      setAlertInfo({
        type: 'error',
        title: 'Access Denied',
        message: 'You do not have permission to access this page.'
      });
      setIsAlertOpen(true);
    } else if (registered === 'true') {
      setAlertInfo({
        type: 'success',
        title: 'Registration Successful',
        message: 'Your account has been created. Please sign in.'
      });
      setIsAlertOpen(true);
    }
  }, [error, registered]);

  // Update component states when they change
  useEffect(() => {
    updateAlert({ 
      open: isAlertOpen,
      title: alertInfo.title
    });
    
    update2FA({ 
      open: isOpen2FA 
    });

    // Update 2FA close button state
    update2FACloseButton({
      label: 'Close 2FA Dialog',
      disabled: !isOpen2FA
    });

    updateCard({
      label: isClientPortal ? 
        (showRegister ? 'Create Account' : 'Client Portal Login') : 
        'MSP Dashboard Login'
    });
  }, [
    isAlertOpen, alertInfo, isOpen2FA, showRegister, isClientPortal,
    updateAlert, update2FA, update2FACloseButton, updateCard
  ]);

  const handle2FA = (twoFactorCode: string) => {
    setIsOpen2FA(false);
    // Re-attempt sign in with 2FA code
    // This will be handled by the respective form components
  };

  const handleError = (error: AlertProps | string) => {
    if (typeof error === 'string') {
      setAlertInfo({
        type: 'error',
        title: 'Error',
        message: error
      });
    } else {
      setAlertInfo(error);
    }
    setIsAlertOpen(true);
  };

  // Initialize page state once at component mount
  useEffect(() => {
    updatePage({
      label: isClientPortal ? 'Client Portal Login' : 'MSP Login',
      children: []
    });
  }, [isClientPortal, updatePage]);

  return (
    <div className="flex min-h-screen bg-gray-100">
      <TwoFactorInput
        isOpen={isOpen2FA}
        onClose={() => setIsOpen2FA(false)}
        onComplete={handle2FA}
      />

      <Alert
        type={alertInfo.type}
        title={alertInfo.title}
        message={alertInfo.message}
        isOpen={isAlertOpen}
        onClose={() => setIsAlertOpen(false)}
      />

      {/* Logo and text in top left corner */}
      <div className="absolute top-4 left-8 flex items-center">
        <Image
          src="/images/avatar-purple-background.png"
          alt="Logo"
          width={50}
          height={50}
          className="rounded-full mr-4"
        />
        <span className="text-lg font-semibold text-gray-800">
          {isClientPortal ? 'Client Portal' : 'AI-Enhanced PSA Platform for MSPs'}
        </span>
      </div>

      {/* Left side with logo - only show for MSP login */}
      {!isClientPortal && (
        <div className="hidden lg:flex lg:w-1/2 bg-white p-12 flex-col justify-center items-center">
          <Image
            src="/images/avatar-purple-big.png"
            alt="Company Logo"
            width={200}
            height={200}
            className="rounded-full"
          />
          <p className="mt-4 text-center text-2xl font-bold text-gray-700">
            An open source PSA, <br />
            empowering the future of MSPs <br />
            with AI-driven insights and automation.
          </p>
        </div>
      )}

      {/* Right side with SignIn/Register form */}
      <div className={`w-full ${isClientPortal ? '' : 'lg:w-1/2'} flex items-center justify-center`}>
        <Card className="max-w-md w-full m-8">
          <CardHeader>
            <CardTitle className="text-2xl font-bold">
              {isClientPortal ? (
                showRegister ? 'Create Account' : 'Client Portal Login'
              ) : (
                'MSP Dashboard Login'
              )}
            </CardTitle>
            <CardDescription>
              {isClientPortal ? (
                showRegister ?
                  'Create your account to access the client portal.' :
                  'Please enter your credentials to access the client portal.'
              ) : (
                'Welcome back! Please enter your details.'
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isClientPortal ? (
              showRegister ? (
                <>
                  <RegisterForm />
                  <p className="mt-4 text-center text-sm text-gray-600">
                    Already have an account?{' '}
                    <button
                      onClick={() => setShowRegister(false)}
                      className="font-medium text-blue-600 hover:text-blue-500"
                    >
                      Sign in
                    </button>
                  </p>
                </>
              ) : (
                <ClientLoginForm
                  callbackUrl={callbackUrl}
                  onError={handleError}
                  onTwoFactorRequired={() => setIsOpen2FA(true)}
                />
              )
            ) : (
              <MspLoginForm
                callbackUrl={callbackUrl}
                onError={handleError}
                onTwoFactorRequired={() => setIsOpen2FA(true)}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

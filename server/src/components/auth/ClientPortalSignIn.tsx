"use client";
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import ClientLoginForm from 'server/src/components/auth/ClientLoginForm';
import TwoFactorInput from 'server/src/components/auth/TwoFA';
import Alert from 'server/src/components/auth/Alert';
import { AlertProps } from 'server/src/interfaces';
import { Ticket, FileText, Eye, History } from 'lucide-react';

export default function ClientPortalSignIn() {
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [alertInfo, setAlertInfo] = useState<AlertProps>({ type: 'success', title: '', message: '' });
  const [isOpen2FA, setIsOpen2FA] = useState(false);
  const searchParams = useSearchParams();

  const callbackUrl = searchParams?.get('callbackUrl') || '/client-portal/dashboard';
  const error = searchParams?.get('error');
  const registered = searchParams?.get('registered');

  // Handle error and success messages from URL parameters
  useEffect(() => {
    if (error === 'AccessDenied') {
      setAlertInfo({
        type: 'error',
        title: 'Access Denied',
        message: 'You do not have permission to access the client portal.'
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

  const handle2FA = (twoFactorCode: string) => {
    setIsOpen2FA(false);
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
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

      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-8 flex justify-between items-center">
        <div className="flex items-center">
          <Image
            src="/images/avatar-purple-background.png"
            alt="Logo"
            width={50}
            height={50}
            className="rounded-full mr-4"
          />
          <div>
            <span className="text-2xl font-bold text-gray-800">Client Portal</span>
          </div>
        </div>
      </div>

      <div className="flex min-h-screen">
        {/* Left side with features */}
        <div className="hidden lg:flex lg:w-1/2 p-12 flex-col justify-center items-center">
          <div className="max-w-lg">
            <div className="bg-white rounded-full p-8 mb-8 mx-auto w-48 h-48 flex items-center justify-center shadow-lg">
              <Ticket className="w-24 h-24 text-indigo-600" />
            </div>
            <h1 className="text-4xl font-bold text-gray-800 mb-4 text-center">
              Welcome to Your Client Portal
            </h1>
            <p className="text-lg text-gray-600 mb-8 text-center">
              Manage your support tickets and stay connected
            </p>
            <div className="space-y-4">
              <div className="flex items-start space-x-3">
                <Ticket className="w-6 h-6 text-indigo-600 mt-1 flex-shrink-0" />
                <div>
                  <h3 className="text-gray-800 font-semibold">Submit Support Tickets</h3>
                  <p className="text-gray-600 text-sm">Create and manage your support requests</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <Eye className="w-6 h-6 text-indigo-600 mt-1 flex-shrink-0" />
                <div>
                  <h3 className="text-gray-800 font-semibold">Track Ticket Status</h3>
                  <p className="text-gray-600 text-sm">Monitor progress in real-time</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <History className="w-6 h-6 text-indigo-600 mt-1 flex-shrink-0" />
                <div>
                  <h3 className="text-gray-800 font-semibold">Ticket History</h3>
                  <p className="text-gray-600 text-sm">Access your complete support history</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <FileText className="w-6 h-6 text-indigo-600 mt-1 flex-shrink-0" />
                <div>
                  <h3 className="text-gray-800 font-semibold">Documentation Access</h3>
                  <p className="text-gray-600 text-sm">View shared documents and resources</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right side with login form */}
        <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
          <Card className="max-w-md w-full bg-white shadow-xl">
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl font-bold text-center">
                Client Portal Login
              </CardTitle>
              <CardDescription className="text-center">
                Please enter your credentials to access your account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ClientLoginForm
                callbackUrl={callbackUrl}
                onError={handleError}
                onTwoFactorRequired={() => setIsOpen2FA(true)}
              />
              <div className="mt-6 pt-6 border-t text-center">
                <a href="/auth/msp/signin" className="text-sm text-gray-600 hover:text-indigo-600">
                  MSP Staff? Login here →
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
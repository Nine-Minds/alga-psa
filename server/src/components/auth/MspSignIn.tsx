"use client";
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import MspLoginForm from 'server/src/components/auth/MspLoginForm';
import TwoFactorInput from 'server/src/components/auth/TwoFA';
import Alert from 'server/src/components/auth/Alert';
import { AlertProps } from 'server/src/interfaces';
import { Ticket, Mail, Calendar, Clock, Users, FileText, Layers } from 'lucide-react';

export default function MspSignIn() {
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [alertInfo, setAlertInfo] = useState<AlertProps>({ type: 'success', title: '', message: '' });
  const [isOpen2FA, setIsOpen2FA] = useState(false);
  const searchParams = useSearchParams();

  const callbackUrl = searchParams?.get('callbackUrl') || '/msp/dashboard';
  const error = searchParams?.get('error');

  // Handle error messages from URL parameters
  useEffect(() => {
    if (error === 'AccessDenied') {
      setAlertInfo({
        type: 'error',
        title: 'Access Denied',
        message: 'You do not have permission to access the MSP dashboard.'
      });
      setIsAlertOpen(true);
    } else if (error === 'SessionRevoked') {
      setAlertInfo({
        type: 'warning',
        title: 'Session Ended',
        message: 'Your session has been signed out. Please sign in again.'
      });
      setIsAlertOpen(true);
    }
  }, [error]);

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
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-purple-100 to-indigo-100">
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
            <span className="text-2xl font-bold text-gray-800">MSP Dashboard</span>
          </div>
        </div>
      </div>

      <div className="flex min-h-screen">
        {/* Left side with features */}
        <div className="hidden lg:flex lg:w-1/2 p-12 flex-col justify-center items-center">
          <div className="max-w-lg">
            <Image
              src="/images/avatar-purple-big.png"
              alt="Client Logo"
              width={200}
              height={200}
              className="rounded-full mb-8 mx-auto"
            />
            <h1 className="text-4xl font-bold text-gray-800 mb-4 text-center">
              Professional Services Automation
            </h1>
            <p className="text-lg text-gray-600 mb-2 text-center">
              Open source PSA platform for Managed Service Providers
            </p>
            <div className="space-y-3">
              <div className="flex items-start space-x-3">
                <Ticket className="w-5 h-5 text-purple-600 mt-1 flex-shrink-0" />
                <div>
                  <h3 className="text-gray-800 font-semibold text-sm">Comprehensive Ticketing</h3>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <Mail className="w-5 h-5 text-purple-600 mt-1 flex-shrink-0" />
                <div>
                  <h3 className="text-gray-800 font-semibold text-sm">Inbound Emails</h3>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <Calendar className="w-5 h-5 text-purple-600 mt-1 flex-shrink-0" />
                <div>
                  <h3 className="text-gray-800 font-semibold text-sm">Technician Dispatch and Scheduling</h3>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <Clock className="w-5 h-5 text-purple-600 mt-1 flex-shrink-0" />
                <div>
                  <h3 className="text-gray-800 font-semibold text-sm">Time Entry/Tracking</h3>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <Layers className="w-5 h-5 text-purple-600 mt-1 flex-shrink-0" />
                <div>
                  <h3 className="text-gray-800 font-semibold text-sm">Project Management Tools</h3>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <Users className="w-5 h-5 text-purple-600 mt-1 flex-shrink-0" />
                <div>
                  <h3 className="text-gray-800 font-semibold text-sm">Client and Contact Management</h3>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <FileText className="w-5 h-5 text-purple-600 mt-1 flex-shrink-0" />
                <div>
                  <h3 className="text-gray-800 font-semibold text-sm">Centralized Document Uploads and Storage</h3>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right side with login form */}
        <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
          <Card className="max-w-md w-full bg-white/95 backdrop-blur">
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl font-bold text-center">
                MSP Dashboard Login
              </CardTitle>
              <CardDescription className="text-center">
                Access your managed services platform
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MspLoginForm
                callbackUrl={callbackUrl}
                onError={handleError}
                onTwoFactorRequired={() => setIsOpen2FA(true)}
              />
              <div className="mt-6 text-center">
                <a href="/auth/client-portal/signin" className="text-sm text-gray-600 hover:text-purple-600">
                  Looking for the Client Portal? Click here →
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
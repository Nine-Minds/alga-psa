"use client";
import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import ClientLoginForm from 'server/src/components/auth/ClientLoginForm';
import TwoFactorInput from 'server/src/components/auth/TwoFA';
import Alert from 'server/src/components/auth/Alert';
import { AlertProps } from 'server/src/interfaces';
import { Ticket, FileText, Eye, History } from 'lucide-react';
import { useTranslation } from 'server/src/lib/i18n/client';
import { TenantBranding } from '@product/actions/tenant-actions/tenantBrandingActions';

interface ClientPortalSignInProps {
  branding?: TenantBranding | null;
}

export default function ClientPortalSignIn({ branding }: ClientPortalSignInProps) {
  const { t } = useTranslation('clientPortal');
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
        title: t('auth.accessDeniedTitle', 'Access Denied'),
        message: t('auth.accessDeniedMessage', 'You do not have permission to access the client portal.')
      });
      setIsAlertOpen(true);
    } else if (registered === 'true') {
      setAlertInfo({
        type: 'success',
        title: t('auth.registrationSuccessTitle', 'Registration Successful'),
        message: t('auth.registrationSuccessMessage', 'Your account has been created. Please sign in.')
      });
      setIsAlertOpen(true);
    }
  }, [error, registered, t]);

  const handle2FA = (_twoFactorCode: string) => {
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

  // Convert hex to RGB
  const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  };

  // Helper function to generate color shades
  const generateColorShades = (hex: string): Record<number, string> => {
    const rgb = hexToRgb(hex);
    if (!rgb) return {};

    const shades: Record<number, string> = {};

    // Base color (500)
    shades[500] = `${rgb.r} ${rgb.g} ${rgb.b}`;

    // Generate darker shade for hover (600)
    shades[600] = `${Math.max(0, Math.round(rgb.r * 0.85))} ${Math.max(0, Math.round(rgb.g * 0.85))} ${Math.max(0, Math.round(rgb.b * 0.85))}`;

    return shades;
  };

  // Apply branding colors to buttons
  useEffect(() => {
    // Check if server-side styles already exist
    const serverStyles = document.getElementById('server-tenant-branding-styles');
    if (serverStyles) {
      console.log('ClientPortalSignIn: Server-side styles already present, skipping client-side injection');
      return;
    }

    if (branding?.secondaryColor) {
      // For sign-in page, use secondary color for the primary button
      const secondaryShades = generateColorShades(branding.secondaryColor);

      const style = document.createElement('style');
      style.setAttribute('data-signin-branding', 'true');
      style.textContent = `
        /* Override default button colors to use secondary color on sign-in page */
        #client-sign-in-button {
          background-color: rgb(${secondaryShades[500]}) !important;
        }
        #client-sign-in-button:hover:not(:disabled) {
          background-color: rgb(${secondaryShades[600]}) !important;
        }
      `;

      document.head.appendChild(style);

      // Cleanup function
      return () => {
        if (document.head.contains(style)) {
          document.head.removeChild(style);
        }
      };
    }
  }, [branding?.secondaryColor]);

  // Generate gradient based on branding colors or use defaults
  const gradientStyle = useMemo(() => {
    if (!branding?.primaryColor || !branding?.secondaryColor) {
      return 'bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50';
    }

    // Create CSS gradient from hex colors with opacity
    const primaryRgb = hexToRgb(branding.primaryColor);
    const secondaryRgb = hexToRgb(branding.secondaryColor);

    if (primaryRgb && secondaryRgb) {
      return {
        background: `linear-gradient(to bottom right,
          rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.05),
          rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.1),
          rgba(${secondaryRgb.r}, ${secondaryRgb.g}, ${secondaryRgb.b}, 0.1))`
      };
    }

    return 'bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50';
  }, [branding]);

  // Use branded colors for accents
  const accentColor = branding?.primaryColor || '#6366F1';

  return (
    <div className={typeof gradientStyle === 'string' ? `min-h-screen ${gradientStyle}` : 'min-h-screen'}
         style={typeof gradientStyle === 'object' ? gradientStyle : undefined}>
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
          {branding?.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt={branding.clientName || 'Client Logo'}
              width={50}
              height={50}
              className="rounded-full mr-4 object-contain"
            />
          ) : (
            <Image
              src="/images/avatar-purple-background.png"
              alt="Logo"
              width={50}
              height={50}
              className="rounded-full mr-4"
            />
          )}
          <div>
            <span className="text-2xl font-bold text-gray-800">
              {branding?.clientName ?
                `${branding.clientName} ${t('nav.clientPortal', 'Client Portal')}` :
                t('nav.clientPortal', 'Client Portal')}
            </span>
          </div>
        </div>
      </div>

      <div className="flex min-h-screen">
        {/* Left side with features */}
        <div className="hidden lg:flex lg:w-1/2 p-12 flex-col justify-center items-center">
          <div className="max-w-lg">
            <div className="bg-white rounded-full p-8 mb-8 mx-auto w-48 h-48 flex items-center justify-center shadow-lg">
              {branding?.logoUrl ? (
                <img
                  src={branding.logoUrl}
                  alt={branding.clientName || 'Client Logo'}
                  className="w-24 h-24 object-contain"
                />
              ) : (
                <Ticket className="w-24 h-24" style={{ color: accentColor }} />
              )}
            </div>
            <h1 className="text-4xl font-bold text-gray-800 mb-4 text-center">
              {t('auth.welcomeTitle', 'Welcome to Your Client Portal')}
            </h1>
            <p className="text-lg text-gray-600 mb-8 text-center">
              {t('auth.welcomeSubtitle', 'Manage your support tickets and stay connected')}
            </p>
            <div className="space-y-4">
              <div className="flex items-start space-x-3">
                <Ticket className="w-6 h-6 mt-1 flex-shrink-0" style={{ color: accentColor }} />
                <div>
                  <h3 className="text-gray-800 font-semibold">{t('auth.features.submitTickets.title', 'Submit Support Tickets')}</h3>
                  <p className="text-gray-600 text-sm">{t('auth.features.submitTickets.description', 'Create and manage your support requests')}</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <Eye className="w-6 h-6 mt-1 flex-shrink-0" style={{ color: accentColor }} />
                <div>
                  <h3 className="text-gray-800 font-semibold">{t('auth.features.trackStatus.title', 'Track Ticket Status')}</h3>
                  <p className="text-gray-600 text-sm">{t('auth.features.trackStatus.description', 'Monitor progress in real-time')}</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <History className="w-6 h-6 mt-1 flex-shrink-0" style={{ color: accentColor }} />
                <div>
                  <h3 className="text-gray-800 font-semibold">{t('auth.features.ticketHistory.title', 'Ticket History')}</h3>
                  <p className="text-gray-600 text-sm">{t('auth.features.ticketHistory.description', 'Access your complete support history')}</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <FileText className="w-6 h-6 mt-1 flex-shrink-0" style={{ color: accentColor }} />
                <div>
                  <h3 className="text-gray-800 font-semibold">{t('auth.features.documentation.title', 'Documentation Access')}</h3>
                  <p className="text-gray-600 text-sm">{t('auth.features.documentation.description', 'View shared documents and resources')}</p>
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
                {t('auth.signIn', 'Sign In')}
              </CardTitle>
              <CardDescription className="text-center">
                {t('auth.signInDescription', 'Please enter your credentials to access your account.')}
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
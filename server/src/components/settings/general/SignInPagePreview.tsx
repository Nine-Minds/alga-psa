'use client';

import React, { useEffect } from 'react';
import { Ticket, FileText, Eye, History, EyeOff } from 'lucide-react';
import Image from 'next/image';
import { useTranslation } from 'server/src/lib/i18n/client';
import { SupportedLocale } from '@/lib/i18n/config';

interface SignInPagePreviewProps {
  branding: {
    logoUrl: string;
    primaryColor: string;
    secondaryColor: string;
    companyName: string;
  };
  locale?: SupportedLocale;
}

export default function SignInPagePreview({ branding, locale }: SignInPagePreviewProps) {
  const { logoUrl, primaryColor, secondaryColor, companyName } = branding;
  const { t, i18n } = useTranslation('clientPortal');

  // Change language when locale prop changes
  useEffect(() => {
    if (locale && i18n.language !== locale) {
      i18n.changeLanguage(locale);
    }
  }, [locale, i18n]);

  // Convert hex to RGB
  const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  };

  // Generate gradient style
  const getGradientStyle = () => {
    const primaryRgb = hexToRgb(primaryColor);
    const secondaryRgb = hexToRgb(secondaryColor);

    if (primaryRgb && secondaryRgb) {
      return {
        background: `linear-gradient(to bottom right,
          rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.05),
          rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.1),
          rgba(${secondaryRgb.r}, ${secondaryRgb.g}, ${secondaryRgb.b}, 0.1))`
      };
    }

    return {};
  };

  return (
    <div className="relative rounded-lg overflow-hidden border border-gray-200 shadow-lg">
      {/* Preview container with custom gradient */}
      <div className="min-h-[500px]" style={getGradientStyle()}>
        {/* Header */}
        <div className="p-6 flex items-center">
          <div className="flex items-center">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={companyName || 'Company Logo'}
                width={40}
                height={40}
                className="rounded-full mr-3 object-contain"
              />
            ) : (
              <Image
                src="/images/avatar-purple-background.png"
                alt="Logo"
                width={40}
                height={40}
                className="rounded-full mr-3"
              />
            )}
            <span className="text-xl font-bold text-gray-800">
              {companyName ? `${companyName} ${t('nav.portal', 'Portal')}` : t('nav.clientPortal', 'Client Portal')}
            </span>
          </div>
        </div>

        <div className="flex px-6 pb-6">
          {/* Left side - features */}
          <div className="w-1/2 pr-6">
            <div className="bg-white rounded-full p-6 mb-4 mx-auto w-32 h-32 flex items-center justify-center shadow-lg">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={companyName || 'Company Logo'}
                  className="w-20 h-20 object-contain"
                />
              ) : (
                <Ticket className="w-20 h-20" style={{ color: primaryColor }} />
              )}
            </div>
            <p className="text-lg font-bold text-center text-gray-800 mb-1">{t('auth.welcomeTitle', 'Welcome to Your Client Portal')}</p>
            <p className="text-xs text-center text-gray-600 mb-4">{t('auth.welcomeSubtitle', 'Manage your support tickets and stay connected')}</p>
            <div className="space-y-2">
              <div className="flex items-start space-x-2">
                <Ticket className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: primaryColor }} />
                <div>
                  <p className="text-xs font-semibold text-gray-700">{t('auth.features.submitTickets.title', 'Submit Support Tickets')}</p>
                  <p className="text-xs text-gray-500">{t('auth.features.submitTickets.description', 'Create and manage your support requests')}</p>
                </div>
              </div>
              <div className="flex items-start space-x-2">
                <Eye className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: primaryColor }} />
                <div>
                  <p className="text-xs font-semibold text-gray-700">{t('auth.features.trackStatus.title', 'Track Ticket Status')}</p>
                  <p className="text-xs text-gray-500">{t('auth.features.trackStatus.description', 'Monitor progress in real-time')}</p>
                </div>
              </div>
              <div className="flex items-start space-x-2">
                <History className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: primaryColor }} />
                <div>
                  <p className="text-xs font-semibold text-gray-700">{t('auth.features.ticketHistory.title', 'Ticket History')}</p>
                  <p className="text-xs text-gray-500">{t('auth.features.ticketHistory.description', 'Access your complete support history')}</p>
                </div>
              </div>
              <div className="flex items-start space-x-2">
                <FileText className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: primaryColor }} />
                <div>
                  <p className="text-xs font-semibold text-gray-700">{t('auth.features.documentation.title', 'Documentation Access')}</p>
                  <p className="text-xs text-gray-500">{t('auth.features.documentation.description', 'View shared documents and resources')}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right side - sign in form */}
          <div className="w-1/2 flex items-center justify-center">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
              <h3 className="text-lg font-bold mb-1 text-center">{t('auth.signIn', 'Sign In')}</h3>
              <p className="text-xs text-gray-600 text-center mb-4">{t('auth.signInDescription', 'Please enter your credentials to access your account.')}</p>

              <div className="space-y-3">
                {/* Email field */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">{t('auth.email', 'Email')}</label>
                  <div className="w-full px-3 py-1.5 text-xs border border-gray-300 rounded-md bg-gray-50 text-gray-400">
                    {t('auth.emailPlaceholder', 'Enter your email')}
                  </div>
                </div>

                {/* Password field */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">{t('auth.password', 'Password')}</label>
                  <div className="relative">
                    <div className="w-full px-3 py-1.5 pr-8 text-xs border border-gray-300 rounded-md bg-gray-50 text-gray-400">
                      {t('auth.passwordPlaceholder', 'Enter your password')}
                    </div>
                    <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                      <EyeOff className="h-3 w-3 text-gray-400" />
                    </div>
                  </div>
                </div>

                {/* Forgot password link */}
                <div className="text-right">
                  <span
                    className="text-xs"
                    style={{ color: secondaryColor }}
                  >
                    {t('auth.forgotPassword', 'Forgot your password?')}
                  </span>
                </div>

                {/* Sign in button */}
                <div
                  className="w-full py-2 px-3 text-xs font-medium text-white rounded-md text-center"
                  style={{ backgroundColor: secondaryColor }}
                >
                  {t('auth.signIn', 'Sign In')}
                </div>

                {/* MSP Staff link */}
                <div className="mt-4 pt-3 border-t text-center">
                  <span className="text-xs text-gray-600">
                    {t('auth.mspStaffLogin', 'MSP Staff? Login here →')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

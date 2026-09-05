"use client";

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Mail } from 'lucide-react';
import { requestTenantLoginLinksAction } from '@alga-psa/client-portal/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import toast from 'react-hot-toast';

interface ClientPortalTenantDiscoveryProps {
  callbackUrl?: string;
}

export default function ClientPortalTenantDiscovery({ callbackUrl }: ClientPortalTenantDiscoveryProps) {
  const { t } = useTranslation('client-portal');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !email.includes('@')) {
      toast.error(t('auth.tenantDiscovery.invalidEmail', 'Please enter a valid email address'));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await requestTenantLoginLinksAction(email.trim().toLowerCase(), callbackUrl);

      if (result.success) {
        setIsSubmitted(true);
        toast.success(result.message || t('auth.tenantDiscovery.linksSent', 'Check your email for login links'));
      } else {
        // Always show generic success message to prevent account enumeration
        setIsSubmitted(true);
      }
    } catch (error) {
      console.error('Error requesting tenant login links:', error);
      // Show generic success message even on error to prevent enumeration
      setIsSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen auth-page-surface flex items-center justify-center p-8">
        <Card className="max-w-md w-full bg-white shadow-xl">
          <CardHeader className="space-y-1">
            <div className="flex justify-center mb-4">
              <div className="bg-success/10 rounded-full p-3">
                <Mail className="w-8 h-8 text-success" />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold text-center">
              {t('auth.tenantDiscovery.sent.title', 'Check Your Email')}
            </CardTitle>
            <CardDescription className="text-center">
              {t('auth.tenantDiscovery.sent.description', "If an account exists with that email address, we've sent you login links for each organization you have access to.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-gray-600 text-center">
              <p className="mb-2">{t('auth.tenantDiscovery.sent.noEmailReceived', "Didn't receive an email?")}</p>
              <ul className="list-disc list-inside text-left space-y-1">
                <li>{t('auth.tenantDiscovery.sent.checkSpam', 'Check your spam folder')}</li>
                <li>{t('auth.tenantDiscovery.sent.verifyAddress', 'Verify the email address is correct')}</li>
                <li>{t('auth.tenantDiscovery.sent.contactSupport', "Contact your organization's support team")}</li>
              </ul>
            </div>
            <Button
              id="tenant-discovery-back-button"
              variant="outline"
              className="w-full"
              onClick={() => {
                setIsSubmitted(false);
                setEmail('');
              }}
            >
              {t('auth.tenantDiscovery.sent.tryAnother', 'Try Another Email')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen auth-page-surface flex items-center justify-center p-8">
      <Card className="max-w-md w-full bg-white shadow-xl">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">
            {t('auth.tenantDiscovery.title', 'Find Your Organization')}
          </CardTitle>
          <CardDescription className="text-center">
            {t('auth.tenantDiscovery.description', "Enter your email address and we'll send you login links for all organizations you have access to.")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form id="tenant-discovery-form" onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tenant-discovery-email">{t('auth.tenantDiscovery.emailLabel', 'Email Address')}</Label>
              <Input
                id="tenant-discovery-email"
                type="email"
                placeholder={t('auth.tenantDiscovery.emailPlaceholder', 'your.email@company.com')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isSubmitting}
                autoFocus
              />
            </div>

            <Button
              id="tenant-discovery-submit-button"
              type="submit"
              className="w-full"
              disabled={isSubmitting || !email}
            >
              {isSubmitting ? (
                <>
                  <Mail className="w-4 h-4 mr-2 animate-pulse" />
                  {t('auth.tenantDiscovery.submitting', 'Sending...')}
                </>
              ) : (
                <>
                  <Mail className="w-4 h-4 mr-2" />
                  {t('auth.tenantDiscovery.submit', 'Send Login Links')}
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t text-center">
            <a href="/auth/msp/signin" className="text-sm text-gray-600 hover:text-indigo-600">
              {t('auth.mspStaffLogin', 'MSP Staff? Login here →')}
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

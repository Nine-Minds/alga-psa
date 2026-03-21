'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type SurveyModuleFrameProps = {
  children: React.ReactNode;
};

export default function SurveyModuleFrame({ children }: SurveyModuleFrameProps) {
  const { t } = useTranslation('msp/surveys');
  const pathname = usePathname();

  const menuItems = useMemo(
    () => [
      {
        label: t('moduleFrame.nav.dashboard', { defaultValue: 'Dashboard' }),
        href: '/msp/surveys/dashboard',
      },
      {
        label: t('moduleFrame.nav.responses', { defaultValue: 'Responses' }),
        href: '/msp/surveys/responses',
      },
      {
        label: t('moduleFrame.nav.analytics', { defaultValue: 'Analytics' }),
        href: '/msp/surveys/analytics',
      },
      {
        label: t('moduleFrame.nav.setup', { defaultValue: 'Setup' }),
        href: '/msp/surveys/settings',
      },
    ],
    [t]
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col space-y-6 pb-12">
      <header className="flex flex-col gap-4 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              {t('moduleFrame.title', { defaultValue: 'Customer Satisfaction Surveys' })}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('moduleFrame.description', {
                defaultValue: 'Monitor response quality, analyse satisfaction trends, and follow up on feedback.',
              })}
            </p>
          </div>
          <div className="hidden items-center rounded-full bg-primary-50 px-4 py-2 text-primary-600 sm:flex">
            <BarChart3 className="mr-2 h-4 w-4" />
            {t('moduleFrame.badge', { defaultValue: 'Satisfaction Insights' })}
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-2">
          {menuItems.map((item) => {
            const isActive =
              pathname === item.href || (item.href !== '/msp/surveys/dashboard' && pathname?.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'bg-muted text-muted-foreground hover:text-gray-900'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <section>{children}</section>
    </div>
  );
}

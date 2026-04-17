'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrency } from '@alga-psa/core';
import type { ColumnDefinition, ICreditExpirationSettings, ICreditTracking } from '@alga-psa/types';
import AddCreditButton from './AddCreditButton';
import BackButton from './BackButton';
import { CreditsTabs } from './CreditsTabs';

type CreditRow = ICreditTracking & {
  transaction_description?: string;
  invoice_number?: string;
};

interface CreditsListResult {
  success: boolean;
  data?: {
    credits: CreditRow[];
  };
  error?: string;
}

interface CreditsPageClientProps {
  settings: ICreditExpirationSettings;
  activeCreditsResult: CreditsListResult;
  allCreditsResult: CreditsListResult;
}

function getStatusLabel(
  t: ReturnType<typeof useTranslation>['t'],
  record: CreditRow,
) {
  if (record.is_expired) {
    return <span className="text-red-600 font-medium">{t('status.expired', { defaultValue: 'Expired' })}</span>;
  }

  if (!record.expiration_date) {
    return <span className="text-blue-600 font-medium">{t('status.active', { defaultValue: 'Active' })}</span>;
  }

  const now = new Date();
  const expDate = new Date(record.expiration_date);
  const daysUntilExpiration = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilExpiration <= 7) {
    return (
      <span className="text-orange-500 font-medium">
        {t('status.expiringSoon', {
          days: daysUntilExpiration,
          defaultValue: 'Expiring Soon ({{days}} days)',
        })}
      </span>
    );
  }

  return <span className="text-blue-600 font-medium">{t('status.active', { defaultValue: 'Active' })}</span>;
}

function createColumns(
  t: ReturnType<typeof useTranslation>['t'],
): ColumnDefinition<CreditRow>[] {
  return [
    {
      title: t('columns.creditId', { defaultValue: 'Credit ID' }),
      dataIndex: 'credit_id',
      render: (value: string) => <span className="font-mono text-xs">{value.substring(0, 8)}...</span>,
    },
    {
      title: t('columns.created', { defaultValue: 'Created' }),
      dataIndex: 'created_at',
      render: (value: string) => <span>{new Date(value).toLocaleDateString()}</span>,
    },
    {
      title: t('columns.description', { defaultValue: 'Description' }),
      dataIndex: 'transaction_description',
      render: (value: string | undefined) => value || t('status.na', { defaultValue: 'N/A' }),
    },
    {
      title: t('columns.originalAmount', { defaultValue: 'Original Amount' }),
      dataIndex: 'amount',
      render: (value: number) => formatCurrency(value),
    },
    {
      title: t('columns.remaining', { defaultValue: 'Remaining' }),
      dataIndex: 'remaining_amount',
      render: (value: number) => formatCurrency(value),
    },
    {
      title: t('columns.expires', { defaultValue: 'Expires' }),
      dataIndex: 'expiration_date',
      render: (value: string | undefined) => {
        if (!value) {
          return <span className="text-muted-foreground">{t('status.never', { defaultValue: 'Never' })}</span>;
        }

        return <span>{new Date(value).toLocaleDateString()}</span>;
      },
    },
    {
      title: t('columns.status', { defaultValue: 'Status' }),
      dataIndex: 'is_expired',
      render: (_value: boolean, record) => getStatusLabel(t, record),
    },
    {
      title: t('columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'credit_id',
      width: '10%',
      render: (value: string, record) => {
        const isExpired = record.is_expired;

        return (
          <div className="flex space-x-2">
            <Button variant="outline" size="sm" id={`view-credit-${value}`}>
              {t('actions.view', { defaultValue: 'View' })}
            </Button>
            {!isExpired && (
              <>
                <Button variant="outline" size="sm" id={`edit-credit-${value}`}>
                  {t('actions.edit', { defaultValue: 'Edit' })}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  id={`expire-credit-${value}`}
                  className="text-destructive hover:bg-destructive/10"
                >
                  {t('actions.expire', { defaultValue: 'Expire' })}
                </Button>
              </>
            )}
          </div>
        );
      },
    },
  ];
}

function CreditsList({
  columns,
  response,
  emptyKey,
}: {
  columns: ColumnDefinition<CreditRow>[];
  response: CreditsListResult;
  emptyKey: string;
}) {
  const { t } = useTranslation('msp/credits');

  if (!response.success) {
    return (
      <Alert variant="destructive" className="p-4 rounded-md">
        <AlertDescription>
          {t('management.loadErrorPrefix', { defaultValue: 'Error loading credits:' })} {response.error}
        </AlertDescription>
      </Alert>
    );
  }

  if (!response.data) {
    return (
      <Alert variant="destructive" className="p-4 rounded-md">
        <AlertDescription>
          {t('management.noDataReturned', { defaultValue: 'No data returned from server' })}
        </AlertDescription>
      </Alert>
    );
  }

  if (response.data.credits.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">{t(emptyKey, { defaultValue: 'No credits found' })}</p>
      </div>
    );
  }

  return <DataTable id="credits-table" columns={columns} data={response.data.credits} />;
}

function CreditExpirationSettingsPanel({ settings }: { settings: ICreditExpirationSettings }) {
  const { t } = useTranslation('msp/credits');

  return (
    <div className="p-4 border rounded-md bg-muted mb-4">
      <h3 className="text-lg font-medium mb-2">
        {t('settings.title', { defaultValue: 'Credit Expiration Settings' })}
      </h3>
      <div className="space-y-2">
        <div className="flex justify-between">
          <span>{t('settings.creditExpiration', { defaultValue: 'Credit Expiration:' })}</span>
          <span className={settings.enable_credit_expiration ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
            {settings.enable_credit_expiration
              ? t('settings.enabled', { defaultValue: 'Enabled' })
              : t('settings.disabled', { defaultValue: 'Disabled' })}
          </span>
        </div>
        {settings.enable_credit_expiration && (
          <>
            <div className="flex justify-between">
              <span>{t('settings.expirationPeriod', { defaultValue: 'Expiration Period:' })}</span>
              <span>
                {t('settings.daysUnit', {
                  count: settings.credit_expiration_days,
                  defaultValue: '{{count}} days',
                })}
              </span>
            </div>
            <div className="flex justify-between">
              <span>{t('settings.notificationDays', { defaultValue: 'Notification Days:' })}</span>
              <span>
                {settings.credit_expiration_notification_days?.join(', ')
                  || t('settings.none', { defaultValue: 'None' })}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CreditsPageClient({
  settings,
  activeCreditsResult,
  allCreditsResult,
}: CreditsPageClientProps) {
  const { t } = useTranslation('msp/credits');

  const columns = createColumns(t);
  const allCredits = allCreditsResult.data?.credits ?? [];
  const expiredCredits = allCredits.filter((credit) => credit.is_expired);

  const tabs = [
    {
      id: 'active',
      label: t('tabs.activeCredits', { defaultValue: 'Active Credits' }),
      content: (
        <CreditsList
          columns={columns}
          response={activeCreditsResult}
          emptyKey="management.noCreditsFound"
        />
      ),
    },
    {
      id: 'all',
      label: t('tabs.allCredits', { defaultValue: 'All Credits' }),
      content: (
        <CreditsList
          columns={columns}
          response={allCreditsResult}
          emptyKey="management.noCreditsFound"
        />
      ),
    },
  ];

  if (settings.enable_credit_expiration) {
    tabs.push({
      id: 'expired',
      label: t('tabs.expiredCredits', { defaultValue: 'Expired Credits' }),
      content: (
        <CreditsList
          columns={columns}
          response={allCreditsResult.success && allCreditsResult.data
            ? {
                success: true,
                data: { credits: expiredCredits },
              }
            : allCreditsResult}
          emptyKey="management.noCreditsFound"
        />
      ),
    });
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="mb-4">
        <BackButton />
      </div>
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">
          {t('page.title', { defaultValue: 'Credit Management' })}
        </h1>
        <div className="flex space-x-2">
          <AddCreditButton />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('page.creditsOverview', { defaultValue: 'Credits Overview' })}</CardTitle>
          <CardDescription>
            {settings.enable_credit_expiration
              ? t('page.overviewDescriptionWithExpiration', {
                  defaultValue: 'Manage your client credits, including expiration dates, and transfers',
                })
              : t('page.overviewDescription', {
                  defaultValue: 'Manage your client credits and transfers',
                })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreditExpirationSettingsPanel settings={settings} />
          <CreditsTabs tabs={tabs} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {settings.enable_credit_expiration && (
          <Card>
            <CardHeader>
              <CardTitle>
                {t('page.expirationSummary', { defaultValue: 'Credit Expiration Summary' })}
              </CardTitle>
              <CardDescription>
                {t('page.expirationSummaryDescription', {
                  defaultValue: 'Overview of credits expiring soon',
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-40 w-full" />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{t('page.usageTrends', { defaultValue: 'Credit Usage Trends' })}</CardTitle>
            <CardDescription>
              {t('page.usageTrendsDescription', {
                defaultValue: 'Historical credit usage patterns',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

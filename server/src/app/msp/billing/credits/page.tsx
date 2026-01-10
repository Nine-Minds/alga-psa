import { Suspense } from 'react';
import AddCreditButton from './AddCreditButton';
import BackButton from './BackButton';
import { CreditsTabs } from './CreditsTabs';
import { listCredits } from './actions';
import { getCreditExpirationSettings } from './settings';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Skeleton } from 'server/src/components/ui/Skeleton';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ICreditTracking, ICreditExpirationSettings } from 'server/src/interfaces/billing.interfaces';
import { formatCurrency } from 'server/src/lib/utils/formatters';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';

// Define columns for the credits table
const columns: ColumnDefinition<ICreditTracking & { transaction_description?: string, invoice_number?: string }>[] = [
  {
    title: 'Credit ID',
    dataIndex: 'credit_id',
    render: (value: string) => (
      <span className="font-mono text-xs">{value.substring(0, 8)}...</span>
    )
  },
  {
    title: 'Created',
    dataIndex: 'created_at',
    render: (value: string) => (
      <span>{new Date(value).toLocaleDateString()}</span>
    )
  },
  {
    title: 'Description',
    dataIndex: 'transaction_description',
    render: (value: string | undefined) => value || 'N/A'
  },
  {
    title: 'Original Amount',
    dataIndex: 'amount',
    render: (value: number) => formatCurrency(value)
  },
  {
    title: 'Remaining',
    dataIndex: 'remaining_amount',
    render: (value: number) => formatCurrency(value)
  },
  {
    title: 'Expires',
    dataIndex: 'expiration_date',
    render: (value: string | undefined) => {
      if (!value) return <span className="text-muted-foreground">Never</span>;
      return <span>{new Date(value).toLocaleDateString()}</span>;
    }
  },
  {
    title: 'Status',
    dataIndex: 'is_expired',
    render: (isExpired: boolean, record) => {
      if (isExpired) {
        return <span className="text-red-600 font-medium">Expired</span>;
      }
      
      if (!record.expiration_date) {
        return <span className="text-blue-600 font-medium">Active</span>;
      }
      
      const now = new Date();
      const expDate = new Date(record.expiration_date);
      const daysUntilExpiration = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysUntilExpiration <= 7) {
        return <span className="text-orange-500 font-medium">Expiring Soon ({daysUntilExpiration} days)</span>;
      }
      
      return <span className="text-blue-600 font-medium">Active</span>;
    }
  },
  {
    title: 'Actions',
    dataIndex: 'credit_id',
    width: '10%',
    render: (value: string, record) => {
      const isExpired = record.is_expired;
      
      return (
        <div className="flex space-x-2">
          <Button
            variant="outline"
            size="sm"
            id={`view-credit-${value}`}
          >
            View
          </Button>
          {!isExpired && (
            <>
              <Button
                variant="outline"
                size="sm"
                id={`edit-credit-${value}`}
              >
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                id={`expire-credit-${value}`}
                className="text-red-600 hover:bg-red-50"
              >
                Expire
              </Button>
            </>
          )}
        </div>
      );
    }
  },
];

// Credits list component with loading state
async function CreditsList({ clientId, includeExpired = false }: { clientId: string, includeExpired?: boolean }) {
  const response = await listCredits(clientId, includeExpired);

  if (!response.success) {
    return (
      <div className="p-4 border border-red-300 rounded-md bg-red-50">
        <p className="text-red-600">Error loading credits: {response.error}</p>
      </div>
    );
  }

  if (!response.data) {
    return (
      <div className="p-4 border border-red-300 rounded-md bg-red-50">
        <p className="text-red-600">No data returned from server</p>
      </div>
    );
  }

  const { credits } = response.data;

  if (credits.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-500">No credits found</p>
      </div>
    );
  }

  return (
    <DataTable
      id="credits-table"
      columns={columns}
      data={credits}
    />
  );
}

// Loading skeleton for credits list
function CreditsListSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-24" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}

// Settings component to display credit expiration settings
async function CreditExpirationSettings({ clientId }: { clientId: string }) {
  const settings = await getCreditExpirationSettings(clientId);
  
  return (
    <div className="p-4 border rounded-md bg-gray-50 mb-4">
      <h3 className="text-lg font-medium mb-2">Credit Expiration Settings</h3>
      <div className="space-y-2">
        <div className="flex justify-between">
          <span>Credit Expiration:</span>
          <span className={settings.enable_credit_expiration ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
            {settings.enable_credit_expiration ? "Enabled" : "Disabled"}
          </span>
        </div>
        {settings.enable_credit_expiration && (
          <>
            <div className="flex justify-between">
              <span>Expiration Period:</span>
              <span>{settings.credit_expiration_days} days</span>
            </div>
            <div className="flex justify-between">
              <span>Notification Days:</span>
              <span>{settings.credit_expiration_notification_days?.join(', ') || 'None'}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Main page component
export default async function CreditsPage({ params }: { params: Promise<{ clientId?: string }> }) {
  const resolvedParams = await params;
  // For demo purposes, use a placeholder client ID if none is provided
  const clientId = resolvedParams.clientId || '00000000-0000-0000-0000-000000000000';
  
  // Get credit expiration settings
  const settings = await getCreditExpirationSettings(clientId);
  
  // Define tabs for the credits view
  const tabs = [
    {
      label: "Active Credits",
      content: (
        <Suspense fallback={<CreditsListSkeleton />}>
          <CreditsList clientId={clientId} includeExpired={false} />
        </Suspense>
      )
    },
    {
      label: "All Credits",
      content: (
        <Suspense fallback={<CreditsListSkeleton />}>
          <CreditsList clientId={clientId} includeExpired={true} />
        </Suspense>
      )
    }
  ];
  
  // Add Expired Credits tab only if credit expiration is enabled
  if (settings.enable_credit_expiration) {
    tabs.push({
      label: "Expired Credits",
      content: (
        <Suspense fallback={<CreditsListSkeleton />}>
          {/* This would need a custom endpoint to only fetch expired credits */}
          <CreditsList clientId={clientId} includeExpired={true} />
        </Suspense>
      )
    });
  }
  
  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="mb-4">
        <BackButton />
      </div>
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Credit Management</h1>
        <div className="flex space-x-2">
          <AddCreditButton />
        </div>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Credits Overview</CardTitle>
          <CardDescription>
            Manage your client credits{settings.enable_credit_expiration ? ", including expiration dates" : ""} and transfers
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreditExpirationSettings clientId={clientId} />
          <CreditsTabs tabs={tabs} />
        </CardContent>
      </Card>
      
      {/* Placeholder for future credit management dashboard components */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {settings.enable_credit_expiration && (
          <Card>
            <CardHeader>
              <CardTitle>Credit Expiration Summary</CardTitle>
              <CardDescription>Overview of credits expiring soon</CardDescription>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-40 w-full" />
            </CardContent>
          </Card>
        )}
        
        <Card>
          <CardHeader>
            <CardTitle>Credit Usage Trends</CardTitle>
            <CardDescription>Historical credit usage patterns</CardDescription>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
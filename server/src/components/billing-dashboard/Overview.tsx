// Overview.tsx
import React from 'react';
import { Card, CardHeader, CardContent } from 'server/src/components/ui/Card';
import { 
  FileSpreadsheet, 
  Building2, 
  CreditCard, 
  Clock, 
  Calendar,
  DollarSign,
  FileText,
  AlertCircle
} from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';

const FeatureCard = ({ icon: Icon, title, description }: { icon: any, title: string, description: string }) => (
  <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-white hover:shadow-lg transition-shadow p-4">
    <div className="flex items-start space-x-4">
      <div className="p-2 rounded-lg" style={{ background: 'rgb(var(--color-primary-50))' }}>
        <Icon className="h-6 w-6" style={{ color: 'rgb(var(--color-primary-500))' }} />
      </div>
      <div>
        <h3 className="font-semibold mb-1" style={{ color: 'rgb(var(--color-text-900))' }}>{title}</h3>
        <p className="text-sm" style={{ color: 'rgb(var(--color-text-500))' }}>{description}</p>
      </div>
    </div>
  </div>
);

const Overview = () => {
  return (
    <div className="space-y-6">
      {/* Billing Summary Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">Active Billing Plans</h3>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-4">
              <div className="p-3 rounded-full" style={{ background: 'rgb(var(--color-primary-50))' }}>
                <FileSpreadsheet className="h-6 w-6" style={{ color: 'rgb(var(--color-primary-500))' }} />
              </div>
              <div>
                <p className="text-2xl font-bold">15</p>
                <p className="text-sm text-gray-500">Active Plans</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">Billing Clients</h3>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-4">
              <div className="p-3 rounded-full" style={{ background: 'rgb(var(--color-primary-50))' }}>
                <Building2 className="h-6 w-6" style={{ color: 'rgb(var(--color-primary-500))' }} />
              </div>
              <div>
                <p className="text-2xl font-bold">87</p>
                <p className="text-sm text-gray-500">Total Clients</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">Monthly Revenue</h3>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-4">
              <div className="p-3 rounded-full" style={{ background: 'rgb(var(--color-primary-50))' }}>
                <DollarSign className="h-6 w-6" style={{ color: 'rgb(var(--color-primary-500))' }} />
              </div>
              <div>
                <p className="text-2xl font-bold">$123,456</p>
                <p className="text-sm text-gray-500">Current Month</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Billing Features Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <FeatureCard
          icon={CreditCard}
          title="Payment Processing"
          description="Track and manage client payments, process refunds, and handle payment disputes"
        />
        <FeatureCard
          icon={Clock}
          title="Billing Cycles"
          description="Manage recurring billing cycles, proration, and billing frequency settings"
        />
        <FeatureCard
          icon={Calendar}
          title="Service Periods"
          description="Track service delivery periods and align them with billing cycles"
        />
        <FeatureCard
          icon={FileText}
          title="Invoice Management"
          description="Generate, customize, and send professional invoices to clients"
        />
        <FeatureCard
          icon={AlertCircle}
          title="Overdue Payments"
          description="Monitor and follow up on overdue payments and payment reminders"
        />
        <FeatureCard
          icon={FileSpreadsheet}
          title="Service Catalog"
          description="Manage your service offerings, pricing, and service bundles"
        />
      </div>

      {/* Service Catalog Quick Access */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Service Catalog Management</h3>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-2">Manage your service offerings, pricing, and billing configurations</p>
              <p><span className="font-semibold">15</span> Active Services</p>
            </div>
            <Button
              id='manage-service-catalog-button'
              onClick={() => document.querySelector<HTMLButtonElement>('button[data-state="inactive"][value="service-catalog"]')?.click()}
              className="ml-4"
            >
              Manage Service Catalog
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Overview;

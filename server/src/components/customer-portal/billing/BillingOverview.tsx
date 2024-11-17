'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CreditCard, FileText, Package } from 'lucide-react';
import { CustomTabs, TabContent } from '@/components/ui/CustomTabs';
import { DataTable } from '@/components/ui/DataTable';
import { ColumnDefinition } from '@/interfaces/dataTable.interfaces';
import { 
  getClientBillingPlan, 
  getClientInvoices, 
  getClientPaymentMethods,
  getCurrentUsage 
} from '@/lib/actions/client-billing';
import { 
  ICompanyBillingPlan, 
  IBucketUsage, 
  IService,
  PaymentMethod 
} from '@/interfaces/billing.interfaces';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/Dialog';

interface Invoice {
  id: string;
  invoice_number: string;
  created_at: string;
  total_amount: number;
  status: string;
}

interface InvoiceDetailsDialogProps {
  invoice: Invoice | null;
  isOpen: boolean;
  onClose: () => void;
  formatCurrency: (amount: number) => string;
  formatDate: (date: string) => string;
}

const InvoiceDetailsDialog: React.FC<InvoiceDetailsDialogProps> = ({ 
  invoice, 
  isOpen, 
  onClose,
  formatCurrency,
  formatDate
}) => {
  if (!invoice) return null;

  return (
    <Dialog isOpen={isOpen} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Invoice Details</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-gray-500">Invoice Number</p>
              <p className="mt-1">{invoice.invoice_number}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Date</p>
              <p className="mt-1">{formatDate(invoice.created_at)}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Amount</p>
              <p className="mt-1">{formatCurrency(invoice.total_amount)}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Status</p>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mt-1 ${
                invoice.status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
              }`}>
                {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
              </span>
            </div>
          </div>
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Close</Button>
        <Button>Download</Button>
      </DialogFooter>
    </Dialog>
  );
};

export default function BillingOverview() {
  const [currentTab, setCurrentTab] = useState('Overview');
  const [billingPlan, setBillingPlan] = useState<ICompanyBillingPlan | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [usage, setUsage] = useState<{ bucketUsage: IBucketUsage | null; services: IService[] }>({
    bucketUsage: null,
    services: []
  });
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isInvoiceDialogOpen, setIsInvoiceDialogOpen] = useState(false);

  useEffect(() => {
    const loadBillingData = async () => {
      try {
        const [plan, invoiceData, paymentData, usageData] = await Promise.all([
          getClientBillingPlan(),
          getClientInvoices(),
          getClientPaymentMethods(),
          getCurrentUsage()
        ]);

        setBillingPlan(plan);
        setInvoices(invoiceData);
        setPaymentMethods(paymentData);
        setUsage(usageData);
      } catch (error) {
        console.error('Error loading billing data:', error);
      }
    };

    loadBillingData();
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const handleInvoiceClick = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setIsInvoiceDialogOpen(true);
  };

  const invoiceColumns: ColumnDefinition<Invoice>[] = [
    {
      title: 'Invoice #',
      dataIndex: 'invoice_number'
    },
    {
      title: 'Date',
      dataIndex: 'created_at',
      render: (value: string) => formatDate(value)
    },
    {
      title: 'Amount',
      dataIndex: 'total_amount',
      render: (value: number) => formatCurrency(value)
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: string) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          value === 'paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
        }`}>
          {value.charAt(0).toUpperCase() + value.slice(1)}
        </span>
      )
    }
  ];

  const tabs: TabContent[] = [
    {
      label: 'Overview',
      content: (
        <div className="space-y-6 py-4">
          <div className="grid gap-6 md:grid-cols-3">
            <Card className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">Current Plan</p>
                  <p className="mt-2 text-3xl font-semibold">{billingPlan?.plan_name || 'Loading...'}</p>
                  <p className="mt-1 text-sm text-gray-500">{billingPlan?.billing_frequency || 'Loading...'}</p>
                </div>
                <Package className="h-5 w-5 text-gray-400" />
              </div>
              <Button className="mt-4 w-full" variant="outline">
                View Plan Details
              </Button>
            </Card>

            <Card className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">Payment Method</p>
                  {paymentMethods.length > 0 ? (
                    <>
                      <p className="mt-2 text-3xl font-semibold">•••• {paymentMethods[0].last4}</p>
                      <p className="mt-1 text-sm text-gray-500">
                        Expires {paymentMethods[0].exp_month}/{paymentMethods[0].exp_year}
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-lg">No payment method</p>
                  )}
                </div>
                <CreditCard className="h-5 w-5 text-gray-400" />
              </div>
              <Button className="mt-4 w-full" variant="outline">
                Manage Payment Methods
              </Button>
            </Card>

            <Card className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">Next Invoice</p>
                  {invoices.length > 0 ? (
                    <>
                      <p className="mt-2 text-3xl font-semibold">{formatCurrency(invoices[0].total_amount)}</p>
                      <p className="mt-1 text-sm text-gray-500">Due {formatDate(invoices[0].created_at)}</p>
                    </>
                  ) : (
                    <p className="mt-2 text-lg">No upcoming invoices</p>
                  )}
                </div>
                <FileText className="h-5 w-5 text-gray-400" />
              </div>
              <Button className="mt-4 w-full" variant="outline">
                View All Invoices
              </Button>
            </Card>
          </div>

          {usage.bucketUsage && (
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Current Usage</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm text-gray-500">Support Hours</span>
                    <span className="text-sm font-medium">
                      {usage.bucketUsage.hours_used}/{usage.bucketUsage.hours_used + usage.bucketUsage.overage_hours} hours used
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full" 
                      style={{ 
                        width: `${(usage.bucketUsage.hours_used / (usage.bucketUsage.hours_used + usage.bucketUsage.overage_hours)) * 100}%`
                      }}
                    ></div>
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      ),
    },
    {
      label: 'Invoices',
      content: (
        <div className="py-4">
          <DataTable
            data={invoices}
            columns={invoiceColumns}
            pagination={true}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            pageSize={10}
            onRowClick={handleInvoiceClick}
          />
        </div>
      ),
    },
    {
      label: 'Payment Methods',
      content: (
        <div className="py-4">
          <div className="space-y-4">
            {paymentMethods.map((method): JSX.Element => (
              <Card key={method.payment_method_id} className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <CreditCard className="h-8 w-8 text-gray-400" />
                    <div>
                      <p className="font-medium">{method.type === 'credit_card' ? 'Credit Card' : 'Bank Account'} ending in {method.last4}</p>
                      {method.type === 'credit_card' && (
                        <p className="text-sm text-gray-500">
                          Expires {method.exp_month}/{method.exp_year}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button variant="outline" size="sm">
                      Edit
                    </Button>
                    <Button variant="outline" size="sm">
                      Remove
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
            <Button className="w-full">Add Payment Method</Button>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <CustomTabs
        tabs={tabs}
        defaultTab="Overview"
        onTabChange={(tabValue: string) => setCurrentTab(tabValue)}
      />

      <InvoiceDetailsDialog
        invoice={selectedInvoice}
        isOpen={isInvoiceDialogOpen}
        onClose={() => setIsInvoiceDialogOpen(false)}
        formatCurrency={formatCurrency}
        formatDate={formatDate}
      />
    </div>
  );
}

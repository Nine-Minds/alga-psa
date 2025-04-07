'use client';

import { useState, useEffect } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Card } from 'server/src/components/ui/Card';
import { CreditCard, FileText, Package } from 'lucide-react';
import { CustomTabs, TabContent } from 'server/src/components/ui/CustomTabs';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { 
  getClientBillingPlan, 
  getClientInvoices, 
  getClientPaymentMethods,
  getCurrentUsage 
} from 'server/src/lib/actions/client-portal-actions/client-billing';
import { 
  ICompanyBillingPlan, 
  IBucketUsage, 
  IService,
  PaymentMethod 
} from 'server/src/interfaces/billing.interfaces';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from 'server/src/components/ui/Dialog';
import { getInvoiceForRendering } from 'server/src/lib/actions/invoiceActions';
import type { InvoiceViewModel } from 'server/src/interfaces/invoice.interfaces';

interface InvoiceDetailsDialogProps {
  invoice: InvoiceViewModel | null;
  isOpen: boolean;
  onClose: () => void;
  formatCurrency: (amount: number) => string;
  formatDate: (date: string | { toString(): string }) => string;
};

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
              <p className="mt-1">{formatDate(invoice.invoice_date as any)}</p>
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
            <div>
              <p className="text-sm font-medium text-gray-500">Manual Invoice</p>
              <p className="mt-1">{invoice.is_manual ? 'Yes' : 'No'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Credits</p>
              <p className="mt-1">{formatCurrency(invoice.credit_applied)}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Adjustments</p>
              {/* Adjustments not available in InvoiceViewModel */}
            </div>
          </div>

          <div>
            <h4 className="font-semibold mt-4">Line Items</h4>
            <table className="min-w-full divide-y divide-gray-200 mt-2">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Quantity</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {invoice.invoice_items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="px-3 py-2">{item.description}</td>
                    <td className="px-3 py-2">{item.quantity}</td>
                    <td className="px-3 py-2">{formatCurrency(item.unit_price)}</td>
                    <td className="px-3 py-2">{formatCurrency(item.total_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h4 className="font-semibold mt-4">Tax Breakdown</h4>
            <ul className="mt-2 space-y-1">
              <li className="flex justify-between">
                <span>Tax</span>
                <span>{formatCurrency(invoice.tax)}</span>
              </li>
            </ul>
          </div>
        </div>
      </DialogContent>
      <DialogFooter>
        <Button id="close-invoice-dialog-button" variant="outline" onClick={onClose}>Close</Button>
        <Button id="download-invoice-button">Download</Button>
      </DialogFooter>
    </Dialog>
  );
};

export default function BillingOverview() {
  const [currentTab, setCurrentTab] = useState('Overview');
  const [billingPlan, setBillingPlan] = useState<ICompanyBillingPlan | null>(null);
  const [invoices, setInvoices] = useState<InvoiceViewModel[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [usage, setUsage] = useState<{ bucketUsage: IBucketUsage | null; services: IService[] }>({
    bucketUsage: null,
    services: []
  });
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceViewModel | null>(null);
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

  const formatDate = (date: string | { toString(): string }) => {
    const dateStr = typeof date === 'string' ? date : date.toString();
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };


  const handleInvoiceClick = async (invoice: InvoiceViewModel) => {
    try {
      const fullInvoice = await getInvoiceForRendering(invoice.invoice_id);
      setSelectedInvoice(fullInvoice);
    } catch (error) {
      console.error('Failed to fetch invoice details:', error);
      setSelectedInvoice(invoice); // fallback to basic invoice
    }
    setIsInvoiceDialogOpen(true);
  };

  const invoiceColumns: ColumnDefinition<InvoiceViewModel>[] = [
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
              <Button id="view-plan-details-button" className="mt-4 w-full" variant="outline">
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
              <Button id="manage-payment-methods-button" className="mt-4 w-full" variant="outline">
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
                      <p className="mt-1 text-sm text-gray-500">Due {formatDate(invoices[0].invoice_date as any)}</p>
                    </>
                  ) : (
                    <p className="mt-2 text-lg">No upcoming invoices</p>
                  )}
                </div>
                <FileText className="h-5 w-5 text-gray-400" />
              </div>
              <Button id="view-all-invoices-button" className="mt-4 w-full" variant="outline">
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
                      {((usage.bucketUsage.minutes_used) / 60).toFixed(2)}/
                      {((usage.bucketUsage.minutes_used + usage.bucketUsage.overage_minutes) / 60).toFixed(2)} hours used
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full" 
                      style={{ 
                        width: `${(usage.bucketUsage.minutes_used / (usage.bucketUsage.minutes_used + usage.bucketUsage.overage_minutes)) * 100}%`
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
                    <Button id={`edit-payment-${method.payment_method_id}`} variant="outline" size="sm">
                      Edit
                    </Button>
                    <Button id={`remove-payment-${method.payment_method_id}`} variant="outline" size="sm">
                      Remove
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
            <Button id="add-payment-method-button" className="w-full">Add Payment Method</Button>
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

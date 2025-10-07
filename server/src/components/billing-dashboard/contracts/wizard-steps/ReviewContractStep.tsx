'use client';

import React, { useState, useEffect } from 'react';
import { ContractWizardData } from '../ContractWizard';
import { Card } from 'server/src/components/ui/Card';
import { Badge } from 'server/src/components/ui/Badge';
import {
  Building2,
  FileText,
  Calendar,
  DollarSign,
  Clock,
  Package,
  Droplet,
  Activity,
  CheckCircle2,
  FileCheck,
  Repeat
} from 'lucide-react';
import { ICompany } from 'server/src/interfaces';
import { getAllCompanies } from 'server/src/lib/actions/company-actions/companyActions';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';

interface ReviewContractStepProps {
  data: ContractWizardData;
}

export function ReviewContractStep({ data }: ReviewContractStepProps) {
  const [clientName, setClientName] = useState<string>('');

  useEffect(() => {
    loadClientName();
  }, [data.company_id]);

  const loadClientName = async () => {
    if (!data.company_id) {
      setClientName('Not selected');
      return;
    }
    try {
      const companies = await getAllCompanies();
      const company = companies.find((c: ICompany) => c.company_id === data.company_id);
      setClientName(company?.company_name || data.company_id);
    } catch (error) {
      console.error('Error loading client name:', error);
      setClientName(data.company_id);
    }
  };

  const formatCurrency = (cents: number | undefined) => {
    if (!cents) return '$0.00';
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  const calculateTotalMonthly = () => {
    let total = 0;
    if (data.fixed_base_rate) total += data.fixed_base_rate;
    if (data.bucket_monthly_fee) total += data.bucket_monthly_fee;
    return total;
  };

  const hasFixedServices = data.fixed_services.length > 0;
  const hasHourlyServices = data.hourly_services.length > 0;
  const hasBucketHours = !!(data.bucket_hours && data.bucket_monthly_fee && data.bucket_overage_rate);
  const hasUsageServices = !!(data.usage_services && data.usage_services.length > 0);

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Review Contract</h3>
        <p className="text-sm text-gray-600">
          Review all contract details before creating. You can go back to edit any section.
        </p>
      </div>

      {/* Contract Basics */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="h-5 w-5 text-blue-600" />
          <h4 className="font-semibold">Contract Basics</h4>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex items-start gap-2">
            <Building2 className="h-4 w-4 mt-0.5 text-gray-400" />
            <div>
              <p className="text-gray-600">Client</p>
              <p className="font-medium">{clientName || 'Not selected'}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <FileText className="h-4 w-4 mt-0.5 text-gray-400" />
            <div>
              <p className="text-gray-600">Contract Name</p>
              <p className="font-medium">{data.contract_name || 'Not specified'}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Repeat className="h-4 w-4 mt-0.5 text-gray-400" />
            <div>
              <p className="text-gray-600">Billing Frequency</p>
              <p className="font-medium">{BILLING_FREQUENCY_OPTIONS.find(opt => opt.value === data.billing_frequency)?.label || data.billing_frequency || 'Not specified'}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Calendar className="h-4 w-4 mt-0.5 text-gray-400" />
            <div>
              <p className="text-gray-600">Contract Period</p>
              <p className="font-medium">
                {formatDate(data.start_date)} - {data.end_date ? formatDate(data.end_date) : 'Ongoing'}
              </p>
            </div>
          </div>
          {data.description && (
            <div className="flex items-start gap-2">
              <FileText className="h-4 w-4 mt-0.5 text-gray-400" />
              <div>
                <p className="text-gray-600">Description</p>
                <p className="font-medium">{data.description}</p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Purchase Order */}
      {data.po_required && (
        <Card className="p-4 border-orange-200 bg-orange-50">
          <div className="flex items-center gap-2 mb-3">
            <FileCheck className="h-5 w-5 text-orange-600" />
            <h4 className="font-semibold">Purchase Order</h4>
            <Badge variant="outline" className="border-orange-300 text-orange-800">
              Required
            </Badge>
          </div>
          <div className="space-y-2 text-sm">
            {data.po_number && (
              <div className="flex items-start gap-2">
                <FileCheck className="h-4 w-4 mt-0.5 text-gray-400" />
                <div>
                  <p className="text-gray-600">PO Number</p>
                  <p className="font-medium">{data.po_number}</p>
                </div>
              </div>
            )}
            {data.po_amount && (
              <div className="flex items-start gap-2">
                <DollarSign className="h-4 w-4 mt-0.5 text-gray-400" />
                <div>
                  <p className="text-gray-600">PO Amount</p>
                  <p className="font-medium">{formatCurrency(data.po_amount)}</p>
                </div>
              </div>
            )}
            <div className="pt-2 border-t border-orange-200">
              <p className="text-xs text-orange-800">
                ⚠️ Invoice generation will be blocked if PO number is not provided
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Fixed Fee Services */}
      {hasFixedServices && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-green-600" />
              <h4 className="font-semibold">Fixed Fee Services</h4>
            </div>
            <Badge variant="default" className="bg-green-100 text-green-800">
              {formatCurrency(data.fixed_base_rate)}/month
            </Badge>
          </div>
          <div className="space-y-2 text-sm">
            <div>
              <p className="text-gray-600 mb-1">Services ({data.fixed_services.length})</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                {data.fixed_services.map((service, idx) => (
                  <li key={idx} className="font-medium">
                    {service.service_name || service.service_id} (Qty: {service.quantity})
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-center gap-2 pt-2 border-t">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <p className="text-gray-600">
                Proration: {data.enable_proration ? 'Enabled' : 'Disabled'}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Hourly Services */}
      {hasHourlyServices && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-purple-600" />
              <h4 className="font-semibold">Hourly Services</h4>
            </div>
            <Badge variant="default" className="bg-purple-100 text-purple-800">
              {data.hourly_services.length} services
            </Badge>
          </div>
          <div className="space-y-2 text-sm">
            <div>
              <p className="text-gray-600 mb-1">Services & Rates</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                {data.hourly_services.map((service, idx) => (
                  <li key={idx} className="font-medium">
                    {service.service_name || service.service_id} - {formatCurrency(service.hourly_rate)}/hour
                  </li>
                ))}
              </ul>
            </div>
            {(data.minimum_billable_time || data.round_up_to_nearest) && (
              <div className="pt-2 border-t space-y-1">
                {data.minimum_billable_time && (
                  <p className="text-gray-600">
                    <strong>Minimum Time:</strong> {data.minimum_billable_time} minutes
                  </p>
                )}
                {data.round_up_to_nearest && (
                  <p className="text-gray-600">
                    <strong>Round Up:</strong> {data.round_up_to_nearest} minutes
                  </p>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Bucket Hours */}
      {hasBucketHours && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Droplet className="h-5 w-5 text-blue-600" />
              <h4 className="font-semibold">Bucket Hours</h4>
            </div>
            <Badge variant="default" className="bg-blue-100 text-blue-800">
              {data.bucket_hours} hrs/month
            </Badge>
          </div>
          <div className="space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-gray-600">Monthly Fee</p>
                <p className="font-medium text-lg">{formatCurrency(data.bucket_monthly_fee)}</p>
              </div>
              <div>
                <p className="text-gray-600">Overage Rate</p>
                <p className="font-medium text-lg">{formatCurrency(data.bucket_overage_rate)}/hr</p>
              </div>
            </div>
            <div className="pt-2 border-t">
              <p className="text-gray-600 mb-1">
                <strong>Effective Rate:</strong> {formatCurrency(Math.round((data.bucket_monthly_fee || 0) / (data.bucket_hours || 1)))}/hour
              </p>
            </div>
            {data.bucket_services.length > 0 && (
              <div className="pt-2 border-t">
                <p className="text-gray-600 mb-1">Included Services ({data.bucket_services.length})</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  {data.bucket_services.map((service, idx) => (
                    <li key={idx} className="font-medium">
                      {service.service_name || service.service_id}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Usage-Based Services */}
      {hasUsageServices && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-orange-600" />
              <h4 className="font-semibold">Usage-Based Services</h4>
            </div>
            <Badge variant="default" className="bg-orange-100 text-orange-800">
              {data.usage_services?.length} services
            </Badge>
          </div>
          <div className="space-y-2 text-sm">
            <div>
              <p className="text-gray-600 mb-1">Services & Rates</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                {data.usage_services?.map((service, idx) => (
                  <li key={idx} className="font-medium">
                    {service.service_name || service.service_id} - {formatCurrency(service.unit_rate)}/{service.unit_of_measure || 'unit'}
                  </li>
                ))}
              </ul>
            </div>
            <div className="pt-2 border-t">
              <p className="text-xs text-gray-600">
                💡 Usage-based services are billed based on actual consumption each month
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Total Summary */}
      <Card className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-200">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-semibold text-lg mb-1">Estimated Monthly Total</h4>
            <p className="text-sm text-gray-600">
              Fixed charges only (hourly & usage-based services billed as used)
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-blue-900">
              {formatCurrency(calculateTotalMonthly())}
            </p>
            <p className="text-xs text-gray-600">per month</p>
          </div>
        </div>
      </Card>

      {/* Warnings/Reminders */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-md">
        <p className="text-sm text-amber-800">
          <strong>Before you finish:</strong>
        </p>
        <ul className="text-sm text-amber-800 list-disc list-inside space-y-1 mt-2 ml-2">
          <li>Double-check all rates and service configurations</li>
          <li>Ensure the contract period is correct</li>
          <li>Review that all required services are included</li>
          <li>Note: You can edit the contract after creation</li>
        </ul>
      </div>
    </div>
  );
}
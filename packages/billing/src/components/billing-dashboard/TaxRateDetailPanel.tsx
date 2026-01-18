'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@alga-psa/ui/components/Card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { ArrowLeft, Info, Layers, BarChart2, Calendar, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';

import { ITaxRate } from 'server/src/interfaces/tax.interfaces';
import { TaxComponentEditor } from '../settings/tax/TaxComponentEditor';
import { TaxThresholdEditor } from '../settings/tax/TaxThresholdEditor';
import { TaxHolidayManager } from '../settings/tax/TaxHolidayManager';

interface TaxRateDetailPanelProps {
  taxRate: ITaxRate;
  onBack: () => void;
  isReadOnly?: boolean;
}

export function TaxRateDetailPanel({ taxRate, onBack, isReadOnly = false }: TaxRateDetailPanelProps) {
  const [activeTab, setActiveTab] = useState('details');

  // Determine the tax rate type
  const isComposite = taxRate.is_composite;

  return (
    <Card id="tax-rate-detail-panel">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              id="back-to-tax-rates-button"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Tax Rates
            </Button>
            <div>
              <CardTitle className="flex items-center gap-2">
                {taxRate.description || taxRate.region_code}
                {isComposite && (
                  <Badge variant="outline" className="ml-2">Composite</Badge>
                )}
              </CardTitle>
              <CardDescription>
                {taxRate.region_code} - {taxRate.tax_percentage}%
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="details">
              <Info className="h-4 w-4 mr-2" />
              Details
            </TabsTrigger>
            <TabsTrigger value="components">
              <Layers className="h-4 w-4 mr-2" />
              Components
            </TabsTrigger>
            <TabsTrigger value="brackets">
              <BarChart2 className="h-4 w-4 mr-2" />
              Brackets
            </TabsTrigger>
            <TabsTrigger value="holidays">
              <Calendar className="h-4 w-4 mr-2" />
              Holidays
            </TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="mt-6">
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Region Code</p>
                  <p className="text-sm">{taxRate.region_code}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Tax Percentage</p>
                  <p className="text-sm">{taxRate.tax_percentage}%</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Description</p>
                  <p className="text-sm">{taxRate.description || '-'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Tax Type</p>
                  <p className="text-sm">{taxRate.tax_type || '-'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Start Date</p>
                  <p className="text-sm">{new Date(taxRate.start_date).toLocaleDateString()}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">End Date</p>
                  <p className="text-sm">{taxRate.end_date ? new Date(taxRate.end_date).toLocaleDateString() : 'No end date'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Is Composite</p>
                  <p className="text-sm">{taxRate.is_composite ? 'Yes' : 'No'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Is Active</p>
                  <Badge variant={taxRate.is_active ? 'default' : 'outline'}>
                    {taxRate.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </div>

              {/* Tax Precedence Info */}
              <Alert variant="info" showIcon>
                <AlertDescription>
                  <p className="font-medium mb-2">Tax Calculation Precedence</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Client tax exempt flag is checked first (if exempt, no tax applied)</li>
                    <li>Service-specific tax rate is used if assigned</li>
                    <li>Client default tax rate is used as fallback</li>
                    <li>Tax region lookup determines applicable rate based on location</li>
                  </ol>
                </AlertDescription>
              </Alert>
            </div>
          </TabsContent>

          <TabsContent value="components" className="mt-6">
            {!isComposite ? (
              <Alert variant="info" showIcon={false}>
                <AlertCircle className="h-4 w-4 absolute left-4 top-4" />
                <AlertDescription>
                  <p>This is a simple tax rate, not a composite rate. Tax components are only used for composite taxes.</p>
                  <p className="mt-2">To use tax components, mark this rate as composite when editing it.</p>
                </AlertDescription>
              </Alert>
            ) : (
              <TaxComponentEditor
                taxRateId={taxRate.tax_rate_id}
                isReadOnly={isReadOnly}
              />
            )}
          </TabsContent>

          <TabsContent value="brackets" className="mt-6">
            <div className="space-y-4">
              <Alert variant="info" showIcon>
                <AlertDescription>
                  <p>Progressive tax brackets apply different rates to different portions of an amount.</p>
                  <p className="mt-1">When brackets are defined, they take precedence over the flat percentage rate.</p>
                </AlertDescription>
              </Alert>
              <TaxThresholdEditor
                taxRateId={taxRate.tax_rate_id}
                isReadOnly={isReadOnly}
              />
            </div>
          </TabsContent>

          <TabsContent value="holidays" className="mt-6">
            <TaxHolidayManager
              taxRateId={taxRate.tax_rate_id}
              taxRateName={taxRate.description || taxRate.region_code}
              isReadOnly={isReadOnly}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

export default TaxRateDetailPanel;

// server/src/components/billing-dashboard/FixedPlanConfiguration.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import { BillingPlanDialog } from '../BillingPlanDialog';
import Spinner from 'server/src/components/ui/Spinner';
import { getServices } from 'server/src/lib/actions/serviceActions';
import {
  getBillingPlanById
} from 'server/src/lib/actions/billingPlanAction';
import { getPlanServices } from 'server/src/lib/actions/planServiceActions';
import { IService, IBillingPlan } from 'server/src/interfaces/billing.interfaces';
import FixedPlanServicesList from '../FixedPlanServicesList'; // Import the actual component

interface FixedPlanConfigurationProps {
  planId: string;
  className?: string;
}

export function FixedPlanConfiguration({
  planId,
  className = '',
}: FixedPlanConfigurationProps) {
  const [plan, setPlan] = useState<IBillingPlan | null>(null);

  const [services, setServices] = useState<IService[]>([]);
  const [planLoading, setPlanLoading] = useState(true);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlanData = useCallback(async () => {
    setPlanLoading(true);
    setError(null);
    try {
      // Fetch the basic plan data
      const fetchedPlan = await getBillingPlanById(planId);
      if (fetchedPlan && fetchedPlan.plan_type === 'Fixed') {
        setPlan(fetchedPlan);
      } else {
        setError('Invalid plan type or plan not found.');
      }
    } catch (err) {
      console.error('Error fetching plan data:', err);
      setError('Failed to load plan configuration. Please try again.');
    } finally {
      setPlanLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    fetchPlanData();
  }, [fetchPlanData]);


  if (planLoading && !plan) {
    return <div className="flex justify-center items-center p-8"><Spinner size="sm" /></div>;
  }

  if (error) {
    return (
      <Alert variant="destructive" className={`m-4 ${className}`}>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!plan) {
      return <div className="p-4">Plan not found or invalid type.</div>; // Should not happen if error handling is correct
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Edit Contract Line: {plan?.plan_name || '...'} (Fixed)</CardTitle>
          {plan && (
            <BillingPlanDialog
              editingPlan={plan}
              onPlanAdded={() => fetchPlanData()}
              triggerButton={<Button id="edit-line-basics-button" variant="outline" size="sm">Edit Contract Line Basics</Button>}
              allServiceTypes={[]}
            />
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Base rate and proration settings are configured in the contract line basics above. Use the "Edit Contract Line Basics" button to modify these settings.
          </p>
        </CardContent>
      </Card>

      {/* Services List */}
      <Card>
          <CardHeader>
              <CardTitle>Associated Services</CardTitle>
          </CardHeader>
          <CardContent>
              <FixedPlanServicesList
                  planId={planId}
                  onServiceAdded={() => {
                      // Refresh the plan data when a service is added
                      fetchPlanData();
                  }}
              />
          </CardContent>
      </Card>
    </div>
  );
}
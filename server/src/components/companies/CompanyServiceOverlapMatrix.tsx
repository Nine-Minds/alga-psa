'use client';

import React, { useState, useEffect } from 'react';
import { Card } from 'server/src/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from 'server/src/components/ui/Table';
import { Badge } from 'server/src/components/ui/Badge';
import { Button } from 'server/src/components/ui/Button';
import { AlertTriangle, Info, CheckCircle } from 'lucide-react';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { ICompanyBillingPlan, IBillingPlan, IService } from 'server/src/interfaces/billing.interfaces';
import { getBillingPlans } from 'server/src/lib/actions/billingPlanAction';
import { getPlanServices } from 'server/src/lib/actions/planServiceActions';
import { PLAN_TYPE_DISPLAY } from 'server/src/constants/billing';

interface CompanyServiceOverlapMatrixProps {
  companyId: string;
  companyBillingPlans: ICompanyBillingPlan[];
  services: IService[];
  onEdit?: (billing: ICompanyBillingPlan) => void;
  className?: string;
}

const CompanyServiceOverlapMatrix: React.FC<CompanyServiceOverlapMatrixProps> = ({
  companyId,
  companyBillingPlans,
  services,
  onEdit,
  className = ''
}) => {
  const [planServices, setPlanServices] = useState<Record<string, IService[]>>({});
  const [serviceOverlaps, setServiceOverlaps] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllServices, setShowAllServices] = useState(false);
  const [allBillingPlans, setAllBillingPlans] = useState<IBillingPlan[]>([]);

  // Fetch services for each company billing plan
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Get all billing plans to get plan details
        const billingPlans = await getBillingPlans();
        setAllBillingPlans(billingPlans);
        
        // Create a map of plan_id to plan details
        const planDetailsMap = billingPlans.reduce((map, plan) => {
          if (plan.plan_id) {
            map[plan.plan_id] = plan;
          }
          return map;
        }, {} as Record<string, IBillingPlan>);
        
        // Get services for each company billing plan
        const servicesMap: Record<string, IService[]> = {};
        const serviceToPlans: Record<string, string[]> = {};
        
        for (const companyPlan of companyBillingPlans) {
          if (companyPlan.plan_id) {
            const planServicesList = await getPlanServices(companyPlan.plan_id);
            
            // Convert plan services to full service objects
            const fullServices = planServicesList.map(ps => 
              services.find(s => s.service_id === ps.service_id)
            ).filter(Boolean) as IService[];
            
            servicesMap[companyPlan.company_billing_plan_id] = fullServices;
            
            // Track which services appear in which company billing plans
            for (const service of fullServices) {
              if (!serviceToPlans[service.service_id]) {
                serviceToPlans[service.service_id] = [];
              }
              serviceToPlans[service.service_id].push(companyPlan.company_billing_plan_id);
            }
          }
        }
        
        setPlanServices(servicesMap);
        
        // Identify services that appear in multiple company billing plans
        const overlaps: Record<string, string[]> = {};
        for (const [serviceId, planIds] of Object.entries(serviceToPlans)) {
          if (planIds.length > 1) {
            overlaps[serviceId] = planIds;
          }
        }
        setServiceOverlaps(overlaps);
        
        setError(null);
      } catch (err) {
        console.error('Error fetching data for company service overlap matrix:', err);
        setError('Failed to load data for company service overlap matrix');
      } finally {
        setLoading(false);
      }
    };
    
    if (companyBillingPlans.length > 0) {
      fetchData();
    } else {
      setLoading(false);
    }
  }, [companyBillingPlans, services]);

  // Get all services that are in at least one company billing plan
  const servicesInPlans = React.useMemo(() => {
    const serviceIds = new Set<string>();
    
    Object.values(planServices).forEach(planServicesList => {
      planServicesList.forEach(service => {
        serviceIds.add(service.service_id);
      });
    });
    
    return Array.from(serviceIds).map(id => 
      services.find(s => s.service_id === id)
    ).filter(Boolean) as IService[];
  }, [planServices, services]);

  // Filter services based on showAllServices toggle
  const displayedServices = React.useMemo(() => {
    if (showAllServices) {
      return servicesInPlans;
    } else {
      return servicesInPlans.filter(service => 
        serviceOverlaps[service.service_id]
      );
    }
  }, [servicesInPlans, serviceOverlaps, showAllServices]);

  // Sort company billing plans by start date (newest first) and add plan_type
  const sortedCompanyPlans = React.useMemo(() => {
    return [...companyBillingPlans].map(plan => {
      // Get the billing plan that corresponds to this company billing plan
      const billingPlan = allBillingPlans.find(bp => bp.plan_id === plan.plan_id);
      
      // Create a new object with all properties from the company billing plan
      // plus the plan_type from the billing plan
      return {
        ...plan,
        plan_type: billingPlan?.plan_type
      };
    }).sort((a, b) => {
      const dateA = new Date(a.start_date).getTime();
      const dateB = new Date(b.start_date).getTime();
      return dateB - dateA;
    });
  }, [companyBillingPlans, allBillingPlans]);

  if (loading) {
    return <div className="flex justify-center items-center h-32">Loading service overlap matrix...</div>;
  }

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  if (companyBillingPlans.length === 0) {
    return (
      <Card className={`p-4 ${className}`}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">Service Overlap Matrix</h3>
        </div>
        <div className="flex items-center justify-center p-6 bg-gray-50 border border-gray-100 rounded-md">
          <p className="text-gray-700">No billing plans assigned to this company</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className={`p-4 ${className}`}>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium">Service Overlap Matrix</h3>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => setShowAllServices(!showAllServices)}
          id="toggle-services-button"
        >
          {showAllServices ? 'Show Overlapping Only' : 'Show All Services'}
        </Button>
      </div>
      
      {Object.keys(serviceOverlaps).length === 0 ? (
        <div className="flex items-center justify-center p-6 bg-green-50 border border-green-100 rounded-md">
          <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
          <p className="text-green-700">No service overlaps detected for this company</p>
        </div>
      ) : (
        <>
          <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-md">
            <p className="text-sm text-blue-800">
              <strong>{Object.keys(serviceOverlaps).length} service(s)</strong> appear in multiple billing plans for this company. 
              This matrix shows which services are included in each plan.
            </p>
          </div>
          
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">Service</TableHead>
                  {sortedCompanyPlans.map(plan => (
                    <TableHead key={plan.company_billing_plan_id} className="text-center min-w-[120px]">
                      <div className="flex flex-col items-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs p-1 h-auto"
                          onClick={() => onEdit && onEdit(plan)}
                          id={`edit-plan-${plan.company_billing_plan_id}-button`}
                        >
                          {plan.plan_name || 'Unnamed Plan'}
                        </Button>
                        <Badge className="mt-1 text-xs">
                          {plan.plan_type ? (PLAN_TYPE_DISPLAY[plan.plan_type as keyof typeof PLAN_TYPE_DISPLAY] || plan.plan_type) : 'Unknown'}
                        </Badge>
                      </div>
                    </TableHead>
                  ))}
                  <TableHead className="text-center min-w-[80px]">Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedServices.map(service => {
                  const isOverlapping = !!serviceOverlaps[service.service_id];
                  const planCount = isOverlapping 
                    ? serviceOverlaps[service.service_id].length 
                    : 1;
                  
                  return (
                    <TableRow 
                      key={service.service_id}
                      className={isOverlapping ? "bg-amber-50" : ""}
                    >
                      <TableCell>
                        <div className="flex items-center">
                          <span>{service.service_name}</span>
                          {isOverlapping && (
                            <Tooltip content="This service appears in multiple plans">
                              <AlertTriangle className="h-4 w-4 ml-2 text-amber-500" />
                            </Tooltip>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">
                          {service.service_type} • {service.unit_of_measure}
                        </div>
                      </TableCell>
                      
                      {sortedCompanyPlans.map(plan => {
                        const planServicesList = planServices[plan.company_billing_plan_id] || [];
                        const isInPlan = planServicesList.some(s => s.service_id === service.service_id);
                        
                        return (
                          <TableCell key={`${service.service_id}-${plan.company_billing_plan_id}`} className="text-center">
                            {isInPlan ? (
                              <div className="flex justify-center">
                                <CheckCircle className={`h-5 w-5 ${isOverlapping ? 'text-amber-500' : 'text-green-500'}`} />
                              </div>
                            ) : (
                              <div className="text-gray-300">-</div>
                            )}
                          </TableCell>
                        );
                      })}
                      
                      <TableCell className="text-center">
                        <Badge className={`${
                          planCount > 1 ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
                        }`}>
                          {planCount}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          
          <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded-md">
            <div className="flex items-start">
              <Info className="h-4 w-4 mt-0.5 mr-2 text-blue-500" />
              <div className="text-sm text-gray-700">
                <p className="font-medium mb-1">Matrix Legend</p>
                <ul className="space-y-1 text-xs">
                  <li className="flex items-center">
                    <CheckCircle className="h-3 w-3 text-green-500 mr-1" />
                    <span>Service is included in plan (no overlap)</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="h-3 w-3 text-amber-500 mr-1" />
                    <span>Service is included in plan (with overlap)</span>
                  </li>
                  <li className="flex items-center">
                    <AlertTriangle className="h-3 w-3 text-amber-500 mr-1" />
                    <span>Service appears in multiple plans</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </>
      )}
    </Card>
  );
};

export default CompanyServiceOverlapMatrix;
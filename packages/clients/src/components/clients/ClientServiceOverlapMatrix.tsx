'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@alga-psa/ui/components/Table';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { AlertTriangle, Info, CheckCircle } from 'lucide-react';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { IClientContractLine, IContractLine, IService } from 'server/src/interfaces/billing.interfaces';
import { getContractLines } from 'server/src/lib/actions/contractLineAction';
import { getContractLineServices } from 'server/src/lib/actions/contractLineServiceActions';
import { PLAN_TYPE_DISPLAY } from 'server/src/constants/billing';

interface ClientServiceOverlapMatrixProps {
  clientId: string;
  clientContractLines: IClientContractLine[];
  services: IService[];
  onEdit?: (billing: IClientContractLine) => void;
  className?: string;
}

const ClientServiceOverlapMatrix: React.FC<ClientServiceOverlapMatrixProps> = ({
  clientId,
  clientContractLines,
  services,
  onEdit,
  className = ''
}) => {
  const [planServices, setPlanServices] = useState<Record<string, IService[]>>({});
  const [serviceOverlaps, setServiceOverlaps] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllServices, setShowAllServices] = useState(false);
  const [allContractLines, setAllContractLines] = useState<IContractLine[]>([]);

  // Fetch services for each client contract line
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Get all contract lines to get plan details
        const contractLines = await getContractLines();
        setAllContractLines(contractLines);
        
        // Create a map of contract_line_id to plan details
        const planDetailsMap = contractLines.reduce((map, plan) => {
          if (plan.contract_line_id) {
            map[plan.contract_line_id] = plan;
          }
          return map;
        }, {} as Record<string, IContractLine>);
        
        // Get services for each client contract line
        const servicesMap: Record<string, IService[]> = {};
        const serviceToPlans: Record<string, string[]> = {};
        
        for (const clientPlan of clientContractLines) {
          if (clientPlan.contract_line_id) {
            const planServicesList = await getContractLineServices(clientPlan.contract_line_id);
            
            // Convert plan services to full service objects
            const fullServices = planServicesList.map(ps => 
              services.find(s => s.service_id === ps.service_id)
            ).filter(Boolean) as IService[];
            
            servicesMap[clientPlan.client_contract_line_id] = fullServices;
            
            // Track which services appear in which client contract lines
            for (const service of fullServices) {
              if (!serviceToPlans[service.service_id]) {
                serviceToPlans[service.service_id] = [];
              }
              serviceToPlans[service.service_id].push(clientPlan.client_contract_line_id);
            }
          }
        }
        
        setPlanServices(servicesMap);
        
        // Identify services that appear in multiple client contract lines
        const overlaps: Record<string, string[]> = {};
        for (const [serviceId, planIds] of Object.entries(serviceToPlans)) {
          if (planIds.length > 1) {
            overlaps[serviceId] = planIds;
          }
        }
        setServiceOverlaps(overlaps);
        
        setError(null);
      } catch (err) {
        console.error('Error fetching data for client service overlap matrix:', err);
        setError('Failed to load data for client service overlap matrix');
      } finally {
        setLoading(false);
      }
    };
    
    if (clientContractLines.length > 0) {
      fetchData();
    } else {
      setLoading(false);
    }
  }, [clientContractLines, services]);

  // Get all services that are in at least one client contract line
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

  // Sort client contract lines by start date (newest first) and add contract_line_type
  const sortedClientPlans = React.useMemo(() => {
    return [...clientContractLines].map(plan => {
      // Get the contract line that corresponds to this client contract line
      const contractLine = allContractLines.find(bp => bp.contract_line_id === plan.contract_line_id);

      // Create a new object with all properties from the client contract line
      // plus the contract_line_type from the contract line
      return {
        ...plan,
        contract_line_type: contractLine?.contract_line_type,
        contract_line_name: contractLine?.contract_line_name // Add contract_line_name here
      };
    }).sort((a, b) => {
      const dateA = new Date(a.start_date).getTime();
      const dateB = new Date(b.start_date).getTime();
      return dateB - dateA;
    });
  }, [clientContractLines, allContractLines]);

  if (loading) {
    return <div className="flex justify-center items-center h-32">Loading service overlap matrix...</div>;
  }

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  if (clientContractLines.length === 0) {
    return (
      <Card className={`p-4 ${className}`}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">Service Overlap Matrix</h3>
        </div>
        <div className="flex items-center justify-center p-6 bg-gray-50 border border-gray-100 rounded-md">
          <p className="text-gray-700">No contract lines assigned to this client</p>
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
          <p className="text-green-700">No service overlaps detected for this client</p>
        </div>
      ) : (
        <>
          <Alert variant="info" className="mb-4">
            <AlertDescription>
              <strong>{Object.keys(serviceOverlaps).length} service(s)</strong> appear in multiple contract lines for this client.
              This matrix shows which services are included in each line.
            </AlertDescription>
          </Alert>
          
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">Service</TableHead>
                  {sortedClientPlans.map(plan => (
                    <TableHead key={plan.client_contract_line_id} className="text-center min-w-[120px]">
                      <div className="flex flex-col items-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs p-1 h-auto"
                          onClick={() => onEdit && onEdit(plan)}
                          id={`edit-plan-${plan.client_contract_line_id}-button`}
                        >
                          {plan.contract_line_name || 'Unnamed Plan'}
                        </Button>
                        <Badge className="mt-1 text-xs">
                          {plan.contract_line_type ? (PLAN_TYPE_DISPLAY[plan.contract_line_type as keyof typeof PLAN_TYPE_DISPLAY] || plan.contract_line_type) : 'Unknown'}
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
                  const contractLineCount = isOverlapping
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
                            <Tooltip content="This service appears in multiple contract lines">
                              <AlertTriangle className="h-4 w-4 ml-2 text-amber-500" />
                            </Tooltip>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">
                          {service.service_type_name || 'Unknown Type'} • {service.unit_of_measure}
                        </div>
                      </TableCell>

                      {sortedClientPlans.map(plan => {
                        const planServicesList = planServices[plan.client_contract_line_id] || [];
                        const isInPlan = planServicesList.some(s => s.service_id === service.service_id);

                        return (
                          <TableCell key={`${service.service_id}-${plan.client_contract_line_id}`} className="text-center">
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
                          contractLineCount > 1 ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
                        }`}>
                          {contractLineCount}
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
                    <span>Service is included in contract line (no overlap)</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="h-3 w-3 text-amber-500 mr-1" />
                    <span>Service is included in contract line (with overlap)</span>
                  </li>
                  <li className="flex items-center">
                    <AlertTriangle className="h-3 w-3 text-amber-500 mr-1" />
                    <span>Service appears in multiple contract lines</span>
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

export default ClientServiceOverlapMatrix;

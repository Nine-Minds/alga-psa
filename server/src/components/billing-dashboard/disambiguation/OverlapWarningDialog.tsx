'use client';

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { AlertTriangle, Info } from 'lucide-react';
import { IBillingPlan, IService } from 'server/src/interfaces/billing.interfaces';
import { PLAN_TYPE_DISPLAY } from 'server/src/constants/billing';

interface OverlapWarningDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  overlappingServices: Array<{
    service: IService;
    existingPlans: IBillingPlan[];
  }>;
  currentPlanType: string;
}

export function OverlapWarningDialog({
  isOpen,
  onClose,
  onConfirm,
  overlappingServices,
  currentPlanType
}: OverlapWarningDialogProps) {
  // Determine the severity of the overlap
  const hasSeverityHighOverlap = overlappingServices.some(item => {
    // Check if any of the existing plans have a different plan type
    const hasDifferentPlanTypes = item.existingPlans.some(
      plan => plan.plan_type !== currentPlanType
    );
    
    // Check service type compatibility with plan types
    const serviceType = item.service.service_type;
    const isTypeCompatible = 
      (serviceType === 'Time' && ['Hourly', 'Bucket'].includes(currentPlanType)) ||
      (serviceType === 'Fixed' && ['Fixed', 'Bucket'].includes(currentPlanType)) ||
      (serviceType === 'Usage' && ['Usage', 'Bucket'].includes(currentPlanType));
    
    return hasDifferentPlanTypes || !isTypeCompatible;
  });

  return (
    <Dialog isOpen={isOpen} onClose={onClose} id="overlap-warning-dialog">
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            <div className="flex items-center">
              <AlertTriangle className={`mr-2 h-5 w-5 ${hasSeverityHighOverlap ? 'text-red-500' : 'text-amber-500'}`} />
              <span>{hasSeverityHighOverlap ? 'Critical Service Overlap Detected' : 'Service Overlap Warning'}</span>
            </div>
          </DialogTitle>
        </DialogHeader>
        
        <div className="py-4">
          <p className="text-sm text-gray-700 mb-4">
            {overlappingServices.length === 1 
              ? 'The following service already exists in other billing plans:' 
              : `The following ${overlappingServices.length} services already exist in other billing plans:`}
          </p>
          
          <div className="space-y-3 max-h-60 overflow-y-auto">
            {overlappingServices.map(item => {
              const service = item.service;
              const existingPlans = item.existingPlans;
              
              // Check if this service has a high severity overlap
              const hasDifferentPlanTypes = existingPlans.some(
                plan => plan.plan_type !== currentPlanType
              );
              
              const serviceType = service.service_type;
              const isTypeCompatible = 
                (serviceType === 'Time' && ['Hourly', 'Bucket'].includes(currentPlanType)) ||
                (serviceType === 'Fixed' && ['Fixed', 'Bucket'].includes(currentPlanType)) ||
                (serviceType === 'Usage' && ['Usage', 'Bucket'].includes(currentPlanType));
              
              const isHighSeverity = hasDifferentPlanTypes || !isTypeCompatible;
              
              return (
                <div 
                  key={service.service_id} 
                  className={`p-3 border rounded-md ${
                    isHighSeverity 
                      ? 'bg-red-50 border-red-200' 
                      : 'bg-amber-50 border-amber-200'
                  }`}
                >
                  <div className="flex justify-between">
                    <h4 className="font-medium text-sm">{service.service_name}</h4>
                    <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                      {service.service_type}
                    </span>
                  </div>
                  
                  <div className="mt-2 text-xs">
                    <p className="mb-1">Exists in plans:</p>
                    <ul className="pl-5 list-disc space-y-1">
                      {existingPlans.map(plan => (
                        <li key={plan.plan_id}>
                          {plan.plan_name} 
                          <span className="text-gray-500 ml-1">
                            ({PLAN_TYPE_DISPLAY[plan.plan_type as keyof typeof PLAN_TYPE_DISPLAY] || plan.plan_type})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  
                  {isHighSeverity && (
                    <div className="mt-2 text-xs text-red-700 flex items-start">
                      <AlertTriangle className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0" />
                      <span>
                        {!isTypeCompatible 
                          ? `This ${service.service_type} service may not be compatible with ${currentPlanType} plan type.`
                          : 'This service appears in different plan types, which may cause billing disambiguation issues.'}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          
          <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-md flex items-start">
            <Info className="h-4 w-4 text-blue-500 mt-0.5 mr-2 flex-shrink-0" />
            <div className="text-xs text-blue-700">
              <p className="font-medium mb-1">Potential Issues:</p>
              <ul className="space-y-1">
                <li>• Users may be confused about which plan to select when entering time or usage</li>
                <li>• Reporting and billing may be inconsistent across plans</li>
                <li>• Service allocation may require manual intervention</li>
              </ul>
            </div>
          </div>
        </div>
        
        <DialogFooter>
          <div className="flex justify-between w-full">
          <Button
            id="cancel-overlap-button"
            variant="outline"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            id="continue-with-overlap-button"
            variant={hasSeverityHighOverlap ? "destructive" : "default"}
            onClick={onConfirm}
          >
            {hasSeverityHighOverlap 
              ? 'Continue Despite Warnings' 
              : 'Continue with Overlaps'}
          </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default OverlapWarningDialog;
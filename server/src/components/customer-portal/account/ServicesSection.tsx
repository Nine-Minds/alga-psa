'use client';

import { Card } from "@/components/ui/Card";
import { Table } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { useState, useEffect } from 'react';
import { 
  getActiveServices, 
  getServiceUpgrades,
  upgradeService,
  downgradeService,
  type Service,
  type ServicePlan
} from "@/lib/actions/account";

export default function ServicesSection() {
  const [services, setServices] = useState<Service[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [availablePlans, setAvailablePlans] = useState<ServicePlan[]>([]);
  const [isManaging, setIsManaging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    const loadServices = async () => {
      try {
        const data = await getActiveServices();
        setServices(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load services');
      } finally {
        setIsLoading(false);
      }
    };

    loadServices();
  }, []);

  const handleManageService = async (service: Service) => {
    setSelectedService(service);
    setActionError('');
    setIsProcessing(false);

    try {
      const plans = await getServiceUpgrades(service.id);
      setAvailablePlans(plans);
      setIsManaging(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load service plans');
    }
  };

  const handleServiceChange = async (planId: string, isUpgrade: boolean) => {
    if (!selectedService) return;
    
    setIsProcessing(true);
    setActionError('');

    try {
      if (isUpgrade) {
        await upgradeService(selectedService.id, planId);
      } else {
        await downgradeService(selectedService.id, planId);
      }

      // Refresh services list
      const updatedServices = await getActiveServices();
      setServices(updatedServices);
      
      // Close dialog
      setIsManaging(false);
      setSelectedService(null);
      setAvailablePlans([]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update service');
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return <div className="text-center py-8">Loading services...</div>;
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-500">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Active Services */}
      <section>
        <h3 className="text-lg font-medium mb-4">Active Services</h3>
        <Table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Description</th>
              <th>Status</th>
              <th>Current Plan</th>
              <th>Next Billing</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {services.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-4 text-gray-500">
                  No active services found
                </td>
              </tr>
            ) : (
              services.map((service): JSX.Element => (
                <tr key={service.id}>
                  <td className="font-medium">{service.name}</td>
                  <td className="text-sm text-gray-600">{service.description}</td>
                  <td>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      service.status === 'active' ? 'bg-green-100 text-green-800' : 
                      service.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {service.status}
                    </span>
                  </td>
                  <td>
                    <div className="text-sm">
                      <div>{service.billing.display}</div>
                      {service.rate && (
                        <div className="text-gray-600">{service.rate.displayAmount}</div>
                      )}
                    </div>
                  </td>
                  <td>{service.nextBillingDate}</td>
                  <td>
                    <Button 
                      id={`manage-service-${service.id}`}
                      variant="ghost" 
                      size="sm"
                      onClick={() => handleManageService(service)}
                      disabled={!service.canManage}
                    >
                      Manage
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </section>

      {/* Service Management Dialog */}
      <Dialog isOpen={isManaging} onClose={() => {
        setIsManaging(false);
        setSelectedService(null);
        setAvailablePlans([]);
        setActionError('');
      }}>
        <DialogContent>
          <div className="space-y-6">
            <h3 className="text-lg font-medium">
              Manage {selectedService?.name || 'Service'}
            </h3>

            <div>
              <h4 className="text-sm font-medium mb-2">Current Plan</h4>
              <div className="text-sm text-gray-600">
                {selectedService?.billing.display}
                {selectedService?.rate && (
                  <span className="ml-2">{selectedService.rate.displayAmount}</span>
                )}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium mb-4">Available Plans</h4>
              <div className="space-y-4">
                {availablePlans.map((plan):JSX.Element => (
                  <Card key={plan.id} className="p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h5 className="font-medium">{plan.name}</h5>
                        <p className="text-sm text-gray-600 mt-1">{plan.description}</p>
                        <div className="mt-2">
                          <span className="text-sm font-medium">{plan.rate.displayAmount}</span>
                        </div>
                      </div>
                      <div>
                        {!plan.isCurrentPlan && (
                          <Button
                            id={`plan-change-${plan.id}`}
                            variant="outline"
                            size="sm"
                            onClick={() => handleServiceChange(
                              plan.id,
                              Number(plan.rate.amount) > Number(selectedService?.rate?.amount || 0)
                            )}
                            disabled={isProcessing}
                          >
                            {isProcessing ? 'Processing...' : 
                              Number(plan.rate.amount) > Number(selectedService?.rate?.amount || 0) 
                                ? 'Upgrade' 
                                : 'Downgrade'
                            }
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>

            {actionError && (
              <p className="text-sm text-red-500">{actionError}</p>
            )}

            <div className="flex justify-end">
              <Button
                id="close-service-dialog-button"
                variant="ghost"
                onClick={() => {
                  setIsManaging(false);
                  setSelectedService(null);
                  setAvailablePlans([]);
                  setActionError('');
                }}
                disabled={isProcessing}
              >
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Available Services */}
      <section>
        <h3 className="text-lg font-medium mb-4">Available Services</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="p-6 hover:shadow-lg transition-shadow duration-200">
            <div className="flex flex-col h-full">
              <h4 className="text-lg font-medium mb-2">Managed IT Support</h4>
              <p className="text-sm text-gray-600 mb-4 flex-grow">
                24/7 IT support and monitoring for your business. Includes proactive maintenance,
                security updates, and dedicated technical support.
              </p>
              <div className="flex justify-between items-center mt-auto">
                <span className="text-sm font-medium">Starting at $299/mo</span>
                <Button 
                  id="learn-more-managed-it"
                  variant="outline" 
                  size="sm"
                >
                  Learn More
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-6 hover:shadow-lg transition-shadow duration-200">
            <div className="flex flex-col h-full">
              <h4 className="text-lg font-medium mb-2">Cloud Backup</h4>
              <p className="text-sm text-gray-600 mb-4 flex-grow">
                Secure cloud backup and disaster recovery solutions. Automated backups,
                quick recovery options, and data encryption included.
              </p>
              <div className="flex justify-between items-center mt-auto">
                <span className="text-sm font-medium">Starting at $99/mo</span>
                <Button 
                  id="learn-more-cloud-backup"
                  variant="outline" 
                  size="sm"
                >
                  Learn More
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-6 hover:shadow-lg transition-shadow duration-200">
            <div className="flex flex-col h-full">
              <h4 className="text-lg font-medium mb-2">Cybersecurity</h4>
              <p className="text-sm text-gray-600 mb-4 flex-grow">
                Advanced security monitoring and threat prevention. Includes firewall management,
                endpoint protection, and regular security assessments.
              </p>
              <div className="flex justify-between items-center mt-auto">
                <span className="text-sm font-medium">Starting at $199/mo</span>
                <Button 
                  id="learn-more-cybersecurity"
                  variant="outline" 
                  size="sm"
                >
                  Learn More
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}

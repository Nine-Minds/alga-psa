'use client';

import { Card } from "@alga-psa/ui/components/Card";
import { Table } from "@alga-psa/ui/components/Table";
import { Button } from "@alga-psa/ui/components/Button";
import { Dialog, DialogContent } from "@alga-psa/ui/components/Dialog";
import { useState, useEffect } from 'react';
import {
  getActiveServices,
  getServiceUpgrades,
  upgradeService,
  downgradeService,
  type Service,
  type ServicePlan
} from "server/src/lib/actions/account";
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function ServicesSection() {
  const { t } = useTranslation('clientPortal');
  const [services, setServices] = useState<Service[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [availableContractLines, setAvailableContractLines] = useState<ServicePlan[]>([]);
  const [isManaging, setIsManaging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    const loadServices = async () => {
      try {
        const data = await getActiveServices();
        setServices(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('account.services.loadError', 'Failed to load services'));
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
      const contractLines = await getServiceUpgrades(service.id);
      setAvailableContractLines(contractLines);
      setIsManaging(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('account.services.loadContractLinesError', 'Failed to load service contract lines'));
    }
  };

  const handleServiceChange = async (contractLineId: string, isUpgrade: boolean) => {
    if (!selectedService) return;
    
    setIsProcessing(true);
    setActionError('');

    try {
      if (isUpgrade) {
        await upgradeService(selectedService.id, contractLineId);
      } else {
        await downgradeService(selectedService.id, contractLineId);
      }

      // Refresh services list
      const updatedServices = await getActiveServices();
      setServices(updatedServices);
      
      // Close dialog
      setIsManaging(false);
      setSelectedService(null);
      setAvailableContractLines([]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('account.services.updateError', 'Failed to update service'));
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return <div className="text-center py-8">{t('account.services.loading', 'Loading services...')}</div>;
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
        <h3 className="text-lg font-medium mb-4">{t('account.services.activeTitle', 'Active Services')}</h3>
        <Table>
          <thead>
            <tr>
              <th>{t('account.services.columns.service', 'Service')}</th>
              <th>{t('account.services.columns.description', 'Description')}</th>
              <th>{t('account.services.columns.status', 'Status')}</th>
              <th>{t('account.services.columns.currentContractLine', 'Current Contract Line')}</th>
              <th>{t('account.services.columns.nextBilling', 'Next Billing')}</th>
              <th>{t('clientPortal.common.actions', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {services.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-4 text-gray-500">
                  {t('account.services.empty', 'No active services found')}
                </td>
              </tr>
            ) : (
              services.map((service): React.JSX.Element => (
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
                      {t('account.services.actions.manage', 'Manage')}
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
        setAvailableContractLines([]);
        setActionError('');
      }}>
        <DialogContent>
          <div className="space-y-6">
            <h3 className="text-lg font-medium">
              {t('account.services.manageTitle', {
                defaultValue: 'Manage {{service}}',
                service: selectedService?.name || t('account.services.genericServiceLabel', 'Service')
              })}
            </h3>

            <div>
              <h4 className="text-sm font-medium mb-2">{t('account.services.currentContractLine', 'Current Contract Line')}</h4>
              <div className="text-sm text-gray-600">
                {selectedService?.billing.display}
                {selectedService?.rate && (
                  <span className="ml-2">{selectedService.rate.displayAmount}</span>
                )}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium mb-4">{t('account.services.availableContractLines', 'Available Contract Lines')}</h4>
              <div className="space-y-4">
                {availableContractLines.map((contractLine): React.JSX.Element => (
                  <Card key={contractLine.id} className="p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h5 className="font-medium">{contractLine.name}</h5>
                        <p className="text-sm text-gray-600 mt-1">{contractLine.description}</p>
                        <div className="mt-2">
                          <span className="text-sm font-medium">{contractLine.rate.displayAmount}</span>
                        </div>
                      </div>
                      <div>
                        {!contractLine.isCurrentPlan && (
                          <Button
                            id={`contract-line-change-${contractLine.id}`}
                            variant="outline"
                            size="sm"
                            onClick={() => handleServiceChange(
                              contractLine.id,
                              Number(contractLine.rate.amount) > Number(selectedService?.rate?.amount || 0)
                            )}
                            disabled={isProcessing}
                          >
                            {isProcessing
                              ? t('common:status.processing', 'Processing...')
                              : Number(contractLine.rate.amount) > Number(selectedService?.rate?.amount || 0)
                                ? t('account.services.actions.upgrade', 'Upgrade')
                                : t('account.services.actions.downgrade', 'Downgrade')
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
                  setAvailableContractLines([]);
                  setActionError('');
                }}
                disabled={isProcessing}
              >
                {t('common.close', 'Close')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Available Services */}
      <section>
        <h3 className="text-lg font-medium mb-4">{t('account.services.catalog.title', 'Available Services')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="p-6 hover:shadow-lg transition-shadow duration-200">
            <div className="flex flex-col h-full">
              <h4 className="text-lg font-medium mb-2">{t('account.services.catalog.managedIt.title', 'Managed IT Support')}</h4>
              <p className="text-sm text-gray-600 mb-4 flex-grow">
                {t('account.services.catalog.managedIt.description', '24/7 IT support and monitoring for your business. Includes proactive maintenance, security updates, and dedicated technical support.')}
              </p>
              <div className="flex justify-between items-center mt-auto">
                <span className="text-sm font-medium">{t('account.services.catalog.managedIt.price', 'Starting at $299/mo')}</span>
                <Button 
                  id="learn-more-managed-it"
                  variant="outline" 
                  size="sm"
                >
                  {t('account.services.catalog.learnMore', 'Learn More')}
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-6 hover:shadow-lg transition-shadow duration-200">
            <div className="flex flex-col h-full">
              <h4 className="text-lg font-medium mb-2">{t('account.services.catalog.cloudBackup.title', 'Cloud Backup')}</h4>
              <p className="text-sm text-gray-600 mb-4 flex-grow">
                {t('account.services.catalog.cloudBackup.description', 'Secure cloud backup and disaster recovery solutions. Automated backups, quick recovery options, and data encryption included.')}
              </p>
              <div className="flex justify-between items-center mt-auto">
                <span className="text-sm font-medium">{t('account.services.catalog.cloudBackup.price', 'Starting at $99/mo')}</span>
                <Button 
                  id="learn-more-cloud-backup"
                  variant="outline" 
                  size="sm"
                >
                  {t('account.services.catalog.learnMore', 'Learn More')}
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-6 hover:shadow-lg transition-shadow duration-200">
            <div className="flex flex-col h-full">
              <h4 className="text-lg font-medium mb-2">{t('account.services.catalog.cybersecurity.title', 'Cybersecurity')}</h4>
              <p className="text-sm text-gray-600 mb-4 flex-grow">
                {t('account.services.catalog.cybersecurity.description', 'Advanced security monitoring and threat prevention. Includes firewall management, endpoint protection, and regular security assessments.')}
              </p>
              <div className="flex justify-between items-center mt-auto">
                <span className="text-sm font-medium">{t('account.services.catalog.cybersecurity.price', 'Starting at $199/mo')}</span>
                <Button 
                  id="learn-more-cybersecurity"
                  variant="outline" 
                  size="sm"
                >
                  {t('account.services.catalog.learnMore', 'Learn More')}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}

'use client'

import React, { useState, useEffect } from 'react';
import PlanPickerDialog from './PlanPickerDialog';
import type {
  IClient,
  IContact,
  IClientContractLine,
  IContractLine,
  IServiceCategory,
  IService,
  ITaxRate,
  IClientTaxRate,
  IClientTaxRateAssociation,
} from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import CustomTabs, { TabContent } from '@alga-psa/ui/components/CustomTabs';
import {
  getClientContractLine,
  updateClientContractLine,
  addClientContractLine,
  removeClientContractLine,
  editClientContractLine,
  getClientTaxRates,
  addClientTaxRate,
  removeClientTaxRate,
  updateDefaultClientTaxRate,
} from '@alga-psa/clients/actions';
import { getContractLines } from '@alga-psa/billing/actions';
import { getServiceCategories } from '@alga-psa/billing/actions';
import { getServices, createService, updateService, deleteService } from '@alga-psa/billing/actions';
import { getTaxRates } from '@alga-psa/billing/actions';
import { setClientTemplate } from '@alga-psa/billing/actions';
import BillingConfigForm from './BillingConfigForm';
import ClientTaxRates from './ClientTaxRates';
import ContractLines from './ContractLines';
import ClientZeroDollarInvoiceSettings from './ClientZeroDollarInvoiceSettings';
import ClientCreditExpirationSettings from './ClientCreditExpirationSettings';
import ClientServiceOverlapMatrix from './ClientServiceOverlapMatrix';
import ClientPlanDisambiguationGuide from './ClientPlanDisambiguationGuide';
import ClientContractAssignment from './ClientContractAssignment'; // Added import
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { toast } from 'react-hot-toast';
import { ClientBillingSchedule } from './ClientBillingSchedule';

interface BillingConfigurationProps {
    client: IClient;
    onSave: (updatedClient: Partial<IClient>) => void;
    contacts?: IContact[];
}

type DateString = string;

interface ClientContractLineWithStringDates extends Omit<IClientContractLine, 'start_date' | 'end_date'> {
    start_date: DateString;
    end_date: DateString | null;
}

const BillingConfiguration: React.FC<BillingConfigurationProps> = ({ client, onSave, contacts = [] }) => {
    const [activeTab, setActiveTab] = useState('general');
    const [billingConfig, setBillingConfig] = useState({
        payment_terms: client.payment_terms || 'net_30',
        credit_limit: client.credit_limit || 0,
        preferred_payment_method: client.preferred_payment_method || '',
        auto_invoice: client.auto_invoice || false,
        invoice_delivery_method: client.invoice_delivery_method || '',
        invoice_template_id: client.invoice_template_id || '',
        billing_contact_id: client.billing_contact_id || '',
        billing_email: client.billing_email || '',
        region_code: client.region_code || null,
        default_currency_code: client.default_currency_code || 'USD',
    });

    const [contractLines, setContractLines] = useState<IContractLine[]>([]);
    const [serviceCategories, setServiceCategories] = useState<IServiceCategory[]>([]);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [clientContractLines, setClientContractLines] = useState<ClientContractLineWithStringDates[]>([]);
    const [editingContractLine, setEditingContractLine] = useState<ClientContractLineWithStringDates | null>(null);
    const [contractLineToDelete, setContractLineToDelete] = useState<string | null>(null);
    const [services, setServices] = useState<IService[]>([]);
    const [serviceTypes, setServiceTypes] = useState<{ id: string; name: string; billing_method: 'fixed' | 'hourly' | 'usage' | 'per_unit'; is_standard: boolean }[]>([]);
    const [newService, setNewService] = useState<Partial<IService>>({
        unit_of_measure: 'hour',
        custom_service_type_id: '', // Will be set after fetching service types
        service_name: '',
        default_rate: 0,
        category_id: null,
        billing_method: 'fixed',
        description: '', // Add description field
    });
    const [taxRates, setTaxRates] = useState<ITaxRate[]>([]);
    const [clientTaxRates, setClientTaxRates] = useState<IClientTaxRate[]>([]);
    // Removed selectedTaxRate state as it's no longer needed for the simplified ClientTaxRates component

    // Formats a Date object or string into 'YYYY-MM-DD' string, handling potential UTC interpretation
    const formatStartDate = (date: Date | string | null): string => {
        // Log the input received by the function on the client side
        console.log("BillingConfiguration formatStartDate received:", date, typeof date);
        if (!date) return ''; // Return empty string or a default if preferred

        let d: Date;
        if (typeof date === 'string') {
            // If it's already a string, assume YYYY-MM-DD or ISO and try parsing
            // Handle potential 'T' separator from ISO strings
            const dateString = date.includes('T') ? date.split('T')[0] : date;
            const parts = dateString.split('-');
            if (parts.length === 3) {
                // Construct date using UTC values to avoid timezone shifts during parsing
                // Construct date using UTC values to avoid timezone shifts during parsing
                d = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
            } else {
                d = new Date(date); // Fallback parsing
            }
        } else {
            // If it's a Date object, use it directly
            d = date;
        }

        if (isNaN(d.getTime())) {
            return ''; // Handle invalid date
        }

        // Extract year, month, day using UTC methods to match the UTC date parsed/received
        const year = d.getUTCFullYear();
        const month = (d.getUTCMonth() + 1).toString().padStart(2, '0'); // Month is 0-indexed
        const day = d.getUTCDate().toString().padStart(2, '0');

        return `${year}-${month}-${day}`;
    };

    useEffect(() => {
        const fetchData = async () => {
            const contractLines = await getClientContractLine(client.client_id);
            const contractLinesWithStringDates: ClientContractLineWithStringDates[] = contractLines.map((plan: IClientContractLine): ClientContractLineWithStringDates => ({
                ...plan,
                start_date: formatStartDate(plan.start_date),
                end_date: plan.end_date ? formatStartDate(plan.end_date) : null
            }));
            setClientContractLines(contractLinesWithStringDates);

            const plans = await getContractLines();
            setContractLines(plans);

            const categories = await getServiceCategories();
            setServiceCategories(categories);

            const servicesResponse = await getServices(1, 999, { item_kind: 'any' });
            // Extract the services array from the paginated response
            setServices(Array.isArray(servicesResponse) ? servicesResponse : (servicesResponse.services || []));

            // Fetch service types for the dropdown
            const { getServiceTypesForSelection } = await import('@alga-psa/billing/actions');
            const types = await getServiceTypesForSelection();
            setServiceTypes(types);

            // Find a default "Time" service type if it exists
            const timeType = types.find(t => t.name === 'Time');
            if (timeType) {
                // Set the custom service type ID
                setNewService(prev => ({ ...prev, custom_service_type_id: timeType.id, billing_method: timeType.billing_method }));
            }

            const fetchedTaxRates = await getTaxRates();
            setTaxRates(fetchedTaxRates);

            const fetchedClientTaxRates = await getClientTaxRates(client.client_id);
            setClientTaxRates(fetchedClientTaxRates);
        };
        fetchData();
    }, [client.client_id]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setBillingConfig(prev => ({ ...prev, [name]: value }));
    };

    const handleSelectChange = (name: string) => async (value: string) => {
        setBillingConfig(prev => ({ ...prev, [name]: value }));
    };

    const handleSwitchChange = (checked: boolean) => {
        setBillingConfig(prev => ({ ...prev, auto_invoice: checked }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            // Extract all billing-related fields
            const {
                payment_terms,
                preferred_payment_method,
                auto_invoice,
                invoice_delivery_method,
                billing_contact_id,
                billing_email,
                invoice_template_id,
                region_code, // Added region_code
                default_currency_code, // Added default_currency_code
                ...rest
            } = billingConfig;

            // Always include billing fields in update data to ensure they're properly nulled
            await onSave({
                payment_terms,
                preferred_payment_method,
                auto_invoice,
                invoice_delivery_method,
                billing_contact_id,  // Pass through as-is, updateClient will handle empty strings
                billing_email,
                region_code, // Pass region_code to onSave
                default_currency_code // Pass default_currency_code to onSave
            });

            // Save template selection separately using the dedicated function
            if (invoice_template_id !== client.invoice_template_id) {
                await setClientTemplate(client.client_id, invoice_template_id || null);
            }

            toast.success('Billing configuration saved successfully');
        } catch (error) {
            console.error('Error saving billing configuration:', error);
            setErrorMessage('Failed to save billing configuration');
            toast.error('Failed to save billing configuration');
        }
    };

    const handleClientPlanChange = async (clientContractLineId: string, planId: string) => {
        try {
            await updateClientContractLine(clientContractLineId, { contract_line_id: planId });
            const updatedContractLines = await getClientContractLine(client.client_id);
            const updatedContractLinesWithStringDates: ClientContractLineWithStringDates[] = updatedContractLines.map((plan: IClientContractLine): ClientContractLineWithStringDates => ({
                ...plan,
                start_date: formatStartDate(plan.start_date),
                end_date: plan.end_date ? formatStartDate(plan.end_date) : null
            }));
            setClientContractLines(updatedContractLinesWithStringDates);
            toast.success('Contract line updated successfully');
        } catch (error) {
            setErrorMessage('Failed to update contract line. Please try again.');
            toast.error('Failed to update contract line');
        }
    };

    const handleServiceCategoryChange = async (clientContractLineId: string, categoryId: string | null) => {
        try {
            await updateClientContractLine(clientContractLineId, { service_category: categoryId === null ? undefined : categoryId });
            const updatedContractLines = await getClientContractLine(client.client_id);
            const updatedContractLinesWithStringDates: ClientContractLineWithStringDates[] = updatedContractLines.map((plan: IClientContractLine): ClientContractLineWithStringDates => ({
                ...plan,
                start_date: formatStartDate(plan.start_date),
                end_date: plan.end_date ? formatStartDate(plan.end_date) : null
            }));
            setClientContractLines(updatedContractLinesWithStringDates);
            toast.success('Service category updated successfully');
        } catch (error) {
            setErrorMessage('Failed to update service category. Please try again.');
            toast.error('Failed to update service category');
        }
    };

    const handleAddContractLine = async (newContractLine: Omit<IClientContractLine, "client_contract_line_id" | "tenant">) => {
        try {
            await addClientContractLine(newContractLine);
            const updatedContractLines = await getClientContractLine(client.client_id);
            const updatedContractLinesWithStringDates: ClientContractLineWithStringDates[] = updatedContractLines.map((plan: IClientContractLine): ClientContractLineWithStringDates => ({
                ...plan,
                start_date: formatStartDate(plan.start_date),
                end_date: plan.end_date ? formatStartDate(plan.end_date) : null
            }));
            setClientContractLines(updatedContractLinesWithStringDates);
            toast.success('Contract line added successfully');
        } catch (error: any) {
            setErrorMessage(error.message || 'Failed to add contract line. Please try again.');
            toast.error(error.message || 'Failed to add contract line');
        }
    };

    const handleRemoveContractLine = async (clientContractLineId: string) => {
        setContractLineToDelete(clientContractLineId);
    };

    const confirmRemoveContractLine = async () => {
        if (!contractLineToDelete) return;

        try {
            await removeClientContractLine(contractLineToDelete);
            const updatedContractLines = await getClientContractLine(client.client_id);
            const updatedContractLinesWithStringDates: ClientContractLineWithStringDates[] = updatedContractLines.map((plan: IClientContractLine): ClientContractLineWithStringDates => ({
                ...plan,
                start_date: formatStartDate(plan.start_date),
                end_date: plan.end_date ? formatStartDate(plan.end_date) : null
            }));
            setClientContractLines(updatedContractLinesWithStringDates);
            toast.success('Contract line removed successfully');
        } catch (error: any) {
            // Display the actual error message from the server if available
            setErrorMessage(error.message || 'Failed to remove contract line. Please try again.');
            toast.error(error.message || 'Failed to remove contract line');
        } finally {
            setContractLineToDelete(null);
        }
    };

    const handleEditContractLine = (billing: ClientContractLineWithStringDates) => {
        setEditingContractLine({ ...billing });
    };

    const handleSaveEditContractLine = async (planToSave: ClientContractLineWithStringDates) => {
        if (planToSave) {
            try {
                // Log the data being saved
                console.log('Saving contract line with end_date:', planToSave.end_date);

                const updatedBilling: IClientContractLine = {
                    ...planToSave,
                    start_date: planToSave.start_date || '',
                    // Explicitly set end_date to null if it's falsy to ensure ongoing plans are properly saved
                    end_date: planToSave.end_date || null
                };

                // Log the data being sent to the server
                console.log('Sending to server:', updatedBilling);
                await editClientContractLine(updatedBilling.client_contract_line_id, updatedBilling);

                const updatedContractLines = await getClientContractLine(client.client_id);
                const updatedContractLinesWithStringDates: ClientContractLineWithStringDates[] = updatedContractLines.map((plan: IClientContractLine): ClientContractLineWithStringDates => ({
                    ...plan,
                    start_date: formatStartDate(plan.start_date),
                    end_date: plan.end_date ? formatStartDate(plan.end_date) : null
                }));
                setClientContractLines(updatedContractLinesWithStringDates);
                setEditingContractLine(null);
                setErrorMessage(null);
                toast.success('Contract line saved successfully');
            } catch (error: any) {
                // Display the actual error message from the server if available
                setErrorMessage(error.message || 'Failed to save changes. Please try again.');
                toast.error(error.message || 'Failed to save changes');
            }
        }
    };

    const handleAddService = async () => {
        try {
            // Ensure we have custom_service_type_id
            if (!newService.custom_service_type_id) {
                setErrorMessage('Please select a service type');
                return;
            }

            await createService(newService as any);

            // Reset the form
            setNewService({
                unit_of_measure: 'hour',
                custom_service_type_id: '',
                service_name: '',
                default_rate: 0,
                category_id: null,
                billing_method: 'fixed',
                description: '', // Reset description field
            });

            // Find a default "Time" service type if it exists
            const timeType = serviceTypes.find(t => t.name === 'Time');
            if (timeType) {
                // Set the custom service type ID
                setNewService(prev => ({
                    ...prev,
                    custom_service_type_id: timeType.id,
                    billing_method: timeType.billing_method,
                    description: prev.description || '' // Preserve description
                }));
            }

            const servicesResponse = await getServices(1, 999, { item_kind: 'any' });
            // Extract the services array from the paginated response
            setServices(Array.isArray(servicesResponse) ? servicesResponse : (servicesResponse.services || []));
            setErrorMessage(null);
            toast.success('Service added successfully');
        } catch (error) {
            console.error('Error creating service:', error);
            setErrorMessage('Failed to add service. Please try again.');
            toast.error('Failed to add service');
        }
    };

    const handleUpdateService = async (service: IService) => {
        try {
            await updateService(service.service_id, service);
            const servicesResponse = await getServices(1, 999, { item_kind: 'any' });
            // Extract the services array from the paginated response
            setServices(Array.isArray(servicesResponse) ? servicesResponse : (servicesResponse.services || []));
            toast.success('Service updated successfully');
        } catch (error) {
            setErrorMessage('Failed to update service. Please try again.');
            toast.error('Failed to update service');
        }
    };

    const handleDeleteService = async (serviceId: string) => {
        try {
            await deleteService(serviceId);
            const servicesResponse = await getServices(1, 999, { item_kind: 'any' });
            // Extract the services array from the paginated response
            setServices(Array.isArray(servicesResponse) ? servicesResponse : (servicesResponse.services || []));
            toast.success('Service deleted successfully');
        } catch (error) {
            setErrorMessage('Failed to delete service. Please try again.');
            toast.error('Failed to delete service');
        }
    };

    // Handler for assigning the initial default tax rate
    const handleAssignDefaultTaxRate = async (taxRateId: string) => {
        if (!taxRateId) return;
        try {
            const newClientTaxRateData: Pick<IClientTaxRateAssociation, 'client_id' | 'tax_rate_id'> = {
                client_id: client.client_id,
                tax_rate_id: taxRateId
            };
            // Call the action which now enforces single default
            await addClientTaxRate(newClientTaxRateData);
            // Refetch client tax rates to update the UI
            const updatedClientTaxRates = await getClientTaxRates(client.client_id);
            setClientTaxRates(updatedClientTaxRates);
            setErrorMessage(null); // Clear any previous errors
            toast.success('Default tax rate assigned successfully');
        } catch (error: any) {
            console.error('Failed to assign default tax rate:', error);
            // Set specific error message from the action if available
            setErrorMessage(error.message || 'Failed to assign default tax rate. Please try again.');
            toast.error(error.message || 'Failed to assign default tax rate');
            // Re-throw or handle as needed if parent component needs to know
            throw error;
        }
    };

    // Handler for changing the default tax rate
    const handleChangeDefaultTaxRate = async (newTaxRateId: string) => {
        if (!newTaxRateId) return;
        try {
            // Use the imported updateDefaultClientTaxRate action
            await updateDefaultClientTaxRate(client.client_id, newTaxRateId);
            // Refetch client tax rates to update the UI
            const updatedClientTaxRates = await getClientTaxRates(client.client_id);
            setClientTaxRates(updatedClientTaxRates);
            setErrorMessage(null); // Clear any previous errors
            toast.success('Default tax rate changed successfully');
        } catch (error: any) {
            console.error('Failed to change default tax rate:', error);
            setErrorMessage(error.message || 'Failed to change default tax rate. Please try again.');
            toast.error(error.message || 'Failed to change default tax rate');
            throw error; // Re-throw so the child component knows it failed
        }
    };

    // Handler to refetch tax rates when a new one is created in the child component
    const handleTaxRateCreated = async () => {
        try {
            const updatedTaxRates = await getTaxRates();
            setTaxRates(updatedTaxRates);
            toast.success('Tax rate created successfully');
        } catch (error) {
            console.error('Failed to refetch tax rates after creation:', error);
            setErrorMessage('Failed to refresh tax rates list.');
            toast.error('Failed to refresh tax rates list');
        }
    };

    // Removed handleAddClientTaxRate and handleRemoveClientTaxRate as ClientTaxRates now only displays the default rate

    // Displays a 'YYYY-MM-DD' string in a user-friendly format, treating it as UTC

    // Displays a 'YYYY-MM-DD' string in a user-friendly format, treating it as UTC
    const formatDateForDisplay = (dateString: string | null): string => {
        if (!dateString) return 'N/A';

        // Parse YYYY-MM-DD string reliably, treating components as UTC date parts
        const parts = dateString.split('-');
        if (parts.length !== 3) return 'Invalid Date Format';

        try {
            // Construct date using UTC values to avoid timezone shifts during parsing
            const year = parseInt(parts[0]);
            const month = parseInt(parts[1]) - 1; // Month is 0-indexed
            const day = parseInt(parts[2]);
            const d = new Date(Date.UTC(year, month, day));

            if (isNaN(d.getTime())) {
                return 'Invalid Date';
            }

            // Format the date using toLocaleDateString, specifying UTC timezone
            // This ensures the displayed date matches the UTC date components
            return d.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                timeZone: 'UTC' // Specify UTC timezone for consistent display
            });
        } catch (error) {
            console.error("Error formatting date for display:", error);
            return 'Formatting Error';
        }
    };

    // Removed billingTabs and billingTabStyles as they're no longer needed

    return (
        <form onSubmit={handleSubmit}>
            {errorMessage && (
                <Dialog
                    id="billing-config-error"
                    title="Error"
                    isOpen={!!errorMessage}
                    onClose={() => setErrorMessage(null)}
                    draggable={false}
                >
                    <div className="space-y-4">
                        <p className="text-sm text-red-600">{errorMessage}</p>
                        <div className="flex justify-end">
                            <Button
                                id="close-error-dialog-btn"
                                onClick={() => setErrorMessage(null)}
                                variant="secondary"
                            >
                                Close
                            </Button>
                        </div>
                    </div>
                </Dialog>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="mb-4">
                    <TabsTrigger value="general">General</TabsTrigger>
                    <TabsTrigger value="plans">Contract Lines</TabsTrigger>
                    <TabsTrigger value="taxRates">Tax Rates</TabsTrigger>
                    <TabsTrigger value="overlaps">Contract Line Overlaps</TabsTrigger>
                </TabsList>
                <TabsContent value="general">
                    <BillingConfigForm
                        billingConfig={billingConfig} // Pass the whole config including region_code
                        handleSelectChange={handleSelectChange}
                        contacts={contacts}
                        clientId={client.client_id}
                    />

                    <ClientBillingSchedule clientId={client.client_id} />

                    <ClientZeroDollarInvoiceSettings
                        clientId={client.client_id}
                    />

                    <ClientCreditExpirationSettings
                        clientId={client.client_id}
                    />
                    
                    <div className="flex justify-end">
                        <Button
                            id="save-billing-config-btn"
                            type="submit"
                            variant="default"
                        >
                            Save Billing Configuration
                        </Button>
                    </div>
                </TabsContent>

                <TabsContent value="plans" className="space-y-6"> {/* Added space-y for layout */}
                    {/* Added ClientContractAssignment component */}
                    <ClientContractAssignment clientId={client.client_id} />

                    {/* Existing ContractLines component */}
                    <ContractLines
                        clientContractLines={clientContractLines}
                        contractLines={contractLines}
                        serviceCategories={serviceCategories}
                        clientId={client.client_id}
                        onEdit={handleEditContractLine}
                        onDelete={handleRemoveContractLine}
                        onAdd={handleAddContractLine}
                        onClientPlanChange={handleClientPlanChange}
                        onServiceCategoryChange={handleServiceCategoryChange}
                        formatDateForDisplay={formatDateForDisplay}
                    />
                </TabsContent>

                <TabsContent value="taxRates">
                    {/* Updated props for ClientTaxRates to pass only the single default rate */}
                    <ClientTaxRates
                        clientId={client.client_id}
                        clientTaxRate={clientTaxRates.find(ctr => ctr.is_default) || null} // Pass only the default rate or null
                        taxRates={taxRates} // Pass all available rates for the dropdown
                        onAssignDefault={handleAssignDefaultTaxRate} // Pass the assign handler
                        onChangeDefault={handleChangeDefaultTaxRate} // Pass the change handler
                        onTaxRateCreated={handleTaxRateCreated} // Pass the refresh handler
                    />
                </TabsContent>

                <TabsContent value="overlaps">
                    <div className="space-y-6">
                        <ClientServiceOverlapMatrix
                            clientId={client.client_id}
                            clientContractLines={clientContractLines}
                            services={services}
                            onEdit={handleEditContractLine}
                            className="mb-6"
                        />

                        <ClientPlanDisambiguationGuide className="mb-6" />
                    </div>
                </TabsContent>
            </Tabs>

            {editingContractLine && (
                <PlanPickerDialog
                    isOpen={!!editingContractLine}
                    onClose={() => setEditingContractLine(null)}
                    onSelect={(plan: IContractLine, serviceCategory: string | undefined, startDate: string, endDate: string | null) => {
                        if (editingContractLine) {
                            const updatedPlan = {
                                ...editingContractLine,
                                contract_line_id: plan.contract_line_id!,
                                service_category: serviceCategory,
                                start_date: startDate,
                                end_date: endDate
                            };
                            // Don't update the state here, pass directly to save function
                            // setEditingContractLine(updatedPlan);
                            handleSaveEditContractLine(updatedPlan);
                        }
                    }}
                    availablePlans={contractLines}
                    serviceCategories={serviceCategories}
                    initialValues={{
                        planId: editingContractLine.contract_line_id,
                        categoryId: editingContractLine.service_category || '',
                        startDate: editingContractLine.start_date,
                        endDate: editingContractLine.end_date,
                        ongoing: !editingContractLine.end_date
                    }}
                />
            )}

            <ConfirmationDialog
                isOpen={!!contractLineToDelete}
                onClose={() => setContractLineToDelete(null)}
                onConfirm={confirmRemoveContractLine}
                title="Remove Contract Line Assignment"
                message="Are you sure you want to remove this contract line assignment from the client? The contract line itself will not be deleted."
            />

        </form>
    );
};

export default BillingConfiguration;

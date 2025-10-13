'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from 'server/src/components/ui/Table';
import { Search, Plus, Check } from 'lucide-react';
import { IService } from 'server/src/interfaces/billing.interfaces';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { addServiceToContractLine } from 'server/src/lib/actions/contractLineServiceActions';

interface ServiceSelectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  planId: string;
  onServiceAdded?: () => void;
  existingServiceIds?: string[];
}

export function ServiceSelectionDialog({ 
  isOpen, 
  onClose, 
  planId,
  onServiceAdded,
  existingServiceIds = []
}: ServiceSelectionDialogProps) {
  const [services, setServices] = useState<IService[]>([]);
  const [filteredServices, setFilteredServices] = useState<IService[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  // Fetch services when dialog opens
  useEffect(() => {
    const fetchServices = async () => {
      if (!isOpen) return;
      
      try {
        setLoading(true);
        setError(null);
        
        const servicesResponse = await getServices();
        
        // Extract the services array from the paginated response
        const servicesData = Array.isArray(servicesResponse)
          ? servicesResponse
          : (servicesResponse.services || []);
        
        // Filter out services that are already in the plan
        const availableServices = servicesData.filter(
          service => !existingServiceIds.includes(service.service_id)
        );
        
        setServices(availableServices);
        setFilteredServices(availableServices);
      } catch (err) {
        console.error('Error fetching services:', err);
        setError('Failed to load services');
      } finally {
        setLoading(false);
      }
    };

    fetchServices();
  }, [isOpen, existingServiceIds]);

  // Get unique categories from services
  const categories = React.useMemo(() => {
    const uniqueCategories = new Set<string>();
    
    services.forEach(service => {
      if (service.category_id) {
        uniqueCategories.add(service.category_id);
      }
    });
    
    return Array.from(uniqueCategories);
  }, [services]);

  // Filter services based on search query and selected category
  useEffect(() => {
    let filtered = services;
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(service =>
        service.service_name.toLowerCase().includes(query) ||
        (service.service_type_name || '').toLowerCase().includes(query) ||
        service.unit_of_measure.toLowerCase().includes(query)
      );
    }
    
    if (selectedCategory) {
      filtered = filtered.filter(service => service.category_id === selectedCategory);
    }
    
    setFilteredServices(filtered);
  }, [searchQuery, selectedCategory, services]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleCategorySelect = (categoryId: string | null) => {
    setSelectedCategory(categoryId === selectedCategory ? null : categoryId);
  };

  const toggleServiceSelection = (serviceId: string) => {
    setSelectedServices(prev => {
      if (prev.includes(serviceId)) {
        return prev.filter(id => id !== serviceId);
      } else {
        return [...prev, serviceId];
      }
    });
  };

  const handleAddServices = async () => {
    if (selectedServices.length === 0) return;
    
    try {
      setAdding(true);
      setError(null);
      
      // Add each selected service to the plan
      for (const serviceId of selectedServices) {
        await addServiceToContractLine(
          planId,
          serviceId
        );
      }
      
      if (onServiceAdded) {
        onServiceAdded();
      }
      
      onClose();
    } catch (err) {
      console.error('Error adding services to plan:', err);
      setError('Failed to add services to plan');
    } finally {
      setAdding(false);
    }
  };

  // Group services by type for quick selection
  const serviceTypes = React.useMemo(() => {
    const types = new Set<string>();
    services.forEach(service => {
      if (service.service_type_name) types.add(service.service_type_name);
    });
    return Array.from(types);
  }, [services]);

  return (
    <Dialog 
      isOpen={isOpen} 
      onClose={onClose} 
      id="service-selection-dialog" 
      title="Add Services to Plan"
    >
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        
        <div className="flex flex-col space-y-4 overflow-hidden">
          {/* Search and filters */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                id="service-search-input"
                placeholder="Search services..."
                className="pl-10"
                value={searchQuery}
                onChange={handleSearchChange}
              />
            </div>
            
            <div className="flex flex-wrap gap-2">
              {serviceTypes.map(type => (
                <Button
                  key={type}
                  id={`filter-${type.toLowerCase()}-button`}
                  variant={selectedCategory === type ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleCategorySelect(type)}
                >
                  {type}
                </Button>
              ))}
            </div>
          </div>
          
          {/* Service list */}
          <div className="overflow-auto flex-1 border rounded-md">
            {loading ? (
              <div className="flex justify-center items-center h-40">
                <p className="text-gray-500">Loading services...</p>
              </div>
            ) : error ? (
              <div className="flex justify-center items-center h-40">
                <p className="text-red-500">{error}</p>
              </div>
            ) : filteredServices.length === 0 ? (
              <div className="flex justify-center items-center h-40">
                <p className="text-gray-500">No services found</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]"></TableHead>
                    <TableHead>Service Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredServices.map(service => (
                    <TableRow 
                      key={service.service_id}
                      className={selectedServices.includes(service.service_id) ? "bg-blue-50" : ""}
                      onClick={() => toggleServiceSelection(service.service_id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <TableCell>
                        <div className="flex items-center justify-center h-5 w-5 rounded-full border border-gray-300 bg-white">
                          {selectedServices.includes(service.service_id) && (
                            <Check className="h-3 w-3 text-blue-600" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{service.service_name}</TableCell>
                      <TableCell>{service.service_type_name || 'Unknown'}</TableCell>
                      <TableCell>{service.unit_of_measure}</TableCell>
                      <TableCell>${service.default_rate}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          
          {/* Quick add section */}
          <div className="flex flex-wrap gap-2 p-3 bg-gray-50 rounded-md">
            <span className="text-sm font-medium text-gray-700 mr-2">Quick Add:</span>
            {serviceTypes.map(type => (
              <Button
                key={`quick-add-${type}`}
                id={`quick-add-${type.toLowerCase()}-button`}
                variant="soft"
                size="sm"
                className="flex items-center gap-1"
                onClick={() => {
                  // Find all services of this type and select them
                  const serviceIdsOfType = services
                    .filter(s => s.service_type_name === type)
                    .map(s => s.service_id);
                  
                  setSelectedServices(prev => {
                    const newSelection = [...prev];
                    
                    serviceIdsOfType.forEach(id => {
                      if (!newSelection.includes(id)) {
                        newSelection.push(id);
                      }
                    });
                    
                    return newSelection;
                  });
                }}
              >
                <Plus className="h-3 w-3" />
                All {type}
              </Button>
            ))}
          </div>
        </div>
        
        <div className="mt-4">
          <div className="flex justify-between w-full">
            <div>
              {selectedServices.length > 0 && (
                <span className="text-sm text-gray-600">
                  {selectedServices.length} service{selectedServices.length !== 1 ? 's' : ''} selected
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                id="cancel-service-selection-button"
                variant="outline"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                id="add-selected-services-button"
                onClick={handleAddServices}
                disabled={selectedServices.length === 0 || adding}
              >
                {adding ? 'Adding...' : 'Add Selected Services'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

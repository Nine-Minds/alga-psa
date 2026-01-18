'use client'
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader } from '@alga-psa/ui/components/Card';
import { Filter, Plus, RefreshCw } from 'lucide-react';
import InteractionIcon from '@alga-psa/ui/components/InteractionIcon';
import { IInteraction, IInteractionType } from 'server/src/interfaces/interaction.interfaces';
import { QuickAddInteraction } from './QuickAddInteraction';
import { getInteractionsForEntity, getInteractionById } from 'server/src/lib/actions/interactionActions';
import { getAllInteractionTypes } from 'server/src/lib/actions/interactionTypeActions';
import { useDrawer } from 'server/src/context/DrawerContext';
import { InteractionDetails } from '@alga-psa/clients/components';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { ButtonComponent, FormFieldComponent, ContainerComponent } from '@alga-psa/ui/ui-reflection/types';

interface InteractionsFeedProps {
  id?: string; // Made optional to maintain backward compatibility
  entityId: string;
  entityType: 'contact' | 'client';
  clientId?: string;
  interactions: IInteraction[];
  setInteractions: React.Dispatch<React.SetStateAction<IInteraction[]>>;
}


const InteractionsFeed: React.FC<InteractionsFeedProps> = ({ 
  id = 'interactions-feed',
  entityId, 
  entityType, 
  clientId, 
  interactions, 
  setInteractions 
}) => {
  const { openDrawer } = useDrawer();
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [interactionTypes, setInteractionTypes] = useState<IInteractionType[]>([]);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);

  // UI Reflection System Integration
  const { automationIdProps: titleProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: `${id}-title`,
    type: 'container',
    label: 'Interactions Title',
    helperText: 'Main heading for the interactions section'
  });

  const { automationIdProps: addButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `${id}-add-button`,
    type: 'button',
    label: 'Add Interaction',
    helperText: 'Opens dialog to create a new interaction'
  });

  const { automationIdProps: searchInputProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-search-input`,
    type: 'formField',
    fieldType: 'textField',
    label: 'Search Interactions',
    helperText: 'Search interactions by title or type'
  });

  const { automationIdProps: filterButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `${id}-filter-button`,
    type: 'button',
    label: 'Filter Interactions',
    helperText: 'Opens filter dialog to narrow down interactions'
  });

  const { automationIdProps: typeFilterProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-type-filter`,
    type: 'formField',
    fieldType: 'select',
    label: 'Filter by Type',
    helperText: 'Filter interactions by their type'
  });

  const { automationIdProps: startDateProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-start-date`,
    type: 'formField',
    fieldType: 'textField',
    label: 'Start Date Filter',
    helperText: 'Filter interactions from this date'
  });

  const { automationIdProps: endDateProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-end-date`,
    type: 'formField',
    fieldType: 'textField',
    label: 'End Date Filter',
    helperText: 'Filter interactions until this date'
  });

  const { automationIdProps: resetButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `${id}-reset-button`,
    type: 'button',
    label: 'Reset Filters',
    helperText: 'Clear all applied filters'
  });

  const { automationIdProps: applyButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `${id}-apply-button`,
    type: 'button',
    label: 'Apply Filters',
    helperText: 'Apply the selected filters'
  });

  useEffect(() => {
    fetchInteractions();
    fetchInteractionTypes();
  }, [entityId, entityType]);

  const fetchInteractions = async () => {
    const fetchedInteractions = await getInteractionsForEntity(entityId, entityType);
    setInteractions(fetchedInteractions);
  };

  const fetchInteractionTypes = async () => {
    try {
      const types = await getAllInteractionTypes();
      // Sort to ensure system types appear first
      const sortedTypes = types.sort((a, b) => {
        // If both are system types or both are tenant types, sort by name
        if (('created_at' in a) === ('created_at' in b)) {
          return a.type_name.localeCompare(b.type_name);
        }
        // System types ('created_at' exists) come first
        return 'created_at' in a ? -1 : 1;
      });
      setInteractionTypes(sortedTypes);
    } catch (error) {
      console.error('Error fetching interaction types:', error);
    }
  };

  const getTypeLabel = (type: IInteractionType) => {
    return (
      <div className="flex items-center gap-2">
        <InteractionIcon icon={type.icon} typeName={type.type_name} />
        <span>{type.type_name}</span>
      </div>
    );
  };

  const filteredInteractions = useMemo(() => {
    return interactions.filter(interaction =>
      (interaction.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
       interaction.type_name.toLowerCase().includes(searchTerm.toLowerCase())) &&
      (selectedType === 'all' || selectedType === '' || interaction.type_id === selectedType) &&
      (!startDate || new Date(interaction.interaction_date) >= new Date(startDate)) &&
      (!endDate || new Date(interaction.interaction_date) <= new Date(endDate))
    );
  }, [interactions, searchTerm, selectedType, startDate, endDate]);

  const handleInteractionAdded = (newInteraction: IInteraction) => {
    setInteractions([newInteraction, ...interactions]);
    setIsQuickAddOpen(false);
  };

  const handleInteractionDeleted = useCallback((deletedInteractionId: string) => {
    // Remove the deleted interaction from the list
    setInteractions(prevInteractions => 
      prevInteractions.filter(i => i.interaction_id !== deletedInteractionId)
    );
  }, [setInteractions]);

  const handleInteractionUpdated = useCallback((updatedInteraction: IInteraction) => {
    // Update the interaction in the list
    setInteractions(prevInteractions => 
      prevInteractions.map(i => 
        i.interaction_id === updatedInteraction.interaction_id ? updatedInteraction : i
      )
    );
  }, [setInteractions]);

  const handleInteractionClick = useCallback((interaction: IInteraction) => {
    openDrawer(
      <InteractionDetails 
        interaction={interaction} 
        onInteractionDeleted={() => handleInteractionDeleted(interaction.interaction_id)}
        onInteractionUpdated={handleInteractionUpdated}
      />,
      async () => {
        try {
          // Check if interaction still exists (in case it was edited)
          const updatedInteraction = await getInteractionById(interaction.interaction_id);
          setInteractions(prevInteractions => 
            prevInteractions.map((i): IInteraction => 
              i.interaction_id === updatedInteraction.interaction_id ? updatedInteraction : i
            )
          );
        } catch (error) {
          // If interaction doesn't exist (was deleted), don't treat it as an error
          console.log('Interaction no longer exists (likely deleted)');
        }
      }
    );
  }, [openDrawer, setInteractions, handleInteractionDeleted, handleInteractionUpdated]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const resetFilters = () => {
    setSelectedType('all');
    setStartDate('');
    setEndDate('');
  };

  const handleApplyFilters = () => {
    setIsFilterDialogOpen(false);
  };

  return (
    <ReflectionContainer id={id} label="Interactions Feed">
      <Card className="w-full max-w-2xl">
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 {...titleProps} className="text-2xl font-bold">
              Interactions
            </h2>
            <Button 
              {...addButtonProps}
              onClick={() => setIsQuickAddOpen(true)} 
              size="default"
              variant="default"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Interaction
            </Button>
          </div>
          <div className="flex flex-wrap gap-4 mb-4">
            <Input
              {...searchInputProps}
              type="text"
              value={searchTerm}
              onChange={handleSearchChange}
              placeholder="Search interactions"
              className="flex-grow"
            />
            <Button 
              {...filterButtonProps}
              onClick={() => setIsFilterDialogOpen(true)} 
              variant="outline"
              size="default"
              className="flex items-center gap-2"
            >
              <Filter className="h-4 w-4" />
              Filter
            </Button>
          </div>
        </div>
        <CardContent>
          <ul className="space-y-2">
            {filteredInteractions.map((interaction): React.JSX.Element => (
              <li 
                key={interaction.interaction_id} 
                data-automation-id={`${id}-interaction-${interaction.interaction_id}`}
                className="flex items-start space-x-3 p-4 hover:bg-gray-50 rounded-lg cursor-pointer border-b border-gray-200 last:border-b-0"
                onClick={() => handleInteractionClick(interaction)}
              >
                <div className="flex-shrink-0">
                  <InteractionIcon icon={interaction.icon} typeName={interaction.type_name} />
                </div>
                <div className="flex-grow">
                  <p className="font-semibold">{interaction.title}</p>
                  <p className="text-sm text-gray-500">{new Date(interaction.interaction_date).toLocaleString()}</p>
                  {interaction.status_name && (
                    <p className="text-xs text-gray-600">{interaction.status_name}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Dialog 
        isOpen={isFilterDialogOpen} 
        onClose={() => setIsFilterDialogOpen(false)} 
        title="Filter Interactions"
      >
        <DialogContent>
          <div className="space-y-4">
            <CustomSelect
              {...typeFilterProps}
              options={[
                { value: 'all', label: 'All Types' },
                ...interactionTypes.map((type) => ({
                  value: type.type_id,
                  label: getTypeLabel(type)
                }))
              ]}
              value={selectedType}
              onValueChange={setSelectedType}
              placeholder="Interaction Type"
            />
            <Input
              {...startDateProps}
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              placeholder="Start Date"
            />
            <Input
              {...endDateProps}
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              placeholder="End Date"
            />
            <div className="flex justify-between">
              <Button 
                {...resetButtonProps}
                onClick={resetFilters} 
                variant="outline" 
                className="flex items-center"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Reset Filters
              </Button>
              <Button 
                {...applyButtonProps}
                onClick={handleApplyFilters}
              >
                Apply Filters
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <QuickAddInteraction
        id={`${id}-quick-add`}
        isOpen={isQuickAddOpen}
        onClose={() => setIsQuickAddOpen(false)}
        entityId={entityId}
        entityType={entityType}
        clientId={clientId}
        onInteractionAdded={handleInteractionAdded}
      />
    </ReflectionContainer>
  );
};

export default InteractionsFeed;

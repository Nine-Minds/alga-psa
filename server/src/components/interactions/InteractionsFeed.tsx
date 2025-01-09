'use client'
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Calendar, Phone, Mail, FileText, CheckSquare, Filter, RefreshCw } from 'lucide-react';
import { IInteraction, IInteractionType, ISystemInteractionType } from '../../interfaces/interaction.interfaces';
import { QuickAddInteraction } from './QuickAddInteraction';
import { getInteractionsForEntity, getInteractionById } from '../../lib/actions/interactionActions';
import { getAllInteractionTypes } from '../../lib/actions/interactionTypeActions';
import { useDrawer } from '../../context/DrawerContext';
import InteractionDetails from './InteractionDetails';
import CustomSelect from '../ui/CustomSelect';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/Dialog';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { ButtonComponent, FormFieldComponent, ContainerComponent } from '../../types/ui-reflection/types';

interface InteractionsFeedProps {
  id?: string; // Made optional to maintain backward compatibility
  entityId: string;
  entityType: 'contact' | 'company';
  companyId?: string;
  interactions: IInteraction[];
  setInteractions: React.Dispatch<React.SetStateAction<IInteraction[]>>;
}

const InteractionIcon = ({ type }: { type: string }) => {
  const lowerType = type.toLowerCase();
  switch (lowerType) {
    case 'call': return <Phone className="text-gray-500" />;
    case 'email': return <Mail className="text-gray-500" />;
    case 'meeting': return <Calendar className="text-gray-500" />;
    case 'note': return <FileText className="text-gray-500" />;
    case 'task': return <CheckSquare className="text-gray-500" />;
    default: return <FileText className="text-gray-500" />; // Default to note icon
  }
};

const InteractionsFeed: React.FC<InteractionsFeedProps> = ({ 
  id = 'interactions-feed',
  entityId, 
  entityType, 
  companyId, 
  interactions, 
  setInteractions 
}) => {
  const { openDrawer } = useDrawer();
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [interactionTypes, setInteractionTypes] = useState<(IInteractionType | ISystemInteractionType)[]>([]);
  const [selectedType, setSelectedType] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);

  // Register all components with UI reflection system
  const { automationIdProps: titleProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: `${id}-title`,
    type: 'container',
    label: 'Interactions Title'
  });

  const { automationIdProps: addButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `${id}-add-btn`,
    type: 'button',
    label: 'Add Interaction',
    actions: ['click']
  });

  const { automationIdProps: searchProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-search`,
    type: 'formField',
    fieldType: 'textField',
    label: 'Search Interactions',
    value: searchTerm
  });

  const { automationIdProps: filterButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `${id}-filter-btn`,
    type: 'button',
    label: 'Filter',
    actions: ['click']
  });

  const { automationIdProps: listProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: `${id}-list`,
    type: 'container',
    label: 'Interactions List'
  });

  const { automationIdProps: typeSelectProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-type-select`,
    type: 'formField',
    fieldType: 'select',
    label: 'Interaction Type',
    value: selectedType
  });

  const { automationIdProps: startDateProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-start-date`,
    type: 'formField',
    fieldType: 'textField',
    label: 'Start Date',
    value: startDate
  });

  const { automationIdProps: endDateProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-end-date`,
    type: 'formField',
    fieldType: 'textField',
    label: 'End Date',
    value: endDate
  });

  const { automationIdProps: resetButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `${id}-reset-btn`,
    type: 'button',
    label: 'Reset Filters',
    actions: ['click']
  });

  const { automationIdProps: applyButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `${id}-apply-btn`,
    type: 'button',
    label: 'Apply Filters',
    actions: ['click']
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

  const getTypeLabel = (type: IInteractionType | ISystemInteractionType) => {
    if ('created_at' in type) {
      // It's a system type
      return `${type.type_name} (System)`;
    }
    if (type.system_type_id) {
      // It's a tenant type that inherits from a system type
      return `${type.type_name} (Custom)`;
    }
    return type.type_name;
  };

  const filteredInteractions = useMemo(() => {
    return interactions.filter(interaction =>
      (interaction.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
       interaction.type_name.toLowerCase().includes(searchTerm.toLowerCase())) &&
      (selectedType === '' || interaction.type_id === selectedType) &&
      (!startDate || new Date(interaction.interaction_date) >= new Date(startDate)) &&
      (!endDate || new Date(interaction.interaction_date) <= new Date(endDate))
    );
  }, [interactions, searchTerm, selectedType, startDate, endDate]);

  const handleInteractionAdded = (newInteraction: IInteraction) => {
    setInteractions([newInteraction, ...interactions]);
    setIsQuickAddOpen(false);
  };

  const handleInteractionClick = useCallback((interaction: IInteraction) => {
    openDrawer(
      <InteractionDetails interaction={interaction} />,
      async () => {
        try {
          const updatedInteraction = await getInteractionById(interaction.interaction_id);
          setInteractions(prevInteractions => 
            prevInteractions.map((i): IInteraction => 
              i.interaction_id === updatedInteraction.interaction_id ? updatedInteraction : i
            )
          );
        } catch (error) {
          console.error('Error fetching updated interaction:', error);
        }
      }
    );
  }, [openDrawer, setInteractions]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const resetFilters = () => {
    setSelectedType('');
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
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              Add Interaction
            </Button>
          </div>
          <div className="flex flex-wrap gap-4 mb-4">
            <Input
              {...searchProps}
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
          <ul {...listProps} className="space-y-2">
            {filteredInteractions.map((interaction): JSX.Element => (
              <li 
                key={interaction.interaction_id} 
                data-automation-id={`${id}-interaction-${interaction.interaction_id}`}
                className="flex items-start space-x-3 p-4 hover:bg-gray-50 rounded-lg cursor-pointer border-b border-gray-200 last:border-b-0"
                onClick={() => handleInteractionClick(interaction)}
              >
                <div className="flex-shrink-0">
                  <InteractionIcon type={interaction.type_name} />
                </div>
                <div className="flex-grow">
                  <p className="font-semibold">{interaction.description}</p>
                  <p className="text-sm text-gray-500">{new Date(interaction.interaction_date).toLocaleString()}</p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Dialog isOpen={isFilterDialogOpen} onClose={() => setIsFilterDialogOpen(false)}>
        <DialogHeader>
          <DialogTitle>Filter Interactions</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <CustomSelect
              {...typeSelectProps}
              options={[
                { value: '', label: 'All Types' },
                ...interactionTypes.map((type): { value: string; label: string } => ({
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
        companyId={companyId}
        onInteractionAdded={handleInteractionAdded}
      />
    </ReflectionContainer>
  );
};

export default InteractionsFeed;

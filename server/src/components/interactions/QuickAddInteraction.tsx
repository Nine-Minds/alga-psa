// server/src/components/interactions/QuickAddInteraction.tsx
'use client'

import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '../ui/Button';
import CustomSelect from '../ui/CustomSelect';
import { Input } from '../ui/Input';
import { addInteraction, getInteractionById } from '../../lib/actions/interactionActions';
import { getAllInteractionTypes } from '../../lib/actions/interactionTypeActions';
import { IInteraction, IInteractionType, ISystemInteractionType } from '../../interfaces/interaction.interfaces';
import { useTenant } from '../TenantProvider';
import { useSession } from 'next-auth/react';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { ButtonComponent, FormFieldComponent, ContainerComponent } from '../../types/ui-reflection/types';

interface QuickAddInteractionProps {
  id?: string; // Made optional to maintain backward compatibility
  entityId: string;
  entityType: 'contact' | 'company';
  companyId?: string;
  onInteractionAdded: (newInteraction: IInteraction) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function QuickAddInteraction({ 
  id = 'quick-add-interaction',
  entityId, 
  entityType, 
  companyId, 
  onInteractionAdded, 
  isOpen, 
  onClose 
}: QuickAddInteractionProps) {
  const [description, setDescription] = useState('');
  const [typeId, setTypeId] = useState('');
  const [duration, setDuration] = useState('');
  const [interactionTypes, setInteractionTypes] = useState<(IInteractionType | ISystemInteractionType)[]>([]);
  const tenant = useTenant()!;
  const { data: session } = useSession();

  useEffect(() => {
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

    fetchInteractionTypes();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id) {
      console.error('User not authenticated');
      return;
    }
  
    try {
      const interactionData: Partial<IInteraction> = {
        description,
        type_id: typeId,
        duration: duration ? parseInt(duration, 10) : null,
        user_id: session.user.id,
        tenant: tenant
      };
  
      if (entityType === 'contact') {
        interactionData.contact_name_id = entityId;
        interactionData.company_id = companyId;
      } else {
        interactionData.company_id = entityId;
      }
  
      console.log('Interaction data being sent:', interactionData);
  
      const newInteraction = await addInteraction(interactionData as Omit<IInteraction, 'interaction_date'>);
      console.log('New interaction received:', newInteraction);
      
      // Fetch the complete interaction data
      const fullInteraction = await getInteractionById(newInteraction.interaction_id);
      
      onInteractionAdded(fullInteraction);
      onClose();
      // Clear form fields
      setDescription('');
      setTypeId('');
      setDuration('');
    } catch (error) {
      console.error('Error adding interaction:', error);
      // Handle error (e.g., show error message to user)  
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

  return (
    <ReflectionContainer id={id} label="Quick Add Interaction">
      <Dialog.Root open={isOpen} onOpenChange={onClose}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg w-96">
            <Dialog.Title className="text-lg font-bold mb-4">
              Add New Interaction
            </Dialog.Title>
            <form onSubmit={handleSubmit} className="space-y-4">
              <CustomSelect
                options={interactionTypes.map((type): { value: string; label: string } => ({ 
                  value: type.type_id, 
                  label: getTypeLabel(type)
                }))}
                value={typeId}
                onValueChange={setTypeId}
                placeholder="Select Interaction Type"
                className="w-full"
              />
              <Input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description"
                required
              />
              <Input
                type="number"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="Duration (minutes)"
              />
              <Button 
                id="save-interaction-button"
                type="submit" 
                className="w-full"
              >
                Save Interaction
              </Button>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ReflectionContainer>
  );
}

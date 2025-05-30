// server/src/components/interactions/QuickAddInteraction.tsx
'use client'

import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Input } from 'server/src/components/ui/Input';
import TextEditor from '../editor/TextEditor';
import { PartialBlock } from '@blocknote/core';
import InteractionIcon from 'server/src/components/ui/InteractionIcon';
import { addInteraction, getInteractionById, getInteractionStatuses } from 'server/src/lib/actions/interactionActions';
import { getAllInteractionTypes } from 'server/src/lib/actions/interactionTypeActions';
import { IInteraction, IInteractionType, ISystemInteractionType } from 'server/src/interfaces/interaction.interfaces';
import { useTenant } from 'server/src/components/TenantProvider';
import { useSession } from 'next-auth/react';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { ButtonComponent, FormFieldComponent, ContainerComponent } from 'server/src/types/ui-reflection/types';

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
  const [title, setTitle] = useState('');
  const [notesContent, setNotesContent] = useState<PartialBlock[]>([]);
  const [typeId, setTypeId] = useState('');
  const [duration, setDuration] = useState('');
  const [statusId, setStatusId] = useState('');
  const [interactionTypes, setInteractionTypes] = useState<(IInteractionType | ISystemInteractionType)[]>([]);
  const [statuses, setStatuses] = useState<any[]>([]);
  const tenant = useTenant()!;
  const { data: session } = useSession();

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch interaction types
        const types = await getAllInteractionTypes();
        const sortedTypes = types.sort((a, b) => {
          if (('created_at' in a) === ('created_at' in b)) {
            return a.type_name.localeCompare(b.type_name);
          }
          return 'created_at' in a ? -1 : 1;
        });
        setInteractionTypes(sortedTypes);

        // Fetch interaction statuses
        const statusList = await getInteractionStatuses();
        setStatuses(statusList);
        
        // Set default status if available
        const defaultStatus = statusList.find(s => s.is_default);
        if (defaultStatus) {
          setStatusId(defaultStatus.status_id);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };

    fetchData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id) {
      console.error('User not authenticated');
      return;
    }
  
    try {
      const interactionData: Partial<IInteraction> = {
        title,
        notes: JSON.stringify(notesContent),
        type_id: typeId,
        duration: duration ? parseInt(duration, 10) : null,
        status_id: statusId,
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
      setTitle('');
      setNotesContent([]);
      setTypeId('');
      setStatusId('');
      setDuration('');
    } catch (error) {
      console.error('Error adding interaction:', error);
      // Handle error (e.g., show error message to user)  
    }
  };

  const getTypeLabel = (type: IInteractionType | ISystemInteractionType) => {
    const isSystemType = 'created_at' in type;
    const suffix = isSystemType ? ' (System)' : ' (Custom)';
    
    return (
      <div className="flex items-center gap-2">
        <InteractionIcon icon={type.icon} typeName={type.type_name} />
        <span>{type.type_name}{suffix}</span>
      </div>
    );
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
                options={interactionTypes.map((type) => ({ 
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
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                required
              />
              <CustomSelect
                options={statuses.map((status) => ({ 
                  value: status.status_id, 
                  label: status.name 
                }))}
                value={statusId}
                onValueChange={setStatusId}
                placeholder="Select Status"
                className="w-full"
              />
              <div className="space-y-2">
                <label className="text-sm font-medium">Notes</label>
                <div className="border rounded-md min-h-[120px]">
                  <TextEditor
                    id="interaction-notes-editor"
                    initialContent={notesContent}
                    onContentChange={setNotesContent}
                  />
                </div>
              </div>
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

// server/src/components/interactions/QuickAddInteraction.tsx
'use client'

import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Input } from 'server/src/components/ui/Input';
import TextEditor from '../editor/TextEditor';
import { DateTimePicker } from 'server/src/components/ui/DateTimePicker';
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
  const [startTime, setStartTime] = useState<Date | undefined>(undefined);
  const [endTime, setEndTime] = useState<Date | undefined>(undefined);
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
    
    // Set start time to current time when dialog opens
    if (isOpen && !startTime) {
      setStartTime(new Date());
    }
  }, [isOpen]);

  // Handle start time change
  const handleStartTimeChange = (date: Date) => {
    setStartTime(date);
    
    // If we have a duration, update end time accordingly
    if (duration && !isNaN(parseInt(duration))) {
      const durationMinutes = parseInt(duration);
      const newEndTime = new Date(date.getTime() + durationMinutes * 60000);
      setEndTime(newEndTime);
    }
  };

  // Handle end time change
  const handleEndTimeChange = (date: Date) => {
    setEndTime(date);
    
    // If we have a start time, calculate and update duration
    if (startTime) {
      const diffMilliseconds = date.getTime() - startTime.getTime();
      const diffMinutes = Math.round(diffMilliseconds / 60000);
      
      // Only update duration if the difference is positive
      if (diffMinutes >= 0) {
        setDuration(diffMinutes.toString());
      }
    }
  };

  // Handle duration change
  const handleDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDuration = e.target.value;
    setDuration(newDuration);
    
    // If we have a start time and valid duration, update end time
    if (startTime && newDuration && !isNaN(parseInt(newDuration))) {
      const durationMinutes = parseInt(newDuration);
      const newEndTime = new Date(startTime.getTime() + durationMinutes * 60000);
      setEndTime(newEndTime);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id) {
      console.error('User not authenticated');
      return;
    }

    if (!typeId) {
      alert('Please select an interaction type');
      return;
    }
  
    try {
      const interactionData: Partial<IInteraction> = {
        title,
        notes: JSON.stringify(notesContent),
        type_id: typeId,
        duration: duration ? parseInt(duration, 10) : null,
        start_time: startTime,
        end_time: endTime,
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
      setStartTime(undefined);
      setEndTime(undefined);
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
          <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
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
                placeholder="Select Interaction Type *"
                className="w-full"
                required
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
                <div className="border rounded-md min-h-[200px]">
                  <TextEditor
                    id="interaction-notes-editor"
                    initialContent={notesContent}
                    onContentChange={setNotesContent}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Start Time</label>
                  <DateTimePicker
                    id="interaction-start-time"
                    value={startTime}
                    onChange={handleStartTimeChange}
                    placeholder="Select start time"
                    label="Start Time"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">End Time</label>
                  <DateTimePicker
                    id="interaction-end-time"
                    value={endTime}
                    onChange={handleEndTimeChange}
                    placeholder="Select end time"
                    label="End Time"
                    minDate={startTime}
                  />
                </div>
              </div>
              <Input
                type="number"
                value={duration}
                onChange={handleDurationChange}
                placeholder="Duration (minutes)"
                min="0"
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

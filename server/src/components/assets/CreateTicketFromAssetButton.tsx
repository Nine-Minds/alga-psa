'use client';

import React, { useState } from 'react';
import { Asset } from 'server/src/interfaces/asset.interfaces';
import { Button } from 'server/src/components/ui/Button';
import { Dialog } from 'server/src/components/ui/Dialog';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { createTicketFromAsset } from '@product/actions/ticket-actions/ticketActions';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { useRegisterUIComponent } from 'server/src/types/ui-reflection/useRegisterUIComponent';
import { withDataAutomationId } from 'server/src/types/ui-reflection/withDataAutomationId';

interface CreateTicketFromAssetButtonProps {
    asset: Asset;
}

export default function CreateTicketFromAssetButton({ asset }: CreateTicketFromAssetButtonProps) {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [title, setTitle] = useState(`Issue with ${asset.name}`);
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const router = useRouter();

    const updateDialog = useRegisterUIComponent({
        id: 'create-ticket-dialog',
        type: 'dialog',
        label: 'Create Ticket from Asset',
        title: 'Create Ticket from Asset',
        open: isDialogOpen
    });

    const priorityOptions: SelectOption[] = [
        { value: 'high', label: 'High' },
        { value: 'medium', label: 'Medium' },
        { value: 'low', label: 'Low' }
    ];

    const handleSubmit = async () => {
        if (!title.trim() || !description.trim() || !priority) {
            toast.error('Please fill in all required fields');
            return;
        }

        setIsSubmitting(true);

        try {
            const currentUser = await getCurrentUser();
            if (!currentUser) {
                toast.error('No user session found');
                return;
            }

            const ticket = await createTicketFromAsset({
                title,
                description,
                priority_id: priority,
                asset_id: asset.asset_id,
                client_id: asset.client_id
            }, currentUser);

            toast.success('Ticket created successfully');
            setIsDialogOpen(false);
            
            // Navigate to the new ticket
            router.push(`/msp/tickets/${ticket.ticket_id}`);
        } catch (error) {
            console.error('Error creating ticket:', error);
            toast.error('Failed to create ticket');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
            <Button
                {...withDataAutomationId({ id: 'create-ticket-button' })}
                onClick={() => setIsDialogOpen(true)}
                variant="outline"
            >
                Create Ticket
            </Button>

            <Dialog
                {...withDataAutomationId({ id: 'create-ticket-dialog' })}
                isOpen={isDialogOpen}
                onClose={() => setIsDialogOpen(false)}
                title="Create Ticket from Asset"
            >
                <div {...withDataAutomationId({ id: 'create-ticket-form' })} className="space-y-4">
                    <Input
                        {...withDataAutomationId({ id: 'ticket-title-input' })}
                        label="Title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Enter ticket title"
                    />

                    <TextArea
                        {...withDataAutomationId({ id: 'ticket-description-input' })}
                        label="Description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Describe the issue..."
                        rows={4}
                    />

                    <CustomSelect
                        {...withDataAutomationId({ id: 'ticket-priority-select' })}
                        label="Priority"
                        options={priorityOptions}
                        value={priority}
                        onValueChange={setPriority}
                        placeholder="Select priority..."
                    />

                    <div {...withDataAutomationId({ id: 'ticket-form-actions' })} className="mt-4 flex justify-end space-x-2">
                        <Button
                            {...withDataAutomationId({ id: 'cancel-ticket-button' })}
                            variant="outline"
                            onClick={() => setIsDialogOpen(false)}
                            disabled={isSubmitting}
                        >
                            Cancel
                        </Button>
                        <Button
                            {...withDataAutomationId({ id: 'submit-ticket-button' })}
                            onClick={handleSubmit}
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? 'Creating...' : 'Create Ticket'}
                        </Button>
                    </div>
                </div>
            </Dialog>
        </>
    );
}

'use client';

import React, { useState, useEffect } from 'react';
import type { Asset, IBoard, IPriority, IStatus } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { getAllPriorities } from '@alga-psa/reference-data/actions';
import { getTicketStatuses } from '@alga-psa/reference-data/actions';
import { useAssetCrossFeature } from '../context/AssetCrossFeatureContext';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface CreateTicketFromAssetButtonProps {
    asset: Asset;
    defaultBoardId?: string;
    variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
    size?: 'default' | 'sm' | 'lg' | 'icon';
}

export default function CreateTicketFromAssetButton({ asset, defaultBoardId, variant = 'default', size = 'sm' }: CreateTicketFromAssetButtonProps) {
    const { t } = useTranslation('msp/assets');
    const { createTicketFromAsset, getAllBoards } = useAssetCrossFeature();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [title, setTitle] = useState(() => t('createTicketFromAssetButton.defaultTitle', {
        defaultValue: 'Issue with {{name}}',
        name: asset.name
    }));
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState('');
    const [status, setStatus] = useState('');
    const [board, setBoard] = useState(defaultBoardId || '');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [priorities, setPriorities] = useState<IPriority[]>([]);
    const [statuses, setStatuses] = useState<IStatus[]>([]);
    const [boards, setBoards] = useState<IBoard[]>([]);
    const [isLoadingPriorities, setIsLoadingPriorities] = useState(false);
    const [isLoadingStatuses, setIsLoadingStatuses] = useState(false);
    const [isLoadingBoards, setIsLoadingBoards] = useState(false);
    const router = useRouter();

    // Load priorities and boards when dialog opens.
    useEffect(() => {
        if (isDialogOpen) {
            if (priorities.length === 0) {
                setIsLoadingPriorities(true);
                getAllPriorities('ticket')
                    .then((fetchedPriorities) => {
                        setPriorities(fetchedPriorities);
                    })
                    .catch((error) => {
                        handleError(error, t('createTicketFromAssetButton.errors.loadPriorities', {
                            defaultValue: 'Failed to load priorities'
                        }));
                    })
                    .finally(() => {
                        setIsLoadingPriorities(false);
                    });
            }

            if (boards.length === 0) {
                setIsLoadingBoards(true);
                getAllBoards(false) // false = only active boards
                    .then((fetchedBoards) => {
                        setBoards(fetchedBoards);
                        // If defaultBoardId is set and valid, use it; otherwise select default board
                        if (!board) {
                            if (defaultBoardId && fetchedBoards.some(b => b.board_id === defaultBoardId)) {
                                setBoard(defaultBoardId);
                            } else {
                                const defaultBoard = fetchedBoards.find(b => b.is_default);
                                if (defaultBoard && defaultBoard.board_id) {
                                    setBoard(defaultBoard.board_id);
                                } else if (fetchedBoards.length > 0 && fetchedBoards[0].board_id) {
                                    setBoard(fetchedBoards[0].board_id);
                                }
                            }
                        }
                    })
                    .catch((error) => {
                        handleError(error, t('createTicketFromAssetButton.errors.loadBoards', {
                            defaultValue: 'Failed to load boards'
                        }));
                    })
                    .finally(() => {
                        setIsLoadingBoards(false);
                    });
            }
        }
    }, [isDialogOpen, priorities.length, boards.length, board, defaultBoardId, getAllBoards, t]);

    useEffect(() => {
        if (!isDialogOpen) {
            return;
        }

        if (!board) {
            setStatuses([]);
            setStatus('');
            setIsLoadingStatuses(false);
            return;
        }

        let cancelled = false;
        setIsLoadingStatuses(true);

        getTicketStatuses(board)
            .then((fetchedStatuses: IStatus[]) => {
                if (cancelled) {
                    return;
                }

                setStatuses(fetchedStatuses);
                setStatus((currentStatus) => {
                    if (currentStatus && fetchedStatuses.some((entry: IStatus) => entry.status_id === currentStatus)) {
                        return currentStatus;
                    }

                    const defaultStatus = fetchedStatuses.find((entry: IStatus) => entry.is_default);
                    return defaultStatus?.status_id ?? fetchedStatuses[0]?.status_id ?? '';
                });
            })
            .catch((error) => {
                if (!cancelled) {
                    setStatuses([]);
                    setStatus('');
                    handleError(error, t('createTicketFromAssetButton.errors.loadStatuses', {
                        defaultValue: 'Failed to load statuses'
                    }));
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setIsLoadingStatuses(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [isDialogOpen, board, t]);

    const priorityOptions: SelectOption[] = priorities.map((p) => ({
        value: p.priority_id,
        label: p.priority_name
    }));

    const statusOptions: SelectOption[] = statuses.map((s) => ({
        value: s.status_id,
        label: s.name
    }));

    const boardOptions: SelectOption[] = boards
        .filter((b): b is IBoard & { board_id: string; board_name: string } => Boolean(b.board_id && b.board_name))
        .map((b) => ({
            value: b.board_id,
            label: b.board_name
        }));

    const handleBoardChange = (nextBoardId: string) => {
        setBoard(nextBoardId);
        setStatus('');
    };

    const handleSubmit = async () => {
        if (!title.trim() || !priority || !status || !board) {
            toast.error(t('createTicketFromAssetButton.errors.requiredFields', {
                defaultValue: 'Please fill in title, board, status, and priority'
            }));
            return;
        }

        setIsSubmitting(true);

        try {
            const ticket = await createTicketFromAsset({
                title,
                description,
                priority_id: priority,
                status_id: status,
                board_id: board,
                asset_id: asset.asset_id,
                client_id: asset.client_id
            });

            toast.success(t('createTicketFromAssetButton.success.created', {
                defaultValue: 'Ticket created successfully'
            }));
            setIsDialogOpen(false);
            
            // Navigate to the new ticket
            router.push(`/msp/tickets/${ticket.ticket_id}`);
        } catch (error) {
            handleError(error, t('createTicketFromAssetButton.errors.createFailed', {
                defaultValue: 'Failed to create ticket'
            }));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
            <Button
                {...withDataAutomationId({ id: 'create-ticket-button' })}
                onClick={() => setIsDialogOpen(true)}
                variant={variant}
                size={size}
            >
                {t('createTicketFromAssetButton.actions.open', { defaultValue: 'Create Ticket' })}
            </Button>

            <Dialog
                {...withDataAutomationId({ id: 'create-ticket-dialog' })}
                isOpen={isDialogOpen}
                onClose={() => setIsDialogOpen(false)}
                title={t('createTicketFromAssetButton.title', { defaultValue: 'Create Ticket from Asset' })}
                footer={(
                    <div {...withDataAutomationId({ id: 'ticket-form-actions' })} className="flex justify-end space-x-2">
                        <Button
                            {...withDataAutomationId({ id: 'cancel-ticket-button' })}
                            variant="outline"
                            onClick={() => setIsDialogOpen(false)}
                            disabled={isSubmitting}
                        >
                            {t('common.actions.cancel', { defaultValue: 'Cancel' })}
                        </Button>
                        <Button
                            {...withDataAutomationId({ id: 'submit-ticket-button' })}
                            onClick={handleSubmit}
                            disabled={isSubmitting}
                        >
                            {isSubmitting
                                ? t('createTicketFromAssetButton.actions.creating', { defaultValue: 'Creating...' })
                                : t('createTicketFromAssetButton.actions.create', { defaultValue: 'Create Ticket' })}
                        </Button>
                    </div>
                )}
            >
                <div {...withDataAutomationId({ id: 'create-ticket-form' })} className="space-y-4">
                    <Input
                        {...withDataAutomationId({ id: 'ticket-title-input' })}
                        label={t('createTicketFromAssetButton.fields.title', { defaultValue: 'Title' })}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t('createTicketFromAssetButton.placeholders.title', {
                            defaultValue: 'Enter ticket title'
                        })}
                    />

                    <TextArea
                        {...withDataAutomationId({ id: 'ticket-description-input' })}
                        label={t('createTicketFromAssetButton.fields.description', { defaultValue: 'Description' })}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={t('createTicketFromAssetButton.placeholders.description', {
                            defaultValue: 'Describe the issue...'
                        })}
                        rows={4}
                    />

                    <CustomSelect
                        {...withDataAutomationId({ id: 'ticket-board-select' })}
                        label={t('createTicketFromAssetButton.fields.board', { defaultValue: 'Board' })}
                        options={boardOptions}
                        value={board}
                        onValueChange={handleBoardChange}
                        placeholder={isLoadingBoards
                            ? t('createTicketFromAssetButton.placeholders.loadingBoards', { defaultValue: 'Loading boards...' })
                            : t('createTicketFromAssetButton.placeholders.selectBoard', { defaultValue: 'Select board...' })}
                        disabled={isLoadingBoards}
                    />

                    <CustomSelect
                        {...withDataAutomationId({ id: 'ticket-status-select' })}
                        label={t('createTicketFromAssetButton.fields.status', { defaultValue: 'Status' })}
                        options={statusOptions}
                        value={status}
                        onValueChange={setStatus}
                        placeholder={!board
                            ? t('createTicketFromAssetButton.placeholders.selectBoardFirst', { defaultValue: 'Select board first...' })
                            : isLoadingStatuses
                                ? t('createTicketFromAssetButton.placeholders.loadingStatuses', { defaultValue: 'Loading statuses...' })
                                : t('createTicketFromAssetButton.placeholders.selectStatus', { defaultValue: 'Select status...' })}
                        disabled={isLoadingStatuses || !board}
                    />

                    <CustomSelect
                        {...withDataAutomationId({ id: 'ticket-priority-select' })}
                        label={t('createTicketFromAssetButton.fields.priority', { defaultValue: 'Priority' })}
                        options={priorityOptions}
                        value={priority}
                        onValueChange={setPriority}
                        placeholder={isLoadingPriorities
                            ? t('createTicketFromAssetButton.placeholders.loadingPriorities', { defaultValue: 'Loading priorities...' })
                            : t('createTicketFromAssetButton.placeholders.selectPriority', { defaultValue: 'Select priority...' })}
                        disabled={isLoadingPriorities}
                    />
                </div>
            </Dialog>
        </>
    );
}

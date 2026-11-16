// src/components/interactions/InteractionDetails.tsx

'use client';

import React, { useState, useEffect } from 'react';
import type { IInteraction, ITicket, IWorkItem, WorkItemType } from '@alga-psa/types';
import { Clock, FileText, ArrowLeft, Plus, Pen, Trash2, Download, ExternalLink, RefreshCw } from 'lucide-react';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { ButtonComponent, ContainerComponent } from '@alga-psa/ui/ui-reflection/types';
import { useDrawer, useClientDrawer } from "@alga-psa/ui";
import { useSchedulingCallbacks } from '@alga-psa/ui/context';
import ContactDetailsView from '@alga-psa/clients/components/contacts/ContactDetailsView';
import ClientQuickView from '@alga-psa/clients/components/clients/ClientQuickView';
import { Button } from '@alga-psa/ui/components/Button';
import { useClientCrossFeature } from '../../context/ClientCrossFeatureContext';
import { QuickAddInteraction } from '@alga-psa/clients/components/interactions/QuickAddInteraction';
import { getClientById, getAllClients } from '@alga-psa/clients/actions';
import { getContactByContactNameId } from '@alga-psa/clients/actions';
import { deleteInteraction } from '@alga-psa/clients/actions';
import { getInteractionCallArtifacts, type InteractionCallArtifact } from '@alga-psa/clients/actions';
import { CallTranscriptDrawerContent } from './CallTranscriptDrawerContent';
import { Text, Flex, Heading } from '@radix-ui/themes';
import { RichTextViewer } from '@alga-psa/ui/editor';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import {
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { findUserByIdAsync, getCurrentUserAsync } from '../../lib/usersHelpers';
import { buildInteractionTimeEntryContext } from '../../lib/timeEntryContext';
import InteractionIcon from '@alga-psa/ui/components/InteractionIcon';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface InteractionDetailsProps {
  interaction: IInteraction;
  onInteractionDeleted?: () => void; // Callback when interaction is deleted
  onInteractionUpdated?: (updatedInteraction: IInteraction) => void; // Callback when interaction is updated
  isInDrawer?: boolean; // Whether this component is displayed in a drawer
}
const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

// Helper to format duration from total minutes to "Xh Ym" format
const formatDuration = (totalMinutes: number): string => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h`;
  } else {
    return `${minutes}m`;
  }
};

const getOnlineMeetingStatusKey = (status?: string): string => {
  switch (status) {
    case 'no_recording':
      return 'noRecording';
    case 'recording_ready':
      return 'recordingReady';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
      return 'failed';
    case 'scheduled':
    case 'ended':
    case 'recording_pending':
    default:
      return 'recordingPending';
  }
};

const getOnlineMeetingStatusFallback = (status?: string): string => {
  switch (status) {
    case 'no_recording':
      return 'No recording';
    case 'recording_ready':
      return 'Recording ready';
    case 'cancelled':
      return 'Cancelled';
    case 'failed':
      return 'Recording unavailable';
    case 'scheduled':
    case 'ended':
    case 'recording_pending':
    default:
      return 'Recording pending';
  }
};

export const onlineMeetingArtifactsEnabled = (edition = process.env.NEXT_PUBLIC_EDITION): boolean =>
  edition === 'enterprise';

const InteractionDetails: React.FC<InteractionDetailsProps> = ({ interaction: initialInteraction, onInteractionDeleted, onInteractionUpdated, isInDrawer = false }) => {
  const [interaction, setInteraction] = useState<IInteraction>(initialInteraction);
  const { t } = useTranslation('msp/clients');
  const { openDrawer, goBack, closeDrawer } = useDrawer();
  const clientDrawer = useClientDrawer();
  const { launchTimeEntry, renderAgentSchedule } = useSchedulingCallbacks();
  const { renderQuickAddTicket, refreshMeetingRecordings } = useClientCrossFeature();
  const [isQuickAddTicketOpen, setIsQuickAddTicketOpen] = useState(false);
  const [isEditInteractionOpen, setIsEditInteractionOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isRefreshingRecordings, setIsRefreshingRecordings] = useState(false);
  const [userFullName, setUserFullName] = useState<string>('');
  const [callArtifacts, setCallArtifacts] = useState<InteractionCallArtifact[]>([]);
  const onlineMeeting = interaction.online_meeting;
  const showOnlineMeetingRecordingControls = onlineMeetingArtifactsEnabled();
  const onlineMeetingStatusKey = getOnlineMeetingStatusKey(onlineMeeting?.status);

  // Call recordings/transcripts hang off the telephony ledger, not the interaction row.
  useEffect(() => {
    if (!showOnlineMeetingRecordingControls || !initialInteraction.interaction_id) {
      setCallArtifacts([]);
      return;
    }
    let cancelled = false;
    getInteractionCallArtifacts(initialInteraction.interaction_id)
      .then((result) => {
        if (!cancelled) setCallArtifacts(result?.artifacts ?? []);
      })
      .catch((error) => {
        console.error('Error fetching call artifacts:', error);
        if (!cancelled) setCallArtifacts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [initialInteraction.interaction_id, showOnlineMeetingRecordingControls]);

  // UI Reflection System Integration
  const { automationIdProps: editButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: 'interaction-details-edit-button',
    type: 'button',
    label: t('interactions.details.actions.edit.label', { defaultValue: 'Edit Interaction' }),
    helperText: t('interactions.details.actions.edit.helper', { defaultValue: 'Edit this interaction details' })
  });

  const { automationIdProps: deleteButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: 'interaction-details-delete-button',
    type: 'button',
    label: t('interactions.details.actions.delete.label', { defaultValue: 'Delete Interaction' }),
    helperText: t('interactions.details.actions.delete.helper', { defaultValue: 'Delete this interaction permanently' })
  });

  const { automationIdProps: backButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: 'interaction-details-back-button',
    type: 'button',
    label: t('interactions.details.actions.back.label', { defaultValue: 'Back' }),
    helperText: t('interactions.details.actions.back.helper', { defaultValue: 'Go back to previous view' })
  });

  const { automationIdProps: addTicketButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: 'interaction-details-add-ticket-button',
    type: 'button',
    label: t('interactions.details.actions.addTicket.label', { defaultValue: 'Add Ticket' }),
    helperText: t('interactions.details.actions.addTicket.helper', { defaultValue: 'Create a new ticket related to this interaction' })
  });

  const { automationIdProps: addTimeEntryButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: 'interaction-details-add-time-entry-button',
    type: 'button',
    label: t('interactions.details.actions.addTimeEntry.label', { defaultValue: 'Add Time Entry' }),
    helperText: t('interactions.details.actions.addTimeEntry.helper', { defaultValue: 'Add time entry for this interaction' })
  });

  useEffect(() => {
    console.log('Initial interaction:', initialInteraction);
    setInteraction(initialInteraction);
    
    // Fetch user's full name
    const fetchUserFullName = async () => {
      if (initialInteraction.user_id) {
        try {
          const user = await findUserByIdAsync(initialInteraction.user_id);
          if (user) {
            setUserFullName(`${user.first_name} ${user.last_name}`);
          }
        } catch (error) {
          console.error('Error fetching user full name:', error);
        }
      }
    };
    
    fetchUserFullName();
  }, [initialInteraction]);

  console.log('Current interaction state:', interaction);

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };


  const handleContactClick = async () => {
    if (interaction.contact_name_id) {
      try {
        const contact = await getContactByContactNameId(interaction.contact_name_id);
        if (contact) {
          const clients = await getAllClients();
          openDrawer(
            <ContactDetailsView 
              initialContact={contact} 
              clients={clients}
              isInDrawer={true}
            />
          );
        } else {
          console.error('Contact not found');
        }
      } catch (error) {
        console.error('Error fetching contact details:', error);
      }
    } else {
      console.log('No contact associated with this interaction');
    }
  };

  const handleClientClick = async () => {
    if (interaction.client_id) {
      if (clientDrawer) {
        clientDrawer.openClientDrawer(interaction.client_id);
        return;
      }
      try {
        const client = await getClientById(interaction.client_id);
        if (client) {
          openDrawer(
            <ClientQuickView
              client={client}
              isInDrawer={true}
              quickView={true}
            />
          );
        } else {
          console.error('Client not found');
        }
      } catch (error) {
        console.error('Error fetching client details:', error);
      }
    } else {
      console.log('No client associated with this interaction');
    }
  };

  const handleTicketAdded = (ticket: ITicket) => {
    console.log('New ticket added:', ticket);
    setIsQuickAddTicketOpen(false);
  };

  const handleInteractionUpdated = async (updatedInteraction: IInteraction) => {
    setInteraction(updatedInteraction);
    setIsEditInteractionOpen(false);
    
    // Update user full name if user changed
    if (updatedInteraction.user_id) {
      try {
        const user = await findUserByIdAsync(updatedInteraction.user_id);
        if (user) {
          setUserFullName(`${user.first_name} ${user.last_name}`);
        }
      } catch (error) {
        console.error('Error fetching updated user full name:', error);
      }
    }
    
    // Notify parent component of the update
    if (onInteractionUpdated) {
      onInteractionUpdated(updatedInteraction);
    }
  };

  const handleUserClick = () => {
    if (interaction.user_id) {
      openDrawer(
        <>{renderAgentSchedule(interaction.user_id)}</>
      );
    }
  };

  const handleDeleteInteraction = async () => {
    try {
      const result = await deleteInteraction(interaction.interaction_id);
      if (isReturnedActionError(result)) {
        handleError(result);
        return;
      }
      setIsDeleteDialogOpen(false);
      
      // Call the callback to notify parent that interaction was deleted
      if (onInteractionDeleted) {
        onInteractionDeleted();
      }
      
      // Close the drawer completely
      closeDrawer();
    } catch (error) {
      console.error('Error deleting interaction:', error);
      // Handle error (e.g., show error message to user)
    }
  };

  const handleAddTimeEntry = async () => {
    try {
      await launchTimeEntry({
        openDrawer,
        closeDrawer,
        context: buildInteractionTimeEntryContext(interaction),
      });
    } catch (error) {
      handleError(error, t('interactions.details.timeEntryFailed', { defaultValue: 'Failed to prepare time entry. Please try again.' }));
    }
  };

  const handleRefreshMeetingRecordings = async () => {
    if (!showOnlineMeetingRecordingControls || !interaction.online_meeting?.meeting_id || !refreshMeetingRecordings) {
      return;
    }

    setIsRefreshingRecordings(true);
    try {
      const onlineMeeting = await refreshMeetingRecordings(interaction.online_meeting.meeting_id);
      if (isReturnedActionError(onlineMeeting)) {
        handleError(onlineMeeting);
        return;
      }
      const updatedInteraction = {
        ...interaction,
        online_meeting: onlineMeeting,
      };
      setInteraction(updatedInteraction);
      onInteractionUpdated?.(updatedInteraction);
    } catch (error) {
      handleError(error, t('interactions.onlineMeeting.refreshFailed', {
        defaultValue: 'Failed to refresh recordings. Please try again.',
      }));
    } finally {
      setIsRefreshingRecordings(false);
    }
  };

  return (
    <ReflectionContainer id="interaction-details" label={t('interactions.details.title', { defaultValue: 'Interaction Details' })}>
      <div className="p-6 relative bg-white shadow rounded-lg">
      <div className="flex justify-between items-center mb-6">
        <Heading size="6">{t('interactions.details.title', { defaultValue: 'Interaction Details' })}</Heading>
        <div className="flex gap-2">
          <Button
            {...editButtonProps}
            onClick={() => setIsEditInteractionOpen(true)}
            variant="ghost"
            size="sm"
          >
            <Pen className="mr-2 h-4 w-4" />
            {t('interactions.details.actions.editShort', { defaultValue: 'Edit' })}
          </Button>
          <Button
            {...deleteButtonProps}
            onClick={() => setIsDeleteDialogOpen(true)}
            variant="ghost"
            size="sm"
            className="text-red-600 hover:text-red-800 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/50"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t('interactions.details.actions.deleteShort', { defaultValue: 'Delete' })}
          </Button>
          <Button
            {...backButtonProps}
            onClick={goBack}
            variant="ghost"
            size="sm"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('interactions.details.actions.back.label', { defaultValue: 'Back' })}
          </Button>
        </div>
      </div>
      
      <div className="space-y-6">
        <div className="flex items-center">
          <span className="font-semibold">{t('interactions.details.fields.title', { defaultValue: 'Title:' })}</span>
          <span className="ml-2 text-lg font-medium">{interaction.title || t('interactions.details.noTitle', { defaultValue: 'No title' })}</span>
        </div>
        
        {interaction.notes && (
          <div className="space-y-2">
            <Text size="2" weight="bold">{t('interactions.details.fields.notes', { defaultValue: 'Notes' })}</Text>
            <div className="prose max-w-none">
              <RichTextViewer content={(() => {
                const raw = (interaction.notes || '').trim();
                if (raw.startsWith('[') || raw.startsWith('{')) {
                  try {
                    return JSON.parse(raw);
                  } catch {
                    // fall through to plain-text wrapper
                  }
                }
                // Plain text or malformed JSON – wrap in a paragraph block
                return raw ? [{
                  type: "paragraph",
                  props: { textAlignment: "left", backgroundColor: "default", textColor: "default" },
                  content: [{ type: "text", text: raw, styles: {} }]
                }] : [];
              })()} />
            </div>
          </div>
        )}

        {onlineMeeting && (
          <div
            id="interaction-online-meeting-section"
            className="space-y-4 rounded-md border border-gray-200 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <InteractionIcon icon={interaction.icon || 'video'} typeName={interaction.type_name || t('interactions.onlineMeeting.sectionTitle', { defaultValue: 'Online Meeting' })} />
                <div className="min-w-0">
                  <Text size="2" weight="bold">
                    {t('interactions.onlineMeeting.sectionTitle', { defaultValue: 'Online Meeting' })}
                  </Text>
                  {showOnlineMeetingRecordingControls && (
                    <div className="text-sm text-gray-600">
                      {t(`interactions.onlineMeeting.status.${onlineMeetingStatusKey}`, {
                        defaultValue: getOnlineMeetingStatusFallback(onlineMeeting.status),
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {onlineMeeting.join_url && (
                  <Button
                    id="online-meeting-join-button"
                    asChild
                    variant="outline"
                    size="sm"
                  >
                    <a href={onlineMeeting.join_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      {t('interactions.onlineMeeting.join', { defaultValue: 'Join' })}
                    </a>
                  </Button>
                )}
                {showOnlineMeetingRecordingControls && (
                  <Button
                    id="online-meeting-refresh-recordings-button"
                    onClick={handleRefreshMeetingRecordings}
                    disabled={isRefreshingRecordings}
                    variant="outline"
                    size="sm"
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshingRecordings ? 'animate-spin' : ''}`} />
                    {t('interactions.onlineMeeting.refreshRecordings', { defaultValue: 'Refresh recordings' })}
                  </Button>
                )}
              </div>
            </div>

            {showOnlineMeetingRecordingControls && (
              onlineMeeting.artifacts?.length > 0 ? (
                <div className="space-y-2">
                  {onlineMeeting.artifacts.map((artifact) => {
                    const createdAt = artifact.created_date_time
                      ? new Date(artifact.created_date_time).toLocaleString()
                      : null;
                    const artifactLabel = artifact.artifact_type === 'transcript'
                      ? t('interactions.onlineMeeting.viewTranscript', { defaultValue: 'View transcript' })
                      : t('interactions.onlineMeeting.downloadRecording', { defaultValue: 'Download recording' });
                    // A shared-work artifact carries its own access-checked download_url and
                    // must win; otherwise a transcript opens in the document viewer.
                    const artifactUrl = artifact.download_url ?? (artifact.artifact_type === 'transcript' && artifact.document_id
                      ? `/msp/documents?doc=${encodeURIComponent(artifact.document_id)}`
                      : `/api/online-meetings/recordings/${encodeURIComponent(artifact.artifact_id)}`);

                    return (
                      <div
                        key={artifact.artifact_id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-800"
                      >
                        <div className="flex min-w-0 items-center gap-2 text-sm">
                          {artifact.artifact_type === 'transcript' ? (
                            <FileText className="h-4 w-4 text-gray-500" />
                          ) : (
                            <Download className="h-4 w-4 text-gray-500" />
                          )}
                          <span className="font-medium">
                            {artifact.artifact_type === 'transcript'
                              ? t('interactions.onlineMeeting.transcriptArtifact', { defaultValue: 'Transcript' })
                              : t('interactions.onlineMeeting.recordingArtifact', { defaultValue: 'Recording' })}
                          </span>
                          {createdAt && <span className="text-gray-500">{createdAt}</span>}
                        </div>
                        <Button
                          id={`online-meeting-${artifact.artifact_type}-${artifact.artifact_id}`}
                          asChild
                          variant="ghost"
                          size="sm"
                        >
                          <a href={artifactUrl} target="_blank" rel="noopener noreferrer">
                            {artifactLabel}
                          </a>
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Text size="2" className="text-gray-600">
                  {t('interactions.onlineMeeting.noArtifacts', {
                    defaultValue: 'No recordings or transcripts are available yet.',
                  })}
                </Text>
              )
            )}
          </div>
        )}

        {callArtifacts.length > 0 && (
          <div
            id="interaction-call-artifacts-section"
            className="space-y-2 rounded-md border border-gray-200 p-4"
          >
            <Text size="2" weight="bold">
              {t('interactions.callArtifacts.sectionTitle', { defaultValue: 'Call recording and transcript' })}
            </Text>
            {callArtifacts.map((artifact) => {
              const createdAt = artifact.createdDateTime
                ? new Date(artifact.createdDateTime).toLocaleString()
                : null;
              const isTranscript = artifact.artifactType === 'transcript';
              const transcriptDocumentId = isTranscript ? artifact.documentId : null;
              const recordingUrl = !isTranscript && artifact.fileId
                ? `/api/telephony/call-recordings/${encodeURIComponent(artifact.artifactId)}`
                : null;
              if (!transcriptDocumentId && !recordingUrl) return null;

              return (
                <div
                  key={artifact.artifactId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-800"
                >
                  <div className="flex min-w-0 items-center gap-2 text-sm">
                    {isTranscript ? (
                      <FileText className="h-4 w-4 text-gray-500" />
                    ) : (
                      <Download className="h-4 w-4 text-gray-500" />
                    )}
                    <span className="font-medium">
                      {isTranscript
                        ? t('interactions.onlineMeeting.transcriptArtifact', { defaultValue: 'Transcript' })
                        : t('interactions.onlineMeeting.recordingArtifact', { defaultValue: 'Recording' })}
                    </span>
                    {createdAt && <span className="text-gray-500">{createdAt}</span>}
                  </div>
                  {transcriptDocumentId ? (
                    <Button
                      id={`interaction-call-transcript-${artifact.artifactId}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => openDrawer(<CallTranscriptDrawerContent documentId={transcriptDocumentId} />)}
                    >
                      {t('interactions.callArtifacts.viewTranscript', { defaultValue: 'View transcript' })}
                    </Button>
                  ) : (
                    <Button
                      id={`interaction-call-recording-${artifact.artifactId}`}
                      asChild
                      variant="ghost"
                      size="sm"
                    >
                      <a href={recordingUrl!} target="_blank" rel="noopener noreferrer">
                        {t('interactions.callArtifacts.downloadRecording', { defaultValue: 'Download recording' })}
                      </a>
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {interaction.status_name && (
          <div className="flex items-center">
            <span className="font-semibold">{t('interactions.details.fields.status', { defaultValue: 'Status:' })}</span>
            <span className="ml-2">{interaction.status_name}</span>
          </div>
        )}
        
        {interaction.start_time && (
          <div className="flex items-center">
            <span className="font-semibold">{t('interactions.details.fields.startTime', { defaultValue: 'Start Time:' })}</span>
            <span className="ml-2">
              {formatDate(interaction.start_time)}
            </span>
          </div>
        )}
        
        {interaction.end_time && (
          <div className="flex items-center">
            <span className="font-semibold">{t('interactions.details.fields.endTime', { defaultValue: 'End Time:' })}</span>
            <span className="ml-2">
              {formatDate(interaction.end_time)}
            </span>
          </div>
        )}
        
        {interaction.duration && (
          <div className="flex items-center">
            <span className="font-semibold">{t('interactions.details.fields.duration', { defaultValue: 'Duration:' })}</span>
            <span className="ml-2">
              {formatDuration(interaction.duration)}
            </span>
          </div>
        )}
        
        <div className="flex items-center">
          <span className="font-semibold">{t('interactions.details.fields.user', { defaultValue: 'User:' })}</span>
          <button
            onClick={handleUserClick}
            className="ml-2 text-blue-500 hover:underline"
          >
            {userFullName || interaction.user_name || t('interactions.details.unknownUser', { defaultValue: 'Unknown' })}
          </button>
        </div>
        
        <div className="flex items-center">
          <span className="font-semibold">{t('interactions.details.fields.contact', { defaultValue: 'Contact:' })}</span>
          {interaction.contact_name ? (
            <button
              onClick={handleContactClick}
              className="ml-2 text-blue-500 hover:underline"
            >
              {interaction.contact_name}
            </button>
          ) : (
            <span className="ml-2">{t('interactions.details.noContact', { defaultValue: 'No contact associated' })}</span>
          )}
        </div>
        
        <div className="flex items-center">
          <span className="font-semibold">{t('interactions.details.fields.client', { defaultValue: 'Client:' })}</span>
          {interaction.client_name ? (
            <button
              onClick={handleClientClick}
              className="ml-2 text-blue-500 hover:underline"
            >
              {interaction.client_name}
            </button>
          ) : (
            <span className="ml-2">{t('interactions.details.noClient', { defaultValue: 'No client associated' })}</span>
          )}
        </div>
      </div>

      <Flex justify="end" align="center" className="mt-6 gap-2">
        {!isInDrawer && (
          <Button
            {...addTimeEntryButtonProps}
            onClick={handleAddTimeEntry}
            variant="default"
          >
            <Clock className="mr-2 h-4 w-4" />
            {t('interactions.details.actions.addTimeEntry.label', { defaultValue: 'Add Time Entry' })}
          </Button>
        )}
        <Button
          {...addTicketButtonProps}
          onClick={() => setIsQuickAddTicketOpen(true)}
          variant="default"
        >
          <Plus className="mr-2 h-4 w-4" />
          {t('interactions.details.actions.addTicket.label', { defaultValue: 'Add Ticket' })}
        </Button>
      </Flex>

      {renderQuickAddTicket({
        id: 'quick-add-ticket',
        open: isQuickAddTicketOpen,
        onOpenChange: setIsQuickAddTicketOpen,
        onTicketAdded: handleTicketAdded,
        prefilledClient: interaction.client_id ? {
          id: interaction.client_id,
          name: interaction.client_name || ''
        } : undefined,
        prefilledContact: interaction.contact_name_id ? {
          id: interaction.contact_name_id,
          name: interaction.contact_name || ''
        } : undefined,
        prefilledDescription: (() => {
          try {
            const content = JSON.parse(interaction.notes || '[]');
            // Simple extraction of text from paragraph nodes
            return content.map((block: any) => {
              if (block.type === 'paragraph' && block.content) {
                return block.content.map((item: any) => item.text).join('');
              }
              return ''; // Ignore other block types for now
            }).join('\n'); // Join paragraphs with newlines
          } catch (e) {
            // If parsing fails, return the raw text
            return interaction.notes || '';
          }
        })(),
      })}

      <QuickAddInteraction
        id="edit-interaction"
        entityId={interaction.contact_name_id || interaction.client_id || ''}
        entityType={interaction.contact_name_id ? 'contact' : 'client'}
        clientId={interaction.client_id || undefined}
        onInteractionAdded={handleInteractionUpdated}
        isOpen={isEditInteractionOpen}
        onClose={() => setIsEditInteractionOpen(false)}
        editingInteraction={interaction}
      />

      <ConfirmationDialog
        id="delete-interaction-dialog"
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDeleteInteraction}
        title={t('interactions.details.actions.delete.label', { defaultValue: 'Delete Interaction' })}
        message={t('interactions.details.deleteConfirm', { defaultValue: 'Are you sure you want to delete this interaction? This action cannot be undone.' })}
        confirmLabel={t('interactions.details.actions.deleteShort', { defaultValue: 'Delete' })}
        cancelLabel={t('interactions.details.actions.cancel', { defaultValue: 'Cancel' })}
      />
      </div>
    </ReflectionContainer>
  );
};

export default InteractionDetails;

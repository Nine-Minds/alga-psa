'use client';

import React from 'react';
import type { IInteraction } from '@alga-psa/types';
import { Heading, Text, Flex } from '@radix-ui/themes';
import { RichTextViewer } from '@alga-psa/ui/editor';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface SchedulingInteractionDetailsProps {
  interaction: IInteraction;
}

type Translator = (key: string, options?: Record<string, unknown>) => string;

function formatDateTime(value: Date | string | null | undefined, t: Translator): string {
  if (!value) return t('interactionDetails.notAvailable', { defaultValue: 'N/A' });
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatDuration(totalMinutes: number | null | undefined, t: Translator): string {
  if (!totalMinutes || totalMinutes <= 0) return t('interactionDetails.notAvailable', { defaultValue: 'N/A' });
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function renderNotes(notes: string | null | undefined) {
  const raw = (notes || '').trim();
  if (!raw) return null;
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      return JSON.parse(raw);
    } catch {
      // Fall back to wrapping plain text below.
    }
  }

  return [
    {
      type: 'paragraph',
      props: { textAlignment: 'left', backgroundColor: 'default', textColor: 'default' },
      content: [{ type: 'text', text: raw, styles: {} }],
    },
  ];
}

export function SchedulingInteractionDetails({
  interaction,
}: SchedulingInteractionDetailsProps): React.JSX.Element {
  const { t } = useTranslation('msp/schedule');
  const noteContent = renderNotes(interaction.notes);

  return (
    <div className="h-full bg-white p-6 rounded-lg shadow-sm">
      <Flex direction="column" gap="4">
        <Heading size="6">{t('interactionDetails.title', { defaultValue: 'Interaction Details' })}</Heading>

        <div>
          <Text size="2" weight="bold">{t('interactionDetails.fields.title', { defaultValue: 'Title' })}</Text>
          <Text size="2" className="block mt-1">{interaction.title || t('interactionDetails.noTitle', { defaultValue: 'No title' })}</Text>
        </div>

        {noteContent && (
          <div>
            <Text size="2" weight="bold">{t('interactionDetails.fields.notes', { defaultValue: 'Notes' })}</Text>
            <div className="mt-2 prose max-w-none">
              <RichTextViewer content={noteContent} />
            </div>
          </div>
        )}

        <div>
          <Text size="2" weight="bold">{t('interactionDetails.fields.status', { defaultValue: 'Status' })}</Text>
          <Text size="2" className="block mt-1">{interaction.status_name || t('interactionDetails.notAvailable', { defaultValue: 'N/A' })}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('interactionDetails.fields.user', { defaultValue: 'User' })}</Text>
          <Text size="2" className="block mt-1">{interaction.user_name || t('interactionDetails.unknownUser', { defaultValue: 'Unknown' })}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('interactionDetails.fields.client', { defaultValue: 'Client' })}</Text>
          <Text size="2" className="block mt-1">{interaction.client_name || t('interactionDetails.noClient', { defaultValue: 'No client associated' })}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('interactionDetails.fields.contact', { defaultValue: 'Contact' })}</Text>
          <Text size="2" className="block mt-1">{interaction.contact_name || t('interactionDetails.noContact', { defaultValue: 'No contact associated' })}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('interactionDetails.fields.startTime', { defaultValue: 'Start Time' })}</Text>
          <Text size="2" className="block mt-1">{formatDateTime(interaction.start_time, t)}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('interactionDetails.fields.endTime', { defaultValue: 'End Time' })}</Text>
          <Text size="2" className="block mt-1">{formatDateTime(interaction.end_time, t)}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('interactionDetails.fields.duration', { defaultValue: 'Duration' })}</Text>
          <Text size="2" className="block mt-1">{formatDuration(interaction.duration, t)}</Text>
        </div>
      </Flex>
    </div>
  );
}

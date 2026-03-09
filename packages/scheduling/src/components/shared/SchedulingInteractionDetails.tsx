'use client';

import React from 'react';
import type { IInteraction } from '@alga-psa/types';
import { Heading, Text, Flex } from '@radix-ui/themes';
import { RichTextViewer } from '@alga-psa/ui/editor';

interface SchedulingInteractionDetailsProps {
  interaction: IInteraction;
}

function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return 'N/A';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatDuration(totalMinutes: number | null | undefined): string {
  if (!totalMinutes || totalMinutes <= 0) return 'N/A';
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
  const noteContent = renderNotes(interaction.notes);

  return (
    <div className="h-full bg-white p-6 rounded-lg shadow-sm">
      <Flex direction="column" gap="4">
        <Heading size="6">Interaction Details</Heading>

        <div>
          <Text size="2" weight="bold">Title</Text>
          <Text size="2" className="block mt-1">{interaction.title || 'No title'}</Text>
        </div>

        {noteContent && (
          <div>
            <Text size="2" weight="bold">Notes</Text>
            <div className="mt-2 prose max-w-none">
              <RichTextViewer content={noteContent} />
            </div>
          </div>
        )}

        <div>
          <Text size="2" weight="bold">Status</Text>
          <Text size="2" className="block mt-1">{interaction.status_name || 'N/A'}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">User</Text>
          <Text size="2" className="block mt-1">{interaction.user_name || 'Unknown'}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">Client</Text>
          <Text size="2" className="block mt-1">{interaction.client_name || 'No client associated'}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">Contact</Text>
          <Text size="2" className="block mt-1">{interaction.contact_name || 'No contact associated'}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">Start Time</Text>
          <Text size="2" className="block mt-1">{formatDateTime(interaction.start_time)}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">End Time</Text>
          <Text size="2" className="block mt-1">{formatDateTime(interaction.end_time)}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">Duration</Text>
          <Text size="2" className="block mt-1">{formatDuration(interaction.duration)}</Text>
        </div>
      </Flex>
    </div>
  );
}

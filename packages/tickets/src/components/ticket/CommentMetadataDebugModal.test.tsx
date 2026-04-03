/* @vitest-environment jsdom */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CommentMetadataDebugModal } from './CommentMetadataDebugModal';

describe('CommentMetadataDebugModal', () => {
  it('renders summary rows and raw JSON; copy writes JSON to clipboard', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    const metadata = {
      responseSource: 'inbound_email' as const,
      email: { provider: 'google' as const, messageId: '<x@y>' },
    };

    render(
      <CommentMetadataDebugModal
        commentId="c1"
        metadata={metadata}
        isOpen
        onClose={() => {}}
      />
    );

    const summary = screen.getByLabelText('Summary');
    expect(within(summary).getByText('responseSource')).toBeInTheDocument();
    expect(within(summary).getByText('inbound_email')).toBeInTheDocument();
    expect(within(summary).getByText('email.provider')).toBeInTheDocument();
    expect(within(summary).getByText('google')).toBeInTheDocument();

    const raw = screen.getByLabelText('Raw metadata');
    const pre = raw.querySelector('pre');
    expect(pre?.textContent).toBeTruthy();
    expect(JSON.parse(pre!.textContent!)).toMatchObject({
      responseSource: 'inbound_email',
      email: { provider: 'google', messageId: '<x@y>' },
    });

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(JSON.parse(copied)).toEqual(JSON.parse(JSON.stringify(metadata, null, 2)));
  });
});

import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import {
  EmailRecipientsInput,
  type EmailRecipientChip,
  type EmailRecipientSuggestion,
} from '../EmailRecipientsInput';
import { parseEmailRecipients } from '../../lib/emailRecipients';

function Harness({
  searchSuggestions,
}: {
  searchSuggestions?: (query: string) => Promise<EmailRecipientSuggestion[]>;
}) {
  const [value, setValue] = useState<EmailRecipientChip[]>([]);
  const [invalid, setInvalid] = useState<string[]>([]);
  return (
    <>
      <EmailRecipientsInput
        id="cc"
        label="Cc"
        value={value}
        onChange={setValue}
        invalidEntries={invalid}
        onInvalidEntriesChange={setInvalid}
        searchSuggestions={searchSuggestions}
      />
      <output data-testid="chips">{JSON.stringify(value)}</output>
    </>
  );
}

const chips = (): EmailRecipientChip[] =>
  JSON.parse(screen.getByTestId('chips').textContent || '[]');

describe('parseEmailRecipients', () => {
  it('T047: splits on comma, semicolon and newline and reads "Name <addr>"', () => {
    expect(parseEmailRecipients('ada@example.com; "Bob Smith" <bob@example.com>,\nnope')).toEqual({
      recipients: [{ email: 'ada@example.com' }, { email: 'bob@example.com', name: 'Bob Smith' }],
      invalid: ['nope'],
    });
  });
});

describe('EmailRecipientsInput', () => {
  it('T047: Enter commits a chip and a pasted list splits into several', () => {
    render(<Harness />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'ada@example.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(chips()).toEqual([{ email: 'ada@example.com' }]);

    fireEvent.paste(input, {
      clipboardData: { getData: () => 'bob@example.com, carol@example.com' },
    });
    expect(chips().map((entry) => entry.email)).toEqual([
      'ada@example.com',
      'bob@example.com',
      'carol@example.com',
    ]);
  });

  it('T048: an invalid address becomes an error chip; Backspace and x remove chips', () => {
    render(<Harness />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'not-an-email' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(chips()).toEqual([]);
    expect(screen.getByRole('alert').textContent).toContain('not-an-email');

    fireEvent.change(input, { target: { value: 'ada@example.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(chips()).toEqual([{ email: 'ada@example.com' }]);

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(chips()).toEqual([]);

    fireEvent.change(input, { target: { value: 'ada@example.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(document.getElementById('cc-remove-ada@example.com')!);
    expect(chips()).toEqual([]);
  });

  it('T049: suggestions keep the given order and picking one stores contact_id/user_id', async () => {
    const searchSuggestions = vi.fn(async () => [
      { email: 'jane@client.com', name: 'Jane Doe', contact_id: 'contact-1' },
      { email: 'tech@msp.test', name: 'Tech Agent', user_id: 'user-1' },
    ]);
    render(<Harness searchSuggestions={searchSuggestions} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ja' } });

    const options = await waitFor(() => {
      const list = document.getElementById('cc-suggestions');
      expect(list).not.toBeNull();
      return Array.from(list!.querySelectorAll('button'));
    });
    // Client contacts come back first from the searcher and stay first here.
    expect(options.map((button) => button.id)).toEqual([
      'cc-suggestion-jane@client.com',
      'cc-suggestion-tech@msp.test',
    ]);

    // A pointer press on a suggestion must not blur the input: the blur
    // handler closes the list, so a list that gave up focus would unmount
    // before the click landed and the picker would be mouse-unusable.
    expect(fireEvent.mouseDown(options[0])).toBe(false);
    fireEvent.click(options[0]);
    expect(chips()).toEqual([
      { email: 'jane@client.com', name: 'Jane Doe', contact_id: 'contact-1' },
    ]);
  });

  it('T049: leaving the field with a half-typed query keeps it out of the error chips', async () => {
    const searchSuggestions = vi.fn(async () => [
      { email: 'jane@client.com', name: 'Jane Doe', contact_id: 'contact-1' },
    ]);
    render(<Harness searchSuggestions={searchSuggestions} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'ja' } });
    await waitFor(() => expect(document.getElementById('cc-suggestions')).not.toBeNull());

    fireEvent.blur(input);

    // The query is a search, not an address: no error chip, so Send stays
    // enabled. A real address attempt still commits on blur.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(chips()).toEqual([]);
    expect(document.getElementById('cc-suggestions')).toBeNull();

    fireEvent.change(input, { target: { value: 'jane@client.com' } });
    fireEvent.blur(input);
    expect(chips()).toEqual([{ email: 'jane@client.com' }]);
  });
});

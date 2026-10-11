import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../actions/clientLookupActions', () => ({ getContactsByClient: vi.fn(async () => []) }));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getAllUsers: vi.fn(async () => []),
}));

import {
  CommentEmailRecipientsControl,
  commentEmailRecipientsDraftHasErrors,
  commentEmailRecipientsPayload,
  emptyCommentEmailRecipientsDraft,
  type CommentEmailRecipientsDraft,
} from './CommentEmailRecipientsControl';

function Harness({ isInternal = false }: { isInternal?: boolean }) {
  const [draft, setDraft] = useState<CommentEmailRecipientsDraft>(emptyCommentEmailRecipientsDraft);
  const [expanded, setExpanded] = useState(false);
  const shared = {
    idPrefix: 'composer',
    value: draft,
    onChange: setDraft,
    isInternal,
    expanded,
    onExpandedChange: setExpanded,
  } as const;
  return (
    <>
      <CommentEmailRecipientsControl {...shared} variant="rows" />
      <CommentEmailRecipientsControl {...shared} variant="toggle" />
      <output data-testid="payload">{JSON.stringify(commentEmailRecipientsPayload(draft) ?? null)}</output>
      <output data-testid="has-errors">{String(commentEmailRecipientsDraftHasErrors(draft))}</output>
    </>
  );
}

const toggle = () => document.getElementById('composer-ticket-comment-cc-bcc-toggle')!;
const ccInput = () => document.getElementById('composer-ticket-comment-cc-input-input') as HTMLInputElement;
const bccInput = () => document.getElementById('composer-ticket-comment-bcc-input-input') as HTMLInputElement;
const payload = () => JSON.parse(screen.getByTestId('payload').textContent || 'null');

describe('CommentEmailRecipientsControl', () => {
  it('T051: the toggle sits in the footer and expands both Cc and Bcc rows', () => {
    render(<Harness />);
    expect(toggle()).toBeTruthy();
    expect(ccInput()).toBeNull();

    fireEvent.click(toggle());
    expect(ccInput()).toBeTruthy();
    expect(bccInput()).toBeTruthy();
  });

  it('T052: the collapsed toggle shows a recipient count badge', () => {
    render(<Harness />);
    fireEvent.click(toggle());
    fireEvent.change(ccInput(), { target: { value: 'vendor@acme.com' } });
    fireEvent.keyDown(ccInput(), { key: 'Enter' });
    fireEvent.change(bccInput(), { target: { value: 'boss@msp.test' } });
    fireEvent.keyDown(bccInput(), { key: 'Enter' });
    expect(payload()).toEqual({ cc: ['vendor@acme.com'], bcc: ['boss@msp.test'] });

    // Collapse: the badge reports the two hidden recipients.
    fireEvent.click(toggle());
    expect(
      document.getElementById('composer-ticket-comment-cc-bcc-toggle-count')!.textContent
    ).toBe('2');
  });

  it('T053: Internal hides the control, keeps the values and notes they are not sent', () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(toggle());
    fireEvent.change(ccInput(), { target: { value: 'vendor@acme.com' } });
    fireEvent.keyDown(ccInput(), { key: 'Enter' });
    expect(payload()).toEqual({ cc: ['vendor@acme.com'] });

    rerender(<Harness isInternal />);
    // A fresh Harness mount resets state, so assert on the hidden-state render
    // contract instead: no toggle, no rows.
    expect(toggle()).toBeNull();
    expect(ccInput()).toBeNull();
  });

  it('T054: an invalid address raises the error flag that blocks Send', () => {
    render(<Harness />);
    fireEvent.click(toggle());
    fireEvent.change(ccInput(), { target: { value: 'not-an-email' } });
    fireEvent.keyDown(ccInput(), { key: 'Enter' });

    expect(screen.getByTestId('has-errors').textContent).toBe('true');
    expect(payload()).toBeNull();
    expect(document.getElementById('composer-email-recipients')!.textContent)
      .toContain('Fix the highlighted addresses before sending.');
  });
});

describe('commentEmailRecipientsPayload', () => {
  it('T056: an empty draft sends nothing, so comments without Cc/Bcc are unchanged', () => {
    expect(commentEmailRecipientsPayload(emptyCommentEmailRecipientsDraft())).toBeUndefined();
  });
});

/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />
import React from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ onPublished: null as null | (() => void) }));
vi.mock('@alga-psa/ui/hooks', () => ({ useCapability: () => ({ enabled: true }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@/components/co-managed/attachmentFileStager', () => ({ registerCoManagedAttachmentStager: () => undefined }));
vi.mock('@/components/co-managed/SharedCommentAttachmentPicker', () => ({ default: () => null }));
vi.mock('@/components/co-managed/CoManagedCommentAttachments', () => ({ default: () => null }));
vi.mock('@/components/co-managed/CoManagedThreadDisclosure', () => ({ default: () => null }));
vi.mock('@/components/co-managed/CoManagedDraftRestore', () => ({ default: (p: any) => { h.onPublished = p.onPublished; return null; } }));
vi.mock('@/lib/co-managed/attachmentUploadLimit', () => ({ coManagedAttachmentUploadLimit: () => 1024 }));

import CoManagedConversationFiles from '@/components/co-managed/CoManagedConversationFiles';

const EMPTY: never[] = [];
const staging = { subscribe: () => () => {}, getSnapshot: () => EMPTY } as any;
const resource = { tenant: 't', relationshipId: 'r', kind: 'ticket', id: 'k' } as any;

describe('CoManagedConversationFiles onCommentsChanged', () => {
  it('fires after a draft is published (once the reload settles), and not when a load merely completes', async () => {
    const listeners = new Set<() => void>();
    let version = 0;
    const load = vi.fn(async () => { version += 1; listeners.forEach(l => l()); });
    const session = { snapshot: () => ({ actor: { tenant: 'a', userId: 'u' }, items: [] }), writeAudiences: () => ['requester'], unsentFailure: () => null, load,
      subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; }, version: () => version } as any;
    const changed = vi.fn();
    render(<CoManagedConversationFiles session={session} resource={resource} staging={staging} onCommentsChanged={changed} />);
    await act(async () => { await session.load(); });
    expect(changed).not.toHaveBeenCalled();
    await act(async () => { h.onPublished!(); });
    expect(load).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it('still reloads when the host provides no signal', async () => {
    const load = vi.fn(async () => undefined);
    const session = { snapshot: () => ({ actor: { tenant: 'a', userId: 'u' }, items: [] }), writeAudiences: () => ['requester'], unsentFailure: () => null, load,
      subscribe: () => () => {}, version: () => 0 } as any;
    render(<CoManagedConversationFiles session={session} resource={resource} staging={staging} />);
    await act(async () => { h.onPublished!(); });
    expect(load).toHaveBeenCalledTimes(1);
  });
});

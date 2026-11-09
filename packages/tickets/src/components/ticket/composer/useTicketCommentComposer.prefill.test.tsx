/* @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { PartialBlock } from '@blocknote/core';
import { useComposerDirtyGuard } from '@alga-psa/ui/editor/useComposerDirtyGuard';
import { useTicketCommentComposer, useComposerPrefill, type PrefillEditor } from './useTicketCommentComposer';

const text = (value: string): PartialBlock[] => [{ type: 'paragraph', content: [{ type: 'text', text: value, styles: {} }] } as PartialBlock];

function setup(opts: {
  configuredAudiences?: any; audienceSelectable?: boolean; readOnly?: boolean; withEditor?: boolean; portalSubmit?: boolean;
} = {}) {
  const onContentChange = vi.fn();
  const editor: PrefillEditor = { document: [{ id: 'a' }, { id: 'b' }], replaceBlocks: vi.fn() };
  const hook = renderHook(() => {
    const composer = useTicketCommentComposer({
      configuredAudiences: opts.configuredAudiences ?? null,
      audienceSelectable: opts.audienceSelectable ?? false,
      allowEmailRecipients: false,
      portalSubmit: opts.portalSubmit,
    });
    const guard = useComposerDirtyGuard(composer.isOpen, 'test-compose');
    const editorRef = { current: opts.withEditor ? editor : null };
    const handle = useComposerPrefill({
      composer, readOnly: opts.readOnly ?? false, hasContent: guard.hasContent, editorRef,
      onContentChange: (content) => { onContentChange(content); guard.trackContent(content); },
    });
    return { composer, guard, handle };
  });
  return { ...hook, onContentChange, editor };
}

describe('composer prefill handle', () => {
  it('opens a closed composer and reports the content to the host', () => {
    const { result, onContentChange } = setup();
    let res: any;
    act(() => { res = result.current.handle.prefill({ content: text('draft') }); });
    expect(res).toEqual({ ok: true });
    expect(result.current.composer.isOpen).toBe(true);
    expect(onContentChange).toHaveBeenCalledWith(text('draft'));
    expect(result.current.composer.pendingContent).toEqual(text('draft'));
  });

  it('writes through the editor when mounted instead of staging initial content', () => {
    const { result, editor } = setup({ withEditor: true });
    act(() => { result.current.handle.prefill({ content: text('x') }); });
    expect(editor.replaceBlocks).toHaveBeenCalledWith(['a', 'b'], text('x'));
    expect(result.current.composer.pendingContent).toBeNull();
  });

  it('refuses a dirty composer unless replace is set', () => {
    const { result } = setup();
    act(() => { result.current.handle.prefill({ content: text('typed') }); });
    let res: any;
    act(() => { res = result.current.handle.prefill({ content: text('other') }); });
    expect(res).toEqual({ ok: false, reason: 'dirty' });
    expect(result.current.composer.pendingContent).toEqual(text('typed'));
    act(() => { res = result.current.handle.prefill({ content: text('other') }, { replace: true }); });
    expect(res).toEqual({ ok: true });
    expect(result.current.composer.pendingContent).toEqual(text('other'));
  });

  it('refuses on a read-only screen', () => {
    const { result } = setup({ readOnly: true });
    let res: any;
    act(() => { res = result.current.handle.prefill({ content: text('x') }); });
    expect(res).toEqual({ ok: false, reason: 'read-only' });
    expect(result.current.composer.isOpen).toBe(false);
  });

  it('drops an audience that is not offered', () => {
    const { result } = setup({ configuredAudiences: ['internal_only', 'client'], audienceSelectable: true });
    act(() => { result.current.handle.prefill({ content: text('x'), audience: 'shared_it' }); });
    expect(result.current.composer.chosenAudience).toBeNull();
  });

  it('keeps the resolution and drops shared_it when both are requested', () => {
    const { result } = setup({ configuredAudiences: ['internal_only', 'client', 'shared_it'], audienceSelectable: true });
    act(() => { result.current.handle.prefill({ content: text('x'), resolution: true, audience: 'shared_it' }); });
    expect(result.current.composer.isResolution).toBe(true);
    expect(result.current.composer.chosenAudience).toBeNull();
  });

  it('an audience sets the matching visibility', () => {
    const { result } = setup({ configuredAudiences: ['internal_only', 'client'], audienceSelectable: true });
    act(() => { result.current.handle.prefill({ content: text('x'), audience: 'internal_only' }); });
    expect(result.current.composer.chosenAudience).toBe('internal_only');
    expect(result.current.composer.isInternal).toBe(true);
  });

  it('a bare visibility applies without an audience select and is ignored on the portal', () => {
    const msp = setup();
    act(() => { msp.result.current.handle.prefill({ content: text('x'), visibility: 'internal' }); });
    expect(msp.result.current.composer.isInternal).toBe(true);
    const portal = setup({ portalSubmit: true });
    act(() => { portal.result.current.handle.prefill({ content: text('x'), visibility: 'internal' }); });
    expect(portal.result.current.composer.isInternal).toBe(false);
  });

  it('marks the draft dirty so the dismiss and unsaved-changes guards engage, and arms the host', () => {
    const { result, onContentChange } = setup();
    expect(result.current.guard.hasContent).toBe(false);
    act(() => { result.current.handle.prefill({ content: text('x') }); });
    expect(result.current.guard.hasContent).toBe(true);
    expect(result.current.handle.hasContent()).toBe(true);
    expect(onContentChange).toHaveBeenCalledTimes(1);
  });

  it('submits the same tuple as the same state set by hand', () => {
    const cfg = { configuredAudiences: ['internal_only', 'client'], audienceSelectable: true };
    const viaPrefill = setup(cfg);
    act(() => { viaPrefill.result.current.handle.prefill({ content: text('x'), audience: 'client', resolution: true }); });
    const byHand = setup(cfg);
    act(() => {
      byHand.result.current.composer.open('top');
      byHand.result.current.composer.setIsResolution(true);
      byHand.result.current.composer.handleAudienceChange('client');
    });
    expect(viaPrefill.result.current.composer.buildSubmitArgs()).toEqual(byHand.result.current.composer.buildSubmitArgs());
  });
});

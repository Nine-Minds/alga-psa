'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ITag } from '@alga-psa/types';

/**
 * A tag edit started in this component whose server action has not settled.
 * `add` carries the tag to display meanwhile (a provisional tag until the
 * server returns the real one); `remove` hides a tag by id.
 */
export type PendingTagOp =
  | { kind: 'add'; tag: ITag }
  | { kind: 'remove'; tagId: string };

const PROVISIONAL_TAG_PREFIX = 'pending-tag:';

export function isProvisionalTagId(tagId: string): boolean {
  return tagId.startsWith(PROVISIONAL_TAG_PREFIX);
}

/**
 * Content identity of a tag list: order-insensitive, and covering everything
 * a chip renders. Two arrays with the same signature render the same chips.
 */
export function tagContentSignature(tags: readonly ITag[]): string {
  return tags
    .map(tag => [tag.tag_id, tag.tag_text, tag.background_color ?? '', tag.text_color ?? ''].join('\u001f'))
    .sort()
    .join('\u001e');
}

export function applyTagOp(tags: readonly ITag[], op: PendingTagOp): ITag[] {
  if (op.kind === 'remove') {
    return tags.filter(tag => tag.tag_id !== op.tagId);
  }
  const text = op.tag.tag_text.toLowerCase();
  const alreadyPresent = tags.some(
    tag => tag.tag_id === op.tag.tag_id || tag.tag_text.toLowerCase() === text
  );
  return alreadyPresent ? [...tags] : [...tags, op.tag];
}

export function applyTagOps(base: readonly ITag[], ops: Iterable<PendingTagOp>): ITag[] {
  let result: ITag[] = [...base];
  for (const op of ops) {
    result = applyTagOp(result, op);
  }
  return result;
}

/**
 * Displayed tags = authoritative base + this component's still-pending ops.
 *
 * The base is replaced whenever `initialTags` changes in content (an empty
 * array included), so a parent refresh shows straight away; pending ops are
 * reapplied on top, so a refresh landing mid-save does not wipe the edit. A
 * new array with the same content is not a change.
 */
export function useReconciledTags(initialTags: ITag[]) {
  const baseRef = useRef<ITag[]>(initialTags);
  const pendingRef = useRef(new Map<string, PendingTagOp>());
  const nextOpIdRef = useRef(0);
  const [tags, setTags] = useState<ITag[]>(initialTags);

  const publish = useCallback((): ITag[] => {
    const next = applyTagOps(baseRef.current, pendingRef.current.values());
    setTags(next);
    return next;
  }, []);

  const signature = tagContentSignature(initialTags);
  const isFirstSignatureRef = useRef(true);
  useEffect(() => {
    if (isFirstSignatureRef.current) {
      // useState/useRef were seeded from these exact tags.
      isFirstSignatureRef.current = false;
      return;
    }
    baseRef.current = initialTags;
    publish();
    // Keyed on content: a re-render passing an equal array must not reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  /** Replace the base with a locally derived one (e.g. an optimistic text or colour edit). */
  const commitBase = useCallback((next: ITag[]): ITag[] => {
    baseRef.current = next;
    return publish();
  }, [publish]);

  const getBase = useCallback((): ITag[] => baseRef.current, []);

  const newProvisionalTagId = useCallback(
    (): string => `${PROVISIONAL_TAG_PREFIX}${nextOpIdRef.current++}`,
    []
  );

  /**
   * Show `op` until `action` settles. `action` resolves to the op the server
   * confirmed (folded into the base) or null when it did not take effect;
   * either way the pending marker is cleared, including when it throws.
   * Resolves to the displayed tags after a confirmed op, otherwise null.
   */
  const runPendingOp = useCallback(
    async (op: PendingTagOp, action: () => Promise<PendingTagOp | null>): Promise<ITag[] | null> => {
      const opId = `op-${nextOpIdRef.current++}`;
      pendingRef.current.set(opId, op);
      publish();
      let confirmed: PendingTagOp | null = null;
      try {
        confirmed = await action();
      } finally {
        pendingRef.current.delete(opId);
        if (confirmed) {
          baseRef.current = applyTagOp(baseRef.current, confirmed);
        }
        publish();
      }
      return confirmed ? applyTagOps(baseRef.current, pendingRef.current.values()) : null;
    },
    [publish]
  );

  return { tags, commitBase, getBase, runPendingOp, newProvisionalTagId };
}

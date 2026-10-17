'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ConversationDraftParent } from '@alga-psa/shared/lib/tickets/conversationEditorDrafts';

/** A reply link requests a composer target. Its consumer must admit the parent
 * from current authorized history or a server read before changing any draft. */
export function useConversationReplyLink(ready: boolean, admit: (parent: ConversationDraftParent) => Promise<boolean> | boolean) {
  const params = useSearchParams(), router = useRouter();
  const commentId = params?.get('replyTo'), threadId = params?.get('replyThread');
  const key = `${params?.get('conversation')}:${params?.get('conversationStore')}:${threadId}:${commentId}`;
  const current = useRef(key), attempted = useRef<string | null>(null), mounted = useRef(false), callback = useRef(admit);
  current.current = key; callback.current = admit;
  const [error, setError] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!commentId || !threadId) { attempted.current = null; setError(false); return; }
    if (!ready || attempted.current === key) return;
    attempted.current = key; setError(false);
    void Promise.resolve().then(() => mounted.current && current.current === key ? callback.current({ commentId, threadId }) : false).then(accepted => {
      if (!mounted.current || current.current !== key) return;
      if (!accepted) { setError(true); return; }
      const query = new URLSearchParams(params?.toString()); query.delete('replyTo'); query.delete('replyThread');
      router.replace(`${window.location.pathname}${query.size ? `?${query}` : ''}`, { scroll: false });
    }).catch(() => { if (mounted.current && current.current === key) setError(true); });
  }, [ready, key, commentId, threadId, params, router]);
  return error;
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Send } from 'lucide-react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IOpportunityFollowUpDraft } from '@alga-psa/types';

/**
 * The draft editor. The user writes; the agent only runs when the user enters
 * instructions and clicks Rewrite — never automatically on open. An explicit
 * action sends through the tenant's configured outbound email provider.
 */
export function DraftEditorDialog({
  isOpen,
  onClose,
  onGenerate,
  onGetRecipient,
  onSend,
}: {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (request: {
    instructions: string;
    current_draft?: IOpportunityFollowUpDraft;
  }) => Promise<IOpportunityFollowUpDraft>;
  onGetRecipient: () => Promise<string | null>;
  onSend: (input: { subject: string; body: string }) => Promise<{
    recipient: string;
    messageId: string | null;
  }>;
}) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [instructions, setInstructions] = useState('');
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [recipient, setRecipient] = useState<string | null>(null);
  const [recipientLoaded, setRecipientLoaded] = useState(false);

  const generate = useCallback(
    async (rawInstructions: string) => {
      const trimmed = rawInstructions.trim();
      if (!trimmed) return;
      setGenerating(true);
      try {
        const hasDraft = Boolean(subject.trim() || body.trim());
        const draft = await onGenerate({
          instructions: trimmed,
          current_draft: hasDraft ? { subject, body } : undefined,
        });
        setSubject(draft.subject);
        setBody(draft.body);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setGenerating(false);
      }
    },
    [onGenerate, subject, body]
  );

  useEffect(() => {
    if (isOpen) {
      setRecipientLoaded(false);
      void onGetRecipient()
        .then(setRecipient)
        .catch((err) => {
          setRecipient(null);
          toast.error(err instanceof Error ? err.message : String(err));
        })
        .finally(() => setRecipientLoaded(true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const copyBody = async () => {
    await navigator.clipboard.writeText(subject ? `${subject}\n\n${body}` : body);
    toast.success(t('opportunities.draft.copied', 'Copied. Paste it into your email.'));
  };

  const send = async () => {
    setSending(true);
    try {
      await onSend({ subject, body });
      toast.success(t('opportunities.draft.sent', 'Follow-up sent and logged on the deal.'));
      setSubject('');
      setBody('');
      setInstructions('');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      id="opportunity-draft-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={t('opportunities.draft.title', 'Follow-up draft')}
    >
      <div className="space-y-4 pt-1">
        {generating && !body ? (
          <Skeleton className="h-44 w-full" />
        ) : (
          <>
            <Input
              id="opportunity-draft-subject"
              label={t('opportunities.draft.subject', 'Subject')}
              value={subject}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSubject(e.target.value)}
            />
            <TextArea
              id="opportunity-draft-body"
              label={t('opportunities.draft.body', 'Body')}
              value={body}
              rows={9}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value)}
            />
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  id="opportunity-draft-instructions"
                  label={t('opportunities.draft.instructions', 'Tell the agent what to change')}
                  placeholder={t('opportunities.draft.instructionsPlaceholder', 'e.g. shorter, warmer, more formal')}
                  value={instructions}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInstructions(e.target.value)}
                />
              </div>
              <Button
                id="opportunity-draft-regenerate"
                size="sm"
                variant="outline"
                disabled={generating || !instructions.trim()}
                onClick={() => void generate(instructions)}
              >
                {t('opportunities.draft.regenerate', 'Rewrite')}
              </Button>
            </div>
          </>
        )}
        <p className="flex items-center gap-1.5 text-[11.5px] text-[rgb(var(--color-text-400))]">
          <Send className="h-3 w-3" aria-hidden />
          {recipient
            ? t('opportunities.draft.recipient', 'Sends to {{recipient}} through your tenant email provider.', { recipient })
            : recipientLoaded
              ? t('opportunities.draft.noRecipient', 'Link a contact with a primary email address before sending.')
              : t('opportunities.draft.loadingRecipient', 'Checking the linked contact...')}
        </p>
        <div className="flex justify-end gap-2">
          <Button id="opportunity-draft-cancel" variant="ghost" size="sm" onClick={onClose} disabled={sending}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button id="opportunity-draft-copy" variant="soft" size="sm" onClick={copyBody} disabled={!body || generating}>
            {t('opportunities.draft.copy', 'Copy')}
          </Button>
          <Button id="opportunity-draft-send" size="sm" onClick={send} disabled={!subject || !body || !recipient || generating || sending}>
            {t('opportunities.draft.send', 'Send follow-up')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

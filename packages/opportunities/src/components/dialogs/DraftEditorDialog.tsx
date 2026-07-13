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
 * The draft editor. The AI writes; you edit; you send it from your own email.
 * Nothing here can send to a client — by construction, not policy.
 */
export function DraftEditorDialog({
  isOpen,
  onClose,
  onGenerate,
  onLogSent,
}: {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (toneAdjustment?: string) => Promise<IOpportunityFollowUpDraft>;
  onLogSent: (input: { subject: string; summary: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [tone, setTone] = useState('');
  const [generating, setGenerating] = useState(false);
  const [logging, setLogging] = useState(false);

  const generate = useCallback(
    async (toneAdjustment?: string) => {
      setGenerating(true);
      try {
        const draft = await onGenerate(toneAdjustment);
        setSubject(draft.subject);
        setBody(draft.body);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setGenerating(false);
      }
    },
    [onGenerate]
  );

  useEffect(() => {
    if (isOpen && !subject && !body) void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const copyBody = async () => {
    await navigator.clipboard.writeText(subject ? `${subject}\n\n${body}` : body);
    toast.success(t('opportunities.draft.copied', 'Copied. Paste it into your email.'));
  };

  const markSent = async () => {
    setLogging(true);
    try {
      await onLogSent({ subject, summary: body.slice(0, 140) });
      toast.success(t('opportunities.draft.logged', 'Logged on the deal.'));
      setSubject('');
      setBody('');
      setTone('');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLogging(false);
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
                  id="opportunity-draft-tone"
                  label={t('opportunities.draft.tone', 'Adjust the tone')}
                  placeholder={t('opportunities.draft.tonePlaceholder', 'e.g. shorter, warmer, more formal')}
                  value={tone}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTone(e.target.value)}
                />
              </div>
              <Button
                id="opportunity-draft-regenerate"
                size="sm"
                variant="outline"
                disabled={generating}
                onClick={() => void generate(tone.trim() || undefined)}
              >
                {t('opportunities.draft.regenerate', 'Rewrite')}
              </Button>
            </div>
          </>
        )}
        <p className="flex items-center gap-1.5 text-[11.5px] text-[rgb(var(--color-text-400))]">
          <Send className="h-3 w-3" aria-hidden />
          {t('opportunities.draft.note', 'You send it from your own email. Nothing goes to a client on its own.')}
        </p>
        <div className="flex justify-end gap-2">
          <Button id="opportunity-draft-cancel" variant="ghost" size="sm" onClick={onClose} disabled={logging}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button id="opportunity-draft-copy" variant="soft" size="sm" onClick={copyBody} disabled={!body || generating}>
            {t('opportunities.draft.copy', 'Copy')}
          </Button>
          <Button id="opportunity-draft-sent" size="sm" onClick={markSent} disabled={!body || generating || logging}>
            {t('opportunities.draft.markSent', 'I sent it — log it')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

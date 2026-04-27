'use client';

import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { connectEntraCipp, validateEntraCippConnection } from '@alga-psa/integrations/actions';

interface EntraCippConnectDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

export function EntraCippConnectDialog({
    open,
    onOpenChange,
    onSuccess,
}: EntraCippConnectDialogProps) {
    const { t } = useTranslation('msp/integrations');
    const [baseUrl, setBaseUrl] = React.useState('');
    const [apiToken, setApiToken] = React.useState('');
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!baseUrl || !apiToken) {
            setError(t('integrations.entra.cippDialog.errors.missingFields'));
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            const result = await connectEntraCipp({ baseUrl, apiToken });
            if ('error' in result) {
                setError(result.error);
                return;
            }

            const validation = await validateEntraCippConnection();
            if ('error' in validation) {
                setError(validation.error);
                return;
            }

            onSuccess();
            onOpenChange(false);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : t('integrations.entra.cippDialog.errors.unknown'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const footer = (
        <div className="flex justify-end space-x-2">
            <Button
                id="entra-cipp-cancel"
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
            >
                {t('integrations.entra.cippDialog.actions.cancel')}
            </Button>
            <Button
                id="entra-cipp-submit"
                type="button"
                onClick={() => (document.getElementById('entra-cipp-form') as HTMLFormElement | null)?.requestSubmit()}
                disabled={isSubmitting}
            >
                {isSubmitting ? t('integrations.entra.cippDialog.actions.connecting') : t('integrations.entra.cippDialog.actions.connect')}
            </Button>
        </div>
    );

    return (
        <Dialog
            isOpen={open}
            onClose={() => onOpenChange(false)}
            id="entra-cipp-connect-dialog"
            footer={footer}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('integrations.entra.cippDialog.title')}</DialogTitle>
                    <DialogDescription>
                        {t('integrations.entra.cippDialog.description')}
                    </DialogDescription>
                </DialogHeader>

                <form id="entra-cipp-form" onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="entra-cipp-baseurl">{t('integrations.entra.cippDialog.fields.baseUrl')}</Label>
                        <Input
                            id="entra-cipp-baseurl"
                            placeholder={t('integrations.entra.cippDialog.fields.baseUrlPlaceholder')}
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                            disabled={isSubmitting}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="entra-cipp-apitoken">{t('integrations.entra.cippDialog.fields.apiToken')}</Label>
                        <Input
                            id="entra-cipp-apitoken"
                            type="password"
                            placeholder={t('integrations.entra.cippDialog.fields.apiTokenPlaceholder')}
                            value={apiToken}
                            onChange={(e) => setApiToken(e.target.value)}
                            disabled={isSubmitting}
                        />
                    </div>

                    {error ? <p className="text-sm text-destructive">{error}</p> : null}
                </form>
            </DialogContent>
        </Dialog>
    );
}

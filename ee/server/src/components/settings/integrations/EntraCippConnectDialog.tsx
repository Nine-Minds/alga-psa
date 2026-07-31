'use client';

import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { connectEntraCipp, testEntraCippCredentials } from '@alga-psa/integrations/actions';

interface EntraCippConnectDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

type CippTestResult =
    | { state: 'untested' }
    | { state: 'passed'; tenantCountSample: number; testedBaseUrl: string; testedApiToken: string }
    | { state: 'failed'; error: string };

/**
 * CIPP connect, with Test separated from Save.
 *
 * The two fields are the ones operators get wrong: the host is the CIPP-API
 * function app, not the CIPP frontend they log into, and the credential is
 * CIPP's own API key rather than an Azure secret. Testing used to mean saving
 * and watching what broke; now the probe runs on the candidate credential and
 * Save stays disabled until it has passed, so a typo never reaches the
 * connection record.
 */
export function EntraCippConnectDialog({
    open,
    onOpenChange,
    onSuccess,
}: EntraCippConnectDialogProps) {
    const { t } = useTranslation('msp/integrations');
    const [baseUrl, setBaseUrl] = React.useState('');
    const [apiToken, setApiToken] = React.useState('');
    const [isTesting, setIsTesting] = React.useState(false);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [testResult, setTestResult] = React.useState<CippTestResult>({ state: 'untested' });
    const [error, setError] = React.useState<string | null>(null);

    // A test verifies one exact credential pair. Editing either field invalidates
    // it, so Save can never ride on a passing test of something else.
    const isTestCurrent =
        testResult.state === 'passed'
        && testResult.testedBaseUrl === baseUrl
        && testResult.testedApiToken === apiToken;

    const resetForm = React.useCallback(() => {
        setBaseUrl('');
        setApiToken('');
        setTestResult({ state: 'untested' });
        setError(null);
    }, []);

    const handleClose = React.useCallback(() => {
        resetForm();
        onOpenChange(false);
    }, [onOpenChange, resetForm]);

    const handleTest = React.useCallback(async () => {
        if (!baseUrl || !apiToken) {
            setError(t('integrations.entra.cippDialog.errors.missingFields'));
            return;
        }

        setIsTesting(true);
        setError(null);
        try {
            const result = await testEntraCippCredentials({ baseUrl, apiToken });
            if ('error' in result) {
                setTestResult({ state: 'failed', error: result.error });
                return;
            }

            setTestResult({
                state: 'passed',
                tenantCountSample: result.data?.tenantCountSample ?? 0,
                testedBaseUrl: baseUrl,
                testedApiToken: apiToken,
            });
        } catch (err: unknown) {
            setTestResult({
                state: 'failed',
                error: err instanceof Error ? err.message : t('integrations.entra.cippDialog.errors.unknown'),
            });
        } finally {
            setIsTesting(false);
        }
    }, [apiToken, baseUrl, t]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isTestCurrent) {
            setError(t('integrations.entra.cippDialog.errors.testFirst'));
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            // connectEntraCipp re-probes before it persists anything, so a credential
            // that stopped working between Test and Save still writes nothing.
            const result = await connectEntraCipp({ baseUrl, apiToken });
            if ('error' in result) {
                setError(result.error);
                return;
            }

            resetForm();
            onSuccess();
            onOpenChange(false);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : t('integrations.entra.cippDialog.errors.unknown'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const busy = isTesting || isSubmitting;

    const footer = (
        <div className="flex justify-end space-x-2">
            <Button
                id="entra-cipp-cancel"
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={busy}
            >
                {t('integrations.entra.cippDialog.actions.cancel')}
            </Button>
            <Button
                id="entra-cipp-test"
                type="button"
                variant="outline"
                onClick={() => void handleTest()}
                disabled={busy || !baseUrl || !apiToken}
            >
                {isTesting
                    ? t('integrations.entra.cippDialog.actions.testing')
                    : t('integrations.entra.cippDialog.actions.test')}
            </Button>
            <Button
                id="entra-cipp-submit"
                type="button"
                onClick={() => (document.getElementById('entra-cipp-form') as HTMLFormElement | null)?.requestSubmit()}
                disabled={busy || !isTestCurrent}
            >
                {isSubmitting ? t('integrations.entra.cippDialog.actions.connecting') : t('integrations.entra.cippDialog.actions.connect')}
            </Button>
        </div>
    );

    return (
        <Dialog
            isOpen={open}
            onClose={handleClose}
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
                            onChange={(e) => {
                                setBaseUrl(e.target.value);
                                setTestResult({ state: 'untested' });
                            }}
                            disabled={busy}
                        />
                        <p className="text-sm text-muted-foreground" id="entra-cipp-baseurl-help">
                            {t('integrations.entra.cippDialog.fields.baseUrlHelp')}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="entra-cipp-apitoken">{t('integrations.entra.cippDialog.fields.apiToken')}</Label>
                        <Input
                            id="entra-cipp-apitoken"
                            type="password"
                            placeholder={t('integrations.entra.cippDialog.fields.apiTokenPlaceholder')}
                            value={apiToken}
                            onChange={(e) => {
                                setApiToken(e.target.value);
                                setTestResult({ state: 'untested' });
                            }}
                            disabled={busy}
                        />
                        <p className="text-sm text-muted-foreground" id="entra-cipp-apitoken-help">
                            {t('integrations.entra.cippDialog.fields.apiTokenHelp')}
                        </p>
                    </div>

                    {testResult.state === 'passed' ? (
                        <p className="text-sm text-emerald-600" id="entra-cipp-test-result">
                            {t('integrations.entra.cippDialog.test.passed', {
                                count: testResult.tenantCountSample,
                            })}
                        </p>
                    ) : null}
                    {testResult.state === 'failed' ? (
                        <p className="text-sm text-destructive" id="entra-cipp-test-result">
                            {testResult.error}
                        </p>
                    ) : null}
                    {testResult.state === 'untested' ? (
                        <p className="text-sm text-muted-foreground" id="entra-cipp-test-result">
                            {t('integrations.entra.cippDialog.test.required')}
                        </p>
                    ) : null}

                    <p className="text-sm text-muted-foreground" id="entra-cipp-encryption-note">
                        {t('integrations.entra.cippDialog.encryptionNote')}
                    </p>

                    {error ? <p className="text-sm text-destructive">{error}</p> : null}
                </form>
            </DialogContent>
        </Dialog>
    );
}

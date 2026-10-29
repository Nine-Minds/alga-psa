'use client';

import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { connectEntraCipp, testEntraCippCredentials } from '@alga-psa/integrations/actions';
import {
    buildCippCredentialInput,
    classifyCippFailure,
    cippHostForDisplay,
    cippTransportCause,
    cippTestFingerprint,
    displayCippApiUrl,
    isCippFormComplete,
    type CippConnectShape,
    type CippFormValues,
} from './cippConnectModel';

export interface EntraCippReconnectDetails {
    authType: 'api_client' | 'legacy_api_token' | null;
    /** Non-secret identifiers from the status payload. The secret is never available here. */
    apiUrl: string | null;
    clientId: string | null;
    tenantId: string | null;
}

interface EntraCippConnectDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
    /**
     * Set when the dialog is opened for a connection that already exists
     * (rotate / reconnect). URL, client ID and tenant ID are pre-filled; the
     * secret is not, and must be entered again. A legacy connection opens in
     * the API-client shape too: that is the migration target.
     */
    reconnect?: EntraCippReconnectDetails | null;
}

type CippTestResult =
    | { state: 'untested' }
    | { state: 'passed'; tenantCountSample: number; testedFingerprint: string }
    | { state: 'failed'; error: string; code?: string; cause?: string };

const HELP_STEP_KEYS = [
    'openIntegration',
    'createClient',
    'enable',
    'saveToAzure',
    'copySecret',
    'copyDetails',
] as const;

function initialValues(reconnect?: EntraCippReconnectDetails | null): CippFormValues {
    return {
        shape: 'api_client',
        apiUrl: reconnect?.apiUrl ? displayCippApiUrl(reconnect.apiUrl) : '',
        clientId: reconnect?.authType === 'api_client' ? reconnect.clientId ?? '' : '',
        clientSecret: '',
        tenantId: reconnect?.authType === 'api_client' ? reconnect.tenantId ?? '' : '',
        baseUrl: '',
        apiToken: '',
    };
}

/**
 * CIPP connect, with Test separated from Save.
 *
 * CIPP no longer issues static API keys; it issues an API client (Entra app)
 * whose details are the API URL, Application (client) ID, client secret and
 * Tenant ID. That is the default shape. The legacy API-key form stays behind
 * an explicit switch for connections that predate API clients.
 *
 * The probe runs on the candidate credential (mint a token, then an
 * authenticated read) and Save stays disabled until it has passed for the
 * exact values on screen, so a typo never reaches the connection record.
 */
export function EntraCippConnectDialog({
    open,
    onOpenChange,
    onSuccess,
    reconnect = null,
}: EntraCippConnectDialogProps) {
    const { t } = useTranslation('msp/integrations');
    const [values, setValues] = React.useState<CippFormValues>(() => initialValues(reconnect));
    const [isTesting, setIsTesting] = React.useState(false);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [testResult, setTestResult] = React.useState<CippTestResult>({ state: 'untested' });
    const [error, setError] = React.useState<{ message: string; code?: string; cause?: string } | null>(null);

    // Re-seed whenever the dialog opens, so a reconnect always starts from the
    // connection on record and never from a previous session's typing.
    const wasOpen = React.useRef(open);
    React.useEffect(() => {
        if (open && !wasOpen.current) {
            setValues(initialValues(reconnect));
            setTestResult({ state: 'untested' });
            setError(null);
        }
        wasOpen.current = open;
    }, [open, reconnect]);

    const isReconnect = Boolean(reconnect?.authType);
    const isApiClient = values.shape === 'api_client';
    const fingerprint = cippTestFingerprint(values);
    // A test verifies one exact set of values. Every field of the active shape
    // is part of the fingerprint, so Save can never ride on a passing test of
    // something else.
    const isTestCurrent =
        testResult.state === 'passed' && testResult.testedFingerprint === fingerprint;
    const complete = isCippFormComplete(values);

    const edit = (patch: Partial<CippFormValues>) => {
        setValues((previous) => ({ ...previous, ...patch }));
        setTestResult({ state: 'untested' });
        setError(null);
    };

    const switchShape = (shape: CippConnectShape) => {
        // The other shape's field state and test result must not leak across.
        setValues({ ...initialValues(null), shape });
        setTestResult({ state: 'untested' });
        setError(null);
    };

    const resetForm = React.useCallback(() => {
        setValues(initialValues(reconnect));
        setTestResult({ state: 'untested' });
        setError(null);
    }, [reconnect]);

    const handleClose = React.useCallback(() => {
        resetForm();
        onOpenChange(false);
    }, [onOpenChange, resetForm]);

    const handleTest = React.useCallback(async () => {
        if (!complete) {
            setError({
                message: isApiClient
                    ? t('integrations.entra.cippDialog.errors.missingApiClientFields')
                    : t('integrations.entra.cippDialog.errors.missingFields'),
            });
            return;
        }

        const testedFingerprint = fingerprint;
        setIsTesting(true);
        setError(null);
        try {
            const result = await testEntraCippCredentials(buildCippCredentialInput(values));
            if ('error' in result) {
                setTestResult({
                    state: 'failed',
                    error: result.error,
                    code: (result as { code?: string }).code,
                    cause: (result as { cause?: string }).cause,
                });
                return;
            }

            setTestResult({
                state: 'passed',
                tenantCountSample: result.data?.tenantCountSample ?? 0,
                testedFingerprint,
            });
        } catch (err: unknown) {
            setTestResult({
                state: 'failed',
                error: err instanceof Error ? err.message : t('integrations.entra.cippDialog.errors.unknown'),
            });
        } finally {
            setIsTesting(false);
        }
    }, [complete, fingerprint, isApiClient, t, values]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isTestCurrent) {
            setError({ message: t('integrations.entra.cippDialog.errors.testFirst') });
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            // connectEntraCipp re-probes before it persists anything, so a credential
            // that stopped working between Test and Save still writes nothing, and a
            // reconnect leaves the stored credential (legacy or not) untouched until
            // this succeeds.
            const result = await connectEntraCipp(buildCippCredentialInput(values));
            if ('error' in result) {
                setError({
                    message: result.error,
                    code: (result as { code?: string }).code,
                    cause: (result as { cause?: string }).cause,
                });
                return;
            }

            resetForm();
            onSuccess();
            onOpenChange(false);
        } catch (err: unknown) {
            setError({
                message: err instanceof Error ? err.message : t('integrations.entra.cippDialog.errors.unknown'),
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const failureTitle = (code: string | undefined) => {
        const kind = classifyCippFailure(values.shape, code);
        return kind ? t(`integrations.entra.cippDialog.failure.${kind}`) : null;
    };

    // An unreachable host is explained in the operator's language, naming the
    // host on screen and what stopped the request; otherwise the server's
    // remedy is shown as is.
    const failureRemedy = (message: string, code: string | undefined, cause: string | undefined) => {
        const transport = cippTransportCause(code, cause);
        if (!transport) return message;
        const host = cippHostForDisplay(isApiClient ? values.apiUrl : values.baseUrl);
        return t(`integrations.entra.cippDialog.failure.transport.${transport}`, { host });
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
                disabled={busy || !complete}
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
                    <DialogTitle>
                        {isReconnect
                            ? t('integrations.entra.cippDialog.reconnectTitle')
                            : t('integrations.entra.cippDialog.title')}
                    </DialogTitle>
                    <DialogDescription>
                        {isApiClient
                            ? t('integrations.entra.cippDialog.description')
                            : t('integrations.entra.cippDialog.legacyDescription')}
                    </DialogDescription>
                </DialogHeader>

                <form id="entra-cipp-form" onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
                    {isApiClient ? (
                        <>
                            <div className="rounded-md border p-3 text-sm space-y-2" id="entra-cipp-help">
                                <p className="font-medium">{t('integrations.entra.cippDialog.help.title')}</p>
                                <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
                                    {HELP_STEP_KEYS.map((key) => (
                                        <li key={key}>{t(`integrations.entra.cippDialog.help.steps.${key}`)}</li>
                                    ))}
                                </ol>
                                <p className="text-muted-foreground" id="entra-cipp-help-tenant-delay">
                                    {t('integrations.entra.cippDialog.help.tenantIdDelay')}
                                </p>
                                <p className="text-muted-foreground" id="entra-cipp-help-restrictions">
                                    {t('integrations.entra.cippDialog.help.restrictions')}
                                </p>
                            </div>

                            {isReconnect ? (
                                <p className="text-sm text-muted-foreground" id="entra-cipp-reconnect-note">
                                    {t(reconnect?.authType === 'legacy_api_token'
                                        ? 'integrations.entra.cippDialog.reconnectNoteLegacy'
                                        : 'integrations.entra.cippDialog.reconnectNote')}
                                </p>
                            ) : null}

                            <div className="space-y-2">
                                <Label htmlFor="entra-cipp-apiurl">{t('integrations.entra.cippDialog.fields.apiUrl')}</Label>
                                <Input
                                    id="entra-cipp-apiurl"
                                    placeholder={t('integrations.entra.cippDialog.fields.apiUrlPlaceholder')}
                                    value={values.apiUrl}
                                    onChange={(e) => edit({ apiUrl: e.target.value })}
                                    // Show the URL the way CIPP does (ending /api); what is
                                    // tested and saved is the same normalized value.
                                    onBlur={() => {
                                        const shown = displayCippApiUrl(values.apiUrl);
                                        if (shown && shown !== values.apiUrl) {
                                            setValues((previous) => ({ ...previous, apiUrl: shown }));
                                        }
                                    }}
                                    disabled={busy}
                                />
                                <p className="text-sm text-muted-foreground" id="entra-cipp-apiurl-help">
                                    {t('integrations.entra.cippDialog.fields.apiUrlHelp')}
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="entra-cipp-clientid">{t('integrations.entra.cippDialog.fields.clientId')}</Label>
                                <Input
                                    id="entra-cipp-clientid"
                                    placeholder={t('integrations.entra.cippDialog.fields.clientIdPlaceholder')}
                                    value={values.clientId}
                                    onChange={(e) => edit({ clientId: e.target.value })}
                                    disabled={busy}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="entra-cipp-clientsecret">{t('integrations.entra.cippDialog.fields.clientSecret')}</Label>
                                <Input
                                    id="entra-cipp-clientsecret"
                                    type="password"
                                    autoComplete="new-password"
                                    placeholder={t('integrations.entra.cippDialog.fields.clientSecretPlaceholder')}
                                    value={values.clientSecret}
                                    onChange={(e) => edit({ clientSecret: e.target.value })}
                                    disabled={busy}
                                />
                                <p className="text-sm text-muted-foreground" id="entra-cipp-clientsecret-help">
                                    {t('integrations.entra.cippDialog.fields.clientSecretHelp')}
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="entra-cipp-tenantid">{t('integrations.entra.cippDialog.fields.tenantId')}</Label>
                                <Input
                                    id="entra-cipp-tenantid"
                                    placeholder={t('integrations.entra.cippDialog.fields.tenantIdPlaceholder')}
                                    value={values.tenantId}
                                    onChange={(e) => edit({ tenantId: e.target.value })}
                                    disabled={busy}
                                />
                                <p className="text-sm text-muted-foreground" id="entra-cipp-tenantid-help">
                                    {t('integrations.entra.cippDialog.fields.tenantIdHelp')}
                                </p>
                            </div>
                        </>
                    ) : (
                        <>
                            <p className="text-sm text-muted-foreground" id="entra-cipp-legacy-note">
                                {t('integrations.entra.cippDialog.legacyNote')}
                            </p>
                            <div className="space-y-2">
                                <Label htmlFor="entra-cipp-baseurl">{t('integrations.entra.cippDialog.fields.baseUrl')}</Label>
                                <Input
                                    id="entra-cipp-baseurl"
                                    placeholder={t('integrations.entra.cippDialog.fields.baseUrlPlaceholder')}
                                    value={values.baseUrl}
                                    onChange={(e) => edit({ baseUrl: e.target.value })}
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
                                    autoComplete="new-password"
                                    placeholder={t('integrations.entra.cippDialog.fields.apiTokenPlaceholder')}
                                    value={values.apiToken}
                                    onChange={(e) => edit({ apiToken: e.target.value })}
                                    disabled={busy}
                                />
                                <p className="text-sm text-muted-foreground" id="entra-cipp-apitoken-help">
                                    {t('integrations.entra.cippDialog.fields.apiTokenHelp')}
                                </p>
                            </div>
                        </>
                    )}

                    <div>
                        <Button
                            id={isApiClient ? 'entra-cipp-use-legacy' : 'entra-cipp-use-api-client'}
                            type="button"
                            variant="link"
                            onClick={() => switchShape(isApiClient ? 'legacy' : 'api_client')}
                            disabled={busy}
                        >
                            {isApiClient
                                ? t('integrations.entra.cippDialog.shape.useLegacy')
                                : t('integrations.entra.cippDialog.shape.useApiClient')}
                        </Button>
                    </div>

                    {isTestCurrent && testResult.state === 'passed' ? (
                        <p className="text-sm text-emerald-600" id="entra-cipp-test-result">
                            {t('integrations.entra.cippDialog.test.passed', {
                                count: testResult.tenantCountSample,
                            })}
                        </p>
                    ) : null}
                    {testResult.state === 'failed' ? (
                        <Alert variant="destructive" id="entra-cipp-test-result">
                            <AlertDescription>
                                {failureTitle(testResult.code) ? (
                                    <strong className="block" id="entra-cipp-test-failure-title">
                                        {failureTitle(testResult.code)}
                                    </strong>
                                ) : null}
                                <span id="entra-cipp-test-failure-remedy">
                                    {failureRemedy(testResult.error, testResult.code, testResult.cause)}
                                </span>
                            </AlertDescription>
                        </Alert>
                    ) : null}
                    {!isTestCurrent && testResult.state !== 'failed' ? (
                        <p className="text-sm text-muted-foreground" id="entra-cipp-test-result">
                            {t('integrations.entra.cippDialog.test.required')}
                        </p>
                    ) : null}

                    <p className="text-sm text-muted-foreground" id="entra-cipp-encryption-note">
                        {isApiClient
                            ? t('integrations.entra.cippDialog.encryptionNote')
                            : t('integrations.entra.cippDialog.legacyEncryptionNote')}
                    </p>

                    {error ? (
                        <Alert variant="destructive" id="entra-cipp-error">
                            <AlertDescription>
                                {failureTitle(error.code) ? (
                                    <strong className="block">{failureTitle(error.code)}</strong>
                                ) : null}
                                {failureRemedy(error.message, error.code, error.cause)}
                            </AlertDescription>
                        </Alert>
                    ) : null}
                </form>
            </DialogContent>
        </Dialog>
    );
}

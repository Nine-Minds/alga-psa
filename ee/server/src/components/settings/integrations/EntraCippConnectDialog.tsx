'use client';

import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
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
    const [baseUrl, setBaseUrl] = React.useState('');
    const [apiToken, setApiToken] = React.useState('');
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!baseUrl || !apiToken) {
            setError('Both Base URL and API Token are required.');
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
            setError(err instanceof Error ? err.message : 'An unknown error occurred.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog isOpen={open} onClose={() => onOpenChange(false)} id="entra-cipp-connect-dialog">
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Connect CIPP</DialogTitle>
                    <DialogDescription>
                        Enter your CIPP instance URL and an API token to allow Alga to discover and sync Entra data.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="entra-cipp-baseurl">CIPP Base URL</Label>
                        <Input
                            id="entra-cipp-baseurl"
                            placeholder="https://cipp.yourdomain.com"
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                            disabled={isSubmitting}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="entra-cipp-apitoken">API Token</Label>
                        <Input
                            id="entra-cipp-apitoken"
                            type="password"
                            placeholder="Enter token..."
                            value={apiToken}
                            onChange={(e) => setApiToken(e.target.value)}
                            disabled={isSubmitting}
                        />
                    </div>

                    {error ? <p className="text-sm text-destructive">{error}</p> : null}

                    <DialogFooter>
                        <Button
                            id="entra-cipp-cancel"
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={isSubmitting}
                        >
                            Cancel
                        </Button>
                        <Button id="entra-cipp-submit" type="submit" disabled={isSubmitting}>
                            {isSubmitting ? 'Connecting...' : 'Connect'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

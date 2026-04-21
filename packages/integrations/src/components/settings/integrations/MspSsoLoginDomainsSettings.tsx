'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  listMspSsoDomainClaims,
  listMspSsoLoginDomains,
  refreshMspSsoDomainClaimChallenge,
  requestMspSsoDomainClaim,
  revokeMspSsoDomainClaim,
  saveMspSsoLoginDomains,
  verifyMspSsoDomainClaimOwnership,
} from '@alga-psa/integrations/actions';
import { useToast } from '@alga-psa/ui/hooks/use-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type ClaimStatus = 'advisory' | 'pending' | 'verified' | 'verified_legacy' | 'rejected' | 'revoked';
type ClaimRow = {
  id: string;
  domain: string;
  claim_status: ClaimStatus;
  active_challenge_label?: string | null;
  active_challenge_value?: string | null;
};

const isEnterprise = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

function claimStatusLabel(status: ClaimStatus, t: TranslateFn): string {
  switch (status) {
    case 'advisory':
      return t('integrations.sso.msp.claimStatus.advisory', { defaultValue: 'Advisory' });
    case 'pending':
      return t('integrations.sso.msp.claimStatus.pending', { defaultValue: 'Pending' });
    case 'verified':
      return t('integrations.sso.msp.claimStatus.verified', { defaultValue: 'Verified' });
    case 'verified_legacy':
      return t('integrations.sso.msp.claimStatus.verifiedLegacy', { defaultValue: 'Verified (Legacy)' });
    case 'rejected':
      return t('integrations.sso.msp.claimStatus.rejected', { defaultValue: 'Rejected' });
    case 'revoked':
      return t('integrations.sso.msp.claimStatus.revoked', { defaultValue: 'Revoked' });
    default: {
      const fallback = status as string;
      return fallback.charAt(0).toUpperCase() + fallback.slice(1);
    }
  }
}

function claimStatusVariant(status: ClaimStatus): 'info' | 'warning' | 'success' | 'error' | 'secondary' {
  if (status === 'verified' || status === 'verified_legacy') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'rejected' || status === 'revoked') return 'error';
  return 'secondary';
}

export function MspSsoLoginDomainsSettings() {
  const { t } = useTranslation('msp/integrations');
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [domains, setDomains] = React.useState<string[]>([]);
  const [claims, setClaims] = React.useState<ClaimRow[]>([]);
  const [newDomain, setNewDomain] = React.useState('');
  const [claimActionKey, setClaimActionKey] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    if (isEnterprise) {
      const result = await listMspSsoDomainClaims();
      if (!result.success) {
        setError(t('integrations.sso.msp.errors.loadClaims', { defaultValue: 'Unable to load MSP SSO domain claims.' }));
        setLoading(false);
        return;
      }

      const normalizedClaims = (result.claims || []).map((claim) => ({
        id: claim.id,
        domain: claim.domain,
        claim_status: claim.claim_status,
        active_challenge_label: claim.active_challenge_label ?? null,
        active_challenge_value: claim.active_challenge_value ?? null,
      }));
      setClaims(normalizedClaims);
      setLoading(false);
      return;
    }

    const result = await listMspSsoLoginDomains();
    if (!result.success) {
      setError(t('integrations.sso.msp.errors.loadDomains', { defaultValue: 'Unable to load MSP SSO login domains.' }));
      setLoading(false);
      return;
    }

    setDomains(result.domains || []);
    setLoading(false);
  }, [t]);

  React.useEffect(() => {
    load();
  }, [load]);

  const handleAddDomain = () => {
    const candidate = newDomain.trim();
    if (!candidate) return;
    setDomains((prev) => [...prev, candidate]);
    setNewDomain('');
  };

  const handleDomainChange = (index: number, value: string) => {
    setDomains((prev) => prev.map((item, idx) => (idx === index ? value : item)));
  };

  const handleRemoveDomain = (index: number) => {
    setDomains((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      const result = await saveMspSsoLoginDomains({ domains });

      if (!result.success) {
        const conflictHint = result.conflicts?.length
          ? ` ${t('integrations.sso.msp.errors.conflicts', { defaultValue: 'Conflicts: {{conflicts}}.', conflicts: result.conflicts.join(', ') })}`
          : '';
        const message = `${t('integrations.sso.msp.errors.saveDomains', { defaultValue: 'Unable to save MSP SSO login domains.' })}${conflictHint}`;
        setError(message);
        toast({
          title: t('integrations.sso.msp.toasts.saveDomainsFailedTitle', { defaultValue: 'Unable to save MSP SSO login domains' }),
          description: message,
          variant: 'destructive',
        });
        return;
      }

      setDomains(result.domains || []);
      toast({
        title: t('integrations.sso.msp.toasts.savedTitle', { defaultValue: 'MSP SSO login domains saved' }),
        description: t('integrations.sso.msp.toasts.savedDescription', { defaultValue: 'Domain-based SSO discovery settings are updated.' }),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRequestClaim = async (domain: string) => {
    const candidate = domain.trim();
    if (!candidate) return;

    try {
      setClaimActionKey(`request:${candidate}`);
      setError(null);
      const result = await requestMspSsoDomainClaim({ domain: candidate });
      if (!result.success) {
        const message = t('integrations.sso.msp.errors.requestClaim', { defaultValue: 'Unable to request domain claim.' });
        setError(message);
        toast({
          title: t('integrations.sso.msp.toasts.requestClaimFailedTitle', { defaultValue: 'Unable to request domain claim' }),
          description: message,
          variant: 'destructive',
        });
        return;
      }

      setNewDomain('');
      toast({
        title: result.idempotent
          ? t('integrations.sso.msp.toasts.claimUnchangedTitle', { defaultValue: 'Domain claim unchanged' })
          : t('integrations.sso.msp.toasts.claimRequestedTitle', { defaultValue: 'Domain claim requested' }),
        description: result.idempotent
          ? t('integrations.sso.msp.toasts.claimUnchangedDescription', { defaultValue: 'Existing pending claim and challenge are already active.' })
          : t('integrations.sso.msp.toasts.claimRequestedDescription', { defaultValue: 'Pending domain claim created and verification challenge generated.' }),
      });
      await load();
    } finally {
      setClaimActionKey(null);
    }
  };

  const handleVerifyClaim = async (claimId: string) => {
    try {
      setClaimActionKey(`verify:${claimId}`);
      setError(null);
      const result = await verifyMspSsoDomainClaimOwnership({ claimId });
      if (!result.success) {
        const message = t('integrations.sso.msp.errors.verifyClaim', { defaultValue: 'Unable to verify domain claim.' });
        setError(message);
        toast({
          title: t('integrations.sso.msp.toasts.verifyFailedTitle', { defaultValue: 'Domain verification failed' }),
          description: message,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: t('integrations.sso.msp.toasts.verifiedTitle', { defaultValue: 'Domain claim verified' }),
        description: t('integrations.sso.msp.toasts.verifiedDescription', { defaultValue: 'Domain takeover is now eligible for tenant-scoped provider routing.' }),
      });
      await load();
    } finally {
      setClaimActionKey(null);
    }
  };

  const handleRefreshChallenge = async (claimId: string) => {
    try {
      setClaimActionKey(`refresh:${claimId}`);
      setError(null);
      const result = await refreshMspSsoDomainClaimChallenge({ claimId });
      if (!result.success) {
        const message = t('integrations.sso.msp.errors.refreshChallenge', { defaultValue: 'Unable to refresh challenge.' });
        setError(message);
        toast({
          title: t('integrations.sso.msp.toasts.refreshFailedTitle', { defaultValue: 'Unable to refresh challenge' }),
          description: message,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: t('integrations.sso.msp.toasts.refreshedTitle', { defaultValue: 'Challenge refreshed' }),
        description: t('integrations.sso.msp.toasts.refreshedDescription', { defaultValue: 'A new verification challenge is active for this claim.' }),
      });
      await load();
    } finally {
      setClaimActionKey(null);
    }
  };

  const handleRevokeClaim = async (claimId: string) => {
    try {
      setClaimActionKey(`revoke:${claimId}`);
      setError(null);
      const result = await revokeMspSsoDomainClaim({ claimId });
      if (!result.success) {
        const message = t('integrations.sso.msp.errors.revokeClaim', { defaultValue: 'Unable to revoke domain claim.' });
        setError(message);
        toast({
          title: t('integrations.sso.msp.toasts.revokeFailedTitle', { defaultValue: 'Unable to revoke claim' }),
          description: message,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: t('integrations.sso.msp.toasts.revokedTitle', { defaultValue: 'Domain claim revoked' }),
        description: t('integrations.sso.msp.toasts.revokedDescription', { defaultValue: 'Tenant takeover for this domain is disabled.' }),
      });
      await load();
    } finally {
      setClaimActionKey(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('integrations.sso.msp.title', { defaultValue: 'MSP SSO Login Domains' })}</CardTitle>
        <CardDescription>
          {isEnterprise
            ? t('integrations.sso.msp.descriptionEe', { defaultValue: 'Manage domain claim lifecycle for MSP login SSO provider discovery. Unclaimed or ineligible domains fall back to Nine Minds app-level providers.' })
            : t('integrations.sso.msp.descriptionCe', { defaultValue: 'Register advisory domains for MSP login SSO discovery. Ownership verification is not enforced in Community Edition, and unmanaged domains fall back to Nine Minds app-level providers.' })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="info">
          <AlertDescription>
            {t('integrations.sso.msp.fallbackInfo', { defaultValue: 'Domains without an eligible tenant claim use the Nine Minds app-level SSO provider configuration.' })}
          </AlertDescription>
        </Alert>
        {error && (
          <Alert variant="info">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground">{t('integrations.sso.msp.loading', { defaultValue: 'Loading…' })}</div>
        ) : isEnterprise ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="msp-sso-domain-claim-input">{t('integrations.sso.msp.requestClaimLabel', { defaultValue: 'Request domain claim' })}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="msp-sso-domain-claim-input"
                  value={newDomain}
                  onChange={(event) => setNewDomain(event.target.value)}
                  placeholder="example.com"
                />
                <Button
                  id="msp-sso-domain-claim-button"
                  type="button"
                  variant="outline"
                  onClick={() => handleRequestClaim(newDomain)}
                  disabled={!newDomain.trim() || Boolean(claimActionKey)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  {t('integrations.sso.msp.requestClaim', { defaultValue: 'Request Claim' })}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {claims.length === 0 ? (
                <div className="rounded border border-dashed p-3 text-sm text-muted-foreground">
                  {t('integrations.sso.msp.emptyClaims', { defaultValue: 'No domain claims configured yet.' })}
                </div>
              ) : (
                claims.map((claim) => (
                  <div
                    key={claim.id}
                    className="rounded border p-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{claim.domain}</span>
                        <Badge variant={claimStatusVariant(claim.claim_status)}>
                          {claimStatusLabel(claim.claim_status, t)}
                        </Badge>
                      </div>
                      {claim.claim_status === 'pending' &&
                        claim.active_challenge_label &&
                        claim.active_challenge_value && (
                          <div className="rounded border border-dashed p-2 text-xs text-muted-foreground space-y-1">
                            <div>{t('integrations.sso.msp.dnsInstructions', { defaultValue: 'Add DNS TXT record, then click Verify:' })}</div>
                            <div>
                              {t('integrations.sso.msp.dnsHost', { defaultValue: 'Host:' })} <code>{claim.active_challenge_label}</code>
                            </div>
                            <div>
                              {t('integrations.sso.msp.dnsValue', { defaultValue: 'Value:' })} <code>{claim.active_challenge_value}</code>
                            </div>
                          </div>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {(claim.claim_status === 'advisory' ||
                        claim.claim_status === 'rejected' ||
                        claim.claim_status === 'revoked') && (
                        <Button
                          id={`msp-sso-domain-claim-request-${claim.id}`}
                          type="button"
                          variant="outline"
                          onClick={() => handleRequestClaim(claim.domain)}
                          disabled={Boolean(claimActionKey)}
                        >
                          {t('integrations.sso.msp.actions.request', { defaultValue: 'Request' })}
                        </Button>
                      )}
                      {claim.claim_status === 'pending' && (
                        <>
                          <Button
                            id={`msp-sso-domain-claim-verify-${claim.id}`}
                            type="button"
                            variant="outline"
                            onClick={() => handleVerifyClaim(claim.id)}
                            disabled={Boolean(claimActionKey)}
                          >
                            {t('integrations.sso.msp.actions.verify', { defaultValue: 'Verify' })}
                          </Button>
                          <Button
                            id={`msp-sso-domain-claim-reset-${claim.id}`}
                            type="button"
                            variant="outline"
                            onClick={() => handleRefreshChallenge(claim.id)}
                            disabled={Boolean(claimActionKey)}
                          >
                            {t('integrations.sso.msp.actions.resetChallenge', { defaultValue: 'Reset Challenge' })}
                          </Button>
                        </>
                      )}
                      {(claim.claim_status === 'pending' ||
                        claim.claim_status === 'verified' ||
                        claim.claim_status === 'verified_legacy') && (
                        <Button
                          id={`msp-sso-domain-claim-revoke-${claim.id}`}
                          type="button"
                          variant="destructive"
                          onClick={() => handleRevokeClaim(claim.id)}
                          disabled={Boolean(claimActionKey)}
                        >
                          {t('integrations.sso.msp.actions.revoke', { defaultValue: 'Revoke' })}
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-end">
              <Button
                id="msp-sso-domains-refresh"
                type="button"
                variant="outline"
                onClick={load}
                disabled={loading || Boolean(claimActionKey)}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('integrations.sso.msp.actions.refresh', { defaultValue: 'Refresh' })}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Alert variant="info">
              <AlertDescription>
                {t('integrations.sso.msp.advisoryNotice', { defaultValue: 'Advisory mode: domain registration helps route MSP SSO discovery but does not require ownership verification in Community Edition.' })}
              </AlertDescription>
            </Alert>
            <div className="space-y-2">
              <Label htmlFor="msp-sso-domain-add-input">{t('integrations.sso.msp.addDomainLabel', { defaultValue: 'Add login domain' })}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="msp-sso-domain-add-input"
                  value={newDomain}
                  onChange={(event) => setNewDomain(event.target.value)}
                  placeholder="example.com"
                />
                <Button
                  id="msp-sso-domain-add-button"
                  type="button"
                  variant="outline"
                  onClick={handleAddDomain}
                  disabled={!newDomain.trim() || saving}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  {t('integrations.sso.msp.actions.add', { defaultValue: 'Add' })}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {domains.length === 0 ? (
                <div className="rounded border border-dashed p-3 text-sm text-muted-foreground">
                  {t('integrations.sso.msp.emptyDomains', { defaultValue: 'No domains configured. Unknown domains will use app-level provider fallback.' })}
                </div>
              ) : (
                domains.map((domain, index) => (
                  <div key={`msp-sso-domain-${index}`} className="flex items-center gap-2">
                    <Input
                      id={`msp-sso-domain-row-${index}`}
                      value={domain}
                      onChange={(event) => handleDomainChange(index, event.target.value)}
                      placeholder="example.com"
                    />
                    <Button
                      id={`msp-sso-domain-remove-${index}`}
                      type="button"
                      variant="ghost"
                      aria-label={t('integrations.sso.msp.removeDomainAria', { defaultValue: 'Remove domain {{number}}', number: index + 1 })}
                      onClick={() => handleRemoveDomain(index)}
                      disabled={saving}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between">
              <Button
                id="msp-sso-domains-refresh"
                type="button"
                variant="outline"
                onClick={load}
                disabled={loading || saving}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('integrations.sso.msp.actions.refresh', { defaultValue: 'Refresh' })}
              </Button>

              <Button
                id="msp-sso-domains-save"
                type="button"
                onClick={handleSave}
                disabled={saving}
              >
                {saving
                  ? t('integrations.sso.msp.actions.saving', { defaultValue: 'Saving…' })
                  : t('integrations.sso.msp.actions.saveDomains', { defaultValue: 'Save Domains' })}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

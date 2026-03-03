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

type ClaimStatus = 'advisory' | 'pending' | 'verified' | 'verified_legacy' | 'rejected' | 'revoked';
type ClaimRow = {
  id: string;
  domain: string;
  claim_status: ClaimStatus;
  active_challenge_label?: string | null;
  active_challenge_value?: string | null;
};

const isEnterprise = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

function claimStatusLabel(status: ClaimStatus): string {
  if (status === 'verified_legacy') return 'Verified (Legacy)';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function claimStatusVariant(status: ClaimStatus): 'info' | 'warning' | 'success' | 'error' | 'secondary' {
  if (status === 'verified' || status === 'verified_legacy') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'rejected' || status === 'revoked') return 'error';
  return 'secondary';
}

export function MspSsoLoginDomainsSettings() {
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
        setError(result.error || 'Unable to load MSP SSO domain claims.');
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
      setError(result.error || 'Unable to load MSP SSO login domains.');
      setLoading(false);
      return;
    }

    setDomains(result.domains || []);
    setLoading(false);
  }, []);

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
          ? ` Conflicts: ${result.conflicts.join(', ')}.`
          : '';
        const message = `${result.error || 'Unable to save MSP SSO login domains.'}${conflictHint}`;
        setError(message);
        toast({
          title: 'Unable to save MSP SSO login domains',
          description: message,
          variant: 'destructive',
        });
        return;
      }

      setDomains(result.domains || []);
      toast({
        title: 'MSP SSO login domains saved',
        description: 'Domain-based SSO discovery settings are updated.',
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
        const message = result.error || 'Unable to request domain claim.';
        setError(message);
        toast({
          title: 'Unable to request domain claim',
          description: message,
          variant: 'destructive',
        });
        return;
      }

      setNewDomain('');
      toast({
        title: result.idempotent ? 'Domain claim unchanged' : 'Domain claim requested',
        description: result.idempotent
          ? 'Existing pending claim and challenge are already active.'
          : 'Pending domain claim created and verification challenge generated.',
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
        const message = result.error || 'Unable to verify domain claim.';
        setError(message);
        toast({
          title: 'Domain verification failed',
          description: message,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Domain claim verified',
        description: 'Domain takeover is now eligible for tenant-scoped provider routing.',
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
        const message = result.error || 'Unable to refresh challenge.';
        setError(message);
        toast({
          title: 'Unable to refresh challenge',
          description: message,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Challenge refreshed',
        description: 'A new verification challenge is active for this claim.',
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
        const message = result.error || 'Unable to revoke domain claim.';
        setError(message);
        toast({
          title: 'Unable to revoke claim',
          description: message,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Domain claim revoked',
        description: 'Tenant takeover for this domain is disabled.',
      });
      await load();
    } finally {
      setClaimActionKey(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>MSP SSO Login Domains</CardTitle>
        <CardDescription>
          {isEnterprise
            ? 'Manage domain claim lifecycle for MSP login SSO provider discovery before user authentication.'
            : 'Register advisory domains for MSP login SSO discovery. Ownership verification is not enforced in Community Edition.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="info">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : isEnterprise ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="msp-sso-domain-claim-input">Request domain claim</Label>
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
                  Request Claim
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {claims.length === 0 ? (
                <div className="rounded border border-dashed p-3 text-sm text-muted-foreground">
                  No domain claims configured yet.
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
                          {claimStatusLabel(claim.claim_status)}
                        </Badge>
                      </div>
                      {claim.claim_status === 'pending' &&
                        claim.active_challenge_label &&
                        claim.active_challenge_value && (
                          <div className="rounded border border-dashed p-2 text-xs text-muted-foreground space-y-1">
                            <div>Add DNS TXT record, then click Verify:</div>
                            <div>
                              Host: <code>{claim.active_challenge_label}</code>
                            </div>
                            <div>
                              Value: <code>{claim.active_challenge_value}</code>
                            </div>
                          </div>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {(claim.claim_status === 'advisory' ||
                        claim.claim_status === 'rejected' ||
                        claim.claim_status === 'revoked') && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleRequestClaim(claim.domain)}
                          disabled={Boolean(claimActionKey)}
                        >
                          Request
                        </Button>
                      )}
                      {claim.claim_status === 'pending' && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleVerifyClaim(claim.id)}
                            disabled={Boolean(claimActionKey)}
                          >
                            Verify
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleRefreshChallenge(claim.id)}
                            disabled={Boolean(claimActionKey)}
                          >
                            Refresh Challenge
                          </Button>
                        </>
                      )}
                      {(claim.claim_status === 'pending' ||
                        claim.claim_status === 'verified' ||
                        claim.claim_status === 'verified_legacy') && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRevokeClaim(claim.id)}
                          disabled={Boolean(claimActionKey)}
                        >
                          Revoke
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
                Refresh
              </Button>
            </div>
          </>
        ) : (
          <>
            <Alert variant="info">
              <AlertDescription>
                Advisory mode: domain registration helps route MSP SSO discovery but does not require ownership
                verification in Community Edition.
              </AlertDescription>
            </Alert>
            <div className="space-y-2">
              <Label htmlFor="msp-sso-domain-add-input">Add login domain</Label>
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
                  Add
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {domains.length === 0 ? (
                <div className="rounded border border-dashed p-3 text-sm text-muted-foreground">
                  No domains configured. Unknown domains will use app-level provider fallback.
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
                      aria-label={`Remove domain ${index + 1}`}
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
                Refresh
              </Button>

              <Button
                id="msp-sso-domains-save"
                type="button"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save Domains'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

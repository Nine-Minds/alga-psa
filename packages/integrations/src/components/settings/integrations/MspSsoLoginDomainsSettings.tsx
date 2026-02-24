'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  listMspSsoLoginDomains,
  saveMspSsoLoginDomains,
} from '@alga-psa/integrations/actions';
import { useToast } from '@alga-psa/ui/hooks/use-toast';

export function MspSsoLoginDomainsSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [domains, setDomains] = React.useState<string[]>([]);
  const [newDomain, setNewDomain] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>MSP SSO Login Domains</CardTitle>
        <CardDescription>
          Configure domains used to scope MSP login SSO provider discovery before user authentication.
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
        ) : (
          <>
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

"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "server/src/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "server/src/components/ui/Card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "server/src/components/ui/Table";
import { Alert, AlertDescription } from "server/src/components/ui/Alert";
import { Badge } from "server/src/components/ui/Badge";
import { Input } from "server/src/components/ui/Input";
import { Label } from "server/src/components/ui/Label";
import { Loader2, ShieldCheck } from "lucide-react";
import { useToast } from "server/src/hooks/use-toast";
import {
  executeBulkSsoAssignmentAction,
  previewBulkSsoAssignmentAction,
  type SsoBulkAssignmentActionResponse,
  type SsoBulkAssignmentDetail,
  type SsoBulkAssignmentProviderSummary,
  type SsoBulkAssignmentRequest,
  type SsoBulkAssignmentResult,
} from "@ee/lib/actions/ssoActions";

interface ProviderOption {
  id: string;
  name: string;
  description: string;
  configured: boolean;
}

interface SsoBulkAssignmentFormProps {
  providerOptions: ProviderOption[];
}

type LinkProvider = "google" | "microsoft";

function normalizeProvider(id: string): LinkProvider | null {
  if (id === "google") return "google";
  if (id === "microsoft" || id === "azure-ad") return "microsoft";
  return null;
}

function buildRequest(
  provider: LinkProvider | null,
  domainsInput: string,
): SsoBulkAssignmentRequest {
  const normalizedDomains = domainsInput
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);

  return {
    providers: provider ? [provider] : [],
    domains: normalizedDomains,
    userType: "internal",
  };
}

function formatProviderName(provider: LinkProvider): string {
  return provider === "microsoft" ? "Microsoft 365" : "Google Workspace";
}

function summarizeByStatus(details: SsoBulkAssignmentDetail[], provider: LinkProvider) {
  const base = {
    linked: 0,
    would_link: 0,
    already_linked: 0,
    skipped_inactive: 0,
  };

  return details.reduce((acc, detail) => {
    if (detail.provider !== provider) {
      return acc;
    }
    acc[detail.status] = (acc[detail.status] ?? 0) + 1;
    return acc;
  }, base as Record<string, number>);
}

export default function SsoBulkAssignmentForm({ providerOptions }: SsoBulkAssignmentFormProps) {
  const providerMetadata = useMemo(() => {
    const map = new Map<LinkProvider, ProviderOption>();
    providerOptions.forEach((option) => {
      const normalized = normalizeProvider(option.id);
      if (normalized) {
        map.set(normalized, option);
      }
    });
    return map;
  }, [providerOptions]);

  const configuredProviders = useMemo(
    () =>
      Array.from(providerMetadata.entries())
        .filter(([, option]) => option.configured)
        .map(([provider]) => provider),
    [providerMetadata]
  );

  const fallbackProviders = useMemo(
    () => Array.from(providerMetadata.keys()),
    [providerMetadata]
  );

  const initialProvider = configuredProviders[0] ?? fallbackProviders[0] ?? null;

  const [selectedProvider, setSelectedProvider] = useState<LinkProvider | null>(initialProvider);
  const [domainsInput, setDomainsInput] = useState("");
  const [result, setResult] = useState<SsoBulkAssignmentResult | null>(null);
  const [lastMode, setLastMode] = useState<"preview" | "execute" | null>(null);
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  const selectedProviderConfigured =
    selectedProvider !== null ? providerMetadata.get(selectedProvider)?.configured ?? false : false;

  const runAction = (mode: "preview" | "execute") => {
    const request = buildRequest(selectedProvider, domainsInput);

    if (request.providers.length === 0) {
      toast({
        variant: "destructive",
        description: "Select a configured provider before continuing.",
      });
      return;
    }

    if (request.domains.length === 0) {
      toast({
        variant: "destructive",
        description: "Enter at least one email domain to match against.",
      });
      return;
    }

    startTransition(async () => {
      let response: SsoBulkAssignmentActionResponse;

      if (mode === "preview") {
        response = await previewBulkSsoAssignmentAction(request);
      } else {
        response = await executeBulkSsoAssignmentAction(request);
      }

      if (!response.success || !response.result) {
        toast({
          variant: "destructive",
          description: response.error ?? "Unable to process SSO bulk assignment.",
        });
        return;
      }

      setResult(response.result);
      setLastMode(mode);

      const linkedCount = response.result.summary.providers.reduce(
        (total, provider) => total + provider.linked,
        0,
      );

      toast({
        description:
          mode === "execute"
            ? `Linked ${linkedCount} accounts via ${formatProviderName(request.providers[0] as LinkProvider)}.`
            : "Preview ready. Review the summary before linking accounts.",
      });
    });
  };

  const handlePreview = () => runAction("preview");
  const handleExecute = () => runAction("execute");

  const summaryProviders: SsoBulkAssignmentProviderSummary[] = result?.summary.providers ?? [];

  const disableActions =
    isPending || !selectedProvider || !selectedProviderConfigured || domainsInput.trim().length === 0;

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Choose provider & domain</CardTitle>
          <CardDescription>
            Pick the configured SSO provider for your staff and enter the domain you want to auto-link. We’ll match emails that end with the domain you provide.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Provider</Label>
            <div className="flex flex-wrap gap-2">
              {Array.from(providerMetadata.entries()).map(([provider, option]) => {
                const selected = selectedProvider === provider;
                return (
                  <Button
                    key={provider}
                    type="button"
                    variant={selected ? "default" : "outline"}
                    onClick={() => setSelectedProvider(provider)}
                    disabled={!option.configured || isPending}
                  >
                    {option.name}
                    {!option.configured && (
                      <Badge className="ml-2" variant="secondary">
                        Not configured
                      </Badge>
                    )}
                  </Button>
                );
              })}
            </div>
            {!selectedProviderConfigured && (
              <Alert variant="info" className="mt-4">
                <AlertDescription>
                  Provide OAuth credentials for this provider before linking accounts.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="sso-domain">Email domain</Label>
            <Input
              id="sso-domain"
              placeholder="examplemsp.com"
              value={domainsInput}
              onChange={(event) => setDomainsInput(event.target.value)}
              disabled={isPending}
            />
            <p className="text-sm text-muted-foreground">
              Use commas for additional domains (e.g. <code>examplemsp.com, support.examplemsp.com</code>).
            </p>
          </div>

          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertDescription>
              Bulk SSO changes are limited to workspace admins (the <code>settings.update</code> permission). We log every run for auditing.
            </AlertDescription>
          </Alert>
          <Alert variant="info">
            <AlertDescription>
              Client portal bulk assignments are coming soon. For now, this tool applies only to internal MSP users.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={handlePreview} disabled={disableActions}>
          {isPending && lastMode === "preview" ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing preview…
            </>
          ) : (
            "Preview assignment"
          )}
        </Button>
        <Button type="button" onClick={handleExecute} disabled={disableActions}>
          {isPending && lastMode === "execute" ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Linking accounts…
            </>
          ) : (
            "Link accounts"
          )}
        </Button>
      </div>

      {result && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>
                {lastMode === "execute" ? "Assignment complete" : "Preview results"}
              </CardTitle>
              <CardDescription>
                {result.summary.scannedUsers === 0
                  ? "No users matched the selected domains."
                  : `Scanned ${result.summary.scannedUsers} users.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {summaryProviders.map((summary) => {
                  const provider = summary.provider as LinkProvider;
                  const statusCounts = summarizeByStatus(result.details, provider);
                  return (
                    <div
                      key={summary.provider}
                      className="rounded-lg border border-muted-foreground/20 p-4 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-muted-foreground">
                          {formatProviderName(provider)}
                        </p>
                        <Badge variant="secondary">{summary.candidates} matched</Badge>
                      </div>
                      <dl className="mt-3 space-y-1 text-sm">
                        <div className="flex justify-between">
                          <dt>{lastMode === "execute" ? "Linked" : "Would link"}</dt>
                          <dd className="font-semibold">
                            {lastMode === "execute" ? summary.linked : statusCounts.would_link}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt>Already linked</dt>
                          <dd>{summary.alreadyLinked}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt>Skipped (inactive)</dt>
                          <dd>{summary.skippedInactive}</dd>
                        </div>
                      </dl>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {result.details.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Sample matches</CardTitle>
                <CardDescription>Showing up to 20 recent matches across the selected provider.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.details.slice(0, 20).map((detail, index) => (
                        <TableRow key={`${detail.userId}-${detail.provider}-${index}`}>
                          <TableCell>{detail.email}</TableCell>
                          <TableCell>{formatProviderName(detail.provider as LinkProvider)}</TableCell>
                          <TableCell className="capitalize">
                            {detail.status.replace("_", " ")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

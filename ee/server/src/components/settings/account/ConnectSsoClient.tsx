"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { authorizeSsoLinkingAction } from "@ee/lib/actions/auth/connectSso";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "server/src/components/ui/Card";
import { Input } from "server/src/components/ui/Input";
import { Label } from "server/src/components/ui/Label";
import { Button } from "server/src/components/ui/Button";
import { Alert, AlertDescription } from "server/src/components/ui/Alert";
import { Badge } from "server/src/components/ui/Badge";
import clsx from "clsx";
import { Loader2, ShieldCheck, KeyRound, LogIn, Network } from "lucide-react";

interface LinkedAccount {
  provider: string;
  provider_account_id: string;
  provider_email: string | null;
  linked_at: string;
  last_used_at: string | null;
}

interface ProviderOption {
  id: string;
  name: string;
  description: string;
  configured: boolean;
}

interface ConnectSsoClientProps {
  email: string;
  twoFactorEnabled: boolean;
  linkedAccounts: LinkedAccount[];
  providerOptions: ProviderOption[];
  linkStatus?: "linked" | "error";
}

export default function ConnectSsoClient({
  email,
  twoFactorEnabled,
  linkedAccounts,
  providerOptions,
  linkStatus,
}: ConnectSsoClientProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(twoFactorEnabled);
  const [reauthNonce, setReauthNonce] = useState<string | null>(null);
  const [reauthNonceIssuedAt, setReauthNonceIssuedAt] = useState<number | null>(null);
  const [reauthNonceSignature, setReauthNonceSignature] = useState<string | null>(null);
  const [reauthComplete, setReauthComplete] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(
    linkStatus === "linked" ? "Provider linked successfully." : null
  );
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (linkStatus === "linked") {
      setReauthComplete(false);
      setReauthNonce(null);
      setReauthNonceIssuedAt(null);
      setReauthNonceSignature(null);
      setPassword("");
      setTwoFactorCode("");
    }
  }, [linkStatus]);

  const hasConfiguredProvider = useMemo(
    () => providerOptions.some((provider) => provider.configured),
    [providerOptions]
  );

  const handleAuthorize = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    startTransition(async () => {
      const result = await authorizeSsoLinkingAction({
        password,
        twoFactorCode: twoFactorCode || undefined,
      });

      if (!result.success) {
        setFormError(result.error ?? "Unable to verify credentials.");
        if (result.requiresTwoFactor) {
          setRequiresTwoFactor(true);
        }
        setReauthComplete(false);
        setReauthNonce(null);
        return;
      }

      setReauthComplete(true);
      setReauthNonce(result.nonce ?? null);
      setReauthNonceIssuedAt(result.nonceIssuedAt ?? null);
      setReauthNonceSignature(result.nonceSignature ?? null);
      setFormSuccess(
        "Credentials verified. Choose a provider below to finish linking your account."
      );
      setFormError(null);
    });
  };

  const handleProviderClick = async (providerId: string) => {
    if (!reauthComplete || !reauthNonce || !reauthNonceIssuedAt || !reauthNonceSignature) {
      setFormError(
        "Verify your password (and two-factor code if required) before connecting a provider."
      );
      return;
    }

    const statePayload = {
      mode: "link",
      nonce: reauthNonce,
      nonceIssuedAt: reauthNonceIssuedAt,
      nonceSignature: reauthNonceSignature,
      provider: providerId,
      email,
    };

    const jsonState = JSON.stringify(statePayload);
    const encoder = new TextEncoder();
    const ascii = Array.from(encoder.encode(jsonState))
      .map((byte) => String.fromCharCode(byte))
      .join("");
    const base64 = btoa(ascii);
    const encodedState = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

    await signIn(
      providerId,
      {
        callbackUrl: "/msp/account/sso?linked=1",
      },
      {
        state: encodedState,
        prompt: "login",
      }
    );
  };

  const handleReset = () => {
    setPassword("");
    setTwoFactorCode("");
    setReauthNonce(null);
    setReauthNonceIssuedAt(null);
    setReauthNonceSignature(null);
    setReauthComplete(false);
    setFormError(null);
    setFormSuccess(null);
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Secure your account with SSO
          </CardTitle>
          <CardDescription>
            Link Azure AD or Google Workspace to reuse organizational policies and skip local two-factor prompts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAuthorize} className="space-y-4 max-w-xl">
            <div>
              <Label htmlFor="email">Signed in as</Label>
              <Input id="email" value={email} disabled className="bg-muted/50" />
            </div>
            <div>
              <Label htmlFor="password">Current password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            {requiresTwoFactor && (
              <div>
                <Label htmlFor="twoFactor">Two-factor code</Label>
                <Input
                  id="twoFactor"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={twoFactorCode}
                  onChange={(event) => setTwoFactorCode(event.target.value)}
                  placeholder="123456"
                  maxLength={6}
                />
              </div>
            )}
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            {formSuccess && (
              <Alert>
                <AlertDescription>{formSuccess}</AlertDescription>
              </Alert>
            )}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <KeyRound className="mr-2 h-4 w-4" />
                    Verify Credentials
                  </>
                )}
              </Button>
              {reauthComplete && (
                <Button type="button" variant="ghost" onClick={handleReset}>
                  Reset
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LogIn className="h-5 w-5 text-primary" /> Connect a provider
          </CardTitle>
          <CardDescription>
            Choose a provider to finish the SSO link. You’ll be redirected through the provider’s login flow.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasConfiguredProvider && (
            <Alert variant="destructive">
              <AlertDescription>
                No SSO providers are configured for this environment. Ask your administrator to configure Google or Microsoft credentials.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {providerOptions.map((provider) => {
              const disabled = !provider.configured || !reauthComplete || !reauthNonce;

              return (
                <Card
                  key={provider.id}
                  className={clsx(
                    "border transition",
                    disabled ? "opacity-60" : "hover:border-primary"
                  )}
                >
                  <CardContent className="flex min-h-[130px] flex-col justify-between p-4">
                    <div className="flex items-center gap-3">
                      <Network className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-semibold">{provider.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {provider.description}
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      className="mt-4"
                      disabled={disabled}
                      onClick={() => handleProviderClick(provider.id)}
                    >
                      Link {provider.name}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Linked accounts</CardTitle>
          <CardDescription>
            We’ll refresh the link the next time you sign in through a connected provider.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {linkedAccounts.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No SSO providers linked yet. Complete the steps above to connect one.
            </p>
          ) : (
            <div className="space-y-3">
              {linkedAccounts.map((account) => (
                <div
                  key={`${account.provider}-${account.provider_account_id}`}
                  className="flex flex-col gap-2 rounded-md border p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="capitalize">
                        {account.provider}
                      </Badge>
                      <span className="text-sm font-medium">
                        {account.provider_email ?? email}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Linked {new Date(account.linked_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground md:text-right">
                    {account.last_used_at ? (
                      <>Last used {new Date(account.last_used_at).toLocaleString()}</>
                    ) : (
                      <>Not used yet</>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

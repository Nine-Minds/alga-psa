"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { authorizeSsoLinkingAction } from "@ee/lib/actions/auth/connectSso";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@alga-psa/ui/components/Card";
import { Input } from "@alga-psa/ui/components/Input";
import { Label } from "@alga-psa/ui/components/Label";
import { Button } from "@alga-psa/ui/components/Button";
import { Alert, AlertDescription } from "@alga-psa/ui/components/Alert";
import { Badge } from "@alga-psa/ui/components/Badge";
import clsx from "clsx";
import { Loader2, ShieldCheck, KeyRound, LogIn } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";

type ProviderBranding = {
  icon: ReactNode;
  iconBg: string;
  buttonLabelKey: string;
  buttonClass?: string;
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
  cardClass?: string;
};

const MicrosoftMulticolorLogo = () => (
  <svg className="h-16 w-16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="2" width="8" height="8" fill="#F25022" />
    <rect x="14" y="2" width="8" height="8" fill="#7FBA00" />
    <rect x="2" y="14" width="8" height="8" fill="#00A4EF" />
    <rect x="14" y="14" width="8" height="8" fill="#FFB900" />
  </svg>
);

const providerBranding: Record<string, ProviderBranding> = {
  google: {
    icon: <SiGoogle className="h-16 w-16" style={{ color: "#34A853" }} aria-hidden />,
    iconBg: "bg-[#E8F0FE]",
    buttonLabelKey: "connectSso.providers.branding.google",
    buttonClass: "bg-[#34A853] hover:bg-[#2d8659] text-white",
    buttonVariant: "default",
    cardClass: "hover:shadow-lg hover:shadow-[#34A853]/10",
  },
  "azure-ad": {
    icon: <MicrosoftMulticolorLogo />,
    iconBg: "bg-[#F3F2F1]",
    buttonLabelKey: "connectSso.providers.branding.microsoft",
    buttonClass: "bg-[#0078D4] hover:bg-[#005a9e] text-white",
    buttonVariant: "default",
    cardClass: "hover:shadow-lg hover:shadow-[#0078D4]/10",
  },
  microsoft: {
    icon: <MicrosoftMulticolorLogo />,
    iconBg: "bg-[#F3F2F1]",
    buttonLabelKey: "connectSso.providers.branding.microsoft",
    buttonClass: "bg-[#0078D4] hover:bg-[#005a9e] text-white",
    buttonVariant: "default",
    cardClass: "hover:shadow-lg hover:shadow-[#0078D4]/10",
  },
  default: {
    icon: <LogIn className="h-16 w-16 text-primary" aria-hidden />,
    iconBg: "bg-primary/10",
    buttonLabelKey: "connectSso.providers.branding.default",
    buttonVariant: "secondary",
    cardClass: "hover:shadow-md hover:shadow-primary/10",
  },
};

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
  const { t } = useTranslation("msp/profile");
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
    linkStatus === "linked" ? t("connectSso.verify.linkedSuccess") : null
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
        setFormError(result.error ?? t("connectSso.verify.verifyFailed"));
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
      setFormSuccess(t("connectSso.verify.credentialsVerified"));
      setFormError(null);
    });
  };

  const handleProviderClick = async (providerId: string) => {
    if (!reauthComplete || !reauthNonce || !reauthNonceIssuedAt || !reauthNonceSignature) {
      setFormError(t("connectSso.verify.verifyBeforeProvider"));
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
        callbackUrl: "/msp/profile?tab=Single%20Sign-On&linked=1",
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
            <ShieldCheck className="h-5 w-5 text-primary" /> {t("connectSso.verify.title")}
          </CardTitle>
          <CardDescription>
            {t("connectSso.verify.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAuthorize} className="space-y-4 max-w-xl">
            <div>
              <Label htmlFor="email">{t("connectSso.verify.signedInAs")}</Label>
              <Input id="email" value={email} disabled className="bg-muted/50" />
            </div>
            <div>
              <Label htmlFor="password">{t("connectSso.verify.currentPassword")}</Label>
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
                <Label htmlFor="twoFactor">{t("connectSso.verify.twoFactorCode")}</Label>
                <Input
                  id="twoFactor"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={twoFactorCode}
                  onChange={(event) => setTwoFactorCode(event.target.value)}
                  placeholder={t("connectSso.verify.twoFactorPlaceholder")}
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
              <Button id="verify-credentials" type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("connectSso.verify.verifying")}
                  </>
                ) : (
                  <>
                    <KeyRound className="mr-2 h-4 w-4" />
                    {t("connectSso.verify.verifyCredentials")}
                  </>
                )}
              </Button>
              {reauthComplete && (
                <Button id="reset" type="button" variant="ghost" onClick={handleReset}>
                  {t("connectSso.verify.reset")}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LogIn className="h-5 w-5 text-primary" /> {t("connectSso.providers.title")}
          </CardTitle>
          <CardDescription>
            {t("connectSso.providers.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasConfiguredProvider && (
            <Alert variant="destructive">
              <AlertDescription>
                {t("connectSso.providers.noneConfigured")}
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {providerOptions.map((provider) => {
              const disabled = !provider.configured || !reauthComplete || !reauthNonce;
              const branding = providerBranding[provider.id] ?? providerBranding.default;

              return (
                <div
                  key={provider.id}
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  onClick={() => {
                    if (!disabled) {
                      void handleProviderClick(provider.id);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (!disabled && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      void handleProviderClick(provider.id);
                    }
                  }}
                  className={clsx(
                    "p-8 rounded-lg border-2 transition-all duration-200",
                    branding.cardClass,
                    disabled ? "opacity-50 cursor-not-allowed" : "hover:shadow-md cursor-pointer"
                  )}
                  style={{
                    borderColor:
                      provider.id === "google" ? "#4285F4" :
                      provider.id === "azure-ad" || provider.id === "microsoft" ? "#6264A7" :
                      "var(--color-primary)",
                    backgroundColor:
                      provider.id === "google" ? "rgba(66, 133, 244, 0.05)" :
                      provider.id === "azure-ad" || provider.id === "microsoft" ? "rgba(98, 100, 167, 0.05)" :
                      "rgba(var(--color-primary-rgb), 0.05)"
                  }}
                >
                  <div className="flex flex-col items-center text-center space-y-4">
                    <div className={clsx(
                      "w-32 h-32 rounded-full flex items-center justify-center flex-shrink-0",
                      branding.iconBg
                    )}>
                      {branding.icon}
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg mb-2">{provider.name}</h3>
                      <p className="text-sm text-muted-foreground">{provider.description}</p>
                      {!provider.configured && (
                        <p className="text-xs text-destructive mt-2 font-medium">
                          {t("connectSso.providers.notConfigured")}
                        </p>
                      )}
                    </div>
                    <Button
                      id={`provider-${provider.id}`}
                      type="button"
                      className={clsx(
                        "w-full mt-4",
                        branding.buttonClass
                      )}
                      variant={branding.buttonVariant ?? "secondary"}
                      disabled={disabled}
                      onClick={() => {
                        void handleProviderClick(provider.id);
                      }}
                    >
                      {t(branding.buttonLabelKey)}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("connectSso.linked.title")}</CardTitle>
          <CardDescription>
            {t("connectSso.linked.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {linkedAccounts.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("connectSso.linked.empty")}
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
                      {t("connectSso.linked.linkedAt", { date: new Date(account.linked_at).toLocaleString() })}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground md:text-right">
                    {account.last_used_at
                      ? t("connectSso.linked.lastUsed", { date: new Date(account.last_used_at).toLocaleString() })
                      : t("connectSso.linked.notUsedYet")}
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

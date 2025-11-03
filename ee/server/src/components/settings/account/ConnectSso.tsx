import { redirect } from "next/navigation";
import { auth } from "server/src/app/api/auth/[...nextauth]/auth";
import User from "server/src/lib/models/user";
import { listOAuthAccountLinksForUser } from "@ee/lib/auth/oauthAccountLinks";
import ConnectSsoClient from "./ConnectSsoClient";

interface ConnectSsoProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

function getFirstQueryValue(value: string | string[] | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return Array.isArray(value) ? value[0] : value;
}

function resolveProviderOptions() {
  return [
    {
      id: "google",
      name: "Google Workspace",
      description: "Let users sign in with their Google-managed identity.",
      configured:
        Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET),
    },
    {
      id: "azure-ad",
      name: "Microsoft 365 (Azure AD)",
      description: "Allow Azure Active Directory accounts to access Alga PSA.",
      configured:
        Boolean(process.env.MICROSOFT_OAUTH_CLIENT_ID && process.env.MICROSOFT_OAUTH_CLIENT_SECRET),
    },
  ];
}

export default async function ConnectSso({ searchParams }: ConnectSsoProps) {
  const session = await auth();

  if (!session?.user?.email || !session.user.id) {
    redirect("/auth/msp/signin");
  }

  const email = session.user.email;

  const userRecord = await User.findUserByEmail(email.toLowerCase());
  if (!userRecord || !userRecord.user_id) {
    redirect("/auth/msp/signin");
  }

  const linkedAccountRecords = userRecord.tenant
    ? await listOAuthAccountLinksForUser(userRecord.tenant, userRecord.user_id.toString())
    : [];

  const linkedAccounts = linkedAccountRecords.map((record) => ({
    provider: record.provider,
    provider_account_id: record.provider_account_id,
    provider_email: record.provider_email,
    linked_at: record.linked_at?.toISOString?.() ?? new Date(record.linked_at).toISOString(),
    last_used_at: record.last_used_at
      ? record.last_used_at instanceof Date
        ? record.last_used_at.toISOString()
        : new Date(record.last_used_at).toISOString()
      : null,
  }));

  const statusParam = getFirstQueryValue(searchParams?.linked);
  const linkStatus = statusParam === "1" ? "linked" : undefined;

  return (
    <ConnectSsoClient
      email={email}
      twoFactorEnabled={Boolean(userRecord.two_factor_enabled)}
      linkedAccounts={linkedAccounts}
      providerOptions={resolveProviderOptions()}
      linkStatus={linkStatus}
    />
  );
}

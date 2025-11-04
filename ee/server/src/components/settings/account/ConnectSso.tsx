import { redirect } from "next/navigation";
import { auth } from "server/src/app/api/auth/[...nextauth]/auth";
import User from "server/src/lib/models/user";
import { listOAuthAccountLinksForUser } from "@ee/lib/auth/oauthAccountLinks";
import ConnectSsoClient from "./ConnectSsoClient";
import { getSsoProviderOptions } from "@ee/lib/auth/providerConfig";

interface ConnectSsoProps {
  searchParams?:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
}

function getFirstQueryValue(value: string | string[] | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return Array.isArray(value) ? value[0] : value;
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

  const resolvedSearchParams = await Promise.resolve(searchParams);
  const statusParam = getFirstQueryValue(resolvedSearchParams?.linked);
  const linkStatus = statusParam === "1" ? "linked" : undefined;

  const providerOptions = await getSsoProviderOptions();

  return (
    <ConnectSsoClient
      email={email}
      twoFactorEnabled={Boolean(userRecord.two_factor_enabled)}
      linkedAccounts={linkedAccounts}
      providerOptions={providerOptions}
      linkStatus={linkStatus}
    />
  );
}

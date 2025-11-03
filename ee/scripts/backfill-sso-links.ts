#!/usr/bin/env tsx

import { exit } from "process";
import logger from "@alga-psa/shared/core/logger";
import { getAdminConnection } from "@shared/db/admin";
import {
  upsertOAuthAccountLink,
  findOAuthAccountLink,
  OAuthLinkProvider,
} from "@ee/lib/auth/oauthAccountLinks";

interface CliOptions {
  provider: OAuthLinkProvider;
  domains: string[];
  dryRun: boolean;
  userType: "internal" | "client";
}

function parseArgs(argv: string[]): CliOptions | null {
  let provider: OAuthLinkProvider | undefined;
  const domains: string[] = [];
  let dryRun = false;
  let userType: "internal" | "client" = "internal";

  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg.startsWith("--provider=")) {
      const value = arg.split("=", 2)[1]?.trim().toLowerCase();
      if (value === "google" || value === "microsoft") {
        provider = value === "google" ? "google" : "microsoft";
      }
      continue;
    }

    if (arg.startsWith("--domain=")) {
      const value = arg.split("=", 2)[1];
      if (value) {
        value
          .split(",")
          .map((part) => part.trim().toLowerCase())
          .filter(Boolean)
          .forEach((domain) => domains.push(domain));
      }
      continue;
    }

    if (arg.startsWith("--user-type=")) {
      const value = arg.split("=", 2)[1]?.trim().toLowerCase();
      if (value === "client") {
        userType = "client";
      }
      continue;
    }
  }

  if (!provider || domains.length === 0) {
    return null;
  }

  return { provider, domains, dryRun, userType };
}

function printUsage(): void {
  console.log(`\nBackfill SSO account links\n`);
  console.log(`Usage:`);
  console.log(`  pnpm tsx ee/scripts/backfill-sso-links.ts --provider=<google|microsoft> --domain=example.com[,another.com] [--user-type=client] [--dry-run]`);
  console.log(``);
  console.log(`Examples:`);
  console.log(`  pnpm tsx ee/scripts/backfill-sso-links.ts --provider=google --domain=example.com`);
  console.log(`  pnpm tsx ee/scripts/backfill-sso-links.ts --provider=microsoft --domain=contoso.com,fabrikam.com --user-type=client --dry-run`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    printUsage();
    exit(1);
  }

  const knex = await getAdminConnection();

  try {
    console.log(`\n🔍 Searching for ${options.userType} users with domains: ${options.domains.join(", ")}`);

    const domainPatterns = options.domains.map((domain) => `%@${domain}`);

    const users = await knex('users')
      .select('user_id', 'email', 'tenant', 'user_type', 'is_inactive')
      .where({ user_type: options.userType })
      .andWhere((builder) => {
        domainPatterns.forEach((pattern, index) => {
          if (index === 0) {
            builder.whereRaw('lower(email) like ?', [pattern]);
          } else {
            builder.orWhereRaw('lower(email) like ?', [pattern]);
          }
        });
      });

    if (users.length === 0) {
      console.log('No matching users found.');
      return;
    }

    const summary = {
      scanned: users.length,
      skippedInactive: 0,
      alreadyLinked: 0,
      linked: 0,
    };

    for (const user of users) {
      if (user.is_inactive) {
        summary.skippedInactive += 1;
        continue;
      }

      const providerAccountId = user.email.toLowerCase();
      const existingLink = await findOAuthAccountLink(options.provider, providerAccountId);

      if (existingLink && existingLink.user_id === user.user_id) {
        summary.alreadyLinked += 1;
        continue;
      }

      if (options.dryRun) {
        console.log(`DRY RUN: Would link ${user.email} (${user.user_id}) to ${options.provider}`);
        summary.linked += 1;
        continue;
      }

      await upsertOAuthAccountLink({
        tenant: user.tenant,
        userId: user.user_id,
        provider: options.provider,
        providerAccountId,
        providerEmail: user.email,
        metadata: { source: 'backfill-script', domains: options.domains },
      });

      summary.linked += 1;
      console.log(`Linked ${user.email} to ${options.provider}`);
    }

    console.log('\nSummary');
    console.log(`  Scanned users:       ${summary.scanned}`);
    console.log(`  Skipped (inactive): ${summary.skippedInactive}`);
    console.log(`  Already linked:     ${summary.alreadyLinked}`);
    console.log(`  ${options.dryRun ? 'Would link' : 'Linked'}:        ${summary.linked}`);
  } catch (error) {
    logger.error('[backfill-sso-links] Failed to run migration script', error);
    exit(1);
  } finally {
    await knex.destroy();
  }
}

main();

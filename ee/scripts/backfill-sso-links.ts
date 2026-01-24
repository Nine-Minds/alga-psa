#!/usr/bin/env tsx

import { exit } from "process";
import logger from "@alga-psa/core/logger";
import { getAdminConnection } from "@alga-psa/db/admin";
import type { Knex } from "knex";
import type { OAuthLinkProvider } from "@ee/lib/auth/oauthAccountLinks";
import {
  previewBulkSsoAssignment,
  executeBulkSsoAssignment,
} from "@ee/lib/actions/ssoActions";

interface CliOptions {
  provider: OAuthLinkProvider;
  domains: string[];
  dryRun: boolean;
  userType: "internal" | "client";
  tenant: string;
}

function parseArgs(argv: string[]): CliOptions | null {
  let provider: OAuthLinkProvider | undefined;
  const domains: string[] = [];
  let dryRun = false;
  let userType: "internal" | "client" = "internal";
  let tenant: string | undefined;

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

    if (arg.startsWith("--tenant=")) {
      tenant = arg.split("=", 2)[1]?.trim();
      continue;
    }
  }

  if (!provider || domains.length === 0 || !tenant) {
    return null;
  }

  return { provider, domains, dryRun, userType, tenant };
}

function printUsage(): void {
  console.log(`\nBackfill SSO account links\n`);
  console.log(`Usage:`);
  console.log(
    `  pnpm tsx ee/scripts/backfill-sso-links.ts --provider=<google|microsoft> --domain=example.com[,another.com] --tenant=<tenant-uuid> [--user-type=client] [--dry-run]`
  );
  console.log(``);
  console.log(`Examples:`);
  console.log(
    `  pnpm tsx ee/scripts/backfill-sso-links.ts --provider=google --domain=example.com --tenant=00000000-0000-0000-0000-000000000000`
  );
  console.log(
    `  pnpm tsx ee/scripts/backfill-sso-links.ts --provider=microsoft --domain=contoso.com,fabrikam.com --tenant=00000000-0000-0000-0000-000000000000 --user-type=client --dry-run`
  );
}

async function findUserIdsForDomains(
  knex: Knex,
  tenant: string,
  domains: string[],
  userType: "internal" | "client"
): Promise<{ userIds: string[]; emails: Record<string, string> }> {
  const domainPatterns = domains.map((domain) => `%@${domain.toLowerCase()}`);

  if (domainPatterns.length === 0) {
    return { userIds: [], emails: {} };
  }

  const rows = await knex('users')
    .select('user_id', 'email')
    .where({ tenant, user_type: userType })
    .andWhere((builder) => {
      builder.whereRaw('lower(email) like ?', [domainPatterns[0]]);
      for (const pattern of domainPatterns.slice(1)) {
        builder.orWhereRaw('lower(email) like ?', [pattern]);
      }
    });

  const emails: Record<string, string> = {};
  const userIds = rows.map((row) => {
    emails[row.user_id] = row.email;
    return row.user_id;
  });

  return { userIds, emails };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    printUsage();
    exit(1);
  }

  const knex = await getAdminConnection();

  try {
    console.log(
      `\n🔍 Searching for ${options.userType} users in tenant ${options.tenant} with domains: ${options.domains.join(", ")}`
    );

    const { userIds } = await findUserIdsForDomains(knex, options.tenant, options.domains, options.userType);

    if (userIds.length === 0) {
      console.log(`No ${options.userType} users matched the provided domains within tenant ${options.tenant}.`);
      return;
    }

    const payload = {
      providers: [options.provider],
      userIds,
      userType: options.userType,
    };

    console.log(`Found ${userIds.length} eligible user(s) in tenant ${options.tenant}.`);

    const result = await (options.dryRun
      ? previewBulkSsoAssignment(payload, {
          adminDb: knex,
          source: 'script',
          preview: true,
          tenant: options.tenant,
        })
      : executeBulkSsoAssignment(payload, {
          adminDb: knex,
          source: 'script',
          preview: false,
          tenant: options.tenant,
        }));

    if (result.summary.scannedUsers === 0) {
      console.log("No matching users found.");
      return;
    }

    if (options.dryRun) {
      result.details
        .filter((detail) => detail.status === "would_link")
        .forEach((detail) => {
          console.log(
            `DRY RUN: Would link ${detail.email} (${detail.userId}) to ${detail.provider}`
          );
        });
    } else {
      result.details
        .filter((detail) => detail.status === "linked")
        .forEach((detail) => {
          console.log(`Linked ${detail.email} to ${detail.provider}`);
        });
    }

    const providerSummary = result.summary.providers[0];

    console.log("\nSummary");
    console.log(`  Scanned users:       ${result.summary.scannedUsers}`);
    console.log(`  Skipped (inactive): ${providerSummary.skippedInactive}`);
    console.log(`  Already linked:     ${providerSummary.alreadyLinked}`);
    console.log(
      `  ${options.dryRun ? "Would link" : "Linked"}:        ${providerSummary.linked}`
    );
  } catch (error) {
    logger.error('[backfill-sso-links] Failed to run migration script', error);
    exit(1);
  } finally {
    await knex.destroy();
  }
}

main();

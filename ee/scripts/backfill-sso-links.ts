#!/usr/bin/env tsx

import { exit } from "process";
import logger from "@alga-psa/shared/core/logger";
import { getAdminConnection } from "@shared/db/admin";
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
    console.log(
      `\n🔍 Searching for ${options.userType} users with domains: ${options.domains.join(", ")}`
    );

    const payload = {
      providers: [options.provider],
      domains: options.domains,
      userType: options.userType,
    };

    const result = await (options.dryRun
      ? previewBulkSsoAssignment(payload, {
          adminDb: knex,
          source: 'script',
          preview: true,
        })
      : executeBulkSsoAssignment(payload, {
          adminDb: knex,
          source: 'script',
          preview: false,
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

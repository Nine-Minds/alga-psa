import path from 'path';

/**
 * ESLint rule to enforce proper migration file naming conventions.
 *
 * Migration files must:
 * 1. Be named with yyyymmddhhmm or yyyymmddhhmmss prefix (e.g., 202410311430_description.cjs or 20241031143045_description.cjs)
 * 2. Have timestamps that are not in the future (compared to current date)
 *
 * This rule only applies to files in directories containing "migration" in the path.
 *
 * IMPORTANT: Migrations before 2025-11-01 are grandfathered in and will not be checked.
 * This prevents errors on existing legacy migrations that don't follow the naming convention.
 */

const MIGRATION_FILENAME_PATTERN = /^(\d{12}(?:\d{2})?)_.*\.cjs$/;
// Only enforce the rule for migrations on or after this date (yyyymmdd format)
const CUTOFF_DATE = '20251101';

function parseTimestamp(timestampStr) {
  // Parse yyyymmddhhmm or yyyymmddhhmmss format
  const year = parseInt(timestampStr.substring(0, 4), 10);
  const month = parseInt(timestampStr.substring(4, 6), 10);
  const day = parseInt(timestampStr.substring(6, 8), 10);
  const hour = parseInt(timestampStr.substring(8, 10), 10);
  const minute = parseInt(timestampStr.substring(10, 12), 10);
  const second = timestampStr.length >= 14 ? parseInt(timestampStr.substring(12, 14), 10) : 0;

  // Validate ranges before creating Date object
  // This prevents JavaScript from auto-correcting invalid dates (e.g., month 13 -> Jan next year)
  if (month < 1 || month > 12) {
    return { valid: false, date: null };
  }
  if (day < 1 || day > 31) {
    return { valid: false, date: null };
  }
  if (hour < 0 || hour > 23) {
    return { valid: false, date: null };
  }
  if (minute < 0 || minute > 59) {
    return { valid: false, date: null };
  }
  if (second < 0 || second > 59) {
    return { valid: false, date: null };
  }

  const date = new Date(year, month - 1, day, hour, minute, second); // JS months are 0-indexed

  // Verify the date components weren't rolled over by JavaScript
  // E.g., Feb 31 becomes Mar 3, so we need to check that didn't happen
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    return { valid: false, date: null };
  }

  return { valid: true, date };
}

function isFutureDate(date) {
  const now = new Date();
  return date > now;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce proper migration file naming with yyyymmddhhmm prefix and prevent future timestamps",
      recommended: true,
    },
    schema: [], // no options
    messages: {
      invalidFormat:
        "Migration file '{{filename}}' must be named with yyyymmddhhmm or yyyymmddhhmmss prefix followed by underscore and description (e.g., 202410311430_add_users_table.cjs or 20241031143045_add_users_table.cjs)",
      futureTimestamp:
        "Migration file '{{filename}}' has a timestamp in the future ({{timestamp}}). Migration timestamps must not be later than the current date.",
      invalidTimestamp:
        "Migration file '{{filename}}' has an invalid timestamp '{{timestamp}}' that cannot be parsed as a valid date.",
    },
  },

  create(context) {
    const filename = context.getFilename();
    const basename = path.basename(filename);
    const dirname = path.dirname(filename);

    // Only check files in directories that contain "migration" in the path
    if (!dirname.includes('migration')) {
      return {};
    }

    // Only check .cjs files (migration files are CommonJS)
    if (!basename.endsWith('.cjs')) {
      return {};
    }

    // Run the check once per file (on Program node)
    return {
      Program(node) {
        // Extract the date prefix (first 8 digits = yyyymmdd) to check against cutoff
        const datePrefix = basename.substring(0, 8);

        // Skip validation for migrations before the cutoff date (grandfathered in)
        if (datePrefix < CUTOFF_DATE) {
          return;
        }

        const match = basename.match(MIGRATION_FILENAME_PATTERN);

        if (!match) {
          context.report({
            node,
            messageId: "invalidFormat",
            data: {
              filename: basename,
            },
          });
          return;
        }

        const timestampStr = match[1];
        const result = parseTimestamp(timestampStr);

        if (!result.valid) {
          context.report({
            node,
            messageId: "invalidTimestamp",
            data: {
              filename: basename,
              timestamp: timestampStr,
            },
          });
          return;
        }

        const timestamp = result.date;
        if (isFutureDate(timestamp)) {
          const formattedDate = timestamp.toISOString().replace('T', ' ').substring(0, 16);
          context.report({
            node,
            messageId: "futureTimestamp",
            data: {
              filename: basename,
              timestamp: formattedDate,
            },
          });
        }
      },
    };
  },
};

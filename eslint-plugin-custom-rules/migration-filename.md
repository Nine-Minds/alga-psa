# Migration Filename Rule

## Overview

This ESLint rule enforces proper naming conventions for database migration files to ensure consistency and prevent timestamp-related issues.

**Grandfathering**: Migrations created before **November 1, 2025** are grandfathered in and will not be validated. This prevents errors on existing legacy migrations while enforcing the standard for all new migrations going forward.

## Rule Details

Migration files created on or after November 1, 2025 must follow these requirements:

1. **Format**: Files must be named with a `yyyymmddhhmm` prefix followed by an underscore and description
   - Example: `202410311430_add_users_table.cjs`
   - Format: `{year}{month}{day}{hour}{minute}_{description}.cjs`

2. **Timestamp Validation**: The timestamp must represent a valid date and time
   - Year: 4 digits
   - Month: 01-12
   - Day: 01-31 (validated for actual calendar days)
   - Hour: 00-23
   - Minute: 00-59

3. **No Future Timestamps**: Migration timestamps must not be in the future
   - This prevents accidental future-dated migrations that could cause ordering issues

## Examples

### ✅ Valid

```javascript
// File: server/migrations/202410311430_add_users_table.cjs
exports.up = function(knex) {
  return knex.schema.createTable('users', table => {
    table.increments('id');
    table.string('name');
  });
};
```

```javascript
// File: server/migrations/202409071803_initial_schema.cjs
exports.up = function(knex) {
  // migration code
};
```

### ❌ Invalid

#### Wrong format (14 digits instead of 12)
```javascript
// File: server/migrations/20240917164841_rename_table.cjs
// Error: Migration file must be named with yyyymmddhhmm prefix
```

#### Future timestamp
```javascript
// File: server/migrations/209912312359_future_migration.cjs
// Error: Migration file has a timestamp in the future
```

#### Invalid date components
```javascript
// File: server/migrations/202413311430_invalid_month.cjs
// Error: Migration file has an invalid timestamp (month 13 doesn't exist)
```

```javascript
// File: server/migrations/202410321430_invalid_day.cjs
// Error: Migration file has an invalid timestamp (day 32 doesn't exist)
```

```javascript
// File: server/migrations/202410312530_invalid_hour.cjs
// Error: Migration file has an invalid timestamp (hour 25 doesn't exist)
```

## Configuration

The rule is configured in `eslint.config.js` to only apply to migration files:

```javascript
{
  files: ["**/migrations/**/*.cjs"],
  plugins: {
    "custom-rules": customRules,
  },
  rules: {
    "custom-rules/migration-filename": "error",
  }
}
```

## Error Messages

The rule provides three types of error messages:

1. **invalidFormat**: When the filename doesn't match the `yyyymmddhhmm_description.cjs` pattern
2. **invalidTimestamp**: When the timestamp contains invalid date/time components
3. **futureTimestamp**: When the timestamp is in the future

## Why This Rule Exists

1. **Consistency**: Ensures all migrations follow the same naming pattern
2. **Ordering**: The `yyyymmddhhmm` format ensures migrations run in the correct chronological order
3. **Prevent Future Timestamps**: Catches accidental typos or misconfigured dates that could cause migration ordering issues
4. **Validation**: Catches impossible dates (like month 13 or day 32) before they cause runtime errors

## Grandfathering Old Migrations

The rule includes a cutoff date of **November 1, 2025** (`20251101`). Any migration file with a date prefix earlier than this will be ignored by the linter, allowing existing migrations to remain unchanged.

### How It Works

The rule checks the first 8 characters of the filename (the `yyyymmdd` portion):
- If `< 20251101`: **Ignored** (grandfathered in)
- If `>= 20251101`: **Validated** (must follow all rules)

### Examples

```bash
# This old migration is ignored (grandfathered in)
server/migrations/20241002132600_add_tax_rates_tables.cjs
# ✅ No error, even though format is wrong (14 digits)

# This new migration is validated
server/migrations/20251120120000_add_accounting_export_permissions.cjs
# ❌ Error: Migration file must be named with yyyymmddhhmm prefix
```

## How to Fix Violations

1. Rename the migration file to use the correct `yyyymmddhhmm` format
2. Ensure the timestamp represents a valid date and time
3. If the timestamp is in the future, update it to the current date/time or an appropriate past date
4. Update your migration creation scripts to generate correct timestamps

## Running the Rule

The rule automatically runs when you execute ESLint on migration files:

```bash
npx eslint server/migrations/*.cjs
```

Or as part of the full lint:

```bash
npm run lint
```

## Testing

A comprehensive test suite is available in `migration-filename.test.js` that validates:
- Correct format recognition
- Invalid format detection
- Future timestamp detection
- Invalid date component detection
- Files outside migration directories are ignored

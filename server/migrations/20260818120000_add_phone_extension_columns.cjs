/**
 * Give phone extensions a column of their own.
 *
 * Until now PhoneInput packed the extension into the number itself — it wrote
 * "+1 555 234 5678 ext. 42" into a single text column — so the extension was
 * neither queryable nor separable from the number, and any attempt to normalize
 * the number to E.164 destroyed it. contact_phone_numbers was created on
 * 2026-03-09 without an extension column at all.
 *
 * This adds the columns and lifts the packed suffixes out of the existing values.
 * The parse mirrors splitPackedExtension() in @alga-psa/validation: "ext. N",
 * "ext N", "extension N", " x N" and " e N", anchored at the end of the string.
 * Numbers without a packed suffix are left byte-for-byte alone.
 *
 * Reversible: down() re-packs the extension as " ext. N" and drops the columns.
 * Both directions log before/after counts so the row counts can be compared.
 */

const TARGETS = [
  { table: 'contact_phone_numbers', number: 'phone_number', extension: 'extension' },
  { table: 'client_locations', number: 'phone', extension: 'phone_extension' },
  { table: 'client_locations', number: 'fax', extension: 'fax_extension' },
  { table: 'clients', number: 'phone_no', extension: 'phone_extension' },
  { table: 'users', number: 'phone', extension: 'phone_extension' },
];

// Anchored at end of string; group 3 is the digit run that becomes the extension.
// The bare x/e forms require a separator so a number is never mistaken for one.
const PACKED_EXTENSION_REGEX =
  '([[:space:],;]*ext(ension)?\\.?|[[:space:],;]+x\\.?|[[:space:],;]+e\\.?)[[:space:]:#]*([0-9]{1,10})[[:space:]]*$';

async function columnExists(knex, table, column) {
  if (!(await knex.schema.hasTable(table))) {
    return false;
  }
  return knex.schema.hasColumn(table, column);
}

async function countPacked(knex, table, numberColumn) {
  const result = await knex.raw(
    `SELECT COUNT(*)::int AS count FROM ?? WHERE ?? ~* ?`,
    [table, numberColumn, PACKED_EXTENSION_REGEX]
  );
  return result.rows?.[0]?.count ?? 0;
}

exports.up = async function up(knex) {
  for (const target of TARGETS) {
    if (!(await columnExists(knex, target.table, target.number))) {
      console.warn(`[phone-extension] skipping ${target.table}.${target.number} (column absent)`);
      continue;
    }

    if (!(await knex.schema.hasColumn(target.table, target.extension))) {
      // One subcommand per ALTER: Citus rejects an ALTER carrying two utility
      // subcommands with "cannot execute multiple utility events".
      await knex.raw(`ALTER TABLE ?? ADD COLUMN ?? text`, [target.table, target.extension]);
    }

    const before = await countPacked(knex, target.table, target.number);
    console.log(`[phone-extension] ${target.table}.${target.number}: ${before} packed extension(s) to lift`);

    if (before === 0) {
      continue;
    }

    // Lift the digits into the new column, then strip the suffix from the number.
    // Rows that already carry an extension keep it — the explicit value wins.
    await knex.raw(
      `UPDATE ??
          SET ?? = COALESCE(NULLIF(BTRIM(COALESCE(??, '')), ''), (REGEXP_MATCH(??, ?, 'i'))[3]),
              ?? = BTRIM(REGEXP_REPLACE(??, ?, '', 'i'))
        WHERE ?? ~* ?`,
      [
        target.table,
        target.extension,
        target.extension,
        target.number,
        PACKED_EXTENSION_REGEX,
        target.number,
        target.number,
        PACKED_EXTENSION_REGEX,
        target.number,
        PACKED_EXTENSION_REGEX,
      ]
    );

    const after = await countPacked(knex, target.table, target.number);
    const lifted = await knex.raw(
      `SELECT COUNT(*)::int AS count FROM ?? WHERE ?? IS NOT NULL AND BTRIM(??) <> ''`,
      [target.table, target.extension, target.extension]
    );
    console.log(
      `[phone-extension] ${target.table}.${target.number}: ${after} packed remaining, ` +
        `${lifted.rows?.[0]?.count ?? 0} row(s) now carry ${target.extension}`
    );
  }
};

exports.down = async function down(knex) {
  for (const target of [...TARGETS].reverse()) {
    if (!(await columnExists(knex, target.table, target.extension))) {
      continue;
    }

    const packable = await knex.raw(
      `SELECT COUNT(*)::int AS count
         FROM ??
        WHERE ?? IS NOT NULL AND BTRIM(??) <> '' AND COALESCE(BTRIM(??), '') <> ''`,
      [target.table, target.extension, target.extension, target.number]
    );
    console.log(
      `[phone-extension] re-packing ${packable.rows?.[0]?.count ?? 0} row(s) into ${target.table}.${target.number}`
    );

    await knex.raw(
      `UPDATE ??
          SET ?? = BTRIM(??) || ' ext. ' || BTRIM(??)
        WHERE ?? IS NOT NULL AND BTRIM(??) <> '' AND COALESCE(BTRIM(??), '') <> ''`,
      [
        target.table,
        target.number,
        target.number,
        target.extension,
        target.extension,
        target.extension,
        target.number,
      ]
    );

    await knex.raw(`ALTER TABLE ?? DROP COLUMN IF EXISTS ??`, [target.table, target.extension]);
  }
};

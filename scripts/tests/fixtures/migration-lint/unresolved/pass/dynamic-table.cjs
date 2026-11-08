// Literal-only substitutions resolve, loops over literal arrays are expanded,
// helper calls are inlined, and opaque values inside parentheses are harmless.
const TABLES = ['brand_new_a', 'brand_new_b'];

async function addExtra(knex, table) {
  await knex.raw('ALTER TABLE ?? ADD COLUMN IF NOT EXISTS extra int', [table]);
}

exports.up = async function (knex) {
  for (const table of TABLES) {
    await knex.raw(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS extra int`);
  }
  await addExtra(knex, 'brand_new_c');
  const list = process.env.ALLOWED.split(',').join("','");
  await knex.raw(`ALTER TABLE brand_new_a ADD COLUMN IF NOT EXISTS kind text CHECK (kind IN ('${list}'))`);
};

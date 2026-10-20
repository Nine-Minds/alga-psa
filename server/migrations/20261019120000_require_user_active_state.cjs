// users.is_inactive is a strict boolean. Seat admission and seat counts read
// `is_inactive = false` while sign-in treats any falsy value as active, so a
// null row was a working account that no seat count saw. Null has always meant
// active at sign-in; keep that meaning and forbid it from here on.
exports.up = async function(knex) {
  await knex('users').whereNull('is_inactive').update({ is_inactive: false });
  await knex.raw('ALTER TABLE users ALTER COLUMN is_inactive SET DEFAULT false, ALTER COLUMN is_inactive SET NOT NULL');
};

exports.down = async function(knex) {
  await knex.raw('ALTER TABLE users ALTER COLUMN is_inactive DROP NOT NULL');
};

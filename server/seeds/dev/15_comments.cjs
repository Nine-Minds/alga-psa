const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
  const context = await getFirstTenantSeedContext(knex);
  if (!context) return;

  const { tenantId, db } = context;
  const ticket = await db.table('tickets')
    .where({
      title: 'Missing White Rabbit',
    })
    .select('ticket_id')
    .first();
  const user = await db.table('users')
    .where({
      username: 'glinda',
    })
    .select('user_id')
    .first();

  if (!ticket || !user) return;

  const comments = [
    {
      note: 'Initial report of missing White Rabbit. Last seen heading towards the tea party.',
      is_internal: false,
      is_resolution: false,
    },
    {
      note: 'Last seen heading towards the tea party.',
      is_internal: true,
      is_resolution: false,
    },
    {
      note: 'White Rabbit was arrested at the tea party.',
      is_internal: false,
      is_resolution: true,
    },
  ];

  for (const comment of comments) {
    const ids = await knex.raw('SELECT gen_random_uuid() AS comment_id, gen_random_uuid() AS thread_id');
    const generated = ids.rows?.[0];
    const now = new Date().toISOString();

    await db.table('comment_threads').insert({
      tenant: tenantId,
      thread_id: generated.thread_id,
      ticket_id: ticket.ticket_id,
      root_comment_id: generated.comment_id,
      is_internal: comment.is_internal,
      reply_count: 0,
      last_activity_at: now,
      created_at: now,
      created_by: user.user_id,
    });

    await db.table('comments').insert({
      tenant: tenantId,
      comment_id: generated.comment_id,
      thread_id: generated.thread_id,
      ticket_id: ticket.ticket_id,
      user_id: user.user_id,
      note: comment.note,
      is_internal: comment.is_internal,
      is_resolution: comment.is_resolution,
      created_at: now,
    });
  }
};

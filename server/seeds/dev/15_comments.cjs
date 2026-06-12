exports.seed = async function (knex) {
  const tenant = await knex('tenants').select('tenant').first();
  if (!tenant) return;

  const ticket = await knex('tickets')
    .where({
      tenant: tenant.tenant,
      title: 'Missing White Rabbit',
    })
    .select('ticket_id')
    .first();
  const user = await knex('users')
    .where({
      tenant: tenant.tenant,
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

    await knex('comment_threads').insert({
      tenant: tenant.tenant,
      thread_id: generated.thread_id,
      ticket_id: ticket.ticket_id,
      root_comment_id: generated.comment_id,
      is_internal: comment.is_internal,
      reply_count: 0,
      last_activity_at: now,
      created_at: now,
      created_by: user.user_id,
    });

    await knex('comments').insert({
      tenant: tenant.tenant,
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

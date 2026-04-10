/**
 * Add description_rich_text columns to project_tasks and project_template_tasks.
 *
 * The existing `description` column is repurposed to store markdown,
 * while the new `description_rich_text` column stores the BlockNote JSON.
 *
 * Backfill:
 *   1. Copy current description → description_rich_text (it's already BlockNote JSON)
 *   2. Convert description from BlockNote JSON → markdown
 */

/**
 * Minimal BlockNote-JSON → markdown converter for migration backfill.
 * Handles the block types that the editor actually produces.
 */
function blockNoteJsonToMarkdown(json) {
  if (!json || typeof json !== 'string') return json;

  const trimmed = json.trim();
  // Only attempt parse if it looks like a BlockNote JSON array
  if (!trimmed.startsWith('[')) return json;

  let blocks;
  try {
    blocks = JSON.parse(trimmed);
  } catch {
    return json; // plain text — leave as-is
  }

  if (!Array.isArray(blocks) || blocks.length === 0) return json;

  return blocks
    .map((block) => {
      const text = extractText(block.content);

      switch (block.type) {
        case 'paragraph':
          return text;
        case 'heading': {
          const level = block.props?.level || 1;
          return '#'.repeat(level) + ' ' + text;
        }
        case 'bulletListItem':
          return '* ' + text;
        case 'numberedListItem':
          return '1. ' + text;
        case 'checkListItem': {
          const checked = block.props?.checked ? 'x' : ' ';
          return `- [${checked}] ${text}`;
        }
        case 'codeBlock': {
          const lang = block.props?.language || '';
          return '```' + lang + '\n' + text + '\n```';
        }
        case 'image': {
          const url = block.props?.url || '';
          const alt = block.props?.caption || block.props?.name || 'image';
          return url ? `![${alt}](${url})` : '';
        }
        default:
          return text;
      }
    })
    .join('\n\n');
}

function extractText(content) {
  if (!content || !Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (typeof item.text === 'string') {
        let t = item.text;
        if (item.styles) {
          if (item.styles.bold) t = `**${t}**`;
          if (item.styles.italic) t = `*${t}*`;
          if (item.styles.code) t = '`' + t + '`';
          if (item.styles.strikethrough) t = `~~${t}~~`;
        }
        return t;
      }
      if (item.type === 'mention') {
        return '@' + (item.props?.displayName || item.props?.username || '');
      }
      if (item.type === 'link' && Array.isArray(item.content)) {
        const linkText = extractText(item.content);
        return item.href ? `[${linkText}](${item.href})` : linkText;
      }
      return '';
    })
    .join('');
}

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  // 1. Add columns
  await knex.schema.alterTable('project_tasks', (table) => {
    table.text('description_rich_text').nullable();
  });

  await knex.schema.alterTable('project_template_tasks', (table) => {
    table.text('description_rich_text').nullable();
  });

  // 2. Backfill: copy existing description (BlockNote JSON) → description_rich_text
  await knex.raw(`
    UPDATE project_tasks
    SET description_rich_text = description
    WHERE description IS NOT NULL
  `);

  await knex.raw(`
    UPDATE project_template_tasks
    SET description_rich_text = description
    WHERE description IS NOT NULL
  `);

  // 3. Convert description from BlockNote JSON → markdown (row-by-row)
  const taskRows = await knex('project_tasks')
    .select('task_id', 'tenant', 'description')
    .whereNotNull('description');

  for (const row of taskRows) {
    const md = blockNoteJsonToMarkdown(row.description);
    if (md !== row.description) {
      await knex('project_tasks')
        .where({ task_id: row.task_id, tenant: row.tenant })
        .update({ description: md });
    }
  }

  const templateTaskRows = await knex('project_template_tasks')
    .select('template_task_id', 'tenant', 'description')
    .whereNotNull('description');

  for (const row of templateTaskRows) {
    const md = blockNoteJsonToMarkdown(row.description);
    if (md !== row.description) {
      await knex('project_template_tasks')
        .where({ template_task_id: row.template_task_id, tenant: row.tenant })
        .update({ description: md });
    }
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  // Restore description from description_rich_text (BlockNote JSON)
  await knex.raw(`
    UPDATE project_tasks
    SET description = description_rich_text
    WHERE description_rich_text IS NOT NULL
  `);

  await knex.raw(`
    UPDATE project_template_tasks
    SET description = description_rich_text
    WHERE description_rich_text IS NOT NULL
  `);

  await knex.schema.alterTable('project_tasks', (table) => {
    table.dropColumn('description_rich_text');
  });

  await knex.schema.alterTable('project_template_tasks', (table) => {
    table.dropColumn('description_rich_text');
  });
};

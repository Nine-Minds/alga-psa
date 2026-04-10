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
 * BlockNote-JSON → markdown converter for migration backfill.
 *
 * Mirrors the runtime converter in @alga-psa/formatting/blocknoteUtils.ts.
 * Since migrations are CJS and the runtime converter is TypeScript/ESM,
 * we maintain a parallel implementation here. The description_rich_text
 * column preserves the original BlockNote JSON, so any minor drift is
 * self-healing on first editor save.
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
        case 'table':
          return convertTableToMarkdown(block);
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
          if (item.styles.underline) t = `<u>${t}</u>`;
          if (item.styles.textColor && item.styles.textColor !== 'default') {
            t = `<span style="color:${item.styles.textColor}">${t}</span>`;
          }
          if (item.styles.backgroundColor && item.styles.backgroundColor !== 'default') {
            t = `<span style="background-color:${item.styles.backgroundColor}">${t}</span>`;
          }
        }
        return t;
      }
      if (item.type === 'mention') {
        const name = item.props?.username || item.props?.displayName || '';
        return name ? `@${name}` : '';
      }
      if (item.type === 'link' && Array.isArray(item.content)) {
        const linkText = extractText(item.content);
        const href = item.href || '';
        return href ? `[${linkText}](${href})` : linkText;
      }
      return '';
    })
    .join('');
}

function convertTableToMarkdown(block) {
  const content = block.content;
  if (!content || typeof content !== 'object' || !content.rows) return '';

  const rows = content.rows || [];
  if (rows.length === 0) return '';

  const numCols = rows[0].cells ? rows[0].cells.length : 0;
  if (numCols === 0) return '';

  let md = '';
  rows.forEach((row, rowIndex) => {
    const cells = row.cells || [];
    let rowMd = '|';
    for (let c = 0; c < numCols; c++) {
      const cell = cells[c] || [];
      let cellText = Array.isArray(cell) ? extractText(cell) : ' ';
      if (!cellText || !cellText.trim()) cellText = ' ';
      rowMd += ` ${cellText} |`;
    }
    md += rowMd + '\n';
    if (rowIndex === 0) {
      md += '|' + ' --- |'.repeat(numCols) + '\n';
    }
  });
  return md.trimEnd();
}

/**
 * Check whether a column already exists on a table (idempotent guard).
 */
async function columnExists(knex, tableName, columnName) {
  const result = await knex.raw(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = ? AND column_name = ?
    LIMIT 1
  `, [tableName, columnName]);
  return result.rows.length > 0;
}

/**
 * Convert descriptions from BlockNote JSON → markdown for a single table,
 * processing one tenant at a time to bound memory and isolate failures.
 */
async function convertDescriptions(knex, tableName, pkColumn) {
  const tenants = await knex(tableName)
    .distinct('tenant')
    .whereNotNull('description');

  for (const { tenant } of tenants) {
    await knex.transaction(async (trx) => {
      const rows = await trx(tableName)
        .select(pkColumn, 'tenant', 'description')
        .where({ tenant })
        .whereNotNull('description');

      for (const row of rows) {
        const md = blockNoteJsonToMarkdown(row.description);
        if (md !== row.description) {
          await trx(tableName)
            .where({ [pkColumn]: row[pkColumn], tenant: row.tenant })
            .update({ description: md });
        }
      }
    });
  }
}

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  // 1. Add columns (idempotent — skip if already present from a partial run)
  if (!(await columnExists(knex, 'project_tasks', 'description_rich_text'))) {
    await knex.schema.alterTable('project_tasks', (table) => {
      table.text('description_rich_text').nullable();
    });
  }

  if (!(await columnExists(knex, 'project_template_tasks', 'description_rich_text'))) {
    await knex.schema.alterTable('project_template_tasks', (table) => {
      table.text('description_rich_text').nullable();
    });
  }

  // 2. Backfill: copy existing description (BlockNote JSON) → description_rich_text
  //    Only fill rows that haven't been backfilled yet (idempotent).
  await knex.raw(`
    UPDATE project_tasks
    SET description_rich_text = description
    WHERE description IS NOT NULL
      AND description_rich_text IS NULL
  `);

  await knex.raw(`
    UPDATE project_template_tasks
    SET description_rich_text = description
    WHERE description IS NOT NULL
      AND description_rich_text IS NULL
  `);

  // 3. Convert description from BlockNote JSON → markdown, per tenant
  await convertDescriptions(knex, 'project_tasks', 'task_id');
  await convertDescriptions(knex, 'project_template_tasks', 'template_task_id');
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

  if (await columnExists(knex, 'project_tasks', 'description_rich_text')) {
    await knex.schema.alterTable('project_tasks', (table) => {
      table.dropColumn('description_rich_text');
    });
  }

  if (await columnExists(knex, 'project_template_tasks', 'description_rich_text')) {
    await knex.schema.alterTable('project_template_tasks', (table) => {
      table.dropColumn('description_rich_text');
    });
  }
};

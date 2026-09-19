const TABLE_NAME = 'standard_invoice_templates';
const SET_CODES = ['standard-default', 'standard-detailed', 'standard-grouped'];
const UNSET_CODES = ['standard-default', 'standard-detailed'];
const LETTER_PRINT_SETTINGS = { paperPreset: 'Letter', marginMm: 10.58 };

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertTemplateAst(ast, code) {
  if (!ast || typeof ast !== 'object' || Array.isArray(ast)) {
    throw new Error(`[set_standard_invoice_template_letter_margins] Expected templateAst object for ${code}.`);
  }
}

function applyPrintSettings(ast) {
  const nextAst = cloneJson(ast);

  if (!nextAst.metadata || typeof nextAst.metadata !== 'object' || Array.isArray(nextAst.metadata)) {
    nextAst.metadata = {};
  }

  nextAst.metadata.printSettings = LETTER_PRINT_SETTINGS;
  return nextAst;
}

function removePrintSettings(ast) {
  const nextAst = cloneJson(ast);

  if (nextAst.metadata && typeof nextAst.metadata === 'object' && !Array.isArray(nextAst.metadata)) {
    delete nextAst.metadata.printSettings;
  }

  return nextAst;
}

async function loadRowsByCode(knex, codes) {
  const rows = await knex(TABLE_NAME)
    .select('standard_invoice_template_code', 'templateAst')
    .whereIn('standard_invoice_template_code', codes);

  const foundCodes = new Set(rows.map((row) => row.standard_invoice_template_code));
  const missingCodes = codes.filter((code) => !foundCodes.has(code));

  if (missingCodes.length > 0) {
    throw new Error(
      `[set_standard_invoice_template_letter_margins] Missing bundled standard invoice templates: ${missingCodes.join(', ')}`
    );
  }

  return rows;
}

exports.up = async function up(knex) {
  const rows = await loadRowsByCode(knex, SET_CODES);

  for (const row of rows) {
    assertTemplateAst(row.templateAst, row.standard_invoice_template_code);

    await knex(TABLE_NAME)
      .where({ standard_invoice_template_code: row.standard_invoice_template_code })
      .update({
        templateAst: JSON.stringify(applyPrintSettings(row.templateAst)),
        updated_at: knex.fn.now(),
      });
  }
};

exports.down = async function down(knex) {
  const rows = await loadRowsByCode(knex, UNSET_CODES);

  for (const row of rows) {
    assertTemplateAst(row.templateAst, row.standard_invoice_template_code);

    await knex(TABLE_NAME)
      .where({ standard_invoice_template_code: row.standard_invoice_template_code })
      .update({
        templateAst: JSON.stringify(removePrintSettings(row.templateAst)),
        updated_at: knex.fn.now(),
      });
  }
};

exports.up = async function(knex) {
    await knex.schema.createTable('standard_invoice_templates', (table) => {
        table.uuid('template_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
        table.text('name').notNullable();
        table.integer('version').notNullable();
        table.text('dsl').notNullable();
        table.boolean('is_default').defaultTo(false);
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    });

    // Insert standard templates
    await knex('standard_invoice_templates').insert([
        {
            template_id: knex.raw('gen_random_uuid()'),
            name: 'Standard Template',
            version: 1,
            dsl: `section header grid 12 x 3 {
                field company_logo at 1 1 span 3 2
                field company_name at 4 1 span 5 1
                field invoice_number at 10 1 span 3 1
                field invoice_date at 10 2 span 3 1
            }
            section items grid 12 x 10 {
                list invoice_items group by category {
                    field item_name at 1 1 span 6 1
                    field quantity at 7 1 span 2 1
                    field price at 9 1 span 2 1
                    field total at 11 1 span 2 1
                    calculate subtotal as sum total
                }
            }
            section summary grid 12 x 4 {
                field subtotal_label at 8 1 span 2 1
                field subtotal at 10 1 span 3 1
                field tax_label at 8 2 span 2 1
                field tax at 10 2 span 3 1
                field total_label at 8 3 span 2 1
                field total at 10 3 span 3 1
                style total {
                    font-weight: "bold";
                    font-size: 16;
                }
            }`,
            is_default: true
        },
        {
            template_id: knex.raw('gen_random_uuid()'),
            name: 'Detailed Template',
            version: 1,
            dsl: `section header grid 12 x 4 {
                field company_logo at 1 1 span 3 2
                field company_name at 4 1 span 5 1
                field company_address at 4 2 span 5 1
                field invoice_number at 10 1 span 3 1
                field invoice_date at 10 2 span 3 1
                field client_name at 1 3 span 6 1
                field client_address at 1 4 span 6 1
            }
            section items grid 12 x 10 {
                list invoice_items group by category {
                    field item_name at 1 1 span 4 1
                    field description at 1 2 span 4 1
                    field quantity at 5 1 span 2 1
                    field price at 7 1 span 2 1
                    field total at 9 1 span 2 1
                }
                calculate subtotal as sum total
            }
            section summary grid 12 x 5 {
                field subtotal_label at 8 1 span 2 1
                field subtotal at 10 1 span 3 1
                field tax_label at 8 2 span 2 1
                field tax at 10 2 span 3 1
                field total_label at 8 3 span 2 1
                field total at 10 3 span 3 1
                field notes at 1 4 span 12 2
                style total {
                    font-weight: "bold";
                    font-size: 18;
                }
            }`,
            is_default: false
        }
    ]);
};

exports.down = async function(knex) {
    await knex.schema.dropTable('standard_invoice_templates');
};

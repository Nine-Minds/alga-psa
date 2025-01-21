exports.up = async function(knex) {
  await knex('standard_invoice_templates')
    .where({ name: 'Standard Template' })
    .update({
      dsl: `section header grid 12 x 3 {
                field company.logo at 1 1 span 3 2
                field company.name at 4 1 span 5 1
                field invoice_number at 10 1 span 3 1
                field invoice_date at 10 2 span 3 1
            }
            section items grid 12 x 10 {
                list invoice_items group by category {
                    field description at 1 1 span 6 1
                    field quantity at 7 1 span 2 1
                    field price at 9 1 span 2 1
                    field total at 11 1 span 2 1
                    calculate subtotal as sum total
                }
            }
            section summary grid 12 x 4 {
                text "Subtotal" at 8 1 span 2 1
                field subtotal at 10 1 span 3 1
                text "Tax" at 8 2 span 2 1
                field tax at 10 2 span 3 1
                text "Total" at 8 3 span 2 1
                field total at 10 3 span 3 1
                style total {
                    font-weight: "bold";
                    font-size: 16;
                }
            }`,
      updated_at: knex.fn.now()
    });

  await knex('standard_invoice_templates')
    .where({ name: 'Detailed Template' })
    .update({
      dsl: `section header grid 12 x 4 {
                field company.logo at 1 1 span 3 2
                field company.name at 4 1 span 5 1
                field company.address at 4 2 span 5 1
                field invoice_number at 10 1 span 3 1
                field invoice_date at 10 2 span 3 1
                field contact.name at 1 3 span 6 1
                field contact.address at 1 4 span 6 1
            }
            section items grid 12 x 10 {
                list invoice_items group by category {
                    field description at 1 1 span 6 1
                    field quantity at 7 1 span 2 1
                    field unit_price at 9 1 span 2 1
                    field total_price at 11 1 span 2 1
                    calculate subtotal as sum total
                }
                calculate subtotal as sum total
            }
            section summary grid 12 x 5 {
                text "Subtotal" at 8 1 span 2 1
                field subtotal at 10 1 span 3 1
                text "Tax" at 8 2 span 2 1
                field tax at 10 2 span 3 1
                text "Total" at 8 3 span 2 1
                field total at 10 3 span 3 1
                text "Thank you for your business!" at 1 4 span 12 2
                style total {
                    font-weight: "bold";
                    font-size: 18;
                }
            }`,
      updated_at: knex.fn.now()
    });
};

exports.down = async function(knex) {
  // No down migration as we're updating existing data
  // Reverting would require storing previous versions
};

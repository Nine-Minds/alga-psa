/**
 * Seed the `standard-invoice-by-ticket` template into
 * `standard_invoice_templates` so it appears in the invoice template
 * management UI and is selectable as a tenant/client default.
 *
 * The template already exists in code at
 * `packages/billing/src/lib/invoice-template-ast/standardTemplates.ts`
 * (buildStandardByTicketAst). It renders the classic line-items table plus a
 * "Billed Time by Ticket" summary driven by the `ticketGroups` collection —
 * the immutable per-entry work-item snapshot captured at invoice generation
 * (invoice_time_entries.work_item_snapshot) rolled up to one row per ticket
 * (Ticket | Description | Hours | Rate | Amount), with a note directing the
 * client to the portal for the per-entry breakdown. Invoices generated before
 * snapshot support render the summary's explicit empty state and are
 * otherwise unchanged.
 *
 * The AST below is a frozen copy of the code template at seeding time, the
 * same convention as 20260416120100_add_by_location_standard_invoice_template.
 */

const INVOICE_TABLE = 'standard_invoice_templates';
const CODE = 'standard-invoice-by-ticket';

const INVOICE_BY_TICKET_AST = {
  "kind": "invoice-template-ast",
  "version": 1,
  "metadata": {
    "templateName": "Standard Invoice By Ticket",
    "printSettings": {
      "paperPreset": "Letter",
      "marginMm": 10.58
    }
  },
  "bindings": {
    "values": {
      "invoiceNumber": {
        "id": "invoiceNumber",
        "kind": "value",
        "path": "invoiceNumber"
      },
      "issueDate": {
        "id": "issueDate",
        "kind": "value",
        "path": "issueDate"
      },
      "dueDate": {
        "id": "dueDate",
        "kind": "value",
        "path": "dueDate"
      },
      "recurringServicePeriodStart": {
        "id": "recurringServicePeriodStart",
        "kind": "value",
        "path": "recurringServicePeriodStart"
      },
      "recurringServicePeriodEnd": {
        "id": "recurringServicePeriodEnd",
        "kind": "value",
        "path": "recurringServicePeriodEnd"
      },
      "recurringServicePeriodLabel": {
        "id": "recurringServicePeriodLabel",
        "kind": "value",
        "path": "recurringServicePeriodLabel"
      },
      "poNumber": {
        "id": "poNumber",
        "kind": "value",
        "path": "poNumber"
      },
      "subtotal": {
        "id": "subtotal",
        "kind": "value",
        "path": "subtotal"
      },
      "tax": {
        "id": "tax",
        "kind": "value",
        "path": "tax"
      },
      "total": {
        "id": "total",
        "kind": "value",
        "path": "total"
      },
      "notes": {
        "id": "notes",
        "kind": "value",
        "path": "notes",
        "fallback": ""
      },
      "tenantClientName": {
        "id": "tenantClientName",
        "kind": "value",
        "path": "tenantClient.name",
        "fallback": "Your Company"
      },
      "tenantClientAddress": {
        "id": "tenantClientAddress",
        "kind": "value",
        "path": "tenantClient.address",
        "fallback": "Company address"
      },
      "tenantClientLogo": {
        "id": "tenantClientLogo",
        "kind": "value",
        "path": "tenantClient.logoUrl"
      },
      "customerName": {
        "id": "customerName",
        "kind": "value",
        "path": "customer.name",
        "fallback": "Customer"
      },
      "customerAddress": {
        "id": "customerAddress",
        "kind": "value",
        "path": "customer.address",
        "fallback": "Customer address"
      },
      "recurringSubtotal": {
        "id": "recurringSubtotal",
        "kind": "value",
        "path": "recurringSubtotal"
      },
      "recurringTax": {
        "id": "recurringTax",
        "kind": "value",
        "path": "recurringTax"
      },
      "recurringTotal": {
        "id": "recurringTotal",
        "kind": "value",
        "path": "recurringTotal"
      },
      "onetimeSubtotal": {
        "id": "onetimeSubtotal",
        "kind": "value",
        "path": "onetimeSubtotal"
      },
      "onetimeTax": {
        "id": "onetimeTax",
        "kind": "value",
        "path": "onetimeTax"
      },
      "onetimeTotal": {
        "id": "onetimeTotal",
        "kind": "value",
        "path": "onetimeTotal"
      }
    },
    "collections": {
      "lineItems": {
        "id": "lineItems",
        "kind": "collection",
        "path": "items"
      },
      "recurringItems": {
        "id": "recurringItems",
        "kind": "collection",
        "path": "recurringItems"
      },
      "onetimeItems": {
        "id": "onetimeItems",
        "kind": "collection",
        "path": "onetimeItems"
      },
      "groupsByLocation": {
        "id": "groupsByLocation",
        "kind": "collection",
        "path": "groupsByLocation"
      },
      "ticketGroups": {
        "id": "ticketGroups",
        "kind": "collection",
        "path": "ticketGroups"
      },
      "timeEntries": {
        "id": "timeEntries",
        "kind": "collection",
        "path": "timeEntries"
      }
    }
  },
  "layout": {
    "id": "root",
    "type": "document",
    "children": [
      {
        "id": "header-top",
        "type": "stack",
        "direction": "row",
        "style": {
          "inline": {
            "justifyContent": "space-between",
            "alignItems": "flex-start",
            "gap": "24px",
            "margin": "0 0 20px 0"
          }
        },
        "children": [
          {
            "id": "issuer-brand",
            "type": "stack",
            "direction": "column",
            "style": {
              "inline": {
                "gap": "6px"
              }
            },
            "children": [
              {
                "id": "issuer-logo",
                "type": "image",
                "src": {
                  "type": "binding",
                  "bindingId": "tenantClientLogo"
                },
                "alt": {
                  "type": "template",
                  "template": "{{name}} logo",
                  "args": {
                    "name": {
                      "type": "binding",
                      "bindingId": "tenantClientName"
                    }
                  }
                },
                "style": {
                  "inline": {
                    "width": "180px",
                    "maxHeight": "72px",
                    "margin": "0 0 6px 0",
                    "objectFit": "contain",
                    "objectPosition": "left"
                  }
                }
              },
              {
                "id": "issuer-name",
                "type": "text",
                "content": {
                  "type": "binding",
                  "bindingId": "tenantClientName"
                },
                "style": {
                  "inline": {
                    "fontSize": "18px",
                    "fontWeight": 700,
                    "lineHeight": 1.2
                  }
                }
              },
              {
                "id": "issuer-address",
                "type": "text",
                "content": {
                  "type": "binding",
                  "bindingId": "tenantClientAddress"
                },
                "style": {
                  "inline": {
                    "color": "#4b5563",
                    "lineHeight": 1.4
                  }
                }
              }
            ]
          },
          {
            "id": "invoice-meta-card",
            "type": "stack",
            "direction": "column",
            "style": {
              "inline": {
                "minWidth": "280px",
                "border": "1px solid #d1d5db",
                "borderRadius": "10px",
                "padding": "14px 16px",
                "backgroundColor": "#f9fafb",
                "gap": "6px"
              }
            },
            "children": [
              {
                "id": "invoice-title",
                "type": "text",
                "content": {
                  "type": "i18n",
                  "i18nKey": "labels.invoiceTitle",
                  "defaultValue": "INVOICE"
                },
                "style": {
                  "inline": {
                    "fontSize": "22px",
                    "fontWeight": 700,
                    "margin": "0 0 4px 0",
                    "lineHeight": 1.1
                  }
                }
              },
              {
                "id": "invoice-number",
                "type": "field",
                "label": {
                  "i18nKey": "labels.invoiceNumber",
                  "defaultValue": "Invoice #"
                },
                "binding": {
                  "bindingId": "invoiceNumber"
                },
                "style": {
                  "inline": {
                    "justifyContent": "space-between"
                  }
                }
              },
              {
                "id": "issue-date",
                "type": "field",
                "label": {
                  "i18nKey": "labels.issueDate",
                  "defaultValue": "Issue Date"
                },
                "binding": {
                  "bindingId": "issueDate"
                },
                "format": "date",
                "style": {
                  "inline": {
                    "justifyContent": "space-between"
                  }
                }
              },
              {
                "id": "due-date",
                "type": "field",
                "label": {
                  "i18nKey": "labels.dueDate",
                  "defaultValue": "Due Date"
                },
                "binding": {
                  "bindingId": "dueDate"
                },
                "format": "date",
                "style": {
                  "inline": {
                    "justifyContent": "space-between"
                  }
                }
              },
              {
                "id": "po-number",
                "type": "field",
                "label": {
                  "i18nKey": "labels.poNumber",
                  "defaultValue": "PO #"
                },
                "binding": {
                  "bindingId": "poNumber"
                },
                "emptyValue": "-",
                "style": {
                  "inline": {
                    "justifyContent": "space-between"
                  }
                }
              }
            ]
          }
        ]
      },
      {
        "id": "header-divider",
        "type": "divider",
        "style": {
          "inline": {
            "margin": "0 0 20px 0"
          }
        }
      },
      {
        "id": "party-blocks",
        "type": "stack",
        "direction": "row",
        "style": {
          "inline": {
            "gap": "24px",
            "margin": "0 0 20px 0"
          }
        },
        "children": [
          {
            "id": "from-card",
            "type": "stack",
            "direction": "column",
            "style": {
              "inline": {
                "flexGrow": 1,
                "flexShrink": 1,
                "flexBasis": "0%",
                "gap": "4px",
                "border": "1px solid #e5e7eb",
                "borderRadius": "10px",
                "padding": "12px 14px"
              }
            },
            "children": [
              {
                "id": "from-label",
                "type": "text",
                "content": {
                  "type": "i18n",
                  "i18nKey": "labels.from",
                  "defaultValue": "From"
                },
                "style": {
                  "inline": {
                    "color": "#6b7280",
                    "fontSize": "12px",
                    "fontWeight": 700,
                    "margin": "0 0 2px 0"
                  }
                }
              },
              {
                "id": "from-name",
                "type": "text",
                "content": {
                  "type": "binding",
                  "bindingId": "tenantClientName"
                },
                "style": {
                  "inline": {
                    "fontSize": "15px",
                    "fontWeight": 600,
                    "lineHeight": 1.3
                  }
                }
              },
              {
                "id": "from-address",
                "type": "text",
                "content": {
                  "type": "binding",
                  "bindingId": "tenantClientAddress"
                },
                "style": {
                  "inline": {
                    "color": "#4b5563",
                    "lineHeight": 1.4
                  }
                }
              }
            ]
          },
          {
            "id": "bill-to-card",
            "type": "stack",
            "direction": "column",
            "style": {
              "inline": {
                "flexGrow": 1,
                "flexShrink": 1,
                "flexBasis": "0%",
                "gap": "4px",
                "border": "1px solid #e5e7eb",
                "borderRadius": "10px",
                "padding": "12px 14px"
              }
            },
            "children": [
              {
                "id": "bill-to-label",
                "type": "text",
                "content": {
                  "type": "i18n",
                  "i18nKey": "labels.billTo",
                  "defaultValue": "Bill To"
                },
                "style": {
                  "inline": {
                    "color": "#6b7280",
                    "fontSize": "12px",
                    "fontWeight": 700,
                    "margin": "0 0 2px 0"
                  }
                }
              },
              {
                "id": "bill-to-name",
                "type": "text",
                "content": {
                  "type": "binding",
                  "bindingId": "customerName"
                },
                "style": {
                  "inline": {
                    "fontSize": "15px",
                    "fontWeight": 600,
                    "lineHeight": 1.3
                  }
                }
              },
              {
                "id": "bill-to-address",
                "type": "text",
                "content": {
                  "type": "binding",
                  "bindingId": "customerAddress"
                },
                "style": {
                  "inline": {
                    "color": "#4b5563",
                    "lineHeight": 1.4
                  }
                }
              }
            ]
          }
        ]
      },
      {
        "id": "line-items",
        "type": "dynamic-table",
        "style": {
          "inline": {
            "margin": "0 0 16px 0",
            "border": "1px solid #e5e7eb",
            "borderRadius": "10px"
          }
        },
        "repeat": {
          "sourceBinding": {
            "bindingId": "lineItems"
          },
          "itemBinding": "item"
        },
        "emptyStateText": {
          "i18nKey": "labels.emptyState.noBillableLineItems",
          "defaultValue": "No billable line items"
        },
        "columns": [
          {
            "id": "description",
            "header": {
              "i18nKey": "labels.description",
              "defaultValue": "Description"
            },
            "value": {
              "type": "path",
              "path": "description"
            },
            "style": {
              "inline": {
                "width": "50%"
              }
            }
          },
          {
            "id": "quantity",
            "header": {
              "i18nKey": "labels.qty",
              "defaultValue": "Qty"
            },
            "value": {
              "type": "path",
              "path": "quantity"
            },
            "format": "number",
            "style": {
              "inline": {
                "textAlign": "right",
                "width": "14%"
              }
            }
          },
          {
            "id": "unit-price",
            "header": {
              "i18nKey": "labels.rate",
              "defaultValue": "Rate"
            },
            "value": {
              "type": "path",
              "path": "unitPrice"
            },
            "format": "currency",
            "style": {
              "inline": {
                "textAlign": "right",
                "width": "18%"
              }
            }
          },
          {
            "id": "line-total",
            "header": {
              "i18nKey": "labels.amount",
              "defaultValue": "Amount"
            },
            "value": {
              "type": "path",
              "path": "total"
            },
            "format": "currency",
            "style": {
              "inline": {
                "textAlign": "right",
                "width": "18%"
              }
            }
          }
        ]
      },
      {
        "id": "billed-time-heading",
        "type": "text",
        "content": {
          "type": "i18n",
          "i18nKey": "labels.billedTimeByTicket",
          "defaultValue": "Billed Time by Ticket"
        },
        "style": {
          "inline": {
            "fontSize": "14px",
            "fontWeight": 700,
            "margin": "0 0 6px 0"
          }
        }
      },
      {
        "id": "ticket-time-summary",
        "type": "dynamic-table",
        "style": {
          "inline": {
            "margin": "0 0 6px 0",
            "border": "1px solid #e5e7eb",
            "borderRadius": "10px"
          }
        },
        "repeat": {
          "sourceBinding": {
            "bindingId": "ticketGroups"
          },
          "itemBinding": "item"
        },
        "emptyStateText": {
          "i18nKey": "labels.emptyState.noBilledTimeDetail",
          "defaultValue": "No billed-time detail is available for this invoice."
        },
        "columns": [
          {
            "id": "ticket",
            "header": {
              "i18nKey": "labels.ticket",
              "defaultValue": "Ticket"
            },
            "value": {
              "type": "path",
              "path": "label"
            },
            "style": {
              "inline": {
                "width": "26%"
              }
            }
          },
          {
            "id": "ticket-description",
            "header": {
              "i18nKey": "labels.description",
              "defaultValue": "Description"
            },
            "value": {
              "type": "path",
              "path": "description"
            },
            "style": {
              "inline": {
                "width": "34%"
              }
            }
          },
          {
            "id": "ticket-hours",
            "header": {
              "i18nKey": "labels.hours",
              "defaultValue": "Hours"
            },
            "value": {
              "type": "path",
              "path": "totalHours"
            },
            "format": "number",
            "style": {
              "inline": {
                "textAlign": "right",
                "width": "10%"
              }
            }
          },
          {
            "id": "ticket-rate",
            "header": {
              "i18nKey": "labels.rate",
              "defaultValue": "Rate"
            },
            "value": {
              "type": "path",
              "path": "rateDisplay"
            },
            "format": "currency",
            "style": {
              "inline": {
                "textAlign": "right",
                "width": "14%"
              }
            }
          },
          {
            "id": "ticket-amount",
            "header": {
              "i18nKey": "labels.amount",
              "defaultValue": "Amount"
            },
            "value": {
              "type": "path",
              "path": "totalAmount"
            },
            "format": "currency",
            "style": {
              "inline": {
                "textAlign": "right",
                "width": "16%"
              }
            }
          }
        ]
      },
      {
        "id": "billed-time-portal-note",
        "type": "text",
        "content": {
          "type": "i18n",
          "i18nKey": "labels.note.billedTimePortalDetail",
          "defaultValue": "A detailed breakdown of the time entries behind each ticket is available in the client portal."
        },
        "style": {
          "inline": {
            "color": "#6b7280",
            "fontSize": "11px",
            "margin": "0 0 16px 0"
          }
        }
      },
      {
        "id": "totals-wrap",
        "type": "stack",
        "direction": "row",
        "style": {
          "inline": {
            "justifyContent": "flex-end",
            "margin": "0 0 24px 0"
          }
        },
        "children": [
          {
            "id": "totals",
            "type": "totals",
            "style": {
              "inline": {
                "width": "300px",
                "border": "1px solid #e5e7eb",
                "borderRadius": "10px",
                "padding": "10px 12px",
                "backgroundColor": "#f9fafb"
              }
            },
            "sourceBinding": {
              "bindingId": "lineItems"
            },
            "rows": [
              {
                "id": "subtotal",
                "label": {
                  "i18nKey": "labels.subtotal",
                  "defaultValue": "Subtotal"
                },
                "value": {
                  "type": "binding",
                  "bindingId": "subtotal"
                },
                "format": "currency"
              },
              {
                "id": "tax",
                "label": {
                  "i18nKey": "labels.tax",
                  "defaultValue": "Tax"
                },
                "value": {
                  "type": "binding",
                  "bindingId": "tax"
                },
                "format": "currency"
              },
              {
                "id": "total",
                "label": {
                  "i18nKey": "labels.total",
                  "defaultValue": "Total"
                },
                "value": {
                  "type": "binding",
                  "bindingId": "total"
                },
                "format": "currency",
                "emphasize": true
              }
            ]
          }
        ]
      }
    ]
  }
};

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable(INVOICE_TABLE);
  if (!hasTable) return;

  const hasAstCol = await knex.schema.hasColumn(INVOICE_TABLE, 'templateAst');
  if (!hasAstCol) return;

  const existing = await knex(INVOICE_TABLE)
    .where({ standard_invoice_template_code: CODE })
    .first();

  if (existing) {
    await knex(INVOICE_TABLE)
      .where({ standard_invoice_template_code: CODE })
      .update({
        name: 'Standard Invoice By Ticket',
        version: 1,
        templateAst: knex.raw('?::jsonb', [JSON.stringify(INVOICE_BY_TICKET_AST)]),
        updated_at: knex.fn.now(),
      });
  } else {
    await knex(INVOICE_TABLE).insert({
      template_id: knex.raw('gen_random_uuid()'),
      name: 'Standard Invoice By Ticket',
      version: 1,
      standard_invoice_template_code: CODE,
      is_default: false,
      templateAst: knex.raw('?::jsonb', [JSON.stringify(INVOICE_BY_TICKET_AST)]),
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
  }
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable(INVOICE_TABLE);
  if (!hasTable) return;

  await knex(INVOICE_TABLE).where({ standard_invoice_template_code: CODE }).del();
};

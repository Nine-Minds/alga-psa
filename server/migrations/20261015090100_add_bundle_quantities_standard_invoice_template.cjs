/**
 * Seed `standard-bundle-quantities` ("Standard Invoice With Bundle Quantities")
 * into `standard_invoice_templates`.
 *
 * Fixed bundles render as a title, a muted subtitle and the bundle total, then
 * an indented row per service with its quantity and an optional green +N / red
 * \u2212N change against the previous period. No component price is bound, so
 * clients on this template never receive component prices.
 *
 * Insert-only: existing standard templates and saved custom templates are never
 * touched. The AST is a frozen copy of buildStandardBundleQuantitiesAst in
 * packages/billing/src/lib/invoice-template-ast/standardTemplates.ts at seeding
 * time (same convention as 20260902090100_add_by_ticket_standard_invoice_template).
 */

const INVOICE_TABLE = 'standard_invoice_templates';
const CODE = 'standard-bundle-quantities';
const NAME = 'Standard Invoice With Bundle Quantities';

const BUNDLE_QUANTITIES_AST = {
  "kind": "invoice-template-ast",
  "version": 1,
  "metadata": {
    "templateName": "Standard Invoice With Bundle Quantities",
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
      "paymentMethod": {
        "id": "paymentMethod",
        "kind": "value",
        "path": "paymentMethod"
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
      },
      "ticketPresentationRows": {
        "id": "ticketPresentationRows",
        "kind": "collection",
        "path": "ticketPresentationRows"
      }
    }
  },
  "layout": {
    "id": "root",
    "type": "document",
    "children": [
      {
        "id": "header",
        "type": "section",
        "title": {
          "i18nKey": "labels.invoice",
          "defaultValue": "Invoice"
        },
        "children": [
          {
            "id": "invoice-number",
            "type": "field",
            "label": {
              "i18nKey": "labels.invoiceNumber",
              "defaultValue": "Invoice #"
            },
            "binding": {
              "bindingId": "invoiceNumber"
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
            "format": "date"
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
            "format": "date"
          }
        ]
      },
      {
        "id": "line-items",
        "type": "dynamic-table",
        "repeat": {
          "sourceBinding": {
            "bindingId": "lineItems"
          },
          "itemBinding": "item"
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
            "lines": [
              {
                "id": "description-title",
                "value": {
                  "type": "path",
                  "path": "description"
                },
                "style": {
                  "inline": {
                    "fontWeight": 600
                  }
                }
              },
              {
                "id": "description-subtitle",
                "value": {
                  "type": "path",
                  "path": "subtitle"
                },
                "supplemental": true,
                "style": {
                  "inline": {
                    "color": "#6b7280",
                    "fontSize": "12px"
                  }
                }
              }
            ]
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
                "textAlign": "right"
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
                "textAlign": "right"
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
                "textAlign": "right"
              }
            }
          }
        ],
        "childRows": {
          "sourcePath": "item.components",
          "itemBinding": "component",
          "parentBlankColumns": [
            "quantity",
            "unit-price"
          ],
          "cells": {
            "description": {
              "value": {
                "type": "path",
                "path": "component.name"
              },
              "lines": [
                {
                  "id": "component-name",
                  "value": {
                    "type": "path",
                    "path": "component.name"
                  }
                },
                {
                  "id": "component-period",
                  "value": {
                    "type": "path",
                    "path": "component.periodLabelStart|daterange"
                  },
                  "supplemental": true,
                  "style": {
                    "inline": {
                      "color": "#6b7280",
                      "fontSize": "12px"
                    }
                  }
                }
              ]
            },
            "quantity": {
              "value": {
                "type": "path",
                "path": "component.quantity"
              },
              "format": "number",
              "change": {
                "value": {
                  "type": "path",
                  "path": "component.quantityChange"
                },
                "format": "signed-number"
              }
            }
          }
        }
      },
      {
        "id": "totals",
        "type": "totals",
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
};

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(INVOICE_TABLE))) return;
  if (!(await knex.schema.hasColumn(INVOICE_TABLE, 'templateAst'))) return;

  const existing = await knex(INVOICE_TABLE).where({ standard_invoice_template_code: CODE }).first();
  if (existing) {
    await knex(INVOICE_TABLE).where({ standard_invoice_template_code: CODE }).update({
      name: NAME,
      version: 1,
      templateAst: knex.raw('?::jsonb', [JSON.stringify(BUNDLE_QUANTITIES_AST)]),
      updated_at: knex.fn.now(),
    });
    return;
  }
  await knex(INVOICE_TABLE).insert({
    template_id: knex.raw('gen_random_uuid()'),
    name: NAME,
    version: 1,
    standard_invoice_template_code: CODE,
    is_default: false,
    templateAst: knex.raw('?::jsonb', [JSON.stringify(BUNDLE_QUANTITIES_AST)]),
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(INVOICE_TABLE))) return;
  await knex(INVOICE_TABLE).where({ standard_invoice_template_code: CODE }).del();
};

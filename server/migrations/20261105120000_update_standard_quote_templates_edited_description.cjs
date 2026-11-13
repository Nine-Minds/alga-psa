/**
 * Rewrite the managed standard quote templates so a line's description column
 * renders the description the author typed.
 *
 * Ticket alga-2026-0002902. Since ticket 2354 the stacked description cell led
 * with the catalog `service_name`, and the renderer only falls back to the
 * column's flat `value` (the editable `description`) when every line is
 * empty — so a per-item description edit was never shown on any standard
 * layout, only on tenant-authored ones. The first line now binds to
 * `description`; `catalog_description` still renders beneath it, and the
 * renderer drops it when it repeats the description.
 *
 * The literals below are the exact JSON of the four `build*Ast()` functions in
 * this checkout (serialized from the built ASTs, never hand-typed). A unit test
 * (`standardTemplates.test.ts`) deep-equals each against the code AST so the
 * two cannot drift. Editing the code AST alone is inert on existing
 * environments: the renderer reads these catalog rows first.
 *
 * Only the shared standard catalog is touched — a global reference table with no
 * tenant column, so Citus-safe. Tenant-owned custom quote templates
 * (`quote_document_templates`) keep their frozen AST; a tenant that customized
 * a standard layout re-clones to adopt this fix.
 *
 * Idempotent: an upsert keyed on `standard_quote_document_template_code`.
 */

const QUOTE_TABLE = 'standard_quote_document_templates';

/** Row identity for the insert half of the upsert (matches the seed migrations). */
const CATALOG_ROWS = {
  'standard-quote-default': { name: 'Standard Quote Template', is_default: true },
  'standard-quote-detailed': { name: 'Detailed Quote Template', is_default: false },
  'standard-quote-grouped': { name: 'Grouped Quote Template', is_default: false },
  'standard-quote-by-location': { name: 'Standard Quote By Location', is_default: false },
};

const STANDARD_QUOTE_TEMPLATE_ASTS = {
  "standard-quote-default": {
    "kind": "invoice-template-ast",
    "version": 1,
    "metadata": {
      "templateName": "Standard Quote Default",
      "printSettings": {
        "paperPreset": "Letter",
        "marginMm": 10.58
      }
    },
    "bindings": {
      "values": {
        "quoteNumber": {
          "id": "quoteNumber",
          "kind": "value",
          "path": "quote_number"
        },
        "quoteDate": {
          "id": "quoteDate",
          "kind": "value",
          "path": "quote_date"
        },
        "validUntil": {
          "id": "validUntil",
          "kind": "value",
          "path": "valid_until"
        },
        "status": {
          "id": "status",
          "kind": "value",
          "path": "status"
        },
        "title": {
          "id": "title",
          "kind": "value",
          "path": "title"
        },
        "scope": {
          "id": "scope",
          "kind": "value",
          "path": "scope_of_work",
          "fallback": ""
        },
        "poNumber": {
          "id": "poNumber",
          "kind": "value",
          "path": "po_number"
        },
        "subtotal": {
          "id": "subtotal",
          "kind": "value",
          "path": "subtotal"
        },
        "discountTotal": {
          "id": "discountTotal",
          "kind": "value",
          "path": "discount_total"
        },
        "tax": {
          "id": "tax",
          "kind": "value",
          "path": "tax"
        },
        "total": {
          "id": "total",
          "kind": "value",
          "path": "total_amount"
        },
        "termsAndConditions": {
          "id": "termsAndConditions",
          "kind": "value",
          "path": "terms_and_conditions",
          "fallback": ""
        },
        "termsAndConditionsRich": {
          "id": "termsAndConditionsRich",
          "kind": "value",
          "path": "terms_and_conditions_rich",
          "fallback": ""
        },
        "clientNotes": {
          "id": "clientNotes",
          "kind": "value",
          "path": "client_notes",
          "fallback": ""
        },
        "version": {
          "id": "version",
          "kind": "value",
          "path": "version"
        },
        "clientName": {
          "id": "clientName",
          "kind": "value",
          "path": "client.name",
          "fallback": "Client"
        },
        "clientAddress": {
          "id": "clientAddress",
          "kind": "value",
          "path": "client.address",
          "fallback": ""
        },
        "contactName": {
          "id": "contactName",
          "kind": "value",
          "path": "contact.name",
          "fallback": ""
        },
        "tenantName": {
          "id": "tenantName",
          "kind": "value",
          "path": "tenant.name",
          "fallback": "Your Company"
        },
        "tenantAddress": {
          "id": "tenantAddress",
          "kind": "value",
          "path": "tenant.address",
          "fallback": ""
        },
        "tenantLogo": {
          "id": "tenantLogo",
          "kind": "value",
          "path": "tenant.logo_url"
        },
        "acceptedByName": {
          "id": "acceptedByName",
          "kind": "value",
          "path": "accepted_by_name",
          "fallback": ""
        },
        "acceptedAt": {
          "id": "acceptedAt",
          "kind": "value",
          "path": "accepted_at",
          "fallback": ""
        },
        "recurringSubtotal": {
          "id": "recurringSubtotal",
          "kind": "value",
          "path": "recurring_subtotal"
        },
        "recurringTax": {
          "id": "recurringTax",
          "kind": "value",
          "path": "recurring_tax"
        },
        "recurringTotal": {
          "id": "recurringTotal",
          "kind": "value",
          "path": "recurring_total"
        },
        "onetimeSubtotal": {
          "id": "onetimeSubtotal",
          "kind": "value",
          "path": "onetime_subtotal"
        },
        "onetimeTax": {
          "id": "onetimeTax",
          "kind": "value",
          "path": "onetime_tax"
        },
        "onetimeTotal": {
          "id": "onetimeTotal",
          "kind": "value",
          "path": "onetime_total"
        },
        "serviceSubtotal": {
          "id": "serviceSubtotal",
          "kind": "value",
          "path": "service_subtotal"
        },
        "serviceTax": {
          "id": "serviceTax",
          "kind": "value",
          "path": "service_tax"
        },
        "serviceTotal": {
          "id": "serviceTotal",
          "kind": "value",
          "path": "service_total"
        },
        "productSubtotal": {
          "id": "productSubtotal",
          "kind": "value",
          "path": "product_subtotal"
        },
        "productTax": {
          "id": "productTax",
          "kind": "value",
          "path": "product_tax"
        },
        "productTotal": {
          "id": "productTotal",
          "kind": "value",
          "path": "product_total"
        },
        "optionalSubtotal": {
          "id": "optionalSubtotal",
          "kind": "value",
          "path": "optional_subtotal"
        },
        "optionalTax": {
          "id": "optionalTax",
          "kind": "value",
          "path": "optional_tax"
        },
        "optionalTotal": {
          "id": "optionalTotal",
          "kind": "value",
          "path": "optional_total"
        }
      },
      "collections": {
        "lineItems": {
          "id": "lineItems",
          "kind": "collection",
          "path": "line_items"
        },
        "phases": {
          "id": "phases",
          "kind": "collection",
          "path": "phases"
        },
        "groupsByLocation": {
          "id": "groupsByLocation",
          "kind": "collection",
          "path": "groups_by_location"
        },
        "groupsByCadence": {
          "id": "groupsByCadence",
          "kind": "collection",
          "path": "groups_by_cadence"
        },
        "groupsByCadenceWithOptionals": {
          "id": "groupsByCadenceWithOptionals",
          "kind": "collection",
          "path": "groups_by_cadence_with_optionals"
        },
        "recurringItems": {
          "id": "recurringItems",
          "kind": "collection",
          "path": "recurring_items"
        },
        "onetimeItems": {
          "id": "onetimeItems",
          "kind": "collection",
          "path": "onetime_items"
        },
        "serviceItems": {
          "id": "serviceItems",
          "kind": "collection",
          "path": "service_items"
        },
        "productItems": {
          "id": "productItems",
          "kind": "collection",
          "path": "product_items"
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
                    "bindingId": "tenantLogo"
                  },
                  "alt": {
                    "type": "template",
                    "template": "{{name}} logo",
                    "args": {
                      "name": {
                        "type": "binding",
                        "bindingId": "tenantName"
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
                    "bindingId": "tenantName"
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
                    "bindingId": "tenantAddress"
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
              "id": "quote-meta-card",
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
                  "id": "quote-title",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.quoteTitle",
                    "defaultValue": "QUOTE"
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
                  "id": "quote-number",
                  "type": "field",
                  "label": {
                    "i18nKey": "labels.quoteNumber",
                    "defaultValue": "Quote #"
                  },
                  "binding": {
                    "bindingId": "quoteNumber"
                  },
                  "style": {
                    "inline": {
                      "justifyContent": "space-between"
                    }
                  }
                },
                {
                  "id": "quote-date",
                  "type": "field",
                  "label": {
                    "i18nKey": "labels.date",
                    "defaultValue": "Date"
                  },
                  "binding": {
                    "bindingId": "quoteDate"
                  },
                  "format": "date",
                  "style": {
                    "inline": {
                      "justifyContent": "space-between"
                    }
                  }
                },
                {
                  "id": "valid-until",
                  "type": "field",
                  "label": {
                    "i18nKey": "labels.validUntil",
                    "defaultValue": "Valid Until"
                  },
                  "binding": {
                    "bindingId": "validUntil"
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
                  "flex": "1",
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
                    "bindingId": "tenantName"
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
                    "bindingId": "tenantAddress"
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
              "id": "prepared-for-card",
              "type": "stack",
              "direction": "column",
              "style": {
                "inline": {
                  "flex": "1",
                  "gap": "4px",
                  "border": "1px solid #e5e7eb",
                  "borderRadius": "10px",
                  "padding": "12px 14px"
                }
              },
              "children": [
                {
                  "id": "prepared-for-label",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.preparedFor",
                    "defaultValue": "Prepared For"
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
                  "id": "client-name",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "clientName"
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
                  "id": "client-address",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "clientAddress"
                  },
                  "style": {
                    "inline": {
                      "color": "#4b5563",
                      "lineHeight": 1.4
                    }
                  }
                },
                {
                  "id": "contact-name",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "contactName"
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
          "id": "overview-section",
          "type": "stack",
          "direction": "column",
          "style": {
            "inline": {
              "margin": "0 0 20px 0",
              "gap": "8px"
            }
          },
          "children": [
            {
              "id": "quote-heading",
              "type": "text",
              "content": {
                "type": "binding",
                "bindingId": "title"
              },
              "style": {
                "inline": {
                  "fontSize": "18px",
                  "fontWeight": 700,
                  "lineHeight": 1.3
                }
              }
            },
            {
              "id": "scope-text",
              "type": "text",
              "content": {
                "type": "binding",
                "bindingId": "scope"
              },
              "style": {
                "inline": {
                  "color": "#374151",
                  "lineHeight": 1.5
                }
              }
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
            "i18nKey": "labels.emptyState.noLineItems",
            "defaultValue": "No line items"
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
              },
              "lines": [
                {
                  "id": "item-description",
                  "value": {
                    "type": "path",
                    "path": "description"
                  },
                  "style": {
                    "inline": {
                      "fontWeight": 600,
                      "lineHeight": 1.3
                    }
                  }
                },
                {
                  "id": "catalog-description",
                  "value": {
                    "type": "path",
                    "path": "catalog_description"
                  },
                  "style": {
                    "inline": {
                      "color": "#4b5563",
                      "fontSize": "12px",
                      "lineHeight": 1.4
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
                "path": "unit_price"
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
              "id": "amount",
              "header": {
                "i18nKey": "labels.amount",
                "defaultValue": "Amount"
              },
              "value": {
                "type": "path",
                "path": "total_price"
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
                  "id": "discounts",
                  "label": {
                    "i18nKey": "labels.discounts",
                    "defaultValue": "Discounts"
                  },
                  "value": {
                    "type": "binding",
                    "bindingId": "discountTotal"
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
                  "id": "grand-total",
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
        },
        {
          "id": "client-notes-section",
          "type": "section",
          "title": {
            "i18nKey": "labels.notes",
            "defaultValue": "Notes"
          },
          "children": [
            {
              "id": "client-notes-copy",
              "type": "text",
              "content": {
                "type": "binding",
                "bindingId": "clientNotes"
              },
              "style": {
                "inline": {
                  "color": "#374151",
                  "lineHeight": 1.5
                }
              }
            }
          ]
        },
        {
          "id": "terms-section",
          "type": "section",
          "title": {
            "i18nKey": "labels.termsAndConditions",
            "defaultValue": "Terms & Conditions"
          },
          "children": [
            {
              "id": "terms-copy",
              "type": "richText",
              "content": {
                "type": "binding",
                "bindingId": "termsAndConditionsRich"
              },
              "style": {
                "inline": {
                  "color": "#374151",
                  "lineHeight": 1.5,
                  "fontSize": "13px"
                }
              }
            }
          ]
        },
        {
          "id": "signature-block",
          "type": "stack",
          "direction": "row",
          "style": {
            "inline": {
              "gap": "48px",
              "margin": "40px 0 0 0"
            }
          },
          "children": [
            {
              "id": "sig-client",
              "type": "stack",
              "direction": "column",
              "style": {
                "inline": {
                  "flex": "1",
                  "gap": "4px"
                }
              },
              "children": [
                {
                  "id": "sig-client-label",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.acceptedBy",
                    "defaultValue": "Accepted By"
                  },
                  "style": {
                    "inline": {
                      "color": "#6b7280",
                      "fontSize": "12px",
                      "fontWeight": 700
                    }
                  }
                },
                {
                  "id": "sig-client-line",
                  "type": "divider",
                  "style": {
                    "inline": {
                      "margin": "24px 0 4px 0",
                      "borderColor": "#000"
                    }
                  }
                },
                {
                  "id": "sig-client-name",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "acceptedByName"
                  },
                  "style": {
                    "inline": {
                      "color": "#9ca3af",
                      "fontSize": "12px"
                    }
                  }
                },
                {
                  "id": "sig-client-date-line",
                  "type": "divider",
                  "style": {
                    "inline": {
                      "margin": "20px 0 4px 0",
                      "borderColor": "#000"
                    }
                  }
                },
                {
                  "id": "sig-client-date",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "acceptedAt"
                  },
                  "style": {
                    "inline": {
                      "color": "#9ca3af",
                      "fontSize": "12px"
                    }
                  }
                }
              ]
            },
            {
              "id": "sig-issuer",
              "type": "stack",
              "direction": "column",
              "style": {
                "inline": {
                  "flex": "1",
                  "gap": "4px"
                }
              },
              "children": [
                {
                  "id": "sig-issuer-label",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.authorizedBy",
                    "defaultValue": "Authorized By"
                  },
                  "style": {
                    "inline": {
                      "color": "#6b7280",
                      "fontSize": "12px",
                      "fontWeight": 700
                    }
                  }
                },
                {
                  "id": "sig-issuer-line",
                  "type": "divider",
                  "style": {
                    "inline": {
                      "margin": "24px 0 4px 0",
                      "borderColor": "#000"
                    }
                  }
                },
                {
                  "id": "sig-issuer-name",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.signature",
                    "defaultValue": "Signature"
                  },
                  "style": {
                    "inline": {
                      "color": "#9ca3af",
                      "fontSize": "12px"
                    }
                  }
                },
                {
                  "id": "sig-issuer-date-line",
                  "type": "divider",
                  "style": {
                    "inline": {
                      "margin": "20px 0 4px 0",
                      "borderColor": "#000"
                    }
                  }
                },
                {
                  "id": "sig-issuer-date",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.date",
                    "defaultValue": "Date"
                  },
                  "style": {
                    "inline": {
                      "color": "#9ca3af",
                      "fontSize": "12px"
                    }
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  },
  "standard-quote-detailed": {
    "kind": "invoice-template-ast",
    "version": 1,
    "metadata": {
      "templateName": "Standard Quote Detailed",
      "printSettings": {
        "paperPreset": "Letter",
        "marginMm": 10.58
      }
    },
    "bindings": {
      "values": {
        "quoteNumber": {
          "id": "quoteNumber",
          "kind": "value",
          "path": "quote_number"
        },
        "quoteDate": {
          "id": "quoteDate",
          "kind": "value",
          "path": "quote_date"
        },
        "validUntil": {
          "id": "validUntil",
          "kind": "value",
          "path": "valid_until"
        },
        "status": {
          "id": "status",
          "kind": "value",
          "path": "status"
        },
        "title": {
          "id": "title",
          "kind": "value",
          "path": "title"
        },
        "scope": {
          "id": "scope",
          "kind": "value",
          "path": "scope_of_work",
          "fallback": ""
        },
        "poNumber": {
          "id": "poNumber",
          "kind": "value",
          "path": "po_number"
        },
        "subtotal": {
          "id": "subtotal",
          "kind": "value",
          "path": "subtotal"
        },
        "discountTotal": {
          "id": "discountTotal",
          "kind": "value",
          "path": "discount_total"
        },
        "tax": {
          "id": "tax",
          "kind": "value",
          "path": "tax"
        },
        "total": {
          "id": "total",
          "kind": "value",
          "path": "total_amount"
        },
        "termsAndConditions": {
          "id": "termsAndConditions",
          "kind": "value",
          "path": "terms_and_conditions",
          "fallback": ""
        },
        "termsAndConditionsRich": {
          "id": "termsAndConditionsRich",
          "kind": "value",
          "path": "terms_and_conditions_rich",
          "fallback": ""
        },
        "clientNotes": {
          "id": "clientNotes",
          "kind": "value",
          "path": "client_notes",
          "fallback": ""
        },
        "version": {
          "id": "version",
          "kind": "value",
          "path": "version"
        },
        "clientName": {
          "id": "clientName",
          "kind": "value",
          "path": "client.name",
          "fallback": "Client"
        },
        "clientAddress": {
          "id": "clientAddress",
          "kind": "value",
          "path": "client.address",
          "fallback": ""
        },
        "contactName": {
          "id": "contactName",
          "kind": "value",
          "path": "contact.name",
          "fallback": ""
        },
        "tenantName": {
          "id": "tenantName",
          "kind": "value",
          "path": "tenant.name",
          "fallback": "Your Company"
        },
        "tenantAddress": {
          "id": "tenantAddress",
          "kind": "value",
          "path": "tenant.address",
          "fallback": ""
        },
        "tenantLogo": {
          "id": "tenantLogo",
          "kind": "value",
          "path": "tenant.logo_url"
        },
        "acceptedByName": {
          "id": "acceptedByName",
          "kind": "value",
          "path": "accepted_by_name",
          "fallback": ""
        },
        "acceptedAt": {
          "id": "acceptedAt",
          "kind": "value",
          "path": "accepted_at",
          "fallback": ""
        },
        "recurringSubtotal": {
          "id": "recurringSubtotal",
          "kind": "value",
          "path": "recurring_subtotal"
        },
        "recurringTax": {
          "id": "recurringTax",
          "kind": "value",
          "path": "recurring_tax"
        },
        "recurringTotal": {
          "id": "recurringTotal",
          "kind": "value",
          "path": "recurring_total"
        },
        "onetimeSubtotal": {
          "id": "onetimeSubtotal",
          "kind": "value",
          "path": "onetime_subtotal"
        },
        "onetimeTax": {
          "id": "onetimeTax",
          "kind": "value",
          "path": "onetime_tax"
        },
        "onetimeTotal": {
          "id": "onetimeTotal",
          "kind": "value",
          "path": "onetime_total"
        },
        "serviceSubtotal": {
          "id": "serviceSubtotal",
          "kind": "value",
          "path": "service_subtotal"
        },
        "serviceTax": {
          "id": "serviceTax",
          "kind": "value",
          "path": "service_tax"
        },
        "serviceTotal": {
          "id": "serviceTotal",
          "kind": "value",
          "path": "service_total"
        },
        "productSubtotal": {
          "id": "productSubtotal",
          "kind": "value",
          "path": "product_subtotal"
        },
        "productTax": {
          "id": "productTax",
          "kind": "value",
          "path": "product_tax"
        },
        "productTotal": {
          "id": "productTotal",
          "kind": "value",
          "path": "product_total"
        },
        "optionalSubtotal": {
          "id": "optionalSubtotal",
          "kind": "value",
          "path": "optional_subtotal"
        },
        "optionalTax": {
          "id": "optionalTax",
          "kind": "value",
          "path": "optional_tax"
        },
        "optionalTotal": {
          "id": "optionalTotal",
          "kind": "value",
          "path": "optional_total"
        }
      },
      "collections": {
        "lineItems": {
          "id": "lineItems",
          "kind": "collection",
          "path": "line_items"
        },
        "phases": {
          "id": "phases",
          "kind": "collection",
          "path": "phases"
        },
        "groupsByLocation": {
          "id": "groupsByLocation",
          "kind": "collection",
          "path": "groups_by_location"
        },
        "groupsByCadence": {
          "id": "groupsByCadence",
          "kind": "collection",
          "path": "groups_by_cadence"
        },
        "groupsByCadenceWithOptionals": {
          "id": "groupsByCadenceWithOptionals",
          "kind": "collection",
          "path": "groups_by_cadence_with_optionals"
        },
        "recurringItems": {
          "id": "recurringItems",
          "kind": "collection",
          "path": "recurring_items"
        },
        "onetimeItems": {
          "id": "onetimeItems",
          "kind": "collection",
          "path": "onetime_items"
        },
        "serviceItems": {
          "id": "serviceItems",
          "kind": "collection",
          "path": "service_items"
        },
        "productItems": {
          "id": "productItems",
          "kind": "collection",
          "path": "product_items"
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
                    "bindingId": "tenantLogo"
                  },
                  "alt": {
                    "type": "template",
                    "template": "{{name}} logo",
                    "args": {
                      "name": {
                        "type": "binding",
                        "bindingId": "tenantName"
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
                    "bindingId": "tenantName"
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
                    "bindingId": "tenantAddress"
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
              "id": "quote-meta-card",
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
                  "id": "quote-title",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.quoteTitle",
                    "defaultValue": "QUOTE"
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
                  "id": "quote-number",
                  "type": "field",
                  "label": {
                    "i18nKey": "labels.quoteNumber",
                    "defaultValue": "Quote #"
                  },
                  "binding": {
                    "bindingId": "quoteNumber"
                  },
                  "style": {
                    "inline": {
                      "justifyContent": "space-between"
                    }
                  }
                },
                {
                  "id": "quote-date",
                  "type": "field",
                  "label": {
                    "i18nKey": "labels.date",
                    "defaultValue": "Date"
                  },
                  "binding": {
                    "bindingId": "quoteDate"
                  },
                  "format": "date",
                  "style": {
                    "inline": {
                      "justifyContent": "space-between"
                    }
                  }
                },
                {
                  "id": "valid-until",
                  "type": "field",
                  "label": {
                    "i18nKey": "labels.validUntil",
                    "defaultValue": "Valid Until"
                  },
                  "binding": {
                    "bindingId": "validUntil"
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
                },
                {
                  "id": "version",
                  "type": "field",
                  "label": {
                    "i18nKey": "labels.version",
                    "defaultValue": "Version"
                  },
                  "binding": {
                    "bindingId": "version"
                  },
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
                  "flex": "1",
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
                    "bindingId": "tenantName"
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
                    "bindingId": "tenantAddress"
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
              "id": "prepared-for-card",
              "type": "stack",
              "direction": "column",
              "style": {
                "inline": {
                  "flex": "1",
                  "gap": "4px",
                  "border": "1px solid #e5e7eb",
                  "borderRadius": "10px",
                  "padding": "12px 14px"
                }
              },
              "children": [
                {
                  "id": "prepared-for-label",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.preparedFor",
                    "defaultValue": "Prepared For"
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
                  "id": "client-name",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "clientName"
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
                  "id": "client-address",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "clientAddress"
                  },
                  "style": {
                    "inline": {
                      "color": "#4b5563",
                      "lineHeight": 1.4
                    }
                  }
                },
                {
                  "id": "contact-name",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "contactName"
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
          "id": "overview-section",
          "type": "stack",
          "direction": "column",
          "style": {
            "inline": {
              "margin": "0 0 20px 0",
              "gap": "8px"
            }
          },
          "children": [
            {
              "id": "quote-heading",
              "type": "text",
              "content": {
                "type": "binding",
                "bindingId": "title"
              },
              "style": {
                "inline": {
                  "fontSize": "18px",
                  "fontWeight": 700,
                  "lineHeight": 1.3
                }
              }
            },
            {
              "id": "scope-text",
              "type": "text",
              "content": {
                "type": "binding",
                "bindingId": "scope"
              },
              "style": {
                "inline": {
                  "color": "#374151",
                  "lineHeight": 1.5
                }
              }
            },
            {
              "id": "client-notes-text",
              "type": "text",
              "content": {
                "type": "binding",
                "bindingId": "clientNotes"
              },
              "style": {
                "inline": {
                  "color": "#374151",
                  "lineHeight": 1.5,
                  "fontStyle": "italic"
                }
              }
            }
          ]
        },
        {
          "id": "phase-summary",
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
              "bindingId": "phases"
            },
            "itemBinding": "phase"
          },
          "emptyStateText": {
            "i18nKey": "labels.emptyState.noPhasesDefined",
            "defaultValue": "No phases defined"
          },
          "columns": [
            {
              "id": "phase-name",
              "header": {
                "i18nKey": "labels.projectPhase",
                "defaultValue": "Project Phase"
              },
              "value": {
                "type": "path",
                "path": "name"
              },
              "style": {
                "inline": {
                  "width": "100%"
                }
              }
            }
          ]
        },
        {
          "id": "line-items-detailed",
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
            "i18nKey": "labels.emptyState.noLineItems",
            "defaultValue": "No line items"
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
                  "width": "36%"
                }
              },
              "lines": [
                {
                  "id": "item-description",
                  "value": {
                    "type": "path",
                    "path": "description"
                  },
                  "style": {
                    "inline": {
                      "fontWeight": 600,
                      "lineHeight": 1.3
                    }
                  }
                },
                {
                  "id": "catalog-description",
                  "value": {
                    "type": "path",
                    "path": "catalog_description"
                  },
                  "style": {
                    "inline": {
                      "color": "#4b5563",
                      "fontSize": "12px",
                      "lineHeight": 1.4
                    }
                  }
                }
              ]
            },
            {
              "id": "phase",
              "header": {
                "i18nKey": "labels.phase",
                "defaultValue": "Phase"
              },
              "value": {
                "type": "path",
                "path": "phase"
              },
              "style": {
                "inline": {
                  "width": "14%"
                }
              }
            },
            {
              "id": "optional",
              "header": {
                "i18nKey": "labels.optional",
                "defaultValue": "Optional"
              },
              "value": {
                "type": "path",
                "path": "is_optional"
              },
              "style": {
                "inline": {
                  "width": "8%",
                  "textAlign": "center"
                }
              }
            },
            {
              "id": "recurring",
              "header": {
                "i18nKey": "labels.recurring",
                "defaultValue": "Recurring"
              },
              "value": {
                "type": "path",
                "path": "is_recurring"
              },
              "style": {
                "inline": {
                  "width": "8%",
                  "textAlign": "center"
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
                  "width": "8%"
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
                "path": "unit_price"
              },
              "format": "currency",
              "style": {
                "inline": {
                  "textAlign": "right",
                  "width": "13%"
                }
              }
            },
            {
              "id": "amount",
              "header": {
                "i18nKey": "labels.amount",
                "defaultValue": "Amount"
              },
              "value": {
                "type": "path",
                "path": "total_price"
              },
              "format": "currency",
              "style": {
                "inline": {
                  "textAlign": "right",
                  "width": "13%"
                }
              }
            }
          ]
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
                  "id": "discounts",
                  "label": {
                    "i18nKey": "labels.discounts",
                    "defaultValue": "Discounts"
                  },
                  "value": {
                    "type": "binding",
                    "bindingId": "discountTotal"
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
                  "id": "grand-total",
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
        },
        {
          "id": "terms-section",
          "type": "section",
          "title": {
            "i18nKey": "labels.termsAndConditions",
            "defaultValue": "Terms & Conditions"
          },
          "children": [
            {
              "id": "terms-copy",
              "type": "richText",
              "content": {
                "type": "binding",
                "bindingId": "termsAndConditionsRich"
              },
              "style": {
                "inline": {
                  "color": "#374151",
                  "lineHeight": 1.5,
                  "fontSize": "13px"
                }
              }
            }
          ]
        },
        {
          "id": "signature-block",
          "type": "stack",
          "direction": "row",
          "style": {
            "inline": {
              "gap": "48px",
              "margin": "40px 0 0 0"
            }
          },
          "children": [
            {
              "id": "sig-client",
              "type": "stack",
              "direction": "column",
              "style": {
                "inline": {
                  "flex": "1",
                  "gap": "4px"
                }
              },
              "children": [
                {
                  "id": "sig-client-label",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.acceptedBy",
                    "defaultValue": "Accepted By"
                  },
                  "style": {
                    "inline": {
                      "color": "#6b7280",
                      "fontSize": "12px",
                      "fontWeight": 700
                    }
                  }
                },
                {
                  "id": "sig-client-line",
                  "type": "divider",
                  "style": {
                    "inline": {
                      "margin": "24px 0 4px 0",
                      "borderColor": "#000"
                    }
                  }
                },
                {
                  "id": "sig-client-name",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "acceptedByName"
                  },
                  "style": {
                    "inline": {
                      "color": "#9ca3af",
                      "fontSize": "12px"
                    }
                  }
                },
                {
                  "id": "sig-client-date-line",
                  "type": "divider",
                  "style": {
                    "inline": {
                      "margin": "20px 0 4px 0",
                      "borderColor": "#000"
                    }
                  }
                },
                {
                  "id": "sig-client-date",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "acceptedAt"
                  },
                  "style": {
                    "inline": {
                      "color": "#9ca3af",
                      "fontSize": "12px"
                    }
                  }
                }
              ]
            },
            {
              "id": "sig-issuer",
              "type": "stack",
              "direction": "column",
              "style": {
                "inline": {
                  "flex": "1",
                  "gap": "4px"
                }
              },
              "children": [
                {
                  "id": "sig-issuer-label",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.authorizedBy",
                    "defaultValue": "Authorized By"
                  },
                  "style": {
                    "inline": {
                      "color": "#6b7280",
                      "fontSize": "12px",
                      "fontWeight": 700
                    }
                  }
                },
                {
                  "id": "sig-issuer-line",
                  "type": "divider",
                  "style": {
                    "inline": {
                      "margin": "24px 0 4px 0",
                      "borderColor": "#000"
                    }
                  }
                },
                {
                  "id": "sig-issuer-name",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.signature",
                    "defaultValue": "Signature"
                  },
                  "style": {
                    "inline": {
                      "color": "#9ca3af",
                      "fontSize": "12px"
                    }
                  }
                },
                {
                  "id": "sig-issuer-date-line",
                  "type": "divider",
                  "style": {
                    "inline": {
                      "margin": "20px 0 4px 0",
                      "borderColor": "#000"
                    }
                  }
                },
                {
                  "id": "sig-issuer-date",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.date",
                    "defaultValue": "Date"
                  },
                  "style": {
                    "inline": {
                      "color": "#9ca3af",
                      "fontSize": "12px"
                    }
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  },
  "standard-quote-grouped": {
    "kind": "invoice-template-ast",
    "version": 1,
    "metadata": {
      "templateName": "Standard Quote Grouped",
      "printSettings": {
        "paperPreset": "Letter",
        "marginMm": 10.58
      }
    },
    "bindings": {
      "values": {
        "quoteNumber": {
          "id": "quoteNumber",
          "kind": "value",
          "path": "quote_number"
        },
        "quoteDate": {
          "id": "quoteDate",
          "kind": "value",
          "path": "quote_date"
        },
        "validUntil": {
          "id": "validUntil",
          "kind": "value",
          "path": "valid_until"
        },
        "status": {
          "id": "status",
          "kind": "value",
          "path": "status"
        },
        "title": {
          "id": "title",
          "kind": "value",
          "path": "title"
        },
        "scope": {
          "id": "scope",
          "kind": "value",
          "path": "scope_of_work",
          "fallback": ""
        },
        "poNumber": {
          "id": "poNumber",
          "kind": "value",
          "path": "po_number"
        },
        "subtotal": {
          "id": "subtotal",
          "kind": "value",
          "path": "subtotal"
        },
        "discountTotal": {
          "id": "discountTotal",
          "kind": "value",
          "path": "discount_total"
        },
        "tax": {
          "id": "tax",
          "kind": "value",
          "path": "tax"
        },
        "total": {
          "id": "total",
          "kind": "value",
          "path": "total_amount"
        },
        "termsAndConditions": {
          "id": "termsAndConditions",
          "kind": "value",
          "path": "terms_and_conditions",
          "fallback": ""
        },
        "termsAndConditionsRich": {
          "id": "termsAndConditionsRich",
          "kind": "value",
          "path": "terms_and_conditions_rich",
          "fallback": ""
        },
        "clientNotes": {
          "id": "clientNotes",
          "kind": "value",
          "path": "client_notes",
          "fallback": ""
        },
        "version": {
          "id": "version",
          "kind": "value",
          "path": "version"
        },
        "clientName": {
          "id": "clientName",
          "kind": "value",
          "path": "client.name",
          "fallback": "Client"
        },
        "clientAddress": {
          "id": "clientAddress",
          "kind": "value",
          "path": "client.address",
          "fallback": ""
        },
        "contactName": {
          "id": "contactName",
          "kind": "value",
          "path": "contact.name",
          "fallback": ""
        },
        "tenantName": {
          "id": "tenantName",
          "kind": "value",
          "path": "tenant.name",
          "fallback": "Your Company"
        },
        "tenantAddress": {
          "id": "tenantAddress",
          "kind": "value",
          "path": "tenant.address",
          "fallback": ""
        },
        "tenantLogo": {
          "id": "tenantLogo",
          "kind": "value",
          "path": "tenant.logo_url"
        },
        "acceptedByName": {
          "id": "acceptedByName",
          "kind": "value",
          "path": "accepted_by_name",
          "fallback": ""
        },
        "acceptedAt": {
          "id": "acceptedAt",
          "kind": "value",
          "path": "accepted_at",
          "fallback": ""
        },
        "recurringSubtotal": {
          "id": "recurringSubtotal",
          "kind": "value",
          "path": "recurring_subtotal"
        },
        "recurringTax": {
          "id": "recurringTax",
          "kind": "value",
          "path": "recurring_tax"
        },
        "recurringTotal": {
          "id": "recurringTotal",
          "kind": "value",
          "path": "recurring_total"
        },
        "onetimeSubtotal": {
          "id": "onetimeSubtotal",
          "kind": "value",
          "path": "onetime_subtotal"
        },
        "onetimeTax": {
          "id": "onetimeTax",
          "kind": "value",
          "path": "onetime_tax"
        },
        "onetimeTotal": {
          "id": "onetimeTotal",
          "kind": "value",
          "path": "onetime_total"
        },
        "serviceSubtotal": {
          "id": "serviceSubtotal",
          "kind": "value",
          "path": "service_subtotal"
        },
        "serviceTax": {
          "id": "serviceTax",
          "kind": "value",
          "path": "service_tax"
        },
        "serviceTotal": {
          "id": "serviceTotal",
          "kind": "value",
          "path": "service_total"
        },
        "productSubtotal": {
          "id": "productSubtotal",
          "kind": "value",
          "path": "product_subtotal"
        },
        "productTax": {
          "id": "productTax",
          "kind": "value",
          "path": "product_tax"
        },
        "productTotal": {
          "id": "productTotal",
          "kind": "value",
          "path": "product_total"
        },
        "optionalSubtotal": {
          "id": "optionalSubtotal",
          "kind": "value",
          "path": "optional_subtotal"
        },
        "optionalTax": {
          "id": "optionalTax",
          "kind": "value",
          "path": "optional_tax"
        },
        "optionalTotal": {
          "id": "optionalTotal",
          "kind": "value",
          "path": "optional_total"
        }
      },
      "collections": {
        "lineItems": {
          "id": "lineItems",
          "kind": "collection",
          "path": "line_items"
        },
        "phases": {
          "id": "phases",
          "kind": "collection",
          "path": "phases"
        },
        "groupsByLocation": {
          "id": "groupsByLocation",
          "kind": "collection",
          "path": "groups_by_location"
        },
        "groupsByCadence": {
          "id": "groupsByCadence",
          "kind": "collection",
          "path": "groups_by_cadence"
        },
        "groupsByCadenceWithOptionals": {
          "id": "groupsByCadenceWithOptionals",
          "kind": "collection",
          "path": "groups_by_cadence_with_optionals"
        },
        "recurringItems": {
          "id": "recurringItems",
          "kind": "collection",
          "path": "recurring_items"
        },
        "onetimeItems": {
          "id": "onetimeItems",
          "kind": "collection",
          "path": "onetime_items"
        },
        "serviceItems": {
          "id": "serviceItems",
          "kind": "collection",
          "path": "service_items"
        },
        "productItems": {
          "id": "productItems",
          "kind": "collection",
          "path": "product_items"
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
                    "bindingId": "tenantLogo"
                  },
                  "alt": {
                    "type": "template",
                    "template": "{{name}} logo",
                    "args": {
                      "name": {
                        "type": "binding",
                        "bindingId": "tenantName"
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
                    "bindingId": "tenantName"
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
                    "bindingId": "tenantAddress"
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
              "id": "quote-meta-card",
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
                  "id": "quote-title",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.quoteTitle",
                    "defaultValue": "QUOTE"
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
                  "id": "quote-number",
                  "type": "field",
                  "label": {
                    "i18nKey": "labels.quoteNumber",
                    "defaultValue": "Quote #"
                  },
                  "binding": {
                    "bindingId": "quoteNumber"
                  },
                  "style": {
                    "inline": {
                      "justifyContent": "space-between"
                    }
                  }
                },
                {
                  "id": "quote-date",
                  "type": "field",
                  "label": {
                    "i18nKey": "labels.date",
                    "defaultValue": "Date"
                  },
                  "binding": {
                    "bindingId": "quoteDate"
                  },
                  "format": "date",
                  "style": {
                    "inline": {
                      "justifyContent": "space-between"
                    }
                  }
                },
                {
                  "id": "valid-until",
                  "type": "field",
                  "label": {
                    "i18nKey": "labels.validUntil",
                    "defaultValue": "Valid Until"
                  },
                  "binding": {
                    "bindingId": "validUntil"
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
                  "flex": "1",
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
                    "bindingId": "tenantName"
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
                    "bindingId": "tenantAddress"
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
              "id": "prepared-for-card",
              "type": "stack",
              "direction": "column",
              "style": {
                "inline": {
                  "flex": "1",
                  "gap": "4px",
                  "border": "1px solid #e5e7eb",
                  "borderRadius": "10px",
                  "padding": "12px 14px"
                }
              },
              "children": [
                {
                  "id": "prepared-for-label",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.preparedFor",
                    "defaultValue": "Prepared For"
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
                  "id": "client-name",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "clientName"
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
                  "id": "client-address",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "clientAddress"
                  },
                  "style": {
                    "inline": {
                      "color": "#4b5563",
                      "lineHeight": 1.4
                    }
                  }
                },
                {
                  "id": "contact-name",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "contactName"
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
          "id": "overview-section",
          "type": "stack",
          "direction": "column",
          "style": {
            "inline": {
              "margin": "0 0 20px 0",
              "gap": "8px"
            }
          },
          "children": [
            {
              "id": "quote-heading",
              "type": "text",
              "content": {
                "type": "binding",
                "bindingId": "title"
              },
              "style": {
                "inline": {
                  "fontSize": "18px",
                  "fontWeight": 700,
                  "lineHeight": 1.3
                }
              }
            },
            {
              "id": "scope-text",
              "type": "text",
              "content": {
                "type": "binding",
                "bindingId": "scope"
              },
              "style": {
                "inline": {
                  "color": "#374151",
                  "lineHeight": 1.5
                }
              }
            }
          ]
        },
        {
          "id": "cadence-bands",
          "type": "stack",
          "direction": "column",
          "style": {
            "inline": {
              "display": "block",
              "margin": "0 0 16px 0"
            }
          },
          "repeat": {
            "sourceBinding": {
              "bindingId": "groupsByCadence"
            },
            "itemBinding": "group"
          },
          "children": [
            {
              "id": "cadence-band-header",
              "type": "stack",
              "direction": "column",
              "style": {
                "inline": {
                  "gap": "2px",
                  "backgroundColor": "#7c45d3",
                  "color": "#ffffff",
                  "padding": "6px 12px",
                  "borderRadius": "6px 6px 0 0",
                  "breakInside": "avoid",
                  "breakAfter": "avoid"
                }
              },
              "children": [
                {
                  "id": "cadence-band-name",
                  "type": "text",
                  "content": {
                    "type": "path",
                    "path": "name"
                  },
                  "style": {
                    "inline": {
                      "fontSize": "14px",
                      "fontWeight": 700,
                      "color": "#ffffff"
                    }
                  }
                }
              ]
            },
            {
              "id": "cadence-band-items",
              "type": "dynamic-table",
              "style": {
                "inline": {
                  "margin": "0",
                  "border": "1px solid #e5e7eb",
                  "borderRadius": "0"
                }
              },
              "headerStyle": {
                "inline": {
                  "backgroundColor": "#7c45d3",
                  "color": "#ffffff"
                }
              },
              "repeat": {
                "sourceBinding": {
                  "bindingId": "group.items"
                },
                "itemBinding": "item"
              },
              "emptyStateText": {
                "i18nKey": "labels.emptyState.noLineItems",
                "defaultValue": "No line items"
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
                  },
                  "lines": [
                    {
                      "id": "item-description",
                      "value": {
                        "type": "path",
                        "path": "description"
                      },
                      "style": {
                        "inline": {
                          "fontWeight": 600,
                          "lineHeight": 1.3
                        }
                      }
                    },
                    {
                      "id": "catalog-description",
                      "value": {
                        "type": "path",
                        "path": "catalog_description"
                      },
                      "style": {
                        "inline": {
                          "color": "#4b5563",
                          "fontSize": "12px",
                          "lineHeight": 1.4
                        }
                      }
                    },
                    {
                      "id": "optional-marker",
                      "value": {
                        "type": "path",
                        "path": "optional_label"
                      },
                      "style": {
                        "inline": {
                          "color": "#7c45d3",
                          "fontSize": "11px",
                          "fontWeight": 600,
                          "lineHeight": 1.4
                        }
                      },
                      "supplemental": true
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
                      "textAlign": "right",
                      "width": "14%"
                    }
                  }
                },
                {
                  "id": "unit-price",
                  "header": {
                    "i18nKey": "labels.price",
                    "defaultValue": "Price"
                  },
                  "value": {
                    "type": "path",
                    "path": "unit_price"
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
                  "id": "amount",
                  "header": {
                    "i18nKey": "labels.amount",
                    "defaultValue": "Amount"
                  },
                  "value": {
                    "type": "path",
                    "path": "total_price"
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
              "id": "cadence-band-totals",
              "type": "stack",
              "direction": "column",
              "style": {
                "inline": {
                  "padding": "6px 12px",
                  "backgroundColor": "#f9fafb",
                  "borderRadius": "0 0 6px 6px",
                  "gap": "2px",
                  "margin": "0 0 8px 0",
                  "breakInside": "avoid"
                }
              },
              "children": [
                {
                  "id": "cadence-band-subtotal",
                  "type": "stack",
                  "direction": "row",
                  "style": {
                    "inline": {
                      "justifyContent": "space-between"
                    }
                  },
                  "children": [
                    {
                      "id": "cadence-band-subtotal-label",
                      "type": "text",
                      "content": {
                        "type": "i18n",
                        "i18nKey": "labels.subtotal",
                        "defaultValue": "Subtotal"
                      },
                      "style": {
                        "inline": {
                          "fontWeight": 600
                        }
                      }
                    },
                    {
                      "id": "cadence-band-subtotal-value",
                      "type": "text",
                      "content": {
                        "type": "path",
                        "path": "subtotal|currency"
                      },
                      "style": {
                        "inline": {
                          "fontWeight": 600,
                          "textAlign": "right"
                        }
                      }
                    }
                  ]
                },
                {
                  "id": "cadence-band-tax",
                  "type": "stack",
                  "direction": "row",
                  "style": {
                    "inline": {
                      "justifyContent": "space-between"
                    }
                  },
                  "children": [
                    {
                      "id": "cadence-band-tax-label",
                      "type": "text",
                      "content": {
                        "type": "i18n",
                        "i18nKey": "labels.tax",
                        "defaultValue": "Tax"
                      },
                      "style": {
                        "inline": {
                          "color": "#4b5563"
                        }
                      }
                    },
                    {
                      "id": "cadence-band-tax-value",
                      "type": "text",
                      "content": {
                        "type": "path",
                        "path": "tax|currency"
                      },
                      "style": {
                        "inline": {
                          "color": "#4b5563",
                          "textAlign": "right"
                        }
                      }
                    }
                  ]
                },
                {
                  "id": "cadence-band-total",
                  "type": "stack",
                  "direction": "row",
                  "style": {
                    "inline": {
                      "justifyContent": "space-between"
                    }
                  },
                  "children": [
                    {
                      "id": "cadence-band-total-label",
                      "type": "text",
                      "content": {
                        "type": "path",
                        "path": "total_label"
                      },
                      "style": {
                        "inline": {
                          "fontWeight": 700
                        }
                      }
                    },
                    {
                      "id": "cadence-band-total-value",
                      "type": "text",
                      "content": {
                        "type": "path",
                        "path": "total|currency"
                      },
                      "style": {
                        "inline": {
                          "fontWeight": 700,
                          "textAlign": "right"
                        }
                      }
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "id": "cadence-optional-bands",
          "type": "stack",
          "direction": "column",
          "style": {
            "inline": {
              "display": "block",
              "margin": "0 0 16px 0"
            }
          },
          "repeat": {
            "sourceBinding": {
              "bindingId": "groupsByCadenceWithOptionals"
            },
            "itemBinding": "group"
          },
          "children": [
            {
              "id": "cadence-optional-header",
              "type": "stack",
              "direction": "row",
              "style": {
                "inline": {
                  "justifyContent": "space-between",
                  "alignItems": "baseline",
                  "backgroundColor": "#f3f4f6",
                  "border": "1px solid #e5e7eb",
                  "borderRadius": "6px 6px 0 0",
                  "padding": "6px 12px",
                  "breakInside": "avoid",
                  "breakAfter": "avoid"
                }
              },
              "children": [
                {
                  "id": "cadence-optional-name",
                  "type": "text",
                  "content": {
                    "type": "path",
                    "path": "name"
                  },
                  "style": {
                    "inline": {
                      "fontSize": "13px",
                      "fontWeight": 700
                    }
                  }
                },
                {
                  "id": "cadence-optional-label",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.optionalSection",
                    "defaultValue": "Optional (if selected)"
                  },
                  "style": {
                    "inline": {
                      "fontSize": "12px",
                      "color": "#6b7280"
                    }
                  }
                }
              ]
            },
            {
              "id": "cadence-optional-items",
              "type": "dynamic-table",
              "style": {
                "inline": {
                  "margin": "0",
                  "border": "1px solid #e5e7eb",
                  "borderRadius": "0"
                }
              },
              "repeat": {
                "sourceBinding": {
                  "bindingId": "group.optional_items"
                },
                "itemBinding": "item"
              },
              "emptyStateText": {
                "i18nKey": "labels.emptyState.noLineItems",
                "defaultValue": "No line items"
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
                  },
                  "lines": [
                    {
                      "id": "item-description",
                      "value": {
                        "type": "path",
                        "path": "description"
                      },
                      "style": {
                        "inline": {
                          "fontWeight": 600,
                          "lineHeight": 1.3
                        }
                      }
                    },
                    {
                      "id": "catalog-description",
                      "value": {
                        "type": "path",
                        "path": "catalog_description"
                      },
                      "style": {
                        "inline": {
                          "color": "#4b5563",
                          "fontSize": "12px",
                          "lineHeight": 1.4
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
                      "textAlign": "right",
                      "width": "14%"
                    }
                  }
                },
                {
                  "id": "unit-price",
                  "header": {
                    "i18nKey": "labels.price",
                    "defaultValue": "Price"
                  },
                  "value": {
                    "type": "path",
                    "path": "unit_price"
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
                  "id": "amount",
                  "header": {
                    "i18nKey": "labels.amount",
                    "defaultValue": "Amount"
                  },
                  "value": {
                    "type": "path",
                    "path": "total_price"
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
              "id": "cadence-optional-subtotal",
              "type": "stack",
              "direction": "row",
              "style": {
                "inline": {
                  "justifyContent": "space-between",
                  "padding": "6px 12px",
                  "backgroundColor": "#f9fafb",
                  "borderRadius": "0 0 6px 6px",
                  "margin": "0 0 8px 0",
                  "breakInside": "avoid"
                }
              },
              "children": [
                {
                  "id": "cadence-optional-subtotal-label",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.optionalSubtotal",
                    "defaultValue": "Optional Subtotal"
                  },
                  "style": {
                    "inline": {
                      "fontWeight": 600
                    }
                  }
                },
                {
                  "id": "cadence-optional-subtotal-value",
                  "type": "text",
                  "content": {
                    "type": "path",
                    "path": "optional_subtotal|currency"
                  },
                  "style": {
                    "inline": {
                      "fontWeight": 600,
                      "textAlign": "right"
                    }
                  }
                }
              ]
            }
          ]
        },
        {
          "id": "notes-totals-row",
          "type": "stack",
          "direction": "row",
          "style": {
            "inline": {
              "gap": "24px",
              "margin": "0 0 24px 0",
              "alignItems": "flex-start",
              "breakInside": "avoid"
            }
          },
          "children": [
            {
              "id": "notes-card",
              "type": "stack",
              "direction": "column",
              "style": {
                "inline": {
                  "flex": "1",
                  "border": "1px solid #e5e7eb",
                  "borderRadius": "10px",
                  "padding": "12px 14px",
                  "minHeight": "80px"
                }
              },
              "children": [
                {
                  "id": "notes-label",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.notes",
                    "defaultValue": "Notes"
                  },
                  "style": {
                    "inline": {
                      "fontWeight": 700,
                      "fontSize": "14px",
                      "margin": "0 0 6px 0"
                    }
                  }
                },
                {
                  "id": "client-notes-text",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "clientNotes"
                  },
                  "style": {
                    "inline": {
                      "color": "#374151",
                      "lineHeight": 1.5
                    }
                  }
                }
              ]
            },
            {
              "id": "totals",
              "type": "totals",
              "style": {
                "inline": {
                  "flex": "1",
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
                  "id": "discounts",
                  "label": {
                    "i18nKey": "labels.discounts",
                    "defaultValue": "Discounts"
                  },
                  "value": {
                    "type": "binding",
                    "bindingId": "discountTotal"
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
                  "id": "grand-total",
                  "label": {
                    "i18nKey": "labels.total",
                    "defaultValue": "Total"
                  },
                  "value": {
                    "type": "binding",
                    "bindingId": "total"
                  },
                  "format": "currency",
                  "emphasize": true,
                  "style": {
                    "inline": {
                      "backgroundColor": "#7c45d3",
                      "color": "#ffffff",
                      "padding": "4px 6px",
                      "borderRadius": "4px",
                      "margin": "2px 0"
                    }
                  }
                },
                {
                  "id": "optional-total",
                  "label": {
                    "i18nKey": "labels.optionalTotal",
                    "defaultValue": "Optional if selected"
                  },
                  "value": {
                    "type": "binding",
                    "bindingId": "optionalTotal"
                  },
                  "format": "currency",
                  "hideWhenZero": true
                }
              ]
            }
          ]
        },
        {
          "id": "terms-section",
          "type": "section",
          "title": {
            "i18nKey": "labels.termsAndConditions",
            "defaultValue": "Terms & Conditions"
          },
          "children": [
            {
              "id": "terms-copy",
              "type": "richText",
              "content": {
                "type": "binding",
                "bindingId": "termsAndConditionsRich"
              },
              "style": {
                "inline": {
                  "color": "#374151",
                  "lineHeight": 1.5,
                  "fontSize": "13px"
                }
              }
            }
          ]
        },
        {
          "id": "signature-block",
          "type": "stack",
          "direction": "row",
          "style": {
            "inline": {
              "gap": "48px",
              "margin": "40px 0 0 0"
            }
          },
          "children": [
            {
              "id": "sig-client",
              "type": "stack",
              "direction": "column",
              "style": {
                "inline": {
                  "flex": "1",
                  "gap": "4px"
                }
              },
              "children": [
                {
                  "id": "sig-client-label",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.acceptedBy",
                    "defaultValue": "Accepted By"
                  },
                  "style": {
                    "inline": {
                      "color": "#6b7280",
                      "fontSize": "12px",
                      "fontWeight": 700
                    }
                  }
                },
                {
                  "id": "sig-client-line",
                  "type": "divider",
                  "style": {
                    "inline": {
                      "margin": "24px 0 4px 0",
                      "borderColor": "#000"
                    }
                  }
                },
                {
                  "id": "sig-client-name",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "acceptedByName"
                  },
                  "style": {
                    "inline": {
                      "color": "#9ca3af",
                      "fontSize": "12px"
                    }
                  }
                },
                {
                  "id": "sig-client-date-line",
                  "type": "divider",
                  "style": {
                    "inline": {
                      "margin": "20px 0 4px 0",
                      "borderColor": "#000"
                    }
                  }
                },
                {
                  "id": "sig-client-date",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "acceptedAt"
                  },
                  "style": {
                    "inline": {
                      "color": "#9ca3af",
                      "fontSize": "12px"
                    }
                  }
                }
              ]
            },
            {
              "id": "sig-issuer",
              "type": "stack",
              "direction": "column",
              "style": {
                "inline": {
                  "flex": "1",
                  "gap": "4px"
                }
              },
              "children": [
                {
                  "id": "sig-issuer-label",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.authorizedBy",
                    "defaultValue": "Authorized By"
                  },
                  "style": {
                    "inline": {
                      "color": "#6b7280",
                      "fontSize": "12px",
                      "fontWeight": 700
                    }
                  }
                },
                {
                  "id": "sig-issuer-line",
                  "type": "divider",
                  "style": {
                    "inline": {
                      "margin": "24px 0 4px 0",
                      "borderColor": "#000"
                    }
                  }
                },
                {
                  "id": "sig-issuer-name",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.signature",
                    "defaultValue": "Signature"
                  },
                  "style": {
                    "inline": {
                      "color": "#9ca3af",
                      "fontSize": "12px"
                    }
                  }
                },
                {
                  "id": "sig-issuer-date-line",
                  "type": "divider",
                  "style": {
                    "inline": {
                      "margin": "20px 0 4px 0",
                      "borderColor": "#000"
                    }
                  }
                },
                {
                  "id": "sig-issuer-date",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.date",
                    "defaultValue": "Date"
                  },
                  "style": {
                    "inline": {
                      "color": "#9ca3af",
                      "fontSize": "12px"
                    }
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  },
  "standard-quote-by-location": {
    "kind": "invoice-template-ast",
    "version": 1,
    "metadata": {
      "templateName": "Standard Quote By Location",
      "printSettings": {
        "paperPreset": "Letter",
        "marginMm": 10.58
      }
    },
    "bindings": {
      "values": {
        "quoteNumber": {
          "id": "quoteNumber",
          "kind": "value",
          "path": "quote_number"
        },
        "quoteDate": {
          "id": "quoteDate",
          "kind": "value",
          "path": "quote_date"
        },
        "validUntil": {
          "id": "validUntil",
          "kind": "value",
          "path": "valid_until"
        },
        "status": {
          "id": "status",
          "kind": "value",
          "path": "status"
        },
        "title": {
          "id": "title",
          "kind": "value",
          "path": "title"
        },
        "scope": {
          "id": "scope",
          "kind": "value",
          "path": "scope_of_work",
          "fallback": ""
        },
        "poNumber": {
          "id": "poNumber",
          "kind": "value",
          "path": "po_number"
        },
        "subtotal": {
          "id": "subtotal",
          "kind": "value",
          "path": "subtotal"
        },
        "discountTotal": {
          "id": "discountTotal",
          "kind": "value",
          "path": "discount_total"
        },
        "tax": {
          "id": "tax",
          "kind": "value",
          "path": "tax"
        },
        "total": {
          "id": "total",
          "kind": "value",
          "path": "total_amount"
        },
        "termsAndConditions": {
          "id": "termsAndConditions",
          "kind": "value",
          "path": "terms_and_conditions",
          "fallback": ""
        },
        "termsAndConditionsRich": {
          "id": "termsAndConditionsRich",
          "kind": "value",
          "path": "terms_and_conditions_rich",
          "fallback": ""
        },
        "clientNotes": {
          "id": "clientNotes",
          "kind": "value",
          "path": "client_notes",
          "fallback": ""
        },
        "version": {
          "id": "version",
          "kind": "value",
          "path": "version"
        },
        "clientName": {
          "id": "clientName",
          "kind": "value",
          "path": "client.name",
          "fallback": "Client"
        },
        "clientAddress": {
          "id": "clientAddress",
          "kind": "value",
          "path": "client.address",
          "fallback": ""
        },
        "contactName": {
          "id": "contactName",
          "kind": "value",
          "path": "contact.name",
          "fallback": ""
        },
        "tenantName": {
          "id": "tenantName",
          "kind": "value",
          "path": "tenant.name",
          "fallback": "Your Company"
        },
        "tenantAddress": {
          "id": "tenantAddress",
          "kind": "value",
          "path": "tenant.address",
          "fallback": ""
        },
        "tenantLogo": {
          "id": "tenantLogo",
          "kind": "value",
          "path": "tenant.logo_url"
        },
        "acceptedByName": {
          "id": "acceptedByName",
          "kind": "value",
          "path": "accepted_by_name",
          "fallback": ""
        },
        "acceptedAt": {
          "id": "acceptedAt",
          "kind": "value",
          "path": "accepted_at",
          "fallback": ""
        },
        "recurringSubtotal": {
          "id": "recurringSubtotal",
          "kind": "value",
          "path": "recurring_subtotal"
        },
        "recurringTax": {
          "id": "recurringTax",
          "kind": "value",
          "path": "recurring_tax"
        },
        "recurringTotal": {
          "id": "recurringTotal",
          "kind": "value",
          "path": "recurring_total"
        },
        "onetimeSubtotal": {
          "id": "onetimeSubtotal",
          "kind": "value",
          "path": "onetime_subtotal"
        },
        "onetimeTax": {
          "id": "onetimeTax",
          "kind": "value",
          "path": "onetime_tax"
        },
        "onetimeTotal": {
          "id": "onetimeTotal",
          "kind": "value",
          "path": "onetime_total"
        },
        "serviceSubtotal": {
          "id": "serviceSubtotal",
          "kind": "value",
          "path": "service_subtotal"
        },
        "serviceTax": {
          "id": "serviceTax",
          "kind": "value",
          "path": "service_tax"
        },
        "serviceTotal": {
          "id": "serviceTotal",
          "kind": "value",
          "path": "service_total"
        },
        "productSubtotal": {
          "id": "productSubtotal",
          "kind": "value",
          "path": "product_subtotal"
        },
        "productTax": {
          "id": "productTax",
          "kind": "value",
          "path": "product_tax"
        },
        "productTotal": {
          "id": "productTotal",
          "kind": "value",
          "path": "product_total"
        },
        "optionalSubtotal": {
          "id": "optionalSubtotal",
          "kind": "value",
          "path": "optional_subtotal"
        },
        "optionalTax": {
          "id": "optionalTax",
          "kind": "value",
          "path": "optional_tax"
        },
        "optionalTotal": {
          "id": "optionalTotal",
          "kind": "value",
          "path": "optional_total"
        }
      },
      "collections": {
        "lineItems": {
          "id": "lineItems",
          "kind": "collection",
          "path": "line_items"
        },
        "phases": {
          "id": "phases",
          "kind": "collection",
          "path": "phases"
        },
        "groupsByLocation": {
          "id": "groupsByLocation",
          "kind": "collection",
          "path": "groups_by_location"
        },
        "groupsByCadence": {
          "id": "groupsByCadence",
          "kind": "collection",
          "path": "groups_by_cadence"
        },
        "groupsByCadenceWithOptionals": {
          "id": "groupsByCadenceWithOptionals",
          "kind": "collection",
          "path": "groups_by_cadence_with_optionals"
        },
        "recurringItems": {
          "id": "recurringItems",
          "kind": "collection",
          "path": "recurring_items"
        },
        "onetimeItems": {
          "id": "onetimeItems",
          "kind": "collection",
          "path": "onetime_items"
        },
        "serviceItems": {
          "id": "serviceItems",
          "kind": "collection",
          "path": "service_items"
        },
        "productItems": {
          "id": "productItems",
          "kind": "collection",
          "path": "product_items"
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
                    "bindingId": "tenantLogo"
                  },
                  "alt": {
                    "type": "template",
                    "template": "{{name}} logo",
                    "args": {
                      "name": {
                        "type": "binding",
                        "bindingId": "tenantName"
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
                    "bindingId": "tenantName"
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
                    "bindingId": "tenantAddress"
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
              "id": "quote-meta-card",
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
                  "id": "quote-title",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.quoteTitle",
                    "defaultValue": "QUOTE"
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
                  "id": "quote-number",
                  "type": "field",
                  "label": {
                    "i18nKey": "labels.quoteNumber",
                    "defaultValue": "Quote #"
                  },
                  "binding": {
                    "bindingId": "quoteNumber"
                  },
                  "style": {
                    "inline": {
                      "justifyContent": "space-between"
                    }
                  }
                },
                {
                  "id": "quote-date",
                  "type": "field",
                  "label": {
                    "i18nKey": "labels.date",
                    "defaultValue": "Date"
                  },
                  "binding": {
                    "bindingId": "quoteDate"
                  },
                  "format": "date",
                  "style": {
                    "inline": {
                      "justifyContent": "space-between"
                    }
                  }
                },
                {
                  "id": "valid-until",
                  "type": "field",
                  "label": {
                    "i18nKey": "labels.validUntil",
                    "defaultValue": "Valid Until"
                  },
                  "binding": {
                    "bindingId": "validUntil"
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
                  "flex": "1",
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
                    "bindingId": "tenantName"
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
                    "bindingId": "tenantAddress"
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
              "id": "prepared-for-card",
              "type": "stack",
              "direction": "column",
              "style": {
                "inline": {
                  "flex": "1",
                  "gap": "4px",
                  "border": "1px solid #e5e7eb",
                  "borderRadius": "10px",
                  "padding": "12px 14px"
                }
              },
              "children": [
                {
                  "id": "prepared-for-label",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.preparedFor",
                    "defaultValue": "Prepared For"
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
                  "id": "client-name",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "clientName"
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
                  "id": "client-address",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "clientAddress"
                  },
                  "style": {
                    "inline": {
                      "color": "#4b5563",
                      "lineHeight": 1.4
                    }
                  }
                },
                {
                  "id": "contact-name",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "contactName"
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
          "id": "overview-section",
          "type": "stack",
          "direction": "column",
          "style": {
            "inline": {
              "margin": "0 0 20px 0",
              "gap": "8px"
            }
          },
          "children": [
            {
              "id": "quote-heading",
              "type": "text",
              "content": {
                "type": "binding",
                "bindingId": "title"
              },
              "style": {
                "inline": {
                  "fontSize": "18px",
                  "fontWeight": 700,
                  "lineHeight": 1.3
                }
              }
            },
            {
              "id": "scope-text",
              "type": "text",
              "content": {
                "type": "binding",
                "bindingId": "scope"
              },
              "style": {
                "inline": {
                  "color": "#374151",
                  "lineHeight": 1.5
                }
              }
            }
          ]
        },
        {
          "id": "location-bands",
          "type": "stack",
          "direction": "column",
          "style": {
            "inline": {
              "gap": "8px",
              "margin": "0 0 16px 0"
            }
          },
          "repeat": {
            "sourceBinding": {
              "bindingId": "groupsByLocation"
            },
            "itemBinding": "group"
          },
          "children": [
            {
              "id": "location-band-header",
              "type": "stack",
              "direction": "column",
              "style": {
                "inline": {
                  "gap": "2px",
                  "backgroundColor": "#7c45d3",
                  "color": "#ffffff",
                  "padding": "6px 12px",
                  "borderRadius": "6px 6px 0 0"
                }
              },
              "children": [
                {
                  "id": "location-band-name",
                  "type": "text",
                  "content": {
                    "type": "path",
                    "path": "name"
                  },
                  "style": {
                    "inline": {
                      "fontSize": "14px",
                      "fontWeight": 700,
                      "color": "#ffffff"
                    }
                  }
                },
                {
                  "id": "location-band-address",
                  "type": "text",
                  "content": {
                    "type": "path",
                    "path": "address"
                  },
                  "style": {
                    "inline": {
                      "fontSize": "12px",
                      "color": "#ffffff",
                      "lineHeight": 1.4
                    }
                  }
                }
              ]
            },
            {
              "id": "location-band-items",
              "type": "dynamic-table",
              "style": {
                "inline": {
                  "margin": "0",
                  "border": "1px solid #e5e7eb",
                  "borderRadius": "0 0 6px 6px"
                }
              },
              "repeat": {
                "sourceBinding": {
                  "bindingId": "group.items"
                },
                "itemBinding": "item"
              },
              "emptyStateText": {
                "i18nKey": "labels.emptyState.noLineItems",
                "defaultValue": "No line items"
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
                      "width": "52%"
                    }
                  },
                  "lines": [
                    {
                      "id": "item-description",
                      "value": {
                        "type": "path",
                        "path": "description"
                      },
                      "style": {
                        "inline": {
                          "fontWeight": 600,
                          "lineHeight": 1.3
                        }
                      }
                    },
                    {
                      "id": "catalog-description",
                      "value": {
                        "type": "path",
                        "path": "catalog_description"
                      },
                      "style": {
                        "inline": {
                          "color": "#4b5563",
                          "fontSize": "12px",
                          "lineHeight": 1.4
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
                      "textAlign": "right",
                      "width": "12%"
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
                    "path": "unit_price"
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
                  "id": "amount",
                  "header": {
                    "i18nKey": "labels.amount",
                    "defaultValue": "Amount"
                  },
                  "value": {
                    "type": "path",
                    "path": "total_price"
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
              "id": "location-band-subtotal",
              "type": "stack",
              "direction": "row",
              "style": {
                "inline": {
                  "justifyContent": "space-between",
                  "padding": "6px 12px",
                  "backgroundColor": "#f9fafb",
                  "borderRadius": "0 0 6px 6px"
                }
              },
              "children": [
                {
                  "id": "location-band-subtotal-label",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.locationSubtotal",
                    "defaultValue": "Location Subtotal"
                  },
                  "style": {
                    "inline": {
                      "fontWeight": 700
                    }
                  }
                },
                {
                  "id": "location-band-subtotal-value",
                  "type": "text",
                  "content": {
                    "type": "path",
                    "path": "subtotal|currency"
                  },
                  "style": {
                    "inline": {
                      "fontWeight": 700,
                      "textAlign": "right"
                    }
                  }
                }
              ]
            }
          ]
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
                  "id": "discounts",
                  "label": {
                    "i18nKey": "labels.discounts",
                    "defaultValue": "Discounts"
                  },
                  "value": {
                    "type": "binding",
                    "bindingId": "discountTotal"
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
                  "id": "grand-total",
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
        },
        {
          "id": "client-notes-section",
          "type": "section",
          "title": {
            "i18nKey": "labels.notes",
            "defaultValue": "Notes"
          },
          "children": [
            {
              "id": "client-notes-copy",
              "type": "text",
              "content": {
                "type": "binding",
                "bindingId": "clientNotes"
              },
              "style": {
                "inline": {
                  "color": "#374151",
                  "lineHeight": 1.5
                }
              }
            }
          ]
        },
        {
          "id": "terms-section",
          "type": "section",
          "title": {
            "i18nKey": "labels.termsAndConditions",
            "defaultValue": "Terms & Conditions"
          },
          "children": [
            {
              "id": "terms-copy",
              "type": "richText",
              "content": {
                "type": "binding",
                "bindingId": "termsAndConditionsRich"
              },
              "style": {
                "inline": {
                  "color": "#374151",
                  "lineHeight": 1.5,
                  "fontSize": "13px"
                }
              }
            }
          ]
        },
        {
          "id": "signature-block",
          "type": "stack",
          "direction": "row",
          "style": {
            "inline": {
              "gap": "48px",
              "margin": "40px 0 0 0"
            }
          },
          "children": [
            {
              "id": "sig-client",
              "type": "stack",
              "direction": "column",
              "style": {
                "inline": {
                  "flex": "1",
                  "gap": "4px"
                }
              },
              "children": [
                {
                  "id": "sig-client-label",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.acceptedBy",
                    "defaultValue": "Accepted By"
                  },
                  "style": {
                    "inline": {
                      "color": "#6b7280",
                      "fontSize": "12px",
                      "fontWeight": 700
                    }
                  }
                },
                {
                  "id": "sig-client-line",
                  "type": "divider",
                  "style": {
                    "inline": {
                      "margin": "24px 0 4px 0",
                      "borderColor": "#000"
                    }
                  }
                },
                {
                  "id": "sig-client-name",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "acceptedByName"
                  },
                  "style": {
                    "inline": {
                      "color": "#9ca3af",
                      "fontSize": "12px"
                    }
                  }
                },
                {
                  "id": "sig-client-date-line",
                  "type": "divider",
                  "style": {
                    "inline": {
                      "margin": "20px 0 4px 0",
                      "borderColor": "#000"
                    }
                  }
                },
                {
                  "id": "sig-client-date",
                  "type": "text",
                  "content": {
                    "type": "binding",
                    "bindingId": "acceptedAt"
                  },
                  "style": {
                    "inline": {
                      "color": "#9ca3af",
                      "fontSize": "12px"
                    }
                  }
                }
              ]
            },
            {
              "id": "sig-issuer",
              "type": "stack",
              "direction": "column",
              "style": {
                "inline": {
                  "flex": "1",
                  "gap": "4px"
                }
              },
              "children": [
                {
                  "id": "sig-issuer-label",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.authorizedBy",
                    "defaultValue": "Authorized By"
                  },
                  "style": {
                    "inline": {
                      "color": "#6b7280",
                      "fontSize": "12px",
                      "fontWeight": 700
                    }
                  }
                },
                {
                  "id": "sig-issuer-line",
                  "type": "divider",
                  "style": {
                    "inline": {
                      "margin": "24px 0 4px 0",
                      "borderColor": "#000"
                    }
                  }
                },
                {
                  "id": "sig-issuer-name",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.signature",
                    "defaultValue": "Signature"
                  },
                  "style": {
                    "inline": {
                      "color": "#9ca3af",
                      "fontSize": "12px"
                    }
                  }
                },
                {
                  "id": "sig-issuer-date-line",
                  "type": "divider",
                  "style": {
                    "inline": {
                      "margin": "20px 0 4px 0",
                      "borderColor": "#000"
                    }
                  }
                },
                {
                  "id": "sig-issuer-date",
                  "type": "text",
                  "content": {
                    "type": "i18n",
                    "i18nKey": "labels.date",
                    "defaultValue": "Date"
                  },
                  "style": {
                    "inline": {
                      "color": "#9ca3af",
                      "fontSize": "12px"
                    }
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  }
};

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(QUOTE_TABLE))) {
    return;
  }

  for (const [code, ast] of Object.entries(STANDARD_QUOTE_TEMPLATE_ASTS)) {
    const row = CATALOG_ROWS[code];
    // migration-lint: allow 5 - bounded by the literal four-code catalog list and keyed on the unique standard_quote_document_template_code column, so no batching shape applies
    await knex(QUOTE_TABLE)
      .insert({
        name: row.name,
        version: ast.version,
        standard_quote_document_template_code: code,
        templateAst: ast,
        is_default: row.is_default,
      })
      .onConflict('standard_quote_document_template_code')
      .merge({
        templateAst: knex.raw('EXCLUDED."templateAst"'),
        updated_at: knex.fn.now(),
      });
  }
};

// Exported so the billing suite can prove the catalog migration has not drifted
// from the ASTs the code builds.
exports.__STANDARD_QUOTE_TEMPLATE_ASTS = STANDARD_QUOTE_TEMPLATE_ASTS;

exports.down = async function down() {
  // No-op: this refreshes live catalog data and should not be auto-reverted.
  // Roll forward instead.
};

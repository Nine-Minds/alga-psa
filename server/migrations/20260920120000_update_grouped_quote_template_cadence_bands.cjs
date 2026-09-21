/**
 * Rebuild the managed Standard Quote Grouped template as cadence bands.
 *
 * Ticket alga-2026-0002383. The grouped quote template previously hard-coded a
 * single "Monthly Items" table and "Monthly Total", so an annual (or quarterly
 * / semi-annual / other) recurring line was rendered under Monthly and folded
 * into the monthly total. Optional lines were indistinguishable from required
 * lines and inflated the presented base price.
 *
 * This migration replaces the shared `standard-quote-grouped` catalog row's
 * AST with the cadence-aware layout:
 *   - one repeating `cadence-bands` stack over `groupsByCadence` (renderer-
 *     computed per-cadence subtotal/tax/total and "{{cadence}} Total" footer,
 *     non-empty bands only), and
 *   - one repeating `cadence-optional-bands` stack over
 *     `groupsByCadenceWithOptionals` for the "Optional (if selected)" add-ons
 *     that are excluded from every base total.
 *
 * The literal below is the exact JSON of `buildStandardQuoteGroupedAst()` in
 * this checkout (serialized from the built AST, never hand-typed). A unit test
 * (`standardTemplates.test.ts`) deep-equals it against the code AST so the two
 * cannot drift. Editing the code AST alone is inert on existing environments:
 * the renderer reads this catalog row first.
 *
 * Only the shared standard catalog is touched. Tenant-owned custom quote
 * templates (`quote_document_templates`) keep their frozen AST; a tenant that
 * customized grouped re-clones to adopt the new layout.
 *
 * Idempotent: an upsert keyed on `standard_quote_document_template_code`.
 */

const QUOTE_TABLE = 'standard_quote_document_templates';
const STANDARD_QUOTE_GROUPED_CODE = 'standard-quote-grouped';

const GROUPED_QUOTE_AST = {
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
            "gap": "8px",
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
                "borderRadius": "6px 6px 0 0"
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
                    "id": "item-name",
                    "value": {
                      "type": "path",
                      "path": "service_name"
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
            "id": "cadence-band-totals",
            "type": "stack",
            "direction": "column",
            "style": {
              "inline": {
                "padding": "6px 12px",
                "backgroundColor": "#f9fafb",
                "borderRadius": "0 0 6px 6px",
                "gap": "2px"
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
            "gap": "8px",
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
                "padding": "6px 12px"
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
                    "id": "item-name",
                    "value": {
                      "type": "path",
                      "path": "service_name"
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
                "borderRadius": "0 0 6px 6px"
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
            "alignItems": "flex-start"
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
                "format": "currency"
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
};

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(QUOTE_TABLE))) {
    return;
  }

  await knex(QUOTE_TABLE)
    .insert({
      name: 'Grouped Quote Template',
      version: GROUPED_QUOTE_AST.version,
      standard_quote_document_template_code: STANDARD_QUOTE_GROUPED_CODE,
      templateAst: GROUPED_QUOTE_AST,
      is_default: false,
    })
    .onConflict('standard_quote_document_template_code')
    .merge({
      name: knex.raw('EXCLUDED.name'),
      version: knex.raw('EXCLUDED.version'),
      templateAst: knex.raw('EXCLUDED."templateAst"'),
      is_default: knex.raw('EXCLUDED.is_default'),
      updated_at: knex.fn.now(),
    });
};

// Exported so the billing suite can prove the catalog migration has not drifted
// from the grouped AST the code builds.
exports.__GROUPED_QUOTE_AST = GROUPED_QUOTE_AST;

exports.down = async function down() {
  // No-op: this refreshes live catalog data and should not be auto-reverted.
  // Roll forward instead.
};

import P from "parsimmon";
import { InvoiceLanguage } from 'server/src/lib/invoice-dsl/templateLanguage';
import { describe, it, expect, vi, test, beforeEach, beforeAll, afterEach, afterAll } from 'vitest';

describe('Invoice Template Parser', () => {
  const parser = InvoiceLanguage.invoiceTemplate;

  test('parses a static text field', () => {
    const input = `
      section header grid 12 x 3 {
        text 'Invoice' at 1 1 span 3 1
      }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content[0]).toMatchObject({
      type: 'staticText',
      content: 'Invoice',
      position: { column: 1, row: 1 },
      span: { columnSpan: 3, rowSpan: 1 }
    });
  });

  test('parses a template with blank lines at the end', () => {
    const input = `
      section header grid 12 x 3 {
        field client_name at 1 1 span 6 1
      }

      section items grid 12 x 10 {
        list line_items {
          field item_name at 1 1 span 6 1
          field quantity at 7 1 span 2 1
          field price at 9 1 span 2 1
          field total at 11 1 span 2 1
        }
      }

      section summary grid 12 x 4 {
        field total at 10 3 span 3 1
      }


    `;  // Note the extra newlines at the end

    const result = parser.tryParse(input);
    expect(result.sections).toHaveLength(3);
    expect(result.sections[0].type).toBe('section');
    expect(result.sections[0].name).toBe('header');
    expect(result.sections[1].type).toBe('section');
    expect(result.sections[1].name).toBe('items');
    expect(result.sections[2].type).toBe('section');
    expect(result.sections[2].name).toBe('summary');
  });

  test('parses a static text field without span', () => {
    const input = `
      section header grid 12 x 3 {
        text 'Invoice' at 1 1
      }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content[0]).toMatchObject({
      type: 'staticText',
      content: 'Invoice',
      position: { column: 1, row: 1 },
      span: { columnSpan: 1, rowSpan: 1 }
    });
  });

  test('parses a style definition', () => {
    const input = `
      section summary grid 12 x 4 {
        style total {
          font-weight: 'bold';
          font-size: 16;
        }
      }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content).toContainEqual({
      type: 'style',
      elements: ['total'],
      props: {
        'font-weight': 'bold',
        'font-size': 16
      }
    });
  });

  test('parses a style definition for static text', () => {
    const input = `
      section summary grid 12 x 4 {
        style text total {
          font-weight: 'bold';
          font-size: 16;
        }
      }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content).toContainEqual({
      type: 'style',
      elements: ['text:total'],
      props: {
        'font-weight': 'bold',
        'font-size': 16
      }
    });
  });

  test('parses a list with styled static text and fields', () => {
    const input = `
      section items grid 12 x 10 {
        list line_items {
          text header_item: "Item" at 1 1 span 6 1
          text header_quantity: "Quantity" at 7 1 span 2 1
          text header_price: "Price" at 9 1 span 2 1
          text header_total: "Total" at 11 1 span 2 1
          field item_name at 1 2 span 6 1
          field quantity at 7 2 span 2 1
          field price at 9 2 span 2 1
          field total at 11 2 span 2 1
        }
        style text header_item, text header_quantity, text header_price, text header_total {
          font-weight: 'bold';
          background-color: '#f0f0f0';
        }
      }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content[0]).toMatchObject({
      type: 'list',
      name: 'line_items',
      content: expect.arrayContaining([
        expect.objectContaining({ type: 'staticText', id: 'header_item', content: 'Item' }),
        expect.objectContaining({ type: 'staticText', id: 'header_quantity', content: 'Quantity' }),
        expect.objectContaining({ type: 'staticText', id: 'header_price', content: 'Price' }),
        expect.objectContaining({ type: 'staticText', id: 'header_total', content: 'Total' }),
        expect.objectContaining({ type: 'field', name: 'item_name' }),
        expect.objectContaining({ type: 'field', name: 'quantity' }),
        expect.objectContaining({ type: 'field', name: 'price' }),
        expect.objectContaining({ type: 'field', name: 'total' })
      ])
    });
    expect(result.sections[0].content[1]).toMatchObject({
      type: 'style',
      elements: ['text:header_item', 'text:header_quantity', 'text:header_price', 'text:header_total'],
      props: {
        'font-weight': 'bold',
        'background-color': '#f0f0f0'
      }
    });
  });

  test('parses a section with mixed field types including static text', () => {
    const input = `
      section header grid 12 x 3 {
        text 'Invoice' at 1 1 span 3 1
        field client_name at 4 1 span 5 1
        text 'Date:' at 9 1 span 2 1
        field invoice_date at 11 1 span 2 1
      }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content).toHaveLength(4);
    expect(result.sections[0].content[0]).toMatchObject({
      type: 'staticText',
      content: 'Invoice'
    });
    expect(result.sections[0].content[1]).toMatchObject({
      type: 'field',
      name: 'client_name'
    });
    expect(result.sections[0].content[2]).toMatchObject({
      type: 'staticText',
      content: 'Date:'
    });
    expect(result.sections[0].content[3]).toMatchObject({
      type: 'field',
      name: 'invoice_date'
    });
  });

  test('parses a simple section', () => {
    const input = `
    section header grid 12 x 3 {
      field client_logo at 1 1 span 3 2
      field client_name at 4 1 span 5 1
    }`;

    const result = parser.tryParse(input);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toMatchObject({
      type: 'section',
      name: 'header',
      grid: { columns: 12, minRows: 3 },
      content: expect.arrayContaining([
        {
          type: 'field',
          name: 'client_logo',
          position: { column: 1, row: 1 },
          span: { columnSpan: 3, rowSpan: 2 }
        },
        {
          type: 'field',
          name: 'client_name',
          position: { column: 4, row: 1 },
          span: { columnSpan: 5, rowSpan: 1 }
        }
      ])
    });
  });

  test('parses a group', () => {
    const input = `
    section items grid 12 x 10 {
      list line_items group by category {
      }
    }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content).toContainEqual({
      content: [],
      type: 'list',
      name: 'line_items',
      groupBy: 'category'
    });
  });

  test('parses a simple list', () => {
    const input = `
      section items grid 12 x 10 {
        list line_items {
        }
      }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content).toContainEqual({
      content: [],
      type: 'list',
      name: 'line_items',
      groupBy: null
    });
  });


  test('parses a grouped list', () => {
    const input = `
      section items grid 12 x 10 {
        list line_items group by category {
        }
      }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content).toContainEqual({
      type: 'list',
      name: 'line_items',
      groupBy: 'category',
      content: []
    });
  });

  test('parses a section with multiple lists', () => {
    const input = `
      section items grid 12 x 10 {
        list line_items {
        }
        list expenses group by category {
        }
      }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content).toContainEqual({
      type: 'list',
      name: 'line_items',
      content: [],
      groupBy: null
    });
    expect(result.sections[0].content).toContainEqual({
      type: 'list',
      name: 'expenses',
      content: [],
      groupBy: 'category'
    });
  });

  test('parses a calculation', () => {
    const input = `
    section summary grid 12 x 4 {
      calculate subtotal as sum total
    }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content[0]).toMatchObject({
      type: 'calculation',
      name: 'subtotal',
      expression: { operation: 'sum', field: 'total' },
      isGlobal: false
    });
  });

  test('parses a style definition', () => {
    const input = `
    section summary grid 12 x 4 {
      style total {
        font-weight: 'bold';
        font-size: 16;
      }
    }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content).toContainEqual({
      type: 'style',
      elements: ['total'],
      props: {
        'font-weight': 'bold',
        'font-size': 16
      }
    });
  });

  test('parses multiple style properties within a single style block', () => {
    const input = `
        section summary grid 12 x 4 {
          style total {
            font-weight: 'bold';
            font-size: 16;
            text-align: 'right';
            color: '#333333';
            border-bottom: '1px solid black';
          }
        }`;

    const result = parser.tryParse(input);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].content).toHaveLength(1);
    expect(result.sections[0].content[0]).toMatchObject({
      type: 'style',
      elements: ['total'],
      props: {
        'font-weight': 'bold',
        'font-size': 16,
        'text-align': 'right',
        'color': '#333333',
        'border-bottom': '1px solid black'
      }
    });
  });

  test('parses multiple style blocks within a section', () => {
    const input = `
        section items grid 12 x 10 {
          style item_name {
            font-weight: 'bold';
            color: '#333333';
          }
          style quantity, price {
            text-align: 'right';
          }
          style total {
            text-align: 'right';
            color: '#007bff';
          }
        }`;

    const result = parser.tryParse(input);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].content).toHaveLength(3);
    expect(result.sections[0].content[0]).toMatchObject({
      type: 'style',
      elements: ['item_name'],
      props: {
        'font-weight': 'bold',
        'color': '#333333'
      }
    });
    expect(result.sections[0].content[1]).toMatchObject({
      type: 'style',
      elements: ['quantity', 'price'],
      props: {
        'text-align': 'right'
      }
    });
    expect(result.sections[0].content[2]).toMatchObject({
      type: 'style',
      elements: ['total'],
      props: {
        'text-align': 'right',
        'color': '#007bff'
      }
    });
  });



  test('parses CSS styles with dashed property names', () => {
    const input = `
    section summary grid 12 x 4 {
      style total {
        font-weight: 'bold';
        font-size: 16;
        text-align: 'right';
        border-bottom: '1px solid #000';
      }
    }`;

    const result = parser.tryParse(input);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].content).toHaveLength(1);
    expect(result.sections[0].content[0]).toMatchObject({
      type: 'style',
      elements: ['total'],
      props: {
        'font-weight': 'bold',
        'font-size': 16,
        'text-align': 'right',
        'border-bottom': '1px solid #000'
      }
    });
  });

  test('parses a conditional', () => {
    const input = `
    section summary grid 12 x 4 {
      if total > 1000 then {
        field discount_label at 8 4 span 2 1
        field discount at 10 4 span 3 1
      }
    }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content).toContainEqual({
      type: 'conditional',
      condition: {
        field: 'total',
        op: '>',
        value: 1000
      },
      content: expect.arrayContaining([
        {
          type: 'field',
          name: 'discount_label',
          position: { column: 8, row: 4 },
          span: { columnSpan: 2, rowSpan: 1 }
        },
        {
          type: 'field',
          name: 'discount',
          position: { column: 10, row: 4 },
          span: { columnSpan: 3, rowSpan: 1 }
        }
      ])
    });
  });

  test('parses a simple section with leading whitespace', () => {
    const input = `
    section header grid 12 x 3 {
      field client_logo at 1 1 span 3 2
      field client_name at 4 1 span 5 1
    }`;

    const result = parser.tryParse(input);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toMatchObject({
      type: 'section',
      name: 'header',
      grid: { columns: 12, minRows: 3 },
      content: expect.arrayContaining([
        {
          type: 'field',
          name: 'client_logo',
          position: { column: 1, row: 1 },
          span: { columnSpan: 3, rowSpan: 2 }
        },
        {
          type: 'field',
          name: 'client_name',
          position: { column: 4, row: 1 },
          span: { columnSpan: 5, rowSpan: 1 }
        }
      ])
    });
  });

  test('parses a complete template with styles', () => {
    const input = `
    section header grid 12 x 3 {
      field client_logo at 1 1 span 3 2
      field client_name at 4 1 span 5 1
      style client_name {
        font-size: 24;
        font-weight: 'bold';
      }
    }

    section items grid 12 x 10 {
      field item_name at 1 1 span 6 1
      field quantity at 7 1 span 2 1
      field price at 9 1 span 2 1
      field total at 11 1 span 2 1
      style item_name {
        font-weight: 'bold';
        color: "#333333";
      }
    }

    section summary grid 12 x 4 {
      field subtotal at 10 1 span 3 1
      field tax at 10 2 span 3 1
      field total at 10 3 span 3 1
      style total {
        font-weight: 'bold';
        font-size: 16;
        text-align: 'right';
      }
    }`;

    const result = parser.tryParse(input);
    expect(result.sections).toHaveLength(3);
    expect(result.sections[0].content).toHaveLength(3);
    expect(result.sections[1].content).toHaveLength(5);
    expect(result.sections[2].content).toHaveLength(4);
    expect(result.sections[2].content[3]).toMatchObject({
      type: 'style',
      elements: ['total'],
      props: {
        'font-weight': 'bold',
        'font-size': 16,
        'text-align': 'right'
      }
    });
  });

  test('parses a complete template', () => {
    const input = `
    section header grid 12 x 3 {
      field client_logo at 1 1 span 3 2
      field client_name at 4 1 span 5 1
      field invoice_number at 10 1 span 3 1
      field invoice_date at 10 2 span 3 1
    }

    section items grid 12 x 10 {
      list line_items group by category {
        field item_name at 1 1 span 6 1
        field quantity at 7 1 span 2 1
        field price at 9 1 span 2 1
        field total at 11 1 span 2 1
      }

      calculate subtotal as sum total

      style item_name {
        font-weight: 'bold';
        color: "#333333";
      }
    }

    section summary grid 12 x 4 {
      field subtotal_label at 8 1 span 2 1
      field subtotal at 10 1 span 3 1
      field tax_label at 8 2 span 2 1
      field tax at 10 2 span 3 1
      field total_label at 8 3 span 2 1
      field total at 10 3 span 3 1

      if total > 1000 then {
        field discount_label at 8 4 span 2 1
        field discount at 10 4 span 3 1
      }

      style total {
        font-weight: 'bold';
        font-size: 16;
      }
    }`;

    const result = parser.tryParse(input);
    expect(result.sections).toHaveLength(3);
    expect(result.sections[0].name).toBe('header');
    expect(result.sections[1].name).toBe('items');
    expect(result.sections[2].name).toBe('summary');
  });

  test('throws an error for invalid input', () => {
    const input = `
    section invalid {
      not_a_valid_field
    }`;

    expect(() => parser.tryParse(input)).toThrow();
  });

  test('parses a field with various whitespace', () => {
    const input = `
    section header grid 12 x 3 {
      field   client_logo    at    1    1    span    3    2
      field client_name at 4 1 span 5 1
    }`;

    const result = parser.tryParse(input);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].content).toHaveLength(2);
    expect(result.sections[0].content[0]).toMatchObject({
      type: 'field',
      name: 'client_logo',
      position: { column: 1, row: 1 },
      span: { columnSpan: 3, rowSpan: 2 }
    });
    expect(result.sections[0].content[1]).toMatchObject({
      type: 'field',
      name: 'client_name',
      position: { column: 4, row: 1 },
      span: { columnSpan: 5, rowSpan: 1 }
    });
  });

  test('parses a field without span', () => {
    const input = `
    section header grid 12 x 3 {
      field client_logo at 1 1
    }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content[0]).toMatchObject({
      type: 'field',
      name: 'client_logo',
      position: { column: 1, row: 1 },
      span: { columnSpan: 1, rowSpan: 1 }
    });
  });

  test('parses a complete template with various style value types', () => {
    const input = `
        section header grid 12 x 3 {
          field client_logo at 1 1 span 3 2
          field client_name at 4 1 span 5 1
          style client_name {
            font-size: 24;
            font-weight: 'bold';
            color: '#444444';
          }
        }

        section items grid 12 x 10 {
          field item_name at 1 1 span 6 1
          field quantity at 7 1 span 2 1
          field price at 9 1 span 2 1
          field total at 11 1 span 2 1
          style item_name {
            font-weight: 'bold';
            color: 'rgb(51, 51, 51)';
            background-color: 'rgba(200, 200, 200, 0.5)';
          }
        }

        section summary grid 12 x 4 {
          field subtotal at 10 1 span 3 1
          field tax at 10 2 span 3 1
          field total at 10 3 span 3 1
          style total {
            font-weight: 'bold';
            font-size: 16;
            text-align: 'right';
            border-top: '2px solid black';
          }
        }`;

    const result = parser.tryParse(input);
    expect(result.sections).toHaveLength(3);
    expect(result.sections[0].content[2].props['color']).toBe('#444444');
    expect(result.sections[1].content[4].props['color']).toBe('rgb(51, 51, 51)');
    expect(result.sections[1].content[4].props['background-color']).toBe('rgba(200, 200, 200, 0.5)');
    expect(result.sections[2].content[3].props['border-top']).toBe('2px solid black');
  });


  test('parses multiple fields in a section', () => {
    const input = `
    section header grid 12 x 3 {
      field client_logo at 1 1 span 3 2
      field client_name at 4 1 span 5 1
      field invoice_number at 10 1 span 3 1
    }`;

    const result = parser.tryParse(input);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].content).toHaveLength(3);
    expect(result.sections[0].content[0]).toMatchObject({
      type: 'field',
      name: 'client_logo',
      position: { column: 1, row: 1 },
      span: { columnSpan: 3, rowSpan: 2 }
    });
    expect(result.sections[0].content[1]).toMatchObject({
      type: 'field',
      name: 'client_name',
      position: { column: 4, row: 1 },
      span: { columnSpan: 5, rowSpan: 1 }
    });
    expect(result.sections[0].content[2]).toMatchObject({
      type: 'field',
      name: 'invoice_number',
      position: { column: 10, row: 1 },
      span: { columnSpan: 3, rowSpan: 1 }
    });
  });

  test('parses a section with mixed content types', () => {
    const input = `
    section items grid 12 x 10 {
      field item_name at 1 1 span 6 1
      list line_items group by category {
      }
      calculate subtotal as sum total
      style item_name {
        font-weight: 'bold';
      }
      if total > 1000 then {
        field discount at 10 1 span 2 1
      }
    }`;

    const result = parser.tryParse(input);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].content).toHaveLength(5);
    expect(result.sections[0].content[0].type).toBe('field');
    expect(result.sections[0].content[1].type).toBe('list');
    expect(result.sections[0].content[2].type).toBe('calculation');
    expect(result.sections[0].content[3].type).toBe('style');
    expect(result.sections[0].content[4].type).toBe('conditional');
  });

  test('parses a style definition with multiple elements', () => {
    const input = `
        section summary grid 12 x 4 {
          style quantity, price, total {
            text-align: 'right';
            font-weight: 'bold';
          }
        }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content).toContainEqual({
      type: 'style',
      elements: ['quantity', 'price', 'total'],
      props: {
        'text-align': 'right',
        'font-weight': 'bold'
      }
    });
  });

  test('parses a complete template with multiple style blocks', () => {
    const input = `
        section header grid 12 x 3 {
          field client_logo at 1 1 span 3 2
          field client_name at 4 1 span 5 1
          style client_name {
            font-size: 24;
            font-weight: 'bold';
          }
        }

        section items grid 12 x 10 {
          field item_name at 1 1 span 6 1
          field quantity at 7 1 span 2 1
          field price at 9 1 span 2 1
          field total at 11 1 span 2 1
          style item_name {
            font-weight: 'bold';
          }
          style quantity, price, total {
            text-align: 'right';
          }
        }

        section summary grid 12 x 4 {
          field subtotal at 10 1 span 3 1
          field tax at 10 2 span 3 1
          field total at 10 3 span 3 1
          style subtotal, tax {
            text-align: 'right';
          }
          style total {
            font-weight: 'bold';
            font-size: 16;
            text-align: 'right';
          }
        }`;

    const result = parser.tryParse(input);
    expect(result.sections).toHaveLength(3);
    expect(result.sections[0].content).toHaveLength(3);
    expect(result.sections[1].content).toHaveLength(6);
    expect(result.sections[2].content).toHaveLength(5);
  });

  test('parses a complete template with list', () => {
    const input = `
      section header grid 12 x 3 {
        field client_name at 1 1 span 6 1
      }

      section items grid 12 x 10 {
        list line_items {
            field item_name at 1 1 span 6 1
            field quantity at 7 1 span 2 1
            field price at 9 1 span 2 1
            field total at 11 1 span 2 1
        }
      }

      section summary grid 12 x 4 {
        field total at 10 3 span 3 1
      }`;

    const result = parser.tryParse(input);
    expect(result.sections).toHaveLength(3);
    expect(result.sections[1].content[0]).toMatchObject({
      type: 'list',
      name: 'line_items'
    });
  });


  test('parses a complete template with lists', () => {
    const input = `
      section header grid 12 x 3 {
        field client_name at 1 1 span 6 1
      }

      section items grid 12 x 10 {
        list line_items {
            field item_name at 1 1 span 6 1
            field quantity at 7 1 span 2 1
            field price at 9 1 span 2 1
            field total at 11 1 span 2 1
        }
      }

      section categories grid 12 x 10 {
        list expenses group by category {
            field category_name at 1 1 span 6 1
            field category_total at 7 1 span 6 1
        }
      }

      section summary grid 12 x 4 {
        field total at 10 3 span 3 1
      }`;

    const result = parser.tryParse(input);
    expect(result.sections).toHaveLength(4);
    expect(result.sections[1].content[0]).toMatchObject({
      type: 'list',
      name: 'line_items',
      groupBy: null
    });
    expect(result.sections[2].content[0]).toMatchObject({
      type: 'list',
      name: 'expenses',
      groupBy: 'category'
    });
  });

  test('parses a simple list with content', () => {
    const input = `
      section items grid 12 x 10 {
        list line_items {
          field item_name at 1 1 span 6 1
          field quantity at 7 1 span 2 1
          field price at 9 1 span 2 1
          field total at 11 1 span 2 1
        }
      }`;

    const result = parser.tryParse(input);
    console.log(result.sections[0].content[0]);
    expect(result.sections[0].content[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'item_name' }),
        expect.objectContaining({ name: 'quantity' }),
        expect.objectContaining({ name: 'price' }),
        expect.objectContaining({ name: 'total' })
      ])
    );
  });

  test('parses a grouped list with content', () => {
    const input = `
      section categories grid 12 x 10 {
        list expenses group by category {
          field category_name at 1 1 span 6 1
          field category_total at 7 1 span 6 1
        }
      }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content[0].type).toBe('list');
    expect(result.sections[0].content[0].name).toBe('expenses');
    expect(result.sections[0].content[0].groupBy).toBe('category');
    expect(result.sections[0].content[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'field', name: 'category_name' }),
        expect.objectContaining({ type: 'field', name: 'category_total' })
      ])
    );
  });
  test('parses a complete template with fields and lists', () => {
    const input = `
      section header grid 12 x 3 {
        field client_name at 1 1 span 6 1
        field invoice_number at 10 1 span 2 1
      }

      section items grid 12 x 10 {
        field item_label at 1 1 span 6 1
        list line_items {
          field item_name at 1 1 span 6 1
          field quantity at 7 1 span 2 1
          field price at 9 1 span 2 1
          field total at 11 1 span 2 1
        }
      }

      section categories grid 12 x 10 {
        list expenses group by category {
          field category_name at 1 1 span 6 1
          field category_total at 7 1 span 6 1
        }
      }

      section summary grid 12 x 4 {
        field total at 10 3 span 3 1
      }`;

    const result = parser.tryParse(input);
    expect(result.sections).toHaveLength(4);
    expect(result.sections[0].content[0]).toMatchObject({
      type: 'field',
      name: 'client_name',
      position: { column: 1, row: 1 },
      span: { columnSpan: 6, rowSpan: 1 }
    });
    expect(result.sections[1].content[0]).toMatchObject({
      type: 'field',
      name: 'item_label',
      position: { column: 1, row: 1 },
      span: { columnSpan: 6, rowSpan: 1 }
    });
    expect(result.sections[1].content[1]).toEqual(
      expect.objectContaining({
        type: 'list',
        name: 'line_items',
        groupBy: null,
        content: expect.arrayContaining([
          expect.objectContaining({ name: 'item_name' }),
          expect.objectContaining({ name: 'quantity' }),
          expect.objectContaining({ name: 'price' }),
          expect.objectContaining({ name: 'total' })
        ])
      })
    );
    expect(result.sections[2].content[0]).toEqual(
      expect.objectContaining({
        type: 'list',
        name: 'expenses',
        groupBy: 'category',
        content: expect.arrayContaining([
          expect.objectContaining({ name: 'category_name' }),
          expect.objectContaining({ name: 'category_total' })
        ])
      })
    );
    expect(result.sections[3].content[0]).toEqual(
      expect.objectContaining({ name: 'total' })
    );
  });

  test('parses a list with static text and fields', () => {
    const input = `
      section items grid 12 x 10 {
        list line_items {
          text "Item" at 1 1 span 6 1
          text "Quantity" at 7 1 span 2 1
          text "Price" at 9 1 span 2 1
          text "Total" at 11 1 span 2 1
          field item_name at 1 2 span 6 1
          field quantity at 7 2 span 2 1
          field price at 9 2 span 2 1
          field total at 11 2 span 2 1
        }
      }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content[0]).toMatchObject({
      type: 'list',
      name: 'line_items',
      content: expect.arrayContaining([
        expect.objectContaining({ type: 'staticText', content: 'Item' }),
        expect.objectContaining({ type: 'staticText', content: 'Quantity' }),
        expect.objectContaining({ type: 'staticText', content: 'Price' }),
        expect.objectContaining({ type: 'staticText', content: 'Total' }),
        expect.objectContaining({ type: 'field', name: 'item_name' }),
        expect.objectContaining({ type: 'field', name: 'quantity' }),
        expect.objectContaining({ type: 'field', name: 'price' }),
        expect.objectContaining({ type: 'field', name: 'total' })
      ])
    });
  });

  test('parses a complete template with static text fields', () => {
    const input = `
      section header grid 12 x 3 {
        text 'INVOICE' at 1 1 span 12 1
        field client_name at 1 2 span 6 1
        text 'Invoice Number:' at 7 2 span 3 1
        field invoice_number at 10 2 span 3 1
      }

      section items grid 12 x 10 {
        text 'Description' at 1 1 span 6 1
        text 'Quantity' at 7 1 span 2 1
        text 'Price' at 9 1 span 2 1
        text 'Total' at 11 1 span 2 1
        list line_items {
          field description at 1 2 span 6 1
          field quantity at 7 2 span 2 1
          field price at 9 2 span 2 1
          field total at 11 2 span 2 1
        }
      }

      section summary grid 12 x 4 {
        text 'Total:' at 9 1 span 2 1
        field total_amount at 11 1 span 2 1
      }`;

    const result = parser.tryParse(input);
    expect(result.sections).toHaveLength(3);
    expect(result.sections[0].content).toHaveLength(4);
    expect(result.sections[1].content).toHaveLength(5);
    expect(result.sections[2].content).toHaveLength(2);

    // Check for static text in header
    expect(result.sections[0].content[0]).toMatchObject({
      type: 'staticText',
      content: 'INVOICE'
    });

    // Check for static text in items section
    expect(result.sections[1].content[0]).toMatchObject({
      type: 'staticText',
      content: 'Description'
    });

    // Check for static text in summary
    expect(result.sections[2].content[0]).toMatchObject({
      type: 'staticText',
      content: 'Total:'
    });
  });

  test('parses fields with nested properties', () => {
    const input = `
      section header grid 12 x 4 {
        field client.client_logo at 1 1 span 3 2
        field client.client_name at 4 1 span 5 1
        field client.client_address at 4 2 span 5 1
        field invoice_number at 10 1 span 3 1
        field invoice_date at 10 2 span 3 1
        field client.client_name at 1 3 span 6 1
        field client.client_address at 1 4 span 6 1
      }`;

    const result = parser.tryParse(input);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].content).toHaveLength(7);
    expect(result.sections[0].content[0]).toMatchObject({
      type: 'field',
      name: 'client.client_logo',
      position: { column: 1, row: 1 },
      span: { columnSpan: 3, rowSpan: 2 }
    });
    expect(result.sections[0].content[1]).toMatchObject({
      type: 'field',
      name: 'client.client_name',
      position: { column: 4, row: 1 },
      span: { columnSpan: 5, rowSpan: 1 }
    });
    expect(result.sections[0].content[5]).toMatchObject({
      type: 'field',
      name: 'client.client_name',
      position: { column: 1, row: 3 },
      span: { columnSpan: 6, rowSpan: 1 }
    });
  });

  test('parses calculation fields correctly', () => {
    const input = `
      section summary grid 12 x 4 {
        calculate subtotal as sum total_price
        field subtotal at 10 1 span 3 1
        field tax at 10 2 span 3 1
        field total at 10 3 span 3 1
      }`;

    const result = parser.tryParse(input);
    expect(result.sections).toHaveLength(1);
    // expect(result.sections[0].content).toHaveLength(6);

    // Check calculation fields
    expect(result.sections[0].content[0]).toMatchObject({
      type: 'calculation',
      name: 'subtotal',
      expression: {
        operation: 'sum',
        field: 'total_price'
      }
    });
  });

  test('parses calculations across sections', () => {
    const input = `
      section items grid 12 x 10 {
        global calculate subtotal as sum total_price
      }
    
      section summary grid 12 x 4 {
        calculate tax as sum tax_amount
        calculate total as sum total_price
        field subtotal at 10 1 span 3 1
        field tax at 10 2 span 3 1
        field total at 10 3 span 3 1
      }`;

    const result = parser.tryParse(input);
    expect(result.sections).toHaveLength(2);

    // Check calculations in summary section
    expect(result.sections[1].content[0]).toMatchObject({
      type: 'calculation',
      name: 'tax',
      expression: {
        operation: 'sum',
        field: 'tax_amount'
      }
    });

    expect(result.sections[1].content[1]).toMatchObject({
      type: 'calculation',
      name: 'total',
      expression: {
        operation: 'sum',
        field: 'total_price'
      }
    });

    // Check fields in summary section
    expect(result.sections[1].content[2]).toMatchObject({
      type: 'field',
      name: 'subtotal',
      position: { column: 10, row: 1 },
      span: { columnSpan: 3, rowSpan: 1 }
    });

    expect(result.sections[1].content[3]).toMatchObject({
      type: 'field',
      name: 'tax',
      position: { column: 10, row: 2 },
      span: { columnSpan: 3, rowSpan: 1 }
    });

    expect(result.sections[1].content[4]).toMatchObject({
      type: 'field',
      name: 'total',
      position: { column: 10, row: 3 },
      span: { columnSpan: 3, rowSpan: 1 }
    });

    // now check the subtotal calculation in the summary section
    expect(result.globals[0]).toMatchObject({
      type: 'calculation',
      name: 'subtotal',
      expression: {
        operation: 'sum',
        field: 'total_price'
      }
    });
  });

  test('parses grouped items with a global calculation', () => {
    const input = `
      section header grid 12 x 3 {
        field client_name at 1 1 span 6 1
        field invoice_number at 10 1 span 3 1
      }
    
      section items grid 12 x 10 {
        list line_items group by category {
          field category_name at 1 1 span 12 1
          field item_name at 1 2 span 6 1
          field quantity at 7 2 span 2 1
          field price at 9 2 span 2 1
          field total at 11 2 span 2 1
        }
        global calculate grand_total as sum total
      }
    
      section summary grid 12 x 4 {
        field subtotal_label at 8 1 span 2 1
        field subtotal at 10 1 span 3 1
        field tax_label at 8 2 span 2 1
        field tax at 10 2 span 3 1
        field total_label at 8 3 span 2 1
        field grand_total at 10 3 span 3 1
      }`;

    const result = parser.tryParse(input);

    expect(result.sections).toHaveLength(3);

    // Check header section
    expect(result.sections[0].name).toBe('header');
    expect(result.sections[0].content).toHaveLength(2);

    // Check items section
    expect(result.sections[1].name).toBe('items');
    expect(result.sections[1].content).toHaveLength(1);
    expect(result.sections[1].content[0]).toMatchObject({
      type: 'list',
      name: 'line_items',
      groupBy: 'category',
      content: expect.arrayContaining([
        expect.objectContaining({ name: 'category_name' }),
        expect.objectContaining({ name: 'item_name' }),
        expect.objectContaining({ name: 'quantity' }),
        expect.objectContaining({ name: 'price' }),
        expect.objectContaining({ name: 'total' })
      ])
    });

    // Check global calculation
    expect(result.globals).toHaveLength(1);
    expect(result.globals[0]).toMatchObject({
      type: 'calculation',
      name: 'grand_total',
      expression: {
        operation: 'sum',
        field: 'total'
      },
      isGlobal: true
    });

    // Check summary section
    expect(result.sections[2].name).toBe('summary');
    expect(result.sections[2].content).toHaveLength(6);
    expect(result.sections[2].content[5]).toMatchObject({
      type: 'field',
      name: 'grand_total',
      position: { column: 10, row: 3 },
      span: { columnSpan: 3, rowSpan: 1 }
    });
  });

  // Add these tests to your existing describe block

  test('parses a calculation with listReference', () => {
    const input = `
  section summary grid 12 x 4 {
    calculate total_price as sum total_price from invoice_charges
    field total_price at 10 1 span 3 1
  }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content[0]).toMatchObject({
      type: 'calculation',
      name: 'total_price',
      expression: {
        operation: 'sum',
        field: 'total_price'
      },
      listReference: 'invoice_charges'
    });
  });

  test('parses multiple calculations with different listReferences', () => {
    const input = `
  section summary grid 12 x 4 {
    calculate total_price as sum total_price from invoice_charges
    calculate total_expenses as sum amount from expenses
    calculate average_price as avg unit_price from invoice_charges
    field total_price at 10 1 span 3 1
    field total_expenses at 10 2 span 3 1
    field average_price at 10 3 span 3 1
  }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content[0]).toMatchObject({
      type: 'calculation',
      name: 'total_price',
      expression: {
        operation: 'sum',
        field: 'total_price'
      },
      listReference: 'invoice_charges'
    });
    expect(result.sections[0].content[1]).toMatchObject({
      type: 'calculation',
      name: 'total_expenses',
      expression: {
        operation: 'sum',
        field: 'amount'
      },
      listReference: 'expenses'
    });
    expect(result.sections[0].content[2]).toMatchObject({
      type: 'calculation',
      name: 'average_price',
      expression: {
        operation: 'avg',
        field: 'unit_price'
      },
      listReference: 'invoice_charges'
    });
  });

  test('parses a calculation without listReference', () => {
    const input = `
  section summary grid 12 x 4 {
    calculate total as sum total_amount
    field total at 10 1 span 3 1
  }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content[0]).toMatchObject({
      type: 'calculation',
      name: 'total',
      expression: {
        operation: 'sum',
        field: 'total_amount'
      }
    });
  });

  test('parses a mixture of calculations with and without listReference', () => {
    const input = `
  section summary grid 12 x 4 {
    calculate subtotal as sum total_price from invoice_charges
    calculate tax as sum tax_amount
    calculate total as sum subtotal
    field subtotal at 10 1 span 3 1
    field tax at 10 2 span 3 1
    field total at 10 3 span 3 1
  }`;

    const result = parser.tryParse(input);
    expect(result.sections[0].content[0]).toMatchObject({
      type: 'calculation',
      name: 'subtotal',
      expression: {
        operation: 'sum',
        field: 'total_price'
      },
      listReference: 'invoice_charges'
    });
    expect(result.sections[0].content[1]).toMatchObject({
      type: 'calculation',
      name: 'tax',
      expression: {
        operation: 'sum',
        field: 'tax_amount'
      }
    });
    expect(result.sections[0].content[2]).toMatchObject({
      type: 'calculation',
      name: 'total',
      expression: {
        operation: 'sum',
        field: 'subtotal'
      }
    });
  });

  test('parses global calculations with listReference', () => {
    const input = `
  section items grid 12 x 10 {
    global calculate grand_total as sum total_price from invoice_charges
    list invoice_charges {
      field item_name at 1 1 span 6 1
      field total_price at 7 1 span 6 1
    }
  }
  
  section summary grid 12 x 4 {
    field grand_total at 10 1 span 3 1
  }`;

    const result = parser.tryParse(input);
    expect(result.globals[0]).toMatchObject({
      type: 'calculation',
      name: 'grand_total',
      expression: {
        operation: 'sum',
        field: 'total_price'
      },
      listReference: 'invoice_charges',
      isGlobal: true
    });
  });


});




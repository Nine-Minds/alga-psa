import { Temporal } from '@js-temporal/polyfill';
import type { InvoiceViewModel } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';

export const sampleInvoices: InvoiceViewModel[] = [
  {
    invoice_id: uuidv4(),
    invoice_date: Temporal.PlainDate.from('2023-07-01'),
    due_date: Temporal.PlainDate.from('2023-07-31'),
    subtotal: 1500.00,
    tax: 150.00,
    total: 1650.00,
    total_amount: 1650.00,
    status: 'paid',
    invoice_number: 'WONDER-001',
    invoice_charges: [
      {
        description: 'Unbirthday Party Planning Services',
        quantity: 364,
        unit_price: 2.75,
        total_price: 1001.00,
        tax_amount: 100.10,
        net_amount: 1001.00,
        item_id: 'UNBIRTH-001',
        invoice_id: 'MAD-001',
        is_manual: false,
        rate: 2.75
      },
      {
        description: 'Cheshire Cat Grin Polishing',
        quantity: 9,
        unit_price: 55.44,
        total_price: 499.00,
        tax_amount: 49.90,
        net_amount: 499.00,
        item_id: 'GRIN-002',
        invoice_id: 'MAD-001',
        is_manual: false,
        rate: 55.44
      }
    ],
    client: {
      name: 'Wonderland Whimsies Ltd.',
      logo: 'https://example.com/cheshire-cat-logo.png',
      address: '1 Rabbit Hole Lane, Wonderland, WL 12345, Wonderland'
    },
    contact: {
      name: 'Alice Liddell',
      address: '1 Rabbit Hole Lane, Wonderland, WL 12345, Wonderland'
    },
    client_id: 'WNDR-001',
    credit_applied: 0,
    is_manual: false,
    currencyCode: 'USD'
  },
  {
    invoice_id: uuidv4(),
    invoice_date: Temporal.PlainDate.from('2023-07-15'),
    due_date: Temporal.PlainDate.from('2023-08-14'),
    subtotal: 3000.00,
    tax: 300.00,
    total: 3300.00,
    total_amount: 3300.00,
    status: 'pending',
    invoice_number: 'QUEEN-002',
    invoice_charges: [
      {
        description: 'Royal Croquet Ground Maintenance',
        quantity: 42,
        unit_price: 66.67,
        total_price: 2800.00,
        tax_amount: 280.00,
        net_amount: 2800.00,
        item_id: 'CROQUET-001',
        invoice_id: 'RED-002',
        is_manual: false,
        rate: 66.67
      },
      {
        description: 'Painting the Roses Red',
        quantity: 100,
        unit_price: 2.00,
        total_price: 200.00,
        tax_amount: 20.00,
        net_amount: 200.00,
        item_id: 'ROSES-002',
        invoice_id: 'RED-002',
        is_manual: false,
        rate: 2
      }
    ],
    client: {
      name: 'Red Queen Enterprises',
      logo: 'https://example.com/red-queen-logo.png',
      address: 'Heart Castle, Queen\'s Way, Card Castle, WL 54321, Wonderland'
    },
    contact: {
      name: 'Knave of Hearts',
      address: 'Heart Castle, Queen\'s Way, Card Castle, WL 54321, Wonderland'
    },
    client_id: 'RQE-001',
    credit_applied: 0,
    is_manual: false,
    currencyCode: 'USD'
  }
];

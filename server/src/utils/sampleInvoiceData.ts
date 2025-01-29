import { InvoiceViewModel } from '../interfaces/invoice.interfaces';
import { v4 as uuidv4 } from 'uuid';

export const sampleInvoices: InvoiceViewModel[] = [
  {
    invoice_id: uuidv4(),
    invoice_date: new Date('2023-07-01'),
    due_date: new Date('2023-07-31'),
    subtotal: 1500.00,
    tax: 150.00,
    total: 1650.00,
    total_amount: 1650.00,
    status: 'paid',
    invoice_number: 'WONDER-001',
    invoice_items: [
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
        service_type: 'Planning',
        category: 'Services'
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
        service_type: 'Maintenance',
        category: 'Services'
      }
    ],
    metadata: {
      project: {
        name: 'Operation: Madness & Tea',
        manager: 'The Mad Hatter',
        status: 'In Progress',
        priority: 'High'
      },
      billing: {
        terms: 'Net 30',
        method: 'Bank Transfer',
        reference: 'PO-123456'
      }
    },
    company: {
      name: 'Wonderland Whimsies Ltd.',
      logo: 'https://example.com/cheshire-cat-logo.png',
      address: {
        street: '1 Rabbit Hole Lane',
        city: 'Wonderland',
        state: 'WL',
        zip: '12345',
        country: 'Wonderland'
      },
      contact: {
        name: 'Alice Liddell',
        title: 'Chief Tea Officer',
        email: 'alice@wonderland.com',
        phone: '555-0123'
      }
    },
    summary: {
      subtotal_label: 'Subtotal',
      subtotal: 1500.00,
      tax_label: 'Tax (10%)',
      tax: 150.00,
      total_label: 'Total',
      total: 1650.00,
      currency: 'USD'
    },
    company_id: 'WNDR-001',
    credit_applied: 0,
    is_manual: false
  },
  {
    invoice_id: uuidv4(),
    invoice_date: new Date('2023-07-15'),
    due_date: new Date('2023-08-14'),
    subtotal: 3000.00,
    tax: 300.00,
    total: 3300.00,
    total_amount: 3300.00,
    status: 'pending',
    invoice_number: 'QUEEN-002',
    invoice_items: [
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
        service_type: 'Maintenance',
        category: 'Grounds'
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
        service_type: 'Painting',
        category: 'Grounds'
      }
    ],
    metadata: {
      project: {
        name: 'Her Majesty\'s Garden Party',
        manager: 'White Rabbit',
        status: 'Urgent',
        priority: 'Critical'
      },
      billing: {
        terms: 'Due Immediately',
        method: 'Royal Treasury',
        reference: 'ROYAL-789'
      }
    },
    company: {
      name: 'Red Queen Enterprises',
      logo: 'https://example.com/red-queen-logo.png',
      address: {
        street: 'Heart Castle, Queen\'s Way',
        city: 'Card Castle',
        state: 'WL',
        zip: '54321',
        country: 'Wonderland'
      },
      contact: {
        name: 'Knave of Hearts',
        title: 'Royal Procurement Officer',
        email: 'knave@redqueen.com',
        phone: '555-9876'
      }
    },
    summary: {
      subtotal_label: 'Subtotal',
      subtotal: 3000.00,
      tax_label: 'Tax (10%)',
      tax: 300.00,
      total_label: 'Total',
      total: 3300.00,
      currency: 'USD'
    },
    company_id: 'RQE-001',
    credit_applied: 0,
    is_manual: false
  }
];

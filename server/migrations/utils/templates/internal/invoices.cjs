/**
 * Source of truth: invoice-related internal notification templates.
 */
const TEMPLATES = [
  {
    templateName: 'invoice-generated',
    subtypeName: 'invoice-generated',
    translations: {
      en: { title: 'New Invoice Generated', message: 'Invoice #{{invoiceNumber}} for {{clientName}} has been generated' },
      fr: { title: 'Nouvelle facture générée', message: 'La facture #{{invoiceNumber}} pour {{clientName}} a été générée' },
      es: { title: 'Nueva factura generada', message: 'La factura #{{invoiceNumber}} para {{clientName}} se ha generado' },
      de: { title: 'Neue Rechnung erstellt', message: 'Rechnung #{{invoiceNumber}} für {{clientName}} wurde erstellt' },
      nl: { title: 'Nieuwe factuur gegenereerd', message: 'Factuur #{{invoiceNumber}} voor {{clientName}} is gegenereerd' },
      it: { title: 'Nuova fattura generata', message: 'La fattura #{{invoiceNumber}} per {{clientName}} è stata generata' },
      pl: { title: 'Nowa faktura utworzona', message: 'Faktura #{{invoiceNumber}} dla {{clientName}} została utworzona' },
    },
  },
  {
    templateName: 'payment-received',
    subtypeName: 'payment-received',
    translations: {
      en: { title: 'Payment Received', message: 'Payment of {{amount}} received for invoice #{{invoiceNumber}}' },
      fr: { title: 'Paiement reçu', message: 'Paiement de {{amount}} reçu pour la facture #{{invoiceNumber}}' },
      es: { title: 'Pago recibido', message: 'Pago de {{amount}} recibido para la factura #{{invoiceNumber}}' },
      de: { title: 'Zahlung erhalten', message: 'Zahlung von {{amount}} für Rechnung #{{invoiceNumber}} erhalten' },
      nl: { title: 'Betaling ontvangen', message: 'Betaling van {{amount}} ontvangen voor factuur #{{invoiceNumber}}' },
      it: { title: 'Pagamento ricevuto', message: 'Pagamento di {{amount}} ricevuto per la fattura #{{invoiceNumber}}' },
      pl: { title: 'Otrzymano płatność', message: 'Otrzymano płatność {{amount}} za fakturę #{{invoiceNumber}}' },
    },
  },
  {
    templateName: 'payment-overdue',
    subtypeName: 'payment-overdue',
    translations: {
      en: { title: 'Payment Overdue', message: 'Invoice #{{invoiceNumber}} is {{daysOverdue}} days overdue' },
      fr: { title: 'Paiement en retard', message: 'La facture #{{invoiceNumber}} est en retard de {{daysOverdue}} jours' },
      es: { title: 'Pago vencido', message: 'La factura #{{invoiceNumber}} está vencida desde hace {{daysOverdue}} días' },
      de: { title: 'Zahlung überfällig', message: 'Rechnung #{{invoiceNumber}} ist {{daysOverdue}} Tage überfällig' },
      nl: { title: 'Betaling achterstallig', message: 'Factuur #{{invoiceNumber}} is {{daysOverdue}} dagen achterstallig' },
      it: { title: 'Pagamento scaduto', message: 'La fattura #{{invoiceNumber}} è scaduta da {{daysOverdue}} giorni' },
      pl: { title: 'Płatność po terminie', message: 'Faktura #{{invoiceNumber}} jest przeterminowana o {{daysOverdue}} dni' },
    },
  },
];

module.exports = { TEMPLATES };

/**
 * Source of truth: inventory internal notification templates.
 */
const TEMPLATES = [
  {
    templateName: 'inventory-low-stock',
    subtypeName: 'inventory-low-stock',
    translations: {
      en: {
        title: 'Low stock at {{locationName}}',
        message: '{{productCount}} product(s) at {{locationName}} are at or below their reorder point: {{summary}}',
      },
      fr: {
        title: 'Stock bas à {{locationName}}',
        message: '{{productCount}} produit(s) à {{locationName}} sont au niveau ou en dessous de leur seuil de réapprovisionnement : {{summary}}',
      },
      es: {
        title: 'Stock bajo en {{locationName}}',
        message: '{{productCount}} producto(s) en {{locationName}} están en o por debajo de su punto de pedido: {{summary}}',
      },
      de: {
        title: 'Niedriger Bestand bei {{locationName}}',
        message: '{{productCount}} Produkt(e) bei {{locationName}} liegen auf oder unter dem Meldebestand: {{summary}}',
      },
      nl: {
        title: 'Lage voorraad bij {{locationName}}',
        message: '{{productCount}} product(en) bij {{locationName}} zitten op of onder het bestelpunt: {{summary}}',
      },
      it: {
        title: 'Scorte basse presso {{locationName}}',
        message: '{{productCount}} prodotto/i presso {{locationName}} sono al livello di riordino o al di sotto: {{summary}}',
      },
      pl: {
        title: 'Niski stan magazynowy w {{locationName}}',
        message: '{{productCount}} produkt(ów) w {{locationName}} osiągnęło lub spadło poniżej punktu zamawiania: {{summary}}',
      },
      pt: {
        title: 'Estoque baixo em {{locationName}}',
        message: '{{productCount}} produto(s) em {{locationName}} estão no ponto de reposição ou abaixo dele: {{summary}}',
      },
    },
  },
  {
    templateName: 'inventory-po-received',
    subtypeName: 'inventory-po-received',
    translations: {
      en: {
        title: 'Purchase order {{poNumber}} received',
        message: '{{receivedLineCount}} line(s) received from {{vendorName}}.',
      },
      fr: {
        title: 'Bon de commande {{poNumber}} recu',
        message: '{{receivedLineCount}} ligne(s) recue(s) de {{vendorName}}.',
      },
      es: {
        title: 'Orden de compra {{poNumber}} recibida',
        message: '{{receivedLineCount}} linea(s) recibida(s) de {{vendorName}}.',
      },
      de: {
        title: 'Bestellung {{poNumber}} erhalten',
        message: '{{receivedLineCount}} Position(en) von {{vendorName}} erhalten.',
      },
      nl: {
        title: 'Inkooporder {{poNumber}} ontvangen',
        message: '{{receivedLineCount}} regel(s) ontvangen van {{vendorName}}.',
      },
      it: {
        title: "Ordine d'acquisto {{poNumber}} ricevuto",
        message: '{{receivedLineCount}} riga/righe ricevute da {{vendorName}}.',
      },
      pl: {
        title: 'Zamówienie zakupu {{poNumber}} odebrane',
        message: 'Odebrano {{receivedLineCount}} pozycję(i) od {{vendorName}}.',
      },
      pt: {
        title: 'Pedido de compra {{poNumber}} recebido',
        message: '{{receivedLineCount}} linha(s) recebida(s) de {{vendorName}}.',
      },
    },
  },
];

module.exports = { TEMPLATES };

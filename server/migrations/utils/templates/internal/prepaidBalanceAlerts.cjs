/**
 * Source of truth: prepaid balance alert internal notification templates.
 *
 * Both alert variants target the client's account manager as a high-priority
 * internal warning. Variables are resolved by the server-side delivery layer;
 * the same variables are used by every locale.
 */
const TEMPLATES = [
  {
    templateName: 'prepaid-credit-low-balance',
    subtypeName: 'prepaid-credit-low-balance',
    translations: {
      en: {
        title: 'Prepaid credit running low: {{clientName}}',
        message:
          'Prepaid credit for {{clientName}} has dropped below the configured threshold. Available: {{available}} {{currency}} (threshold: {{threshold}} {{currency}}). [View client]({{link}}).',
      },
      fr: {
        title: 'Crédit prépayé faible : {{clientName}}',
        message:
          'Le crédit prépayé de {{clientName}} est passé sous le seuil configuré. Disponible : {{available}} {{currency}} (seuil : {{threshold}} {{currency}}). [Voir le client]({{link}}).',
      },
      es: {
        title: 'Crédito prepagado bajo: {{clientName}}',
        message:
          'El crédito prepagado de {{clientName}} ha caído por debajo del umbral configurado. Disponible: {{available}} {{currency}} (umbral: {{threshold}} {{currency}}). [Ver cliente]({{link}}).',
      },
      de: {
        title: 'Prepaid-Guthaben niedrig: {{clientName}}',
        message:
          'Das Prepaid-Guthaben von {{clientName}} liegt unter dem konfigurierten Schwellenwert. Verfügbar: {{available}} {{currency}} (Schwellenwert: {{threshold}} {{currency}}). [Kunde anzeigen]({{link}}).',
      },
      nl: {
        title: 'Prepaid-tegoed bijna op: {{clientName}}',
        message:
          'Het prepaid-tegoed van {{clientName}} is onder de geconfigureerde drempel gedaald. Beschikbaar: {{available}} {{currency}} (drempel: {{threshold}} {{currency}}). [Klant bekijken]({{link}}).',
      },
      it: {
        title: 'Credito prepagato basso: {{clientName}}',
        message:
          'Il credito prepagato di {{clientName}} è sceso al di sotto della soglia configurata. Disponibile: {{available}} {{currency}} (soglia: {{threshold}} {{currency}}). [Visualizza cliente]({{link}}).',
      },
      pl: {
        title: 'Niski stan kredytu przedpłaconego: {{clientName}}',
        message:
          'Kredyt przedpłacony dla {{clientName}} spadł poniżej skonfigurowanego progu. Dostępne: {{available}} {{currency}} (próg: {{threshold}} {{currency}}). [Zobacz klienta]({{link}}).',
      },
      pt: {
        title: 'Crédito pré-pago baixo: {{clientName}}',
        message:
          'O crédito pré-pago de {{clientName}} caiu abaixo do limite configurado. Disponível: {{available}} {{currency}} (limite: {{threshold}} {{currency}}). [Ver cliente]({{link}}).',
      },
    },
  },
  {
    templateName: 'prepaid-bucket-threshold-reached',
    subtypeName: 'prepaid-bucket-threshold-reached',
    translations: {
      en: {
        title: 'Prepaid hour bucket threshold reached: {{clientName}}',
        message:
          'A prepaid hour bucket for {{clientName}} has reached {{usedPercent}}% of capacity (configured threshold: {{percent}}%). Used: {{used}} of {{capacity}}. Usage period: {{periodStart}} - {{periodEnd}}. [View client]({{link}}).',
      },
      fr: {
        title: 'Seuil du bloc d\u2019heures prépayées atteint : {{clientName}}',
        message:
          'Un bloc d\u2019heures prépayées de {{clientName}} a atteint {{usedPercent}} % de sa capacité (seuil configuré : {{percent}} %). Utilisé : {{used}} sur {{capacity}}. Période d\u2019utilisation : {{periodStart}} - {{periodEnd}}. [Voir le client]({{link}}).',
      },
      es: {
        title: 'Umbral del paquete de horas prepagado alcanzado: {{clientName}}',
        message:
          'Un paquete de horas prepagado de {{clientName}} ha alcanzado el {{usedPercent}}% de su capacidad (umbral configurado: {{percent}}%). Usado: {{used}} de {{capacity}}. Período de uso: {{periodStart}} - {{periodEnd}}. [Ver cliente]({{link}}).',
      },
      de: {
        title: 'Schwellenwert des Prepaid-Stundenpakets erreicht: {{clientName}}',
        message:
          'Ein Prepaid-Stundenpaket von {{clientName}} hat {{usedPercent}}% der Kapazität erreicht (konfigurierter Schwellenwert: {{percent}}%). Verbraucht: {{used}} von {{capacity}}. Nutzungszeitraum: {{periodStart}} - {{periodEnd}}. [Kunde anzeigen]({{link}}).',
      },
      nl: {
        title: 'Drempel prepaid-urenpakket bereikt: {{clientName}}',
        message:
          'Een prepaid-urenpakket van {{clientName}} heeft {{usedPercent}}% van de capaciteit bereikt (geconfigureerde drempel: {{percent}}%). Verbruikt: {{used}} van {{capacity}}. Gebruiksperiode: {{periodStart}} - {{periodEnd}}. [Klant bekijken]({{link}}).',
      },
      it: {
        title: 'Soglia del pacchetto ore prepagato raggiunta: {{clientName}}',
        message:
          'Un pacchetto ore prepagato di {{clientName}} ha raggiunto il {{usedPercent}}% della capacità (soglia configurata: {{percent}}%). Utilizzato: {{used}} di {{capacity}}. Periodo di utilizzo: {{periodStart}} - {{periodEnd}}. [Visualizza cliente]({{link}}).',
      },
      pl: {
        title: 'Osiągnięto próg pakietu godzin przedpłaconych: {{clientName}}',
        message:
          'Pakiet godzin przedpłaconych dla {{clientName}} osiągnął {{usedPercent}}% pojemności (skonfigurowany próg: {{percent}}%). Wykorzystano: {{used}} z {{capacity}}. Okres użytkowania: {{periodStart}} - {{periodEnd}}. [Zobacz klienta]({{link}}).',
      },
      pt: {
        title: 'Limite do pacote de horas pré-pago atingido: {{clientName}}',
        message:
          'Um pacote de horas pré-pago de {{clientName}} atingiu {{usedPercent}}% da capacidade (limite configurado: {{percent}}%). Usado: {{used}} de {{capacity}}. Período de uso: {{periodStart}} - {{periodEnd}}. [Ver cliente]({{link}}).',
      },
    },
  },
];

module.exports = { TEMPLATES };

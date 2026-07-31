/**
 * Source of truth: RMM internal notification templates.
 */
const TEMPLATES = [
  {
    templateName: 'rmm-alert-triggered',
    subtypeName: 'RMM Alert Triggered',
    translations: {
      en: { title: 'RMM Alert ({{severity}}): {{deviceName}}', message: '{{message}}' },
      fr: { title: 'Alerte RMM ({{severity}}) : {{deviceName}}', message: '{{message}}' },
      es: { title: 'Alerta de RMM ({{severity}}): {{deviceName}}', message: '{{message}}' },
      de: { title: 'RMM-Warnung ({{severity}}): {{deviceName}}', message: '{{message}}' },
      nl: { title: 'RMM-melding ({{severity}}): {{deviceName}}', message: '{{message}}' },
      it: { title: 'Avviso RMM ({{severity}}): {{deviceName}}', message: '{{message}}' },
      pl: { title: 'Alert RMM ({{severity}}): {{deviceName}}', message: '{{message}}' },
      pt: { title: 'Alerta de RMM ({{severity}}): {{deviceName}}', message: '{{message}}' },
    },
  },
];

module.exports = { TEMPLATES };

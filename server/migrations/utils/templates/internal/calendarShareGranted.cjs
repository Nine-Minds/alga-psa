/**
 * Source of truth for the "calendar shared with you" internal notification.
 *
 * `accessLevelLabel` arrives already translated, so each sentence stays in one
 * language.
 */

const TEMPLATES = {
  templateName: 'calendar-share-granted',
  subtypeName: 'calendar-share-granted',
  translations: {
    en: {
      title: '{{ownerName}} shared their calendar with you',
      message: 'You can now see {{ownerName}}\'s calendar ({{accessLevelLabel}}) on the Schedule page.',
    },
    fr: {
      title: '{{ownerName}} a partagé son calendrier avec vous',
      message: 'Vous pouvez désormais voir le calendrier de {{ownerName}} ({{accessLevelLabel}}) sur la page Planning.',
    },
    es: {
      title: '{{ownerName}} compartió su calendario con usted',
      message: 'Ahora puede ver el calendario de {{ownerName}} ({{accessLevelLabel}}) en la página Agenda.',
    },
    de: {
      title: '{{ownerName}} hat den Kalender mit Ihnen geteilt',
      message: 'Sie können den Kalender von {{ownerName}} ({{accessLevelLabel}}) jetzt auf der Seite Terminplan sehen.',
    },
    nl: {
      title: '{{ownerName}} heeft een agenda met u gedeeld',
      message: 'U kunt de agenda van {{ownerName}} ({{accessLevelLabel}}) nu bekijken op de pagina Planning.',
    },
    it: {
      title: '{{ownerName}} ha condiviso il calendario con te',
      message: 'Ora puoi vedere il calendario di {{ownerName}} ({{accessLevelLabel}}) nella pagina Pianificazione.',
    },
    pl: {
      title: '{{ownerName}} udostępnił(a) Ci swój kalendarz',
      message: 'Możesz teraz zobaczyć kalendarz użytkownika {{ownerName}} ({{accessLevelLabel}}) na stronie Harmonogram.',
    },
    pt: {
      title: '{{ownerName}} compartilhou a agenda com você',
      message: 'Agora você pode ver a agenda de {{ownerName}} ({{accessLevelLabel}}) na página Agenda.',
    },
  },
};

module.exports = { TEMPLATES };

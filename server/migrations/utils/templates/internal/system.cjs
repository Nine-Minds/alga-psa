/**
 * Source of truth: system and messaging internal notification templates.
 */
const TEMPLATES = [
  {
    templateName: 'system-announcement',
    subtypeName: 'system-announcement',
    translations: {
      en: { title: 'System Announcement', message: '{{announcementTitle}}' },
      fr: { title: 'Annonce système', message: '{{announcementTitle}}' },
      es: { title: 'Anuncio del sistema', message: '{{announcementTitle}}' },
      de: { title: 'Systemankündigung', message: '{{announcementTitle}}' },
      nl: { title: 'Systeemmededeling', message: '{{announcementTitle}}' },
      it: { title: 'Annuncio di sistema', message: '{{announcementTitle}}' },
      pl: { title: 'Ogłoszenie systemowe', message: '{{announcementTitle}}' },
    },
  },
  {
    templateName: 'user-mentioned',
    subtypeName: 'user-mentioned',
    translations: {
      en: { title: 'You were mentioned', message: '{{authorName}} mentioned you in {{entityType}} {{entityName}}' },
      fr: { title: 'Vous avez été mentionné', message: '{{authorName}} vous a mentionné dans {{entityType}} {{entityName}}' },
      es: { title: 'Ha sido mencionado', message: '{{authorName}} le mencionó en {{entityType}} {{entityName}}' },
      de: { title: 'Sie wurden erwähnt', message: '{{authorName}} hat Sie in {{entityType}} {{entityName}} erwähnt' },
      nl: { title: 'U bent genoemd', message: '{{authorName}} heeft u genoemd in {{entityType}} {{entityName}}' },
      it: { title: 'È stato menzionato', message: "{{authorName}} l'ha menzionato in {{entityType}} {{entityName}}" },
      pl: { title: 'Wspomniano o Tobie', message: '{{authorName}} wspomniał(a) o Tobie w {{entityType}} {{entityName}}' },
    },
  },
  {
    templateName: 'user-mentioned-in-comment',
    subtypeName: 'user-mentioned',
    translations: {
      en: { title: 'You were mentioned in a comment', message: '{{commentAuthor}} mentioned you in ticket #{{ticketNumber}}: {{commentPreview}}' },
      fr: { title: 'Vous avez été mentionné dans un commentaire', message: '{{commentAuthor}} vous a mentionné dans le ticket #{{ticketNumber}}: {{commentPreview}}' },
      es: { title: 'Te mencionaron en un comentario', message: '{{commentAuthor}} te mencionó en el ticket #{{ticketNumber}}: {{commentPreview}}' },
      de: { title: 'Sie wurden in einem Kommentar erwähnt', message: '{{commentAuthor}} hat Sie im Ticket #{{ticketNumber}} erwähnt: {{commentPreview}}' },
      nl: { title: 'U bent genoemd in een opmerking', message: '{{commentAuthor}} heeft u genoemd in ticket #{{ticketNumber}}: {{commentPreview}}' },
      it: { title: 'Sei stato menzionato in un commento', message: '{{commentAuthor}} ti ha menzionato nel ticket #{{ticketNumber}}: {{commentPreview}}' },
      pl: { title: 'Wspomniano o Tobie w komentarzu', message: '{{commentAuthor}} wspomniał(a) o Tobie w zgłoszeniu #{{ticketNumber}}: {{commentPreview}}' },
    },
  },
  {
    templateName: 'user-mentioned-in-document',
    subtypeName: 'user-mentioned',
    translations: {
      en: { title: 'You were mentioned in a document', message: '{{authorName}} mentioned you in document "{{documentName}}"' },
      fr: { title: 'Vous avez été mentionné dans un document', message: '{{authorName}} vous a mentionné dans le document "{{documentName}}"' },
      es: { title: 'Te mencionaron en un documento', message: '{{authorName}} te mencionó en el documento "{{documentName}}"' },
      de: { title: 'Sie wurden in einem Dokument erwähnt', message: '{{authorName}} hat Sie im Dokument "{{documentName}}" erwähnt' },
      nl: { title: 'Je bent vermeld in een document', message: '{{authorName}} heeft je vermeld in document "{{documentName}}"' },
      it: { title: 'Sei stato menzionato in un documento', message: '{{authorName}} ti ha menzionato nel documento "{{documentName}}"' },
      pl: { title: 'Wspomniano o Tobie w dokumencie', message: '{{authorName}} wspomniał(a) o Tobie w dokumencie "{{documentName}}"' },
    },
  },
  {
    templateName: 'message-sent',
    subtypeName: 'message-sent',
    translations: {
      en: { title: 'New Message', message: '{{senderName}}: {{messagePreview}}' },
      fr: { title: 'Nouveau message', message: '{{senderName}}: {{messagePreview}}' },
      es: { title: 'Nuevo mensaje', message: '{{senderName}}: {{messagePreview}}' },
      de: { title: 'Neue Nachricht', message: '{{senderName}}: {{messagePreview}}' },
      nl: { title: 'Nieuw bericht', message: '{{senderName}}: {{messagePreview}}' },
      it: { title: 'Nuovo messaggio', message: '{{senderName}}: {{messagePreview}}' },
      pl: { title: 'Nowa wiadomość', message: '{{senderName}}: {{messagePreview}}' },
    },
  },
];

module.exports = { TEMPLATES };

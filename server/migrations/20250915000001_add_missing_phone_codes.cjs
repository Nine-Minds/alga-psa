/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Add missing phone codes for countries that were not included in the previous migration
  const missingPhoneCodeUpdates = [
    // Missing countries from the original list
    ['AI', '+1264'], // Anguilla
    ['AX', '+358'], // Åland Islands (Finland)
    ['BL', '+590'], // Saint Barthélemy
    ['BV', '+47'], // Bouvet Island (Norway)
    ['CC', '+61'], // Cocos (Keeling) Islands (Australia)
    ['CX', '+61'], // Christmas Island (Australia)
    ['EH', '+212'], // Western Sahara (Morocco)
    ['FO', '+298'], // Faroe Islands
    ['GG', '+44'], // Guernsey (UK)
    ['GI', '+350'], // Gibraltar
    ['GL', '+299'], // Greenland
    ['GP', '+590'], // Guadeloupe (France)
    ['GS', '+500'], // South Georgia
    ['HM', '+672'], // Heard & McDonald Islands
    ['IM', '+44'], // Isle of Man
    ['IO', '+246'], // British Indian Ocean Territory
    ['JE', '+44'], // Jersey
    ['MF', '+590'], // Saint Martin (French part)
    ['MQ', '+596'], // Martinique
    ['MS', '+1664'], // Montserrat
    ['PM', '+508'], // Saint Pierre and Miquelon
    ['PN', '+64'], // Pitcairn
    ['SJ', '+47'], // Svalbard & Jan Mayen
    ['TF', '+262'], // French Southern Territories
    ['UM', '+1'], // United States Minor Outlying Islands
    ['VG', '+1284'], // British Virgin Islands
  ];

  // Update countries with missing phone codes
  for (const [countryCode, phoneCode] of missingPhoneCodeUpdates) {
    await knex('countries')
      .where('code', countryCode)
      .update({ phone_code: phoneCode });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Remove the phone codes we just added
  const countryCodesAdded = [
    'AI', 'AX', 'BL', 'BV', 'CC', 'CX', 'EH', 'FO', 'GG', 'GI', 'GL', 'GP', 'GS',
    'HM', 'IM', 'IO', 'JE', 'MF', 'MQ', 'MS', 'PM', 'PN', 'SJ', 'TF', 'UM', 'VG'
  ];

  for (const countryCode of countryCodesAdded) {
    await knex('countries')
      .where('code', countryCode)
      .update({ phone_code: null });
  }
};
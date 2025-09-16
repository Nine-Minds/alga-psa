/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Add missing phone codes for countries that don't have them yet
  const missingPhoneCodeUpdates = [
    // Missing Caribbean and North American territories
    ['AI', '+1264'], // Anguilla
    ['BL', '+590'], // Saint Barthélemy
    ['VG', '+1284'], // British Virgin Islands
    ['MS', '+1664'], // Montserrat
    ['GP', '+590'], // Guadeloupe
    ['MQ', '+596'], // Martinique
    ['PM', '+508'], // Saint Pierre and Miquelon
    ['MF', '+590'], // Saint Martin (French part)

    // Missing European territories
    ['AX', '+358'], // Åland Islands (Finland)
    ['FO', '+298'], // Faroe Islands
    ['GG', '+44'], // Guernsey
    ['IM', '+44'], // Isle of Man
    ['JE', '+44'], // Jersey
    ['GI', '+350'], // Gibraltar
    ['GL', '+299'], // Greenland
    ['SJ', '+47'], // Svalbard and Jan Mayen

    // Missing African territories and countries
    ['EH', '+212'], // Western Sahara (Morocco)
    ['MR', '+222'], // Mauritania
    ['IO', '+246'], // British Indian Ocean Territory
    ['TF', '+262'], // French Southern Territories

    // Missing Pacific territories
    ['CC', '+61'], // Cocos (Keeling) Islands
    ['CX', '+61'], // Christmas Island
    ['NF', '+672'], // Norfolk Island
    ['PN', '+64'], // Pitcairn
    ['HM', '+672'], // Heard Island and McDonald Islands
    ['UM', '+1'], // United States Minor Outlying Islands
    ['BV', '+47'], // Bouvet Island (Norway)

    // Missing South Atlantic
    ['GS', '+500'], // South Georgia and the South Sandwich Islands

    // East Timor
    ['TL', '+670'], // Timor-Leste
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
  // Remove the phone codes we added
  const countriesToClear = [
    'AI', 'BL', 'VG', 'MS', 'GP', 'MQ', 'PM', 'MF',
    'AX', 'FO', 'GG', 'IM', 'JE', 'GI', 'GL', 'SJ',
    'EH', 'MR', 'IO', 'TF',
    'CC', 'CX', 'NF', 'PN', 'HM', 'UM', 'BV',
    'GS', 'TL'
  ];

  for (const countryCode of countriesToClear) {
    await knex('countries')
      .where('code', countryCode)
      .update({ phone_code: null });
  }
};
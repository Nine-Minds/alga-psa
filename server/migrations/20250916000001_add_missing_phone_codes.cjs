/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Add missing phone codes for countries and territories with distinct dialing codes
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

    // Missing European territories with distinct codes
    ['AX', '+358'], // Åland Islands (uses Finland +358 but distinct routing)
    ['FO', '+298'], // Faroe Islands
    ['GG', '+44'], // Guernsey (uses UK +44 but distinct routing)
    ['IM', '+44'], // Isle of Man (uses UK +44 but distinct routing)
    ['JE', '+44'], // Jersey (uses UK +44 but distinct routing)
    ['GI', '+350'], // Gibraltar
    ['GL', '+299'], // Greenland

    // Missing African countries and territories
    ['EH', '+212'], // Western Sahara (uses Morocco routing)
    ['MR', '+222'], // Mauritania (sovereign country that was missing)

    // Missing Pacific territories with distinct codes
    ['CC', '+61'], // Cocos (Keeling) Islands (uses Australia +61 but distinct routing)
    ['CX', '+61'], // Christmas Island (uses Australia +61 but distinct routing)
    ['NF', '+672'], // Norfolk Island
    ['PN', '+64'], // Pitcairn Islands (uses New Zealand routing)
    ['UM', '+1'], // United States Minor Outlying Islands

    // Missing South Atlantic with distinct codes
    ['GS', '+500'], // South Georgia and the South Sandwich Islands

    // Missing sovereign countries
    ['TL', '+670'], // Timor-Leste
  ];

  // Update countries with missing phone codes
  // Note: countries is a reference table (shared across all tenants), so no tenant filter needed
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
    'AX', 'FO', 'GG', 'IM', 'JE', 'GI', 'GL',
    'EH', 'MR',
    'CC', 'CX', 'NF', 'PN', 'UM',
    'GS', 'TL'
  ];

  // Note: countries is a reference table (shared across all tenants), so no tenant filter needed
  for (const countryCode of countriesToClear) {
    await knex('countries')
      .where('code', countryCode)
      .update({ phone_code: null });
  }
};
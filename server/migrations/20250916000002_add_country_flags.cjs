/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Add flag_emoji column to countries table
  await knex.schema.alterTable('countries', function(table) {
    table.string('flag_emoji', 10);
  });

  // Add flag emojis for all countries
  const flagUpdates = [
    // A
    ['AD', '🇦🇩'], // Andorra
    ['AE', '🇦🇪'], // United Arab Emirates
    ['AF', '🇦🇫'], // Afghanistan
    ['AG', '🇦🇬'], // Antigua and Barbuda
    ['AI', '🇦🇮'], // Anguilla
    ['AL', '🇦🇱'], // Albania
    ['AM', '🇦🇲'], // Armenia
    ['AO', '🇦🇴'], // Angola
    ['AQ', '🇦🇶'], // Antarctica
    ['AR', '🇦🇷'], // Argentina
    ['AS', '🇦🇸'], // American Samoa
    ['AT', '🇦🇹'], // Austria
    ['AU', '🇦🇺'], // Australia
    ['AW', '🇦🇼'], // Aruba
    ['AX', '🇦🇽'], // Åland Islands
    ['AZ', '🇦🇿'], // Azerbaijan

    // B
    ['BA', '🇧🇦'], // Bosnia and Herzegovina
    ['BB', '🇧🇧'], // Barbados
    ['BD', '🇧🇩'], // Bangladesh
    ['BE', '🇧🇪'], // Belgium
    ['BF', '🇧🇫'], // Burkina Faso
    ['BG', '🇧🇬'], // Bulgaria
    ['BH', '🇧🇭'], // Bahrain
    ['BI', '🇧🇮'], // Burundi
    ['BJ', '🇧🇯'], // Benin
    ['BL', '🇧🇱'], // Saint Barthélemy
    ['BM', '🇧🇲'], // Bermuda
    ['BN', '🇧🇳'], // Brunei Darussalam
    ['BO', '🇧🇴'], // Bolivia
    ['BQ', '🇧🇶'], // Bonaire, Sint Eustatius and Saba
    ['BR', '🇧🇷'], // Brazil
    ['BS', '🇧🇸'], // Bahamas
    ['BT', '🇧🇹'], // Bhutan
    ['BV', '🇧🇻'], // Bouvet Island
    ['BW', '🇧🇼'], // Botswana
    ['BY', '🇧🇾'], // Belarus
    ['BZ', '🇧🇿'], // Belize

    // C
    ['CA', '🇨🇦'], // Canada
    ['CC', '🇨🇨'], // Cocos (Keeling) Islands
    ['CD', '🇨🇩'], // Congo, Democratic Republic of the
    ['CF', '🇨🇫'], // Central African Republic
    ['CG', '🇨🇬'], // Congo
    ['CH', '🇨🇭'], // Switzerland
    ['CI', '🇨🇮'], // Côte d'Ivoire
    ['CK', '🇨🇰'], // Cook Islands
    ['CL', '🇨🇱'], // Chile
    ['CM', '🇨🇲'], // Cameroon
    ['CN', '🇨🇳'], // China
    ['CO', '🇨🇴'], // Colombia
    ['CR', '🇨🇷'], // Costa Rica
    ['CU', '🇨🇺'], // Cuba
    ['CV', '🇨🇻'], // Cabo Verde
    ['CW', '🇨🇼'], // Curaçao
    ['CX', '🇨🇽'], // Christmas Island
    ['CY', '🇨🇾'], // Cyprus
    ['CZ', '🇨🇿'], // Czech Republic

    // D
    ['DE', '🇩🇪'], // Germany
    ['DJ', '🇩🇯'], // Djibouti
    ['DK', '🇩🇰'], // Denmark
    ['DM', '🇩🇲'], // Dominica
    ['DO', '🇩🇴'], // Dominican Republic
    ['DZ', '🇩🇿'], // Algeria

    // E
    ['EC', '🇪🇨'], // Ecuador
    ['EE', '🇪🇪'], // Estonia
    ['EG', '🇪🇬'], // Egypt
    ['EH', '🇪🇭'], // Western Sahara
    ['ER', '🇪🇷'], // Eritrea
    ['ES', '🇪🇸'], // Spain
    ['ET', '🇪🇹'], // Ethiopia

    // F
    ['FI', '🇫🇮'], // Finland
    ['FJ', '🇫🇯'], // Fiji
    ['FK', '🇫🇰'], // Falkland Islands (Malvinas)
    ['FM', '🇫🇲'], // Micronesia, Federated States of
    ['FO', '🇫🇴'], // Faroe Islands
    ['FR', '🇫🇷'], // France

    // G
    ['GA', '🇬🇦'], // Gabon
    ['GB', '🇬🇧'], // United Kingdom
    ['GD', '🇬🇩'], // Grenada
    ['GE', '🇬🇪'], // Georgia
    ['GF', '🇬🇫'], // French Guiana
    ['GG', '🇬🇬'], // Guernsey
    ['GH', '🇬🇭'], // Ghana
    ['GI', '🇬🇮'], // Gibraltar
    ['GL', '🇬🇱'], // Greenland
    ['GM', '🇬🇲'], // Gambia
    ['GN', '🇬🇳'], // Guinea
    ['GP', '🇬🇵'], // Guadeloupe
    ['GQ', '🇬🇶'], // Equatorial Guinea
    ['GR', '🇬🇷'], // Greece
    ['GS', '🇬🇸'], // South Georgia and the South Sandwich Islands
    ['GT', '🇬🇹'], // Guatemala
    ['GU', '🇬🇺'], // Guam
    ['GW', '🇬🇼'], // Guinea-Bissau
    ['GY', '🇬🇾'], // Guyana

    // H
    ['HK', '🇭🇰'], // Hong Kong
    ['HM', '🇭🇲'], // Heard Island and McDonald Islands
    ['HN', '🇭🇳'], // Honduras
    ['HR', '🇭🇷'], // Croatia
    ['HT', '🇭🇹'], // Haiti
    ['HU', '🇭🇺'], // Hungary

    // I
    ['ID', '🇮🇩'], // Indonesia
    ['IE', '🇮🇪'], // Ireland
    ['IL', '🇮🇱'], // Israel
    ['IM', '🇮🇲'], // Isle of Man
    ['IN', '🇮🇳'], // India
    ['IO', '🇮🇴'], // British Indian Ocean Territory
    ['IQ', '🇮🇶'], // Iraq
    ['IR', '🇮🇷'], // Iran
    ['IS', '🇮🇸'], // Iceland
    ['IT', '🇮🇹'], // Italy

    // J
    ['JE', '🇯🇪'], // Jersey
    ['JM', '🇯🇲'], // Jamaica
    ['JO', '🇯🇴'], // Jordan
    ['JP', '🇯🇵'], // Japan

    // K
    ['KE', '🇰🇪'], // Kenya
    ['KG', '🇰🇬'], // Kyrgyzstan
    ['KH', '🇰🇭'], // Cambodia
    ['KI', '🇰🇮'], // Kiribati
    ['KM', '🇰🇲'], // Comoros
    ['KN', '🇰🇳'], // Saint Kitts and Nevis
    ['KP', '🇰🇵'], // Korea, Democratic People's Republic of
    ['KR', '🇰🇷'], // Korea, Republic of
    ['KW', '🇰🇼'], // Kuwait
    ['KY', '🇰🇾'], // Cayman Islands
    ['KZ', '🇰🇿'], // Kazakhstan

    // L
    ['LA', '🇱🇦'], // Lao People's Democratic Republic
    ['LB', '🇱🇧'], // Lebanon
    ['LC', '🇱🇨'], // Saint Lucia
    ['LI', '🇱🇮'], // Liechtenstein
    ['LK', '🇱🇰'], // Sri Lanka
    ['LR', '🇱🇷'], // Liberia
    ['LS', '🇱🇸'], // Lesotho
    ['LT', '🇱🇹'], // Lithuania
    ['LU', '🇱🇺'], // Luxembourg
    ['LV', '🇱🇻'], // Latvia
    ['LY', '🇱🇾'], // Libya

    // M
    ['MA', '🇲🇦'], // Morocco
    ['MC', '🇲🇨'], // Monaco
    ['MD', '🇲🇩'], // Moldova, Republic of
    ['ME', '🇲🇪'], // Montenegro
    ['MF', '🇲🇫'], // Saint Martin (French part)
    ['MG', '🇲🇬'], // Madagascar
    ['MH', '🇲🇭'], // Marshall Islands
    ['MK', '🇲🇰'], // North Macedonia
    ['ML', '🇲🇱'], // Mali
    ['MM', '🇲🇲'], // Myanmar
    ['MN', '🇲🇳'], // Mongolia
    ['MO', '🇲🇴'], // Macao
    ['MP', '🇲🇵'], // Northern Mariana Islands
    ['MQ', '🇲🇶'], // Martinique
    ['MR', '🇲🇷'], // Mauritania
    ['MS', '🇲🇸'], // Montserrat
    ['MT', '🇲🇹'], // Malta
    ['MU', '🇲🇺'], // Mauritius
    ['MV', '🇲🇻'], // Maldives
    ['MW', '🇲🇼'], // Malawi
    ['MX', '🇲🇽'], // Mexico
    ['MY', '🇲🇾'], // Malaysia
    ['MZ', '🇲🇿'], // Mozambique

    // N
    ['NA', '🇳🇦'], // Namibia
    ['NC', '🇳🇨'], // New Caledonia
    ['NE', '🇳🇪'], // Niger
    ['NF', '🇳🇫'], // Norfolk Island
    ['NG', '🇳🇬'], // Nigeria
    ['NI', '🇳🇮'], // Nicaragua
    ['NL', '🇳🇱'], // Netherlands
    ['NO', '🇳🇴'], // Norway
    ['NP', '🇳🇵'], // Nepal
    ['NR', '🇳🇷'], // Nauru
    ['NU', '🇳🇺'], // Niue
    ['NZ', '🇳🇿'], // New Zealand

    // O
    ['OM', '🇴🇲'], // Oman

    // P
    ['PA', '🇵🇦'], // Panama
    ['PE', '🇵🇪'], // Peru
    ['PF', '🇵🇫'], // French Polynesia
    ['PG', '🇵🇬'], // Papua New Guinea
    ['PH', '🇵🇭'], // Philippines
    ['PK', '🇵🇰'], // Pakistan
    ['PL', '🇵🇱'], // Poland
    ['PM', '🇵🇲'], // Saint Pierre and Miquelon
    ['PN', '🇵🇳'], // Pitcairn
    ['PR', '🇵🇷'], // Puerto Rico
    ['PS', '🇵🇸'], // Palestine, State of
    ['PT', '🇵🇹'], // Portugal
    ['PW', '🇵🇼'], // Palau
    ['PY', '🇵🇾'], // Paraguay

    // Q
    ['QA', '🇶🇦'], // Qatar

    // R
    ['RE', '🇷🇪'], // Réunion
    ['RO', '🇷🇴'], // Romania
    ['RS', '🇷🇸'], // Serbia
    ['RU', '🇷🇺'], // Russian Federation
    ['RW', '🇷🇼'], // Rwanda

    // S
    ['SA', '🇸🇦'], // Saudi Arabia
    ['SB', '🇸🇧'], // Solomon Islands
    ['SC', '🇸🇨'], // Seychelles
    ['SD', '🇸🇩'], // Sudan
    ['SE', '🇸🇪'], // Sweden
    ['SG', '🇸🇬'], // Singapore
    ['SH', '🇸🇭'], // Saint Helena, Ascension and Tristan da Cunha
    ['SI', '🇸🇮'], // Slovenia
    ['SJ', '🇸🇯'], // Svalbard and Jan Mayen
    ['SK', '🇸🇰'], // Slovakia
    ['SL', '🇸🇱'], // Sierra Leone
    ['SM', '🇸🇲'], // San Marino
    ['SN', '🇸🇳'], // Senegal
    ['SO', '🇸🇴'], // Somalia
    ['SR', '🇸🇷'], // Suriname
    ['SS', '🇸🇸'], // South Sudan
    ['ST', '🇸🇹'], // Sao Tome and Principe
    ['SV', '🇸🇻'], // El Salvador
    ['SX', '🇸🇽'], // Sint Maarten (Dutch part)
    ['SY', '🇸🇾'], // Syrian Arab Republic
    ['SZ', '🇸🇿'], // Eswatini

    // T
    ['TC', '🇹🇨'], // Turks and Caicos Islands
    ['TD', '🇹🇩'], // Chad
    ['TF', '🇹🇫'], // French Southern Territories
    ['TG', '🇹🇬'], // Togo
    ['TH', '🇹🇭'], // Thailand
    ['TJ', '🇹🇯'], // Tajikistan
    ['TK', '🇹🇰'], // Tokelau
    ['TL', '🇹🇱'], // Timor-Leste
    ['TM', '🇹🇲'], // Turkmenistan
    ['TN', '🇹🇳'], // Tunisia
    ['TO', '🇹🇴'], // Tonga
    ['TR', '🇹🇷'], // Turkey
    ['TT', '🇹🇹'], // Trinidad and Tobago
    ['TV', '🇹🇻'], // Tuvalu
    ['TW', '🇹🇼'], // Taiwan, Province of China
    ['TZ', '🇹🇿'], // Tanzania, United Republic of

    // U
    ['UA', '🇺🇦'], // Ukraine
    ['UG', '🇺🇬'], // Uganda
    ['UM', '🇺🇲'], // United States Minor Outlying Islands
    ['US', '🇺🇸'], // United States
    ['UY', '🇺🇾'], // Uruguay
    ['UZ', '🇺🇿'], // Uzbekistan

    // V
    ['VA', '🇻🇦'], // Holy See (Vatican City State)
    ['VC', '🇻🇨'], // Saint Vincent and the Grenadines
    ['VE', '🇻🇪'], // Venezuela
    ['VG', '🇻🇬'], // Virgin Islands, British
    ['VI', '🇻🇮'], // Virgin Islands, U.S.
    ['VN', '🇻🇳'], // Viet Nam
    ['VU', '🇻🇺'], // Vanuatu

    // W
    ['WF', '🇼🇫'], // Wallis and Futuna
    ['WS', '🇼🇸'], // Samoa

    // Y
    ['YE', '🇾🇪'], // Yemen
    ['YT', '🇾🇹'], // Mayotte

    // Z
    ['ZA', '🇿🇦'], // South Africa
    ['ZM', '🇿🇲'], // Zambia
    ['ZW', '🇿🇼'], // Zimbabwe
  ];

  // Update countries with flag emojis
  for (const [countryCode, flagEmoji] of flagUpdates) {
    await knex('countries')
      .where('code', countryCode)
      .update({ flag_emoji: flagEmoji });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Remove flag_emoji column
  await knex.schema.alterTable('countries', function(table) {
    table.dropColumn('flag_emoji');
  });
};
import { logger } from '@alga-psa/core';
import User from '@alga-psa/db/models/user';
import { generateSecurePassword, hashPassword, verifyPassword } from 'server/src/utils/encryption/encryption';
import { initializeDevelopmentCredential } from './developmentCredential';

export async function setupDevelopmentEnvironment() {
  if (process.env.NODE_ENV !== 'development') return;

  const glinda = await User.findUserByEmail('glinda@emeraldcity.oz');
  await initializeDevelopmentCredential({
    user: glinda,
    configuredPassword: process.env.DEV_LOGIN_PASSWORD,
    recoverExistingCredential: process.env.DEV_LOGIN_PASSWORD_RECOVERY === 'true',
    generatePassword: generateSecurePassword,
    hashPassword,
    verifyPassword,
    updatePasswordIfUnchanged: User.updatePasswordIfUnchanged,
    readCurrentHash: User.getPasswordHash,
    log: (message) => logger.info(message),
  });

  try {
    logger.info(`
:::::::::  :::::::::: :::     ::: :::::::::: :::        ::::::::  :::::::::  ::::    ::::  :::::::::: ::::    ::: :::::::::::      ::::    ::::   ::::::::  :::::::::  ::::::::::
:+:    :+: :+:        :+:     :+: :+:        :+:       :+:    :+: :+:    :+: +:+:+: :+:+:+ :+:        :+:+:   :+:     :+:          +:+:+: :+:+:+ :+:    :+: :+:    :+: :+:
+:+    +:+ +:+        +:+     +:+ +:+        +:+       +:+    +:+ +:+    +:+ +:+ +:+:+ +:+ +:+        :+:+:+  +:+     +:+          +:+ +:+:+ +:+ +:+    +:+ +:+    +:+ :+:
+#+    +:+ +#++:++#   +#+     +:+ +#++:++#   +#+       +#+    +:+ +#++:++#+  +#+  +:+  +#+ +#++:++#   +#+ +:+ +#+     +#+          +#+  +:+  +#+ +#+    +:+ +#+    +:+ +#++:++#
+#+    +#+ +#+         +#+   +#+  +#+        +#+       +#+    +#+ +#+        +#+       +#+ +#+        +#+  +#+#+#     +#+          +#+       +#+ +#+    +#+ +#+    +#+ +#+
#+#    #+# #+#          #+#+#+#   #+#        #+#       #+#    #+# #+#        #+#       #+# #+#        #+#   #+#+#     #+#          #+#       #+# #+#    #+# #+#    #+# #+#
#########  ##########     ###     ########## ########## ########  ###        ###       ### ########## ###    ####     ###          ###       ###  ########  #########  ##########
    `);
  } catch (error) {
    logger.error('Error displaying development banner:', error);
  }
}

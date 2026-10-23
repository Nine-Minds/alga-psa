import { logger } from '@alga-psa/core';
import User from '@alga-psa/db/models/user';
import { generateSecurePassword, hashPassword, verifyPassword } from 'server/src/utils/encryption/encryption';
import { initializeDevelopmentCredential } from './developmentCredential';
import { provisionDevelopmentLogin } from './devLoginProvisioning';

export async function setupDevelopmentEnvironment() {
  if (process.env.NODE_ENV !== 'development') return;
  if (process.env.DEV_USER_PASSWORD_PROVISION === 'true' && !process.env.DEV_USER_PASSWORD) {
    throw new Error('DEV_USER_PASSWORD is required when DEV_USER_PASSWORD_PROVISION=true.');
  }

  let credentials: { email: string; password: string } | null = null;

  // Shared worktree environments can opt into the deterministic credential.
  // Keep the default startup path conservative: an established credential is
  // retained unless DEV_LOGIN_PASSWORD recovery was explicitly requested.
  if (process.env.DEV_LOGIN_SHARED_PASSWORD === 'true') {
    if (
      process.env.DEV_LOGIN_PASSWORD ||
      process.env.DEV_USER_PASSWORD_PROVISION === 'true'
    ) {
      throw new Error(
        'DEV_LOGIN_SHARED_PASSWORD cannot be combined with explicit development password provisioning',
      );
    }
    credentials = await provisionDevelopmentLogin();
    if (!credentials) {
      logger.info('Glinda not found. Skipping password update.');
    }
  } else {
    const glinda = await User.findUserByEmail('glinda@emeraldcity.oz');
    await initializeDevelopmentCredential({
      user: glinda,
      configuredPassword: process.env.DEV_LOGIN_PASSWORD || process.env.DEV_USER_PASSWORD,
      recoverExistingCredential:
        process.env.DEV_LOGIN_PASSWORD_RECOVERY === 'true' ||
        process.env.DEV_USER_PASSWORD_PROVISION === 'true',
      generatePassword: generateSecurePassword,
      hashPassword,
      verifyPassword,
      updatePasswordIfUnchanged: User.updatePasswordIfUnchanged,
      readCurrentHash: User.getPasswordHash,
      log: (message) => logger.info(message),
    });
  }

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

  if (credentials) {
    logger.info('*************************************************************');
    logger.info(`********                                             ********`);
    logger.info(`******** User Email is -> [ ${credentials.email} ]  ********`);
    logger.info(`********                                             ********`);
    logger.info(`********       Password is -> [ ${credentials.password} ]   ********`);
    logger.info(`********                                             ********`);
    logger.info('*************************************************************');
  }
}

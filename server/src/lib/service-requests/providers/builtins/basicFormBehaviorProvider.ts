import type { ServiceRequestFormBehaviorProvider } from '../contracts';

export const basicFormBehaviorProvider: ServiceRequestFormBehaviorProvider = {
  key: 'basic',
  displayName: 'Basic',
  validateConfig: () => ({ isValid: true }),
  async resolveInitialValues() {
    return {};
  },
};

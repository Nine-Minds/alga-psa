import baseConfig from './vitest.config';

// Focused seam/render tests do not create Temporal workflows and must remain
// runnable on developer machines and CI jobs without a Docker socket.
export default {
  ...baseConfig,
  test: {
    ...baseConfig.test,
    setupFiles: [],
  },
};

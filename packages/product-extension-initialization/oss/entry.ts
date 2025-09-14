// OSS stub implementation for Extension initialization
export const initializeExtensions = async () => {
  // No-op for OSS version - extensions are not available
  if (process.env.NODE_ENV !== 'production') {
    console.log('Extension initialization skipped - Enterprise Edition required');
  }
  return;
};

export default {
  initializeExtensions,
};


// OSS stub implementation for EE Auth features

// Stub for policy parsing
export const parsePolicy = async (policyString) => {
  throw new Error('Policy parsing is an Enterprise Edition feature');
};

// Stub for PolicyManagement component
export const PolicyManagement = async () => {
  // Return a React component that shows EE upgrade message
  const React = await import('react');
  return React.default.createElement('div', {
    className: 'flex items-center justify-center h-64'
  }, React.default.createElement('div', {
    className: 'text-center'
  }, [
    React.default.createElement('h2', {
      key: 'title',
      className: 'text-xl font-semibold mb-2'
    }, 'Enterprise Feature'),
    React.default.createElement('p', {
      key: 'desc',
      className: 'text-gray-600'
    }, 'Policy Management requires Enterprise Edition. Please upgrade to access this feature.')
  ]));
};

// Default export
export default {
  parsePolicy,
  PolicyManagement,
};

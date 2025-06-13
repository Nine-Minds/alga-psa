const fs = require('fs');
const path = require('path');

// Simple build script to copy component files to dist
const componentsDir = path.join(__dirname, 'src/components');
const pagesDir = path.join(__dirname, 'src/pages');
const distComponentsDir = path.join(__dirname, 'dist/components');
const distPagesDir = path.join(__dirname, 'dist/pages');

// Create dist directories
fs.mkdirSync(distComponentsDir, { recursive: true });
fs.mkdirSync(distPagesDir, { recursive: true });

// For now, let's create a simple NavItem component that doesn't require bundling
const navItemContent = `
// NavItem component for SoftwareOne extension
(function(exports) {
  const React = window.React;
  
  function NavItem({ id, label, icon, path, priority, permissions }) {
    return React.createElement('a', {
      href: path,
      className: 'flex items-center gap-3 px-3 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors',
      'data-automation-id': id
    }, [
      // Icon placeholder
      React.createElement('span', { 
        key: 'icon',
        className: 'w-5 h-5 text-gray-500 dark:text-gray-400' 
      }, '☁️'),
      // Label
      React.createElement('span', { 
        key: 'label',
        className: 'text-sm font-medium' 
      }, label)
    ]);
  }
  
  exports.default = NavItem;
})(exports);
`;

fs.writeFileSync(path.join(distComponentsDir, 'NavItem.js'), navItemContent);

// Create wrapper components
const settingsPageWrapperContent = `
(function(exports) {
  const React = window.React;
  
  function SettingsPageWrapper(props) {
    return React.createElement('div', {
      className: 'p-6'
    }, [
      React.createElement('h1', { 
        key: 'title',
        className: 'text-2xl font-bold mb-4' 
      }, 'SoftwareOne Settings'),
      React.createElement('p', { key: 'desc' }, 'Configure your SoftwareOne integration here.')
    ]);
  }
  
  exports.default = SettingsPageWrapper;
})(exports);
`;

fs.writeFileSync(path.join(distComponentsDir, 'SettingsPageWrapper.js'), settingsPageWrapperContent);

// Create AgreementsListWrapper
const agreementsListWrapperContent = `
(function(exports) {
  const React = window.React;
  
  function AgreementsListWrapper(props) {
    return React.createElement('div', {
      className: 'p-6'
    }, [
      React.createElement('h1', { 
        key: 'title',
        className: 'text-2xl font-bold mb-4' 
      }, 'SoftwareOne Agreements'),
      React.createElement('p', { key: 'desc' }, 'Your SoftwareOne agreements will appear here.')
    ]);
  }
  
  exports.default = AgreementsListWrapper;
})(exports);
`;

fs.writeFileSync(path.join(distComponentsDir, 'AgreementsListWrapper.js'), agreementsListWrapperContent);

// Create placeholder pages
const placeholderPage = `
(function(exports) {
  const React = window.React;
  
  function PlaceholderPage(props) {
    return React.createElement('div', {
      className: 'p-6'
    }, 'This page is coming soon.');
  }
  
  exports.default = PlaceholderPage;
})(exports);
`;

fs.writeFileSync(path.join(distPagesDir, 'AgreementDetail.js'), placeholderPage);
fs.writeFileSync(path.join(distPagesDir, 'StatementsList.js'), placeholderPage);
fs.writeFileSync(path.join(distPagesDir, 'StatementDetail.js'), placeholderPage);

console.log('Component files built successfully!');
// Debug script to test click execution issue
console.log('=== CLICK EXECUTION DEBUG ===');

try {
  // First, check if the element exists in UI state
  console.log('1. Checking UI state for menu-clients...');
  const uiState = await helper.query();
  console.log('UI state exists:', !!uiState);
  console.log('Components count:', uiState?.components?.length || 0);
  
  // Find the specific component
  function findComponent(components, id) {
    for (const component of components) {
      if (component.id === id) {
        return component;
      }
      if (component.children) {
        const found = findComponent(component.children, id);
        if (found) return found;
      }
    }
    return null;
  }
  
  const menuClientsComponent = findComponent(uiState?.components || [], 'menu-clients');
  console.log('2. Found menu-clients component:', !!menuClientsComponent);
  console.log('Component actions:', menuClientsComponent?.actions);
  
  // Test the unified helper execute method step by step
  console.log('3. Testing unified helper execute...');
  const executeResult = await helper.execute('menu-clients', 'click');
  console.log('Execute result:', executeResult);
  
  // Test legacy helper click method for comparison
  console.log('4. Testing legacy helper click...');
  const legacyResult = await helper.click('menu-clients');
  console.log('Legacy click result:', legacyResult);
  
  // Check current page URL before and after
  console.log('5. Current page URL:', window.location.href);
  
} catch (error) {
  console.error('Debug script error:', error);
}

'DEBUG_COMPLETE';
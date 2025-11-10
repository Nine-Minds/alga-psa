import { bootstrapIframe } from '@alga-psa/client-sdk';

const output = document.getElementById('output');

function renderSecret(secretName, secretValue) {
  const div = document.createElement('div');
  div.innerHTML = `
    <p><strong>${secretName}</strong></p>
    <div class="secret">${secretValue}</div>
  `;
  output.appendChild(div);
}

function renderError(message) {
  const div = document.createElement('div');
  div.className = 'error';
  div.textContent = `Error: ${message}`;
  output.appendChild(div);
}

bootstrapIframe({
  // This will be called once the iframe is initialized
  onReady: async (ctx) => {
    try {
      // Try to fetch a test secret
      // In a real extension, you'd use this to get actual secrets
      const response = await fetch('/health', {
        headers: {
          'x-alga-runner': 'true',
        },
      });

      if (response.ok) {
        renderSecret('Runner Status', 'Connected ✓');
        renderSecret('Capability', 'secrets.get');
        renderSecret('Tenant ID', ctx.tenantId || 'Not available');
        renderSecret('Extension ID', ctx.extensionId || 'Not available');
      } else {
        renderError(`Runner returned status: ${response.status}`);
      }
    } catch (err) {
      renderError(err.message || 'Failed to connect to runner');
    }
  },
});
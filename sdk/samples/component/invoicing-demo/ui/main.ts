import { IframeBridge, callHandlerJson } from '@alga-psa/extension-iframe-sdk';

const output = document.getElementById('output');
const btnCreate = document.getElementById('btn-create') as HTMLButtonElement | null;
const btnStatus = document.getElementById('btn-status') as HTMLButtonElement | null;

function write(obj: unknown) {
  if (!output) return;
  output.textContent = JSON.stringify(obj, null, 2);
}

function getInputValue(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  return el?.value ?? '';
}

async function main() {
  // The host currently does not provide a stable parentOrigin query param on all routes.
  // For local/dev, allow wildcard so the SDK accepts messages from the embedding origin.
  const bridge = new IframeBridge({ devAllowWildcard: true });
  bridge.ready();

  btnStatus?.addEventListener('click', async () => {
    try {
      const data = await callHandlerJson(bridge, '/api/status');
      write({ ok: true, data });
    } catch (err) {
      write({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  btnCreate?.addEventListener('click', async () => {
    if (!btnCreate) return;
    btnCreate.disabled = true;
    btnCreate.textContent = 'Creating...';

    try {
      const clientId = getInputValue('clientId').trim();
      const serviceId = getInputValue('serviceId').trim();
      const invoiceDate = getInputValue('invoiceDate').trim();
      const dueDate = getInputValue('dueDate').trim();
      const poNumber = getInputValue('poNumber').trim();
      const quantity = Number(getInputValue('quantity'));
      const rateDollars = Number(getInputValue('rateDollars'));
      const description = getInputValue('description');

      const rate = Number.isFinite(rateDollars) ? Math.round(rateDollars * 100) : rateDollars;

      const body = {
        clientId,
        invoiceDate: invoiceDate || undefined,
        dueDate: dueDate || undefined,
        poNumber: poNumber ? poNumber : null,
        items: [{ serviceId, quantity, description, rate }],
      };

      const data = await callHandlerJson(bridge, '/api/create-manual-invoice', {
        method: 'POST',
        body,
      });
      write({ ok: true, data });
    } catch (err) {
      write({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      btnCreate.disabled = false;
      btnCreate.textContent = 'Create Draft Invoice';
    }
  });
}

main().catch((err) => {
  write({ ok: false, error: err instanceof Error ? err.message : String(err) });
});

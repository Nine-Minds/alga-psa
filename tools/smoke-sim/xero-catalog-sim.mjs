// Minimal Xero Accounting API catalog simulator (read-only settings lookups).
// Pair with accounting-provider-simulator.cjs (OAuth + connections) and point
//   XERO_API_BASE_URL=http://127.0.0.1:4902/xero/api.xro/2.0
// Serves GET /Items, /Accounts, /TaxRates, /TrackingCategories with a catalog
// where Item "200" and revenue Account "200" share the same code.
import http from 'node:http';

const PORT = Number(process.env.XERO_CATALOG_SIM_PORT ?? 4902);

const catalog = {
  Items: [
    { ItemID: 'sim-item-200', Code: '200', Name: 'Item 200 (same code as Sales)', Status: 'ACTIVE' },
    { ItemID: 'sim-item-consult', Code: 'CONSULT', Name: 'Consulting', Status: 'ACTIVE' },
    { ItemID: 'sim-item-support', Code: 'SUPPORT', Name: 'Support Plan', Status: 'ACTIVE' }
  ],
  Accounts: [
    { AccountID: 'sim-acct-200', Code: '200', Name: 'Sales', Type: 'REVENUE', Status: 'ACTIVE' },
    { AccountID: 'sim-acct-260', Code: '260', Name: 'Other Revenue', Type: 'OTHERINCOME', Status: 'ACTIVE' },
    { AccountID: 'sim-acct-090', Code: '090', Name: 'Business Bank', Type: 'BANK', Status: 'ACTIVE' }
  ],
  TaxRates: [
    { TaxRateID: 'sim-tax-out', Name: 'Tax on Sales', TaxType: 'OUTPUT', Status: 'ACTIVE', EffectiveRate: 10, TaxComponents: [{ Name: 'GST', Rate: 10 }] }
  ],
  TrackingCategories: []
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const key = url.pathname.replace(/^\/xero\/api\.xro\/2\.0\//, '');
    console.log(`[xero-catalog-sim] ${req.method} ${url.pathname} tenant=${req.headers['xero-tenant-id'] ?? '-'}`);
    if (req.method === 'GET' && Object.hasOwn(catalog, key)) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ [key]: catalog[key] }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ Message: `not simulated: ${req.method} ${url.pathname}` }));
  })
  .listen(PORT, '127.0.0.1', () => console.log(`[xero-catalog-sim] listening on ${PORT}`));

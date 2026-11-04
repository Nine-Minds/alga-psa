import { MspTicketTemplatesPage } from '@alga-psa/msp-composition/tickets/MspTicketTemplates';
import { getCurrentTenantProduct } from '@/lib/productAccess';

export default async function TicketTemplatesRoute() {
  // "New ticket from template" must open the same Quick Add form the tickets dashboard uses.
  const productCode = await getCurrentTenantProduct();
  return <MspTicketTemplatesPage isAlgaDeskMode={productCode === 'algadesk'} />;
}

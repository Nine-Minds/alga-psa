import { MspRecurringTicketsPage } from '@alga-psa/msp-composition/tickets/MspRecurringTickets';
import { getCurrentTenantProduct } from '@/lib/productAccess';

export default async function RecurringTicketsRoute() {
  const productCode = await getCurrentTenantProduct();
  return <MspRecurringTicketsPage isAlgaDeskMode={productCode === 'algadesk'} />;
}

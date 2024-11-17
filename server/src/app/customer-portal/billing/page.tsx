import { getServerSession } from 'next-auth';
import { options } from '../../api/auth/[...nextauth]/options';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import BillingOverview from '@/components/customer-portal/billing/BillingOverview';

export default async function BillingPage() {
  const session = await getServerSession(options);

  if (!session?.user?.user_type || session.user.user_type !== 'client') {
    redirect('/auth/signin?callbackUrl=/customer-portal/billing');
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold mb-2">Billing & Payments</h1>
        <p className="text-gray-600">
          Manage your billing information, view invoices, and handle payments
        </p>
      </div>

      <div className="grid gap-6">
        <Card>
          <BillingOverview />
        </Card>
      </div>
    </div>
  );
}

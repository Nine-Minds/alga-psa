import React from 'react';
import { useRouter } from 'next/navigation';
import { Box, Heading, Flex } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { ChevronLeft } from 'lucide-react';
import { IBillingPlan } from 'server/src/interfaces/billing.interfaces';
import { PLAN_TYPE_DISPLAY } from 'server/src/constants/billing';

interface BillingPlanHeaderProps {
  plan: IBillingPlan;
}

const BillingPlanHeader: React.FC<BillingPlanHeaderProps> = ({ plan }) => {
  const router = useRouter();

  const handleBackClick = () => {
    router.push('/msp/billing?tab=plans');
  };

  return (
    <Box className="mb-6">
      <Button
        variant="ghost"
        className="mb-2"
        onClick={handleBackClick}
        id="back-to-plans-button"
      >
        <ChevronLeft className="h-4 w-4 mr-2" />
        Back to Plans
      </Button>
      
      <Flex justify="between" align="center">
        <div>
          <Heading as="h2" size="6">{plan.plan_name}</Heading>
          <div className="text-gray-500 mt-1">
            {PLAN_TYPE_DISPLAY[plan.plan_type] || plan.plan_type} Plan
            {plan.is_custom && <span className="ml-2 text-blue-600 font-medium">Custom</span>}
          </div>
        </div>
      </Flex>
    </Box>
  );
};

export default BillingPlanHeader;
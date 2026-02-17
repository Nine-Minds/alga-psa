'use client';

import React from 'react';
import Clients from '@alga-psa/clients/components/clients/Clients';
import ClientDetails from './ClientDetails';

export default function MspClientsPage() {
  return <Clients ClientDetailsComponent={ClientDetails} />;
}

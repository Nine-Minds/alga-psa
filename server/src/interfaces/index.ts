'use client';

export interface TenantEntity {
    tenant?: string;
}

import { IUser, IUserWithRoles } from './auth.interfaces';
export * from './session.interfaces';
export * from './general.interfaces';
export * from './ticket.interfaces';
export * from './tenant.interface';
export * from './auth.interfaces';
export * from './document.interface';
export * from './project.interfaces';
export * from './board.interface';
export * from './comment.interface';
export * from './client.interfaces';
export * from './contact.interfaces';
export * from './billing.interfaces';
export * from './timeEntry.interfaces';
export * from './invoice.interfaces';
export * from './interaction.interfaces';
export * from './ticketResource.interfaces';
export * from './asset.interfaces';
export * from './status.interface';
export * from './contractLineServiceConfiguration.interfaces';
export * from './contract.interfaces';
export * from './contractTemplate.interfaces';
export * from './scheduling.interfaces';
export * from './projectTemplate.interfaces';

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { UserService } from '@alga-psa/users';

import { ClientService } from '@/lib/api/services/ClientService';
import { ContactService } from '@/lib/api/services/ContactService';
import { TicketService } from '@/lib/api/services/TicketService';
import { ProjectService } from '@/lib/api/services/ProjectService';
import { AssetService } from '@/lib/api/services/AssetService';
import { CategoryService } from '@/lib/api/services/CategoryService';
import { PermissionRoleService } from '@/lib/api/services/PermissionRoleService';
import { TagService } from '@/lib/api/services/TagService';
import { TeamService } from '@/lib/api/services/TeamService';
import { TimeEntryService } from '@/lib/api/services/TimeEntryService';
import { TimeSheetService } from '@/lib/api/services/TimeSheetService';
import { FinancialService } from '@/lib/api/services/FinancialService';
import { ContractLineService } from '@/lib/api/services/ContractLineService';
import { InvoiceService } from '@/lib/api/services/InvoiceService';

import { clientFilterSchema } from '@/lib/api/schemas/client';
import { contactFilterSchema } from '@/lib/api/schemas/contact';
import { ticketFilterSchema } from '@/lib/api/schemas/ticket';
import { projectFilterSchema } from '@/lib/api/schemas/project';
import { assetFilterSchema } from '@/lib/api/schemas/asset';
import { serviceCategoryFilterSchema, ticketCategoryFilterSchema } from '@/lib/api/schemas/categorySchemas';
import { permissionFilterSchema, roleFilterSchema } from '@/lib/api/schemas/permissionRoleSchemas';
import { tagFilterSchema } from '@/lib/api/schemas/tagSchemas';
import { teamFilterSchema } from '@/lib/api/schemas/teamSchemas';
import { timeEntryFilterSchema } from '@/lib/api/schemas/timeEntry';
import { timeSheetFilterSchema } from '@/lib/api/schemas/timeSheet';
import {
  transactionListQuerySchema,
  creditListQuerySchema,
  paymentMethodListQuerySchema,
  invoiceListQuerySchema,
  taxRateListQuerySchema,
  contractLineListQuerySchema,
} from '@/lib/api/schemas/financialSchemas';
import {
  contractLineFilterSchema,
  contractFilterSchema,
  clientContractLineFilterSchema,
} from '@/lib/api/schemas/contractLineSchemas';
import { invoiceFilterSchema } from '@/lib/api/schemas/invoiceSchemas';
import { userFilterSchema } from '@/lib/api/schemas/userSchemas';

const SERVER_SERVICES_DIR = resolve(__dirname, '../../../lib/api/services');
const PACKAGES_USERS_DIR = resolve(__dirname, '../../../../../packages/users/src/services');

/**
 * Every BaseService-backed list filter schema paired with the service that
 * consumes it. A range filter is a key declared in the service's
 * rangeFilterColumns() map (string = column, null = declared-but-rejected). A
 * key that is not declared must be handled by the service's own filter code
 * (e.g. `assigned_to`, ticket `entered_from`, contract-line `start_date_from`).
 *
 * This is intentionally a table: adding a range key to one of these schemas
 * without mapping or handling it in the service fails the guard below, which is
 * what keeps `assigned_to`-style keys from being rejected as unknown ranges.
 */
const entries: Array<{
  schemaName: string;
  schema: { shape: Record<string, unknown> };
  service: new () => object;
  serviceFile: string;
}> = [
  { schemaName: 'clientFilterSchema', schema: clientFilterSchema, service: ClientService, serviceFile: resolve(SERVER_SERVICES_DIR, 'ClientService.ts') },
  { schemaName: 'contactFilterSchema', schema: contactFilterSchema, service: ContactService, serviceFile: resolve(SERVER_SERVICES_DIR, 'ContactService.ts') },
  { schemaName: 'ticketFilterSchema', schema: ticketFilterSchema, service: TicketService, serviceFile: resolve(SERVER_SERVICES_DIR, 'TicketService.ts') },
  { schemaName: 'projectFilterSchema', schema: projectFilterSchema, service: ProjectService, serviceFile: resolve(SERVER_SERVICES_DIR, 'ProjectService.ts') },
  { schemaName: 'assetFilterSchema', schema: assetFilterSchema, service: AssetService, serviceFile: resolve(SERVER_SERVICES_DIR, 'AssetService.ts') },
  { schemaName: 'serviceCategoryFilterSchema', schema: serviceCategoryFilterSchema, service: CategoryService, serviceFile: resolve(SERVER_SERVICES_DIR, 'CategoryService.ts') },
  { schemaName: 'ticketCategoryFilterSchema', schema: ticketCategoryFilterSchema, service: CategoryService, serviceFile: resolve(SERVER_SERVICES_DIR, 'CategoryService.ts') },
  { schemaName: 'permissionFilterSchema', schema: permissionFilterSchema, service: PermissionRoleService, serviceFile: resolve(SERVER_SERVICES_DIR, 'PermissionRoleService.ts') },
  { schemaName: 'roleFilterSchema', schema: roleFilterSchema, service: PermissionRoleService, serviceFile: resolve(SERVER_SERVICES_DIR, 'PermissionRoleService.ts') },
  { schemaName: 'tagFilterSchema', schema: tagFilterSchema, service: TagService, serviceFile: resolve(SERVER_SERVICES_DIR, 'TagService.ts') },
  { schemaName: 'teamFilterSchema', schema: teamFilterSchema, service: TeamService, serviceFile: resolve(SERVER_SERVICES_DIR, 'TeamService.ts') },
  { schemaName: 'timeEntryFilterSchema', schema: timeEntryFilterSchema, service: TimeEntryService, serviceFile: resolve(SERVER_SERVICES_DIR, 'TimeEntryService.ts') },
  { schemaName: 'timeSheetFilterSchema', schema: timeSheetFilterSchema, service: TimeSheetService, serviceFile: resolve(SERVER_SERVICES_DIR, 'TimeSheetService.ts') },
  { schemaName: 'transactionListQuerySchema', schema: transactionListQuerySchema, service: FinancialService, serviceFile: resolve(SERVER_SERVICES_DIR, 'FinancialService.ts') },
  { schemaName: 'creditListQuerySchema', schema: creditListQuerySchema, service: FinancialService, serviceFile: resolve(SERVER_SERVICES_DIR, 'FinancialService.ts') },
  { schemaName: 'paymentMethodListQuerySchema', schema: paymentMethodListQuerySchema, service: FinancialService, serviceFile: resolve(SERVER_SERVICES_DIR, 'FinancialService.ts') },
  { schemaName: 'invoiceListQuerySchema', schema: invoiceListQuerySchema, service: FinancialService, serviceFile: resolve(SERVER_SERVICES_DIR, 'FinancialService.ts') },
  { schemaName: 'taxRateListQuerySchema', schema: taxRateListQuerySchema, service: FinancialService, serviceFile: resolve(SERVER_SERVICES_DIR, 'FinancialService.ts') },
  { schemaName: 'contractLineListQuerySchema (financial)', schema: contractLineListQuerySchema, service: FinancialService, serviceFile: resolve(SERVER_SERVICES_DIR, 'FinancialService.ts') },
  { schemaName: 'contractLineFilterSchema', schema: contractLineFilterSchema, service: ContractLineService, serviceFile: resolve(SERVER_SERVICES_DIR, 'ContractLineService.ts') },
  { schemaName: 'contractFilterSchema', schema: contractFilterSchema, service: ContractLineService, serviceFile: resolve(SERVER_SERVICES_DIR, 'ContractLineService.ts') },
  { schemaName: 'clientContractLineFilterSchema', schema: clientContractLineFilterSchema, service: ContractLineService, serviceFile: resolve(SERVER_SERVICES_DIR, 'ContractLineService.ts') },
  { schemaName: 'invoiceFilterSchema', schema: invoiceFilterSchema, service: InvoiceService, serviceFile: resolve(SERVER_SERVICES_DIR, 'InvoiceService.ts') },
  { schemaName: 'userFilterSchema', schema: userFilterSchema, service: UserService, serviceFile: resolve(PACKAGES_USERS_DIR, 'UserService.ts') },
];

describe('list range filter schema coverage', () => {
  for (const entry of entries) {
    it(`${entry.schemaName}: every _from/_to key is mapped or handled by the service`, () => {
      const service = new entry.service() as { rangeFilterColumns(): Record<string, string | null> };
      const rangeMap = service.rangeFilterColumns();
      const source = readFileSync(entry.serviceFile, 'utf8');

      const rangeKeys = Object.keys(entry.schema.shape).filter(
        (key) => key.endsWith('_from') || key.endsWith('_to'),
      );

      expect(rangeKeys.length, `${entry.schemaName} should expose at least one range key`).toBeGreaterThan(0);

      for (const key of rangeKeys) {
        const declared = Object.prototype.hasOwnProperty.call(rangeMap, key);
        const handledInline = source.includes(key);
        expect(
          declared || handledInline,
          `${entry.schemaName}.${key} is neither in ${entry.service.name}.rangeFilterColumns() nor referenced in its filter code`,
        ).toBe(true);
      }
    });
  }
});

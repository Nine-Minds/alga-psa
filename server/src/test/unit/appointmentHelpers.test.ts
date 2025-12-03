import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import {
  formatDate,
  formatTime,
  generateICSLink,
  getRequestNewAppointmentLink,
  getScheduleApprovers,
  getTenantSettings,
  getClientUserIdFromContact,
  getClientCompanyName,
  type TenantSettings,
  type ScheduleApprover
} from '../../lib/actions/appointmentHelpers';
import * as dbModule from '../../lib/db';
import * as sharedDb from '@shared/db';
import type { Knex } from 'knex';

// Mock the database module
vi.mock('../../lib/db', () => ({
  createTenantKnex: vi.fn()
}));

// Mock the shared db module
vi.mock('@shared/db', () => ({
  withTransaction: vi.fn((knex, callback) => callback(knex))
}));

describe('Appointment Helper Functions', () => {
  let mockKnex: any;
  let mockTrx: any;

  beforeEach(() => {
    // Create a mock transaction object with chainable query builder methods
    mockTrx = {
      where: vi.fn().mockReturnThis(),
      andOn: vi.fn().mockReturnThis(),
      join: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      first: vi.fn().mockReturnThis(),
      distinct: vi.fn().mockReturnThis(),
      whereNull: vi.fn().mockReturnThis(),
    };

    // Mock knex instance
    mockKnex = vi.fn(() => mockTrx);
    Object.assign(mockKnex, mockTrx);

    // Mock createTenantKnex to return our mock knex instance
    (dbModule.createTenantKnex as Mock).mockResolvedValue({
      knex: mockKnex
    });

    // Reset environment variables
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('formatDate', () => {
    it('should format date in English locale', async () => {
      const result = await formatDate('2025-11-15', 'en');
      expect(result).toBe('November 15, 2025');
    });

    it('should format date in German locale', async () => {
      const result = await formatDate('2025-11-15', 'de');
      expect(result).toBe('15. November 2025');
    });

    it('should format date in Spanish locale', async () => {
      const result = await formatDate('2025-11-15', 'es');
      expect(result).toBe('15 de noviembre de 2025');
    });

    it('should format date in French locale', async () => {
      const result = await formatDate('2025-11-15', 'fr');
      expect(result).toBe('15 novembre 2025');
    });

    it('should format date in Italian locale', async () => {
      const result = await formatDate('2025-11-15', 'it');
      expect(result).toBe('15 novembre 2025');
    });

    it('should format date in Dutch locale', async () => {
      const result = await formatDate('2025-11-15', 'nl');
      expect(result).toBe('15 november 2025');
    });

    it('should default to English locale when no locale is provided', async () => {
      const result = await formatDate('2025-11-15');
      expect(result).toBe('November 15, 2025');
    });

    it('should default to English locale for unsupported locale', async () => {
      const result = await formatDate('2025-11-15', 'unsupported');
      expect(result).toBe('November 15, 2025');
    });

    it('should handle ISO date strings with time component', async () => {
      const result = await formatDate('2025-11-15T14:30:00Z', 'en');
      expect(result).toBe('November 15, 2025');
    });

    it('should handle leap year dates', async () => {
      const result = await formatDate('2024-02-29', 'en');
      expect(result).toBe('February 29, 2024');
    });

    it('should handle year boundary dates', async () => {
      const resultEndYear = await formatDate('2025-12-31', 'en');
      expect(resultEndYear).toBe('December 31, 2025');

      const resultStartYear = await formatDate('2025-01-01', 'en');
      expect(resultStartYear).toBe('January 1, 2025');
    });

    it('should return original string on invalid date', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await formatDate('invalid-date', 'en');
      expect(result).toBe('invalid-date');
      expect(consoleSpy).toHaveBeenCalledWith('Error formatting date:', expect.any(Error));
      consoleSpy.mockRestore();
    });

    it('should handle empty string', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await formatDate('', 'en');
      expect(result).toBe('');
      consoleSpy.mockRestore();
    });

    it('should handle different date formats', async () => {
      // Test various valid date string formats
      const result1 = await formatDate('2025/11/15', 'en');
      expect(result1).toBe('November 15, 2025');

      const result2 = await formatDate('11/15/2025', 'en');
      expect(result2).toBe('November 15, 2025');
    });
  });

  describe('formatTime', () => {
    it('should format time in English locale with 12-hour format', async () => {
      const result = await formatTime('14:30', 'en');
      expect(result).toBe('2:30 PM');
    });

    it('should format time in German locale with 24-hour format', async () => {
      const result = await formatTime('14:30', 'de');
      expect(result).toBe('14:30');
    });

    it('should format time in Spanish locale with 24-hour format', async () => {
      const result = await formatTime('14:30', 'es');
      expect(result).toBe('14:30');
    });

    it('should format time in French locale with 24-hour format', async () => {
      const result = await formatTime('14:30', 'fr');
      expect(result).toBe('14:30');
    });

    it('should format time in Italian locale with 24-hour format', async () => {
      const result = await formatTime('14:30', 'it');
      expect(result).toBe('14:30');
    });

    it('should format time in Dutch locale with 24-hour format', async () => {
      const result = await formatTime('14:30', 'nl');
      expect(result).toBe('14:30');
    });

    it('should default to English locale when no locale is provided', async () => {
      const result = await formatTime('14:30');
      expect(result).toBe('2:30 PM');
    });

    it('should handle midnight (00:00)', async () => {
      const resultEn = await formatTime('00:00', 'en');
      expect(resultEn).toBe('12:00 AM');

      const resultDe = await formatTime('00:00', 'de');
      expect(resultDe).toBe('00:00');
    });

    it('should handle noon (12:00)', async () => {
      const resultEn = await formatTime('12:00', 'en');
      expect(resultEn).toBe('12:00 PM');

      const resultDe = await formatTime('12:00', 'de');
      expect(resultDe).toBe('12:00');
    });

    it('should handle early morning time (AM)', async () => {
      const result = await formatTime('09:15', 'en');
      expect(result).toBe('9:15 AM');
    });

    it('should handle late evening time', async () => {
      const result = await formatTime('23:45', 'en');
      expect(result).toBe('11:45 PM');
    });

    it('should handle single digit hours and minutes', async () => {
      const result = await formatTime('9:5', 'en');
      expect(result).toBe('9:05 AM');
    });

    it('should handle time with leading zeros', async () => {
      const result = await formatTime('09:05', 'en');
      expect(result).toBe('9:05 AM');
    });

    it('should return original string on invalid time format', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await formatTime('invalid-time', 'en');
      expect(result).toBe('invalid-time');
      expect(consoleSpy).toHaveBeenCalledWith('Error formatting time:', expect.any(Error));
      consoleSpy.mockRestore();
    });

    it('should handle empty string', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await formatTime('', 'en');
      expect(result).toBe('');
      consoleSpy.mockRestore();
    });

    it('should handle time without separator', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await formatTime('1430', 'en');
      expect(result).toBe('1430');
      consoleSpy.mockRestore();
    });

    it('should handle boundary hours correctly', async () => {
      const result0 = await formatTime('00:30', 'en');
      expect(result0).toBe('12:30 AM');

      const result11 = await formatTime('11:30', 'en');
      expect(result11).toBe('11:30 AM');

      const result12 = await formatTime('12:30', 'en');
      expect(result12).toBe('12:30 PM');

      const result13 = await formatTime('13:30', 'en');
      expect(result13).toBe('1:30 PM');

      const result23 = await formatTime('23:30', 'en');
      expect(result23).toBe('11:30 PM');
    });

    it('should handle default to English for unsupported locale', async () => {
      const result = await formatTime('14:30', 'unsupported');
      expect(result).toBe('2:30 PM');
    });
  });

  describe('generateICSLink', () => {
    const mockScheduleEntry = {
      entry_id: 'entry-123',
      scheduled_start: '2025-11-15T14:00:00Z',
      scheduled_end: '2025-11-15T15:00:00Z',
      title: 'Test Appointment'
    };

    it('should generate ICS link with default localhost URL', async () => {
      const result = await generateICSLink(mockScheduleEntry);
      expect(result).toBe('http://localhost:3000/api/calendar/appointment/entry-123.ics');
    });

    it('should generate ICS link with custom base URL from environment', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://example.com';
      const result = await generateICSLink(mockScheduleEntry);
      expect(result).toBe('https://example.com/api/calendar/appointment/entry-123.ics');
    });

    it('should handle entry_id with special characters', async () => {
      const entryWithSpecialId = {
        ...mockScheduleEntry,
        entry_id: 'entry-123-abc_def'
      };
      const result = await generateICSLink(entryWithSpecialId);
      expect(result).toBe('http://localhost:3000/api/calendar/appointment/entry-123-abc_def.ics');
    });

    it('should handle UUID entry_id', async () => {
      const entryWithUUID = {
        ...mockScheduleEntry,
        entry_id: '550e8400-e29b-41d4-a716-446655440000'
      };
      const result = await generateICSLink(entryWithUUID);
      expect(result).toBe('http://localhost:3000/api/calendar/appointment/550e8400-e29b-41d4-a716-446655440000.ics');
    });

    it('should generate link with trailing slash in base URL', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://example.com/';
      const result = await generateICSLink(mockScheduleEntry);
      // Note: This will result in double slashes, which is acceptable for the URL structure
      expect(result).toBe('https://example.com//api/calendar/appointment/entry-123.ics');
    });

    it('should generate link with production URL', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.algapsa.com';
      const result = await generateICSLink(mockScheduleEntry);
      expect(result).toBe('https://app.algapsa.com/api/calendar/appointment/entry-123.ics');
    });

    it('should maintain consistent structure regardless of entry times', async () => {
      const differentEntry = {
        ...mockScheduleEntry,
        entry_id: 'different-123',
        scheduled_start: '2026-01-01T09:00:00Z',
        scheduled_end: '2026-01-01T17:00:00Z'
      };
      const result = await generateICSLink(differentEntry);
      expect(result).toBe('http://localhost:3000/api/calendar/appointment/different-123.ics');
    });
  });

  describe('getRequestNewAppointmentLink', () => {
    it('should generate appointment request link with default localhost URL', async () => {
      const result = await getRequestNewAppointmentLink();
      expect(result).toBe('http://localhost:3000/client-portal/appointments');
    });

    it('should generate appointment request link with custom base URL from environment', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://example.com';
      const result = await getRequestNewAppointmentLink();
      expect(result).toBe('https://example.com/client-portal/appointments');
    });

    it('should generate link with production URL', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.algapsa.com';
      const result = await getRequestNewAppointmentLink();
      expect(result).toBe('https://app.algapsa.com/client-portal/appointments');
    });

    it('should handle base URL with trailing slash', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://example.com/';
      const result = await getRequestNewAppointmentLink();
      expect(result).toBe('https://example.com//client-portal/appointments');
    });

    it('should handle base URL with port number', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:8080';
      const result = await getRequestNewAppointmentLink();
      expect(result).toBe('http://localhost:8080/client-portal/appointments');
    });

    it('should handle base URL with subdirectory', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://example.com/app';
      const result = await getRequestNewAppointmentLink();
      expect(result).toBe('https://example.com/app/client-portal/appointments');
    });

    it('should be consistent across multiple calls', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://test.example.com';
      const result1 = await getRequestNewAppointmentLink();
      const result2 = await getRequestNewAppointmentLink();
      expect(result1).toBe(result2);
      expect(result1).toBe('https://test.example.com/client-portal/appointments');
    });
  });

  describe('getScheduleApprovers', () => {
    const mockApprovers: ScheduleApprover[] = [
      {
        user_id: 'user-1',
        email: 'admin@example.com',
        first_name: 'John',
        last_name: 'Doe'
      },
      {
        user_id: 'user-2',
        email: 'manager@example.com',
        first_name: 'Jane',
        last_name: 'Smith'
      }
    ];

    beforeEach(() => {
      mockTrx.distinct.mockResolvedValue(mockApprovers);
    });

    it('should return list of schedule approvers for a tenant', async () => {
      const result = await getScheduleApprovers('tenant-123');

      expect(result).toEqual(mockApprovers);
      expect(dbModule.createTenantKnex).toHaveBeenCalled();
    });

    it('should query with correct tenant and permission filters', async () => {
      await getScheduleApprovers('tenant-123');

      expect(mockKnex).toHaveBeenCalledWith('users as u');
      expect(mockTrx.where).toHaveBeenCalledWith({
        'u.tenant': 'tenant-123',
        'u.user_type': 'internal',
        'p.resource': 'schedule',
        'p.action': 'update'
      });
    });

    it('should filter out inactive users', async () => {
      await getScheduleApprovers('tenant-123');

      expect(mockTrx.whereNull).toHaveBeenCalledWith('u.is_inactive');
    });

    it('should return empty array when no approvers found', async () => {
      mockTrx.distinct.mockResolvedValue([]);

      const result = await getScheduleApprovers('tenant-123');

      expect(result).toEqual([]);
    });

    it('should return distinct approvers', async () => {
      await getScheduleApprovers('tenant-123');

      expect(mockTrx.distinct).toHaveBeenCalled();
    });

    it('should select correct user fields', async () => {
      await getScheduleApprovers('tenant-123');

      expect(mockTrx.select).toHaveBeenCalledWith(
        'u.user_id',
        'u.email',
        'u.first_name',
        'u.last_name'
      );
    });

    it('should handle database errors', async () => {
      const dbError = new Error('Database connection failed');
      mockTrx.distinct.mockRejectedValue(dbError);

      await expect(getScheduleApprovers('tenant-123')).rejects.toThrow('Database connection failed');
    });
  });

  describe('getTenantSettings', () => {
    const mockTenantSettings: TenantSettings = {
      contactEmail: 'support@example.com',
      contactPhone: '+1-555-0123',
      tenantName: 'Acme MSP',
      defaultLocale: 'en'
    };

    beforeEach(() => {
      // Mock tenant_settings query
      const tenantSettingsQuery = {
        ...mockTrx,
        first: vi.fn().mockResolvedValue({
          tenant: 'tenant-123',
          settings: {
            supportEmail: 'support@example.com',
            supportPhone: '+1-555-0123',
            companyName: 'Acme MSP',
            defaultLocale: 'en'
          }
        })
      };

      // Mock companies query
      const companiesQuery = {
        ...mockTrx,
        first: vi.fn().mockResolvedValue({
          company_id: 'company-1',
          company_name: 'Acme MSP'
        })
      };

      // Create a sequence to return different queries
      let callCount = 0;
      mockKnex.mockImplementation((tableName: string) => {
        callCount++;
        if (tableName === 'tenant_settings' || callCount === 1) {
          return tenantSettingsQuery;
        } else if (tableName === 'companies' || callCount === 2) {
          return companiesQuery;
        }
        return mockTrx;
      });
    });

    it('should return tenant settings', async () => {
      const result = await getTenantSettings('tenant-123');

      expect(result).toMatchObject({
        contactEmail: expect.any(String),
        contactPhone: expect.any(String),
        tenantName: expect.any(String),
        defaultLocale: expect.any(String)
      });
    });

    it('should use default values when settings are missing', async () => {
      const emptySettingsQuery = {
        ...mockTrx,
        first: vi.fn().mockResolvedValue(null)
      };

      const noCompanyQuery = {
        ...mockTrx,
        first: vi.fn().mockResolvedValue(null)
      };

      let callCount = 0;
      mockKnex.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return emptySettingsQuery;
        return noCompanyQuery;
      });

      const result = await getTenantSettings('tenant-123');

      expect(result.contactEmail).toBe('support@company.com');
      expect(result.contactPhone).toBe('');
      expect(result.tenantName).toBe('Your MSP');
      expect(result.defaultLocale).toBe('en');
    });

    it('should prioritize supportEmail over contactEmail', async () => {
      const settingsQuery = {
        ...mockTrx,
        first: vi.fn().mockResolvedValue({
          settings: {
            supportEmail: 'support@example.com',
            contactEmail: 'contact@example.com'
          }
        })
      };

      const companiesQuery = {
        ...mockTrx,
        first: vi.fn().mockResolvedValue({ company_name: 'Test MSP' })
      };

      let callCount = 0;
      mockKnex.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? settingsQuery : companiesQuery;
      });

      const result = await getTenantSettings('tenant-123');

      expect(result.contactEmail).toBe('support@example.com');
    });

    it('should prioritize company_name over settings.companyName', async () => {
      const settingsQuery = {
        ...mockTrx,
        first: vi.fn().mockResolvedValue({
          settings: {
            companyName: 'Settings Company'
          }
        })
      };

      const companiesQuery = {
        ...mockTrx,
        first: vi.fn().mockResolvedValue({
          company_name: 'Database Company'
        })
      };

      let callCount = 0;
      mockKnex.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? settingsQuery : companiesQuery;
      });

      const result = await getTenantSettings('tenant-123');

      expect(result.tenantName).toBe('Database Company');
    });

    it('should handle empty settings JSONB', async () => {
      const settingsQuery = {
        ...mockTrx,
        first: vi.fn().mockResolvedValue({
          settings: {}
        })
      };

      const companiesQuery = {
        ...mockTrx,
        first: vi.fn().mockResolvedValue(null)
      };

      let callCount = 0;
      mockKnex.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? settingsQuery : companiesQuery;
      });

      const result = await getTenantSettings('tenant-123');

      expect(result.contactEmail).toBe('support@company.com');
      expect(result.tenantName).toBe('Your MSP');
    });

    it('should handle database errors', async () => {
      const errorQuery = {
        ...mockTrx,
        first: vi.fn().mockRejectedValue(new Error('Database error'))
      };

      mockKnex.mockImplementation(() => errorQuery);

      await expect(getTenantSettings('tenant-123')).rejects.toThrow('Database error');
    });
  });

  describe('getClientUserIdFromContact', () => {
    beforeEach(() => {
      mockTrx.first.mockResolvedValue({
        user_id: 'user-client-123'
      });
    });

    it('should return user_id for a valid contact', async () => {
      const result = await getClientUserIdFromContact('contact-123', 'tenant-123');

      expect(result).toBe('user-client-123');
      expect(mockKnex).toHaveBeenCalledWith('users');
    });

    it('should query with correct filters', async () => {
      await getClientUserIdFromContact('contact-123', 'tenant-123');

      expect(mockTrx.where).toHaveBeenCalledWith({
        tenant: 'tenant-123',
        contact_id: 'contact-123',
        user_type: 'client'
      });
    });

    it('should filter out inactive users', async () => {
      await getClientUserIdFromContact('contact-123', 'tenant-123');

      expect(mockTrx.whereNull).toHaveBeenCalledWith('is_inactive');
    });

    it('should return null when user not found', async () => {
      mockTrx.first.mockResolvedValue(null);

      const result = await getClientUserIdFromContact('contact-123', 'tenant-123');

      expect(result).toBeNull();
    });

    it('should return null when user_id is missing', async () => {
      mockTrx.first.mockResolvedValue({});

      const result = await getClientUserIdFromContact('contact-123', 'tenant-123');

      expect(result).toBeNull();
    });

    it('should handle different tenant IDs', async () => {
      await getClientUserIdFromContact('contact-123', 'different-tenant');

      expect(mockTrx.where).toHaveBeenCalledWith({
        tenant: 'different-tenant',
        contact_id: 'contact-123',
        user_type: 'client'
      });
    });

    it('should handle database errors', async () => {
      mockTrx.first.mockRejectedValue(new Error('Database error'));

      await expect(
        getClientUserIdFromContact('contact-123', 'tenant-123')
      ).rejects.toThrow('Database error');
    });

    it('should only select user_id field', async () => {
      await getClientUserIdFromContact('contact-123', 'tenant-123');

      expect(mockTrx.select).toHaveBeenCalledWith('user_id');
    });
  });

  describe('getClientCompanyName', () => {
    beforeEach(() => {
      mockTrx.first.mockResolvedValue({
        company_name: 'Acme Corporation'
      });
    });

    it('should return company name for a valid client', async () => {
      const result = await getClientCompanyName('client-123', 'tenant-123');

      expect(result).toBe('Acme Corporation');
      expect(mockKnex).toHaveBeenCalledWith('companies');
    });

    it('should query with correct filters', async () => {
      await getClientCompanyName('client-123', 'tenant-123');

      expect(mockTrx.where).toHaveBeenCalledWith({
        company_id: 'client-123',
        tenant: 'tenant-123'
      });
    });

    it('should return "Unknown Client" when company not found', async () => {
      mockTrx.first.mockResolvedValue(null);

      const result = await getClientCompanyName('client-123', 'tenant-123');

      expect(result).toBe('Unknown Client');
    });

    it('should return "Unknown Client" when company_name is missing', async () => {
      mockTrx.first.mockResolvedValue({});

      const result = await getClientCompanyName('client-123', 'tenant-123');

      expect(result).toBe('Unknown Client');
    });

    it('should select only company_name field', async () => {
      await getClientCompanyName('client-123', 'tenant-123');

      expect(mockTrx.select).toHaveBeenCalledWith('company_name');
    });

    it('should handle different tenant IDs', async () => {
      await getClientCompanyName('client-123', 'different-tenant');

      expect(mockTrx.where).toHaveBeenCalledWith({
        company_id: 'client-123',
        tenant: 'different-tenant'
      });
    });

    it('should handle empty company name', async () => {
      mockTrx.first.mockResolvedValue({
        company_name: ''
      });

      const result = await getClientCompanyName('client-123', 'tenant-123');

      // Empty string is falsy, so it should return 'Unknown Client'
      expect(result).toBe('Unknown Client');
    });

    it('should handle database errors', async () => {
      mockTrx.first.mockRejectedValue(new Error('Database connection failed'));

      await expect(
        getClientCompanyName('client-123', 'tenant-123')
      ).rejects.toThrow('Database connection failed');
    });

    it('should handle company names with special characters', async () => {
      mockTrx.first.mockResolvedValue({
        company_name: 'Acme & Co., Ltd.'
      });

      const result = await getClientCompanyName('client-123', 'tenant-123');

      expect(result).toBe('Acme & Co., Ltd.');
    });

    it('should handle very long company names', async () => {
      const longName = 'A'.repeat(500);
      mockTrx.first.mockResolvedValue({
        company_name: longName
      });

      const result = await getClientCompanyName('client-123', 'tenant-123');

      expect(result).toBe(longName);
    });
  });
});

/**
 * Test suite for TicketModel validation logic
 * This tests the extracted validation logic from server actions
 */

import { describe, test, expect } from 'vitest';
import { 
  TicketModel, 
  validateData,
  cleanNullableFields,
  ticketFormSchema,
  createTicketFromAssetSchema,
  ticketUpdateSchema,
  createCommentSchema
} from '../ticketModel';

describe('TicketModel Validation Logic', () => {
  describe('validateData helper function', () => {
    test('should validate valid data correctly', () => {
      const validData = {
        title: 'Test Ticket',
        channel_id: '123e4567-e89b-12d3-a456-426614174000',
        company_id: '123e4567-e89b-12d3-a456-426614174001',
        contact_name_id: null,
        status_id: '123e4567-e89b-12d3-a456-426614174002',
        assigned_to: null,
        priority_id: '123e4567-e89b-12d3-a456-426614174003',
        description: 'Test description',
        category_id: null,
        subcategory_id: null,
      };

      const result = validateData(ticketFormSchema, validData);
      expect(result).toEqual(validData);
    });

    test('should throw error for invalid UUID', () => {
      const invalidData = {
        title: 'Test Ticket',
        channel_id: 'invalid-uuid',
        company_id: '123e4567-e89b-12d3-a456-426614174001',
        contact_name_id: null,
        status_id: '123e4567-e89b-12d3-a456-426614174002',
        assigned_to: null,
        priority_id: '123e4567-e89b-12d3-a456-426614174003',
        description: 'Test description',
        category_id: null,
        subcategory_id: null,
      };

      expect(() => validateData(ticketFormSchema, invalidData)).toThrow('Channel ID must be a valid UUID');
    });

    test('should throw error for missing required fields', () => {
      const invalidData = {
        channel_id: '123e4567-e89b-12d3-a456-426614174000',
        company_id: '123e4567-e89b-12d3-a456-426614174001',
      };

      expect(() => validateData(ticketFormSchema, invalidData)).toThrow('Title is required');
    });
  });

  describe('cleanNullableFields helper function', () => {
    test('should convert empty strings to null for nullable fields', () => {
      const data = {
        title: 'Test Ticket',
        contact_name_id: '',
        category_id: '',
        subcategory_id: '',
        location_id: '',
        assigned_to: '',
        other_field: 'keep this'
      };

      const result = cleanNullableFields(data);
      
      expect(result).toEqual({
        title: 'Test Ticket',
        contact_name_id: null,
        category_id: null,
        subcategory_id: null,
        location_id: null,
        assigned_to: null,
        other_field: 'keep this'
      });
    });

    test('should preserve non-empty values', () => {
      const data = {
        title: 'Test Ticket',
        contact_name_id: '123e4567-e89b-12d3-a456-426614174000',
        category_id: '123e4567-e89b-12d3-a456-426614174001',
        other_field: 'keep this'
      };

      const result = cleanNullableFields(data);
      
      expect(result).toEqual(data);
    });
  });

  describe('validateCreateTicketInput', () => {
    test('should validate valid ticket input', () => {
      const input = {
        title: 'Test Ticket',
        description: 'Test description',
        company_id: '123e4567-e89b-12d3-a456-426614174000',
        priority_id: '123e4567-e89b-12d3-a456-426614174001'
      };

      const result = TicketModel.validateCreateTicketInput(input);
      
      expect(result.valid).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.errors).toBeUndefined();
    });

    test('should reject empty title', () => {
      const input = {
        title: '',
        description: 'Test description'
      };

      const result = TicketModel.validateCreateTicketInput(input);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Ticket title is required');
    });

    test('should reject missing title', () => {
      const input = {
        description: 'Test description'
      };

      const result = TicketModel.validateCreateTicketInput(input as any);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Ticket title is required');
    });
  });

  describe('validateTicketFormData', () => {
    test('should validate complete form data', () => {
      const formData = {
        title: 'Test Ticket',
        channel_id: '123e4567-e89b-12d3-a456-426614174000',
        company_id: '123e4567-e89b-12d3-a456-426614174001',
        contact_name_id: null,
        status_id: '123e4567-e89b-12d3-a456-426614174002',
        assigned_to: null,
        priority_id: '123e4567-e89b-12d3-a456-426614174003',
        description: 'Test description',
        category_id: null,
        subcategory_id: null,
      };

      const result = TicketModel.validateTicketFormData(formData);
      
      expect(result.valid).toBe(true);
      expect(result.data).toEqual(formData);
    });

    test('should reject invalid form data', () => {
      const formData = {
        title: 'Test Ticket',
        channel_id: 'invalid-uuid',
        company_id: '123e4567-e89b-12d3-a456-426614174001',
      };

      const result = TicketModel.validateTicketFormData(formData);
      
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('Channel ID must be a valid UUID');
    });
  });

  describe('validateCreateTicketFromAssetData', () => {
    test('should validate valid asset ticket data', () => {
      const data = {
        title: 'Asset Ticket',
        description: 'Issue with asset',
        priority_id: '123e4567-e89b-12d3-a456-426614174000',
        asset_id: '123e4567-e89b-12d3-a456-426614174001',
        company_id: '123e4567-e89b-12d3-a456-426614174002'
      };

      const result = TicketModel.validateCreateTicketFromAssetData(data);
      
      expect(result.valid).toBe(true);
      expect(result.data).toEqual(data);
    });

    test('should reject invalid asset ticket data', () => {
      const data = {
        title: 'Asset Ticket',
        description: 'Issue with asset',
        priority_id: 'invalid-uuid',
        asset_id: '123e4567-e89b-12d3-a456-426614174001',
        company_id: '123e4567-e89b-12d3-a456-426614174002'
      };

      const result = TicketModel.validateCreateTicketFromAssetData(data);
      
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('Priority ID must be a valid UUID');
    });
  });

  describe('validateUpdateTicketData', () => {
    test('should validate partial update data', () => {
      const data = {
        title: 'Updated Title',
        priority_id: '123e4567-e89b-12d3-a456-426614174000'
      };

      const result = TicketModel.validateUpdateTicketData(data);
      
      expect(result.valid).toBe(true);
      expect(result.data).toEqual(data);
    });

    test('should allow empty update object', () => {
      const data = {};

      const result = TicketModel.validateUpdateTicketData(data);
      
      expect(result.valid).toBe(true);
      expect(result.data).toEqual(data);
    });

    test('should reject invalid UUID in update', () => {
      const data = {
        priority_id: 'invalid-uuid'
      };

      const result = TicketModel.validateUpdateTicketData(data);
      
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('Priority ID must be a valid UUID');
    });
  });

  describe('validateCreateCommentInput', () => {
    test('should validate valid comment input', () => {
      const input = {
        ticket_id: '123e4567-e89b-12d3-a456-426614174000',
        content: 'This is a test comment',
        is_internal: true,
        author_type: 'internal' as const
      };

      const result = TicketModel.validateCreateCommentInput(input);
      
      expect(result.valid).toBe(true);
      expect(result.data).toEqual(input);
    });

    test('should reject empty content', () => {
      const input = {
        ticket_id: '123e4567-e89b-12d3-a456-426614174000',
        content: '',
        is_internal: true
      };

      const result = TicketModel.validateCreateCommentInput(input);
      
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('Comment content is required');
    });

    test('should reject invalid ticket ID', () => {
      const input = {
        ticket_id: 'invalid-uuid',
        content: 'This is a test comment'
      };

      const result = TicketModel.validateCreateCommentInput(input);
      
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('Ticket ID must be a valid UUID');
    });

    test('should reject invalid author type', () => {
      const input = {
        ticket_id: '123e4567-e89b-12d3-a456-426614174000',
        content: 'This is a test comment',
        author_type: 'invalid' as any
      };

      const result = TicketModel.validateCreateCommentInput(input);
      
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('author_type');
    });
  });

  describe('Validation Schema Integration', () => {
    test('ticketFormSchema should match server action requirements', () => {
      // This test ensures our extracted schema matches what server actions expect
      const validFormData = {
        title: 'Test Ticket',
        channel_id: '123e4567-e89b-12d3-a456-426614174000',
        company_id: '123e4567-e89b-12d3-a456-426614174001',
        location_id: null,
        contact_name_id: null,
        status_id: '123e4567-e89b-12d3-a456-426614174002',
        assigned_to: null,
        priority_id: '123e4567-e89b-12d3-a456-426614174003',
        description: 'Test description',
        category_id: null,
        subcategory_id: null,
      };

      expect(() => validateData(ticketFormSchema, validFormData)).not.toThrow();
    });

    test('createTicketFromAssetSchema should match server action requirements', () => {
      const validAssetData = {
        title: 'Asset Issue',
        description: 'Problem with the asset',
        priority_id: '123e4567-e89b-12d3-a456-426614174000',
        asset_id: '123e4567-e89b-12d3-a456-426614174001',
        company_id: '123e4567-e89b-12d3-a456-426614174002'
      };

      expect(() => validateData(createTicketFromAssetSchema, validAssetData)).not.toThrow();
    });

    test('ticketUpdateSchema should allow partial updates', () => {
      const partialUpdate = {
        title: 'Updated Title'
      };

      expect(() => validateData(ticketUpdateSchema, partialUpdate)).not.toThrow();
    });

    test('createCommentSchema should validate comment requirements', () => {
      const validComment = {
        ticket_id: '123e4567-e89b-12d3-a456-426614174000',
        content: 'This is a comment',
        is_internal: false,
        author_type: 'system' as const
      };

      expect(() => validateData(createCommentSchema, validComment)).not.toThrow();
    });
  });
});
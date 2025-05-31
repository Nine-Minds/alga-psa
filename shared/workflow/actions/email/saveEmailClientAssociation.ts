/**
 * Save email-to-client association
 * This action saves the mapping between an email address and client for future automatic matching
 */

import { WorkflowAction } from '../../core/workflowContext';

export interface SaveEmailClientAssociationInput {
  email: string;
  company_id: string;
  contact_id?: string;
  confidence_score?: number;
  notes?: string;
}

export interface SaveEmailClientAssociationOutput {
  association_id: string;
  email: string;
  company_id: string;
  contact_id?: string;
  created_at: string;
  success: boolean;
}

export const saveEmailClientAssociation: WorkflowAction<SaveEmailClientAssociationInput, SaveEmailClientAssociationOutput> = {
  name: 'save_email_client_association',
  description: 'Save email-to-client mapping for future automatic matching',
  
  async execute(input: SaveEmailClientAssociationInput, context: any): Promise<SaveEmailClientAssociationOutput> {
    const { logger } = context;
    
    try {
      logger.info(`Saving email-client association: ${input.email} -> Company ${input.company_id}`);
      
      // TODO: Implement actual database insertion
      // This would insert or update the email_client_associations table
      
      console.log(`[MOCK] Saving email association:`, {
        email: input.email,
        company_id: input.company_id,
        contact_id: input.contact_id,
        confidence_score: input.confidence_score || 1.0,
        notes: input.notes
      });
      
      // Mock query structure would be:
      // INSERT INTO email_client_associations (
      //   id, tenant, email, company_id, contact_id, 
      //   confidence_score, notes, created_at, updated_at
      // ) VALUES (
      //   gen_random_uuid(), ?, ?, ?, ?, ?, ?, NOW(), NOW()
      // )
      // ON CONFLICT (tenant, email) DO UPDATE SET
      //   company_id = EXCLUDED.company_id,
      //   contact_id = EXCLUDED.contact_id,
      //   confidence_score = EXCLUDED.confidence_score,
      //   notes = EXCLUDED.notes,
      //   updated_at = NOW()
      // RETURNING id, email, company_id, contact_id, created_at
      
      const mockAssociationId = `assoc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const createdAt = new Date().toISOString();
      
      const result: SaveEmailClientAssociationOutput = {
        association_id: mockAssociationId,
        email: input.email,
        company_id: input.company_id,
        contact_id: input.contact_id,
        created_at: createdAt,
        success: true
      };
      
      logger.info(`Email-client association saved successfully: ${result.association_id}`);
      return result;
      
    } catch (error: any) {
      logger.error(`Failed to save email-client association: ${error.message}`);
      throw new Error(`Email association save failed: ${error.message}`);
    }
  }
};
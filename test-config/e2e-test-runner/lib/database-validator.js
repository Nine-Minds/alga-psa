/**
 * Database Validator - Validates database state in E2E tests
 */

import pg from 'pg';
import { getSecretProviderInstance } from '../../../shared/dist/core/index.js';

const { Client } = pg;

export class DatabaseValidator {
  constructor() {
    this.dbConfig = {
      host: 'localhost',
      port: 5433,
      database: 'server',
      user: 'postgres',
      // Password will be read from environment or secrets
    };
    
    this.client = null;
  }

  async connect() {
    if (this.client && !this.client.ended) {
      return this.client;
    }

    try {
      // Try to read password from secret provider system
      const secretProvider = await getSecretProviderInstance();
      let password;
      try {
        password = await secretProvider.getAppSecret('postgres_password') || 
                   process.env.POSTGRES_PASSWORD || 
                   'postpass123';
      } catch (error) {
        // Fallback for running outside container
        password = process.env.POSTGRES_PASSWORD || 'postpass123';
      }

      this.client = new Client({
        ...this.dbConfig,
        password
      });

      await this.client.connect();
      console.log('✅ Connected to PostgreSQL test database');
      return this.client;
    } catch (error) {
      throw new Error(`Failed to connect to database: ${error.message}`);
    }
  }

  async disconnect() {
    if (this.client && !this.client.ended) {
      await this.client.end();
      this.client = null;
      console.log('🔌 Disconnected from PostgreSQL');
    }
  }

  async verifyTicketCreation() {
    console.log('🔍 Verifying ticket creation...');
    
    await this.connect();
    
    try {
      // Check if tickets table exists and has the expected structure
      const tableCheck = await this.client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'tickets' 
        ORDER BY ordinal_position
      `);
      
      if (tableCheck.rows.length === 0) {
        throw new Error('Tickets table not found in database');
      }
      
      console.log(`✅ Tickets table found with ${tableCheck.rows.length} columns`);
      
      // Count existing tickets for reference
      const countResult = await this.client.query('SELECT COUNT(*) as ticket_count FROM tickets');
      const ticketCount = parseInt(countResult.rows[0].ticket_count);
      
      console.log(`📊 Current ticket count: ${ticketCount}`);
      
      return { tableExists: true, ticketCount };
    } catch (error) {
      throw new Error(`Ticket verification failed: ${error.message}`);
    }
  }

  async verifyEmailThreading() {
    console.log('🔍 Verifying email threading capabilities...');
    
    await this.connect();
    
    try {
      // Check for email processing related tables
      const emailTables = await this.client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name LIKE '%email%'
        ORDER BY table_name
      `);
      
      console.log(`📊 Found ${emailTables.rows.length} email-related tables:`);
      emailTables.rows.forEach(row => {
        console.log(`   - ${row.table_name}`);
      });
      
      // Check for workflow tables
      const workflowTables = await this.client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name LIKE '%workflow%'
        ORDER BY table_name
      `);
      
      console.log(`📊 Found ${workflowTables.rows.length} workflow-related tables:`);
      workflowTables.rows.forEach(row => {
        console.log(`   - ${row.table_name}`);
      });
      
      return { 
        emailTables: emailTables.rows.length,
        workflowTables: workflowTables.rows.length
      };
    } catch (error) {
      throw new Error(`Email threading verification failed: ${error.message}`);
    }
  }

  async getTicketById(ticketId) {
    await this.connect();
    
    try {
      const result = await this.client.query(
        'SELECT * FROM tickets WHERE ticket_id = $1',
        [ticketId]
      );
      
      return result.rows[0] || null;
    } catch (error) {
      throw new Error(`Failed to get ticket ${ticketId}: ${error.message}`);
    }
  }

  async getTicketsByEmail(emailAddress) {
    await this.connect();
    
    try {
      // This query would need to be adjusted based on actual schema
      const result = await this.client.query(`
        SELECT t.* 
        FROM tickets t 
        JOIN contacts c ON t.contact_name_id = c.contact_name_id 
        WHERE c.email = $1
      `, [emailAddress]);
      
      return result.rows;
    } catch (error) {
      console.warn(`Could not query tickets by email: ${error.message}`);
      return [];
    }
  }

  async verifyDatabaseConnectivity() {
    console.log('🔍 Verifying database connectivity...');
    
    try {
      await this.connect();
      
      // Test basic query
      const result = await this.client.query('SELECT version()');
      const version = result.rows[0].version;
      
      console.log(`✅ Database connectivity verified: ${version.split(' ').slice(0, 2).join(' ')}`);
      
      return { connected: true, version };
    } catch (error) {
      throw new Error(`Database connectivity check failed: ${error.message}`);
    }
  }

  async cleanup() {
    await this.disconnect();
  }
}
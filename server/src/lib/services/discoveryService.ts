import { IDiscoveryRule, IDiscoveryResult, IConfigurationItem, ICIRelationship } from '../../interfaces/cmdb.interfaces';
import knex from '../db';
import { CMDBService } from './cmdbService';
import { AuditLogger } from '../utils/auditLogger';
import { v4 as uuidv4 } from 'uuid';
import * as dns from 'dns';
import { promisify } from 'util';
import * as ping from 'ping';
import * as snmp from 'snmp-native';
import axios from 'axios';

const dnsResolve = promisify(dns.resolve4);

export class DiscoveryService {
  private cmdbService: CMDBService;
  private auditLogger: AuditLogger;

  constructor() {
    this.cmdbService = new CMDBService();
    this.auditLogger = new AuditLogger();
  }

  async executeDiscoveryRule(ruleId: string, userId: string): Promise<IDiscoveryResult> {
    const rule = await this.getDiscoveryRule(ruleId);
    if (!rule || !rule.active) {
      throw new Error(`Discovery rule ${ruleId} not found or inactive`);
    }

    const sessionId = uuidv4();
    const startTime = Date.now();
    
    const result: IDiscoveryResult = {
      result_id: uuidv4(),
      tenant: rule.tenant,
      rule_id: ruleId,
      discovery_session_id: sessionId,
      discovery_date: new Date(),
      total_items_found: 0,
      items_created: 0,
      items_updated: 0,
      items_skipped: 0,
      items_flagged: 0,
      status: 'in_progress',
      discovered_items: [],
      errors: [],
      execution_time_ms: 0,
      data_processed_mb: 0,
      created_date: new Date()
    };

    try {
      await this.updateRuleLastRun(ruleId, new Date());
      
      switch (rule.rule_type) {
        case 'network_scan':
          await this.executeNetworkScan(rule, result, userId);
          break;
        case 'agent_based':
          await this.executeAgentBasedDiscovery(rule, result, userId);
          break;
        case 'api_integration':
          await this.executeAPIIntegration(rule, result, userId);
          break;
        case 'file_scan':
          await this.executeFileScan(rule, result, userId);
          break;
        case 'database_query':
          await this.executeDatabaseQuery(rule, result, userId);
          break;
        default:
          throw new Error(`Unsupported discovery rule type: ${rule.rule_type}`);
      }

      result.status = 'completed';
      result.execution_time_ms = Date.now() - startTime;
      
      await this.updateRuleSuccessRate(ruleId, true);
      
    } catch (error) {
      result.status = 'failed';
      result.errors.push({
        error_type: 'execution_error',
        error_message: error.message,
        error_count: 1
      });
      
      await this.updateRuleLastError(ruleId, error.message);
      await this.updateRuleSuccessRate(ruleId, false);
    }

    await this.saveDiscoveryResult(result);
    return result;
  }

  private async executeNetworkScan(rule: IDiscoveryRule, result: IDiscoveryResult, userId: string): Promise<void> {
    const config = rule.configuration;
    const ipRanges = config.ip_ranges || ['192.168.1.0/24'];
    const ports = config.ports || [22, 80, 443, 135, 445, 3389, 5985, 5986];
    
    for (const ipRange of ipRanges) {
      const ips = this.expandIPRange(ipRange);
      
      for (const ip of ips) {
        try {
          const isAlive = await this.pingHost(ip);
          if (!isAlive && !config.include_offline) continue;

          const discoveredData: any = {
            ip_address: ip,
            hostname: await this.resolveHostname(ip),
            status: isAlive ? 'online' : 'offline',
            discovered_services: []
          };

          for (const port of ports) {
            if (await this.isPortOpen(ip, port)) {
              const service = this.identifyService(port);
              discoveredData.discovered_services.push({ port, service });
            }
          }

          if (config.snmp_enabled && discoveredData.status === 'online') {
            try {
              const snmpData = await this.getSNMPData(ip, config.snmp_community || 'public');
              Object.assign(discoveredData, snmpData);
            } catch (snmpError) {
              result.errors.push({
                error_type: 'snmp_error',
                error_message: `SNMP failed for ${ip}: ${snmpError.message}`,
                error_count: 1
              });
            }
          }

          await this.processDiscoveredItem(rule, discoveredData, result, userId);
          result.total_items_found++;
          
        } catch (error) {
          result.errors.push({
            error_type: 'network_scan_error',
            error_message: `Error scanning ${ip}: ${error.message}`,
            error_count: 1
          });
        }
      }
    }
  }

  private async executeAgentBasedDiscovery(rule: IDiscoveryRule, result: IDiscoveryResult, userId: string): Promise<void> {
    const config = rule.configuration;
    const agents = config.agent_endpoints || [];
    
    for (const agentUrl of agents) {
      try {
        const response = await axios.get(`${agentUrl}/inventory`, {
          timeout: config.timeout || 30000,
          headers: config.auth_headers || {}
        });

        const inventoryData = response.data;
        
        for (const item of inventoryData) {
          await this.processDiscoveredItem(rule, item, result, userId);
          result.total_items_found++;
        }
        
      } catch (error) {
        result.errors.push({
          error_type: 'agent_error',
          error_message: `Agent ${agentUrl} failed: ${error.message}`,
          error_count: 1
        });
      }
    }
  }

  private async executeAPIIntegration(rule: IDiscoveryRule, result: IDiscoveryResult, userId: string): Promise<void> {
    const config = rule.configuration;
    const apiUrl = config.api_url;
    const method = config.method || 'GET';
    const headers = config.headers || {};
    const authConfig = config.authentication || {};

    try {
      let requestConfig: any = {
        method,
        url: apiUrl,
        headers,
        timeout: config.timeout || 30000
      };

      if (authConfig.type === 'bearer') {
        requestConfig.headers['Authorization'] = `Bearer ${authConfig.token}`;
      } else if (authConfig.type === 'basic') {
        requestConfig.auth = {
          username: authConfig.username,
          password: authConfig.password
        };
      }

      if (method === 'POST' && config.body) {
        requestConfig.data = config.body;
      }

      const response = await axios(requestConfig);
      const items = config.data_path ? this.extractDataByPath(response.data, config.data_path) : response.data;

      for (const item of Array.isArray(items) ? items : [items]) {
        await this.processDiscoveredItem(rule, item, result, userId);
        result.total_items_found++;
      }
      
    } catch (error) {
      result.errors.push({
        error_type: 'api_error',
        error_message: `API integration failed: ${error.message}`,
        error_count: 1
      });
    }
  }

  private async executeFileScan(rule: IDiscoveryRule, result: IDiscoveryResult, userId: string): Promise<void> {
    const config = rule.configuration;
    const filePath = config.file_path;
    const format = config.format || 'json';
    
    try {
      const fs = require('fs').promises;
      const fileContent = await fs.readFile(filePath, 'utf8');
      
      let items: any[];
      
      switch (format.toLowerCase()) {
        case 'json':
          items = JSON.parse(fileContent);
          break;
        case 'csv':
          items = this.parseCSV(fileContent);
          break;
        case 'xml':
          items = this.parseXML(fileContent);
          break;
        default:
          throw new Error(`Unsupported file format: ${format}`);
      }

      for (const item of items) {
        await this.processDiscoveredItem(rule, item, result, userId);
        result.total_items_found++;
      }
      
    } catch (error) {
      result.errors.push({
        error_type: 'file_scan_error',
        error_message: `File scan failed: ${error.message}`,
        error_count: 1
      });
    }
  }

  private async executeDatabaseQuery(rule: IDiscoveryRule, result: IDiscoveryResult, userId: string): Promise<void> {
    const config = rule.configuration;
    const dbConfig = config.database_config;
    const query = config.query;

    try {
      const dbKnex = require('knex')({
        client: dbConfig.type || 'mysql2',
        connection: {
          host: dbConfig.host,
          port: dbConfig.port || 3306,
          user: dbConfig.username,
          password: dbConfig.password,
          database: dbConfig.database
        }
      });

      const items = await dbKnex.raw(query);
      
      for (const item of items[0] || items) {
        await this.processDiscoveredItem(rule, item, result, userId);
        result.total_items_found++;
      }
      
      await dbKnex.destroy();
      
    } catch (error) {
      result.errors.push({
        error_type: 'database_error',
        error_message: `Database query failed: ${error.message}`,
        error_count: 1
      });
    }
  }

  private async processDiscoveredItem(rule: IDiscoveryRule, discoveredData: any, result: IDiscoveryResult, userId: string): Promise<void> {
    try {
      const mappedData = this.mapAttributes(discoveredData, rule.attribute_mapping);
      
      if (!this.passesFilters(mappedData, rule.inclusion_filters, rule.exclusion_filters)) {
        result.items_skipped++;
        result.discovered_items.push({
          action: 'skipped',
          reason: 'Failed filter criteria',
          raw_data: discoveredData
        });
        return;
      }

      const ciType = rule.target_ci_types[0];
      const uniqueKey = this.generateUniqueKey(mappedData, ciType);
      
      const existingCI = await this.findExistingCI(rule.tenant, uniqueKey, ciType);
      
      if (existingCI) {
        await this.handleExistingCI(existingCI, mappedData, rule, result, userId);
      } else {
        await this.createNewCI(mappedData, rule, result, userId);
      }
      
    } catch (error) {
      result.errors.push({
        error_type: 'processing_error',
        error_message: `Failed to process item: ${error.message}`,
        error_count: 1
      });
    }
  }

  private async handleExistingCI(existingCI: IConfigurationItem, mappedData: any, rule: IDiscoveryRule, result: IDiscoveryResult, userId: string): Promise<void> {
    switch (rule.duplicate_handling) {
      case 'merge':
        if (rule.conflict_resolution === 'update_existing') {
          await this.updateExistingCI(existingCI.ci_id, mappedData, userId);
          result.items_updated++;
          result.discovered_items.push({
            ci_id: existingCI.ci_id,
            action: 'updated',
            raw_data: mappedData
          });
        }
        break;
      case 'skip':
        result.items_skipped++;
        result.discovered_items.push({
          ci_id: existingCI.ci_id,
          action: 'skipped',
          reason: 'Duplicate CI exists',
          raw_data: mappedData
        });
        break;
      case 'flag':
        result.items_flagged++;
        result.discovered_items.push({
          ci_id: existingCI.ci_id,
          action: 'flagged',
          reason: 'Potential duplicate',
          raw_data: mappedData
        });
        break;
      default:
        await this.createNewCI(mappedData, rule, result, userId);
        break;
    }
  }

  private async createNewCI(mappedData: any, rule: IDiscoveryRule, result: IDiscoveryResult, userId: string): Promise<void> {
    const ciData: Partial<IConfigurationItem> = {
      tenant: rule.tenant,
      ci_name: mappedData.name || 'Unknown Asset',
      ci_number: this.generateCINumber(rule.tenant),
      ci_type: rule.target_ci_types[0],
      description: mappedData.description || 'Discovered automatically',
      owner: userId,
      custodian: userId,
      technical_attributes: mappedData,
      discovered_by: 'automated',
      discovery_source: rule.rule_name,
      last_discovered: new Date(),
      discovery_status: 'confirmed',
      created_by: userId,
      last_modified_by: userId
    };

    const ci = await this.cmdbService.createConfigurationItem(ciData as IConfigurationItem);
    result.items_created++;
    result.discovered_items.push({
      ci_id: ci.ci_id,
      action: 'created',
      raw_data: mappedData
    });
  }

  private async updateExistingCI(ciId: string, mappedData: any, userId: string): Promise<void> {
    const updateData = {
      technical_attributes: mappedData,
      last_discovered: new Date(),
      last_modified_by: userId,
      updated_date: new Date()
    };

    await knex('configuration_items')
      .where('ci_id', ciId)
      .update(updateData);
  }

  private mapAttributes(data: any, mapping: { [key: string]: string }): any {
    const mapped: any = {};
    
    for (const [sourceField, targetField] of Object.entries(mapping)) {
      if (data[sourceField] !== undefined) {
        mapped[targetField] = data[sourceField];
      }
    }
    
    return { ...data, ...mapped };
  }

  private passesFilters(data: any, inclusionFilters: any, exclusionFilters: any): boolean {
    for (const [field, value] of Object.entries(inclusionFilters)) {
      if (data[field] !== value) return false;
    }
    
    for (const [field, value] of Object.entries(exclusionFilters)) {
      if (data[field] === value) return false;
    }
    
    return true;
  }

  private generateUniqueKey(data: any, ciType: string): string {
    if (data.serial_number) return `${ciType}:${data.serial_number}`;
    if (data.mac_address) return `${ciType}:${data.mac_address}`;
    if (data.ip_address) return `${ciType}:${data.ip_address}`;
    if (data.hostname) return `${ciType}:${data.hostname}`;
    return `${ciType}:${data.name || 'unknown'}`;
  }

  private async findExistingCI(tenant: string, uniqueKey: string, ciType: string): Promise<IConfigurationItem | null> {
    const results = await knex('configuration_items')
      .where('tenant', tenant)
      .where('ci_type', ciType)
      .where(function() {
        this.whereRaw("technical_attributes->>'serial_number' = ?", [uniqueKey.split(':')[1]])
          .orWhereRaw("technical_attributes->>'mac_address' = ?", [uniqueKey.split(':')[1]])
          .orWhereRaw("technical_attributes->>'ip_address' = ?", [uniqueKey.split(':')[1]])
          .orWhereRaw("technical_attributes->>'hostname' = ?", [uniqueKey.split(':')[1]]);
      });
    
    return results[0] || null;
  }

  private generateCINumber(tenant: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `CI-${timestamp}-${random}`.toUpperCase();
  }

  private expandIPRange(cidr: string): string[] {
    const [base, prefixLength] = cidr.split('/');
    const prefix = parseInt(prefixLength, 10);
    const hostBits = 32 - prefix;
    const hostCount = Math.pow(2, hostBits) - 2;
    
    const baseIP = base.split('.').map(Number);
    const baseInt = (baseIP[0] << 24) + (baseIP[1] << 16) + (baseIP[2] << 8) + baseIP[3];
    
    const ips: string[] = [];
    for (let i = 1; i <= Math.min(hostCount, 254); i++) {
      const ip = baseInt + i;
      ips.push([
        (ip >>> 24) & 255,
        (ip >>> 16) & 255,
        (ip >>> 8) & 255,
        ip & 255
      ].join('.'));
    }
    
    return ips;
  }

  private async pingHost(ip: string): Promise<boolean> {
    try {
      const result = await ping.promise.probe(ip, { timeout: 3000 });
      return result.alive;
    } catch {
      return false;
    }
  }

  private async resolveHostname(ip: string): Promise<string> {
    try {
      const hostnames = await dnsResolve(ip);
      return hostnames[0] || ip;
    } catch {
      return ip;
    }
  }

  private async isPortOpen(ip: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const net = require('net');
      const socket = new net.Socket();
      
      socket.setTimeout(3000);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      
      socket.on('error', () => {
        resolve(false);
      });
      
      socket.connect(port, ip);
    });
  }

  private identifyService(port: number): string {
    const commonPorts: { [key: number]: string } = {
      22: 'SSH',
      23: 'Telnet',
      25: 'SMTP',
      53: 'DNS',
      80: 'HTTP',
      110: 'POP3',
      135: 'RPC',
      139: 'NetBIOS',
      143: 'IMAP',
      443: 'HTTPS',
      445: 'SMB',
      993: 'IMAPS',
      995: 'POP3S',
      3389: 'RDP',
      5985: 'WinRM HTTP',
      5986: 'WinRM HTTPS'
    };
    
    return commonPorts[port] || `Unknown:${port}`;
  }

  private async getSNMPData(ip: string, community: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const session = new snmp.Session({ host: ip, community });
      
      const oids = [
        '1.3.6.1.2.1.1.1.0', // sysDescr
        '1.3.6.1.2.1.1.3.0', // sysUpTime
        '1.3.6.1.2.1.1.5.0', // sysName
        '1.3.6.1.2.1.1.6.0'  // sysLocation
      ];
      
      session.get({ oids }, (error, varbinds) => {
        if (error) {
          reject(error);
          return;
        }
        
        const snmpData = {
          system_description: varbinds[0]?.value || '',
          system_uptime: varbinds[1]?.value || 0,
          system_name: varbinds[2]?.value || '',
          system_location: varbinds[3]?.value || ''
        };
        
        resolve(snmpData);
      });
    });
  }

  private extractDataByPath(data: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], data);
  }

  private parseCSV(csvContent: string): any[] {
    const lines = csvContent.split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    
    return lines.slice(1).map(line => {
      const values = line.split(',');
      const obj: any = {};
      headers.forEach((header, index) => {
        obj[header] = values[index]?.trim() || '';
      });
      return obj;
    });
  }

  private parseXML(xmlContent: string): any[] {
    const { parseString } = require('xml2js');
    return new Promise((resolve, reject) => {
      parseString(xmlContent, (err: any, result: any) => {
        if (err) reject(err);
        else resolve(Array.isArray(result) ? result : [result]);
      });
    });
  }

  async scheduleDiscoveryRules(): Promise<void> {
    const scheduledRules = await knex('discovery_rules')
      .where('schedule_enabled', true)
      .where('active', true)
      .whereRaw('next_run <= NOW()');

    for (const rule of scheduledRules) {
      try {
        await this.executeDiscoveryRule(rule.rule_id, rule.created_by);
        
        const nextRun = this.calculateNextRun(rule.schedule_cron);
        await knex('discovery_rules')
          .where('rule_id', rule.rule_id)
          .update({
            next_run: nextRun,
            updated_date: new Date()
          });
          
      } catch (error) {
        console.error(`Failed to execute scheduled discovery rule ${rule.rule_id}:`, error);
      }
    }
  }

  private calculateNextRun(cronExpression: string): Date {
    const cron = require('node-cron');
    const nextDate = new Date();
    nextDate.setMinutes(nextDate.getMinutes() + 60); // Default to 1 hour if cron parsing fails
    return nextDate;
  }

  private async getDiscoveryRule(ruleId: string): Promise<IDiscoveryRule | null> {
    const result = await knex('discovery_rules').where('rule_id', ruleId).first();
    return result || null;
  }

  private async updateRuleLastRun(ruleId: string, date: Date): Promise<void> {
    await knex('discovery_rules')
      .where('rule_id', ruleId)
      .update({
        last_run: date,
        updated_date: new Date()
      });
  }

  private async updateRuleSuccessRate(ruleId: string, success: boolean): Promise<void> {
    const rule = await knex('discovery_rules').where('rule_id', ruleId).first();
    if (!rule) return;

    const totalRuns = await knex('discovery_results')
      .where('rule_id', ruleId)
      .count('* as count');
      
    const successfulRuns = await knex('discovery_results')
      .where('rule_id', ruleId)
      .where('status', 'completed')
      .count('* as count');

    const successRate = ((successfulRuns[0].count as number) / (totalRuns[0].count as number)) * 100;

    await knex('discovery_rules')
      .where('rule_id', ruleId)
      .update({
        success_rate: successRate,
        last_success_date: success ? new Date() : rule.last_success_date,
        updated_date: new Date()
      });
  }

  private async updateRuleLastError(ruleId: string, error: string): Promise<void> {
    await knex('discovery_rules')
      .where('rule_id', ruleId)
      .update({
        last_error: error,
        updated_date: new Date()
      });
  }

  private async saveDiscoveryResult(result: IDiscoveryResult): Promise<void> {
    await knex('discovery_results').insert({
      ...result,
      discovered_items: JSON.stringify(result.discovered_items),
      errors: JSON.stringify(result.errors)
    });
  }
}
/**
 * Automation Service
 * Comprehensive service layer for automation rule management and execution
 * Handles automation rules, executions, templates, and analytics
 */

import {
  CreateAutomationRule,
  UpdateAutomationRule,
  AutomationExecution,
  ManualExecution,
  AutomationTemplate,
  CreateTemplateFromRule,
  AutomationStats,
  PerformanceMetricsRequest,
  AutomationRuleFilter,
  AutomationExecutionFilter,
  TemplateFilter,
  BulkStatusUpdate,
  BulkExecution,
  TriggerType,
  ActionType,
  ExecutionStatus,
  AutomationRuleStatus
} from '@product/api/schemas/automationSchemas';
import { DatabaseService } from './DatabaseService';
import { PaginatedResponse, SuccessResponse } from '@server/lib/types/api';
import { validateTenantAccess } from '@server/lib/utils/validation';
import { EventBusService } from './EventBusService';
import { AuditLogService } from './AuditLogService';

export class AutomationService {
  constructor(
    private db: DatabaseService,
    private eventBus: EventBusService,
    private auditLog: AuditLogService
  ) {}

  // ============================================================================
  // AUTOMATION RULE METHODS
  // ============================================================================

  async createAutomationRule(
    data: CreateAutomationRule,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<any>> {
    await validateTenantAccess(tenantId);

    const ruleId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Validate trigger configuration
    await this.validateTriggerConfig(data.trigger_type, data.trigger_config);

    // Validate action configurations
    for (const action of data.actions) {
      await this.validateActionConfig(action.type, action.config);
    }

    const rule = {
      rule_id: ruleId,
      tenant: tenantId,
      created_by: userId || null,
      created_at: now,
      updated_at: now,
      execution_count: 0,
      last_executed: null,
      ...data
    };

    await this.db.insert('automation_rules', rule);

    // Create trigger record if scheduled
    if (data.trigger_type === 'time_based' && data.status === 'active') {
      await this.scheduleAutomationRule(ruleId, data.trigger_config);
    }

    // Publish event
    await this.eventBus.publish('automation.rule.created', {
      ruleId,
      tenantId,
      ruleName: data.name,
      triggerType: data.trigger_type,
      userId
    });

    // Audit log
    await this.auditLog.log({
      action: 'automation_rule_created',
      entityType: 'automation_rule',
      entityId: ruleId,
      userId,
      tenantId,
      changes: rule
    });

    return {
      success: true,
      data: rule
    };
  }

  async getAutomationRule(
    ruleId: string,
    tenantId: string
  ): Promise<SuccessResponse<any>> {
    await validateTenantAccess(tenantId);

    const rule = await this.db.findOne('automation_rules', {
      rule_id: ruleId,
      tenant: tenantId
    });

    if (!rule) {
      throw new Error('Automation rule not found');
    }

    // Get execution statistics
    const execStats = await this.getExecutionStats(ruleId);
    rule.execution_statistics = execStats;

    return {
      success: true,
      data: rule
    };
  }

  async updateAutomationRule(
    ruleId: string,
    data: UpdateAutomationRule,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<any>> {
    await validateTenantAccess(tenantId);

    const existing = await this.db.findOne('automation_rules', {
      rule_id: ruleId,
      tenant: tenantId
    });

    if (!existing) {
      throw new Error('Automation rule not found');
    }

    // Validate configurations if updated
    if (data.trigger_config) {
      await this.validateTriggerConfig(
        data.trigger_type || existing.trigger_type,
        data.trigger_config
      );
    }

    if (data.actions) {
      for (const action of data.actions) {
        await this.validateActionConfig(action.type, action.config);
      }
    }

    const updated = {
      ...existing,
      ...data,
      updated_at: new Date().toISOString()
    };

    await this.db.update('automation_rules',
      { rule_id: ruleId, tenant: tenantId },
      updated
    );

    // Handle scheduling changes
    if (data.status === 'active' && existing.status !== 'active') {
      await this.scheduleAutomationRule(ruleId, updated.trigger_config);
    } else if (data.status === 'inactive' && existing.status === 'active') {
      await this.unscheduleAutomationRule(ruleId);
    }

    // Publish event
    await this.eventBus.publish('automation.rule.updated', {
      ruleId,
      tenantId,
      ruleName: updated.name,
      changes: data,
      userId
    });

    // Audit log
    await this.auditLog.log({
      action: 'automation_rule_updated',
      entityType: 'automation_rule',
      entityId: ruleId,
      userId,
      tenantId,
      changes: data,
      previousValues: existing
    });

    return {
      success: true,
      data: updated
    };
  }

  async deleteAutomationRule(
    ruleId: string,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<{}>> {
    await validateTenantAccess(tenantId);

    const existing = await this.db.findOne('automation_rules', {
      rule_id: ruleId,
      tenant: tenantId
    });

    if (!existing) {
      throw new Error('Automation rule not found');
    }

    // Check for running executions
    const runningExecutions = await this.db.count('automation_executions', {
      automation_rule_id: ruleId,
      status: ['pending', 'running']
    });

    if (runningExecutions > 0) {
      throw new Error('Cannot delete rule with running executions');
    }

    // Unschedule if active
    if (existing.status === 'active') {
      await this.unscheduleAutomationRule(ruleId);
    }

    await this.db.delete('automation_rules', {
      rule_id: ruleId,
      tenant: tenantId
    });

    // Publish event
    await this.eventBus.publish('automation.rule.deleted', {
      ruleId,
      tenantId,
      ruleName: existing.name,
      userId
    });

    // Audit log
    await this.auditLog.log({
      action: 'automation_rule_deleted',
      entityType: 'automation_rule',
      entityId: ruleId,
      userId,
      tenantId,
      previousValues: existing
    });

    return { success: true, data: {} };
  }

  async listAutomationRules(
    filters: AutomationRuleFilter,
    tenantId: string,
    page: number = 1,
    limit: number = 25
  ): Promise<PaginatedResponse<any[]>> {
    await validateTenantAccess(tenantId);

    const conditions = { tenant: tenantId, ...filters };
    const offset = (page - 1) * limit;

    const [rules, total] = await Promise.all([
      this.db.findMany('automation_rules', conditions, {
        limit,
        offset,
        orderBy: { created_at: 'desc' }
      }),
      this.db.count('automation_rules', conditions)
    ]);

    return {
      success: true,
      data: rules,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  // ============================================================================
  // AUTOMATION EXECUTION METHODS
  // ============================================================================

  async executeAutomationRule(
    ruleId: string,
    executionData: ManualExecution,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<AutomationExecution>> {
    await validateTenantAccess(tenantId);

    const rule = await this.db.findOne('automation_rules', {
      rule_id: ruleId,
      tenant: tenantId
    });

    if (!rule) {
      throw new Error('Automation rule not found');
    }

    if (rule.status !== 'active' && !executionData.override_conditions) {
      throw new Error('Automation rule is not active');
    }

    const executionId = crypto.randomUUID();
    const now = new Date().toISOString();

    const execution: AutomationExecution = {
      execution_id: executionId,
      automation_rule_id: ruleId,
      trigger_data: executionData.execution_data || {},
      status: executionData.dry_run ? 'completed' : 'pending',
      started_at: now,
      completed_at: executionData.dry_run ? now : undefined,
      duration_ms: executionData.dry_run ? 0 : undefined,
      actions_total: rule.actions.length,
      actions_successful: 0,
      actions_failed: 0,
      execution_context: {
        manual_execution: true,
        triggered_by: userId,
        dry_run: executionData.dry_run || false
      },
      logs: [],
      tenant: tenantId
    };

    await this.db.insert('automation_executions', execution);

    if (!executionData.dry_run) {
      // Queue for execution
      await this.queueExecution(executionId);
    }

    // Update rule execution count and last executed
    await this.db.update('automation_rules',
      { rule_id: ruleId },
      {
        execution_count: (rule.execution_count || 0) + 1,
        last_executed: now
      }
    );

    // Publish event
    await this.eventBus.publish('automation.execution.started', {
      executionId,
      ruleId,
      tenantId,
      dryRun: executionData.dry_run,
      userId
    });

    // Audit log
    await this.auditLog.log({
      action: 'automation_execution_started',
      entityType: 'automation_execution',
      entityId: executionId,
      userId,
      tenantId,
      changes: { manual: true, dry_run: executionData.dry_run }
    });

    return {
      success: true,
      data: execution
    };
  }

  async getAutomationExecution(
    executionId: string,
    tenantId: string
  ): Promise<SuccessResponse<AutomationExecution>> {
    await validateTenantAccess(tenantId);

    const execution = await this.db.findOne('automation_executions', {
      execution_id: executionId,
      tenant: tenantId
    });

    if (!execution) {
      throw new Error('Automation execution not found');
    }

    return {
      success: true,
      data: execution as AutomationExecution
    };
  }

  async listAutomationExecutions(
      filters: AutomationExecutionFilter,
      tenantId: string,
      page: number = 1,
      limit: number = 25
    ): Promise<PaginatedResponse<AutomationExecution[]>> {
      await validateTenantAccess(tenantId);
  
      const conditions = { tenant: tenantId, ...filters };
      const offset = (page - 1) * limit;
  
      const [executions, total] = await Promise.all([
        this.db.findMany('automation_executions', conditions, {
          limit,
          offset,
          orderBy: { started_at: 'desc' }
        }),
        this.db.count('automation_executions', conditions)
      ]);
  
      return {
        success: true,
        data: [executions as AutomationExecution[]],
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      };
    }


  async retryAutomationExecution(
    executionId: string,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<AutomationExecution>> {
    await validateTenantAccess(tenantId);

    const execution = await this.db.findOne('automation_executions', {
      execution_id: executionId,
      tenant: tenantId
    });

    if (!execution) {
      throw new Error('Automation execution not found');
    }

    if (execution.status !== 'failed') {
      throw new Error('Only failed executions can be retried');
    }

    // Reset execution state
    const updated = {
      ...execution,
      status: 'pending' as ExecutionStatus,
      started_at: new Date().toISOString(),
      completed_at: undefined,
      duration_ms: undefined,
      error_message: undefined,
      error_stack: undefined,
      actions_successful: 0,
      actions_failed: 0
    };

    await this.db.update('automation_executions',
      { execution_id: executionId, tenant: tenantId },
      updated
    );

    // Queue for execution
    await this.queueExecution(executionId);

    // Publish event
    await this.eventBus.publish('automation.execution.retried', {
      executionId,
      tenantId,
      userId
    });

    return {
      success: true,
      data: updated as AutomationExecution
    };
  }

  // ============================================================================
  // AUTOMATION TEMPLATE METHODS
  // ============================================================================

  async createAutomationTemplate(
      data: CreateTemplateFromRule,
      tenantId: string,
      userId?: string
    ): Promise<SuccessResponse<AutomationTemplate>> {
      await validateTenantAccess(tenantId);
  
      const rule = await this.db.findOne('automation_rules', {
        rule_id: data.automation_rule_id,
        tenant: tenantId
      });
  
      if (!rule) {
        throw new Error('Automation rule not found');
      }
  
      const templateId = crypto.randomUUID();
      const now = new Date().toISOString();
  
      const template: AutomationTemplate = {
        template_id: templateId,
        name: data.template_name,
        description: data.template_description,
        category: data.category,
        icon: undefined,
        template_config: {
          ...rule,
          rule_id: undefined,
          tenant: undefined,
          created_by: undefined,
          created_at: undefined,
          updated_at: undefined,
          execution_count: undefined,
          last_executed: undefined
        },
        version: '1.0.0',
        author: userId,
        compatible_versions: [],
        required_permissions: [],
        usage_count: 0,
        last_used: undefined,
        template_variables: (data.template_variables || []).map(variable => ({
          name: variable.variable_name,
          type: variable.type,
          display_name: variable.display_name,
          required: variable.required,
          description: variable.description
        })),
        is_active: true,
        is_featured: false,
        tenant: tenantId
      };
  
      await this.db.insert('automation_templates', template);
  
      // Publish event
      await this.eventBus.publish('automation.template.created', {
        templateId,
        tenantId,
        templateName: data.template_name,
        sourceRuleId: data.automation_rule_id,
        userId
      });
  
      // Audit log
      await this.auditLog.log({
        action: 'automation_template_created',
        entityType: 'automation_template',
        entityId: templateId,
        userId,
        tenantId,
        changes: template
      });
  
      return {
        success: true,
        data: template
      };
    }


  async getAutomationTemplate(
    templateId: string,
    tenantId: string
  ): Promise<SuccessResponse<AutomationTemplate>> {
    await validateTenantAccess(tenantId);

    const template = await this.db.findOne('automation_templates', {
      template_id: templateId,
      tenant: tenantId
    });

    if (!template) {
      throw new Error('Automation template not found');
    }

    return {
      success: true,
      data: template as AutomationTemplate
    };
  }

  async listAutomationTemplates(
      filters: TemplateFilter,
      tenantId: string,
      page: number = 1,
      limit: number = 25
    ): Promise<PaginatedResponse<AutomationTemplate[]>> {
      await validateTenantAccess(tenantId);
  
      const conditions = { tenant: tenantId, ...filters };
      const offset = (page - 1) * limit;
  
      const [templates, total] = await Promise.all([
        this.db.findMany('automation_templates', conditions, {
          limit,
          offset,
          orderBy: { created_at: 'desc' }
        }),
        this.db.count('automation_templates', conditions)
      ]);
  
      return {
        success: true,
        data: [templates as AutomationTemplate[]],
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      };
    }


  async createRuleFromTemplate(
    templateId: string,
    variables: Record<string, any>,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<any>> {
    await validateTenantAccess(tenantId);

    const template = await this.db.findOne('automation_templates', {
      template_id: templateId,
      tenant: tenantId
    });

    if (!template) {
      throw new Error('Automation template not found');
    }

    // Apply template variables to configuration
    const ruleData = this.applyTemplateVariables(template.template_config, variables);

    // Create automation rule
    const result = await this.createAutomationRule(ruleData, tenantId, userId);

    // Update template usage count
    await this.db.update('automation_templates',
      { template_id: templateId },
      {
        usage_count: (template.usage_count || 0) + 1,
        last_used: new Date().toISOString()
      }
    );

    return result;
  }

  // ============================================================================
  // ANALYTICS AND STATISTICS METHODS
  // ============================================================================

  async getAutomationStatistics(
    tenantId: string
  ): Promise<SuccessResponse<AutomationStats>> {
    await validateTenantAccess(tenantId);

    const [
      totalRules,
      activeRules,
      inactiveRules,
      draftRules,
      errorRules,
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      executionsToday,
      executionsThisWeek,
      executionsThisMonth
    ] = await Promise.all([
      this.db.count('automation_rules', { tenant: tenantId }),
      this.db.count('automation_rules', { tenant: tenantId, status: 'active' }),
      this.db.count('automation_rules', { tenant: tenantId, status: 'inactive' }),
      this.db.count('automation_rules', { tenant: tenantId, status: 'draft' }),
      this.db.count('automation_rules', { tenant: tenantId, status: 'error' }),
      this.db.count('automation_executions', { tenant: tenantId }),
      this.db.count('automation_executions', { tenant: tenantId, status: 'completed' }),
      this.db.count('automation_executions', { tenant: tenantId, status: 'failed' }),
      this.getExecutionCountForPeriod(tenantId, 'today'),
      this.getExecutionCountForPeriod(tenantId, 'week'),
      this.getExecutionCountForPeriod(tenantId, 'month')
    ]);

    const avgExecutionTime = await this.getAverageExecutionTime(tenantId);
    const successRate = totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0;

    const stats: AutomationStats = {
      total_rules: totalRules,
      active_rules: activeRules,
      inactive_rules: inactiveRules,
      draft_rules: draftRules,
      error_rules: errorRules,
      total_executions: totalExecutions,
      successful_executions: successfulExecutions,
      failed_executions: failedExecutions,
      executions_today: executionsToday,
      executions_this_week: executionsThisWeek,
      executions_this_month: executionsThisMonth,
      avg_execution_time_ms: avgExecutionTime,
      success_rate_percent: Math.round(successRate * 100) / 100
    };

    return {
      success: true,
      data: stats
    };
  }

  async getPerformanceMetrics(
    request: PerformanceMetricsRequest,
    tenantId: string
  ): Promise<SuccessResponse<any>> {
    await validateTenantAccess(tenantId);

    const metrics = await this.calculatePerformanceMetrics(request, tenantId);

    return {
      success: true,
      data: metrics
    };
  }

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

  async bulkUpdateStatus(
      data: BulkStatusUpdate,
      tenantId: string,
      userId?: string
    ): Promise<SuccessResponse<{ updated: number; errors: string[] }>> {
      await validateTenantAccess(tenantId);
  
      const results = { updated: 0, errors: [] as string[] };
  
      for (const ruleId of data.ids) {
        try {
          await this.updateAutomationRule(ruleId, { status: data.status }, tenantId, userId);
          results.updated++;
        } catch (error) {
          results.errors.push(`${ruleId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
  
      return {
        success: true,
        data: results
      };
    }


  async bulkExecute(
      data: BulkExecution,
      tenantId: string,
      userId?: string
    ): Promise<SuccessResponse<{ started: number; errors: string[] }>> {
      await validateTenantAccess(tenantId);
  
      const results = { started: 0, errors: [] as string[] };
  
      const executeRule = async (ruleId: string) => {
        try {
          await this.executeAutomationRule(
            ruleId,
            {
              automation_rule_id: ruleId,
              execution_data: data.execution_data,
              override_conditions: data.override_conditions,
              dry_run: false
            },
            tenantId,
            userId
          );
          results.started++;
        } catch (error) {
          results.errors.push(`${ruleId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      };
  
      if (data.sequential_execution) {
        for (const ruleId of data.automation_rule_ids) {
          await executeRule(ruleId);
        }
      } else {
        await Promise.all(
          data.automation_rule_ids.map(executeRule)
        );
      }
  
      return {
        success: true,
        data: results
      };
    }


  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private async validateTriggerConfig(triggerType: TriggerType, config: any): Promise<void> {
    // Implement trigger configuration validation
    switch (triggerType) {
      case 'time_based':
        if (!config.schedule_type) {
          throw new Error('Schedule type is required for time-based triggers');
        }
        break;
      case 'event_based':
        if (!config.event_type) {
          throw new Error('Event type is required for event-based triggers');
        }
        break;
      // Add other validations
    }
  }

  private async validateActionConfig(actionType: ActionType, config: any): Promise<void> {
    // Implement action configuration validation
    switch (actionType) {
      case 'email_notification':
        if (!config.to || config.to.length === 0) {
          throw new Error('Recipients are required for email notifications');
        }
        break;
      case 'webhook_call':
        if (!config.url) {
          throw new Error('URL is required for webhook calls');
        }
        break;
      // Add other validations
    }
  }

  private async scheduleAutomationRule(ruleId: string, triggerConfig: any): Promise<void> {
    // Implement scheduling logic
    // This would integrate with a job scheduler
  }

  private async unscheduleAutomationRule(ruleId: string): Promise<void> {
    // Implement unscheduling logic
    // This would remove from job scheduler
  }

  private async queueExecution(executionId: string): Promise<void> {
    // Implement execution queuing logic
    // This would add to execution queue
  }

  private async getExecutionStats(ruleId: string): Promise<any> {
    const [total, successful, failed] = await Promise.all([
      this.db.count('automation_executions', { automation_rule_id: ruleId }),
      this.db.count('automation_executions', { automation_rule_id: ruleId, status: 'completed' }),
      this.db.count('automation_executions', { automation_rule_id: ruleId, status: 'failed' })
    ]);

    return {
      total_executions: total,
      successful_executions: successful,
      failed_executions: failed,
      success_rate: total > 0 ? (successful / total) * 100 : 0
    };
  }

  private async getExecutionCountForPeriod(tenantId: string, period: 'today' | 'week' | 'month'): Promise<number> {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }

    return this.db.count('automation_executions', {
      tenant: tenantId,
      started_at: { gte: startDate.toISOString() }
    });
  }

  private async getAverageExecutionTime(tenantId: string): Promise<number | undefined> {
    // This would calculate average execution time from database
    // Implementation depends on database capabilities
    return undefined;
  }

  private async calculatePerformanceMetrics(
    request: PerformanceMetricsRequest,
    tenantId: string
  ): Promise<any> {
    // Mock implementation - would calculate actual performance metrics
    return {
      period: {
        from: request.date_from,
        to: request.date_to
      },
      metrics: request.metrics || ['execution_count'],
      data: []
    };
  }

  private applyTemplateVariables(templateConfig: any, variables: Record<string, any>): any {
    // Deep clone the template config
    const config = JSON.parse(JSON.stringify(templateConfig));

    // Apply variable substitution
    const applyVariables = (obj: any): any => {
      if (typeof obj === 'string') {
        return obj.replace(/\{\{(\w+)\}\}/g, (match, key) => {
          return variables[key] !== undefined ? variables[key] : match;
        });
      }
      
      if (Array.isArray(obj)) {
        return obj.map(applyVariables);
      }
      
      if (obj && typeof obj === 'object') {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = applyVariables(value);
        }
        return result;
      }
      
      return obj;
    };

    return applyVariables(config);
  }
}
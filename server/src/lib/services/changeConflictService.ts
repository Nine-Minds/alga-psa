import { Knex } from 'knex';
import { IChangeRequest } from '../../interfaces/change.interfaces';

export interface IChangeConflict {
  conflict_id: string;
  change_id: string;
  conflicting_change_id: string;
  conflict_type: 'resource' | 'dependency' | 'timing' | 'service_overlap' | 'team_capacity';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  auto_detected: boolean;
  resolved: boolean;
  resolution_type?: 'schedule_adjustment' | 'resource_reallocation' | 'dependency_reorder' | 'manual_override';
  resolution_notes?: string;
  resolved_by?: string;
  resolved_at?: Date;
  detected_at: Date;
  tenant: string;
}

export interface IConflictResolution {
  resolution_id: string;
  conflict_id: string;
  resolution_type: string;
  description: string;
  impact_assessment: string;
  stakeholder_approval_required: boolean;
  implementation_steps: string[];
  rollback_plan?: string;
  created_by: string;
  created_at: Date;
  status: 'proposed' | 'approved' | 'implemented' | 'rejected';
}

export class ChangeConflictService {
  constructor(private knex: Knex) {}

  /**
   * Detect all types of conflicts for a change request
   */
  async detectConflicts(changeRequest: Partial<IChangeRequest>): Promise<IChangeConflict[]> {
    try {
      const conflicts: IChangeConflict[] = [];

      // Get all active changes to check against
      const activeChanges = await this.getActiveChanges(changeRequest.tenant!, changeRequest.change_id);

      // Detect different types of conflicts
      conflicts.push(...await this.detectResourceConflicts(changeRequest, activeChanges));
      conflicts.push(...await this.detectTimingConflicts(changeRequest, activeChanges));
      conflicts.push(...await this.detectServiceOverlapConflicts(changeRequest, activeChanges));
      conflicts.push(...await this.detectDependencyConflicts(changeRequest, activeChanges));
      conflicts.push(...await this.detectTeamCapacityConflicts(changeRequest, activeChanges));

      // Store detected conflicts
      for (const conflict of conflicts) {
        await this.recordConflict(conflict);
      }

      return conflicts;

    } catch (error) {
      console.error('Error detecting conflicts:', error);
      throw error;
    }
  }

  /**
   * Detect resource conflicts between changes
   */
  private async detectResourceConflicts(
    changeRequest: Partial<IChangeRequest>,
    activeChanges: any[]
  ): Promise<IChangeConflict[]> {
    const conflicts: IChangeConflict[] = [];

    if (!changeRequest.affected_services || !changeRequest.scheduled_start_date) return conflicts;

    const requestedResources = Array.isArray(changeRequest.affected_services)
      ? changeRequest.affected_services
      : JSON.parse(changeRequest.affected_services || '[]');

    const changeStart = new Date(changeRequest.scheduled_start_date);
    const changeEnd = new Date(changeRequest.scheduled_end_date || 
      new Date(changeStart.getTime() + (changeRequest.estimated_duration || 2) * 60 * 60 * 1000));

    for (const activeChange of activeChanges) {
      if (!activeChange.affected_services || !activeChange.scheduled_start_date) continue;

      const activeResources = Array.isArray(activeChange.affected_services)
        ? activeChange.affected_services
        : JSON.parse(activeChange.affected_services || '[]');

      const activeStart = new Date(activeChange.scheduled_start_date);
      const activeEnd = new Date(activeChange.scheduled_end_date);

      // Check for time overlap
      const hasTimeOverlap = this.timeRangesOverlap(changeStart, changeEnd, activeStart, activeEnd);

      if (hasTimeOverlap) {
        // Check for resource overlap
        const overlappingResources = requestedResources.filter(resource => 
          activeResources.includes(resource)
        );

        if (overlappingResources.length > 0) {
          const severity = this.calculateResourceConflictSeverity(overlappingResources, activeChange);
          
          conflicts.push({
            conflict_id: this.generateConflictId(),
            change_id: changeRequest.change_id!,
            conflicting_change_id: activeChange.change_id,
            conflict_type: 'resource',
            severity,
            description: `Resource conflict on: ${overlappingResources.join(', ')}. Conflicting with ${activeChange.change_number}`,
            auto_detected: true,
            resolved: false,
            detected_at: new Date(),
            tenant: changeRequest.tenant!
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Detect timing conflicts (blackout periods, maintenance windows)
   */
  private async detectTimingConflicts(
    changeRequest: Partial<IChangeRequest>,
    activeChanges: any[]
  ): Promise<IChangeConflict[]> {
    const conflicts: IChangeConflict[] = [];

    if (!changeRequest.scheduled_start_date) return conflicts;

    const changeStart = new Date(changeRequest.scheduled_start_date);
    const changeEnd = new Date(changeRequest.scheduled_end_date || 
      new Date(changeStart.getTime() + (changeRequest.estimated_duration || 2) * 60 * 60 * 1000));

    // Check against blackout periods
    const blackoutPeriods = await this.knex('change_windows')
      .where('tenant', changeRequest.tenant)
      .whereIn('window_type', ['blackout', 'freeze'])
      .where(function() {
        this.whereBetween('start_time', [changeStart, changeEnd])
          .orWhereBetween('end_time', [changeStart, changeEnd])
          .orWhere(function() {
            this.where('start_time', '<=', changeStart)
              .andWhere('end_time', '>=', changeEnd);
          });
      });

    for (const blackout of blackoutPeriods) {
      conflicts.push({
        conflict_id: this.generateConflictId(),
        change_id: changeRequest.change_id!,
        conflicting_change_id: blackout.id,
        conflict_type: 'timing',
        severity: blackout.window_type === 'blackout' ? 'critical' : 'high',
        description: `Change scheduled during ${blackout.window_type} period: ${blackout.title}`,
        auto_detected: true,
        resolved: false,
        detected_at: new Date(),
        tenant: changeRequest.tenant!
      });
    }

    // Check for too many concurrent changes
    const concurrentChanges = activeChanges.filter(change => {
      if (!change.scheduled_start_date) return false;
      const activeStart = new Date(change.scheduled_start_date);
      const activeEnd = new Date(change.scheduled_end_date);
      return this.timeRangesOverlap(changeStart, changeEnd, activeStart, activeEnd);
    });

    const maxConcurrentChanges = await this.getMaxConcurrentChanges(changeRequest.tenant!);
    if (concurrentChanges.length >= maxConcurrentChanges) {
      conflicts.push({
        conflict_id: this.generateConflictId(),
        change_id: changeRequest.change_id!,
        conflicting_change_id: 'system',
        conflict_type: 'timing',
        severity: 'medium',
        description: `Too many concurrent changes (${concurrentChanges.length}/${maxConcurrentChanges}). Consider rescheduling.`,
        auto_detected: true,
        resolved: false,
        detected_at: new Date(),
        tenant: changeRequest.tenant!
      });
    }

    return conflicts;
  }

  /**
   * Detect service overlap conflicts
   */
  private async detectServiceOverlapConflicts(
    changeRequest: Partial<IChangeRequest>,
    activeChanges: any[]
  ): Promise<IChangeConflict[]> {
    const conflicts: IChangeConflict[] = [];

    if (!changeRequest.affected_services) return conflicts;

    const requestedServices = Array.isArray(changeRequest.affected_services)
      ? changeRequest.affected_services
      : JSON.parse(changeRequest.affected_services || '[]');

    // Get service dependencies
    const serviceDependencies = await this.getServiceDependencies(requestedServices);

    for (const activeChange of activeChanges) {
      if (!activeChange.affected_services) continue;

      const activeServices = Array.isArray(activeChange.affected_services)
        ? activeChange.affected_services
        : JSON.parse(activeChange.affected_services || '[]');

      // Check for dependent service conflicts
      const dependentConflicts = serviceDependencies.filter(dep => 
        activeServices.includes(dep.dependent_service)
      );

      if (dependentConflicts.length > 0) {
        const severity = this.calculateServiceConflictSeverity(dependentConflicts, activeChange);
        
        conflicts.push({
          conflict_id: this.generateConflictId(),
          change_id: changeRequest.change_id!,
          conflicting_change_id: activeChange.change_id,
          conflict_type: 'service_overlap',
          severity,
          description: `Service dependency conflict with ${activeChange.change_number}. Dependent services: ${dependentConflicts.map(d => d.dependent_service).join(', ')}`,
          auto_detected: true,
          resolved: false,
          detected_at: new Date(),
          tenant: changeRequest.tenant!
        });
      }
    }

    return conflicts;
  }

  /**
   * Detect dependency conflicts
   */
  private async detectDependencyConflicts(
    changeRequest: Partial<IChangeRequest>,
    activeChanges: any[]
  ): Promise<IChangeConflict[]> {
    const conflicts: IChangeConflict[] = [];

    if (!changeRequest.dependencies) return conflicts;

    const dependencies = Array.isArray(changeRequest.dependencies)
      ? changeRequest.dependencies
      : JSON.parse(changeRequest.dependencies || '[]');

    for (const dependency of dependencies) {
      const dependentChange = activeChanges.find(change => change.change_id === dependency);
      
      if (dependentChange) {
        // Check if dependent change is scheduled after this change
        if (changeRequest.scheduled_start_date && dependentChange.scheduled_start_date) {
          const thisStart = new Date(changeRequest.scheduled_start_date);
          const depStart = new Date(dependentChange.scheduled_start_date);
          
          if (thisStart < depStart) {
            conflicts.push({
              conflict_id: this.generateConflictId(),
              change_id: changeRequest.change_id!,
              conflicting_change_id: dependentChange.change_id,
              conflict_type: 'dependency',
              severity: 'high',
              description: `Dependency violation: This change depends on ${dependentChange.change_number} which is scheduled later`,
              auto_detected: true,
              resolved: false,
              detected_at: new Date(),
              tenant: changeRequest.tenant!
            });
          }
        }
      }
    }

    return conflicts;
  }

  /**
   * Detect team capacity conflicts
   */
  private async detectTeamCapacityConflicts(
    changeRequest: Partial<IChangeRequest>,
    activeChanges: any[]
  ): Promise<IChangeConflict[]> {
    const conflicts: IChangeConflict[] = [];

    if (!changeRequest.scheduled_start_date) return conflicts;

    // Get team capacity for the scheduled time
    const teamCapacity = await this.getTeamCapacity(
      changeRequest.tenant!,
      new Date(changeRequest.scheduled_start_date)
    );

    // Calculate current utilization
    const currentUtilization = await this.calculateTeamUtilization(
      changeRequest.tenant!,
      changeRequest.scheduled_start_date,
      changeRequest.scheduled_end_date || new Date(
        new Date(changeRequest.scheduled_start_date).getTime() + 
        (changeRequest.estimated_duration || 2) * 60 * 60 * 1000
      )
    );

    const utilizationThreshold = 0.8; // 80% capacity threshold
    if (currentUtilization.percentage > utilizationThreshold) {
      conflicts.push({
        conflict_id: this.generateConflictId(),
        change_id: changeRequest.change_id!,
        conflicting_change_id: 'team_capacity',
        conflict_type: 'team_capacity',
        severity: currentUtilization.percentage > 0.95 ? 'high' : 'medium',
        description: `Team capacity conflict: ${Math.round(currentUtilization.percentage * 100)}% utilization (threshold: ${Math.round(utilizationThreshold * 100)}%)`,
        auto_detected: true,
        resolved: false,
        detected_at: new Date(),
        tenant: changeRequest.tenant!
      });
    }

    return conflicts;
  }

  /**
   * Propose resolution strategies for conflicts
   */
  async proposeResolutions(conflictId: string): Promise<IConflictResolution[]> {
    try {
      const conflict = await this.knex('change_conflicts')
        .where('conflict_id', conflictId)
        .first();

      if (!conflict) {
        throw new Error('Conflict not found');
      }

      const resolutions: Partial<IConflictResolution>[] = [];

      switch (conflict.conflict_type) {
        case 'resource':
          resolutions.push(...this.proposeResourceResolutions(conflict));
          break;
        case 'timing':
          resolutions.push(...this.proposeTimingResolutions(conflict));
          break;
        case 'service_overlap':
          resolutions.push(...this.proposeServiceResolutions(conflict));
          break;
        case 'dependency':
          resolutions.push(...this.proposeDependencyResolutions(conflict));
          break;
        case 'team_capacity':
          resolutions.push(...this.proposeCapacityResolutions(conflict));
          break;
      }

      // Store resolution proposals
      const storedResolutions: IConflictResolution[] = [];
      for (const resolution of resolutions) {
        const stored = await this.storeResolutionProposal(conflictId, resolution);
        storedResolutions.push(stored);
      }

      return storedResolutions;

    } catch (error) {
      console.error('Error proposing resolutions:', error);
      throw error;
    }
  }

  /**
   * Propose resource conflict resolutions
   */
  private proposeResourceResolutions(conflict: any): Partial<IConflictResolution>[] {
    return [
      {
        resolution_type: 'schedule_adjustment',
        description: 'Reschedule one of the conflicting changes to a different time window',
        impact_assessment: 'Low impact - no resource changes required',
        stakeholder_approval_required: false,
        implementation_steps: [
          'Identify alternative time slots for both changes',
          'Compare business impact of rescheduling each change',
          'Select optimal rescheduling option',
          'Update change schedule and notify stakeholders'
        ]
      },
      {
        resolution_type: 'resource_reallocation',
        description: 'Allocate additional resources to avoid conflict',
        impact_assessment: 'Medium impact - additional resources may increase cost',
        stakeholder_approval_required: true,
        implementation_steps: [
          'Identify alternative resources that can be used',
          'Assess cost impact of additional resources',
          'Get approval for resource allocation',
          'Update change plans with new resource assignments'
        ]
      },
      {
        resolution_type: 'manual_override',
        description: 'Accept the risk and proceed with manual coordination',
        impact_assessment: 'High risk - requires careful coordination during implementation',
        stakeholder_approval_required: true,
        implementation_steps: [
          'Document coordination requirements',
          'Assign dedicated coordinators for both changes',
          'Establish communication protocols',
          'Create joint implementation plan'
        ]
      }
    ];
  }

  /**
   * Propose timing conflict resolutions
   */
  private proposeTimingResolutions(conflict: any): Partial<IConflictResolution>[] {
    return [
      {
        resolution_type: 'schedule_adjustment',
        description: 'Move change to next available maintenance window',
        impact_assessment: 'Low to medium impact depending on urgency',
        stakeholder_approval_required: false,
        implementation_steps: [
          'Identify next suitable maintenance window',
          'Assess business impact of delay',
          'Update change schedule',
          'Notify all stakeholders of new timing'
        ]
      },
      {
        resolution_type: 'manual_override',
        description: 'Request exception approval for blackout period',
        impact_assessment: 'High risk - requires executive approval',
        stakeholder_approval_required: true,
        implementation_steps: [
          'Prepare business case for exception',
          'Get approval from change management board',
          'Implement enhanced monitoring and rollback procedures',
          'Document exception rationale'
        ]
      }
    ];
  }

  /**
   * Propose service overlap resolutions
   */
  private proposeServiceResolutions(conflict: any): Partial<IConflictResolution>[] {
    return [
      {
        resolution_type: 'dependency_reorder',
        description: 'Reorder changes to respect service dependencies',
        impact_assessment: 'Medium impact - may affect multiple change schedules',
        stakeholder_approval_required: true,
        implementation_steps: [
          'Map complete service dependency chain',
          'Determine optimal change sequence',
          'Update all affected change schedules',
          'Coordinate with all change owners'
        ]
      },
      {
        resolution_type: 'schedule_adjustment',
        description: 'Schedule changes sequentially with buffer time',
        impact_assessment: 'Low to medium impact - extends overall timeline',
        stakeholder_approval_required: false,
        implementation_steps: [
          'Calculate required buffer time between changes',
          'Adjust schedules to include buffers',
          'Update implementation plans',
          'Notify stakeholders of schedule changes'
        ]
      }
    ];
  }

  /**
   * Propose dependency conflict resolutions
   */
  private proposeDependencyResolutions(conflict: any): Partial<IConflictResolution>[] {
    return [
      {
        resolution_type: 'dependency_reorder',
        description: 'Reorder changes to respect dependencies',
        impact_assessment: 'High impact - affects change sequence and timing',
        stakeholder_approval_required: true,
        implementation_steps: [
          'Review complete dependency chain',
          'Reschedule dependent change to follow prerequisite',
          'Update all related schedules',
          'Coordinate with all affected teams'
        ]
      },
      {
        resolution_type: 'manual_override',
        description: 'Remove or modify dependency relationship',
        impact_assessment: 'High risk - requires careful analysis',
        stakeholder_approval_required: true,
        implementation_steps: [
          'Analyze if dependency is truly required',
          'Assess risks of removing dependency',
          'Get approval from technical authority',
          'Update change plans to handle independent implementation'
        ]
      }
    ];
  }

  /**
   * Propose capacity conflict resolutions
   */
  private proposeCapacityResolutions(conflict: any): Partial<IConflictResolution>[] {
    return [
      {
        resolution_type: 'schedule_adjustment',
        description: 'Reschedule to period with lower team utilization',
        impact_assessment: 'Low to medium impact depending on urgency',
        stakeholder_approval_required: false,
        implementation_steps: [
          'Identify periods with available team capacity',
          'Assess business impact of rescheduling',
          'Move change to optimal time slot',
          'Update schedules and notify stakeholders'
        ]
      },
      {
        resolution_type: 'resource_reallocation',
        description: 'Bring in additional team members or contractors',
        impact_assessment: 'Medium to high cost impact',
        stakeholder_approval_required: true,
        implementation_steps: [
          'Identify required additional resources',
          'Calculate cost impact',
          'Get budget approval',
          'Arrange for additional team members'
        ]
      }
    ];
  }

  /**
   * Implement a chosen resolution
   */
  async implementResolution(resolutionId: string, implementedBy: string): Promise<void> {
    try {
      const resolution = await this.knex('change_conflict_resolutions')
        .where('resolution_id', resolutionId)
        .first();

      if (!resolution) {
        throw new Error('Resolution not found');
      }

      // Update resolution status
      await this.knex('change_conflict_resolutions')
        .where('resolution_id', resolutionId)
        .update({
          status: 'implemented',
          implemented_by: implementedBy,
          implemented_at: new Date()
        });

      // Mark conflict as resolved
      await this.knex('change_conflicts')
        .where('conflict_id', resolution.conflict_id)
        .update({
          resolved: true,
          resolution_type: resolution.resolution_type,
          resolution_notes: resolution.description,
          resolved_by: implementedBy,
          resolved_at: new Date()
        });

      // Log resolution implementation
      await this.knex('change_audit_log').insert({
        id: this.generateId(),
        change_id: resolution.conflict_id,
        event_type: 'conflict_resolved',
        details: {
          resolution_type: resolution.resolution_type,
          resolution_description: resolution.description
        },
        performed_by: implementedBy,
        timestamp: new Date()
      });

    } catch (error) {
      console.error('Error implementing resolution:', error);
      throw error;
    }
  }

  /**
   * Get active changes for conflict detection
   */
  private async getActiveChanges(tenant: string, excludeChangeId?: string): Promise<any[]> {
    let query = this.knex('change_requests')
      .where('tenant', tenant)
      .whereIn('status', ['approved', 'scheduled', 'in_progress']);

    if (excludeChangeId) {
      query = query.whereNot('change_id', excludeChangeId);
    }

    return await query.select('*');
  }

  /**
   * Check if two time ranges overlap
   */
  private timeRangesOverlap(start1: Date, end1: Date, start2: Date, end2: Date): boolean {
    return start1 < end2 && end1 > start2;
  }

  /**
   * Calculate resource conflict severity
   */
  private calculateResourceConflictSeverity(
    overlappingResources: string[],
    conflictingChange: any
  ): 'low' | 'medium' | 'high' | 'critical' {
    const criticalResources = ['database', 'network', 'authentication'];
    const hasCriticalResources = overlappingResources.some(resource => 
      criticalResources.some(critical => resource.toLowerCase().includes(critical))
    );

    if (hasCriticalResources) return 'critical';
    if (conflictingChange.risk_level === 'high') return 'high';
    if (overlappingResources.length > 2) return 'medium';
    return 'low';
  }

  /**
   * Calculate service conflict severity
   */
  private calculateServiceConflictSeverity(
    dependentConflicts: any[],
    conflictingChange: any
  ): 'low' | 'medium' | 'high' | 'critical' {
    const criticalDependencies = dependentConflicts.filter(dep => dep.criticality === 'high');
    
    if (criticalDependencies.length > 0) return 'critical';
    if (conflictingChange.risk_level === 'high') return 'high';
    if (dependentConflicts.length > 1) return 'medium';
    return 'low';
  }

  /**
   * Record conflict in database
   */
  private async recordConflict(conflict: IChangeConflict): Promise<void> {
    await this.knex('change_conflicts').insert({
      ...conflict,
      created_at: new Date()
    });
  }

  /**
   * Store resolution proposal
   */
  private async storeResolutionProposal(
    conflictId: string,
    resolution: Partial<IConflictResolution>
  ): Promise<IConflictResolution> {
    const resolutionRecord = {
      resolution_id: this.generateId(),
      conflict_id: conflictId,
      ...resolution,
      created_by: 'system',
      created_at: new Date(),
      status: 'proposed' as const
    };

    await this.knex('change_conflict_resolutions').insert(resolutionRecord);
    return resolutionRecord as IConflictResolution;
  }

  /**
   * Helper methods
   */
  private generateConflictId(): string {
    return `conflict_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async getServiceDependencies(services: string[]): Promise<any[]> {
    // Mock implementation - in real system, would query service dependency database
    return [];
  }

  private async getMaxConcurrentChanges(tenant: string): Promise<number> {
    // Mock implementation - could be configurable per tenant
    return 5;
  }

  private async getTeamCapacity(tenant: string, date: Date): Promise<any> {
    // Mock implementation - would query team capacity database
    return { available_hours: 40, total_hours: 40 };
  }

  private async calculateTeamUtilization(
    tenant: string,
    startDate: string | Date,
    endDate: string | Date
  ): Promise<{ percentage: number; details: any }> {
    // Mock implementation - would calculate actual team utilization
    return { percentage: 0.6, details: {} };
  }
}

export default ChangeConflictService;
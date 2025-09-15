import { Knex } from 'knex';
import { IChangeRequest } from '../../interfaces/change.interfaces';

export interface IChangeWindow {
  id: string;
  title: string;
  description: string;
  start_time: Date;
  end_time: Date;
  window_type: 'maintenance' | 'freeze' | 'blackout' | 'preferred';
  recurrence_pattern?: string;
  affected_services?: string[];
  created_at: Date;
  created_by: string;
  tenant: string;
}

export interface IChangeConflict {
  change_id: string;
  conflicting_change_id: string;
  conflict_type: 'resource' | 'dependency' | 'timing' | 'service_overlap';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  auto_detected: boolean;
  resolved: boolean;
  resolution_notes?: string;
  detected_at: Date;
}

export interface ISchedulingConstraint {
  change_id: string;
  constraint_type: 'prerequisite' | 'successor' | 'resource_availability' | 'service_window';
  constraint_value: string;
  is_mandatory: boolean;
  violation_impact: 'low' | 'medium' | 'high' | 'critical';
}

export class ChangeCalendarService {
  constructor(private knex: Knex) {}

  /**
   * Get available scheduling windows for a change request
   */
  async getAvailableWindows(
    changeRequest: Partial<IChangeRequest>,
    preferredDate?: Date,
    durationHours?: number
  ): Promise<{
    recommended: Date[];
    available: Date[];
    blackout: Date[];
    conflicts: IChangeConflict[];
  }> {
    try {
      const startDate = preferredDate || new Date();
      const endDate = new Date(startDate.getTime() + (30 * 24 * 60 * 60 * 1000)); // 30 days ahead
      const duration = durationHours || changeRequest.estimated_duration || 2;

      // Get maintenance windows
      const maintenanceWindows = await this.knex('change_windows')
        .where('tenant', changeRequest.tenant)
        .where('window_type', 'maintenance')
        .whereBetween('start_time', [startDate, endDate])
        .orderBy('start_time');

      // Get blackout periods
      const blackoutPeriods = await this.knex('change_windows')
        .where('tenant', changeRequest.tenant)
        .whereIn('window_type', ['freeze', 'blackout'])
        .whereBetween('start_time', [startDate, endDate])
        .orderBy('start_time');

      // Get existing changes in the timeframe
      const existingChanges = await this.knex('change_requests')
        .where('tenant', changeRequest.tenant)
        .whereIn('status', ['approved', 'scheduled', 'in_progress'])
        .whereBetween('scheduled_start_date', [startDate, endDate])
        .select('*');

      // Detect conflicts
      const conflicts = await this.detectSchedulingConflicts(changeRequest, existingChanges);

      // Calculate available windows
      const availableWindows = this.calculateAvailableWindows(
        maintenanceWindows,
        blackoutPeriods,
        existingChanges,
        duration,
        startDate,
        endDate
      );

      // Recommend optimal windows based on business rules
      const recommendedWindows = this.recommendOptimalWindows(
        availableWindows,
        changeRequest,
        maintenanceWindows
      );

      return {
        recommended: recommendedWindows,
        available: availableWindows,
        blackout: blackoutPeriods.map(bp => new Date(bp.start_time)),
        conflicts
      };

    } catch (error) {
      console.error('Error getting available windows:', error);
      throw error;
    }
  }

  /**
   * Schedule a change request
   */
  async scheduleChange(
    changeId: string,
    scheduledStart: Date,
    scheduledEnd: Date,
    userId: string
  ): Promise<{ success: boolean; conflicts?: IChangeConflict[] }> {
    try {
      // Check for conflicts
      const changeRequest = await this.knex('change_requests')
        .where('change_id', changeId)
        .first();

      if (!changeRequest) {
        throw new Error('Change request not found');
      }

      const conflicts = await this.detectTimeSlotConflicts(
        changeRequest,
        scheduledStart,
        scheduledEnd
      );

      if (conflicts.length > 0) {
        const criticalConflicts = conflicts.filter(c => c.severity === 'critical');
        if (criticalConflicts.length > 0) {
          return { success: false, conflicts: criticalConflicts };
        }
      }

      // Update change request with schedule
      await this.knex('change_requests')
        .where('change_id', changeId)
        .update({
          scheduled_start_date: scheduledStart,
          scheduled_end_date: scheduledEnd,
          status: 'scheduled',
          updated_at: this.knex.fn.now(),
          updated_by: userId
        });

      // Record any non-critical conflicts for monitoring
      if (conflicts.length > 0) {
        await this.recordConflicts(changeId, conflicts);
      }

      // Generate calendar notifications
      await this.generateCalendarNotifications(changeRequest, scheduledStart, scheduledEnd);

      return { success: true, conflicts: conflicts.length > 0 ? conflicts : undefined };

    } catch (error) {
      console.error('Error scheduling change:', error);
      throw error;
    }
  }

  /**
   * Detect scheduling conflicts
   */
  private async detectSchedulingConflicts(
    changeRequest: Partial<IChangeRequest>,
    existingChanges: any[]
  ): Promise<IChangeConflict[]> {
    const conflicts: IChangeConflict[] = [];

    for (const existingChange of existingChanges) {
      // Resource conflicts
      if (this.hasResourceConflict(changeRequest, existingChange)) {
        conflicts.push({
          change_id: changeRequest.change_id!,
          conflicting_change_id: existingChange.change_id,
          conflict_type: 'resource',
          severity: this.calculateConflictSeverity(changeRequest, existingChange, 'resource'),
          description: `Resource conflict with ${existingChange.title}`,
          auto_detected: true,
          resolved: false,
          detected_at: new Date()
        });
      }

      // Service overlap conflicts
      if (this.hasServiceOverlap(changeRequest, existingChange)) {
        conflicts.push({
          change_id: changeRequest.change_id!,
          conflicting_change_id: existingChange.change_id,
          conflict_type: 'service_overlap',
          severity: this.calculateConflictSeverity(changeRequest, existingChange, 'service_overlap'),
          description: `Service overlap with ${existingChange.title}`,
          auto_detected: true,
          resolved: false,
          detected_at: new Date()
        });
      }

      // Dependency conflicts
      if (this.hasDependencyConflict(changeRequest, existingChange)) {
        conflicts.push({
          change_id: changeRequest.change_id!,
          conflicting_change_id: existingChange.change_id,
          conflict_type: 'dependency',
          severity: 'high',
          description: `Dependency conflict with ${existingChange.title}`,
          auto_detected: true,
          resolved: false,
          detected_at: new Date()
        });
      }
    }

    return conflicts;
  }

  /**
   * Check for resource conflicts between changes
   */
  private hasResourceConflict(change1: Partial<IChangeRequest>, change2: any): boolean {
    const change1Resources = change1.affected_services || [];
    const change2Resources = change2.affected_services || [];
    
    return change1Resources.some(resource => change2Resources.includes(resource));
  }

  /**
   * Check for service overlap between changes
   */
  private hasServiceOverlap(change1: Partial<IChangeRequest>, change2: any): boolean {
    if (!change1.affected_services || !change2.affected_services) return false;
    
    const change1Services = Array.isArray(change1.affected_services) 
      ? change1.affected_services 
      : JSON.parse(change1.affected_services);
    const change2Services = Array.isArray(change2.affected_services)
      ? change2.affected_services
      : JSON.parse(change2.affected_services);
    
    return change1Services.some((service: string) => change2Services.includes(service));
  }

  /**
   * Check for dependency conflicts
   */
  private hasDependencyConflict(change1: Partial<IChangeRequest>, change2: any): boolean {
    // Check if change1 depends on change2 or vice versa
    const change1Dependencies = change1.dependencies || [];
    const change2Dependencies = change2.dependencies || [];
    
    return change1Dependencies.includes(change2.change_id) || 
           change2Dependencies.includes(change1.change_id);
  }

  /**
   * Calculate conflict severity
   */
  private calculateConflictSeverity(
    change1: Partial<IChangeRequest>, 
    change2: any, 
    conflictType: string
  ): 'low' | 'medium' | 'high' | 'critical' {
    // Base severity on change types and business impact
    const change1Risk = change1.risk_level || 'medium';
    const change2Risk = change2.risk_level || 'medium';
    
    if (change1Risk === 'high' || change2Risk === 'high') {
      return conflictType === 'dependency' ? 'critical' : 'high';
    }
    
    if (change1Risk === 'medium' || change2Risk === 'medium') {
      return conflictType === 'service_overlap' ? 'high' : 'medium';
    }
    
    return 'low';
  }

  /**
   * Calculate available time windows
   */
  private calculateAvailableWindows(
    maintenanceWindows: any[],
    blackoutPeriods: any[],
    existingChanges: any[],
    durationHours: number,
    startDate: Date,
    endDate: Date
  ): Date[] {
    const availableSlots: Date[] = [];
    const slotDuration = durationHours * 60 * 60 * 1000; // Convert to milliseconds
    
    // Generate potential time slots (every 4 hours during business hours)
    const currentTime = new Date(startDate);
    while (currentTime < endDate) {
      const slotEnd = new Date(currentTime.getTime() + slotDuration);
      
      // Check if slot conflicts with blackout periods
      const hasBlackoutConflict = blackoutPeriods.some(blackout => 
        this.timeRangesOverlap(currentTime, slotEnd, new Date(blackout.start_time), new Date(blackout.end_time))
      );
      
      // Check if slot conflicts with existing changes
      const hasChangeConflict = existingChanges.some(change => 
        change.scheduled_start_date && change.scheduled_end_date &&
        this.timeRangesOverlap(
          currentTime, 
          slotEnd, 
          new Date(change.scheduled_start_date), 
          new Date(change.scheduled_end_date)
        )
      );
      
      if (!hasBlackoutConflict && !hasChangeConflict) {
        availableSlots.push(new Date(currentTime));
      }
      
      // Move to next 4-hour slot
      currentTime.setHours(currentTime.getHours() + 4);
    }
    
    return availableSlots;
  }

  /**
   * Recommend optimal windows based on business rules
   */
  private recommendOptimalWindows(
    availableWindows: Date[],
    changeRequest: Partial<IChangeRequest>,
    maintenanceWindows: any[]
  ): Date[] {
    return availableWindows
      .filter(window => {
        const windowDate = new Date(window);
        const dayOfWeek = windowDate.getDay();
        const hour = windowDate.getHours();
        
        // Prefer maintenance windows
        const inMaintenanceWindow = maintenanceWindows.some(mw => 
          windowDate >= new Date(mw.start_time) && windowDate <= new Date(mw.end_time)
        );
        
        // Prefer off-hours for high-risk changes
        const isOffHours = hour < 8 || hour > 18 || dayOfWeek === 0 || dayOfWeek === 6;
        
        if (changeRequest.risk_level === 'high') {
          return inMaintenanceWindow || isOffHours;
        }
        
        return true; // All windows are acceptable for low/medium risk
      })
      .slice(0, 5); // Return top 5 recommendations
  }

  /**
   * Check if two time ranges overlap
   */
  private timeRangesOverlap(start1: Date, end1: Date, start2: Date, end2: Date): boolean {
    return start1 < end2 && end1 > start2;
  }

  /**
   * Detect conflicts for a specific time slot
   */
  private async detectTimeSlotConflicts(
    changeRequest: any,
    scheduledStart: Date,
    scheduledEnd: Date
  ): Promise<IChangeConflict[]> {
    const conflicts: IChangeConflict[] = [];
    
    // Check blackout periods
    const blackoutConflicts = await this.knex('change_windows')
      .where('tenant', changeRequest.tenant)
      .whereIn('window_type', ['freeze', 'blackout'])
      .where(function() {
        this.whereBetween('start_time', [scheduledStart, scheduledEnd])
          .orWhereBetween('end_time', [scheduledStart, scheduledEnd])
          .orWhere(function() {
            this.where('start_time', '<=', scheduledStart)
              .andWhere('end_time', '>=', scheduledEnd);
          });
      });
    
    for (const blackout of blackoutConflicts) {
      conflicts.push({
        change_id: changeRequest.change_id,
        conflicting_change_id: blackout.id,
        conflict_type: 'timing',
        severity: 'critical',
        description: `Conflicts with ${blackout.window_type} window: ${blackout.title}`,
        auto_detected: true,
        resolved: false,
        detected_at: new Date()
      });
    }
    
    return conflicts;
  }

  /**
   * Record conflicts in database
   */
  private async recordConflicts(changeId: string, conflicts: IChangeConflict[]): Promise<void> {
    for (const conflict of conflicts) {
      await this.knex('change_conflicts').insert({
        ...conflict,
        id: this.knex.raw('uuid_generate_v4()'),
        created_at: this.knex.fn.now()
      });
    }
  }

  /**
   * Generate calendar notifications for stakeholders
   */
  private async generateCalendarNotifications(
    changeRequest: any,
    scheduledStart: Date,
    scheduledEnd: Date
  ): Promise<void> {
    // This would integrate with calendar systems (Outlook, Google Calendar, etc.)
    // For now, we'll create internal notifications
    
    const stakeholders = await this.knex('change_approvals')
      .where('change_id', changeRequest.change_id)
      .select('approver_id');
    
    for (const stakeholder of stakeholders) {
      await this.knex('notifications').insert({
        id: this.knex.raw('uuid_generate_v4()'),
        tenant: changeRequest.tenant,
        user_id: stakeholder.approver_id,
        type: 'change_scheduled',
        title: `Change Scheduled: ${changeRequest.title}`,
        message: `Change request ${changeRequest.change_number} has been scheduled for ${scheduledStart.toISOString()}`,
        data: {
          change_id: changeRequest.change_id,
          scheduled_start: scheduledStart,
          scheduled_end: scheduledEnd
        },
        created_at: this.knex.fn.now(),
        read: false
      });
    }
  }

  /**
   * Get change calendar view for a date range
   */
  async getChangeCalendar(
    tenant: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    changes: any[];
    maintenanceWindows: IChangeWindow[];
    conflicts: IChangeConflict[];
  }> {
    try {
      const changes = await this.knex('change_requests')
        .where('tenant', tenant)
        .whereNotNull('scheduled_start_date')
        .whereBetween('scheduled_start_date', [startDate, endDate])
        .orderBy('scheduled_start_date');

      const maintenanceWindows = await this.knex('change_windows')
        .where('tenant', tenant)
        .whereBetween('start_time', [startDate, endDate])
        .orderBy('start_time');

      const conflicts = await this.knex('change_conflicts')
        .whereIn('change_id', changes.map(c => c.change_id))
        .where('resolved', false);

      return {
        changes,
        maintenanceWindows,
        conflicts
      };

    } catch (error) {
      console.error('Error getting change calendar:', error);
      throw error;
    }
  }

  /**
   * Create or update a maintenance window
   */
  async createMaintenanceWindow(windowData: Omit<IChangeWindow, 'id' | 'created_at'>): Promise<string> {
    try {
      const [window] = await this.knex('change_windows').insert({
        id: this.knex.raw('uuid_generate_v4()'),
        ...windowData,
        created_at: this.knex.fn.now()
      }).returning('id');

      return window.id;
    } catch (error) {
      console.error('Error creating maintenance window:', error);
      throw error;
    }
  }
}

export default ChangeCalendarService;
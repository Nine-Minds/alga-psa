// ITIL Utility Functions for Priority Calculation and Business Logic

/**
 * ITIL Impact levels (1-5 scale)
 */
export enum ItilImpact {
  HIGH = 1,      // Large number of users affected, critical business function affected
  MEDIUM_HIGH = 2,  // Medium number of users affected, important business function affected
  MEDIUM = 3,    // Small number of users affected, minor business function affected
  MEDIUM_LOW = 4,   // Few users affected, minimal business impact
  LOW = 5        // Single user affected, no business impact
}

/**
 * ITIL Urgency levels (1-5 scale)
 */
export enum ItilUrgency {
  HIGH = 1,      // Work cannot continue, immediate attention required
  MEDIUM_HIGH = 2,  // Work is severely impaired, needs quick attention
  MEDIUM = 3,    // Work can continue with limitations
  MEDIUM_LOW = 4,   // Work can continue with minor inconvenience
  LOW = 5        // Work can continue normally
}

/**
 * ITIL Priority levels
 */
export enum ItilPriority {
  CRITICAL = 1,    // Resolve immediately
  HIGH = 2,        // Resolve within 4 hours
  MEDIUM = 3,      // Resolve within 24 hours
  LOW = 4,         // Resolve within 72 hours
  PLANNING = 5     // Resolve when resources permit
}

/**
 * ITIL Impact × Urgency Priority Matrix
 * Returns priority level based on impact and urgency values
 */
const PRIORITY_MATRIX: Record<number, Record<number, number>> = {
  [ItilImpact.HIGH]: {
    [ItilUrgency.HIGH]: ItilPriority.CRITICAL,
    [ItilUrgency.MEDIUM_HIGH]: ItilPriority.HIGH,
    [ItilUrgency.MEDIUM]: ItilPriority.HIGH,
    [ItilUrgency.MEDIUM_LOW]: ItilPriority.MEDIUM,
    [ItilUrgency.LOW]: ItilPriority.MEDIUM
  },
  [ItilImpact.MEDIUM_HIGH]: {
    [ItilUrgency.HIGH]: ItilPriority.HIGH,
    [ItilUrgency.MEDIUM_HIGH]: ItilPriority.HIGH,
    [ItilUrgency.MEDIUM]: ItilPriority.MEDIUM,
    [ItilUrgency.MEDIUM_LOW]: ItilPriority.MEDIUM,
    [ItilUrgency.LOW]: ItilPriority.LOW
  },
  [ItilImpact.MEDIUM]: {
    [ItilUrgency.HIGH]: ItilPriority.HIGH,
    [ItilUrgency.MEDIUM_HIGH]: ItilPriority.MEDIUM,
    [ItilUrgency.MEDIUM]: ItilPriority.MEDIUM,
    [ItilUrgency.MEDIUM_LOW]: ItilPriority.LOW,
    [ItilUrgency.LOW]: ItilPriority.LOW
  },
  [ItilImpact.MEDIUM_LOW]: {
    [ItilUrgency.HIGH]: ItilPriority.MEDIUM,
    [ItilUrgency.MEDIUM_HIGH]: ItilPriority.MEDIUM,
    [ItilUrgency.MEDIUM]: ItilPriority.LOW,
    [ItilUrgency.MEDIUM_LOW]: ItilPriority.LOW,
    [ItilUrgency.LOW]: ItilPriority.PLANNING
  },
  [ItilImpact.LOW]: {
    [ItilUrgency.HIGH]: ItilPriority.MEDIUM,
    [ItilUrgency.MEDIUM_HIGH]: ItilPriority.LOW,
    [ItilUrgency.MEDIUM]: ItilPriority.LOW,
    [ItilUrgency.MEDIUM_LOW]: ItilPriority.PLANNING,
    [ItilUrgency.LOW]: ItilPriority.PLANNING
  }
};

/**
 * Calculate ITIL priority based on impact and urgency
 * @param impact ITIL impact level (1-5)
 * @param urgency ITIL urgency level (1-5)
 * @returns Priority level (1-5)
 */
export function calculateItilPriority(impact: number, urgency: number): number {
  // Validate input ranges
  if (impact < 1 || impact > 5 || urgency < 1 || urgency > 5) {
    throw new Error('Impact and urgency must be between 1 and 5');
  }

  return PRIORITY_MATRIX[impact][urgency];
}

/**
 * Get human-readable labels for ITIL levels
 */
export const ItilLabels = {
  impact: {
    1: 'High',
    2: 'Medium-High',
    3: 'Medium',
    4: 'Medium-Low',
    5: 'Low'
  },
  urgency: {
    1: 'High',
    2: 'Medium-High',
    3: 'Medium',
    4: 'Medium-Low',
    5: 'Low'
  },
  priority: {
    1: 'Critical',
    2: 'High',
    3: 'Medium',
    4: 'Low',
    5: 'Planning'
  }
};

/**
 * Get SLA target times based on priority level
 * @param priority ITIL priority level (1-5)
 * @returns Target resolution time in hours
 */
export function getSlaTarget(priority: number): number {
  const slaTargets: Record<number, number> = {
    [ItilPriority.CRITICAL]: 1,    // 1 hour
    [ItilPriority.HIGH]: 4,        // 4 hours
    [ItilPriority.MEDIUM]: 24,     // 24 hours (1 day)
    [ItilPriority.LOW]: 72,        // 72 hours (3 days)
    [ItilPriority.PLANNING]: 168   // 168 hours (1 week)
  };

  return slaTargets[priority] || 24; // Default to 24 hours if unknown priority
}

/**
 * Check if SLA should be breached based on elapsed time
 * @param priority ITIL priority level
 * @param elapsedHours Hours since ticket creation
 * @returns True if SLA is breached
 */
export function isSlaBreached(priority: number, elapsedHours: number): boolean {
  const targetHours = getSlaTarget(priority);
  return elapsedHours >= targetHours;
}

/**
 * Get escalation level based on elapsed time and priority
 * @param priority ITIL priority level
 * @param elapsedHours Hours since ticket creation
 * @returns Escalation level (0 = no escalation, 1-3 = escalation levels)
 */
export function getEscalationLevel(priority: number, elapsedHours: number): number {
  const targetHours = getSlaTarget(priority);
  const escalationThresholds = {
    level1: targetHours * 0.7,  // 70% of SLA target
    level2: targetHours * 0.9,  // 90% of SLA target
    level3: targetHours * 1.1   // 110% of SLA target (already breached)
  };

  if (elapsedHours >= escalationThresholds.level3) {
    return 3;
  } else if (elapsedHours >= escalationThresholds.level2) {
    return 2;
  } else if (elapsedHours >= escalationThresholds.level1) {
    return 1;
  }
  
  return 0;
}

/**
 * Standard ITIL incident categories
 * @deprecated ITIL categories are now stored in standard_categories table
 * This object is kept for backward compatibility but should not be used for new code
 */
export const ItilCategories = {
  'Hardware': {
    subcategories: [
      'Server',
      'Desktop/Laptop',
      'Network Equipment',
      'Printer',
      'Storage',
      'Mobile Device'
    ]
  },
  'Software': {
    subcategories: [
      'Application',
      'Operating System',
      'Database',
      'Security Software',
      'Productivity Software',
      'Custom Application'
    ]
  },
  'Network': {
    subcategories: [
      'Connectivity',
      'VPN',
      'Wi-Fi',
      'Internet',
      'LAN/WAN',
      'Firewall'
    ]
  },
  'Security': {
    subcategories: [
      'Malware',
      'Unauthorized Access',
      'Data Breach',
      'Phishing',
      'Policy Violation',
      'Account Lockout'
    ]
  },
  'Service Request': {
    subcategories: [
      'Access Request',
      'New User Setup',
      'Software Installation',
      'Equipment Request',
      'Information Request',
      'Change Request'
    ]
  }
};

/**
 * Standard ITIL resolution codes
 */
export const ItilResolutionCodes = [
  'Resolved by User',
  'Resolved by Support',
  'Hardware Replacement',
  'Software Update/Patch',
  'Configuration Change',
  'User Training Provided',
  'Workaround Provided',
  'Escalated to Vendor',
  'Duplicate Incident',
  'Not Reproducible',
  'User Error',
  'Known Error'
];

/**
 * Format ITIL category and subcategory display consistently with custom categories
 * @param category ITIL category (e.g., 'Hardware')
 * @param subcategory ITIL subcategory (e.g., 'Server')
 * @returns Formatted display string (e.g., 'Hardware → Server' or 'Hardware' if no subcategory)
 */
export function formatItilCategoryDisplay(category?: string | null, subcategory?: string | null): string {
  if (!category) {
    return '';
  }

  if (subcategory) {
    return `${category} → ${subcategory}`;
  }

  return category;
}

/**
 * Get ITIL categories from standard_categories table
 * This function should be used in server components to fetch ITIL categories
 * For client components, ITIL categories should be passed from server actions
 * @param db Knex database connection
 * @returns Promise<Array> of ITIL category records from standard_categories table
 */
export async function getItilCategoriesFromDB(db: any): Promise<any[]> {
  return await db('standard_categories')
    .where('is_itil_standard', true)
    .orderBy('category_name', 'asc');
}

/**
 * Get ITIL priorities from standard_priorities table
 * @param db Knex database connection
 * @returns Promise<Array> of ITIL priority records from standard_priorities table
 */
export async function getItilPrioritiesFromDB(db: any): Promise<any[]> {
  return await db('standard_priorities')
    .where('is_itil_standard', true)
    .orderBy('itil_priority_level', 'asc');
}

/**
 * Get ITIL priority record by calculated priority level
 * @param db Knex database connection
 * @param priorityLevel ITIL priority level (1-5)
 * @returns Promise<Object> ITIL priority record
 */
export async function getItilPriorityByLevel(db: any, priorityLevel: number): Promise<any> {
  return await db('standard_priorities')
    .where('is_itil_standard', true)
    .where('itil_priority_level', priorityLevel)
    .first();
}

/**
 * Convert ITIL categories to ITicketCategory format for use with CategoryPicker
 * @deprecated Use getItilCategoriesFromDB instead for server-side usage
 * @returns Array of ITicketCategory objects representing ITIL categories
 */
export function getItilCategoriesAsTicketCategories(): any[] {
  console.warn('getItilCategoriesAsTicketCategories is deprecated. Use getItilCategoriesFromDB for server-side or pass categories from server actions.');

  const categories: any[] = [];

  // Add parent categories and their children
  Object.entries(ItilCategories).forEach(([categoryName, categoryData], index) => {
    const parentId = `itil-${categoryName.toLowerCase().replace(/\s+/g, '-')}`;

    // Add parent category
    categories.push({
      category_id: parentId,
      category_name: categoryName,
      parent_category: null,
      is_inactive: false,
      tenant_id: '', // Will be set by the system
      created_at: new Date(),
      updated_at: new Date()
    });

    // Add child categories
    categoryData.subcategories.forEach((subcategoryName, subIndex) => {
      const childId = `itil-${categoryName.toLowerCase().replace(/\s+/g, '-')}-${subcategoryName.toLowerCase().replace(/[\s\/]+/g, '-')}`;

      categories.push({
        category_id: childId,
        category_name: subcategoryName,
        parent_category: parentId,
        is_inactive: false,
        tenant_id: '', // Will be set by the system
        created_at: new Date(),
        updated_at: new Date()
      });
    });
  });

  return categories;
}
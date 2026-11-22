import { ItilPriority, getSlaTarget } from '@alga-psa/shared/lib/itil/slaTargets';
import {
  ItilImpact,
  ItilUrgency,
  calculateItilPriority,
  ItilLabels,
} from '@alga-psa/shared/lib/itil/priorityMatrix';

export { ItilPriority, getSlaTarget };

// The Impact × Urgency matrix and its labels live in @alga-psa/shared so the rules module,
// shared/workflow and co-managed can use them without importing the tickets package.
export { ItilImpact, ItilUrgency, calculateItilPriority, ItilLabels };

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
 * Convert ITIL categories to ITicketCategory format for use with CategoryPicker
 * @deprecated Use getItilCategoriesFromDB from ./itilUtils.server instead for server-side usage
 * @returns Array of ITicketCategory objects representing ITIL categories
 */
export function getItilCategoriesAsTicketCategories(): any[] {
  console.warn('getItilCategoriesAsTicketCategories is deprecated. Use getItilCategoriesFromDB from ./itilUtils.server for server-side or pass categories from server actions.');

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

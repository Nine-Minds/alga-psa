const normalizeDateOnly = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.includes('T')) {
    return trimmed.slice(0, 10);
  }

  return trimmed;
};

const compareAssignmentOrder = (left, right) => {
  const leftDate = normalizeDateOnly(left.start_date) ?? '9999-12-31';
  const rightDate = normalizeDateOnly(right.start_date) ?? '9999-12-31';

  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  const leftId = typeof left.client_contract_id === 'string' ? left.client_contract_id : '';
  const rightId = typeof right.client_contract_id === 'string' ? right.client_contract_id : '';
  return leftId.localeCompare(rightId);
};

const sortAssignmentsDeterministically = (assignments) => [...assignments].sort(compareAssignmentOrder);

const toPositiveCount = (value) => {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.trunc(numeric));
};

const distinctClientCount = (rows) => new Set(rows.map((row) => row.client_id).filter(Boolean)).size;

function detectSharedNonTemplateContractGroups(rows) {
  const grouped = new Map();

  for (const row of rows) {
    if (row?.is_template === true) {
      continue;
    }

    const key = `${row.tenant}:${row.contract_id}`;
    const existing = grouped.get(key) ?? [];
    existing.push(row);
    grouped.set(key, existing);
  }

  return [...grouped.values()]
    .filter((groupRows) => distinctClientCount(groupRows) > 1)
    .map((groupRows) => sortAssignmentsDeterministically(groupRows));
}

function selectPreservedAssignment(assignments) {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    throw new Error('At least one assignment is required to select the preserved contract owner');
  }

  const ordered = sortAssignmentsDeterministically(assignments);
  const invoicedAssignments = ordered.filter((assignment) => toPositiveCount(assignment.invoice_count) > 0);

  if (invoicedAssignments.length === 1) {
    return {
      preservedAssignment: invoicedAssignments[0],
      reason: 'single_invoiced_assignment',
    };
  }

  return {
    preservedAssignment: ordered[0],
    reason: 'earliest_start_date',
  };
}

function assertCloneTargetsSupported(params) {
  const {
    tenant,
    contractId,
    cloneTargets,
    contractDocumentAssociationsCount = 0,
    pricingScheduleCount = 0,
    timeEntryCount = 0,
    usageTrackingCount = 0,
  } = params;

  if (!Array.isArray(cloneTargets) || cloneTargets.length === 0) {
    return;
  }

  const unsupportedReasons = [];
  if (toPositiveCount(contractDocumentAssociationsCount) > 0) {
    unsupportedReasons.push('contract-scoped document associations exist');
  }
  if (toPositiveCount(pricingScheduleCount) > 0) {
    unsupportedReasons.push('contract pricing schedules exist');
  }
  if (toPositiveCount(timeEntryCount) > 0) {
    unsupportedReasons.push('contract-line time entries exist');
  }
  if (toPositiveCount(usageTrackingCount) > 0) {
    unsupportedReasons.push('contract-line usage tracking exists');
  }

  if (unsupportedReasons.length > 0) {
    throw new Error(
      `Cannot split shared contract ${contractId} in tenant ${tenant}: ${unsupportedReasons.join(
        '; '
      )}.`
    );
  }
}

function remapRows(rows, transform) {
  return Array.isArray(rows) ? rows.map((row) => transform({ ...row })) : [];
}

function buildSharedContractClonePlan(params, options = {}) {
  const {
    sourceContract,
    assignments,
    contractLines = [],
    contractLineServices = [],
    contractLineServiceDefaults = [],
    contractLineDiscounts = [],
    contractLineServiceConfigurations = [],
    contractLineServiceBucketConfigs = [],
    contractLineServiceFixedConfigs = [],
    contractLineServiceHourlyConfig = [],
    contractLineServiceHourlyConfigs = [],
    contractLineServiceRateTiers = [],
    contractLineServiceUsageConfig = [],
  } = params;

  if (!sourceContract?.contract_id || !sourceContract?.tenant) {
    throw new Error('A source contract with tenant and contract_id is required');
  }

  const orderedAssignments = sortAssignmentsDeterministically(assignments);
  const { preservedAssignment, reason } = selectPreservedAssignment(orderedAssignments);
  const cloneTargets = orderedAssignments.filter(
    (assignment) => assignment.client_contract_id !== preservedAssignment.client_contract_id
  );

  const createId =
    typeof options.createId === 'function'
      ? options.createId
      : () => {
          throw new Error('createId option is required');
        };

  const clones = cloneTargets.map((cloneTarget) => {
    const newContractId = createId('contract');
    const lineIdMap = new Map();
    const configIdMap = new Map();

    const clonedContract = {
      ...sourceContract,
      contract_id: newContractId,
      owner_client_id: cloneTarget.client_id,
    };

    const clonedContractLines = remapRows(contractLines, (row) => {
      const newLineId = createId('contract_line');
      lineIdMap.set(row.contract_line_id, newLineId);

      return {
        ...row,
        contract_id: newContractId,
        contract_line_id: newLineId,
      };
    });

    const clonedContractLineServices = remapRows(contractLineServices, (row) => ({
      ...row,
      contract_line_id: lineIdMap.get(row.contract_line_id),
    }));

    const clonedContractLineServiceDefaults = remapRows(contractLineServiceDefaults, (row) => ({
      ...row,
      default_id: createId('contract_line_default'),
      contract_line_id: lineIdMap.get(row.contract_line_id),
    }));

    const clonedContractLineDiscounts = remapRows(contractLineDiscounts, (row) => ({
      ...row,
      discount_id: createId('contract_line_discount'),
      contract_line_id: lineIdMap.get(row.contract_line_id),
    }));

    const clonedContractLineServiceConfigurations = remapRows(
      contractLineServiceConfigurations,
      (row) => {
        const newConfigId = createId('contract_line_service_config');
        configIdMap.set(row.config_id, newConfigId);

        return {
          ...row,
          config_id: newConfigId,
          contract_line_id: lineIdMap.get(row.contract_line_id),
        };
      }
    );

    const remapConfigIdRow = (row) => ({
      ...row,
      config_id: configIdMap.get(row.config_id),
    });

    const clonedContractLineServiceBucketConfigs = remapRows(
      contractLineServiceBucketConfigs,
      remapConfigIdRow
    );
    const clonedContractLineServiceFixedConfigs = remapRows(
      contractLineServiceFixedConfigs,
      remapConfigIdRow
    );
    const clonedContractLineServiceHourlyConfig = remapRows(
      contractLineServiceHourlyConfig,
      remapConfigIdRow
    );
    const clonedContractLineServiceHourlyConfigs = remapRows(
      contractLineServiceHourlyConfigs,
      remapConfigIdRow
    );
    const clonedContractLineServiceUsageConfig = remapRows(
      contractLineServiceUsageConfig,
      remapConfigIdRow
    );
    const clonedContractLineServiceRateTiers = remapRows(contractLineServiceRateTiers, (row) => ({
      ...row,
      tier_id: createId('contract_line_service_rate_tier'),
      config_id: configIdMap.get(row.config_id),
    }));

    return {
      targetClientContractId: cloneTarget.client_contract_id,
      targetClientId: cloneTarget.client_id,
      sourceAssignment: cloneTarget,
      contract: clonedContract,
      clientContractUpdate: {
        client_contract_id: cloneTarget.client_contract_id,
        contract_id: newContractId,
      },
      contractLines: clonedContractLines,
      contractLineServices: clonedContractLineServices,
      contractLineServiceDefaults: clonedContractLineServiceDefaults,
      contractLineDiscounts: clonedContractLineDiscounts,
      contractLineServiceConfigurations: clonedContractLineServiceConfigurations,
      contractLineServiceBucketConfigs: clonedContractLineServiceBucketConfigs,
      contractLineServiceFixedConfigs: clonedContractLineServiceFixedConfigs,
      contractLineServiceHourlyConfig: clonedContractLineServiceHourlyConfig,
      contractLineServiceHourlyConfigs: clonedContractLineServiceHourlyConfigs,
      contractLineServiceRateTiers: clonedContractLineServiceRateTiers,
      contractLineServiceUsageConfig: clonedContractLineServiceUsageConfig,
    };
  });

  return {
    contractId: sourceContract.contract_id,
    tenant: sourceContract.tenant,
    reason,
    preservedAssignment,
    preservedContractUpdate: {
      contract_id: sourceContract.contract_id,
      owner_client_id: preservedAssignment.client_id,
    },
    clones,
  };
}

module.exports = {
  detectSharedNonTemplateContractGroups,
  selectPreservedAssignment,
  assertCloneTargetsSupported,
  buildSharedContractClonePlan,
};

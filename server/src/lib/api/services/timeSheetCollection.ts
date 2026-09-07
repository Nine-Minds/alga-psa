/** API adapters consume admitted projections only; no lookup may enrich these
 * rows with fields or counts withheld by the customer authorization boundary. */
export function timeSheetCommentDto(comment: any) {
  const { comment: text, is_approver: reviewer, ...fields } = comment;
  return { ...fields, comment_text: text, user_role: reviewer ? 'approver' : 'owner' };
}

export function timeSheetDto(sheet: any) {
  const { employee_name, employee_email, comments, time_entries, ...fields } = sheet;
  return { ...fields, ...(employee_name !== undefined ? { user_name: employee_name } : {}),
    ...(time_entries !== undefined ? { time_entries: time_entries.map((entry: any) => entry.work_item_type === 'non_billable_category' && entry.work_item_id === '__non_billable__' ? { ...entry, work_item_id: null } : entry) } : {}),
    ...(comments !== undefined ? { comments: comments.map(timeSheetCommentDto) } : {}) };
}

export function filterTimeSheets(sheets: any[], filters: Record<string, any> = {}) {
  const ranges = {
    submitted_from: ['submitted_at', 'from'], submitted_to: ['submitted_at', 'to'],
    approved_from: ['approved_at', 'from'], approved_to: ['approved_at', 'to'],
    period_start_from: ['period_start', 'from'], period_start_to: ['period_start', 'to'],
    period_end_from: ['period_end', 'from'], period_end_to: ['period_end', 'to'],
  };
  return sheets.filter(sheet => {
    for (const field of ['user_id', 'period_id', 'approval_status', 'approved_by']) {
      if (filters[field] !== undefined && sheet[field] !== filters[field]) return false;
    }
    if (filters.has_entries !== undefined) {
      if (sheet.entry_count == null || (sheet.entry_count > 0) !== filters.has_entries) return false;
    }
    for (const [filter, [field, direction]] of Object.entries(ranges)) {
      if (filters[filter] === undefined) continue;
      const value = field === 'period_start' ? sheet.time_period?.start_date : field === 'period_end' ? sheet.time_period?.end_date : sheet[field];
      if (value == null) return false;
      const actual = Date.parse(value), bound = Date.parse(filters[filter]);
      if (!Number.isFinite(actual) || !Number.isFinite(bound) || (direction === 'from' ? actual < bound : actual > bound)) return false;
    }
    return true;
  });
}

export function sortTimeSheets(sheets: any[], sort = 'id', order = 'desc') {
  const allowed = ['id', 'period_id', 'user_id', 'user_name', 'approval_status', 'submitted_at', 'approved_at', 'created_at', 'updated_at', 'total_hours', 'billable_hours', 'entry_count'];
  const field = allowed.includes(sort) ? sort : 'id', direction = order === 'asc' ? 1 : -1;
  return [...sheets].sort((a, b) => {
    const left = a[field], right = b[field];
    if (left == null || right == null) return left == null && right == null ? a.id.localeCompare(b.id) : left == null ? 1 : -1;
    const compared = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
    return compared * direction || a.id.localeCompare(b.id);
  });
}

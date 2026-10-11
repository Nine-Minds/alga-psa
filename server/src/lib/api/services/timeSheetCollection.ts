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
    created_from: ['created_at', 'from'], created_to: ['created_at', 'to'],
    updated_from: ['updated_at', 'from'], updated_to: ['updated_at', 'to'],
    submitted_from: ['submitted_at', 'from'], submitted_to: ['submitted_at', 'to'],
    approved_from: ['approved_at', 'from'], approved_to: ['approved_at', 'to'],
    period_start_from: ['period_start', 'from'], period_start_to: ['period_start', 'to'],
    period_end_from: ['period_end', 'from'], period_end_to: ['period_end', 'to'],
  };
  return sheets.filter(sheet => {
    if (filters.search && !['notes', 'user_name', 'approval_status'].some(field => typeof sheet[field] === 'string' && sheet[field].toLocaleLowerCase().includes(String(filters.search).toLocaleLowerCase()))) return false;
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

export function timeSheetStatistics(sheets: any[], today = new Date().toISOString().slice(0, 10)) {
  const sum = (rows: any[], field: string) => rows.some(row => row[field] == null) ? null : rows.reduce((total, row) => total + Number(row[field]), 0);
  const countBy = (field: string) => Object.fromEntries(sheets.reduce((counts, sheet) => counts.set(sheet[field], (counts.get(sheet[field]) ?? 0) + 1), new Map<string, number>()));
  const periodsKnown = sheets.every(sheet => sheet.time_period?.start_date && sheet.time_period?.end_date);
  const current = sheets.filter(sheet => sheet.time_period?.start_date <= today && sheet.time_period?.end_date > today);
  const submitted = sheets.filter(sheet => sheet.submitted_at);
  const submissionsKnown = periodsKnown && sheets.every(sheet => sheet.approval_status === 'DRAFT' || sheet.submitted_at);
  const approved = sheets.filter(sheet => sheet.approval_status === 'APPROVED'), totalHours = sum(sheets, 'total_hours');
  const users = [...new Set<string>(sheets.map(sheet => sheet.user_id))].map(userId => {
    const rows = sheets.filter(sheet => sheet.user_id === userId);
    return { user_id: userId, user_name: rows[0].user_name ?? '', total_hours: sum(rows, 'total_hours'), sheet_count: rows.length };
  }).sort((a, b) => (b.total_hours ?? -1) - (a.total_hours ?? -1) || a.user_id.localeCompare(b.user_id));
  return { total_time_sheets: sheets.length, pending_approval: sheets.filter(sheet => sheet.approval_status === 'SUBMITTED').length,
    approved_this_period: periodsKnown ? current.filter(sheet => sheet.approval_status === 'APPROVED').length : null,
    changes_requested: sheets.filter(sheet => sheet.approval_status === 'CHANGES_REQUESTED').length,
    total_hours_this_period: periodsKnown ? sum(current, 'total_hours') : null,
    billable_hours_this_period: periodsKnown ? sum(current, 'billable_hours') : null,
    time_sheets_by_status: countBy('approval_status'), time_sheets_by_user: countBy('user_id'),
    average_hours_per_sheet: totalHours == null ? null : sheets.length ? totalHours / sheets.length : 0,
    approval_rate: sheets.length ? approved.length / sheets.length * 100 : 0,
    on_time_submission_rate: submissionsKnown ? submitted.length ? submitted.filter(sheet => sheet.submitted_at.slice(0, 10) < sheet.time_period.end_date).length / submitted.length * 100 : 0 : null,
    top_users_by_hours: users.slice(0, 10) };
}

const exportFields = ['id', 'tenant', 'user_id', 'user_name', 'period_id', 'approval_status', 'submitted_at', 'approved_at', 'approved_by',
  'notes', 'created_at', 'updated_at', 'total_hours', 'billable_hours', 'entry_count', 'time_period', 'summary', 'time_entries', 'comments'];

export async function exportTimeSheetProjections(sheets: any[], options: {
  format?: 'csv' | 'json' | 'xlsx'; fields?: string[]; group_by?: 'user' | 'period' | 'status' | 'none'; include_time_entries?: boolean; include_comments?: boolean;
}) {
  const fields = [...new Set(options.fields ?? exportFields)].filter(field =>
    (field !== 'time_entries' || options.include_time_entries) && (field !== 'comments' || options.include_comments));
  if (fields.some(field => !exportFields.includes(field))) throw new Error('Unknown timesheet export field');
  const groupField = options.group_by === 'user' ? 'user_id' : options.group_by === 'period' ? 'period_id' : options.group_by === 'status' ? 'approval_status' : undefined;
  const groups = new Map<string, any[]>();
  for (const sheet of sheets) {
    const key = groupField ? sheet[groupField] : 'Time sheets';
    const row = Object.fromEntries(fields.map(field => [field, sheet[field] ?? null]));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  if (options.format === 'json') return groupField ? Object.fromEntries(groups) : groups.get('Time sheets') ?? [];
  const cell = (value: any) => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : value;
  if (options.format === 'xlsx') {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.default.Workbook();
    if (!groups.size) groups.set('Time sheets', []);
    let index = 0;
    for (const [key, rows] of groups) {
      // UUID groups exceed Excel's name limit; the stable index prevents a
      // collision after truncation. Keep the full group key in a data column.
      const name = `${++index} ${key}`.replace(/[\\/*?:\[\]]/g, '_').slice(0, 31);
      const worksheet = workbook.addWorksheet(name);
      worksheet.addRow(groupField ? ['group', ...fields] : fields);
      for (const row of rows) worksheet.addRow([...(groupField ? [key] : []), ...fields.map(field => cell(row[field]))]);
      worksheet.getRow(1).font = { bold: true };
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
  const csv = (value: any) => {
    let text = String(cell(value));
    if (/^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [[...(groupField ? ['group'] : []), ...fields].map(csv).join(','), ...[...groups].flatMap(([key, rows]) =>
    rows.map(row => [...(groupField ? [key] : []), ...fields.map(field => row[field])].map(csv).join(',')))].join('\r\n');
}

/** Collection operations consume permission-projected entries only. Keeping
 * predicates here prevents hidden values from leaking through counts or sorts. */
export function filterVisibleTimeEntries(entries: any[], filters: Record<string, any> = {}, search?: { query?: string; fields?: string[] }) {
  const exact = ['user_id', 'work_item_id', 'work_item_type', 'service_id', 'approval_status', 'time_sheet_id', 'contract_line_id', 'client_id'];
  const arrays: Record<string, string> = { user_ids: 'user_id', work_item_types: 'work_item_type', service_ids: 'service_id', approval_statuses: 'approval_status' };
  return entries.filter(entry => {
    for (const field of exact) if (filters[field] != null && entry[field] !== filters[field]) return false;
    for (const [filter, field] of Object.entries(arrays)) if (filters[filter]?.length && !filters[filter].includes(entry[field])) return false;
    const billable = filters.is_billable ?? (filters.billable_only ? true : undefined);
    if (billable !== undefined && entry.is_billable !== billable) return false;
    for (const [filter, field, lower] of [
      ['start_time_from', 'start_time', true], ['start_time_to', 'start_time', false],
      ['end_time_from', 'end_time', true], ['end_time_to', 'end_time', false],
      ['date_from', 'work_date', true], ['date_to', 'work_date', false],
    ] as const) {
      if (!filters[filter]) continue;
      const value = field === 'work_date' ? entry[field] : Date.parse(entry[field]);
      const boundary = field === 'work_date' ? filters[filter] : Date.parse(filters[filter]);
      if (value == null || (lower ? value < boundary : value > boundary)) return false;
    }
    if (filters.duration_min != null && entry.elapsed_minutes < filters.duration_min) return false;
    if (filters.duration_max != null && entry.elapsed_minutes > filters.duration_max) return false;
    if (search?.query) {
      const fields = search.fields?.length ? search.fields : ['notes'];
      const allowed = new Set(['notes', 'work_item_title', 'user_name', 'service_name']);
      const needle = search.query.toLocaleLowerCase();
      if (!fields.some(field => allowed.has(field) && typeof entry[field] === 'string' && entry[field].toLocaleLowerCase().includes(needle))) return false;
    }
    return true;
  });
}

export function sortVisibleTimeEntries(entries: any[], sort = 'start_time', order = 'desc') {
  const fields = new Set(['entry_id', 'start_time', 'end_time', 'work_date', 'created_at', 'updated_at', 'user_id', 'work_item_id',
    'work_item_type', 'approval_status', 'notes', 'service_id', 'billable_duration', 'duration_hours', 'elapsed_minutes', 'user_name', 'service_name']);
  const field = fields.has(sort) ? sort : 'start_time', direction = order === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    const left = a[field], right = b[field];
    const compared = left == null ? right == null ? 0 : 1 : right == null ? -1 : typeof left === 'number' && typeof right === 'number'
      ? left - right : String(left).localeCompare(String(right));
    return direction * compared || a.entry_id.localeCompare(b.entry_id);
  });
}

export function visibleTimeEntryStatistics(entries: any[], now = new Date()) {
  const totalMinutes = entries.reduce((sum, entry) => sum + entry.elapsed_minutes, 0);
  const billingVisible = entries.every(entry => typeof entry.is_billable === 'boolean' && typeof entry.billable_duration === 'number');
  const billableMinutes = billingVisible ? entries.reduce((sum, entry) => sum + Number(entry.billable_duration), 0) : null;
  const group = (field: string) => Object.fromEntries(entries.reduce((counts, entry) => {
    if (entry[field] != null && entry[field] !== '') counts.set(String(entry[field]), (counts.get(String(entry[field])) ?? 0) + 1);
    return counts;
  }, new Map<string, number>()));
  const work = new Map<string, any>();
  for (const entry of entries) {
    if (!entry.work_item_id) continue;
    const key = `${entry.work_item_type}:${entry.work_item_id}`;
    const item = work.get(key) ?? { work_item_id: entry.work_item_id, work_item_title: entry.work_item_title, total_hours: 0, entry_count: 0 };
    item.total_hours += entry.elapsed_minutes / 60; item.entry_count += 1; work.set(key, item);
  }
  const week = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  week.setUTCDate(week.getUTCDate() - (week.getUTCDay() + 6) % 7);
  const month = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  return {
    total_entries: entries.length, total_hours: totalMinutes / 60,
    total_billable_hours: billableMinutes === null ? null : billableMinutes / 60,
    total_non_billable_hours: billableMinutes === null ? null : Math.max(0, totalMinutes - billableMinutes) / 60,
    billable_percentage: billableMinutes === null ? null : totalMinutes ? Math.round(billableMinutes / totalMinutes * 100) : 0,
    average_entry_duration: entries.length ? totalMinutes / entries.length : 0,
    entries_this_week: entries.filter(entry => Date.parse(entry.start_time) >= week.getTime()).length,
    entries_this_month: entries.filter(entry => Date.parse(entry.start_time) >= month).length,
    total_revenue: billingVisible ? 0 : null,
    entries_by_type: group('work_item_type'), entries_by_status: group('approval_status'),
    entries_by_user: group('user_name'), entries_by_service: group('service_name'),
    top_work_items: [...work.values()].sort((a, b) => b.total_hours - a.total_hours || a.work_item_id.localeCompare(b.work_item_id)).slice(0, 5),
  };
}

export function visibleTimeEntriesCsv(entries: any[]) {
  const cell = (value: unknown) => {
    let text = value == null ? '' : String(value);
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const rows = entries.map(entry => [entry.work_date, entry.user_name, entry.work_item_title, entry.service_name,
    entry.start_time, entry.end_time, entry.duration_hours, entry.is_billable == null ? null : entry.is_billable ? 'Yes' : 'No', entry.notes, entry.approval_status]);
  return [['Date', 'User', 'Work Item', 'Service', 'Start Time', 'End Time', 'Duration (Hours)', 'Billable', 'Notes', 'Approval Status'], ...rows]
    .map(row => row.map(cell).join(',')).join('\n');
}

function buildPeriodTimestamp(periodStart, dayOffset, hour) {
    const timestamp = new Date(periodStart);
    timestamp.setUTCDate(timestamp.getUTCDate() + dayOffset);
    timestamp.setUTCHours(hour, 39, 14, 459);
    return timestamp;
}

function buildEntryWindow(periodStart, dayOffset, startHour, endHour) {
    const start = buildPeriodTimestamp(periodStart, dayOffset, startHour);
    const end = buildPeriodTimestamp(periodStart, dayOffset, endHour);

    return {
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        work_date: start.toISOString().slice(0, 10)
    };
}

exports.seed = async function (knex) {
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    const glinda = await knex('users')
        .where({
            tenant: tenant.tenant,
            username: 'glinda'
        })
        .select('user_id')
        .first();

    const submittedTimeSheet = await knex('time_sheets as ts')
        .join('time_periods as tp', function joinPeriods() {
            this.on('ts.period_id', '=', 'tp.period_id')
                .andOn('ts.tenant', '=', 'tp.tenant');
        })
        .where({
            'ts.tenant': tenant.tenant,
            'ts.approval_status': 'SUBMITTED'
        })
        .orderBy('tp.start_date', 'desc')
        .select('ts.id', 'tp.start_date', 'tp.end_date')
        .first();

    const whiteRabbitTicket = await knex('tickets')
        .where({
            tenant: tenant.tenant,
            title: 'Missing White Rabbit'
        })
        .select('ticket_id')
        .first();

    const emeraldCityTicket = await knex('tickets')
        .where({
            tenant: tenant.tenant,
            title: 'Enhance Emerald City Gardens'
        })
        .select('ticket_id')
        .first();

    if (!glinda || !submittedTimeSheet || !whiteRabbitTicket || !emeraldCityTicket) return;

    const dayOne = buildEntryWindow(submittedTimeSheet.start_date, 0, 9, 11);
    const dayTwo = buildEntryWindow(submittedTimeSheet.start_date, 1, 9, 11);
    const dayThree = buildEntryWindow(submittedTimeSheet.start_date, 2, 8, 12);
    const dayFour = buildEntryWindow(submittedTimeSheet.start_date, 3, 9, 11);
    const dayFive = buildEntryWindow(submittedTimeSheet.start_date, 4, 9, 12);
    const secondEntryDayOne = buildEntryWindow(submittedTimeSheet.start_date, 4, 10, 13);

    return knex('time_entries').insert([
        {
            tenant: tenant.tenant,
            user_id: glinda.user_id,
            ...dayOne,
            work_timezone: 'UTC',
            notes: 'Searched for White Rabbit in the Tulgey Wood',
            work_item_id: whiteRabbitTicket.ticket_id,
            billable_duration: 120,
            work_item_type: 'ticket',
            approval_status: 'SUBMITTED',
            time_sheet_id: submittedTimeSheet.id
        },
        {
            tenant: tenant.tenant,
            user_id: glinda.user_id,
            ...dayTwo,
            work_timezone: 'UTC',
            notes: 'Moving on to March Hares Residence',
            work_item_id: whiteRabbitTicket.ticket_id,
            billable_duration: 120,
            work_item_type: 'ticket',
            approval_status: 'SUBMITTED',
            time_sheet_id: submittedTimeSheet.id
        },
        {
            tenant: tenant.tenant,
            user_id: glinda.user_id,
            ...dayThree,
            work_timezone: 'UTC',
            notes: 'Repaired cracks in the Yellow Brick Road near Munchkinland',
            work_item_id: whiteRabbitTicket.ticket_id,
            billable_duration: 240,
            work_item_type: 'ticket',
            approval_status: 'SUBMITTED',
            time_sheet_id: submittedTimeSheet.id
        },
        {
            tenant: tenant.tenant,
            user_id: glinda.user_id,
            ...dayFour,
            work_timezone: 'UTC',
            notes: 'Administrative tasks',
            work_item_id: null,
            billable_duration: 0,
            work_item_type: 'non_billable_category',
            approval_status: 'SUBMITTED',
            time_sheet_id: submittedTimeSheet.id
        },
        {
            tenant: tenant.tenant,
            user_id: glinda.user_id,
            ...dayFive,
            work_timezone: 'UTC',
            notes: 'Conducted survey of uncharted areas in Wonderland',
            work_item_id: whiteRabbitTicket.ticket_id,
            billable_duration: 180,
            work_item_type: 'ticket',
            approval_status: 'SUBMITTED',
            time_sheet_id: submittedTimeSheet.id
        },
        {
            tenant: tenant.tenant,
            user_id: glinda.user_id,
            ...secondEntryDayOne,
            work_timezone: 'UTC',
            notes: 'Worked on enhancing Emerald City Gardens',
            work_item_id: emeraldCityTicket.ticket_id,
            billable_duration: 180,
            work_item_type: 'ticket',
            approval_status: 'SUBMITTED',
            time_sheet_id: submittedTimeSheet.id
        }
    ]);
};

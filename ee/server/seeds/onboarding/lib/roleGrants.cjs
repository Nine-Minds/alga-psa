const ALL_MSP = 'ALL_MSP';

module.exports = {
    psa: {
        msp: {
            Admin: ALL_MSP,
            Finance: [
                'asset:read:msp',
                'billing:create:msp', 'billing:read:msp', 'billing:update:msp', 'billing:delete:msp',
                'client:create:msp', 'client:read:msp', 'client:update:msp', 'client:delete:msp',
                'contact:create:msp', 'contact:read:msp', 'contact:update:msp', 'contact:delete:msp',
                'credit:create:msp', 'credit:read:msp', 'credit:update:msp', 'credit:delete:msp', 'credit:transfer:msp', 'credit:reconcile:msp', 'financial:create:msp', 'financial:read:msp', 'financial:update:msp', 'financial:delete:msp', 'financial:transfer:msp',
                'document:create:msp', 'document:read:msp', 'document:update:msp', 'document:delete:msp',
                'interaction:create:msp', 'interaction:read:msp', 'interaction:update:msp', 'interaction:delete:msp',
                'invoice:create:msp', 'invoice:read:msp', 'invoice:update:msp', 'invoice:delete:msp', 'invoice:generate:msp', 'invoice:finalize:msp', 'invoice:send:msp', 'invoice:void:msp',
                'profile:create:msp', 'profile:read:msp', 'profile:update:msp',
                'project:read:msp', 'project:update:msp',
                'project_task:read:msp', 'project_task:update:msp',
                'reports:read:msp',
                'tag:create:msp', 'tag:read:msp',
                'technician_dispatch:read:msp',
                'ticket:read:msp', 'ticket:update:msp',
                'timeentry:create:msp', 'timeentry:read:msp', 'timeentry:update:msp', 'timeentry:delete:msp',
                'timesheet:read:msp', 'timesheet:read_all:msp', 'timesheet:submit:msp',
                'user:read:msp',
                'user_schedule:read:msp',
                'billing_settings:create:msp', 'billing_settings:read:msp', 'billing_settings:update:msp', 'billing_settings:delete:msp'
            ],
            Manager: [
                'asset:create:msp', 'asset:read:msp', 'asset:update:msp',
                'client:read:msp', 'client:delete:msp',
                'contact:read:msp', 'contact:delete:msp',
                'document:create:msp', 'document:read:msp', 'document:update:msp',
                'interaction:create:msp', 'interaction:read:msp', 'interaction:update:msp',
                'profile:read:msp', 'profile:update:msp',
                'project:read:msp',
                'project_task:create:msp', 'project_task:read:msp', 'project_task:update:msp',
                'reports:read:msp',
                'tag:create:msp', 'tag:read:msp', 'tag:update:msp',
                'technician_dispatch:read:msp',
                'ticket:create:msp', 'ticket:read:msp', 'ticket:update:msp',
                'timeentry:create:msp', 'timeentry:read:msp', 'timeentry:update:msp',
                'timesheet:read:msp', 'timesheet:update:msp', 'timesheet:submit:msp', 'timesheet:approve:msp', 'timesheet:reverse:msp',
                'user:read:msp',
                'user_schedule:read:msp',
                'user_settings:read:msp',
                'ticket_settings:read:msp',
                'sla_policy:read:msp'
            ],
            Technician: [
                'asset:create:msp', 'asset:read:msp', 'asset:update:msp',
                'client:read:msp', 'client:delete:msp',
                'contact:read:msp', 'contact:delete:msp',
                'document:create:msp', 'document:read:msp', 'document:update:msp',
                'interaction:create:msp', 'interaction:read:msp', 'interaction:update:msp',
                'profile:read:msp', 'profile:update:msp',
                'project:read:msp',
                'project_task:create:msp', 'project_task:read:msp', 'project_task:update:msp',
                'reports:read:msp',
                'tag:create:msp', 'tag:read:msp', 'tag:update:msp',
                'technician_dispatch:read:msp',
                'ticket:create:msp', 'ticket:read:msp', 'ticket:update:msp',
                'timeentry:create:msp', 'timeentry:read:msp', 'timeentry:update:msp',
                'timesheet:read:msp', 'timesheet:update:msp', 'timesheet:read_all:msp', 'timesheet:submit:msp',
                'user_schedule:read:msp',
                'ticket_settings:read:msp',
                'sla_policy:read:msp'
            ],
            'Project Manager': [
                'asset:read:msp',
                'billing:read:msp',
                'client:create:msp', 'client:read:msp', 'client:update:msp',
                'contact:create:msp', 'contact:read:msp', 'contact:update:msp',
                'document:create:msp', 'document:read:msp', 'document:update:msp',
                'interaction:create:msp', 'interaction:read:msp', 'interaction:update:msp',
                'invoice:read:msp',
                'profile:read:msp', 'profile:update:msp',
                'project:create:msp', 'project:read:msp', 'project:update:msp', 'project:delete:msp',
                'project_task:create:msp', 'project_task:read:msp', 'project_task:update:msp', 'project_task:delete:msp',
                'reports:read:msp',
                'tag:create:msp', 'tag:read:msp', 'tag:update:msp',
                'technician_dispatch:read:msp',
                'ticket:create:msp', 'ticket:read:msp', 'ticket:update:msp',
                'timeentry:create:msp', 'timeentry:read:msp', 'timeentry:update:msp',
                'timesheet:read:msp', 'timesheet:update:msp', 'timesheet:read_all:msp', 'timesheet:submit:msp', 'timesheet:approve:msp', 'timesheet:reverse:msp',
                'user:read:msp', 'user:invite:msp',
                'user_schedule:read:msp',
                'user_settings:read:msp',
                'billing_settings:read:msp',
                'sla_policy:read:msp', 'sla_policy:update:msp'
            ],
            Dispatcher: [
                'asset:read:msp',
                'client:read:msp',
                'contact:read:msp',
                'document:read:msp',
                'interaction:create:msp', 'interaction:read:msp', 'interaction:update:msp',
                'profile:read:msp',
                'project:read:msp',
                'project_task:read:msp',
                'reports:read:msp',
                'tag:create:msp', 'tag:read:msp', 'tag:update:msp',
                'technician_dispatch:create:msp', 'technician_dispatch:read:msp', 'technician_dispatch:update:msp',
                'ticket:create:msp', 'ticket:read:msp', 'ticket:update:msp',
                'timeentry:read:msp',
                'timesheet:read:msp',
                'user:read:msp',
                'user_schedule:create:msp', 'user_schedule:read:msp', 'user_schedule:update:msp',
                'user_settings:read:msp'
            ]
        },
        client: {
            Admin: [
                'billing:create:client', 'billing:read:client', 'billing:update:client',
                'client:create:client', 'client:read:client', 'client:update:client', 'client:delete:client',
                'project:create:client', 'project:read:client', 'project:update:client', 'project:delete:client',
                'ticket:create:client', 'ticket:read:client', 'ticket:update:client',
                'time_management:create:client', 'time_management:read:client', 'time_management:update:client', 'time_management:delete:client',
                'user:create:client', 'user:read:client', 'user:update:client', 'user:delete:client', 'user:reset_password:client',
                'settings:create:client', 'settings:read:client', 'settings:update:client', 'settings:delete:client',
                'document:create:client', 'document:read:client', 'document:update:client'
            ],
            Finance: [
                'billing:read:client',
                'client:create:client', 'client:read:client', 'client:update:client',
                'project:read:client',
                'ticket:create:client', 'ticket:read:client', 'ticket:update:client',
                'time_management:read:client',
                'user:read:client',
                'settings:read:client',
                'document:create:client', 'document:read:client', 'document:update:client'
            ],
            User: [
                'client:create:client', 'client:read:client', 'client:update:client',
                'project:read:client',
                'ticket:create:client', 'ticket:read:client', 'ticket:update:client',
                'time_management:read:client',
                'document:create:client', 'document:read:client', 'document:update:client'
            ]
        }
    }
};

module.exports.ALL_MSP = ALL_MSP;

/**
 * Backfill dedicated contract template tables from legacy combined schema.
 *
 * This migration copies any legacy template data (rows where `contracts.is_template = true`)
 * into the new `contract_template_*` tables so that subsequent code can rely solely on the
 * separated structure. After backfill, `contracts` is free to represent only client-specific
 * agreements while templates live independently. Original UUIDs are preserved to maintain
 * referential integrity with client contract records.
 *
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.transaction(async (trx) => {
    // Contract templates
    const hasLegacyTemplateFlag = await trx.schema.hasColumn('contracts', 'is_template');
    const hasLegacyTemplateStatus = await trx.schema.hasColumn('contracts', 'status');
    const hasLegacyTemplateMetadata = await trx.schema.hasColumn('contracts', 'template_metadata');

    if (hasLegacyTemplateFlag) {
      await trx
        .insert(function insertTemplates() {
          const templateStatusExpr = hasLegacyTemplateStatus
            ? trx.ref('c.status')
            : trx.raw(`CASE WHEN c.is_active = true THEN 'active' ELSE 'inactive' END`);
          const templateMetadataExpr = hasLegacyTemplateMetadata
            ? trx.ref('c.template_metadata')
            : trx.raw('NULL::jsonb');

          this.select({
            tenant: 'c.tenant',
            template_id: 'c.contract_id',
            template_name: 'c.contract_name',
            template_description: 'c.contract_description',
            default_billing_frequency: 'c.billing_frequency',
            template_status: templateStatusExpr,
            template_metadata: templateMetadataExpr,
            created_at: 'c.created_at',
            updated_at: 'c.updated_at',
          })
            .from({ c: 'contracts' })
            .where('c.is_template', true);
        })
        .into('contract_templates')
        .onConflict(['tenant', 'template_id'])
        .ignore();
    }

    // Template lines
    const hasLegacyTemplateLineFlag = await trx.schema.hasColumn('contract_lines', 'is_template');
    const hasLegacyTemplateTerms = await trx.schema.hasTable('contract_line_template_terms');

    if (hasLegacyTemplateLineFlag) {
      await trx
        .insert(function insertTemplateLines() {
          const query = this.select({
            tenant: 'cl.tenant',
            template_line_id: 'cl.contract_line_id',
            template_id: 'map.contract_id',
            template_line_name: 'cl.contract_line_name',
            description: 'cl.description',
            billing_frequency: 'cl.billing_frequency',
            line_type: 'cl.contract_line_type',
            service_category: 'cl.service_category',
            is_active: 'cl.is_active',
            enable_overtime: hasLegacyTemplateTerms
              ? knex.raw('COALESCE(terms.enable_overtime, cl.enable_overtime, false)')
              : knex.raw('COALESCE(cl.enable_overtime, false)'),
            overtime_rate: hasLegacyTemplateTerms
              ? knex.raw('COALESCE(terms.overtime_rate, cl.overtime_rate)')
              : knex.raw('cl.overtime_rate'),
            overtime_threshold: hasLegacyTemplateTerms
              ? knex.raw('COALESCE(terms.overtime_threshold, cl.overtime_threshold)')
              : knex.raw('cl.overtime_threshold'),
            enable_after_hours_rate: hasLegacyTemplateTerms
              ? knex.raw('COALESCE(terms.enable_after_hours_rate, cl.enable_after_hours_rate, false)')
              : knex.raw('COALESCE(cl.enable_after_hours_rate, false)'),
            after_hours_multiplier: hasLegacyTemplateTerms
              ? knex.raw('COALESCE(terms.after_hours_multiplier, cl.after_hours_multiplier)')
              : knex.raw('cl.after_hours_multiplier'),
            minimum_billable_time: hasLegacyTemplateTerms ? knex.ref('terms.minimum_billable_time') : knex.raw('NULL'),
            round_up_to_nearest: hasLegacyTemplateTerms ? knex.ref('terms.round_up_to_nearest') : knex.raw('NULL'),
            created_at: 'cl.created_at',
            updated_at: 'cl.updated_at',
          }).from({ map: 'contract_line_mappings' })
            .join({ cl: 'contract_lines' }, function joinLines() {
              this.on('map.contract_line_id', '=', 'cl.contract_line_id').andOn(
                'map.tenant',
                '=',
                'cl.tenant'
              );
            })
            .join({ c: 'contracts' }, function joinTemplates() {
              this.on('map.contract_id', '=', 'c.contract_id').andOn('map.tenant', '=', 'c.tenant');
            });

          if (hasLegacyTemplateTerms) {
            query.leftJoin({ terms: 'contract_line_template_terms' }, function joinTerms() {
              this.on('terms.contract_line_id', '=', 'cl.contract_line_id').andOn(
                'terms.tenant',
                '=',
                'cl.tenant'
              );
            });
          }

          query.where('c.is_template', true);
        })
        .into('contract_template_lines')
        .onConflict(['tenant', 'template_line_id'])
        .ignore();
    }

    if (hasLegacyTemplateFlag) {
      // Line mappings
      await trx
        .insert(function insertMappings() {
          this.select({
            tenant: 'map.tenant',
            template_id: 'map.contract_id',
            template_line_id: 'map.contract_line_id',
            display_order: 'map.display_order',
            custom_rate: 'map.custom_rate',
            created_at: 'map.created_at',
          })
            .from({ map: 'contract_line_mappings' })
            .join({ c: 'contracts' }, function joinContracts() {
              this.on('map.contract_id', '=', 'c.contract_id').andOn('map.tenant', '=', 'c.tenant');
            })
            .where('c.is_template', true);
        })
        .into('contract_template_line_mappings')
        .onConflict(['tenant', 'template_id', 'template_line_id'])
        .ignore();

      // Template services
      await trx
        .insert(function insertServices() {
          this.select({
            tenant: 'svc.tenant',
            template_line_id: 'svc.contract_line_id',
            service_id: 'svc.service_id',
            quantity: knex.raw('COALESCE(tpl.default_quantity, svc.quantity)'),
            custom_rate: 'svc.custom_rate',
            notes: 'tpl.notes',
            display_order: knex.raw('COALESCE(tpl.display_order, 0)'),
            created_at: knex.raw('COALESCE(tpl.created_at, NOW())'),
            updated_at: knex.raw('COALESCE(tpl.updated_at, NOW())'),
          })
            .from({ svc: 'contract_line_services' })
            .join({ map: 'contract_line_mappings' }, function joinMappings() {
              this.on('svc.contract_line_id', '=', 'map.contract_line_id').andOn(
                'svc.tenant',
                '=',
                'map.tenant'
              );
            })
            .join({ c: 'contracts' }, function joinTemplates() {
              this.on('map.contract_id', '=', 'c.contract_id').andOn('map.tenant', '=', 'c.tenant');
            })
            .leftJoin({ tpl: 'contract_template_services' }, function joinTemplateSvc() {
              this.on('tpl.contract_line_id', '=', 'svc.contract_line_id')
                .andOn('tpl.service_id', '=', 'svc.service_id')
                .andOn('tpl.tenant', '=', 'svc.tenant');
            })
            .where('c.is_template', true);
        })
        .into('contract_template_line_services')
        .onConflict(['tenant', 'template_line_id', 'service_id'])
        .ignore();

      // Service configuration + overlays
      await trx
        .insert(function insertServiceConfig() {
        this.select({
          tenant: 'cfg.tenant',
          config_id: 'cfg.config_id',
          template_line_id: 'cfg.contract_line_id',
          service_id: 'cfg.service_id',
          configuration_type: 'cfg.configuration_type',
          custom_rate: 'cfg.custom_rate',
          quantity: 'cfg.quantity',
          created_at: 'cfg.created_at',
          updated_at: 'cfg.updated_at',
        })
          .from({ cfg: 'contract_line_service_configuration' })
          .join({ map: 'contract_line_mappings' }, function joinMappings() {
            this.on('cfg.contract_line_id', '=', 'map.contract_line_id').andOn(
              'cfg.tenant',
              '=',
              'map.tenant'
            );
          })
          .join({ c: 'contracts' }, function joinTemplates() {
            this.on('map.contract_id', '=', 'c.contract_id').andOn('map.tenant', '=', 'c.tenant');
          })
          .where('c.is_template', true);
      })
      .into('contract_template_line_service_configuration')
      .onConflict(['tenant', 'config_id'])
      .ignore();

    await trx
      .insert(function insertBucket() {
        this.select({
          tenant: 'src.tenant',
          config_id: 'src.config_id',
          total_minutes: 'src.total_minutes',
          billing_period: 'src.billing_period',
          overage_rate: 'src.overage_rate',
          allow_rollover: 'src.allow_rollover',
          created_at: 'src.created_at',
          updated_at: 'src.updated_at',
        })
          .from({ src: 'contract_line_service_bucket_config' })
          .join({ cfg: 'contract_line_service_configuration' }, function joinCfg() {
            this.on('src.config_id', '=', 'cfg.config_id').andOn('src.tenant', '=', 'cfg.tenant');
          })
          .join({ map: 'contract_line_mappings' }, function joinMappings() {
            this.on('cfg.contract_line_id', '=', 'map.contract_line_id').andOn(
              'cfg.tenant',
              '=',
              'map.tenant'
            );
          })
          .join({ c: 'contracts' }, function joinContracts() {
            this.on('map.contract_id', '=', 'c.contract_id').andOn('map.tenant', '=', 'c.tenant');
          })
          .where('c.is_template', true);
      })
      .into('contract_template_line_service_bucket_config')
      .onConflict(['tenant', 'config_id'])
      .ignore();

    await trx
      .insert(function insertHourly() {
        this.select({
          tenant: 'src.tenant',
          config_id: 'src.config_id',
          minimum_billable_time: 'src.minimum_billable_time',
          round_up_to_nearest: 'src.round_up_to_nearest',
          enable_overtime: 'src.enable_overtime',
          overtime_rate: 'src.overtime_rate',
          overtime_threshold: 'src.overtime_threshold',
          enable_after_hours_rate: 'src.enable_after_hours_rate',
          after_hours_multiplier: 'src.after_hours_multiplier',
          created_at: 'src.created_at',
          updated_at: 'src.updated_at',
        })
          .from({ src: 'contract_line_service_hourly_config' })
          .join({ cfg: 'contract_line_service_configuration' }, function joinCfg() {
            this.on('src.config_id', '=', 'cfg.config_id').andOn('src.tenant', '=', 'cfg.tenant');
          })
          .join({ map: 'contract_line_mappings' }, function joinMappings() {
            this.on('cfg.contract_line_id', '=', 'map.contract_line_id').andOn(
              'cfg.tenant',
              '=',
              'map.tenant'
            );
          })
          .join({ c: 'contracts' }, function joinContracts() {
            this.on('map.contract_id', '=', 'c.contract_id').andOn('map.tenant', '=', 'c.tenant');
          })
          .where('c.is_template', true);
      })
      .into('contract_template_line_service_hourly_config')
      .onConflict(['tenant', 'config_id'])
      .ignore();

      await trx
        .insert(function insertUsage() {
        this.select({
          tenant: 'src.tenant',
          config_id: 'src.config_id',
          unit_of_measure: 'src.unit_of_measure',
          enable_tiered_pricing: 'src.enable_tiered_pricing',
          created_at: 'src.created_at',
          updated_at: 'src.updated_at',
        })
          .from({ src: 'contract_line_service_usage_config' })
          .join({ cfg: 'contract_line_service_configuration' }, function joinCfg() {
            this.on('src.config_id', '=', 'cfg.config_id').andOn('src.tenant', '=', 'cfg.tenant');
          })
          .join({ map: 'contract_line_mappings' }, function joinMappings() {
            this.on('cfg.contract_line_id', '=', 'map.contract_line_id').andOn(
              'cfg.tenant',
              '=',
              'map.tenant'
            );
          })
          .join({ c: 'contracts' }, function joinContracts() {
            this.on('map.contract_id', '=', 'c.contract_id').andOn('map.tenant', '=', 'c.tenant');
          })
          .where('c.is_template', true);
      })
      .into('contract_template_line_service_usage_config')
      .onConflict(['tenant', 'config_id'])
      .ignore();

      await trx
        .insert(function insertDefaults() {
        this.select({
          tenant: 'def.tenant',
          default_id: 'def.default_id',
          template_line_id: 'def.contract_line_id',
          service_id: 'def.service_id',
          line_type: 'def.line_type',
          default_tax_behavior: 'def.default_tax_behavior',
          metadata: 'def.metadata',
          created_at: 'def.created_at',
          updated_at: 'def.updated_at',
        })
          .from({ def: 'contract_line_service_defaults' })
          .join({ map: 'contract_line_mappings' }, function joinMappings() {
            this.on('def.contract_line_id', '=', 'map.contract_line_id').andOn(
              'def.tenant',
              '=',
              'map.tenant'
            );
          })
          .join({ c: 'contracts' }, function joinContracts() {
            this.on('map.contract_id', '=', 'c.contract_id').andOn('map.tenant', '=', 'c.tenant');
          })
          .where('c.is_template', true);
      })
      .into('contract_template_line_defaults')
      .onConflict(['tenant', 'default_id'])
      .ignore();

      if (hasLegacyTemplateTerms) {
        await trx
          .insert(function insertTerms() {
            this.select({
              tenant: 'terms.tenant',
              template_line_id: 'terms.contract_line_id',
              billing_frequency: 'terms.billing_frequency',
              enable_overtime: 'terms.enable_overtime',
              overtime_rate: 'terms.overtime_rate',
              overtime_threshold: 'terms.overtime_threshold',
              enable_after_hours_rate: 'terms.enable_after_hours_rate',
              after_hours_multiplier: 'terms.after_hours_multiplier',
              minimum_billable_time: 'terms.minimum_billable_time',
              round_up_to_nearest: 'terms.round_up_to_nearest',
              created_at: 'terms.created_at',
              updated_at: 'terms.updated_at',
            })
              .from({ terms: 'contract_line_template_terms' })
              .join({ map: 'contract_line_mappings' }, function joinMappings() {
                this.on('terms.contract_line_id', '=', 'map.contract_line_id').andOn(
                  'terms.tenant',
                  '=',
                  'map.tenant'
                );
              })
              .join({ c: 'contracts' }, function joinContracts() {
                this.on('map.contract_id', '=', 'c.contract_id').andOn('map.tenant', '=', 'c.tenant');
              })
              .where('c.is_template', true);
          })
          .into('contract_template_line_terms')
          .onConflict(['tenant', 'template_line_id'])
          .ignore();
      }
    }

    if (hasLegacyTemplateFlag) {
      await trx
        .insert(function insertFixedConfig() {
          this.select({
            tenant: 'cfg.tenant',
            template_line_id: 'cfg.contract_line_id',
            base_rate: 'cfg.base_rate',
            enable_proration: 'cfg.enable_proration',
            billing_cycle_alignment: 'cfg.billing_cycle_alignment',
            created_at: 'cfg.created_at',
            updated_at: 'cfg.updated_at',
          })
            .from({ cfg: 'contract_line_fixed_config' })
            .join({ map: 'contract_line_mappings' }, function joinMappings() {
              this.on('cfg.contract_line_id', '=', 'map.contract_line_id').andOn(
                'cfg.tenant',
                '=',
                'map.tenant'
              );
            })
            .join({ c: 'contracts' }, function joinContracts() {
              this.on('map.contract_id', '=', 'c.contract_id').andOn('map.tenant', '=', 'c.tenant');
            })
            .where('c.is_template', true);
        })
        .into('contract_template_line_fixed_config')
        .onConflict(['tenant', 'template_line_id'])
        .ignore();

      await trx
        .insert(function insertPricingSchedules() {
          this.select({
            tenant: 'ps.tenant',
            schedule_id: 'ps.schedule_id',
            template_id: 'ps.contract_id',
            effective_date: 'ps.effective_date',
            end_date: 'ps.end_date',
            duration_value: 'ps.duration_value',
            duration_unit: 'ps.duration_unit',
            custom_rate: 'ps.custom_rate',
            notes: 'ps.notes',
            created_by: 'ps.created_by',
            updated_by: 'ps.updated_by',
            created_at: 'ps.created_at',
            updated_at: 'ps.updated_at',
          })
            .from({ ps: 'contract_pricing_schedules' })
            .join({ c: 'contracts' }, function joinContracts() {
              this.on('ps.contract_id', '=', 'c.contract_id').andOn('ps.tenant', '=', 'c.tenant');
            })
            .where('c.is_template', true);
        })
        .into('contract_template_pricing_schedules')
        .onConflict(['tenant', 'schedule_id'])
        .ignore();
    }
  });
};

/**
 * Reverting simply clears the new template tables (the legacy combined schema remains).
 *
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.transaction(async (trx) => {
    const tables = [
      'contract_template_pricing_schedules',
      'contract_template_line_fixed_config',
      'contract_template_line_terms',
      'contract_template_line_defaults',
      'contract_template_line_service_usage_config',
      'contract_template_line_service_hourly_config',
      'contract_template_line_service_bucket_config',
      'contract_template_line_service_configuration',
      'contract_template_line_services',
      'contract_template_line_mappings',
      'contract_template_lines',
      'contract_templates',
    ];

    for (const table of tables) {
      await trx(table).del();
    }
  });
};

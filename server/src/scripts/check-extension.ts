import { createTenantKnex } from '../lib/db';
import { ExtensionRegistry } from '@ee/lib/extensions/registry';

async function checkExtensions() {
  try {
    const { knex } = await createTenantKnex();
    
    // Get first tenant
    const firstTenant = await knex('tenants').select('tenant').first();
    if (!firstTenant) {
      console.log('No tenants found');
      await knex.destroy();
      return;
    }
    
    const registry = new ExtensionRegistry(knex);
    
    // List all extensions
    const extensions = await registry.listExtensions({ tenant_id: firstTenant.tenant });
    console.log(`\nExtensions for tenant ${firstTenant.tenant}:`);
    console.log('Total extensions:', extensions.length);
    
    // Check for SoftwareOne extension
    const swoneExt = extensions.find(ext => ext.id === 'com.alga.softwareone');
    if (swoneExt) {
      console.log('\nSoftwareOne Extension Found:');
      console.log('- ID:', swoneExt.id);
      console.log('- Name:', swoneExt.name);
      console.log('- Version:', swoneExt.version);
      console.log('- Enabled:', swoneExt.is_enabled);
      console.log('- Components:', swoneExt.manifest?.components?.length || 0);
      
      // Check navigation components
      const navComponents = swoneExt.manifest?.components?.filter((c: any) => c.type === 'navigation' && c.slot === 'main-nav');
      console.log('- Navigation components:', navComponents?.length || 0);
      
      if (navComponents && navComponents.length > 0) {
        console.log('\nNavigation Components:');
        navComponents.forEach((comp: any) => {
          console.log(`  - ${comp.displayName}: ${comp.component}`);
        });
      }
    } else {
      console.log('\nSoftwareOne Extension NOT FOUND');
      console.log('Available extensions:', extensions.map(e => e.id).join(', '));
    }
    
    await knex.destroy();
  } catch (error) {
    console.error('Error checking extensions:', error);
  }
}

checkExtensions();
import { withAdminTransaction } from '../server/src/lib/db/admin';

async function clearWasmBinaries() {
    console.log('Clearing WASM binaries from standard_invoice_templates table...');
    
    try {
        await withAdminTransaction(async (trx) => {
            const result = await trx('standard_invoice_templates')
                .update({ 
                    wasmBinary: null,
                    updated_at: new Date() // Update timestamp to ensure rebuild
                });
            
            console.log(`Updated ${result} template records`);
        });
        
        console.log('WASM binaries cleared successfully. Templates will be recompiled on next startup.');
    } catch (error) {
        console.error('Error clearing WASM binaries:', error);
        process.exit(1);
    }
}

// Run the script
clearWasmBinaries().then(() => {
    console.log('Done');
    process.exit(0);
}).catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
});
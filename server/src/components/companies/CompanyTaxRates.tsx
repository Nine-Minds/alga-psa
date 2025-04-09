import React, { useState, useEffect } from 'react'; // Added useState, useEffect
import { Button } from 'server/src/components/ui/Button';
import { ITaxRate, ICompanyTaxRate } from 'server/src/interfaces/billing.interfaces';
import { ITaxRegion } from 'server/src/interfaces/tax.interfaces'; // Added
import { getActiveTaxRegions } from 'server/src/lib/actions/taxSettingsActions'; // Added
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Card } from 'server/src/components/ui/Card';

interface CompanyTaxRatesProps {
    companyTaxRates: ICompanyTaxRate[];
    taxRates: ITaxRate[];
    selectedTaxRate: string;
    onSelectTaxRate: (value: string) => void;
    onAdd: () => void;
    onRemove: (taxRateId: string) => void;
}

interface TaxRateTableData {
    company_tax_rate_id: string;
    tax_rate_id: string;
    region_name: string; // Changed from region
    tax_percentage: number; // Reverted back to number
    description: string;
}

const CompanyTaxRates: React.FC<CompanyTaxRatesProps> = ({
    companyTaxRates,
    taxRates,
    selectedTaxRate,
    onSelectTaxRate,
    onAdd,
    onRemove
}) => {
   const [taxRegions, setTaxRegions] = useState<Pick<ITaxRegion, 'region_code' | 'region_name'>[]>([]);
   const [isLoadingTaxRegions, setIsLoadingTaxRegions] = useState(true);
   const [errorTaxRegions, setErrorTaxRegions] = useState<string | null>(null);

   useEffect(() => {
       const fetchTaxRegions = async () => {
           try {
               setIsLoadingTaxRegions(true);
               const regions = await getActiveTaxRegions();
               setTaxRegions(regions);
               setErrorTaxRegions(null);
           } catch (error) {
               console.error('Error loading tax regions:', error);
               setErrorTaxRegions('Failed to load tax regions.');
               setTaxRegions([]);
           } finally {
               setIsLoadingTaxRegions(false);
           }
       };
       fetchTaxRegions();
   }, []);

    const tableData: TaxRateTableData[] = companyTaxRates
        .map((companyTaxRate): TaxRateTableData => {
            const taxRate = taxRates.find(tr => tr.tax_rate_id === companyTaxRate.tax_rate_id);
            const taxRegion = taxRegions.find(reg => reg.region_code === taxRate?.region_code); // Find region name
            return {
                company_tax_rate_id: companyTaxRate.company_tax_rate_id!,
                tax_rate_id: companyTaxRate.tax_rate_id,
                region_name: taxRegion?.region_name || taxRate?.region_code || 'N/A', // Display name, fallback to code
                tax_percentage: taxRate?.tax_percentage || 0,
                description: taxRate?.description || ''
            };
        });

    const columns: ColumnDefinition<TaxRateTableData>[] = [
        {
            title: 'Region',
            dataIndex: 'region_name' // Changed from region
        },
        {
            title: 'Tax Percentage',
            dataIndex: 'tax_percentage',
            render: (value) => `${value}%`
        },
        {
            title: 'Description',
            dataIndex: 'description'
        },
        {
            title: 'Actions',
            dataIndex: 'tax_rate_id',
            width: '10%',
            render: (_, record) => (
                <Button 
                    id={`remove-tax-rate-${record.tax_rate_id}`}
                    variant="destructive"
                    size="sm"
                    onClick={() => onRemove(record.tax_rate_id)}
                >
                    Remove
                </Button>
            )
        }
    ];

    // Generate options only when taxRegions are loaded
    const taxRateOptions = isLoadingTaxRegions ? [] : taxRates.map((taxRate): { value: string; label: string } => {
       const taxRegion = taxRegions.find(reg => reg.region_code === taxRate.region_code);
       const regionLabel = taxRegion?.region_name || taxRate.region_code || 'Unknown Region';
       return {
           value: taxRate.tax_rate_id!,
           label: `${regionLabel} - ${taxRate.tax_percentage}% (${taxRate.description || 'No Description'})` // Include description
       };
    });

    return (
        <Card className="p-4">
            <h3 className="text-lg font-semibold text-[rgb(var(--color-text-900))] mb-4">
                Company Tax Rates
            </h3>
            
            <DataTable
                data={tableData}
                columns={columns}
                pagination={false}
            />

            <div className="flex items-center gap-4 mt-6">
                <div className="flex-1">
                    <CustomSelect
                        value={selectedTaxRate}
                        onValueChange={onSelectTaxRate}
                        options={taxRateOptions}
                        placeholder={isLoadingTaxRegions ? "Loading regions..." : "Select Tax Rate"}
                        disabled={isLoadingTaxRegions} // Disable while loading regions
                    />
                </div>
                <Button 
                    id="add-tax-rate-button"
                    onClick={onAdd}
                    size="default"
                >
                    Add Tax Rate
                </Button>
            </div>
        </Card>
    );
};

export default CompanyTaxRates;

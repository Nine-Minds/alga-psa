import React from 'react';
import { Button } from '@/components/ui/Button';
import { ITaxRate, ICompanyTaxRate } from '@/interfaces/billing.interfaces';
import { DataTable } from '@/components/ui/DataTable';
import { ColumnDefinition } from '@/interfaces/dataTable.interfaces';
import CustomSelect from '@/components/ui/CustomSelect';
import { Card } from '@/components/ui/Card';

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
    region: string;
    tax_percentage: number;
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
    const tableData: TaxRateTableData[] = companyTaxRates
        .map((companyTaxRate): TaxRateTableData => {
            const taxRate = taxRates.find(tr => tr.tax_rate_id === companyTaxRate.tax_rate_id);
            return {
                company_tax_rate_id: companyTaxRate.company_tax_rate_id!,
                tax_rate_id: companyTaxRate.tax_rate_id,
                region: taxRate?.region || '',
                tax_percentage: taxRate?.tax_percentage || 0,
                description: taxRate?.description || ''
            };
        });

    const columns: ColumnDefinition<TaxRateTableData>[] = [
        {
            title: 'Region',
            dataIndex: 'region'
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

    const taxRateOptions = taxRates.map((taxRate): { value: string; label: string } => ({
        value: taxRate.tax_rate_id!,
        label: `${taxRate.region} - ${taxRate.tax_percentage}%`
    }));

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
                        placeholder="Select Tax Rate"
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

'use client'

import React from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { BillabilityPercentage, billabilityColorScheme } from './utils';

interface BillableLegendProps {
    className?: string;
}

export function BillableLegend({ className = '' }: BillableLegendProps): React.JSX.Element {
    return (
        <Card className={`p-4 ${className}`} id="billable-legend">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900">Billable Legend</h3>
                    <p className="text-xs text-gray-500">Color indicators for billable time ratios</p>
                </div>
                <div className="flex items-center gap-4">
                    {([0, 25, 50, 75, 100] as BillabilityPercentage[]).map((percentage) => {
                        const colors = billabilityColorScheme[percentage];
                        return (
                            <div key={percentage} className="flex items-center gap-1.5">
                                <div
                                    className="w-5 h-5 rounded border"
                                    style={{
                                        backgroundColor: colors.background,
                                        borderColor: colors.border
                                    }}
                                />
                                <span className="text-xs text-gray-600">{percentage}%</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </Card>
    );
}

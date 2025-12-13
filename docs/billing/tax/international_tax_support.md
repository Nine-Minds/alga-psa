# International Tax Support

This document outlines the implementation of complex tax scenarios in our MSP Professional Services Automation (PSA) tool, including composite taxes, threshold-based tax rates, and tax holidays.

## Features

1. **Composite Taxes**: Ability to create tax rates composed of multiple components, which can be compound or simple.
2. **Threshold-Based Tax Rates**: Support for tax rates that change based on the amount being taxed.
3. **Tax Holidays**: Capability to define periods where certain taxes are not applied.
4. **Reverse Charge Mechanism**: Option to apply reverse charge for specific scenarios.

## Database Schema

The following tables have been added or modified to support these features:

- `tax_rates`: Extended to include `is_composite` and other relevant fields.
- `tax_components`: Stores individual components of composite taxes.
- `composite_tax_mappings`: Links composite taxes to their components.
- `tax_rate_thresholds`: Defines thresholds for variable tax rates.
- `tax_holidays`: Stores information about tax holiday periods.

## Usage

### Configuring Tax Settings

1. Navigate to the Company Details page.
2. Click on the "Tax Settings" tab.
3. Here you can:
   - Select the applicable tax rate
   - Configure composite tax components
   - Set up threshold-based rates
   - Define tax holidays
   - Toggle reverse charge applicability

### Composite Taxes

To create a composite tax:
1. Select a tax rate marked as composite.
2. Add components using the "Add Component" button.
3. For each component, specify:
   - Name
   - Rate
   - Whether it's compound (applied on top of previous components)

### Threshold-Based Rates

To set up threshold-based rates:
1. Add thresholds using the "Add Threshold" button.
2. For each threshold, specify:
   - Minimum amount
   - Maximum amount (optional, leave blank for no upper limit)
   - Rate for this threshold

### Tax Holidays

To define a tax holiday:
1. Add a holiday period using the "Add Holiday" button.
2. Specify:
   - Start date
   - End date
   - Description (optional)

## Implementation Details

- The `TaxService` class (`server/src/lib/services/taxService.ts`) handles the complex tax calculations.
- Tax settings are managed through the `TaxSettingsForm` component (`server/src/components/TaxSettingsForm.tsx`).
- The `invoiceActions.ts` file has been updated to use the new tax calculation logic when generating invoices.

## API

The following API endpoints have been added or updated:

- `GET /api/tax-settings/:companyId`: Retrieve tax settings for a company
- `PUT /api/tax-settings/:companyId`: Update tax settings for a company
- `GET /api/tax-rates`: Retrieve all available tax rates

## Testing

Ensure to test the following scenarios:
1. Creating and applying composite taxes
2. Applying threshold-based rates
3. Correct application of tax holidays
4. Reverse charge mechanism
5. Combination of multiple tax features

To run the TaxService tests:

```bash
npm run test -- src/test/services/taxService.test.ts
```

## Best Practices

1. Always ensure that company tax settings are up to date before generating invoices.
2. Regularly review and update tax rates to comply with changing regulations.
3. Be cautious when applying reverse charge mechanisms and ensure they are used correctly according to local tax laws.
4. When setting up composite taxes, consider the order of components and whether they should be compound or not.
5. For threshold-based rates, ensure that thresholds cover all possible amounts without gaps.
6. When defining tax holidays, make sure they don't overlap with other holidays for the same tax component.

## Future Improvements

- Add support for jurisdiction-specific tax rules
- Implement automatic tax rate updates based on legal changes
- Develop a tax reporting module for easier compliance
- Integrate with external tax calculation services for more complex scenarios

For any questions or issues related to the international tax support features, please contact the development team.
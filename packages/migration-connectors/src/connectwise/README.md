# connectwise-psa-csv

Converts a directory of ConnectWise PSA (Manage) CSV exports into one AMP
package. The connector reads six fixed filenames from the input directory;
all six must be present.

## Expected files and columns

Each file needs a header row with exactly these column names (extra columns
are preserved into each record's `extension_json`).

### companies.csv → organizations

| Column | AMP column |
| --- | --- |
| `Company_RecID` | `source_record_id` |
| `Company_Name` | `name` |
| `Website_URL` | `website` |
| `PhoneNbr` | `phone` |

### sites.csv → locations

| Column | AMP column |
| --- | --- |
| `Site_RecID` | `source_record_id` |
| `Company_RecID` | `organization_package_record_id` (company reference) |
| `Site_Name` | `name` |
| `Address_Line1` | `address_line1` |
| `Address_Line2` | `address_line2` |
| `City` | `city` |
| `State_ID` | `region` |
| `Zip` | `postal_code` |
| `Country` | `country_code` |

### contacts.csv → contacts

| Column | AMP column |
| --- | --- |
| `Contact_RecID` | `source_record_id` |
| `Company_RecID` | `organization_package_record_id` (company reference) |
| `First_Name` | `first_name` |
| `Last_Name` | `last_name` |
| `Email` | `email` |
| `Phone` | `phone` |
| `Title` | `title` |

### service_tickets.csv → tickets

| Column | AMP column |
| --- | --- |
| `SR_Service_RecID` | `source_record_id` |
| `Company_RecID` | `organization_package_record_id` (company reference) |
| `Contact_RecID` | `requester_package_record_id` (contact reference) |
| `Summary` | `title` |
| `Detail_Description` | `description` |
| `Status_Description` | `status_name` |
| `Urgency` | `priority_name` |
| `SR_Board_Name` | `category_name` |
| `Date_Entered_UTC` | `created_at` |
| `Last_Update_UTC` | `updated_at` |
| `Date_Closed_UTC` | `closed_at` |

### ticket_notes.csv → ticket_comments

| Column | AMP column |
| --- | --- |
| `SR_Detail_RecID` | `source_record_id` |
| `SR_Service_RecID` | `ticket_package_record_id` (ticket reference) |
| `Contact_RecID` | `author_package_record_id` (contact reference) |
| `Detail_Notes` | `body` |
| `Internal_Flag` | `is_internal` (`Y`/`N` or `1`/`0`) |
| `Date_Created_UTC` | `created_at` |

### configurations.csv → assets

| Column | AMP column |
| --- | --- |
| `Config_RecID` | `source_record_id` |
| `Company_RecID` | `organization_package_record_id` (company reference) |
| `Config_Name` | `name` |
| `Config_Type` | `asset_type_name` |
| `Serial_Nbr` | `serial_number` |
| `Manufacturer_Name` | `manufacturer` |
| `Model_Nbr` | `model` |
| `Purchase_Date` | `purchase_date` (`M/D/YYYY` or `YYYY-MM-DD`) |

## Value conventions

- The `_UTC` date columns accept `M/D/YYYY H:MM[:SS]` (as ConnectWise exports
  them) or ISO timestamps; both convert to RFC 3339 UTC. Unparseable values
  are dropped with a warning in `package_diagnostics`.
- Reference columns (`Company_RecID`, `Contact_RecID`, `SR_Service_RecID`)
  carry ConnectWise record ids; the connector rewrites them to package record
  ids. References to records missing from the export are left as-is and
  reported by the AMP validator.
- The package namespace is `connectwise:<namespace>`, where `<namespace>`
  identifies the source instance (e.g. `connectwise:na.myco.com`). Reuse the
  same namespace for later exports of the same instance so Alga's idempotency
  ledger recognizes already-applied records.

## Known omissions

Time entries, agreements, invoices, and attachments are not exported; see the
connector descriptor for the full list.

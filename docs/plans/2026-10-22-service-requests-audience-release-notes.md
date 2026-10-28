# Service request audiences

Administrators can restrict a request form to clients, client visibility groups, contacts, or tags. An audience applies immediately to the client portal, including existing published forms.

Existing Advanced Visibility rules are converted to an audience using the latest published configuration. If the draft and published rules differ, the converted audience follows the published rules. After conversion, audience changes take effect without publishing another form version.

## Development databases with the withdrawn migration

The earlier `20261022090000_add_service_request_audience_scoping.cjs` migration was run on the shared development database. It is replaced by `20261028090000_add_service_request_audience_scoping.cjs`, which refuses to run while the old schema remains. Before applying the replacement there, inspect and preserve any scoped definitions and their client and group selections. Reconcile the recorded migration and remove the old `audience_mode` column and the two `service_request_audience_*` tables only as a deliberate, coordinated maintenance operation. Do not run the full migration set against that database: its migration history has drifted.

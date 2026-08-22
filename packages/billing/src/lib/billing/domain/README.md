# Contract billing calculation boundary

`calculateContractBilling` is the canonical, pure contract-billing result assembler. Both production and the simulator must invoke it with tenant-scoped, fully resolved facts. It has no database, network, logging, clock, invoice-number, audit, event, or persistence dependency.

Future pricing, proration, tax, adjustment, schedule, and rounding rules belong in this domain layer (or a charge-family module it owns), never in simulator presentation code or production invoice persistence. `simulate` results are display-only; only a `live` result may enter production persistence.

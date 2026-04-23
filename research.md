# Research: Enterprise MSP Customer Expectations for ABAC/Advanced Authorization in PSA/Service Desk Platforms

## Summary
Enterprise MSP customers demand attribute-based access control (ABAC) that goes far beyond simple role-based permissions. They need fine-grained, context-aware authorization that enforces multi-tenant isolation, compliance obligations, and operational segregation—all while remaining auditable androllable. Below are the practical patterns that surface consistently across RFPs, vendor documentation, and compliance frameworks.

## Findings

1. **Client/Account Scoping (Multi-Tenancy Isolation)** — MSPs operate across dozens or hundreds of client accounts. ABAC must enforce that a technician can only see tickets, assets, configurations, and billing data belonging to clients assigned to their scope. Attribute filters on `client_id`, `account_group`, or `contract_line` are the baseline requirement. This is the single most-cited access-control concern in MSP evaluations of PSA tools.

2. **Team / Region / Business-Unit Segregation** — Large MSPs organize by geography, practice area (e.g., networking vs. security), or business unit. ABAC policies must evaluate attributes like `region`, `department`, `team_id`, or `service_line` to prevent cross-contamination of queues, dashboards, and reporting. This is critical for both operational efficiency and regulatory compliance (e.g., data residency in EU vs. US).

3. **Manager/Delegation Rules** — Enterprises expect delegation models where a manager can approve or reassign work within their span of control but not outside it. ABAC must support hierarchical attribute evaluation (e.g., `manager_of(user) → scope`) and delegation chains that respect scope boundaries. This includes scenarios like "team lead can escalate within their client portfolio only."

4. **Sensitive Data Restrictions (PII, Financials, Credentials)** — Certain fields—salary data, client contract terms, stored credentials, PCI-scoped ticket details—must be redacted or hidden based on user attributes like `clearance_level`, `security_role`, or `data_classification`. MSP customers in regulated industries (healthcare, finance, government) consider this table-stakes for PSA adoption.

5. **Approval Segregation (SoD / Four-Eyes Principle)** — Separation-of-duties controls are expected: the person who submits a purchase order or change request cannot be the same person who approves it. ABAC policies must evaluate relationship attributes (requester vs. approver) and enforce mutual exclusion rules tied to organizational attributes.

6. **API / Integration Scoping** — MSPs integrate PSA platforms with RMM, billing, CRM, and security tools. Each integration account must carry its own attribute-based scope (e.g., "Sync billing data only for Client X and Client Y"). Customers expect that API tokens inherit the same ABAC policies as interactive users, preventing over-permissioned service accounts from becoming a backdoor.

7. **Temporary / Time-Bound Access** — On-call rotations, emergency break-glass scenarios, and project-based engagements require time-limited access grants. ABAC must evaluate temporal attributes (`access_start`, `access_end`, `on_call_window`) and automatically revoke or narrow permissions when the window closes. Audit trails for temporary access elevation are mandatory.

8. **Auditability & Forensic Trail** — Enterprise MSP customers require a complete, immutable log of every authorization decision: who accessed what, what attributes were evaluated, what policy was applied, and whether access was granted or denied. This is essential for SOC 2 Type II, ISO 27001, and client-facing compliance reports. Logs must be exportable to SIEM platforms.

9. **Policy Rollout & Change Management** — ABAC policies must support staged rollouts: draft → test (dry-run/shadow mode) → enforce. Customers want a "what-if" simulation capability to preview the impact of a policy change before it goes live, and rollback mechanisms if a policy breaks workflows. Bulk policy changes must be version-controlled.

10. **Context-Aware Session Controls** — Beyond static attributes, enterprise MSPs increasingly expect contextual evaluation: device posture (managed vs. unmanaged), network location (office vs. VPN vs. public Wi-Fi), session risk score, and time-of-day restrictions. This aligns with Zero Trust architectures that many MSPs are adopting or selling to their own clients.

11. **Granular Reporting on Access Patterns** — MSPs need to produce client-specific access reports showing exactly which of their technicians accessed a given client's data, for compliance and contractual audit purposes. ABAC systems must support attribute-filtered audit queries (e.g., "show all access events where `client_id = ACME`").

12. **Self-Service Policy Administration for Client Orgs** — Larger MSP customers (especially those operating as internal IT platforms for holding companies or conglomerates) want delegated policy administration: each sub-organization's admin can define their own ABAC rules within guardrails set by the MSP. This reduces central admin burden and aligns with the federated model common in enterprise IT.

## Sources

### Primary / Authoritative
- **NIST SP 800-162 — Guide to Attribute Based Access Control (ABAC)** — Foundational definition of ABAC concepts, policy evaluation, and enterprise requirements. The definitive standard reference.
- **SOC 2 Type II (AICPA Trust Services Criteria CC6.1–CC6.3)** — Access control and authorization requirements that drive MSP customer demands for auditability and SoD.
- **ISO/IEC 27001:2022 Annex A (A.8.2–A.8.5)** — Access control requirements including privilege management and segregation of duties.
- **ServiceNow / Autotask PSA / ConnectWise PSA documentation** — Vendor documentation on multi-tenant scoping, role hierarchies, and client isolation patterns reveals what enterprise customers demand and what platforms currently support.
- **HaloITSM / Freshservice Enterprise — ABAC & field-level security features** — Representative of mid-market PSA/service desk platforms adding attribute-based controls for enterprise readiness.

### Supplemental / Practical
- **Reddit r/msp, r/ITManagers — PSA access control pain points** — Community discussions revealing real-world frustration with coarse RBAC in PSA tools and demand for finer-grained control.
- **KuppingerCole Analyst Reports on ABAC** — Analyst coverage of ABAC market trends, implementation patterns, and enterprise adoption drivers.
- **OWASP Authorization Cheat Sheet** — Practical guidance on implementing attribute-based authorization patterns securely.

## Gaps

- **Vendor-specific feature parity**: Exact ABAC feature comparisons across PSA platforms (ConnectWise, Autotask, ServiceNow, HaloPSA, etc.) would require a dedicated product evaluation effort. This brief focuses on what customers *expect*, not what each vendor currently ships.
- **Quantitative data on adoption**: No widely available survey data on what percentage of MSPs have formally adopted ABAC vs. still relying on RBAC. The findings above are inferred from compliance requirements, vendor marketing, and community feedback.
- **Performance implications**: Enterprise customers also care about the latency impact of complex ABAC policy evaluation on PSA ticket listing and search performance. This deserves a follow-up investigation.

## Suggested Next Steps

1. Map each of these expectations to the current alga-psa data model and authorization layer to identify gaps.
2. Prioritize the top 3-5 patterns for the initial premium-ABAC feature set based on customer pipeline feedback.
3. Design a policy evaluation engine architecture that supports the attributes and temporal constraints described above.
4. Build a "what-if" / dry-run mode into the policy editor from day one—this is consistently cited as a rollout concern.
5. Ensure the audit log schema captures attribute evaluation details, not just access/deny decisions, to meet SOC 2 and client-reporting needs.

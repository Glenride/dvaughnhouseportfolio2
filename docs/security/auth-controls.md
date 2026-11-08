# Authentication Security Controls

This document augments the runbook by detailing security guardrails and compliance requirements for the Auth0-based authentication stack.

## Password & Account Policies
- **Policy Level:** "good" (Auth0) enforcing minimum 8 characters, dictionary checks, and breached-password blocking.
- **Email Verification:** Mandatory. Backend rejects login unless `email_verified` is true.
- **Account Lockouts:** Brute-force protection enabled with exponential backoff. Review lockout thresholds quarterly.

## Secrets & Key Management
- **Storage:** HashiCorp Vault paths defined in `infrastructure/auth0/secrets-config.yaml`.
- **Rotation Cadence:** Every 90 days or after incident. Track next rotation in security calendar.
- **Key Synchronization:** CI pipeline pulls secrets at deploy; ensure environment variables refreshed before go-live.

## Logging & Monitoring
- **Log Streams:** Auth0 logs forwarded to Datadog via `backend/monitoring/authTelemetry.ts` and infrastructure pipeline.
- **Retention:** 90 days hot in Datadog, 13 months archived (Object Storage).
- **Access:** Datadog logs restricted to security and platform groups; include `env` tag for scoping.

## Compliance Alignment
| Framework | Requirements Addressed | Additional Actions |
|-----------|------------------------|--------------------|
| SOC 2 Type II | Centralized logging, access controls, credential rotation | Conduct quarterly access reviews of Auth0 dashboard. |
| GDPR | Log retention limits, data subject access | Implement data deletion automation for Auth0 user metadata upon request. |
| HIPAA (future) | Encryption in transit, audit logs | Evaluate Business Associate Agreement with Auth0 before handling PHI. |

## Data Residency
- Default Auth0 tenant region: US. For EU-only customers, provision EU tenant and segregate secrets per environment.

## Incident Documentation
- Capture incidents in shared incident tracker with remediation notes.
- Update this document and runbook when new controls are introduced.

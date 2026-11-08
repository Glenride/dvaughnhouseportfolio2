# Authentication Operations Runbook

## Overview
This runbook documents day-to-day operational procedures for the Auth0-backed authentication stack powering our multi-tenant mobile applications and APIs. It covers tenant provisioning, credential rotation, incident response, and monitoring touchpoints.

## Environment Matrix
| Environment | Auth0 Tenant | Datadog Tags | Notes |
|-------------|--------------|--------------|-------|
| Development | `dvh-auth-dev` | `env:development` | Feature validation, safe for testing integration changes. |
| Test / QA   | `dvh-auth-test` | `env:test` | Mirrors production configuration for release validation. |
| Production  | `dvh-auth-prod` | `env:production` | Live customer traffic; follow change-management approvals. |

## Tenant Provisioning
1. Confirm target environment and baseline configuration in `infrastructure/auth0/tenant-config.yaml`.
2. Fetch required secrets from Vault following `infrastructure/auth0/secrets-config.yaml`.
3. Generate deploy payloads with:
   ```bash
   yq -o=json '.tenants.<env>' infrastructure/auth0/tenant-config.yaml > build/<env>-tenant.json
   ```
4. Apply configuration using Auth0 Deploy CLI:
   ```bash
   auth0 deploy --input_file build/<env>-tenant.json --config_file infrastructure/auth0/config/<env>-config.json
   ```
5. Validate in Auth0 dashboard:
   - Applications exist with correct callbacks and grant types.
   - Email provider enabled with verification templates.
   - Security features (brute-force protection, breached password detection) enabled.
6. Execute smoke test against `/auth/health` endpoint once backend deploy completes.

## Credential Rotation
1. Coordinate rotation window with platform security.
2. Update Vault entries referenced in `secrets-config.yaml` (client IDs, client secrets, signing keys if provided):
   - Generate new client secret via Auth0 dashboard -> Applications -> Select app -> Regenerate. 
   - Update Vault values atomically.
3. Trigger CI sync to propagate secrets into GitHub Actions environments (see `infrastructure/auth0/README.md`).
4. Restart backend services (Kubernetes deploy or serverless) to pick up new environment variables.
5. Monitor Datadog dashboards for `auth.login.success_count` and failure rate anomalies for 30 minutes.

## Security Controls & Compliance
- **Password Policies:** Enforced via Auth0 tenant (`password_policy: "good"`) ensuring minimum length, complexity, and breached-password detection. Do not lower requirements without security sign-off.
- **Rate Limiting & Anomaly Protection:** Brute-force protection, breached password detection, and suspicious IP blocking must remain enabled (see `tenant-config.yaml`). Review thresholds quarterly.
- **Email Verification Enforcement:** Backend rejects login when `email_verified` is false; keep verification templates aligned with compliance guidelines.
- **Secret Management:** All tenant credentials are stored in Vault paths defined in `secrets-config.yaml`. Never store secrets in code or CI logs.
- **Audit Logging:** Auth0 event logs are forwarded to Datadog and retained 13 months for SOC 2 evidence. Ensure log archive bucket (if configured) meets GDPR retention requirements.
- **Access Control:** Restrict Auth0 dashboard access to least privilege roles; use SSO for administrator logins.
- **Compliance Mapping:** Current implementation targets SOC 2 Type II and GDPR readiness. Confirm data residency needs before onboarding EU-only tenants.

## Incident Response
### Login Failures Spike
1. Alert: `auth.login.failure_rate` > 5% (see Datadog alert in `infrastructure/observability/datadog-pipeline.yaml`).
2. Check Datadog auth dashboard for regional patterns and correlate with Auth0 status page.
3. Pull recent Auth0 logs using:
   ```bash
   node scripts/fetch-auth0-logs.js --since 15m
   ```
   (Script TBD; use `collectAndPublishAuthTelemetry` helper if available.)
4. Validate backend `/auth/login` and Auth0 tenant availability.
5. If platform issue, engage Auth0 support; otherwise roll back recent deploys.

### Password Reset Failures
1. Alert: `auth.password_reset.error_rate` > 2%.
2. Inspect Auth0 logs for `fpw`/`frpf` events – identify common root cause (invalid reset tickets, email provider outage).
3. Verify email provider health (SendGrid/SES) and ensure `result_url` still reachable.
4. Communicate mitigation steps to support team; update status page if customer impact persists >30 minutes.

### Token Latency Anomalies
1. Alert: `auth.token.issuance_latency_p95` anomaly.
2. Inspect Auth0 log processing times and datacenter distribution.
3. Verify backend network latency and dependency health (secrets manager, database) via Datadog service map.
4. If limited to a region, open Auth0 support ticket referencing tenant and correlation IDs.

## Monitoring & Observability
- Metrics derived via `backend/monitoring/authTelemetry.ts` (ingest pipeline called on schedule).
- Dashboards: Datadog -> `Auth / Enterprise Login` (contains login/pass reset metrics, latency, anomalies).
- Alerts defined in `infrastructure/observability/datadog-pipeline.yaml`. Ensure on-call rotations kept current in PagerDuty.
- **Log Retention:** Datadog log ingestion retains 90 days hot storage; archive raw auth0 logs to object storage bucket quarterly for 13-month retention.
- **PII Handling:** Token payloads and email addresses appear in Auth0 logs; restrict Datadog log access to security-approved groups.

## Future Roadmap & Tech Debt
- **MFA Rollout:** Evaluate Auth0 Guardian or WebAuthn support. Dependencies: mobile app UI updates, backend MFA enrollment endpoints, updated telemetry.
- **Enterprise SSO (SAML/SCIM):** Requires additional Auth0 connections per tenant, provisioning sync jobs, expanded admin APIs. Track dependency on customer SCIM schema design.
- **Social Login Providers:** Google and GitHub planned for Phase 2. Ensure marketing compliance and update privacy policy before enabling.
- **Session Management Improvements:** Add endpoint for session revocation across devices and audit trail export to data warehouse.
- **Telemetry Hardening:** Implement structured log forwarding to long-term storage and anomaly detection tuned for region-specific baselines.

## Runbook Updates
- Review quarterly or after significant auth changes (MFA rollout, new IdPs).
- Capture post-incident learnings in this document with timestamps.

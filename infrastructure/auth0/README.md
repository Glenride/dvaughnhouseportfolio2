# Auth0 Tenant Provisioning Guide

## Overview
This directory contains declarative configuration and automation guidance for provisioning Auth0 tenants across dev, test, and prod environments. Use the Auth0 Deploy CLI in conjunction with the provided YAML blueprints to keep tenant settings in sync and version-controlled.

## Files
- `tenant-config.yaml` – Baseline tenant/application settings (callbacks, grant types, security posture).
- `secrets-config.yaml` – Vault and CI/CD secret mappings per environment.

## Prerequisites
1. Auth0 Deploy CLI installed locally or available in CI:
   ```bash
   npm install -g auth0-deploy-cli
   ```
2. Auth0 Management API credentials with sufficient privileges for tenant configuration.
3. Access to the secret manager referenced in `secrets-config.yaml` (e.g., HashiCorp Vault).

## Provisioning Workflow
1. **Populate Secrets** – Ensure Vault paths defined in `secrets-config.yaml` exist for each environment (client IDs, client secrets, domain, audience).
2. **Generate Deploy Payloads** – Convert the YAML configuration to JSON expected by Auth0 Deploy CLI:
   ```bash
   yq -o=json '.tenants.dev' tenant-config.yaml > build/dev-tenant.json
   yq -o=json '.tenants.test' tenant-config.yaml > build/test-tenant.json
   yq -o=json '.tenants.prod' tenant-config.yaml > build/prod-tenant.json
   ```
3. **Deploy** – Execute Deploy CLI pointing to the generated payload and Auth0 tenant:
   ```bash
   auth0 deploy --input_file build/dev-tenant.json --config_file config/dev-config.json
   ```
   Where `config/dev-config.json` includes Auth0 domain, client ID/secret pulled from Vault.
4. **Verify** – Log into the Auth0 dashboard to confirm applications, connections, and security settings match expectations.

## Automation via GitHub Actions
```yaml
name: auth0-deploy
on:
  workflow_dispatch:
  push:
    paths:
      - 'infrastructure/auth0/**'
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install tooling
        run: |
          npm install -g auth0-deploy-cli
          sudo snap install yq
      - name: Fetch secrets from Vault
        run: ./scripts/fetch-auth0-secrets.sh dev
      - name: Build payload
        run: |
          mkdir -p build
          yq -o=json '.tenants.dev' infrastructure/auth0/tenant-config.yaml > build/dev-tenant.json
      - name: Deploy tenant config
        env:
          AUTH0_DOMAIN: ${{ secrets.AUTH0_DOMAIN }}
          AUTH0_CLIENT_ID: ${{ secrets.AUTH0_CLIENT_ID_M2M }}
          AUTH0_CLIENT_SECRET: ${{ secrets.AUTH0_CLIENT_SECRET_M2M }}
        run: auth0 deploy --input_file build/dev-tenant.json --config_file infrastructure/auth0/config/dev-config.json
```

## Next Steps
- Extend `tenant-config.yaml` as new features (MFA, SSO) are introduced.
- Add Terraform modules if the team standardizes on Terraform for infrastructure. The same YAML can act as a source of truth to generate Terraform variables.
- Keep operational runbooks updated when provisioning flow changes.

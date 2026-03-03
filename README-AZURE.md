# JAIS Mission Control — Azure Deployment Guide

## Prerequisites

- Azure CLI (`az login`)
- An existing Resource Group and Key Vault (`kv-jais-prod`)
- Three secrets pre-loaded in Key Vault:
  - `MissionControlAuthUser` — login username
  - `MissionControlAuthPass` — login password
  - `MissionControlApiKey`  — API key for programmatic access

---

## 1. Provision Azure Infrastructure

```bash
az deployment group create \
  --resource-group <your-resource-group> \
  --template-file infra/mission-control.bicep \
  --parameters appName=jais-mission-control \
               acrName=jaisacr \
               keyVaultName=kv-jais-prod
```

Note the outputs: `appServiceUrl` and `acrLoginServer`. You'll need them for the next step.

---

## 2. Configure GitHub Secrets

In your repo → Settings → Secrets → Actions, add:

| Secret | Value |
|---|---|
| `AZURE_CREDENTIALS` | JSON from `az ad sp create-for-rbac --sdk-auth` |
| `ACR_LOGIN_SERVER` | From Bicep output (`acrLoginServer`) |
| `ACR_USERNAME` | ACR admin username (Azure Portal → ACR → Access keys) |
| `ACR_PASSWORD` | ACR admin password |
| `AZURE_WEBAPP_NAME` | `jais-mission-control` |
| `AZURE_RESOURCE_GROUP` | Your resource group name |

---

## 3. Custom Domain

Point `ops.jaissolutions.com` at the App Service:

```bash
az webapp config hostname add \
  --webapp-name jais-mission-control \
  --resource-group <your-resource-group> \
  --hostname ops.jaissolutions.com
```

Then add a CNAME in Cloudflare: `ops` → `jais-mission-control.azurewebsites.net` (proxied ✅).

---

## 4. Deploy

Push to `main` — GitHub Actions builds the Docker image, pushes to ACR, and deploys automatically. Monitor in the **Actions** tab.

To manually trigger a deploy without a code change:

```
GitHub → Actions → "Deploy to Azure App Service" → Run workflow
```

---

## 5. Upstream Updates

A daily workflow (`sync-upstream.yml`) checks [builderz-labs/mission-control](https://github.com/builderz-labs/mission-control) for new releases. When a new version is found, it opens a PR updating `UPSTREAM_VERSION`. Review the upstream changelog, then merge the PR — CI handles the rest.

Current pinned version: see `UPSTREAM_VERSION` file.

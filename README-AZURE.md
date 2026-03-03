# JAIS Mission Control — Azure Deployment

Everything is driven from **GitHub Actions + Bicep**. No manual az CLI steps.

---

## How it works

```
push to main
    │
    ├─ Job 1: infra  →  az arm-deploy (Bicep, idempotent)
    │                   provisions ACR, App Service, Storage, KV role
    │                   outputs: ACR server + credentials
    │
    └─ Job 2: deploy  →  docker build + push to ACR
                         az webapp config container set (new image tag)
                         az webapp restart
                         health check poll → summary
```

The Bicep deployment is **idempotent** — running it again updates resources to match the template without recreating them. Infrastructure and app deploy happen in the same pipeline on every push to `main`.

---

## One-time setup

### 1. GitHub Actions secrets (2 required)

Go to **Settings → Secrets → Actions** in this repo and add:

| Secret | Value |
|---|---|
| `AZURE_CREDENTIALS` | Output of `az ad sp create-for-rbac --sdk-auth --role contributor --scopes /subscriptions/<id>/resourceGroups/rg-jais-prod` |
| *(everything else)* | Pulled from Bicep outputs at runtime — no other secrets needed |

### 2. Key Vault secrets (3, set once — rotate in KV directly)

These must exist in `kv-jais-prod-01` before first deploy:

```bash
az keyvault secret set --vault-name kv-jais-prod-01 --name MissionControlAuthUser --value "BigDog"
az keyvault secret set --vault-name kv-jais-prod-01 --name MissionControlAuthPass --value "<generated>"
az keyvault secret set --vault-name kv-jais-prod-01 --name MissionControlApiKey  --value "<generated>"
```

> Already done for the initial deploy. To rotate: update the secret in KV → restart the App Service.

### 3. Custom domain (one-time)

```bash
az webapp config hostname add \
  --webapp-name app-jais-mc-prod \
  --resource-group rg-jais-prod \
  --hostname ops.jaissolutions.com
```

Then add a **CNAME** in Cloudflare: `ops` → `app-jais-mc-prod.azurewebsites.net` (proxied ✅).

---

## Deploy

**Normal deploy:** push or merge to `main` — CI handles everything.

**Manual trigger:** GitHub → Actions → "Deploy to Azure" → Run workflow (optionally specify an image tag).

**First deploy:** runs Bicep first (creates ACR, App Service, etc.), then builds + pushes the image. Takes ~8-10 min.

---

## Upstream updates

A daily workflow (`sync-upstream.yml`) checks [builderz-labs/mission-control](https://github.com/builderz-labs/mission-control) for new releases. When a newer version is found it opens a PR updating `UPSTREAM_VERSION`. Review the upstream changelog → merge → CI deploys automatically.

---

## Infra changes

Edit `infra/mission-control.bicep` → push to `main` → the `infra` job reconciles Azure to match. No manual az CLI needed.

## Secrets rotation

Update the secret value in `kv-jais-prod-01` via Azure Portal or:
```bash
az keyvault secret set --vault-name kv-jais-prod-01 --name MissionControlAuthPass --value "<new>"
az webapp restart --name app-jais-mc-prod --resource-group rg-jais-prod
```

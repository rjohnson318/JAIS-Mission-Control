// JAIS Mission Control — Azure Infrastructure
// ─────────────────────────────────────────────
// Run via GitHub Actions (deploy.yml). Do not apply with az CLI directly.
//
// What this creates:
//   - Azure Container Registry (Basic)
//   - Storage Account + Azure Files share  → SQLite persistence at /app/.data
//   - App Service (Linux container)        → pulls from ACR, secrets from Key Vault
//   - Managed Identity + KV role assignment
//
// What this references (must already exist):
//   - Resource Group    → rg-jais-prod
//   - App Service Plan  → asp-jais-prod  (Linux B1)
//   - Key Vault         → kv-jais-prod-01 (RBAC mode, secrets pre-loaded)

// ── Parameters ────────────────────────────────────────────────────────────────

@description('Azure region — must match the resource group')
param location string = 'eastus2'

@description('App Service name')
param appName string = 'app-jais-mc-prod'

@description('Azure Container Registry name (globally unique, alphanumeric only)')
param acrName string = 'jaisacr'

@description('Existing App Service Plan name')
param appServicePlanName string = 'asp-jais-prod'

@description('Existing Key Vault name (RBAC mode)')
param keyVaultName string = 'kv-jais-prod-01'

// imageTag is intentionally not a parameter here.
// Bicep always configures the App Service to pull 'latest'.
// The deploy job in GitHub Actions updates to the specific SHA tag after push.
var imageTag = 'latest'

// ── Existing resources ────────────────────────────────────────────────────────

resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' existing = {
  name: appServicePlanName
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

// ── Azure Container Registry ──────────────────────────────────────────────────

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: true
  }
}

// ── Storage Account + Azure Files share (SQLite at /app/.data) ────────────────

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'stjaismcprod'
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
  }
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-01-01' = {
  parent: storageAccount
  name: 'default'
}

resource fileShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-01-01' = {
  parent: fileService
  name: 'mc-data'
  properties: {
    shareQuota: 5
  }
}

// ── App Service (Linux container) ─────────────────────────────────────────────

resource appService 'Microsoft.Web/sites@2023-01-01' = {
  name: appName
  location: location
  kind: 'app,linux,container'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOCKER|${acr.properties.loginServer}/mission-control:${imageTag}'
      alwaysOn: true
      appSettings: [
        { name: 'WEBSITES_PORT',                   value: '3000' }
        { name: 'NODE_ENV',                        value: 'production' }
        { name: 'DOCKER_REGISTRY_SERVER_URL',      value: 'https://${acr.properties.loginServer}' }
        { name: 'DOCKER_REGISTRY_SERVER_USERNAME', value: acr.listCredentials().username }
        { name: 'DOCKER_REGISTRY_SERVER_PASSWORD', value: acr.listCredentials().passwords[0].value }
        // Allowed hosts: middleware default-denies all hosts in production unless listed here
        { name: 'MC_ALLOWED_HOSTS', value: '${appName}.azurewebsites.net,ops.jaissolutions.com,localhost' }
        // Key Vault references — resolved at runtime via Managed Identity
        { name: 'AUTH_USER', value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/MissionControlAuthUser/)' }
        { name: 'AUTH_PASS', value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/MissionControlAuthPass/)' }
        { name: 'API_KEY',   value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/MissionControlApiKey/)' }
      ]
    }
  }
}

// ── Azure Files mount for SQLite persistence ──────────────────────────────────
// Note: 'azurestorageaccounts' must be lowercase — ARM is case-sensitive
// Note: mount path cannot contain dots — use /home/data not /app/.data

resource storageConfig 'Microsoft.Web/sites/config@2023-01-01' = {
  parent: appService
  name: 'azurestorageaccounts'
  properties: {
    'mc-sqlite': {
      type: 'AzureFiles'
      accountName: storageAccount.name
      shareName: fileShare.name
      mountPath: '/home/data'
      accessKey: storageAccount.listKeys().keys[0].value
    }
  }
}

// ── Key Vault: grant App Service Managed Identity read access (RBAC) ──────────

resource kvSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, appService.id, 'kv-secrets-user')
  scope: keyVault
  properties: {
    // Key Vault Secrets User — built-in role ID
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6'
    )
    principalId: appService.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Outputs (consumed by deploy.yml) ─────────────────────────────────────────

@description('ACR login server — e.g. jaisacr.azurecr.io')
output acrLoginServer string = acr.properties.loginServer

@description('ACR name — workflow uses this to call az acr credential show')
output acrName string = acr.name

@description('App Service default hostname')
output appServiceUrl string = 'https://${appService.properties.defaultHostName}'

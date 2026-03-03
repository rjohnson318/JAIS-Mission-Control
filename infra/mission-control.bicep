// JAIS Mission Control — Azure Infrastructure
// Uses existing: App Service Plan (asp-jais-prod), Resource Group (rg-jais-prod)
// Creates new:   App Service, ACR, Storage Account (SQLite), Key Vault role assignment

@description('Azure region — must match existing resource group')
param location string = 'eastus2'

@description('App Service name')
param appName string = 'app-jais-mc-prod'

@description('Existing App Service Plan name')
param appServicePlanName string = 'asp-jais-prod'

@description('Azure Container Registry name (globally unique, alphanumeric)')
param acrName string = 'jaisacr'

@description('Existing Key Vault name')
param keyVaultName string = 'kv-jais-prod-01'

@description('Container image tag to deploy')
param imageTag string = 'latest'

// ── Reference existing App Service Plan ───────────────────────────────────────

resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' existing = {
  name: appServicePlanName
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

// ── Dedicated Storage Account for SQLite persistence ─────────────────────────

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

// ── App Service (Container) ───────────────────────────────────────────────────

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
        { name: 'WEBSITES_PORT',                    value: '3000' }
        { name: 'NODE_ENV',                         value: 'production' }
        { name: 'DOCKER_REGISTRY_SERVER_URL',       value: 'https://${acr.properties.loginServer}' }
        { name: 'DOCKER_REGISTRY_SERVER_USERNAME',  value: acr.listCredentials().username }
        { name: 'DOCKER_REGISTRY_SERVER_PASSWORD',  value: acr.listCredentials().passwords[0].value }
        // Key Vault references — resolved at runtime via Managed Identity
        { name: 'AUTH_USER', value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/MissionControlAuthUser/)' }
        { name: 'AUTH_PASS', value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/MissionControlAuthPass/)' }
        { name: 'API_KEY',   value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/MissionControlApiKey/)' }
      ]
    }
  }
}

// ── Key Vault: grant Managed Identity read access (RBAC mode) ─────────────────

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource kvSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, appService.id, 'Key Vault Secrets User')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6') // Key Vault Secrets User
    principalId: appService.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────

output appServiceUrl string = 'https://${appService.properties.defaultHostName}'
output acrLoginServer string = acr.properties.loginServer
output appServicePrincipalId string = appService.identity.principalId

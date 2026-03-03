// JAIS Mission Control — Azure Infrastructure
// Provisions: App Service (container), ACR, Azure Files (SQLite), Key Vault refs

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Base name for all resources')
param appName string = 'jais-mission-control'

@description('Azure Container Registry name')
param acrName string = 'jaisacr'

@description('Key Vault name (must already exist)')
param keyVaultName string = 'kv-jais-prod'

@description('Container image tag to deploy')
param imageTag string = 'latest'

// ── Storage Account (Azure Files for SQLite persistence) ─────────────────────

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: replace('${appName}stor', '-', '')
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
    shareQuota: 5  // GB — more than enough for SQLite
  }
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

// ── App Service Plan (Linux B1) ───────────────────────────────────────────────

resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: '${appName}-plan'
  location: location
  kind: 'linux'
  sku: {
    name: 'B1'
    tier: 'Basic'
  }
  properties: {
    reserved: true  // required for Linux
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
        {
          name: 'WEBSITES_PORT'
          value: '3000'
        }
        {
          name: 'DOCKER_REGISTRY_SERVER_URL'
          value: 'https://${acr.properties.loginServer}'
        }
        {
          name: 'DOCKER_REGISTRY_SERVER_USERNAME'
          value: acr.listCredentials().username
        }
        {
          name: 'DOCKER_REGISTRY_SERVER_PASSWORD'
          value: acr.listCredentials().passwords[0].value
        }
        {
          name: 'NODE_ENV'
          value: 'production'
        }
        // Secrets pulled from Key Vault via Managed Identity
        {
          name: 'AUTH_USER'
          value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/MissionControlAuthUser/)'
        }
        {
          name: 'AUTH_PASS'
          value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/MissionControlAuthPass/)'
        }
        {
          name: 'API_KEY'
          value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/MissionControlApiKey/)'
        }
      ]
      // Azure Files mount for SQLite persistence at /app/.data
      azureStorageAccounts: {
        mcdata: {
          type: 'AzureFiles'
          accountName: storageAccount.name
          shareName: 'mc-data'
          mountPath: '/app/.data'
          accessKey: storageAccount.listKeys().keys[0].value
        }
      }
    }
  }
}

// ── Key Vault access policy for Managed Identity ──────────────────────────────
// Grants the App Service identity read access to Key Vault secrets

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource kvAccessPolicy 'Microsoft.KeyVault/vaults/accessPolicies@2023-07-01' = {
  parent: keyVault
  name: 'add'
  properties: {
    accessPolicies: [
      {
        tenantId: appService.identity.tenantId
        objectId: appService.identity.principalId
        permissions: {
          secrets: ['get', 'list']
        }
      }
    ]
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────

@description('App Service default hostname')
output appServiceUrl string = 'https://${appService.properties.defaultHostName}'

@description('ACR login server (use in GitHub Actions secrets)')
output acrLoginServer string = acr.properties.loginServer

@description('App Service Managed Identity principal ID (for RBAC if needed)')
output appServicePrincipalId string = appService.identity.principalId

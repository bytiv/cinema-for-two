import { ContainerInstanceManagementClient } from '@azure/arm-containerinstance';
import { ClientSecretCredential } from '@azure/identity';

function getClient() {
  const tenantId       = process.env.AZURE_SP_TENANT_ID!;
  const clientId       = process.env.AZURE_SP_CLIENT_ID!;
  const clientSecret   = process.env.AZURE_SP_CLIENT_SECRET!;
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID!;

  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  return new ContainerInstanceManagementClient(credential, subscriptionId);
}

const RG             = process.env.AZURE_RESOURCE_GROUP!;
const CONTAINER_NAME = process.env.AZURE_CONTAINER_NAME!;
const CPU            = parseFloat(process.env.CONTAINER_CPU    ?? '0.5');
const MEMORY         = parseFloat(process.env.CONTAINER_MEMORY ?? '1.5');
const NEXT_JS_URL    = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function getContainerState(): Promise<{
  exists: boolean;
  running: boolean;
  ip: string | null;
}> {
  try {
    const client = getClient();
    const group  = await client.containerGroups.get(RG, CONTAINER_NAME);
    const state  = group.instanceView?.state?.toLowerCase();
    const ip     = group.ipAddress?.ip ?? null;
    return {
      exists:  true,
      running: state === 'running',
      ip,
    };
  } catch (e: any) {
    if (e?.statusCode === 404 || e?.code === 'ResourceNotFound') {
      return { exists: false, running: false, ip: null };
    }
    throw e;
  }
}

export async function startContainer(): Promise<void> {
  const client = getClient();
  await client.containerGroups.beginStartAndWait(RG, CONTAINER_NAME);
}

export async function createContainer(
  hmacSecret:          string,
  storageAccount:      string,
  storageKey:          string,
  supabaseUrl:         string,
  supabaseServiceKey:  string,
): Promise<void> {
  const client = getClient();

  await client.containerGroups.beginCreateOrUpdateAndWait(RG, CONTAINER_NAME, {
    location:      'centralindia',
    osType:        'Linux',
    restartPolicy: 'Never',
    ipAddress: {
      type:  'Public',
      ports: [{ protocol: 'TCP', port: 8000 }],
    },
    containers: [{
      name:  CONTAINER_NAME,
      image: 'belal0gebaly/cinema-ingest:latest',
      resources: {
        requests: { cpu: CPU, memoryInGB: MEMORY },
      },
      ports: [{ protocol: 'TCP', port: 8000 }],
      environmentVariables: [
        { name: 'ALLOWED_ORIGINS',        value:        `${NEXT_JS_URL},http://localhost:3000` },
        { name: 'INGEST_HMAC_SECRET',     secureValue:  hmacSecret },
        { name: 'AZURE_STORAGE_ACCOUNT',  secureValue:  storageAccount },
        { name: 'AZURE_STORAGE_KEY',      secureValue:  storageKey },
        { name: 'SUPABASE_URL',           value:        supabaseUrl },
        { name: 'SUPABASE_SERVICE_KEY',   secureValue:  supabaseServiceKey },
        { name: 'AZURE_SP_CLIENT_ID',     secureValue:  process.env.AZURE_SP_CLIENT_ID! },
        { name: 'AZURE_SP_CLIENT_SECRET', secureValue:  process.env.AZURE_SP_CLIENT_SECRET! },
        { name: 'AZURE_SP_TENANT_ID',     secureValue:  process.env.AZURE_SP_TENANT_ID! },
        { name: 'AZURE_SUBSCRIPTION_ID',  secureValue:  process.env.AZURE_SUBSCRIPTION_ID! },
        { name: 'AZURE_RESOURCE_GROUP',   value:        RG },
        { name: 'AZURE_CONTAINER_NAME',   value:        CONTAINER_NAME },
        { name: 'IDLE_SHUTDOWN_SECONDS',  value:        process.env.IDLE_SHUTDOWN_SECONDS ?? '180' },
        { name: 'MAX_CONCURRENT_GLOBAL',  value:        process.env.MAX_CONCURRENT_GLOBAL ?? '4' },
        { name: 'MAX_CONCURRENT_PER_USER',value:        process.env.MAX_CONCURRENT_PER_USER ?? '2' },
      ],
    }],
  });
}

export async function getContainerIP(): Promise<string | null> {
  const client = getClient();
  const group  = await client.containerGroups.get(RG, CONTAINER_NAME);
  return group.ipAddress?.ip ?? null;
}

export async function deleteContainer(): Promise<void> {
  const client = getClient();
  await client.containerGroups.beginDeleteAndWait(RG, CONTAINER_NAME);
}
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} from '@azure/storage-blob';

const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING!;

const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);

export const CONTAINERS = {
  movies: process.env.AZURE_STORAGE_CONTAINER_MOVIES || 'movies',
  posters: process.env.AZURE_STORAGE_CONTAINER_POSTERS || 'posters',
  postcards: process.env.AZURE_STORAGE_CONTAINER_POSTCARDS || 'postcards',
  avatars: process.env.AZURE_STORAGE_CONTAINER_AVATARS || 'avatars',
  subtitles: process.env.AZURE_STORAGE_CONTAINER_SUBTITLES || 'subtitles',
};

// Ensure all containers exist (private access - we use SAS tokens for reads)
export async function ensureContainers() {
  for (const container of Object.values(CONTAINERS)) {
    const containerClient = blobServiceClient.getContainerClient(container);
    await containerClient.createIfNotExists();
  }
}

// Stable SAS API version — avoids 403s from newer sv= values not yet
// fully supported by all Azure storage account configurations.
const SAS_VERSION = '2021-12-02';

// Generate a SAS URL for reading a blob (expires in 24 hours)
export function generateReadSasUrl(containerName: string, blobName: string, expiresInHours = 24, contentType?: string): string {
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse('r'),
      // Widen the start window to absorb clock skew between Vercel and Azure
      startsOn: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
      expiresOn: new Date(Date.now() + expiresInHours * 60 * 60 * 1000),
      protocol: SASProtocol.Https,
      version: SAS_VERSION,
      // Override the Content-Type header in the response so the browser
      // always receives the correct MIME type for the video — even when
      // the blob was uploaded without one (e.g. torrent-ingested files
      // that default to application/octet-stream).
      contentType,
    },
    sharedKeyCredential
  ).toString();

  return `https://${accountName}.blob.core.windows.net/${containerName}/${blobName}?${sasToken}`;
}

// Generate a SAS URL for uploading (expires in expiresInHours, default 1 hour)
export function generateUploadSasUrl(containerName: string, blobName: string, expiresInHours = 1): string {
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse('rcw'),
      startsOn: new Date(Date.now() - 10 * 60 * 1000),
      expiresOn: new Date(Date.now() + expiresInHours * 60 * 60 * 1000),
      protocol: SASProtocol.Https,
      version: SAS_VERSION,
    },
    sharedKeyCredential
  ).toString();

  return `https://${accountName}.blob.core.windows.net/${containerName}/${blobName}?${sasToken}`;
}

// Upload a buffer directly (for small files like images)
export async function uploadBlob(
  containerName: string,
  blobName: string,
  data: Buffer,
  contentType: string
): Promise<string> {
  const containerClient = blobServiceClient.getContainerClient(containerName);
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(data, {
    blobHTTPHeaders: { blobContentType: contentType },
  });

  return blobName;
}

// Delete a blob
export async function deleteBlob(containerName: string, blobName: string): Promise<void> {
  const containerClient = blobServiceClient.getContainerClient(containerName);
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.deleteIfExists();
}

export { blobServiceClient };
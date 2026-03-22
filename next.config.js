/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep ffmpeg/ffprobe out of the webpack bundle — they're Node.js-only
  // Note: Next.js 14 uses experimental.serverComponentsExternalPackages
  //       Next.js 15+ renamed it to serverExternalPackages (top-level)
  experimental: {
    serverComponentsExternalPackages: ['fluent-ffmpeg', '@ffprobe-installer/ffprobe'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.blob.core.windows.net',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'image.tmdb.org',
      },
    ],
  },
};

module.exports = nextConfig;

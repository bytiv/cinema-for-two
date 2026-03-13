/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep ffmpeg/ffprobe out of the webpack bundle — they're Node.js-only
  serverExternalPackages: ['fluent-ffmpeg', '@ffprobe-installer/ffprobe'],
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
    ],
  },
};

module.exports = nextConfig;
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@sentinel/shared'],
  turbopack: {
    root: resolve(__dirname, '../..'),
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

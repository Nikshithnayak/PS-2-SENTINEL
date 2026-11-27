import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@sentinel/shared'],
  serverExternalPackages: ['sharp', 'onnxruntime-node'],
  turbopack: {
    root: resolve(__dirname, '../..'),
    resolveAlias: {
      'onnxruntime-node': false,
      sharp: false,
    },
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

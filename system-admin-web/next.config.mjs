/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: '/system-admin',
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;


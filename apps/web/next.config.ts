import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This repo already has a project-wide CLAUDE.md; don't let dev generate a
  // conflicting one under apps/web.
  agentRules: false,
};

export default nextConfig;

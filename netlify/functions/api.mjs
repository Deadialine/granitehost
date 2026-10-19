import { getStore } from '@netlify/blobs';
import { createHandler } from './lib/core.mjs';

export default async function handler(request) {
  // Deploy previews never share the production workspace's records.
  const suffix = process.env.CONTEXT && process.env.CONTEXT !== 'production' ? `isolated-${process.env.DEPLOY_ID || 'local'}` : 'production';
  const store = getStore({ name: `granite-workspace-${suffix}`, consistency: 'strong' });
  return createHandler({ store, env: process.env })(request);
}

export const config = {
  path: '/api/*',
  rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowSize: 60, windowLimit: 120 },
};

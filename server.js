import { serve } from '@hono/node-server';
import 'dotenv/config';
import app from './src/index.js';

const port = parseInt(process.env.PORT || '3010');

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log('======================================');
  console.log(`PHH API Server running at http://${info.address}:${info.port}`);
  console.log('======================================');
});

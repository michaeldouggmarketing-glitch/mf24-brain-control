import {access} from 'node:fs/promises';
for (const path of [
  'public/index.html',
  'public/app.js',
  'public/styles.css',
  'api/v1/health.js',
  'api/v1/dashboard.js',
  'api/v1/brain/preview.js',
  'lib/brain-client.js',
]) await access(path);
console.log('Build validation passed');

// scripts/health-check.js
// Run: node scripts/health-check.js
// Exit 0 = healthy, Exit 1 = unhealthy
'use strict';

const http = require('http');
const PORT = process.env.PORT || 3000;

const req = http.get(`http://localhost:${PORT}/health`, (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    try {
      const body = JSON.parse(data);
      const isHealthy = res.statusCode === 200 && body.status === 'healthy';
      console.log(`[Health] Status: ${body.status} | DB: ${body.db} | Uptime: ${body.uptime}`);
      if (body.scheduler?.length > 0) {
        body.scheduler.forEach(j => console.log(`  [Job] ${j.name}: ${j.status} (${j.runs} runs)`));
      }
      process.exit(isHealthy ? 0 : 1);
    } catch {
      console.error('[Health] Failed to parse response');
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error(`[Health] Connection failed: ${err.message}`);
  process.exit(1);
});

req.setTimeout(5000, () => {
  console.error('[Health] Timeout after 5s');
  req.destroy();
  process.exit(1);
});

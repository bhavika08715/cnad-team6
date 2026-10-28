const express = require('express');
const path = require('path');
const store = require('./src/db');

store.load();
require('./src/seed').seedIfEmpty();

const surplus = require('./src/surplus');
const prediction = require('./src/prediction');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', require('./src/gateway'));

// background jobs: expire stale listings, send prediction pre-alerts
const jobs = [];
function startJobs() {
  surplus.expireSweep();
  prediction.runPredictionAlerts();
  jobs.push(setInterval(surplus.expireSweep, 60 * 1000));
  jobs.push(setInterval(prediction.runPredictionAlerts, 6 * 60 * 60 * 1000));
  jobs.forEach((j) => j.unref());
}

function start(port = process.env.PORT || 3000) {
  startJobs();
  const server = app.listen(port, () => {
    console.log(`\n  Food Surplus Network running → http://localhost:${server.address().port}\n`);
  });
  return server;
}

if (require.main === module) start();

module.exports = { app, start };

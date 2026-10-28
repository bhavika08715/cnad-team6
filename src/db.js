// Tiny embedded JSON datastore (no native dependencies, nothing to install).
// Swap this module for PostgreSQL/MySQL later without touching the services.
const fs = require('fs');
const path = require('path');

const FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'db.json');

const empty = () => ({
  seq: 1,
  users: [],
  surplus: [],
  notifications: [],
  history: [], // historical surplus records used by the prediction engine
  events: [], // tracking timeline
  alerts: {}, // de-duplicates prediction pre-alerts
});

let data = empty();
let timer = null;

function load() {
  try {
    if (fs.existsSync(FILE)) data = Object.assign(empty(), JSON.parse(fs.readFileSync(FILE, 'utf8')));
  } catch (e) {
    console.error('Could not read DB file, starting fresh:', e.message);
    data = empty();
  }
}

function flush() {
  clearTimeout(timer);
  timer = null;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(data));
  fs.renameSync(FILE + '.tmp', FILE);
}

function save() {
  if (!timer) timer = setTimeout(flush, 300);
}

function reset() {
  data = empty();
  flush();
}

const id = (prefix) => prefix + data.seq++;

process.on('exit', () => {
  try {
    if (timer) flush();
  } catch (_) {}
});

module.exports = {
  get db() {
    return data;
  },
  load,
  save,
  flush,
  reset,
  id,
  FILE,
};

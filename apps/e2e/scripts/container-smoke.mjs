/**
 * Prerequisites: Node 22.6+, Docker daemon, local mongo:8 image, and:
 * docker build -t marketpulse-personal-watchlist-preview-verification:2026-11-07 .
 * Run from the workspace: pnpm --filter @marketpulse/e2e smoke:container
 * Uses only disposable, labelled resources and literal fake credentials. No
 * host ports, production configuration, existing databases, or external calls.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { cleanupAll } from '../tests/cleanup.ts';

const runId = randomUUID();
const label = `io.marketpulse.verification=${runId}`;
const network = `mp-verify-${runId}`;
const mongo = `mp-verify-mongo-${runId}`;
const api = `mp-verify-api-${runId}`;
const image = 'marketpulse-personal-watchlist-preview-verification:2026-11-07';
const userId = '000000000000000000000123';
const docker = (...args) => execFileSync('docker', args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
}).trim();
const delay = () => new Promise(resolve => setTimeout(resolve, 250));
const cleanup = [];
let failure;

// A resource is removed only if it carries this invocation's unique label.
const removeContainer = name => {
  const owned = docker('container', 'ls', '-aq', '--filter', `name=^/${name}$`, '--filter', `label=${label}`);
  if (owned) docker('rm', '-fv', name);
};

try {
  docker('version', '--format', '{{.Server.Version}}');
  for (const prerequisite of [image, 'mongo:8']) {
    try { docker('image', 'inspect', prerequisite); }
    catch { throw new Error(`Missing local image ${prerequisite}. Build the preview image or run docker pull mongo:8 first.`); }
  }
  docker('network', 'create', '--internal', '--label', label, network);
  cleanup.push(() => {
    const owned = docker('network', 'ls', '-q', '--filter', `name=^${network}$`, '--filter', `label=${label}`);
    if (owned) docker('network', 'rm', network);
  });
  cleanup.push(() => removeContainer(mongo));
  docker('run', '-d', '--pull=never', '--name', mongo, '--label', label, '--network', network,
    '--tmpfs', '/data/db', '--tmpfs', '/data/configdb', 'mongo:8', 'mongod', '--replSet', 'rs0', '--bind_ip_all');
  let initiated = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { docker('exec', mongo, 'mongosh', '--quiet', '--eval', `rs.initiate({_id:'rs0',members:[{_id:0,host:'${mongo}:27017'}]})`); initiated = true; break; }
    catch { await delay(); }
  }
  assert.ok(initiated, 'isolated MongoDB starts');
  let seeded = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      docker('exec', mongo, 'mongosh', '--quiet', 'marketpulse_verification', '--eval', `db.users.insertOne({_id:ObjectId('${userId}'),googleSubject:'container-smoke',email:'smoke@example.test',name:'Container Smoke',role:'viewer'})`);
      seeded = true; break;
    } catch { await delay(); }
  }
  assert.ok(seeded, 'legacy user seeded before bootstrap');
  const env = {
    NODE_ENV: 'production', PORT: '3000', WEB_ORIGIN: 'http://localhost:3000',
    MONGODB_URI: `mongodb://${mongo}:27017/marketpulse_verification?replicaSet=rs0`,
    GOOGLE_CLIENT_ID: 'isolated-fake-client', GOOGLE_CLIENT_SECRET: 'isolated-fake-secret',
    ALPACA_API_KEY: 'isolated-fake-key', ALPACA_API_SECRET: 'isolated-fake-secret',
    ACCESS_TOKEN_SECRET: 'isolated-container-access-secret-32-characters',
    REFRESH_TOKEN_PEPPER: 'isolated-container-refresh-pepper-32-characters',
  };
  cleanup.push(() => removeContainer(api));
  docker('run', '-d', '--pull=never', '--name', api, '--label', label, '--network', network,
    ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]), image);
  let booted = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (docker('logs', api).includes('Database connected; application services started')) { booted = true; break; }
    await delay();
  }
  assert.ok(booted, 'production image completes personal-watchlist bootstrap');
  const result = docker('exec', api, 'node', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { createTokenService } from './apps/api/dist/auth/tokens.js';
    const base = 'http://127.0.0.1:3000';
    const live = await fetch(base+'/health/live'); assert.equal(live.status,200); assert.equal((await live.json()).status,'live');
    const ready = await fetch(base+'/health/ready'); assert.equal(ready.status,503); const health = await ready.json(); assert.equal(health.services.mongodb,'ready'); assert.equal(health.services.configuration,'ready'); assert.notEqual(health.services.alpaca,'connected');
    const root = await fetch(base+'/'); assert.equal(root.status,200); assert.match(await root.text(), /<div id="root"><\\/div>/);
    const token = await createTokenService(process.env.ACCESS_TOKEN_SECRET,process.env.REFRESH_TOKEN_PEPPER).signAccessToken({id:'${userId}',role:'viewer',email:'smoke@example.test',name:'Container Smoke'});
    const headers = {cookie:'access_token='+token};
    const personal = await fetch(base+'/api/watchlist',{headers}); assert.equal(personal.status,200); const entries = (await personal.json()).watchlist.entries; assert.equal(entries.length,6); assert.ok(entries.some(entry=>entry.symbol==='AAPL'));
    const search = await fetch(base+'/api/assets/search?q=AMD',{headers}); assert.equal(search.status,503);
    console.log(JSON.stringify({live:200,ready:503,mongodb:health.services.mongodb,configuration:health.services.configuration,alpaca:health.services.alpaca,staticSpa:200,authenticatedWatchlist:200,migratedStarterEntries:entries.length,offlineAssetSearch:503}));
  `);
  console.log(result);
  const migration = JSON.parse(docker('exec', mongo, 'mongosh', '--quiet', 'marketpulse_verification', '--eval', `JSON.stringify({initialized:!!db.users.findOne({_id:ObjectId('${userId}')}).watchlistInitializedAt,entries:db.userwatchlistentries.countDocuments({userId:ObjectId('${userId}')})})`));
  assert.deepEqual(migration, { initialized: true, entries: 6 });
  console.log(`Migration database evidence: ${JSON.stringify(migration)}`);
} catch (error) {
  failure = { error };
  throw error;
} finally {
  await cleanupAll(cleanup, failure);
}

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const freePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    server.close(error => error ? reject(error) : resolve(port));
  });
});

const apiPort = await freePort();
const webPort = await freePort();
const child = spawn('pnpm', ['exec', 'playwright', 'test'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test', E2E_API_PORT: String(apiPort), E2E_WEB_PORT: String(webPort) },
});
child.once('error', error => { throw error; });
child.once('exit', (code, signal) => process.exitCode = signal ? 1 : (code ?? 1));

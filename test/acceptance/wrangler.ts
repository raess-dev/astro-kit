/**
 * `wrangler dev` for the suite: the wrangler of the base copy, in local mode, with no login and no network.
 * Also the two `wrangler.jsonc` texts of 10.4 for the Worker `example-ch` on `example.ch`, and a plain HTTP request.
 * The spikes S9, S14 and S19 use it.
 */
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { type AddressInfo, createServer } from 'node:net';
import { join } from 'node:path';
import { atEnd, base, machineEnv, plain } from './harness.ts';

/** The exact text of a static site (10.4). */
export const WRANGLER_STATIC = `// Managed by @raess/astro-kit. A protected file: the kit renders it, and only the protected task changes it.
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "example-ch",
  "compatibility_date": "2026-11-01",
  "assets": { "directory": "./dist", "not_found_handling": "404-page", "html_handling": "auto-trailing-slash" },
  "workers_dev": false,
  "preview_urls": false,
  "routes": [{ "pattern": "example.ch", "custom_domain": true }],
  "env": {
    "preview": { "name": "example-ch-preview", "routes": [], "workers_dev": true, "preview_urls": true }
  }
}
`;

/** The exact text of a forms site (10.4), with one destination address. */
export const WRANGLER_FORMS = `// Managed by @raess/astro-kit. A protected file: the kit renders it, and only the protected task changes it.
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "example-ch",
  "compatibility_date": "2026-11-01",
  "assets": { "directory": "./dist/client", "not_found_handling": "404-page", "html_handling": "auto-trailing-slash", "run_worker_first": ["/api/forms/*"] },
  "workers_dev": false,
  "preview_urls": false,
  "routes": [{ "pattern": "example.ch", "custom_domain": true }],
  "send_email": [{ "name": "EMAIL", "allowed_destination_addresses": ["info@example.ch"] }],
  "ratelimits": [
    { "name": "FORM_RATE_LIMIT", "namespace_id": "1001", "simple": { "limit": 3, "period": 60 } },
    { "name": "FORM_RATE_LIMIT_ALL", "namespace_id": "1002", "simple": { "limit": 20, "period": 60 } }
  ],
  "observability": { "enabled": true },
  "env": {
    // Bindings are not inherited: a preview never sends mail.
    "preview": { "name": "example-ch-preview", "routes": [], "workers_dev": true, "preview_urls": true }
  }
}
`;

/** The place of the form shim of 9.1: the one on-demand route of a forms site. */
export const FORM_SHIM = "export const prerender = false;\nexport const POST = () => new Response('ok');\n";

/** The environment of a wrangler command: no metrics, no token, and its registry and logs in the case folder. */
export function wranglerEnv(dir: string): Record<string, string | undefined> {
  return {
    ...machineEnv(),
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_REGISTRY_PATH: join(dir, '.wrangler/registry'),
    WRANGLER_LOG_PATH: join(dir, '.wrangler/logs'),
    CI: '1',
    FORCE_COLOR: '0',
  };
}

export const wranglerBin = (): string => join(base(), 'node_modules/wrangler/bin/wrangler.js');

export interface Answer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface Call {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** One request with `node:http`: no proxy, no redirect following, and the path as it is written. */
export function call(origin: string, path: string, options: Call = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const sent = request(
      `${origin}${path}`,
      { method: options.method ?? 'GET', headers: options.headers ?? {}, agent: false, timeout: 20_000 },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        response.on('error', reject);
      },
    );
    sent.on('timeout', () => sent.destroy(new Error(`no answer for ${path}`)));
    sent.on('error', reject);
    sent.end(options.body);
  });
}

/** A request with no headers and no body. */
export const get = (origin: string, path: string, method = 'GET'): Promise<Answer> => call(origin, path, { method });

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export interface Wrangler {
  origin: string;
  /** What wrangler printed so far, without colors. */
  output(): string;
  close(): Promise<void>;
}

/** Sends the signal to the whole group: wrangler and the workerd that it started. A group that is gone is no error. */
function signalGroup(group: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-group, signal);
  } catch {
    // ESRCH: no process of the group is left.
  }
}

/**
 * Starts `wrangler dev --local` in the case folder with the config file `config`, on a free port, and waits until
 * it answers. The child leads a process group of its own. `close` ends the whole group, workerd included. The group
 * does not outlive the test process: `atEnd` of the harness ends it on `exit` and on SIGINT, SIGTERM and SIGHUP.
 * Only SIGKILL of the test process leaves it, because no process can catch that.
 */
export async function wranglerDev(dir: string, config = 'wrangler.jsonc'): Promise<Wrangler> {
  const [port, inspector] = [await freePort(), await freePort()];
  const child = spawn(
    process.execPath,
    [
      wranglerBin(),
      'dev',
      '--local',
      '--config',
      config,
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      String(inspector),
      '--show-interactive-dev-session=false',
    ],
    { cwd: dir, env: wranglerEnv(dir), detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  let exited = false;
  const ended = new Promise<void>((resolve) => {
    const end = (): void => {
      exited = true;
      resolve();
    };
    child.once('exit', end);
    // A child that did not start emits `error` and no `exit`.
    child.once('error', end);
  });
  // The group id is the pid of the child. The signal goes to the group also after wrangler itself is gone: a
  // workerd can still be alive in it.
  const group = child.pid;
  const kill = (signal: NodeJS.Signals): void => {
    if (group !== undefined) signalGroup(group, signal);
  };
  const forget = atEnd(() => kill('SIGKILL'));
  // The time limit of the child: three minutes is far more than a spike's requests need.
  const limit = setTimeout(() => kill('SIGKILL'), 180_000);
  const close = async (): Promise<void> => {
    clearTimeout(limit);
    kill('SIGTERM');
    const hard = setTimeout(() => kill('SIGKILL'), 5_000);
    await ended;
    clearTimeout(hard);
    // wrangler is gone. What is left in its group has no owner.
    kill('SIGKILL');
    forget();
  };
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`wrangler dev was not ready in 120 s:\n${plain(output)}`)),
        120_000,
      );
      const read = (chunk: Buffer): void => {
        output += chunk.toString('utf8');
        const ready = /Ready on (http:\/\/[^\s]+)/.exec(plain(output));
        if (ready?.[1]) {
          clearTimeout(timer);
          resolve(ready[1].replace(/\/$/, ''));
        }
      };
      child.stdout.on('data', read);
      child.stderr.on('data', read);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`wrangler dev ended with ${code ?? signal} before it was ready:\n${plain(output)}`));
      });
    });
    // "Ready" says that the port listens. The first answer says that the Worker runs.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await get(origin, '/');
        break;
      } catch (error) {
        if (attempt >= 50 || exited) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    return { origin, output: () => plain(output), close };
  } catch (error) {
    await close();
    throw error;
  }
}

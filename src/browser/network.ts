/**
 * The network of `astro-kit test` (specification, section 8, the harness, Network): no check reaches the network, and
 * no third party gets the data of a test run.
 *
 * - **The answer.** A context of a check answers each request to another origin itself, with status 204 and an empty
 *   body (`answerOtherOrigins`, a Playwright route). A frame of another host stays empty, and a `fetch` gets its
 *   answer, as `origins-gesture` asks (section 8).
 * - **The refusing proxy** (`startRefusingProxy`) answers each request with 403, closes the connection, and records
 *   its first line. Each browser that `launchBrowser` starts has one as its own proxy, so the requests of Chromium
 *   itself end there. Each run has one for the `proxy` option of its contexts: a Playwright route turns the browser
 *   cache off, so the perf pass, which measures the loading as a visitor gets it (`perf-prefetch` above all), gets
 *   no route (`BrowserRule.cache`), and its requests to another host end at this proxy. Each check of
 *   `origins-gesture` has one of its own, whose record belongs to its one page. A WebSocket, a shared worker, a
 *   prerender and a beacon after the page is gone, which no route answers, reach the proxy in every context.
 *
 * The test server is on 127.0.0.1, which Chromium never sends through a proxy, so the requests of the site pass
 * neither.
 */
import { createServer, type Server, type Socket } from 'node:net';
import type { BrowserContext } from 'playwright-core';

/** The status of the answer that the harness gives to each request to another origin (section 8). */
export const OTHER_ORIGIN_STATUS = 204;

/**
 * Answers each request of `context` to an origin other than `own` with 204 and an empty body. A request with no
 * host (`data:`) never reaches a route.
 */
export async function answerOtherOrigins(context: BrowserContext, own: string): Promise<void> {
  await context.route(
    (url) => url.origin !== own,
    (route) => route.fulfill({ status: OTHER_ORIGIN_STATUS, body: '' }),
  );
}

/** The answer of the proxy to every request: it forbids it, and the connection ends. */
export const REFUSAL = 'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n';

/** The longest time that the proxy waits for the first bytes of a request before it ends the connection. */
const IDLE_MS = 10_000;

/** The proxy keeps the first lines of this many refused requests, for a test. A long run makes more. */
const KEPT = 1_000;

/** A running proxy: its address for the `proxy` option of a browser context, and how to stop it. */
export interface RefusingProxy {
  /** `http://127.0.0.1:<port>`. */
  server: string;
  /**
   * The first line of each request that it refused, in order, such as `CONNECT example.org:443 HTTP/1.1`: the first
   * 1,000 of a run.
   */
  readonly refused: readonly string[];
  /** How many connections it holds that sent no first line yet: a request that it has not recorded. */
  readonly waiting: number;
  close(): Promise<void>;
}

/** Starts the refusing proxy on 127.0.0.1 and a free port. */
export async function startRefusingProxy(): Promise<RefusingProxy> {
  const refused: string[] = [];
  const sockets = new Set<Socket>();
  const silent = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    silent.add(socket);
    socket.setTimeout(IDLE_MS, () => socket.destroy());
    socket.on('error', () => undefined);
    socket.on('close', () => {
      sockets.delete(socket);
      silent.delete(socket);
    });
    socket.once('data', (chunk: Buffer) => {
      silent.delete(socket);
      const text = chunk.toString('latin1');
      const end = text.indexOf('\r\n');
      if (refused.length < KEPT) refused.push(text.slice(0, end === -1 ? 200 : Math.min(end, 200)));
      socket.end(REFUSAL);
    });
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => done());
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    server: `http://127.0.0.1:${port}`,
    refused,
    get waiting() {
      return silent.size;
    },
    close: () =>
      new Promise<void>((done) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => done());
      }),
  };
}

/** The `proxy` option of a browser context that sends every request to another host to `proxy`. */
export const proxyOption = (proxy: RefusingProxy): { server: string; bypass: string } => ({
  server: proxy.server,
  bypass: '127.0.0.1',
});

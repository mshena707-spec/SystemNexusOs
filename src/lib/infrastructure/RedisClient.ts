/**
 * RedisClient.ts — the one safe way for the server to connect to Redis.
 *
 * Redis is a "nice to have" speed-up and shared memory for several parts of the shop
 * (rate limits, cache, background jobs, live tracking across servers). The shop must keep
 * selling even when Redis is slow, restarting, or not yet started. Three things used to
 * go wrong when it wasn't:
 *
 *   1. A connection with no `error` listener makes Node throw "Unhandled error event" and
 *      the whole server crashes. The listener is attached BEFORE connecting here.
 *   2. `await client.connect()` waits forever while Redis is down, so a server that boots a
 *      few seconds before Redis would never finish starting. Here the first attempt is
 *      bounded; the client keeps retrying in the background and joins in when Redis arrives.
 *   3. While Redis is down, commands pile up in a hidden queue and every web request that
 *      touched Redis hangs. With `failFast` the command fails at once and the caller falls
 *      back to its in-memory path.
 *
 * Callers should use a client only while `client.isReady` is true.
 */

export interface SafeRedisOptions {
  /** Make commands fail immediately while disconnected instead of waiting in a queue. */
  failFast?: boolean;
  /** How long to wait for the very first connection before carrying on (default 4 s). */
  firstConnectWaitMs?: number;
}

export function redisUrlFromEnv(): string | undefined {
  return process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL || undefined;
}

/** Log Redis problems calmly (at most once every 30 s) instead of flooding the logs. */
export function attachRedisLogging(client: any, label: string): void {
  let lastWarn = 0;
  client.on('error', (err: Error) => {
    const now = Date.now();
    if (now - lastWarn > 30_000) {
      lastWarn = now;
      console.warn(`[Redis:${label}] ${err?.message || err} — the shop keeps running; retrying in the background`);
    }
  });
  client.on('ready', () => console.log(`[Redis:${label}] ✅ connected`));
  client.on('end', () => console.warn(`[Redis:${label}] connection closed`));
}

/**
 * Create a Redis client that can never crash or hang the server.
 * Returns null only when the `redis` package itself cannot be loaded.
 */
export async function createSafeRedisClient(
  url: string,
  label: string,
  opts: SafeRedisOptions = {},
): Promise<any | null> {
  let createClient: any;
  try {
    ({ createClient } = await import('redis'));
  } catch (err) {
    console.warn(`[Redis:${label}] the "redis" package is not installed — running without Redis`);
    return null;
  }

  const client = createClient({
    url,
    socket: {
      connectTimeout: 5_000,
      // wait 0.2s, 0.4s, 0.8s ... up to 10s between attempts, and never give up
      reconnectStrategy: (retries: number) => Math.min(200 * 2 ** Math.min(retries, 6), 10_000),
    },
    ...(opts.failFast ? { disableOfflineQueue: true } : {}),
  });

  attachRedisLogging(client, label);

  // Start connecting; the promise only settles once Redis answers, so do not wait for it forever.
  const connecting = Promise.resolve(client.connect()).catch(() => { /* logged by the listener */ });
  await Promise.race([
    connecting,
    new Promise<void>((resolve) => setTimeout(resolve, opts.firstConnectWaitMs ?? 4_000)),
  ]);

  return client;
}

/** Close a client politely during shutdown; never throws. */
export async function closeRedisClient(client: any): Promise<void> {
  try {
    if (client?.isOpen) await client.quit();
  } catch {
    try { await client?.disconnect?.(); } catch { /* ignore */ }
  }
}

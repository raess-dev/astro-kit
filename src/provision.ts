/**
 * astro-kit provision zone --check|--apply: the Cloudflare zone settings the kit relies on.
 * --check only reads. --apply patches each setting that differs, one PATCH per setting, and never deletes.
 * The zone is the one named by the host of `site` in astro-kit.json (or its parent domain).
 */
import { readFileSync } from 'node:fs';
import { loadOptions } from './options.ts';
import { Report } from './registry.ts';

const API = 'https://api.cloudflare.com/client/v4';
const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string })
  .version;

type Value = unknown;
interface Setting {
  id: string;
  want: Value;
  ok: (v: Value) => boolean;
  /** Settings the zone may not offer; an unknown-setting answer for them is not a finding. */
  optional?: boolean;
}

const off = (v: Value): boolean =>
  v === 'off' || v === false || (typeof v === 'object' && v !== null && (v as { enabled?: unknown }).enabled === false);
const is =
  (...values: Value[]) =>
  (v: Value) =>
    values.includes(v);

/** zone-settings: patched with --apply. */
export const ZONE_SETTINGS: readonly Setting[] = [
  { id: 'min_tls_version', want: '1.2', ok: is('1.2', '1.3') },
  { id: 'tls_1_3', want: 'on', ok: is('on', 'zrt') },
  { id: 'always_use_https', want: 'on', ok: is('on') },
  { id: 'http3', want: 'on', ok: is('on') },
  { id: 'rocket_loader', want: 'off', ok: off },
  { id: 'email_obfuscation', want: 'off', ok: off },
  { id: 'speed_brain', want: 'off', ok: off },
  { id: 'nel', want: { enabled: false }, ok: off },
  { id: 'rum', want: 'off', ok: off, optional: true },
];

/** zone-rewriters: features that rewrite pages; patched only with --apply and only where the API takes it. */
export const ZONE_REWRITERS = ['pre_render', 'webmcp_enabled', 'content_converter', 'search_for_agents'];

/** The off value in the shape the setting already uses. */
export const offValue = (current: Value): Value =>
  typeof current === 'boolean'
    ? false
    : typeof current === 'object' && current !== null
      ? { ...current, enabled: false }
      : 'off';

interface Answer {
  status: number;
  result: unknown;
  error: string;
}

export interface ProvisionDeps {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  root?: string;
  log?: (line: string) => void;
}

export async function runProvision(args: string[], deps: ProvisionDeps = {}): Promise<Report> {
  const [scope, ...flags] = args;
  const apply = flags.includes('--apply');
  if (scope !== 'zone' || flags.length !== 1 || !(apply || flags.includes('--check'))) {
    throw new Error('usage: astro-kit provision zone --check|--apply');
  }
  const env = deps.env ?? process.env;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token)
    throw new Error(
      'astro-kit provision: set CLOUDFLARE_API_TOKEN (a read token for --check, a Zone Settings edit token for --apply)',
    );
  const call = deps.fetch ?? fetch;
  const log = deps.log ?? ((line: string) => console.log(line));
  const report = new Report();
  const options = loadOptions(deps.root ?? process.cwd(), report);
  if (!options) return report;

  const cf = async (path: string, init: { method?: string; body?: unknown } = {}): Promise<Answer> => {
    try {
      const r = await call(`${API}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'user-agent': `astro-kit/${VERSION} provision`,
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await r.json().catch(() => ({}))) as {
        success?: boolean;
        result?: unknown;
        errors?: { code?: number; message?: string }[];
      };
      const error =
        r.ok && body.success !== false
          ? ''
          : (body.errors ?? []).map((e) => `${e.code ?? ''} ${e.message ?? ''}`.trim()).join('; ') ||
            `HTTP ${r.status}`;
      return { status: r.status, result: body.result, error };
    } catch (error) {
      return { status: 0, result: undefined, error: (error as Error).message };
    }
  };

  // The zone: the site host, then each parent domain down to two labels.
  const host = new URL(options.site).hostname;
  const labels = host.split('.');
  let zone: { id: string; name: string } | undefined;
  for (let i = 0; i + 2 <= labels.length && !zone; i++) {
    const found = await cf(`/zones?name=${labels.slice(i).join('.')}`);
    if (found.error) {
      report.add('zone-settings', host, `zone lookup failed: ${found.error}`);
      return report;
    }
    zone = (found.result as { id: string; name: string }[] | undefined)?.[0];
  }
  if (!zone) {
    report.add('zone-settings', host, 'no zone for this host is visible to the token');
    return report;
  }
  const { id: zoneId, name: zoneName } = zone;
  const where = (id: string) => `${zoneName}: ${id}`;

  const settle = async (
    rule: string,
    id: string,
    ok: (v: Value) => boolean,
    want: (current: Value) => Value,
    optional = false,
  ): Promise<void> => {
    const got = await cf(`/zones/${zoneId}/settings/${id}`);
    if (got.error) {
      // An unknown setting answers 400 or 404; for an optional one that means the zone does not offer it.
      if (optional && (got.status === 400 || got.status === 404))
        log(`astro-kit provision: ${id} is not offered for this zone`);
      else report.add(rule, where(id), `not readable: ${got.error}`);
      return;
    }
    const current = (got.result as { value?: Value } | undefined)?.value;
    if (ok(current)) return;
    const shown = JSON.stringify(current);
    if (!apply) {
      report.add(rule, where(id), `is ${shown}, expected ${JSON.stringify(want(current))}`);
      return;
    }
    const patched = await cf(`/zones/${zoneId}/settings/${id}`, { method: 'PATCH', body: { value: want(current) } });
    if (patched.error) report.add(rule, where(id), `is ${shown}; the patch failed: ${patched.error}`);
    else log(`astro-kit provision: ${id} ${shown} → ${JSON.stringify(want(current))}`);
  };

  for (const s of ZONE_SETTINGS) await settle('zone-settings', s.id, s.ok, () => s.want, s.optional);
  // A rewriter the zone does not offer cannot be on.
  for (const id of ZONE_REWRITERS) await settle('zone-rewriters', id, off, offValue, true);

  // zone-bots: read only; the owner changes these under Security settings.
  const bots = await cf(`/zones/${zoneId}/bot_management`);
  if (bots.error) report.add('zone-bots', where('bot_management'), `not readable: ${bots.error}`);
  else {
    const b = (bots.result ?? {}) as { ai_bots_protection?: string; is_robots_txt_managed?: boolean };
    if (b.ai_bots_protection !== undefined && b.ai_bots_protection !== 'disabled')
      report.add('zone-bots', where('ai_bots_protection'), `is ${b.ai_bots_protection}, expected disabled`);
    if (b.is_robots_txt_managed === true)
      report.add('zone-bots', where('is_robots_txt_managed'), 'is true, expected false');
  }
  return report;
}

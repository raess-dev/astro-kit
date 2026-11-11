/**
 * KIT-FEEDBACK.md: entries a site's agents write when they work around the kit. `astro-kit feedback send`
 * files each new entry once as an issue in the private intake repository. With KIT_FEEDBACK_AUTO_KEY the
 * issue ends in an HMAC line, which templates/intake.yml verifies the same way as verifyBody() below.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const FEEDBACK_FILE = 'KIT-FEEDBACK.md';
export const FEEDBACK_REPO = 'raess-dev/astro-kit-feedback';
export const FEEDBACK_TYPES = ['bug', 'false-positive', 'gap', 'docs', 'friction'] as const;
const FIELDS = ['date', 'kit', 'type', 'problem', 'evidence', 'proposal'] as const;

export type FeedbackEntry = { id: string } & Record<(typeof FIELDS)[number], string>;

export const newFeedbackId = (): string => `kf-${randomBytes(4).toString('hex')}`;

/** Entries in file order, plus the problems that keep an entry from being sent. Fenced examples and comments are skipped. */
export function parseFeedback(text: string): { entries: FeedbackEntry[]; errors: string[] } {
  const clean = text
    .replace(/\r\n/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^```[\s\S]*?^```/gm, '');
  const entries: FeedbackEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const section of clean.split(/^## /m).slice(1)) {
    const [heading = '', ...lines] = section.split('\n');
    const id = heading.trim();
    if (!/^kf-[0-9a-f]{8}$/.test(id)) {
      errors.push(`"## ${id}": the heading must be an id, kf- and 8 hex digits`);
      continue;
    }
    if (seen.has(id)) errors.push(`${id}: duplicate id`);
    seen.add(id);
    const fields: Record<string, string> = {};
    let last: string | undefined;
    for (const line of lines) {
      const field = /^- ([a-z]+):\s*(.*)$/.exec(line);
      if (field?.[1]) {
        last = field[1];
        fields[last] = (field[2] ?? '').trim();
      } else if (last && /^\s+\S/.test(line)) fields[last] = `${fields[last]} ${line.trim()}`.trim();
    }
    const missing = FIELDS.filter((f) => !fields[f]);
    if (missing.length) errors.push(`${id}: missing ${missing.join(', ')}`);
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date ?? '')) errors.push(`${id}: date must be YYYY-MM-DD`);
    else if (!/^\d+\.\d+\.\d+\S*$/.test(fields.kit ?? '')) errors.push(`${id}: kit must be a version such as 1.2.0`);
    else if (!(FEEDBACK_TYPES as readonly string[]).includes(fields.type ?? ''))
      errors.push(`${id}: type must be one of ${FEEDBACK_TYPES.join(', ')}`);
    else
      entries.push({
        id,
        ...(Object.fromEntries(FIELDS.map((f) => [f, fields[f] ?? ''])) as Record<(typeof FIELDS)[number], string>),
      });
  }
  return { entries, errors };
}

/** The signed text: one `key: value` line per field in a fixed order, NFC-normalised. */
export const canonical = (entry: FeedbackEntry): string =>
  ['id', ...FIELDS]
    .map((key) => `${key}: ${entry[key as keyof FeedbackEntry]}`)
    .join('\n')
    .normalize('NFC');

export const signText = (text: string, key: string): string =>
  createHmac('sha256', key).update(text.normalize('NFC')).digest('hex');

export const sign = (entry: FeedbackEntry, key: string): string => signText(canonical(entry), key);

/** The issue body: the canonical entry, then the signature line when an auto key is set. */
export const issueBody = (entry: FeedbackEntry, key?: string): string =>
  key ? `${canonical(entry)}\n\nsignature: ${sign(entry, key)}` : canonical(entry);

/** True when the body's last line signs the text above it. Mirrors the script in templates/intake.yml. */
export function verifyBody(body: string, key: string): boolean {
  const text = body.replace(/\r\n/g, '\n').trim();
  const match = /\n+signature: ([0-9a-f]{64})$/.exec(text);
  if (!match?.[1] || !key) return false;
  const mac = Buffer.from(signText(text.slice(0, match.index).trim(), key), 'hex');
  return timingSafeEqual(mac, Buffer.from(match[1], 'hex'));
}

export interface SendOptions {
  token: string;
  key?: string | undefined;
  repo?: string;
  userAgent: string;
  fetch?: typeof fetch;
}

/** Files entries whose id has no issue yet; returns the ids sent and the ids already there. */
export async function sendFeedback(entries: readonly FeedbackEntry[], opts: SendOptions) {
  const call = opts.fetch ?? fetch;
  const repo = opts.repo ?? FEEDBACK_REPO;
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${opts.token}`,
    'user-agent': opts.userAgent,
    'x-github-api-version': '2022-11-28',
  };
  const github = async (path: string, init: RequestInit = {}): Promise<Record<string, unknown>> => {
    const response = await call(`https://api.github.com${path}`, { ...init, headers: { ...headers, ...init.headers } });
    if (!response.ok)
      throw new Error(`astro-kit feedback: GitHub answered ${response.status} for ${path.split('?')[0]}`);
    return (await response.json()) as Record<string, unknown>;
  };
  const sent: string[] = [];
  const skipped: string[] = [];
  for (const entry of entries) {
    const q = encodeURIComponent(`repo:${repo} in:title "${entry.id}"`);
    const found = await github(`/search/issues?q=${q}&per_page=10`);
    const items = Array.isArray(found.items) ? (found.items as { title?: string }[]) : [];
    if (items.some((i) => i.title?.startsWith(entry.id))) {
      skipped.push(entry.id);
      continue;
    }
    const title = `${entry.id} ${entry.type}: ${entry.problem.length > 80 ? `${entry.problem.slice(0, 79)}…` : entry.problem}`;
    await github(`/repos/${repo}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title, body: issueBody(entry, opts.key) }),
      headers: { 'content-type': 'application/json' },
    });
    sent.push(entry.id);
  }
  return { sent, skipped };
}

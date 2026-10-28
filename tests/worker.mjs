import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const store = new Map(); // name -> { value, metadata, expirationTtl }
const env = {
  SUB_STORE: {
    async get(k) { return store.get(k)?.value ?? null; },
    async put(k, v, opts = {}) { store.set(k, { value: v, metadata: opts.metadata, expirationTtl: opts.expirationTtl }); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '', limit = 1000 } = {}) {
      const keys = [...store.entries()]
        .filter(([name]) => name.startsWith(prefix))
        .slice(0, limit)
        .map(([name, e]) => ({ name, metadata: e.metadata }));
      return { keys, list_complete: true, cursor: '' };
    },
  },
  ASSETS: { async fetch() { return new Response('HOME'); } },
  SUB_ACCESS_TOKEN: 'tok',
};

const linkTokens = new Map(); // entry id -> its per-entry link token
async function generate(body) {
  const r = await worker.fetch(new Request('https://x.pages.dev/api/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), env);
  const j = await r.json();
  assert.equal(j.ok, true, JSON.stringify(j));
  if (j.shortId && j.urls) linkTokens.set(j.shortId, new URL(j.urls.auto).searchParams.get('token') || '');
  return j;
}
async function getSub(id, target, tokenOverride) {
  const token = tokenOverride !== undefined ? tokenOverride : linkTokens.get(id);
  const q = new URLSearchParams();
  if (target) q.set('target', target);
  if (token) q.set('token', token);
  const r = await worker.fetch(new Request(`https://x.pages.dev/sub/${id}?${q}`), env);
  return { status: r.status, body: await r.text() };
}

// --- Owner's example: plain links must match the expected strings exactly ---
const node = 'vless://f541611e-0aeb-4900-aa47-6e95d4916a49@walh6h3rdnazjx.topoffice.dpdns.org:443?alpn=http%2F1.1&encryption=none&fp=chrome&host=walh6h3rdnazjx.topoffice.dpdns.org&path=%2Fws-path&security=tls&sni=walh6h3rdnazjx.topoffice.dpdns.org&type=ws#%E7%BE%8E%E5%9B%BD33-freetrialtelegram';
const j1 = await generate({ nodeLinks: node, preferredIps: 'bestcf.top\ncf.877774.xyz', namePrefix: 'v4v6双栈-高速优选', keepOriginalHost: true });
const frag = (n) => encodeURIComponent(n);
const expect1 = 'vless://f541611e-0aeb-4900-aa47-6e95d4916a49@bestcf.top:443?alpn=http%2F1.1&encryption=none&fp=chrome&host=walh6h3rdnazjx.topoffice.dpdns.org&path=%2Fws-path&security=tls&sni=walh6h3rdnazjx.topoffice.dpdns.org&type=ws#' + frag('美国33-freetrialtelegram | v4v6双栈-高速优选 | 1');
const expect2 = expect1.replace('@bestcf.top', '@cf.877774.xyz').replace(frag('| 1'), frag('| 2'));
assert.equal(j1.plainText, expect1 + '\n' + expect2);
const sub = await getSub(j1.shortId, 'plain');
assert.equal(sub.status, 200);
assert.equal(sub.body, expect1 + '\n' + expect2);
const rawSub = await getSub(j1.shortId, 'raw');
assert.equal(Buffer.from(rawSub.body, 'base64').toString('utf8'), expect1 + '\n' + expect2);
console.log('owner example: plain output matches exactly, raw = base64(plain)');

// --- IPv6 preferred endpoints ---
const j2 = await generate({ nodeLinks: node, preferredIps: '2606:4700:4700::1111#v6-bare\n[2606:4700:4700::1001]:8443#v6-port\n2001:db8::1', namePrefix: '', keepOriginalHost: true });
const links = j2.plainText.split('\n');
assert.equal(links.length, 3);
assert.ok(links[0].includes('@[2606:4700:4700::1111]:443?'), links[0]); // bare v6 kept whole, default port, bracketed in URL
assert.ok(links[1].includes('@[2606:4700:4700::1001]:8443?'), links[1]); // bracketed v6 + explicit port
assert.ok(links[2].includes('@[2001:db8::1]:443?'), links[2]);          // "2001:db8::1" must not lose "::1" as a port
const clash = await getSub(j2.shortId, 'clash');
assert.ok(clash.body.includes('server: "2606:4700:4700::1111"'), clash.body.split('\n').slice(8,14).join('\n'));
const vm = await generate({ nodeLinks: 'vmess://ewogICJ2IjogIjIiLAogICJwcyI6ICJkZW1vIiwKICAiYWRkIjogImVkZ2UuZXhhbXBsZS5jb20iLAogICJwb3J0IjogIjQ0MyIsCiAgImlkIjogIjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSIsCiAgInNjeSI6ICJhdXRvIiwKICAibmV0IjogIndzIiwKICAidGxzIjogInRscyIsCiAgInBhdGgiOiAiL3dzIiwKICAiaG9zdCI6ICJlZGdlLmV4YW1wbGUuY29tIiwKICAic25pIjogImVkZ2UuZXhhbXBsZS5jb20iCn0=', preferredIps: '2606:4700::1' });
const vmPayload = JSON.parse(Buffer.from(vm.plainText.replace('vmess://',''), 'base64').toString('utf8'));
assert.equal(vmPayload.add, '2606:4700::1'); // vmess add is the bare address, no brackets/truncation
console.log('ipv6: bare, bracketed and bracketed+port all parse and render correctly');

console.log('worker tests passed');

// --- Permanent storage + notes + admin (appended suite) ---
{
  // seed a legacy entry: written the OLD way, with a 7-day TTL, no note/metadata
  const legacyId = 'legacyID01';
  store.set(`sub:${legacyId}`, {
    value: JSON.stringify({ version: 1, createdAt: '2026-10-20T00:00:00.000Z', options: {}, nodes: [] }),
    expirationTtl: 60 * 60 * 24 * 7,
  });

  const nodeA = 'vless://f541611e-0aeb-4900-aa47-6e95d4916a49@vps-a.example.com:443?security=tls&type=ws&path=%2Fws&host=vps-a.example.com&sni=vps-a.example.com#VPS-A%E8%8A%82%E7%82%B9';
  const g = await generate({ nodeLinks: nodeA, preferredIps: 'bestcf.top', note: '搬瓦工 DC6' });
  assert.equal(g.note, '搬瓦工 DC6');
  const entry = store.get(`sub:${g.shortId}`);
  assert.ok(entry, 'record stored');
  assert.equal(entry.expirationTtl, undefined, 'record must be stored permanently (no TTL)');
  const rec = JSON.parse(entry.value);
  assert.equal(rec.note, '搬瓦工 DC6');
  assert.equal(rec.sources[0].server, 'vps-a.example.com');
  assert.equal(entry.metadata.note, '搬瓦工 DC6');
  assert.equal(entry.metadata.sources, 'vps-a.example.com');
  assert.equal(store.get(`note:搬瓦工 DC6:${g.shortId}`)?.value, g.shortId, 'note pointer key exists');
  const dedupKey = [...store.keys()].find((k) => k.startsWith('dedup:'));
  assert.equal(store.get(dedupKey).expirationTtl, undefined, 'dedup key permanent too');

  // Same content again with a different note: same id, note updated, pointers swapped
  const g2 = await generate({ nodeLinks: nodeA, preferredIps: 'bestcf.top', note: '搬瓦工 DC9' });
  assert.equal(g2.shortId, g.shortId);
  assert.equal(JSON.parse(store.get(`sub:${g.shortId}`).value).note, '搬瓦工 DC9');
  assert.equal(store.has(`note:搬瓦工 DC6:${g.shortId}`), false, 'old pointer removed');
  assert.equal(store.get(`note:搬瓦工 DC9:${g.shortId}`)?.value, g.shortId);

  // Admin auth
  const badList = await worker.fetch(new Request('https://x.pages.dev/api/list?token=wrong'), env);
  assert.equal(badList.status, 403);
  const listResp = await worker.fetch(new Request('https://x.pages.dev/api/list?token=tok'), env);
  const list = await listResp.json();
  assert.equal(list.ok, true);
  const mine = list.items.find((i) => i.id === g.shortId);
  assert.equal(mine.note, '搬瓦工 DC9');
  assert.deepEqual(mine.sources, ['vps-a.example.com']);
  assert.ok(list.items.some((i) => i.id === legacyId), 'legacy entry listed via fallback');

  // Rename via admin endpoint
  const noteResp = await worker.fetch(new Request('https://x.pages.dev/api/note', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: g.shortId, note: '主力美国 VPS', token: 'tok' }),
  }), env);
  assert.equal((await noteResp.json()).ok, true);
  assert.equal(JSON.parse(store.get(`sub:${g.shortId}`).value).note, '主力美国 VPS');
  assert.equal(store.get(`note:主力美国 VPS:${g.shortId}`)?.value, g.shortId);
  assert.equal(store.has(`note:搬瓦工 DC9:${g.shortId}`), false);

  // Renaming the LEGACY entry also strips its 7-day TTL (rewritten permanently)
  const legacyNote = await worker.fetch(new Request('https://x.pages.dev/api/note', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: legacyId, note: '旧条目', token: 'tok' }),
  }), env);
  assert.equal((await legacyNote.json()).ok, true);
  assert.equal(store.get(`sub:${legacyId}`).expirationTtl, undefined, 'legacy entry migrated to permanent on note save');

  // Delete removes record + pointer + dedup key, and the sub link dies
  const myDedupKey = [...store.entries()].find(([k, e]) => k.startsWith('dedup:') && e.value === g.shortId)?.[0];
  assert.ok(myDedupKey, 'found this entry dedup key');
  const del = await worker.fetch(new Request('https://x.pages.dev/api/delete', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: g.shortId, token: 'tok' }),
  }), env);
  assert.equal((await del.json()).ok, true);
  assert.equal(store.has(`sub:${g.shortId}`), false);
  assert.equal(store.has(`note:主力美国 VPS:${g.shortId}`), false);
  assert.equal(store.has(myDedupKey), false, 'dedup key removed');
  const gone = await worker.fetch(new Request(`https://x.pages.dev/sub/${g.shortId}?token=${linkTokens.get(g.shortId)}`), env);
  assert.equal(gone.status, 404);
  console.log('permanent storage, notes, pointers, admin list/note/delete, legacy migration: all passed');
}

// --- Retention choice suite ---
{
  const nodeB = 'vless://f541611e-0aeb-4900-aa47-6e95d4916a49@vps-b.example.com:443?security=tls&type=ws&path=%2Fws&host=vps-b.example.com&sni=vps-b.example.com#B';

  // days mode: both keys carry the TTL, record + metadata know the plan
  const before = Date.now();
  const timed = await generate({ nodeLinks: nodeB, preferredIps: 'bestcf.top', storageMode: 'days', retentionDays: 7, note: '临时条目' });
  assert.equal(timed.storage.mode, 'days');
  assert.equal(timed.storage.days, 7);
  const expiresMs = Date.parse(timed.storage.expiresAt);
  assert.ok(expiresMs - before >= 7 * 86400 * 1000 - 5000 && expiresMs - before <= 7 * 86400 * 1000 + 5000, 'expiresAt ~= now + 7d');
  assert.equal(store.get(`sub:${timed.shortId}`).expirationTtl, 7 * 86400, 'record TTL = 7d');
  const dk = [...store.entries()].find(([k, e]) => k.startsWith('dedup:') && e.value === timed.shortId)?.[0];
  assert.equal(store.get(dk).expirationTtl, 7 * 86400, 'dedup TTL = 7d');
  assert.equal(store.get(`sub:${timed.shortId}`).metadata.retention, 'days:7');
  assert.equal(store.get(`sub:${timed.shortId}`).metadata.exp, timed.storage.expiresAt);

  // list surfaces the plan
  const lr = await (await worker.fetch(new Request('https://x.pages.dev/api/list?token=tok'), env)).json();
  const li = lr.items.find((i) => i.id === timed.shortId);
  assert.equal(li.storage.mode, 'days'); assert.equal(li.storage.days, 7); assert.equal(li.storage.expiresAt, timed.storage.expiresAt);

  // saving a note preserves (approximately) the remaining TTL instead of wiping it
  const nr = await worker.fetch(new Request('https://x.pages.dev/api/note', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: timed.shortId, note: '临时条目改名', token: 'tok' }),
  }), env);
  assert.equal((await nr.json()).ok, true);
  const ttlAfter = store.get(`sub:${timed.shortId}`).expirationTtl;
  assert.ok(ttlAfter <= 7 * 86400 && ttlAfter > 7 * 86400 - 3600, `note save keeps remaining TTL, got ${ttlAfter}`);
  assert.equal(JSON.parse(store.get(`sub:${timed.shortId}`).value).storage.expiresAt, timed.storage.expiresAt, 'expiresAt unchanged by note save');

  // regenerate same content as permanent: same id, TTL gone, plan switched
  const again = await generate({ nodeLinks: nodeB, preferredIps: 'bestcf.top', storageMode: 'permanent' });
  assert.equal(again.shortId, timed.shortId);
  assert.equal(again.storage.mode, 'permanent');
  assert.equal(store.get(`sub:${timed.shortId}`).expirationTtl, undefined, 'switched back to permanent');
  assert.equal(store.get(dk).expirationTtl, undefined, 'dedup permanent again');
  assert.equal(JSON.parse(store.get(`sub:${timed.shortId}`).value).note, '临时条目改名', 'note survives retention switch when no new note given');

  // invalid days rejected
  const bad = await worker.fetch(new Request('https://x.pages.dev/api/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeLinks: nodeB, preferredIps: 'bestcf.top', storageMode: 'days', retentionDays: 0 }),
  }), env);
  assert.equal(bad.status, 400);
  console.log('retention: days/permanent switching, TTL values, note-save preservation, validation: all passed');

  // --- POST /api/retention: change an existing entry's retention plan ---
  const retPost = (payload, token = 'tok') => worker.fetch(new Request('https://x.pages.dev/api/retention', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, ...payload }),
  }), env);
  // entry is permanent right now; give it 10 days from now
  let rr = await retPost({ id: timed.shortId, mode: 'days', days: 10 });
  assert.equal(rr.status, 200, 'retention days: status');
  let rj = await rr.json();
  assert.equal(rj.storage.mode, 'days');
  assert.equal(rj.storage.days, 10);
  const drift = Math.abs(Date.parse(rj.storage.expiresAt) - (Date.now() + 10 * 86400e3));
  assert.ok(drift < 120000, 'expiresAt is ~10 days from now');
  assert.equal(store.get(`sub:${timed.shortId}`).expirationTtl, 10 * 86400, 'record TTL updated to 10d');
  assert.equal(store.get(dk).expirationTtl, 10 * 86400, 'dedup TTL updated to 10d');
  assert.equal(JSON.parse(store.get(`sub:${timed.shortId}`).value).note, '临时条目改名', 'note survives retention change');
  // list reflects the new plan
  const lr2 = await (await worker.fetch(new Request('https://x.pages.dev/api/list?token=tok'), env)).json();
  const listed1 = lr2.items.find((i) => i.id === timed.shortId);
  assert.equal(listed1.storage.mode, 'days');
  assert.equal(listed1.storage.days, 10);
  // back to permanent clears both TTLs
  rr = await retPost({ id: timed.shortId, mode: 'permanent' });
  assert.equal(rr.status, 200);
  assert.equal(store.get(`sub:${timed.shortId}`).expirationTtl, undefined, 'record permanent again');
  assert.equal(store.get(dk).expirationTtl, undefined, 'dedup permanent again');
  // validation + auth + missing entry
  assert.equal((await retPost({ id: timed.shortId, mode: 'days', days: 0 })).status, 400, 'days=0 rejected');
  assert.equal((await retPost({ id: timed.shortId, mode: 'days', days: 99999 })).status, 400, 'days too large rejected');
  assert.equal((await retPost({ id: 'nope999', mode: 'permanent' })).status, 404, 'unknown id 404');
  assert.equal((await retPost({ id: timed.shortId, mode: 'permanent' }, 'wrong')).status, 403, 'wrong token 403');
  console.log('retention endpoint: plan switching, TTL sync, list reflection, validation: all passed');

  // --- GET /api/entry: direct read used by the UI's write verification ---
  const er = await worker.fetch(new Request(`https://x.pages.dev/api/entry?id=${timed.shortId}&token=tok`), env);
  assert.equal(er.status, 200, 'entry read: status');
  const ej = await er.json();
  assert.equal(ej.note, '临时条目改名', 'entry read: note straight from the record');
  assert.equal(ej.storage.mode, 'permanent', 'entry read: storage straight from the record');
  assert.equal((await worker.fetch(new Request('https://x.pages.dev/api/entry?id=nope999&token=tok'), env)).status, 404, 'entry read: unknown id 404');
  assert.equal((await worker.fetch(new Request(`https://x.pages.dev/api/entry?id=${timed.shortId}&token=wrong`), env)).status, 403, 'entry read: wrong token 403');
  console.log('entry endpoint: direct read, 404, 403: all passed');

  // --- Regression: list must follow the RECORD, not the (lagging) metadata ---
  // Give the entry a 3-day plan via the endpoint, then rewind the stored
  // key metadata to the old permanent plan, simulating a stale list index.
  await retPost({ id: timed.shortId, mode: 'days', days: 3 });
  const subKey = `sub:${timed.shortId}`;
  const freshMeta = store.get(subKey).metadata;
  store.get(subKey).metadata = { ...freshMeta, retention: 'permanent', exp: '' };
  const lr3 = await (await worker.fetch(new Request('https://x.pages.dev/api/list?token=tok'), env)).json();
  const listed3 = lr3.items.find((i) => i.id === timed.shortId);
  assert.equal(listed3.storage.mode, 'days', 'list shows the record plan despite stale metadata');
  assert.equal(listed3.storage.days, 3, 'list shows the record days despite stale metadata');
  assert.equal(listed3.note, '临时条目改名', 'list note also comes from the record');
  // restore: back to permanent for a clean end state
  await retPost({ id: timed.shortId, mode: 'permanent' });
  console.log('list record-source regression: passed');

  // --- Regression: a deleted entry still enumerated by the list index
  // (ghost key, record already gone) must NOT appear in /api/list ---
  store.set('sub:ghost000', {
    value: null,
    metadata: { note: '幽灵条目', createdAt: '2026-10-28T00:00:00.000Z', sources: 'gone.example.com', out: 1, retention: 'permanent', exp: '' },
    expirationTtl: undefined,
  });
  const lr4 = await (await worker.fetch(new Request('https://x.pages.dev/api/list?token=tok'), env)).json();
  assert.ok(!lr4.items.some((i) => i.id === 'ghost000'), 'ghost key skipped in list');
  store.delete('sub:ghost000');
  console.log('ghost key regression: passed');
}

// --- Form backfill suite: exact inputs for new entries, reconstruction for legacy ---
{
  const getEntry = async (id) => {
    const r = await worker.fetch(new Request(`https://x.pages.dev/api/entry?id=${id}&token=tok`), env);
    return r.json();
  };

  // 1) New entry: backfill is the verbatim form input.
  const nodeA = 'vless://11111111-2222-4333-8444-555555555555@edge-a.example.com:443?encryption=none&security=tls&sni=edge-a.example.com&host=edge-a.example.com&type=ws&path=%2Fws#NodeA';
  const nodeB = 'trojan://pw123@edge-b.example.com:8443?security=tls&sni=edge-b.example.com&type=ws&host=edge-b.example.com&path=%2Ftj#NodeB';
  const gen = await generate({
    nodeLinks: `${nodeA}\n${nodeB}`,
    preferredIps: '198.51.100.7:2053#P1\nbestcf.example.net',
    namePrefix: 'PX', keepOriginalHost: true, note: '回填测试',
    storageMode: 'days', retentionDays: 12,
  });
  const e1 = await getEntry(gen.shortId);
  assert.equal(e1.backfill.exact, true, 'new entry backfills exactly');
  assert.equal(e1.backfill.nodeLinks, `${nodeA}\n${nodeB}`);
  assert.equal(e1.backfill.preferredIps, '198.51.100.7:2053#P1\nbestcf.example.net');
  assert.equal(e1.backfill.namePrefix, 'PX');
  assert.equal(e1.backfill.keepOriginalHost, true);
  assert.equal(e1.backfill.note, '回填测试');
  assert.equal(e1.backfill.storage.mode, 'days');
  assert.equal(e1.backfill.storage.days, 12);

  // 2) Legacy entry (inputs stripped): reconstruction restores the
  //    preferred list verbatim (port + remark on #1, portless domain on #2)
  //    and the originals well enough that regenerating dedup-hits the
  //    very same entry; the dedup hit then backfills exact inputs.
  const key = `sub:${gen.shortId}`;
  const rec = JSON.parse(store.get(key).value);
  delete rec.inputs;
  store.get(key).value = JSON.stringify(rec);
  const e2 = await getEntry(gen.shortId);
  assert.equal(e2.backfill.exact, false, 'legacy entry uses reconstruction');
  assert.equal(e2.backfill.preferredIps, '198.51.100.7:2053#P1\nbestcf.example.net', 'reconstructed preferred list');
  const regen = await generate({
    nodeLinks: e2.backfill.nodeLinks,
    preferredIps: e2.backfill.preferredIps,
    namePrefix: e2.backfill.namePrefix,
    keepOriginalHost: e2.backfill.keepOriginalHost,
  });
  assert.equal(regen.shortId, gen.shortId, 'reconstructed inputs regenerate the same entry');
  const e3 = await getEntry(gen.shortId);
  assert.equal(e3.backfill.exact, true, 'dedup hit backfills exact inputs onto legacy record');

  // 3) vmess round-trip: reconstruction regenerates identical subscription
  //    content (the re-encoded vmess text differs, so no id assertion).
  const nodeC = 'vmess://ewogICJ2IjogIjIiLAogICJwcyI6ICJkZW1vIiwKICAiYWRkIjogImVkZ2UuZXhhbXBsZS5jb20iLAogICJwb3J0IjogIjQ0MyIsCiAgImlkIjogIjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSIsCiAgInNjeSI6ICJhdXRvIiwKICAibmV0IjogIndzIiwKICAidGxzIjogInRscyIsCiAgInBhdGgiOiAiL3dzIiwKICAiaG9zdCI6ICJlZGdlLmV4YW1wbGUuY29tIiwKICAic25pIjogImVkZ2UuZXhhbXBsZS5jb20iCn0=';
  const genC = await generate({ nodeLinks: nodeC, preferredIps: '192.0.2.10:8443\n192.0.2.11', namePrefix: 'PX', keepOriginalHost: true });
  const keyC = `sub:${genC.shortId}`;
  const recC = JSON.parse(store.get(keyC).value);
  delete recC.inputs;
  store.get(keyC).value = JSON.stringify(recC);
  const eC = await getEntry(genC.shortId);
  assert.equal(eC.backfill.exact, false);
  assert.equal(eC.backfill.preferredIps, '192.0.2.10:8443\n192.0.2.11', 'counter suffixes are not mistaken for remarks');
  const regenC = await generate({
    nodeLinks: eC.backfill.nodeLinks,
    preferredIps: eC.backfill.preferredIps,
    namePrefix: eC.backfill.namePrefix,
    keepOriginalHost: eC.backfill.keepOriginalHost,
  });
  assert.equal(regenC.plainText, genC.plainText, 'vmess reconstruction regenerates identical content');

  // 4) Record without sources/nodes cannot be backfilled.
  store.set('sub:ancient1', { value: JSON.stringify({ version: 1, createdAt: '2026-01-01T00:00:00.000Z' }), metadata: {}, expirationTtl: undefined });
  const e4 = await getEntry('ancient1');
  assert.equal(e4.backfill, null, 'record without sources/nodes: backfill null');
  store.delete('sub:ancient1');

  // 5) Delete removes the stored inputs along with everything else: the
  //    inputs live INSIDE the single sub:<id> record value (no separate
  //    key), and delete clears record + note pointer + dedup key.
  const genD = await generate({ nodeLinks: nodeA, preferredIps: '203.0.113.9', namePrefix: 'D', note: '待删条目' });
  const recD = JSON.parse(store.get(`sub:${genD.shortId}`).value);
  assert.ok(recD.inputs && recD.inputs.nodeLinks === nodeA, 'inputs stored inside the record');
  const keysBefore = [...store.keys()].filter((k) => k.includes(genD.shortId) || k === `dedup:${recD.dedupHash}`);
  assert.equal(keysBefore.length, 3, 'record + note pointer + dedup key exist before delete');
  const delResp = await worker.fetch(new Request('https://x.pages.dev/api/delete', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: genD.shortId, token: 'tok' }),
  }), env);
  assert.equal((await delResp.json()).ok, true);
  const keysAfter = [...store.keys()].filter((k) => k.includes(genD.shortId) || k === `dedup:${recD.dedupHash}`);
  assert.equal(keysAfter.length, 0, 'delete leaves no trace of the entry, inputs included');
  const e5 = await worker.fetch(new Request(`https://x.pages.dev/api/entry?id=${genD.shortId}&token=tok`), env);
  assert.equal(e5.status, 404, 'deleted entry reads 404');
  console.log('backfill suite: exact, reconstruction, round-trips, null case, delete cleanup passed');
}

// --- Preview suite: ALL generated nodes are previewed, not just 20 ---
{
  const eps = Array.from({ length: 15 }, (_, i) => `10.0.0.${i + 1}`).join('\n');
  const vmessLink = 'vmess://ewogICJ2IjogIjIiLAogICJwcyI6ICJkZW1vIiwKICAiYWRkIjogImVkZ2UuZXhhbXBsZS5jb20iLAogICJwb3J0IjogIjQ0MyIsCiAgImlkIjogIjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSIsCiAgInNjeSI6ICJhdXRvIiwKICAibmV0IjogIndzIiwKICAidGxzIjogInRscyIsCiAgInBhdGgiOiAiL3dzIiwKICAiaG9zdCI6ICJlZGdlLmV4YW1wbGUuY29tIiwKICAic25pIjogImVkZ2UuZXhhbXBsZS5jb20iCn0=';
  const big = await generate({ nodeLinks: `${node}\n${vmessLink}`, preferredIps: eps });
  assert.equal(big.counts.outputNodes, 30, 'fixture really generates 30 nodes');
  assert.equal(big.preview.length, 30, 'preview lists every generated node');
  assert.equal(big.preview[29].name.endsWith('| 30'), true, 'last preview row is the 30th node');
  console.log('preview suite: all 30 nodes previewed, no 20-cap');
}

// --- Link token suite: sharing a subscription must not leak admin access ---
{
  const linkTokA = linkTokens.get(j1.shortId);
  assert.match(linkTokA, /^[0-9a-f]{32}$/, 'link token is a 32-hex HMAC prefix');
  assert.notEqual(linkTokA, 'tok');
  assert.ok(!j1.urls.auto.includes('token=tok'), 'generated urls never carry the admin token');
  assert.equal(new URL(j1.urls.auto).searchParams.get('token'), linkTokA);

  // The admin token itself no longer opens a subscription; neither does a
  // missing token, nor ANOTHER entry's link token.
  assert.equal((await getSub(j1.shortId, 'raw', 'tok')).status, 403, 'admin token must not open /sub');
  assert.equal((await getSub(j1.shortId, 'raw', '')).status, 403, 'missing link token 403');
  const jB = await generate({ nodeLinks: node, preferredIps: '198.51.100.23', namePrefix: 'B' });
  const linkTokB = linkTokens.get(jB.shortId);
  assert.ok(linkTokB && linkTokB !== linkTokA, 'each entry gets its own link token');
  assert.equal((await getSub(jB.shortId, 'raw', linkTokA)).status, 403, "entry A's link token must not open entry B");
  assert.equal((await getSub(jB.shortId, 'raw')).status, 200, 'entry B opens with its own link token');

  // A link token is worthless at the admin endpoints.
  const listByLink = await worker.fetch(new Request(`https://x.pages.dev/api/list?token=${linkTokA}`), env);
  assert.equal(listByLink.status, 403, 'link token must not list entries');
  const noteByLink = await worker.fetch(new Request('https://x.pages.dev/api/note', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: j1.shortId, note: 'pwned', token: linkTokA }),
  }), env);
  assert.equal(noteByLink.status, 403, 'link token must not modify entries');

  // The admin-authenticated reads hand the frontend each entry's link
  // token, matching the token in the generated urls.
  const lr = await (await worker.fetch(new Request('https://x.pages.dev/api/list?token=tok'), env)).json();
  const itemA = lr.items.find((i) => i.id === j1.shortId);
  assert.equal(itemA.linkToken, linkTokA, 'list item carries the same link token');
  const er = await (await worker.fetch(new Request(`https://x.pages.dev/api/entry?id=${j1.shortId}&token=tok`), env)).json();
  assert.equal(er.linkToken, linkTokA, 'entry read carries the same link token');

  // Surge output embeds the per-entry link token, never the admin token.
  const surge = await getSub(j1.shortId, 'surge');
  assert.equal(surge.status, 200);
  assert.ok(surge.body.includes(`?token=${linkTokA}`), 'surge profile carries the link token');
  assert.ok(!surge.body.includes('token=tok'), 'surge profile must not contain the admin token');
  console.log('link token suite: per-entry tokens, admin token rejected at /sub, link token rejected at admin: passed');
}

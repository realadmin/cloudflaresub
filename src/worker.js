// Cloudflare Pages (_worker.js, advanced mode): KV short link subscription + access token protection
// Also usable as a plain Worker entry (src/worker.js is kept in sync).
// Requires:
// - KV namespace binding: SUB_STORE
// - Secret/Variable: SUB_ACCESS_TOKEN
// Optional:
// Subscription links carry a per-entry HMAC link token derived from
// SUB_ACCESS_TOKEN (see linkTokenFor): the admin secret itself never
// appears in any link, so sharing a subscription cannot leak admin access.

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}

function text(body, status = 200, contentType = 'text/plain; charset=utf-8') {
  return new Response(body, {
    status,
    headers: {
      'content-type': contentType,
      'access-control-allow-origin': '*',
    },
  });
}

function b64EncodeUtf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function b64DecodeUtf8(str) {
  return decodeURIComponent(escape(atob(str)));
}

function escapeYaml(str = '') {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ');
}

function splitHostAndPort(value) {
  const v = String(value || '').trim();
  if (!v) return { server: '', port: undefined };

  // Bracketed IPv6: [2606:4700::1] or [2606:4700::1]:443
  if (v.startsWith('[')) {
    const m = v.match(/^\[([^\]]+)](?::(\d+))?$/);
    if (m) return { server: m[1], port: m[2] ? Number(m[2]) : undefined };
    return { server: v, port: undefined };
  }

  // More than one colon and no brackets: a bare IPv6 address.
  // Never split a "port" off it: 2606:4700:4700::1111 is one address,
  // the old regex turned it into server "2606:4700:4700:" + port 1111.
  const colonCount = (v.match(/:/g) || []).length;
  if (colonCount > 1) return { server: v, port: undefined };

  if (colonCount === 1) {
    const idx = v.indexOf(':');
    const host = v.slice(0, idx);
    const portStr = v.slice(idx + 1);
    if (/^\d+$/.test(portStr)) return { server: host, port: Number(portStr) };
  }
  return { server: v, port: undefined };
}

function stripBrackets(host) {
  const h = String(host || '').trim();
  return h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
}

// IPv6 literals must be bracketed inside a URL authority (vless://u@[::1]:443)
function formatHostForUrl(host) {
  const h = String(host || '');
  return h.includes(':') && !h.startsWith('[') ? `[${h}]` : h;
}

function parsePreferredEndpoints(input) {
  return String(input || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const hashIdx = line.indexOf('#');
      const value = (hashIdx >= 0 ? line.slice(0, hashIdx) : line).trim();
      const remark = (hashIdx >= 0 ? line.slice(hashIdx + 1) : '').trim();
      const { server, port } = splitHostAndPort(value);
      return { server, port, remark };
    });
}

function parseVmess(link) {
  const raw = link.slice('vmess://'.length).trim();
  const obj = JSON.parse(b64DecodeUtf8(raw));
  return {
    type: 'vmess',
    name: obj.ps || 'vmess',
    server: stripBrackets(obj.add),
    port: Number(obj.port || 443),
    uuid: obj.id,
    cipher: obj.scy || 'auto',
    network: obj.net || 'ws',
    tls: obj.tls === 'tls',
    host: obj.host || '',
    path: obj.path || '/',
    sni: obj.sni || obj.host || '',
    alpn: obj.alpn || '',
    fp: obj.fp || '',
  };
}

function parseUrlLike(link, type) {
  const u = new URL(link);
  return {
    type,
    name: decodeURIComponent(u.hash.replace(/^#/, '')) || type,
    params: Object.fromEntries(u.searchParams),
    server: stripBrackets(u.hostname),
    port: Number(u.port || 443),
    password: type === 'trojan' ? decodeURIComponent(u.username) : undefined,
    uuid: type === 'vless' ? decodeURIComponent(u.username) : undefined,
    network: u.searchParams.get('type') || 'tcp',
    tls: (u.searchParams.get('security') || '').toLowerCase() === 'tls',
    host: u.searchParams.get('host') || u.searchParams.get('sni') || '',
    path: u.searchParams.get('path') || '/',
    sni: u.searchParams.get('sni') || u.searchParams.get('host') || '',
    fp: u.searchParams.get('fp') || '',
    alpn: u.searchParams.get('alpn') || '',
    flow: u.searchParams.get('flow') || '',
  };
}

function parseRawLinks(input) {
  const lines = String(input || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const result = [];
  for (const line of lines) {
    if (line.startsWith('vmess://')) {
      result.push(parseVmess(line));
      continue;
    }
    if (line.startsWith('vless://')) {
      result.push(parseUrlLike(line, 'vless'));
      continue;
    }
    if (line.startsWith('trojan://')) {
      result.push(parseUrlLike(line, 'trojan'));
      continue;
    }
    try {
      const decoded = b64DecodeUtf8(line);
      if (/^(vmess|vless|trojan):\/\//m.test(decoded)) {
        result.push(...parseRawLinks(decoded));
      }
    } catch {}
  }
  return result;
}

function buildNodes(baseNodes, preferredEndpoints, options = {}) {
  const output = [];
  const prefix = (options.namePrefix || '').trim();
  let counter = 0;
  for (const node of baseNodes) {
    for (const ep of preferredEndpoints) {
      counter += 1;
      const nameParts = [];
      if (node.name) nameParts.push(node.name);
      if (prefix) nameParts.push(prefix);
      if (ep.remark) nameParts.push(ep.remark);
      else nameParts.push(String(counter));
      output.push({
        ...node,
        name: nameParts.join(' | '),
        server: ep.server,
        port: ep.port || node.port,
        host: options.keepOriginalHost ? node.host : '',
        sni: options.keepOriginalHost ? node.sni : '',
      });
    }
  }
  return output;
}

function encodeVmess(node) {
  const obj = {
    v: '2',
    ps: node.name,
    add: node.server,
    port: String(node.port),
    id: node.uuid,
    aid: '0',
    scy: node.cipher || 'auto',
    net: node.network || 'ws',
    type: 'none',
    host: node.host || '',
    path: node.path || '/',
    tls: node.tls ? 'tls' : '',
    sni: node.sni || '',
    alpn: node.alpn || '',
    fp: node.fp || '',
  };
  return 'vmess://' + b64EncodeUtf8(JSON.stringify(obj));
}

function encodeVless(node) {
  // Start from the node's original query params so fields the parser does not
  // model (e.g. encryption=none) and the original ordering survive a round trip.
  const params = new URLSearchParams(node.params || {});
  params.set('type', node.network || 'ws');
  if (node.tls) params.set('security', 'tls');
  else if ((params.get('security') || '').toLowerCase() === 'tls') params.delete('security');
  if (node.host) params.set('host', node.host); else params.delete('host');
  if (node.sni) params.set('sni', node.sni); else params.delete('sni');
  if (node.path) params.set('path', node.path);
  if (node.alpn) params.set('alpn', node.alpn);
  if (node.fp) params.set('fp', node.fp);
  if (node.flow) params.set('flow', node.flow); else params.delete('flow');
  const qs = params.toString();
  return `vless://${encodeURIComponent(node.uuid)}@${formatHostForUrl(node.server)}:${node.port}${qs ? '?' + qs : ''}#${encodeURIComponent(node.name || '')}`;
}

function encodeTrojan(node) {
  const params = new URLSearchParams(node.params || {});
  params.set('type', node.network || 'ws');
  if (node.tls) params.set('security', 'tls');
  if (node.host) params.set('host', node.host); else params.delete('host');
  if (node.sni) params.set('sni', node.sni); else params.delete('sni');
  if (node.path) params.set('path', node.path);
  if (node.alpn) params.set('alpn', node.alpn);
  if (node.fp) params.set('fp', node.fp);
  const qs = params.toString();
  return `trojan://${encodeURIComponent(node.password)}@${formatHostForUrl(node.server)}:${node.port}${qs ? '?' + qs : ''}#${encodeURIComponent(node.name || '')}`;
}

function encodeNodeLink(node) {
  if (node.type === 'vmess') return encodeVmess(node);
  if (node.type === 'vless') return encodeVless(node);
  if (node.type === 'trojan') return encodeTrojan(node);
  return '';
}

function renderPlain(nodes) {
  // Plain-text node links, one per line, NOT base64-encoded.
  return nodes.map(encodeNodeLink).filter(Boolean).join('\n');
}

function renderRaw(nodes) {
  return b64EncodeUtf8(renderPlain(nodes));
}

function renderClash(nodes) {
  const proxies = nodes
    .map((node) => {
      if (node.type === 'vmess') {
        const lines = [
          `  - name: "${escapeYaml(node.name)}"`,
          `    type: vmess`,
          `    server: ${node.server.includes(':') ? '"' + escapeYaml(node.server) + '"' : node.server}`,
          `    port: ${node.port}`,
          `    uuid: ${node.uuid}`,
          `    alterId: 0`,
          `    cipher: ${node.cipher || 'auto'}`,
          `    udp: true`,
          `    tls: ${node.tls ? 'true' : 'false'}`,
          `    network: ${node.network || 'ws'}`,
        ];

        if (node.sni) {
          lines.push(`    servername: "${escapeYaml(node.sni)}"`);
        }

        if ((node.network || 'ws') === 'ws') {
          lines.push(
            `    ws-opts:`,
            `      path: "${escapeYaml(node.path || '/')}"`,
            `      headers:`,
            `        Host: "${escapeYaml(node.host || node.sni || '')}"`
          );
        }

        return lines.join('\n');
      }

      if (node.type === 'vless') {
        const lines = [
          `  - name: "${escapeYaml(node.name)}"`,
          `    type: vless`,
          `    server: ${node.server.includes(':') ? '"' + escapeYaml(node.server) + '"' : node.server}`,
          `    port: ${node.port}`,
          `    uuid: ${node.uuid}`,
          `    udp: true`,
          `    tls: ${node.tls ? 'true' : 'false'}`,
          `    network: ${node.network || 'ws'}`,
        ];

        if (node.sni) {
          lines.push(`    servername: "${escapeYaml(node.sni)}"`);
        }

        if ((node.network || 'ws') === 'ws') {
          lines.push(
            `    ws-opts:`,
            `      path: "${escapeYaml(node.path || '/')}"`,
            `      headers:`,
            `        Host: "${escapeYaml(node.host || node.sni || '')}"`
          );
        }

        return lines.join('\n');
      }

      if (node.type === 'trojan') {
        const lines = [
          `  - name: "${escapeYaml(node.name)}"`,
          `    type: trojan`,
          `    server: ${node.server.includes(':') ? '"' + escapeYaml(node.server) + '"' : node.server}`,
          `    port: ${node.port}`,
          `    password: "${escapeYaml(node.password || '')}"`,
          `    udp: true`,
        ];

        if (node.sni) {
          lines.push(`    sni: "${escapeYaml(node.sni)}"`);
        }

        if (node.tls !== false) {
          lines.push(`    tls: true`);
        }

        if (node.network) {
          lines.push(`    network: ${node.network}`);
        }

        if (node.network === 'ws') {
          lines.push(
            `    ws-opts:`,
            `      path: "${escapeYaml(node.path || '/')}"`,
            `      headers:`,
            `        Host: "${escapeYaml(node.host || node.sni || '')}"`
          );
        }

        return lines.join('\n');
      }

      return '';
    })
    .filter(Boolean);

  const proxyNames = nodes.map(
    (node) => `      - "${escapeYaml(node.name)}"`
  );

  const allGroupMembers = [
    `      - "自动选择"`,
    ...proxyNames,
    `      - DIRECT`,
  ];

  const autoGroupMembers = proxyNames.length ? proxyNames : [`      - DIRECT`];

  return [
    `mixed-port: 7890`,
    `allow-lan: false`,
    `mode: rule`,
    `log-level: info`,
    `ipv6: true`,
    ``,
    `proxies:`,
    ...(proxies.length ? proxies : []),
    ``,
    `proxy-groups:`,
    `  - name: "自动选择"`,
    `    type: url-test`,
    `    url: "http://www.gstatic.com/generate_204"`,
    `    interval: 300`,
    `    tolerance: 50`,
    `    proxies:`,
    ...autoGroupMembers,
    ``,
    `  - name: "节点选择"`,
    `    type: select`,
    `    proxies:`,
    ...allGroupMembers,
    ``,
    `rules:`,
    `  - MATCH,节点选择`,
  ].join('\n');
}

function renderSurge(nodes, baseUrl, linkToken) {
  const proxies = nodes
    .filter((node) => node.type === 'vmess' || node.type === 'trojan')
    .map((node) => {
      if (node.type === 'vmess') {
        return `${node.name} = vmess, ${node.server}, ${node.port}, username=${node.uuid}, ws=true, ws-path=${node.path || '/'}, ws-headers=Host:${node.host || ''}, tls=${node.tls ? 'true' : 'false'}, sni=${node.sni || ''}`;
      }
      return `${node.name} = trojan, ${node.server}, ${node.port}, password=${node.password || ''}, sni=${node.sni || ''}`;
    });

  return [
    '[General]',
    'skip-proxy = 127.0.0.1, localhost',
    '',
    '[Proxy]',
    ...proxies,
    '',
    '[Proxy Group]',
    'Proxy = select, ' +
      nodes
        .filter((n) => n.type === 'vmess' || n.type === 'trojan')
        .map((n) => n.name)
        .join(', '),
    '',
    '[Rule]',
    'FINAL,Proxy',
    '',
    '; token-protected subscription',
    `; ${baseUrl}${linkToken ? `?token=${linkToken}` : ''}`,
  ].join('\n');
}

function createShortId(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

async function createUniqueShortId(env, tries = 8) {
  for (let i = 0; i < tries; i++) {
    const id = createShortId(10);
    const exists = await env.SUB_STORE.get(`sub:${id}`);
    if (!exists) return id;
  }
  throw new Error('无法生成唯一短链接，请稍后再试');
}

function normalizeLines(value = '') {
  return String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort()
    .join('\n');
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function buildDedupHash(body) {
  const normalized = {
    nodeLinks: normalizeLines(body.nodeLinks || ''),
    preferredIps: normalizeLines(body.preferredIps || ''),
    namePrefix: String(body.namePrefix || '').trim(),
    keepOriginalHost: body.keepOriginalHost !== false,
  };
  return sha256Hex(JSON.stringify(normalized));
}

function sanitizeNote(value) {
  // Owner-written remark identifying an entry (e.g. which VPS it belongs to).
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 80);
}

function notePointerKey(note, id) {
  return `note:${note}:${id}`;
}

function buildRecordMetadata(record) {
  const servers = (record.sources || []).map((x) => x.server).filter(Boolean);
  const st = record.storage || { mode: 'permanent' };
  return {
    note: record.note || '',
    createdAt: record.createdAt || '',
    sources: [...new Set(servers)].slice(0, 3).join(',').slice(0, 200),
    out: Array.isArray(record.nodes) ? record.nodes.length : 0,
    retention: st.mode === 'days' ? `days:${st.days}` : 'permanent',
    exp: st.mode === 'days' ? (st.expiresAt || '') : '',
  };
}

// Retention chosen by the owner at generate time:
//   { mode: 'permanent' }           -> stored forever, until manually deleted
//   { mode: 'days', days: 1..3650 } -> KV auto-deletes after that many days
function parseRetention(body) {
  const mode = String(body.storageMode || 'permanent').toLowerCase();
  if (mode !== 'days') return { storage: { mode: 'permanent' } };
  const days = Number(body.retentionDays);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    return { error: '保留天数需要是 1 到 3650 之间的整数' };
  }
  return { storage: { mode: 'days', days } };
}

// (Re)stamp a record's expiry from "now" and return the TTL to write with.
function applyRetention(record, nowMs) {
  const st = record.storage || { mode: 'permanent' };
  if (st.mode === 'days') {
    const ttl = st.days * 86400;
    record.storage = { mode: 'days', days: st.days, expiresAt: new Date(nowMs + ttl * 1000).toISOString() };
    return ttl;
  }
  record.storage = { mode: 'permanent' };
  return undefined;
}

// TTL to use when rewriting an existing record WITHOUT changing its
// retention plan (e.g. saving a note): count down to the stored expiry.
function remainingTtl(record) {
  const st = record.storage;
  if (!st || st.mode !== 'days') return undefined;
  if (st.expiresAt) {
    const left = Math.ceil((Date.parse(st.expiresAt) - Date.now()) / 1000);
    return Math.max(60, left);
  }
  return st.days ? st.days * 86400 : undefined;
}

// Records are stored permanently by default, or with an expirationTtl
// when the owner picked a retention period. Also maintains a
// human-readable `note:<remark>:<id>` pointer key so the owner can tell
// entries apart at a glance in the Cloudflare KV browser, where only
// key names are visible in the list.
async function putRecord(env, id, record, prevNote = undefined, ttlSeconds = undefined) {
  const opts = { metadata: buildRecordMetadata(record) };
  if (ttlSeconds) opts.expirationTtl = ttlSeconds;
  await env.SUB_STORE.put(`sub:${id}`, JSON.stringify(record), opts);
  if (prevNote && prevNote !== record.note) {
    await env.SUB_STORE.delete(notePointerKey(prevNote, id));
  }
  if (record.note) {
    await env.SUB_STORE.put(notePointerKey(record.note, id), id);
  }
}

async function handleGenerate(request, env, url) {
  if (!env.SUB_STORE) {
    return json({ ok: false, error: '服务端未绑定 KV：请在 Pages 项目 Settings -> Bindings 中添加 KV namespace，变量名必须为 SUB_STORE，然后重新部署' }, 500);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: '请求体不是合法 JSON' }, 400);
  }

  const baseNodes = parseRawLinks(body.nodeLinks || '');
  const preferredEndpoints = parsePreferredEndpoints(body.preferredIps || '');

  if (!baseNodes.length) return json({ ok: false, error: '没有识别到可用节点' }, 400);
  if (!preferredEndpoints.length) return json({ ok: false, error: '没有识别到可用优选地址' }, 400);

  const options = {
    namePrefix: body.namePrefix || '',
    keepOriginalHost: body.keepOriginalHost !== false,
  };

  const nodes = buildNodes(baseNodes, preferredEndpoints, options);
  // Remember where the nodes came from BEFORE expansion overwrites the
  // server with a preferred endpoint: this is how the owner tells which
  // VPS an entry belongs to.
  const sources = baseNodes.map((n) => ({
    type: n.type, name: n.name, server: n.server, port: n.port,
  }));
  // The note is metadata only: it is NOT part of the dedup hash.
  const providedNote = typeof body.note === 'string' && body.note.trim() !== ''
    ? sanitizeNote(body.note)
    : null;
  // Raw form inputs, kept so this entry can later be backfilled into the
  // generate form for editing (exact restore). Entries created before this
  // field existed are reconstructed from their stored nodes instead.
  const inputs = {
    nodeLinks: String(body.nodeLinks || '').slice(0, 100000),
    preferredIps: String(body.preferredIps || '').slice(0, 50000),
  };
  const retention = parseRetention(body);
  if (retention.error) return json({ ok: false, error: retention.error }, 400);

  const dedupHash = await buildDedupHash(body);
  const dedupKey = `dedup:${dedupHash}`;

  let id = await env.SUB_STORE.get(dedupKey);
  let record;

  if (!id) {
    id = await createUniqueShortId(env);
    record = {
      version: 2,
      createdAt: new Date().toISOString(),
      note: providedNote || '',
      storage: retention.storage,
      dedupHash,
      sources,
      options,
      inputs,
      nodes,
    };
    const ttl = applyRetention(record, Date.now());
    await putRecord(env, id, record, undefined, ttl);
    await env.SUB_STORE.put(dedupKey, id, ttl ? { expirationTtl: ttl } : {});
  } else {
    // Same content generated again: reuse the entry. Rewriting it without a
    // TTL also migrates entries created by older versions (7-day expiry)
    // to permanent storage, backfills sources, and applies a newly
    // provided note.
    const raw = await env.SUB_STORE.get(`sub:${id}`);
    if (raw) {
      record = JSON.parse(raw);
      const prevNote = record.note || '';
      if (providedNote !== null) record.note = providedNote;
      if (!record.sources) record.sources = sources;
      if (!record.dedupHash) record.dedupHash = dedupHash;
      // Same content => the inputs are the same too; backfill them onto
      // legacy records so their owner can edit them via form backfill.
      if (!record.inputs) record.inputs = inputs;
      // The retention picked this time replaces the previous plan, and the
      // countdown restarts from now.
      record.storage = retention.storage;
      record.updatedAt = new Date().toISOString();
      const ttl = applyRetention(record, Date.now());
      await putRecord(env, id, record, prevNote, ttl);
      await env.SUB_STORE.put(dedupKey, id, ttl ? { expirationTtl: ttl } : {});
    } else {
      record = {
        version: 2,
        createdAt: new Date().toISOString(),
        note: providedNote || '',
        storage: retention.storage,
        dedupHash,
        sources,
        options,
        inputs,
        nodes,
      };
      const ttl = applyRetention(record, Date.now());
      await putRecord(env, id, record, undefined, ttl);
    }
  }

  const origin = url.origin;
  const accessToken = env.SUB_ACCESS_TOKEN || '';
  const linkToken = await linkTokenFor(id, env);
  const withToken = (target) => {
    const q = new URLSearchParams();
    if (target) q.set('target', target);
    if (linkToken) q.set('token', linkToken);
    const qs = q.toString();
    return `${origin}/sub/${id}${qs ? `?${qs}` : ''}`;
  };

  return json({
    ok: true,
    storage: 'kv',
    deduplicated: true,
    shortId: id,
    urls: {
      auto: withToken(''),
      raw: withToken('raw'),
      plain: withToken('plain'),
      clash: withToken('clash'),
      surge: withToken('surge'),
    },
    note: record.note || '',
    storage: record.storage || { mode: 'permanent' },
    links: nodes.map(encodeNodeLink).filter(Boolean),
    plainText: renderPlain(nodes),
    counts: {
      inputNodes: baseNodes.length,
      preferredEndpoints: preferredEndpoints.length,
      outputNodes: nodes.length,
    },
    preview: nodes.map((node) => ({
      name: node.name,
      type: node.type,
      server: node.server,
      port: node.port,
      host: node.host || '',
      sni: node.sni || '',
    })),
    warnings: accessToken ? [] : ['未检测到 SUB_ACCESS_TOKEN，订阅链接将没有第二层访问保护。'],
  });
}

function checkAdmin(request, env, url, body) {
  const expected = env.SUB_ACCESS_TOKEN;
  if (!expected) {
    return json({ ok: false, error: '未设置 SUB_ACCESS_TOKEN，出于安全原因管理接口已禁用，请先在 Pages 项目里设置该 Secret' }, 403);
  }
  const provided =
    (body && typeof body.token === 'string' && body.token) ||
    url.searchParams.get('token') ||
    request.headers.get('x-admin-token') ||
    '';
  if (provided !== expected) {
    return json({ ok: false, error: '管理令牌不正确' }, 403);
  }
  return null;
}

async function handleList(request, env, url) {
  if (!env.SUB_STORE) return json({ ok: false, error: 'SUB_STORE KV 未绑定' }, 500);
  const denied = checkAdmin(request, env, url, null);
  if (denied) return denied;

  // The key list only tells us WHICH entries exist. Every displayed field
  // (note, storage plan, ...) is read from the record itself: the list
  // index's metadata lags behind fresh writes, which first made write
  // verification report false failures, then made this list show stale
  // plans right after a verified change. One source of truth: the record.
  const items = [];
  let cursor;
  do {
    const page = await env.SUB_STORE.list({ prefix: 'sub:', cursor, limit: 256 });
    for (const key of page.keys) {
      const id = key.name.slice('sub:'.length);
      const meta = key.metadata || {};
      const item = {
        id,
        note: meta.note || '',
        createdAt: meta.createdAt || null,
        sources: meta.sources ? meta.sources.split(',').filter(Boolean) : [],
        outputNodes: typeof meta.out === 'number' ? meta.out : null,
        storage: meta.retention && meta.retention.startsWith('days:')
          ? { mode: 'days', days: Number(meta.retention.slice(5)) || null, expiresAt: meta.exp || null }
          : { mode: 'permanent' },
      };
      const raw = await env.SUB_STORE.get(key.name);
      if (raw === null || raw === undefined) {
        // Ghost key: the list index still enumerates a just-deleted entry.
        // The record is gone, so the entry must not reappear in the list.
        continue;
      }
      {
        try {
          const rec = JSON.parse(raw);
          item.note = rec.note || '';
          item.createdAt = rec.createdAt || item.createdAt;
          const servers = [...new Set((rec.sources || []).map((x) => x.server).filter(Boolean))];
          if (servers.length) item.sources = servers;
          if (Array.isArray(rec.nodes)) item.outputNodes = rec.nodes.length;
          item.storage = rec.storage || { mode: 'permanent' };
        } catch {}
      }
      item.linkToken = await linkTokenFor(id, env);
      items.push(item);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return json({ ok: true, count: items.length, items });
}

// ---- Form backfill -------------------------------------------------------
// The generate form's inputs for an existing entry, so the owner can load
// the entry back into the form and edit it. Newer records store the raw
// inputs verbatim (exact). Older records are reconstructed from their
// expanded nodes: generation laid nodes out as sources x endpoints, so
// source i's original node is its first expanded node with the preferred
// server/port/name swapped back for the source's own, and the preferred
// list is rebuilt per endpoint position.
function nameTailOf(nodeName, sourceName, prefix) {
  let rest = String(nodeName || '');
  if (sourceName && rest.startsWith(`${sourceName} | `)) rest = rest.slice(sourceName.length + 3);
  else if (sourceName && rest === sourceName) rest = '';
  if (prefix && rest.startsWith(`${prefix} | `)) rest = rest.slice(prefix.length + 3);
  else if (prefix && rest === prefix) rest = '';
  return rest;
}

function reconstructInputs(record) {
  const sources = Array.isArray(record.sources) ? record.sources : [];
  const nodes = Array.isArray(record.nodes) ? record.nodes : [];
  if (!sources.length || !nodes.length || nodes.length % sources.length !== 0) return null;
  const perSource = nodes.length / sources.length;
  if (!perSource) return null;
  const prefix = (record.options?.namePrefix || '').trim();
  const keep = record.options?.keepOriginalHost !== false;

  const endpointLines = [];
  for (let j = 0; j < perSource; j++) {
    const first = nodes[j];
    const ports = sources.map((s, i) => nodes[i * perSource + j].port);
    // If every source kept its own port at this position, the endpoint
    // itself carried no port (each node used its original port).
    const portless = ports.every((p, i) => Number(p) === Number(sources[i].port));
    // A generated name ends with either the endpoint remark or a global
    // counter. Identical tails across sources mean a remark (counters
    // differ per source); check the counter pattern explicitly.
    const tails = sources.map((s, i) => nameTailOf(nodes[i * perSource + j].name, s.name, prefix));
    let remark = '';
    if (tails[0] && tails.every((t) => t === tails[0])
        && !tails.every((t, i) => t === String(i * perSource + j + 1))) {
      remark = tails[0];
    }
    let line = formatHostForUrl(first.server);
    if (!portless) line += `:${ports[0]}`;
    if (remark) line += `#${remark}`;
    endpointLines.push(line);
  }

  const links = sources.map((s, i) => {
    const node = { ...nodes[i * perSource], server: s.server, port: s.port, name: s.name };
    if (!keep) { node.host = ''; node.sni = ''; }
    return encodeNodeLink(node);
  });
  if (links.some((l) => !l)) return null;
  return { nodeLinks: links.join('\n'), preferredIps: endpointLines.join('\n') };
}

function buildBackfill(record) {
  const base = {
    namePrefix: record.options?.namePrefix || '',
    keepOriginalHost: record.options?.keepOriginalHost !== false,
    note: record.note || '',
    storage: record.storage || { mode: 'permanent' },
  };
  if (record.inputs && typeof record.inputs.nodeLinks === 'string' && record.inputs.nodeLinks) {
    return {
      ...base,
      exact: true,
      nodeLinks: record.inputs.nodeLinks,
      preferredIps: record.inputs.preferredIps || '',
    };
  }
  const reconstructed = reconstructInputs(record);
  if (reconstructed) return { ...base, exact: false, ...reconstructed };
  return null;
}

// Direct single-record read for write verification. Deliberately NOT built
// on KV list(): the list index lags behind fresh writes, which made the
// UI's read-back check report false failures. A point get() reflects the
// write promptly.
async function handleEntry(request, env, url) {
  if (!env.SUB_STORE) return json({ ok: false, error: 'SUB_STORE KV 未绑定' }, 500);
  const denied = checkAdmin(request, env, url, null);
  if (denied) return denied;
  const id = String(url.searchParams.get('id') || '').trim();
  if (!id) return json({ ok: false, error: '缺少条目 id' }, 400);
  const raw = await env.SUB_STORE.get(`sub:${id}`);
  if (!raw) return json({ ok: false, error: '条目不存在' }, 404);
  let record;
  try { record = JSON.parse(raw); } catch { return json({ ok: false, error: '条目数据损坏' }, 500); }
  return json({
    ok: true,
    id,
    note: record.note || '',
    createdAt: record.createdAt || null,
    storage: record.storage || { mode: 'permanent' },
    linkToken: await linkTokenFor(id, env),
    backfill: buildBackfill(record),
  });
}

async function handleNote(request, env) {
  if (!env.SUB_STORE) return json({ ok: false, error: 'SUB_STORE KV 未绑定' }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: '请求体不是合法 JSON' }, 400); }
  const denied = checkAdmin(request, env, new URL(request.url), body);
  if (denied) return denied;

  const id = String(body.id || '').trim();
  if (!id) return json({ ok: false, error: '缺少条目 id' }, 400);
  const raw = await env.SUB_STORE.get(`sub:${id}`);
  if (!raw) return json({ ok: false, error: '条目不存在' }, 404);

  const record = JSON.parse(raw);
  const prevNote = record.note || '';
  record.note = sanitizeNote(body.note);
  record.updatedAt = new Date().toISOString();
  // Rewrite with whatever time the entry has left, so saving a note never
  // silently extends or shortens a timed entry. Legacy entries (written by
  // the old 7-day code, no storage plan) have no plan and become permanent.
  await putRecord(env, id, record, prevNote, remainingTtl(record));
  return json({ ok: true, id, note: record.note });
}

async function handleRetention(request, env) {
  if (!env.SUB_STORE) return json({ ok: false, error: 'SUB_STORE KV 未绑定' }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: '请求体不是合法 JSON' }, 400); }
  const denied = checkAdmin(request, env, new URL(request.url), body);
  if (denied) return denied;

  const id = String(body.id || '').trim();
  if (!id) return json({ ok: false, error: '缺少条目 id' }, 400);
  const raw = await env.SUB_STORE.get(`sub:${id}`);
  if (!raw) return json({ ok: false, error: '条目不存在' }, 404);

  const retention = parseRetention({ storageMode: body.mode, retentionDays: body.days });
  if (retention.error) return json({ ok: false, error: retention.error }, 400);

  const record = JSON.parse(raw);
  record.storage = retention.storage;
  record.updatedAt = new Date().toISOString();
  // Re-apply from NOW: switching to permanent clears the TTL, switching to
  // days restarts the countdown (same rule as regenerating the entry).
  const ttl = applyRetention(record, Date.now());
  await putRecord(env, id, record, record.note || '', ttl);
  if (record.dedupHash) {
    await env.SUB_STORE.put(`dedup:${record.dedupHash}`, id, ttl ? { expirationTtl: ttl } : {});
  }
  return json({ ok: true, id, storage: record.storage });
}

async function handleDelete(request, env) {
  if (!env.SUB_STORE) return json({ ok: false, error: 'SUB_STORE KV 未绑定' }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: '请求体不是合法 JSON' }, 400); }
  const denied = checkAdmin(request, env, new URL(request.url), body);
  if (denied) return denied;

  const id = String(body.id || '').trim();
  if (!id) return json({ ok: false, error: '缺少条目 id' }, 400);
  const raw = await env.SUB_STORE.get(`sub:${id}`);
  let record = null;
  if (raw) { try { record = JSON.parse(raw); } catch {} }

  await env.SUB_STORE.delete(`sub:${id}`);
  if (record && record.note) await env.SUB_STORE.delete(notePointerKey(record.note, id));
  if (record && record.dedupHash) await env.SUB_STORE.delete(`dedup:${record.dedupHash}`);
  return json({ ok: true, id, existed: Boolean(raw) });
}

// ---- Per-entry subscription link tokens -----------------------------------
// A subscription link is meant to be shared, so it must never carry the
// admin secret. Instead the token in a /sub URL is an HMAC of the entry id
// keyed by SUB_ACCESS_TOKEN: it opens exactly that one subscription, is
// rejected by every admin endpoint, and cannot open other entries.
// Rotating SUB_ACCESS_TOKEN invalidates every outstanding link token, so
// previously shared links stop working until they are re-shared.
let hmacKeyCache = { secret: null, promise: null };
function linkTokenFor(id, env) {
  const secret = env.SUB_ACCESS_TOKEN || '';
  if (!secret) return Promise.resolve('');
  if (hmacKeyCache.secret !== secret) {
    hmacKeyCache = {
      secret,
      promise: crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      ),
    };
  }
  return hmacKeyCache.promise
    .then((key) => crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`sub-link:${id}`)))
    .then((sig) =>
      [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32),
    );
}

async function validateLinkToken(url, env, id) {
  if (!env.SUB_ACCESS_TOKEN) return { ok: true };
  const provided = url.searchParams.get('token') || '';
  const expected = await linkTokenFor(id, env);
  if (!provided || provided !== expected) {
    return { ok: false, response: text('Forbidden: invalid token', 403) };
  }
  return { ok: true };
}

async function handleSub(url, env) {
  if (!env.SUB_STORE) {
    return text('Server error: SUB_STORE KV binding is missing. Add it in Pages Settings -> Bindings, then redeploy.', 500);
  }
  const id = url.pathname.split('/').pop();
  if (!id) return text('missing id', 400);

  const tokenCheck = await validateLinkToken(url, env, id);
  if (!tokenCheck.ok) return tokenCheck.response;

  const raw = await env.SUB_STORE.get(`sub:${id}`);
  if (!raw) return text('not found', 404);

  const record = JSON.parse(raw);
  const nodes = record.nodes || [];
  const target = (url.searchParams.get('target') || 'raw').toLowerCase();

  if (target === 'plain' || target === 'links' || target === 'text') {
    return text(renderPlain(nodes), 200, 'text/plain; charset=utf-8');
  }
  if (target === 'clash') {
    return text(renderClash(nodes), 200, 'text/yaml; charset=utf-8');
  }
  if (target === 'surge') {
    return text(
      renderSurge(nodes, url.origin + url.pathname, await linkTokenFor(id, env)),
      200,
      'text/plain; charset=utf-8',
    );
  }
  return text(renderRaw(nodes), 200, 'text/plain; charset=utf-8');
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'GET,POST,OPTIONS',
            'access-control-allow-headers': 'content-type',
          },
        });
      }

      if (request.method === 'POST' && url.pathname === '/api/generate') {
        return await handleGenerate(request, env, url);
      }

      if (request.method === 'GET' && url.pathname === '/api/list') {
        return await handleList(request, env, url);
      }

      if (request.method === 'GET' && url.pathname === '/api/entry') {
        return await handleEntry(request, env, url);
      }

      if (request.method === 'POST' && url.pathname === '/api/note') {
        return await handleNote(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/retention') {
        return await handleRetention(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/delete') {
        return await handleDelete(request, env);
      }

      if (request.method === 'GET' && url.pathname.startsWith('/sub/')) {
        return await handleSub(url, env);
      }

      // Pages (advanced mode) always provides the ASSETS binding.
      // In a plain Worker deployment without an [assets] section this binding
      // is undefined, and calling env.ASSETS.fetch() throws -> Cloudflare 1101.
      if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
        return await env.ASSETS.fetch(request);
      }
      return text('Not found. Static assets are not available: deploy as a Cloudflare Pages project with build output directory "public" (see README).', 404);
    } catch (err) {
      // Never let an uncaught exception bubble up as a bare 1101 page.
      return json({ ok: false, error: 'Internal error: ' + (err && err.message ? err.message : String(err)) }, 500);
    }
  },
};
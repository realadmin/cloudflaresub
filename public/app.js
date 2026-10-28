const form = document.getElementById('generator-form');
const submitBtn = document.getElementById('submitBtn');
const fillDemoBtn = document.getElementById('fillDemoBtn');
const resultSection = document.getElementById('resultSection');
const warningBox = document.getElementById('warningBox');
const previewBody = document.getElementById('previewBody');

const autoUrl = document.getElementById('autoUrl');
const rawUrl = document.getElementById('rawUrl');
const clashUrl = document.getElementById('clashUrl');
const surgeUrl = document.getElementById('surgeUrl');
const plainUrl = document.getElementById('plainUrl');
const plainLinks = document.getElementById('plainLinks');
const emptyState = document.getElementById('emptyState');

const qrModal = document.getElementById('qrModal');
const qrCanvas = document.getElementById('qrCanvas');
const qrText = document.getElementById('qrText');
const closeQrModal = document.getElementById('closeQrModal');

const demoVmess = [
  'vmess://ewogICJ2IjogIjIiLAogICJwcyI6ICJkZW1vLXdzLXRscyIsCiAgImFkZCI6ICJlZGdlLmV4YW1wbGUuY29tIiwKICAicG9ydCI6ICI0NDMiLAogICJpZCI6ICIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLAogICJzY3kiOiAiYXV0byIsCiAgIm5ldCI6ICJ3cyIsCiAgInRscyI6ICJ0bHMiLAogICJwYXRoIjogIi93cyIsCiAgImhvc3QiOiAiZWRnZS5leGFtcGxlLmNvbSIsCiAgInNuaSI6ICJlZGdlLmV4YW1wbGUuY29tIiwKICAiZnAiOiAiY2hyb21lIiwKICAiYWxwbiI6ICJoMixodHRwLzEuMSIKfQ=='
].join('\n');

const demoIps = [
  '104.16.1.2#HK-01',
  '104.17.2.3#HK-02',
  '104.18.3.4:2053#US-Edge'
].join('\n');

const storageModeSelect = document.getElementById('storageMode');
const retentionDaysInput = document.getElementById('retentionDays');
if (storageModeSelect && retentionDaysInput) {
  storageModeSelect.addEventListener('change', () => {
    retentionDaysInput.disabled = storageModeSelect.value !== 'days';
  });
}

fillDemoBtn.addEventListener('click', () => {
  document.getElementById('nodeLinks').value = demoVmess;
  document.getElementById('preferredIps').value = demoIps;
  document.getElementById('namePrefix').value = 'CF';
  document.getElementById('keepOriginalHost').checked = true;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  warningBox.classList.add('hidden');
  previewBody.innerHTML = '';

  const payload = {
    nodeLinks: document.getElementById('nodeLinks').value,
    preferredIps: document.getElementById('preferredIps').value,
    namePrefix: document.getElementById('namePrefix').value,
    keepOriginalHost: document.getElementById('keepOriginalHost').checked,
    // Generating writes to KV, so it carries the same admin token the
    // owner keeps in the admin section's token box below.
    token: adminToken(),
    note: document.getElementById('subNote')?.value || '',
    storageMode: document.getElementById('storageMode')?.value || 'permanent',
    retentionDays: Number(document.getElementById('retentionDays')?.value || 30),
  };

  submitBtn.disabled = true;
  submitBtn.textContent = '生成中...';

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || '生成失败');
    }

    autoUrl.value = data.urls.auto;
    rawUrl.value = data.urls.raw;
    document.getElementById('rocketUrl').value = data.urls.raw;
    clashUrl.value = data.urls.clash;
    surgeUrl.value = data.urls.surge;
    if (plainUrl) plainUrl.value = data.urls.plain || '';
    if (plainLinks) {
      plainLinks.value = data.plainText || (Array.isArray(data.links) ? data.links.join('\n') : '');
    }

    emptyState.classList.add('hidden');

    document.getElementById('statInputNodes').textContent = data.counts.inputNodes;
    document.getElementById('statEndpoints').textContent = data.counts.preferredEndpoints;
    document.getElementById('statOutputNodes').textContent = data.counts.outputNodes;

    previewBody.innerHTML = data.preview
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(item.name)}</td>
            <td>${escapeHtml(item.type)}</td>
            <td>${escapeHtml(item.server)}</td>
            <td>${escapeHtml(String(item.port))}</td>
            <td>${escapeHtml(item.host || '-')}</td>
            <td>${escapeHtml(item.sni || '-')}</td>
          </tr>`,
      )
      .join('');

    if (Array.isArray(data.warnings) && data.warnings.length) {
      warningBox.textContent = data.warnings.join('\n');
      warningBox.classList.remove('hidden');
    }

    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    warningBox.textContent = error.message || '请求失败';
    warningBox.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '生成订阅';
  }
});

document.addEventListener('click', async (event) => {
  const copyButton = event.target.closest('[data-copy-target]');
  if (copyButton) {
    const input = document.getElementById(copyButton.dataset.copyTarget);
    if (!input?.value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(input.value);
      const originalText = copyButton.textContent;
      copyButton.textContent = '已复制';
      setTimeout(() => {
        copyButton.textContent = originalText;
      }, 1200);
    } catch {
      input.select();
      document.execCommand('copy');
    }
    return;
  }

  const qrButton = event.target.closest('[data-qrcode-target]');
  if (qrButton) {
    warningBox.classList.add('hidden');

    const input = document.getElementById(qrButton.dataset.qrcodeTarget);
    if (!input?.value) {
      warningBox.textContent = '请先生成订阅链接，再显示二维码。';
      warningBox.classList.remove('hidden');
      return;
    }

    if (!window.QRCode) {
      warningBox.textContent = '二维码组件加载失败，请刷新页面后重试。';
      warningBox.classList.remove('hidden');
      return;
    }

    qrCanvas.innerHTML = '';
    qrText.textContent = input.value;
    qrModal.classList.remove('hidden');
    qrModal.setAttribute('aria-hidden', 'false');

    new window.QRCode(qrCanvas, {
      text: input.value,
      width: 220,
      height: 220,
      correctLevel: window.QRCode.CorrectLevel.M,
    });
    return;
  }

  if (event.target.closest('[data-close-modal="true"]')) {
    closeQrDialog();
  }
});

closeQrModal.addEventListener('click', closeQrDialog);

function closeQrDialog() {
  qrModal.classList.add('hidden');
  qrModal.setAttribute('aria-hidden', 'true');
  qrCanvas.innerHTML = '';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// ---------------- KV entry admin ----------------
const adminTokenInput = document.getElementById('adminToken');
const adminMsg = document.getElementById('adminMsg');
const adminBody = document.getElementById('adminBody');
const listBtn = document.getElementById('listBtn');
const sortSelect = document.getElementById('sortSelect');
const adminSearchInput = document.getElementById('adminSearch');
const expandAllBtn = document.getElementById('expandAllBtn');
const collapseAllBtn = document.getElementById('collapseAllBtn');
const selectAllCheckbox = document.getElementById('selectAllEntries');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
const adminItems = new Map();
const adminState = { items: [], sort: 'created-desc', query: '', selected: new Set() };

if (adminTokenInput && sessionStorage.getItem('cfsub_admin_token')) {
  adminTokenInput.value = sessionStorage.getItem('cfsub_admin_token');
}

function adminToken() {
  return (adminTokenInput?.value || '').trim();
}

function subUrlFor(id, target, token) {
  // `token` here is the entry's per-entry link token (item.linkToken),
  // never the admin token: these URLs are meant to be copied and shared.
  const base = `${location.origin}/sub/${id}`;
  const q = new URLSearchParams();
  if (target) q.set('target', target);
  if (token) q.set('token', token);
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

function nameKeyOf(item) {
  return (item.note && item.note.trim()) || (item.sources || [])[0] || item.id;
}
function createdMs(item) {
  const ms = Date.parse(item.createdAt || '');
  return Number.isNaN(ms) ? 0 : ms;
}
function expiryMs(item) {
  const st = item.storage || { mode: 'permanent' };
  if (st.mode === 'days' && st.expiresAt) {
    const ms = Date.parse(st.expiresAt);
    return Number.isNaN(ms) ? Infinity : ms;
  }
  return Infinity; // permanent entries never expire: they sort as "longest remaining"
}
function cmpNum(a, b) {
  return a === b ? 0 : a < b ? -1 : 1;
}
function sortedAdminItems() {
  const items = [...adminState.items];
  const byCreatedDesc = (a, b) => createdMs(b) - createdMs(a);
  switch (adminState.sort) {
    case 'created-asc':
      items.sort((a, b) => createdMs(a) - createdMs(b) || byCreatedDesc(a, b));
      break;
    case 'name-asc':
      items.sort((a, b) => nameKeyOf(a).localeCompare(nameKeyOf(b), 'zh-Hans-CN') || byCreatedDesc(a, b));
      break;
    case 'name-desc':
      items.sort((a, b) => nameKeyOf(b).localeCompare(nameKeyOf(a), 'zh-Hans-CN') || byCreatedDesc(a, b));
      break;
    case 'remaining-asc':
      items.sort((a, b) => cmpNum(expiryMs(a), expiryMs(b)) || byCreatedDesc(a, b));
      break;
    case 'remaining-desc':
      items.sort((a, b) => cmpNum(expiryMs(b), expiryMs(a)) || byCreatedDesc(a, b));
      break;
    default:
      items.sort(byCreatedDesc);
  }
  return items;
}

function itemMatchesQuery(item, needle) {
  if (!needle) return true;
  if ((item.note || '').toLowerCase().includes(needle)) return true;
  return (item.sources || []).some((s) => String(s).toLowerCase().includes(needle));
}

function visibleAdminItems() {
  const needle = (adminState.query || '').trim().toLowerCase();
  return sortedAdminItems().filter((item) => itemMatchesQuery(item, needle));
}

function updateAdminCount() {
  const total = adminState.items.length;
  if (!(adminState.query || '').trim()) {
    adminMsg.textContent = `共 ${total} 条。`;
    return;
  }
  adminMsg.textContent = `共 ${total} 条，搜索到 ${visibleAdminItems().length} 条。`;
}

// Selection covers the currently visible entries only (scheme 1): the
// header checkbox is tri-state over the visible set, and the bulk-delete
// button counts selected-and-visible entries.
function updateSelectionUI() {
  const visible = visibleAdminItems();
  const selectedVisible = visible.filter((i) => adminState.selected.has(i.id)).length;
  if (selectAllCheckbox) {
    selectAllCheckbox.checked = visible.length > 0 && selectedVisible === visible.length;
    selectAllCheckbox.indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
    selectAllCheckbox.disabled = visible.length === 0;
  }
  if (deleteSelectedBtn) {
    deleteSelectedBtn.disabled = selectedVisible === 0;
    deleteSelectedBtn.textContent = selectedVisible ? `删除所选（${selectedVisible}）` : '删除所选';
  }
}

function retentionHtml(item) {
  const st = item.storage || { mode: 'permanent' };
  return st.mode === 'days'
    ? `${st.days ?? '?'} 天后删除<br><span class="hint">${st.expiresAt ? '到期：' + new Date(st.expiresAt).toLocaleString('zh-CN', { hour12: false }) : ''}</span>`
    : '永久';
}

function renderAdminList() {
  adminItems.clear();
  adminState.items.forEach((item) => adminItems.set(item.id, item));
  for (const id of [...adminState.selected]) {
    if (!adminItems.has(id)) adminState.selected.delete(id);
  }
  if (!adminState.items.length) {
    adminBody.innerHTML = '<div class="admin-empty">KV 里还没有任何条目。</div>';
    updateSelectionUI();
    return;
  }
  const visible = visibleAdminItems();
  if (!visible.length) {
    adminBody.innerHTML = '<div class="admin-empty">没有符合搜索条件的条目。</div>';
    updateSelectionUI();
    return;
  }
  adminBody.innerHTML = visible
    .map((item) => {
      const created = item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false }) : '-';
      const retention = retentionHtml(item);
      return `<div class="entry" data-id="${escapeHtml(item.id)}">
        <div class="entry-row">
          <div class="cell"><input type="checkbox" class="entry-check" aria-label="选择这条" ${adminState.selected.has(item.id) ? 'checked' : ''} /></div>
          <div class="cell"><textarea class="note-input" maxlength="80" rows="4" placeholder="（未填备注）">${escapeHtml(item.note || '')}</textarea></div>
          <div class="cell">${escapeHtml(created)}</div>
          <div class="cell">${retention}</div>
          <div class="cell">${escapeHtml((item.sources || []).join(', ') || '-')}</div>
          <div class="cell">${item.outputNodes ?? '-'}</div>
          <div class="cell">
            <div class="admin-actions">
              <button type="button" class="secondary small" data-admin-action="links">链接</button>
              <button type="button" class="secondary small" data-admin-action="save">存备注</button>
              <button type="button" class="secondary small" data-admin-action="retention">修改有效期</button>
              <button type="button" class="secondary small" data-admin-action="delete">删除</button>
              <button type="button" class="secondary small span-all" data-admin-action="backfill">回填到生成区</button>
            </div>
          </div>
        </div>
      </div>`;
    })
    .join('');
  updateSelectionUI();
}

async function loadAdminList() {
  const token = adminToken();
  if (!token) {
    adminMsg.textContent = '请先填入 SUB_ACCESS_TOKEN。';
    return;
  }
  sessionStorage.setItem('cfsub_admin_token', token);
  adminMsg.textContent = '加载中...';
  try {
    // The admin token travels in a header, never in the URL.
    const resp = await fetch('/api/list', { headers: { 'x-admin-token': token } });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || '加载失败');
    adminState.items = data.items || [];
    adminState.selected.clear();
    renderAdminList();
    updateAdminCount();
  } catch (e) {
    adminMsg.textContent = e.message || '加载失败';
  }
}

if (listBtn) listBtn.addEventListener('click', loadAdminList);
if (sortSelect) {
  sortSelect.addEventListener('change', () => {
    adminState.sort = sortSelect.value;
    adminState.selected.clear();
    renderAdminList();
  });
}
if (adminSearchInput) {
  adminSearchInput.addEventListener('input', () => {
    adminState.query = adminSearchInput.value;
    adminState.selected.clear();
    renderAdminList();
    updateAdminCount();
  });
}
if (selectAllCheckbox) {
  selectAllCheckbox.addEventListener('change', () => {
    const visible = visibleAdminItems();
    if (selectAllCheckbox.checked) visible.forEach((i) => adminState.selected.add(i.id));
    else visible.forEach((i) => adminState.selected.delete(i.id));
    renderAdminList();
  });
}
if (deleteSelectedBtn) {
  deleteSelectedBtn.addEventListener('click', async () => {
    const token = adminToken();
    if (!token) return;
    const ids = visibleAdminItems().filter((i) => adminState.selected.has(i.id)).map((i) => i.id);
    if (!ids.length) return;
    if (!confirm(`确定删除选中的 ${ids.length} 条订阅吗？删除后它们的链接会立刻失效。`)) return;
    deleteSelectedBtn.disabled = true;
    let done = 0;
    const failed = [];
    for (let k = 0; k < ids.length; k++) {
      deleteSelectedBtn.textContent = `删除中 ${k + 1}/${ids.length}…`;
      const id = ids[k];
      let data = null;
      try {
        const resp = await fetch('/api/delete', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, token }),
        });
        data = await resp.json().catch(() => null);
      } catch (e) {
        data = null;
      }
      if (data && data.ok) {
        // Same rule as single delete: only a server-confirmed delete
        // removes the entry locally.
        done++;
        adminState.items = adminState.items.filter((i) => i.id !== id);
        adminItems.delete(id);
        adminState.selected.delete(id);
      } else {
        failed.push(id);
      }
    }
    renderAdminList();
    adminMsg.textContent = failed.length
      ? `已删除 ${done} 条；${failed.length} 条删除失败，已保留：${failed.join('、')}`
      : `已删除选中的 ${done} 条。共 ${adminState.items.length} 条。`;
  });
}

function detailCard(prefix, key, icon, title, desc, url, wide = false) {
  const inputId = `${prefix}-${key}`;
  return `<article class="sub-card${wide ? ' sub-card-wide' : ''}">
    <div class="sub-card-head">
      <div class="client-meta">
        <div class="client-icon"><img src="/icons/${icon}" alt="${escapeHtml(title)}" /></div>
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(desc)}</p>
        </div>
      </div>
    </div>
    <div class="sub-actions">
      <input id="${inputId}" readonly value="${escapeHtml(url)}" />
      <button data-copy-target="${inputId}" type="button" class="secondary small">复制</button>
      <button data-qrcode-target="${inputId}" type="button" class="secondary small">二维码</button>
    </div>
  </article>`;
}

function buildDetail(item) {
  const prefix = `d-${item.id}`;
  const linkToken = item.linkToken || '';
  const detail = document.createElement('div');
  detail.className = 'entry-detail';
  detail.innerHTML = `
    <div class="sub-grid">
      ${detailCard(prefix, 'auto', 'auto.svg', '自动识别', '适合支持自动识别的客户端', subUrlFor(item.id, '', linkToken))}
      ${detailCard(prefix, 'raw', 'v2rayn.svg', 'V2rayN', '适用于 V2rayN / v2rayNG', subUrlFor(item.id, 'raw', linkToken))}
      ${detailCard(prefix, 'clash', 'clash.svg', 'Clash', '适用于 Clash / Mihomo / Clash Verge', subUrlFor(item.id, 'clash', linkToken))}
      ${detailCard(prefix, 'rocket', 'shadowrocket.svg', 'Shadowrocket', '适用于 iPhone / iPad 小火箭', subUrlFor(item.id, 'raw', linkToken))}
      ${detailCard(prefix, 'plain', 'auto.svg', '明文链接', '逐行明文节点链接（非 Base64），打开即可看/复制', subUrlFor(item.id, 'plain', linkToken))}
      ${detailCard(prefix, 'surge', 'surge.svg', 'Surge', '适用于 Surge Profile 导入', subUrlFor(item.id, 'surge', linkToken), true)}
    </div>
    <h3>明文节点链接（一行一个，可整段复制）</h3>
    <textarea id="${prefix}-plainText" rows="6" readonly placeholder="正在加载明文链接..."></textarea>
    <div class="actions">
      <button data-copy-target="${prefix}-plainText" type="button" class="secondary small">复制全部明文链接</button>
    </div>`;
  return detail;
}

async function loadPlainOnce(detail, item) {
  if (detail.dataset.plainLoaded) return;
  detail.dataset.plainLoaded = '1';
  const box = detail.querySelector('textarea');
  try {
    const resp = await fetch(subUrlFor(item.id, 'plain', item.linkToken || ''));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    box.value = await resp.text();
  } catch (e) {
    box.value = '';
    box.placeholder = `明文链接加载失败：${e.message || e}`;
  }
}

async function setDetail(entry, expand) {
  const item = adminItems.get(entry?.dataset.id || '');
  if (!entry || !item) return;
  const btn = entry.querySelector('[data-admin-action="links"]');
  let detail = entry.querySelector('.entry-detail');
  if (expand) {
    if (!detail) {
      detail = buildDetail(item);
      entry.appendChild(detail);
    }
    detail.classList.remove('hidden');
    entry.classList.add('expanded');
    if (btn) btn.textContent = '收起';
    await loadPlainOnce(detail, item);
  } else {
    if (detail) detail.classList.add('hidden');
    entry.classList.remove('expanded');
    if (btn) btn.textContent = '链接';
  }
}

if (expandAllBtn) {
  expandAllBtn.addEventListener('click', async () => {
    for (const entry of adminBody.querySelectorAll('.entry')) {
      await setDetail(entry, true);
      openRetentionPanel(entry);
    }
  });
}
if (collapseAllBtn) {
  collapseAllBtn.addEventListener('click', async () => {
    for (const entry of adminBody.querySelectorAll('.entry')) {
      await setDetail(entry, false);
      closeRetentionPanel(entry);
    }
  });
}

// Read-back verification must use the direct entry read, NOT /api/list:
// KV's list index lags behind fresh writes and caused false failures.
async function pollEntry(id, token, predicate) {
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
    try {
      const q = new URLSearchParams({ id });
      const resp = await fetch(`/api/entry?${q.toString()}`, { headers: { 'x-admin-token': token } });
      if (!resp.ok) continue;
      const entry = await resp.json();
      if (entry.ok && predicate(entry)) return entry;
    } catch {}
  }
  return null;
}

// Load an entry's stored inputs back into the generate form for editing.
// Regenerating afterwards follows the usual rules: changed content makes a
// new entry, unchanged content refreshes the same entry.
function fillGenerateForm(bf) {
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value ?? '';
  };
  setValue('nodeLinks', bf.nodeLinks);
  setValue('preferredIps', bf.preferredIps);
  setValue('namePrefix', bf.namePrefix);
  const keep = document.getElementById('keepOriginalHost');
  if (keep) keep.checked = bf.keepOriginalHost !== false;
  setValue('subNote', bf.note);
  const mode = document.getElementById('storageMode');
  if (mode) {
    mode.value = bf.storage?.mode === 'days' ? 'days' : 'permanent';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (bf.storage?.mode === 'days' && bf.storage.days) setValue('retentionDays', bf.storage.days);
  if (typeof form.scrollIntoView === 'function') {
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

document.addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-admin-action]');
  if (!btn) return;
  const entry = btn.closest('.entry');
  const id = entry?.dataset.id;
  const token = adminToken();
  if (!id || !token) return;
  const action = btn.dataset.adminAction;

  if (action === 'backfill') {
    btn.disabled = true;
    try {
      const q = new URLSearchParams({ id });
      const resp = await fetch(`/api/entry?${q.toString()}`, { headers: { 'x-admin-token': token } });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.ok) throw new Error((data && data.error) || '回填失败，请重试');
      if (!data.backfill) throw new Error('这条记录缺少可还原的数据，无法回填');
      fillGenerateForm(data.backfill);
      adminMsg.textContent = data.backfill.exact
        ? `条目 ${id} 已回填到生成区，修改后点「生成订阅」即可。`
        : `条目 ${id} 已按已存数据还原并回填到生成区（老条目，可能与原始输入略有差异），修改后点「生成订阅」即可。`;
    } catch (err) {
      adminMsg.textContent = err.message || '回填失败，请重试';
    } finally {
      btn.disabled = false;
    }
    return;
  }
  if (action === 'retention') {
    toggleRetentionPanel(entry);
    return;
  }
  if (action === 'links') {
    await setDetail(entry, !entry.classList.contains('expanded'));
    return;
  }
  if (action === 'save') {
    const rawNote = entry.querySelector('.note-input')?.value || '';
    btn.disabled = true;
    btn.removeAttribute('data-save-state');
    btn.textContent = '保存中…';
    let ok = false;
    let savedNote = rawNote;
    let errMsg = '';
    try {
      const resp = await fetch('/api/note', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, note: rawNote, token }),
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        savedNote = typeof data.note === 'string' ? data.note : rawNote;
        // Verify against KV itself: read the record back directly and
        // compare notes (poll briefly; KV is eventually consistent).
        ok = !!(await pollEntry(id, token, (e) => (e.note || '') === savedNote));
      } else {
        errMsg = data.error || '保存失败';
      }
    } catch (e) {
      ok = false;
    }
    if (ok) {
      const item = adminItems.get(id);
      if (item) item.note = savedNote;
      adminMsg.textContent = `条目 ${id} 的备注已保存并在 KV 中确认。`;
    } else {
      adminMsg.textContent = errMsg || `条目 ${id} 的备注未能确认保存，请重试。`;
    }
    btn.textContent = ok ? '成功' : '失败';
    btn.dataset.saveState = ok ? 'ok' : 'fail';
    setTimeout(() => {
      btn.textContent = '存备注';
      btn.disabled = false;
      btn.removeAttribute('data-save-state');
    }, 1500);
    return;
  }
  if (action === 'delete') {
    const note = entry.querySelector('.note-input')?.value || id;
    if (!confirm(`确定删除条目「${note}」吗？删除后它的订阅链接会立刻失效。`)) return;
    let data = null;
    try {
      const resp = await fetch('/api/delete', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, token }),
      });
      data = await resp.json();
    } catch (e) {
      data = null; // network failure / non-JSON error page: treat as failure
    }
    if (data && data.ok) {
      // Remove the row locally at once: the entry is already gone from KV,
      // and waiting for a list refresh lets the lagging KV list index keep
      // showing it until the next manual reload.
      adminState.items = adminState.items.filter((i) => i.id !== id);
      adminItems.delete(id);
      renderAdminList();
      adminMsg.textContent = `条目 ${id} 已删除。共 ${adminState.items.length} 条。`;
    } else {
      // The row is only ever removed after the server confirms the delete;
      // any failure (server error or network) keeps the row and says so.
      adminMsg.textContent = (data && data.error) || '删除失败，请重试';
    }
  }
});

// ---------------- Retention edit panel (scheme 1: inline) ----------------
function buildRetentionPanel(item) {
  const st = item.storage || { mode: 'permanent' };
  const panel = document.createElement('div');
  panel.className = 'entry-retention hidden';
  const current = st.mode === 'days'
    ? `${st.days ?? '?'} 天后删除${st.expiresAt ? '（到期：' + new Date(st.expiresAt).toLocaleString('zh-CN', { hour12: false }) + '）' : ''}`
    : '永久保存';
  panel.innerHTML = `
    <div class="ret-current">当前有效期：<strong>${escapeHtml(current)}</strong></div>
    <div class="ret-controls">
      <label>改为
        <select class="ret-mode">
          <option value="permanent"${st.mode !== 'days' ? ' selected' : ''}>永久保存（手动删除为止）</option>
          <option value="days"${st.mode === 'days' ? ' selected' : ''}>自定义天数后自动删除</option>
        </select>
      </label>
      <label>天数
        <input class="ret-days" type="number" min="1" max="3650" step="1" value="${st.mode === 'days' && st.days ? st.days : 30}"${st.mode !== 'days' ? ' disabled' : ''} />
      </label>
      <button type="button" class="secondary small" data-ret-save>保存有效期</button>
      <button type="button" class="secondary small" data-ret-cancel>取消</button>
    </div>
    <p class="hint">选“自定义天数”会从保存这一刻起重新计时；选“永久保存”会去掉过期时间。</p>`;
  return panel;
}

function openRetentionPanel(entry) {
  const item = adminItems.get(entry?.dataset.id || '');
  if (!entry || !item) return;
  let panel = entry.querySelector('.entry-retention');
  if (!panel) {
    panel = buildRetentionPanel(item);
    entry.querySelector('.entry-row').after(panel);
  }
  panel.classList.remove('hidden');
  entry.classList.add('retention-open');
}

function toggleRetentionPanel(entry) {
  const panel = entry?.querySelector('.entry-retention');
  if (panel && !panel.classList.contains('hidden')) closeRetentionPanel(entry);
  else openRetentionPanel(entry);
}

function closeRetentionPanel(entry) {
  const panel = entry?.querySelector('.entry-retention');
  if (panel) panel.classList.add('hidden');
  entry?.classList.remove('retention-open');
}

document.addEventListener('change', (event) => {
  const check = event.target.closest?.('.entry-check');
  if (check) {
    const entry = check.closest('.entry');
    const id = entry?.dataset.id;
    if (id) {
      if (check.checked) adminState.selected.add(id);
      else adminState.selected.delete(id);
      updateSelectionUI();
    }
    return;
  }
  const sel = event.target.closest?.('.ret-mode');
  if (!sel) return;
  const panel = sel.closest('.entry-retention');
  const days = panel?.querySelector('.ret-days');
  if (days) days.disabled = sel.value !== 'days';
});

document.addEventListener('click', async (event) => {
  const cancelBtn = event.target.closest('[data-ret-cancel]');
  if (cancelBtn) {
    closeRetentionPanel(cancelBtn.closest('.entry'));
    return;
  }
  const saveBtn = event.target.closest('[data-ret-save]');
  if (!saveBtn) return;
  const entry = saveBtn.closest('.entry');
  const id = entry?.dataset.id;
  const token = adminToken();
  if (!entry || !id || !token) return;
  const panel = entry.querySelector('.entry-retention');
  const mode = panel.querySelector('.ret-mode')?.value || 'permanent';
  const days = Number(panel.querySelector('.ret-days')?.value);
  saveBtn.disabled = true;
  saveBtn.removeAttribute('data-save-state');
  saveBtn.textContent = '保存中…';
  let ok = false;
  let newStorage = null;
  try {
    const resp = await fetch('/api/retention', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, token, mode, days: mode === 'days' ? days : undefined }),
    });
    const data = await resp.json();
    if (resp.ok && data.ok) {
      newStorage = data.storage;
      // Verify against KV via a direct record read, same as the note save.
      const verified = await pollEntry(id, token, (e) => e.storage && e.storage.mode === mode
        && (mode !== 'days' || (e.storage.days === days && !!e.storage.expiresAt)));
      if (verified) {
        ok = true;
        newStorage = verified.storage;
      }
    } else {
      adminMsg.textContent = data.error || '修改有效期失败';
    }
  } catch (e) {
    ok = false;
  }
  saveBtn.textContent = ok ? '成功' : '失败';
  saveBtn.dataset.saveState = ok ? 'ok' : 'fail';
  if (ok) {
    adminMsg.textContent = `条目 ${id} 的有效期已更新并在 KV 中确认。`;
    const item = adminItems.get(id);
    if (item && newStorage) item.storage = newStorage;
    const cells = entry.querySelectorAll('.entry-row .cell');
    if (item && cells[3]) cells[3].innerHTML = retentionHtml(item);
  } else if (!adminMsg.textContent || adminMsg.textContent.startsWith('共 ')) {
    adminMsg.textContent = `条目 ${id} 的有效期未能确认修改，请重试。`;
  }
  setTimeout(() => {
    saveBtn.textContent = '保存有效期';
    saveBtn.disabled = false;
    saveBtn.removeAttribute('data-save-state');
    if (ok) closeRetentionPanel(entry);
  }, 1500);
});

// ---------------- Back to top ----------------
const backTopBtn = document.getElementById('backTopBtn');
if (backTopBtn) {
  const onScroll = () => {
    backTopBtn.classList.toggle('show', window.scrollY > 400);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  backTopBtn.addEventListener('click', () => {
    const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  });
}

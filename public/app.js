'use strict';
/* FLOWTRACKER — მონაცემები Cloudflare D1 ბაზაში ინახება (/api). */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const toDateInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'];
const dayOf = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : toDateInput(new Date(v));
const dayDate = v => new Date(dayOf(v) + 'T00:00');
const fmtDate = v => { const d = dayDate(v); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const money = v => (v == null || v === '') ? '' : Number(v).toFixed(2) + ' ₾';

/* ---------- API ---------- */
class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
async function api(path, { method = 'GET', body } = {}) {
  let r;
  try {
    r = await fetch('/api/' + path, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('ინტერნეტთან კავშირი ვერ მოხერხდა. შეამოწმეთ ინტერნეტი და სცადეთ თავიდან.', 0);
  }
  if (r.status === 401) { location.href = '/login'; throw new ApiError('სესია ამოიწურა. შედით თავიდან.', 401); }
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(data?.error || `შეცდომა (${r.status}). სცადეთ თავიდან.`, r.status);
  return data;
}

/* ---------- მონაცემები ---------- */
const db = { flowers: [], orders: [], writeoffs: [] };
const sameId = (a, b) => String(a) === String(b);
const flowerName = id => db.flowers.find(f => sameId(f.id, id))?.name;
async function fetchOrders() { db.orders = (await api('orders')).orders; }
async function fetchFlowers() { db.flowers = (await api('flowers')).flowers; }
async function fetchWriteOffs() { db.writeoffs = (await api('writeoffs')).writeoffs; }
// ხედის გადართვისას ახალი მონაცემები წამოვიღოთ (ფლორისტის შეყვანილი სხვა მოწყობილობიდანაც ჩანს)
let refreshing = null;
function refreshOrders(render) {
  if (!refreshing) refreshing = fetchOrders().finally(() => { refreshing = null; });
  refreshing.then(render, e => toast(e.message));
}
let refreshingWo = null;
function refreshWriteOffs(render) {
  if (!refreshingWo) refreshingWo = fetchWriteOffs().finally(() => { refreshingWo = null; });
  refreshingWo.then(render, e => toast(e.message));
}

/* ---------- პერიოდის ფილტრი (შეჯამება და ისტორიები) ---------- */
const RANGE_PRESETS = [['today', 'დღეს'], ['week', 'ბოლო 7 დღე'], ['month', 'ეს თვე'], ['custom', 'პერიოდი']];
// el-ში ააწყობს ჩიპებს და თარიღის ველებს; withAll — დამატებითი „ყველა“ (ისტორიისთვის)
function makeRange(el, { initial = 'today', withAll = false, onChange }) {
  const presets = withAll ? [['all', 'ყველა'], ...RANGE_PRESETS] : RANGE_PRESETS;
  let mode = initial;
  el.innerHTML = `
    <div class="chips" role="tablist" aria-label="პერიოდი">${presets.map(([k, t]) =>
      `<button type="button" class="chip${k === mode ? ' active' : ''}" role="tab" aria-selected="${k === mode}" data-range="${k}">${t}</button>`).join('')}</div>
    <div class="grid2 card custom-range" hidden>
      <label>საწყისი თარიღი<input class="r-from" type="date"></label>
      <label>საბოლოო თარიღი<input class="r-to" type="date"></label>
    </div>`;
  const from = $('.r-from', el), to = $('.r-to', el), custom = $('.custom-range', el);
  $$('.chip', el).forEach(c => c.addEventListener('click', () => {
    mode = c.dataset.range;
    $$('.chip', el).forEach(x => { x.classList.toggle('active', x === c); x.setAttribute('aria-selected', x === c); });
    if (mode === 'custom' && !from.value) {
      const d = new Date(); to.value = toDateInput(d); d.setDate(d.getDate() - 6); from.value = toDateInput(d);
    }
    custom.hidden = mode !== 'custom';
    onChange();
  }));
  [from, to].forEach(i => i.addEventListener('change', onChange));
  function bounds() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    if (mode === 'all') return [new Date(-8.64e15), new Date(8.64e15)];
    if (mode === 'week') start.setDate(start.getDate() - 6);
    if (mode === 'month') start.setDate(1);
    if (mode === 'custom') {
      const s = from.value ? new Date(from.value + 'T00:00') : new Date(-8.64e15);
      const e = to.value ? new Date(to.value + 'T00:00') : new Date(8.64e15); if (to.value) e.setDate(e.getDate() + 1);
      return [s, e];
    }
    return [start, end];
  }
  return {
    get mode() { return mode; },
    has(rec) { const [s, e] = bounds(); const d = dayDate(rec.date); return d >= s && d < e; },
    // CSV ფაილის სახელისთვის
    slug() {
      if (mode === 'all') return 'sruli';
      const [s, e] = bounds(); const last = new Date(e); last.setDate(last.getDate() - 1);
      const a = s.getFullYear() > 1900 ? toDateInput(s) : '', b = e.getFullYear() < 9000 ? toDateInput(last) : '';
      return a === b ? a : [a, b].filter(Boolean).join('_') || 'sruli';
    },
  };
}
const ordersRange = makeRange($('#range-orders'), { initial: 'all', withAll: true, onChange: () => renderOrders() });
const woRange = makeRange($('#range-writeoffs'), { initial: 'all', withAll: true, onChange: () => renderWriteOffs() });
const summaryRange = makeRange($('#range-summary'), { initial: 'today', onChange: () => renderSummary() });

/* ---------- ნავიგაცია ---------- */
function show(view) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  document.body.dataset.view = view;
  if (view === 'orders') { renderOrders(); refreshOrders(() => document.body.dataset.view === 'orders' && renderOrders()); }
  if (view === 'writeoff') { renderWriteOffs(); refreshWriteOffs(() => document.body.dataset.view === 'writeoff' && renderWriteOffs()); }
  if (view === 'summary') {
    renderSummary();
    const again = () => document.body.dataset.view === 'summary' && renderSummary();
    refreshOrders(again); refreshWriteOffs(again);
  }
  window.scrollTo(0, 0);
}
$$('.tab').forEach(t => t.addEventListener('click', () => show(t.dataset.view)));

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), Math.max(2200, msg.length * 60));
}

/* ---------- ფორმა ---------- */
let editingId = null;

function flowerOptions(selected) {
  const opts = db.flowers.map(f => `<option value="${f.id}"${sameId(f.id, selected) ? ' selected' : ''}>${esc(f.name)}</option>`);
  return `<option value="">ყვავილი…</option>${opts.join('')}<option value="__new">＋ ახალი ყვავილი…</option>`;
}
// box: მწკრივების კონტეინერი (#rows — შეკვეთა, #w-rows — ჩამოწერა)
const totalFor = box => box.id === 'w-rows' ? updateWoTotal : updateTotal;
function addRow(flowerId = '', qty = 1, fallbackName = '', box = $('#rows')) {
  const upd = totalFor(box);
  const row = document.createElement('div');
  row.className = 'row';
  let opts = flowerOptions(flowerId);
  // წაშლილი ყვავილი ძველ შეკვეთაში — სახელი შევინარჩუნოთ
  if (flowerId && !flowerName(flowerId)) opts = `<option value="${esc(flowerId)}" selected data-name="${esc(fallbackName)}">${esc(fallbackName)}</option>` + opts;
  row.innerHTML = `
    <select aria-label="ყვავილი">${opts}</select>
    <div class="stepper">
      <button type="button" class="dec" aria-label="შემცირება"><svg class="ic"><use href="#i-minus"/></svg></button>
      <input type="number" inputmode="numeric" min="1" value="${qty}" aria-label="რაოდენობა">
      <button type="button" class="inc" aria-label="გაზრდა"><svg class="ic"><use href="#i-plus"/></svg></button>
    </div>
    <button type="button" class="rm" aria-label="წაშლა"><svg class="ic"><use href="#i-x"/></svg></button>`;
  const sel = $('select', row), q = $('input', row);
  sel.addEventListener('change', async () => {
    if (sel.value === '__new') {
      const name = (prompt('ახალი ყვავილის სახელი:') || '').trim();
      sel.value = '';
      if (name) {
        try { const f = await addFlower(name); refreshSelects(); sel.value = String(f.id); }
        catch (e) { toast(e.message); }
      }
    }
    upd();
  });
  $('.dec', row).onclick = () => { q.value = Math.max(1, (+q.value || 1) - 1); upd(); };
  $('.inc', row).onclick = () => { q.value = (+q.value || 0) + 1; upd(); };
  q.addEventListener('input', upd);
  $('.rm', row).onclick = () => { row.remove(); if (!$$('.row', box).length) addRow('', 1, '', box); upd(); };
  box.appendChild(row);
  upd();
}
function refreshSelects() {
  $$('#rows select, #w-rows select').forEach(sel => {
    const v = sel.value, keep = sel.querySelector('option[data-name]');
    sel.innerHTML = (keep ? keep.outerHTML : '') + flowerOptions(v);
    sel.value = v;
  });
}
const rowsTotal = box => $$('.row', box).reduce((s, r) => s + ($('select', r).value ? (+$('input', r).value || 0) : 0), 0);
function updateTotal() {
  const n = rowsTotal($('#rows'));
  $('#total-line').innerHTML = n ? `სულ <b>${n}</b> ღერო` : '';
}
function updateWoTotal() {
  const n = rowsTotal($('#w-rows'));
  $('#w-total-line').innerHTML = n ? `ჩამოიწერება <b>${n}</b> ღერო` : '';
}
// მწკრივებიდან [{flowerId, qty}] — ერთნაირი ყვავილები ერთიანდება
function collectItems(box) {
  const map = new Map();
  $$('.row', box).forEach(r => {
    const id = $('select', r).value, qty = parseInt($('input', r).value, 10) || 0;
    if (!id || qty < 1) return;
    map.set(id, { flowerId: Number(id), qty: (map.get(id)?.qty || 0) + qty });
  });
  return [...map.values()];
}
function resetForm() {
  editingId = null;
  $('#order-form').reset();
  $('#form-title').textContent = 'ახალი შეკვეთა';
  $('#btn-save').textContent = 'შენახვა';
  $('#btn-cancel').hidden = true;
  $('#f-number').value = '';
  $('#f-date').value = toDateInput(new Date());
  $('#rows').innerHTML = '';
  clearErrors();
  addRow();
}
function clearErrors() {
  $('#err-number').textContent = ''; $('#err-rows').textContent = '';
  $('#f-number').classList.remove('invalid');
}
function startEdit(id) {
  const o = db.orders.find(x => sameId(x.id, id)); if (!o) return;
  window.scrollTo({ top: 0, behavior: 'smooth' }); // ფორმა იმავე გვერდზე, ზემოთაა
  editingId = id;
  clearErrors();
  $('#form-title').textContent = `შეკვეთის რედაქტირება (№${o.number})`;
  $('#btn-save').textContent = 'ცვლილებების შენახვა';
  $('#btn-cancel').hidden = false;
  $('#f-number').value = o.number;
  editingId = o.id;
  $('#f-date').value = dayOf(o.date);
  $('#f-price').value = o.price ?? '';
  $('#f-note').value = o.note || '';
  $('#rows').innerHTML = '';
  o.items.forEach(it => addRow(it.flowerId, it.qty, it.name));
  markEditing();
}
// რედაქტირებადი ბარათი ისტორიაში გამოვყოთ
function markEditing() {
  $$('#orders .order').forEach(c => c.classList.toggle('editing', sameId(c.dataset.id, editingId)));
}
function scrollToOrder(id) {
  const c = $(`#orders .order[data-id="${id}"]`);
  if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
$('#btn-cancel').onclick = () => { const id = editingId; resetForm(); markEditing(); scrollToOrder(id); };
$('#btn-add-row').onclick = () => addRow();

let saving = false;
$('#order-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (saving) return;
  clearErrors();
  let ok = true;
  const number = parseInt($('#f-number').value, 10);
  if (!number || number < 1) {
    $('#err-number').textContent = 'მიუთითეთ შეკვეთის ნომერი.'; ok = false;
  } else if (db.orders.some(o => o.number === number && !sameId(o.id, editingId))) {
    $('#err-number').textContent = `№${number} უკვე არსებობს. ჩაწერეთ სხვა ნომერი.`; ok = false;
  }
  if (!ok) $('#f-number').classList.add('invalid');

  // ერთნაირი ყვავილის მწკრივები გავაერთიანოთ
  const items = collectItems($('#rows'));
  if (!items.length) { $('#err-rows').textContent = 'დაამატეთ ერთი ყვავილი მაინც.'; ok = false; }
  if (!ok) { $('.err:not(:empty)')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }

  const priceRaw = $('#f-price').value;
  const data = {
    number,
    date: $('#f-date').value || toDateInput(new Date()),
    price: priceRaw === '' ? null : Math.round(parseFloat(priceRaw) * 100) / 100,
    note: $('#f-note').value.trim(),
    items,
  };
  const btn = $('#btn-save'), label = btn.textContent, wasEdit = editingId != null;
  saving = true; btn.disabled = true; btn.textContent = 'ინახება…';
  try {
    if (wasEdit) {
      const { order } = await api(`orders/${editingId}`, { method: 'PUT', body: data });
      db.orders = db.orders.map(o => sameId(o.id, order.id) ? order : o);
      toast(`შეკვეთა №${number} განახლდა.`);
    } else {
      const { order } = await api('orders', { method: 'POST', body: data });
      db.orders.push(order);
      toast(`შეკვეთა №${number} შენახულია.`);
    }
  } catch (err) {
    saving = false; btn.disabled = false; btn.textContent = label;
    if (err.status === 409) {
      $('#err-number').textContent = err.message; $('#f-number').classList.add('invalid');
      $('#f-number').scrollIntoView({ block: 'center', behavior: 'smooth' });
      fetchOrders().catch(() => {});
    } else if (err.status === 404) {
      toast(err.message); resetForm(); refreshOrders(renderOrders);
    } else toast(err.message);
    return;
  }
  saving = false; btn.disabled = false;
  const savedId = editingId;
  resetForm();
  renderOrders();
  if (wasEdit) scrollToOrder(savedId);
});

/* ---------- ყვავილების სია ---------- */
async function addFlower(name) {
  const existing = db.flowers.find(f => f.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const { flower } = await api('flowers', { method: 'POST', body: { name } });
  if (!db.flowers.some(f => sameId(f.id, flower.id))) db.flowers.push(flower);
  return flower;
}
function renderFlowerList() {
  $('#flower-list').innerHTML = db.flowers.map(f => `
    <li data-id="${f.id}">
      <input type="text" value="${esc(f.name)}" aria-label="ყვავილის სახელი">
      <button type="button" class="rm" aria-label="წაშლა"><svg class="ic"><use href="#i-trash"/></svg></button>
    </li>`).join('') || '<li class="meta">სია ცარიელია.</li>';
  $$('#flower-list li[data-id]').forEach(li => {
    const id = li.dataset.id;
    $('input', li).addEventListener('change', async e => {
      const inp = e.target, name = inp.value.trim(), f = db.flowers.find(x => sameId(x.id, id));
      if (!f) return;
      if (!name || name === f.name) { inp.value = f.name; return; }
      inp.disabled = true;
      try {
        await api(`flowers/${id}`, { method: 'PUT', body: { name } });
        f.name = name;
        [...db.orders, ...db.writeoffs].forEach(o => o.items.forEach(it => { if (sameId(it.flowerId, id)) it.name = name; }));
        refreshSelects(); toast('სახელი შეიცვალა.');
      } catch (err) { inp.value = f.name; toast(err.message); }
      inp.disabled = false;
    });
    $('.rm', li).onclick = async () => {
      const f = db.flowers.find(x => sameId(x.id, id));
      if (!f || !confirm(`წაიშალოს „${f.name}“ სიიდან? ძველ შეკვეთებსა და ჩამოწერებში ეს სახელი შენარჩუნდება.`)) return;
      try {
        await api(`flowers/${id}`, { method: 'DELETE' });
        db.flowers = db.flowers.filter(x => !sameId(x.id, id)); renderFlowerList(); refreshSelects();
      } catch (err) { toast(err.message); }
    };
  });
}
$('#btn-flowers').onclick = () => { renderFlowerList(); $('#dlg-flowers').showModal(); };
$('#btn-new-flower').onclick = async () => {
  const inp = $('#new-flower'), btn = $('#btn-new-flower'), name = inp.value.trim(); if (!name) return;
  btn.disabled = true;
  try { await addFlower(name); inp.value = ''; renderFlowerList(); refreshSelects(); }
  catch (err) { toast(err.message); }
  btn.disabled = false;
};
$('#new-flower').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#btn-new-flower').click(); } });

/* ---------- შეკვეთების სია ---------- */
const empty = (emoji, text) => `<div class="empty"><div class="empty-ic" aria-hidden="true">${emoji}</div><p>${text}</p></div>`;
// ისტორიაში ნაჩვენები შეკვეთები: პერიოდი + ნომრით ძებნა (CSV-იც ამას იყენებს)
function visibleOrders() {
  const q = $('#search').value.trim();
  return db.orders
    .filter(o => ordersRange.has(o) && (!q || String(o.number).includes(q)))
    .sort((a, b) => dayOf(b.date).localeCompare(dayOf(a.date)) || b.number - a.number);
}
function renderOrders() {
  const q = $('#search').value.trim(), filtered = ordersRange.mode !== 'all';
  const list = visibleOrders();
  if (!list.length) {
    $('#orders').innerHTML = !db.orders.length ? empty('💐', 'შეკვეთები ჯერ არ არის.')
      : q ? empty('🔍', filtered ? 'ამ პერიოდში ამ ნომრით შეკვეთა ვერ მოიძებნა.' : 'ამ ნომრით შეკვეთა ვერ მოიძებნა.')
      : empty('🗓️', 'ამ პერიოდში შეკვეთა არ არის.');
    return;
  }
  $('#orders').innerHTML = list.map(o => {
    const stems = o.items.reduce((s, i) => s + i.qty, 0);
    return `
    <article class="card order" data-id="${o.id}">
      <div class="card-h">
        <div class="num">№${o.number}</div>
        ${o.price != null && o.price !== '' ? `<div class="price">${money(o.price)}</div>` : ''}
      </div>
      <div class="meta">
        <span><svg class="ic"><use href="#i-cal"/></svg>${fmtDate(o.date)}</span>
        <span class="stems">${stems} ღერო</span>
      </div>
      <ul class="items">${o.items.map(i => `<li>${esc(i.name)}<b>${i.qty}</b></li>`).join('')}</ul>
      ${o.note ? `<div class="note"><svg class="ic"><use href="#i-note"/></svg><span>${esc(o.note)}</span></div>` : ''}
      <div class="card-a">
        <button class="btn ghost sm" data-edit="${o.id}"><svg class="ic"><use href="#i-edit"/></svg>რედაქტირება</button>
        <button class="btn danger sm" data-del="${o.id}" aria-label="წაშლა"><svg class="ic"><use href="#i-trash"/></svg>წაშლა</button>
      </div>
    </article>`;
  }).join('');
  $$('[data-edit]').forEach(b => b.onclick = () => startEdit(b.dataset.edit));
  $$('[data-del]').forEach(b => b.onclick = async () => {
    const o = db.orders.find(x => sameId(x.id, b.dataset.del));
    if (!o || !confirm(`წაიშალოს შეკვეთა №${o.number}? ამ მოქმედებას ვეღარ გააუქმებთ.`)) return;
    b.disabled = true;
    try {
      await api(`orders/${o.id}`, { method: 'DELETE' });
    } catch (err) {
      b.disabled = false;
      if (err.status !== 404) { toast(err.message); return; }
    }
    if (sameId(editingId, o.id)) resetForm();
    db.orders = db.orders.filter(x => !sameId(x.id, o.id)); renderOrders();
    toast(`შეკვეთა №${o.number} წაიშალა.`);
  });
  markEditing();
}
$('#search').addEventListener('input', renderOrders);

/* ---------- ჩამოწერა ---------- */
const stemsOf = r => r.items.reduce((t, i) => t + i.qty, 0);
const REASONS = { dried: 'გამხმარი', damaged: 'დაზიანებული', other: 'სხვა' };
function resetWoForm() {
  $('#wo-form').reset();
  $('#w-date').value = toDateInput(new Date());
  $('#w-rows').innerHTML = '';
  $('#err-w-rows').textContent = '';
  addRow('', 1, '', $('#w-rows'));
}
$('#btn-w-add-row').onclick = () => addRow('', 1, '', $('#w-rows'));

let woSaving = false;
$('#wo-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (woSaving) return;
  $('#err-w-rows').textContent = '';
  const items = collectItems($('#w-rows'));
  if (!items.length) {
    $('#err-w-rows').textContent = 'დაამატეთ ერთი ყვავილი მაინც.';
    $('#err-w-rows').scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  const data = {
    date: $('#w-date').value || toDateInput(new Date()),
    reason: $('input[name=w-reason]:checked')?.value || 'other',
    note: $('#w-note').value.trim(),
    items,
  };
  const btn = $('#btn-w-save'), label = btn.textContent;
  woSaving = true; btn.disabled = true; btn.textContent = 'ინახება…';
  try {
    const { writeoff } = await api('writeoffs', { method: 'POST', body: data });
    db.writeoffs.push(writeoff);
    const n = writeoff.items.reduce((t, i) => t + i.qty, 0);
    toast(`ჩამოიწერა ${n} ღერო.`);
    resetWoForm(); renderWriteOffs();
  } catch (err) { toast(err.message); }
  woSaving = false; btn.disabled = false; btn.textContent = label;
});

function renderWriteOffs() {
  const list = db.writeoffs.filter(w => woRange.has(w)).sort((a, b) => dayOf(b.date).localeCompare(dayOf(a.date)) || b.id - a.id);
  if (!list.length) {
    $('#writeoffs').innerHTML = db.writeoffs.length ? empty('🗓️', 'ამ პერიოდში ჩამოწერა არ არის.') : empty('🍂', 'ჩამოწერილი ყვავილები ჯერ არ არის.');
    return;
  }
  $('#writeoffs').innerHTML = list.map(w => {
    const stems = w.items.reduce((s, i) => s + i.qty, 0);
    return `
    <article class="card order wo">
      <div class="card-h">
        <div class="num"><span class="reason r-${esc(w.reason)}">${esc(REASONS[w.reason] || REASONS.other)}</span></div>
        <div class="price neg">−${stems} ღერო</div>
      </div>
      <div class="meta"><span><svg class="ic"><use href="#i-cal"/></svg>${fmtDate(w.date)}</span></div>
      <ul class="items">${w.items.map(i => `<li>${esc(flowerName(i.flowerId) || i.name)}<b>${i.qty}</b></li>`).join('')}</ul>
      ${w.note ? `<div class="note"><svg class="ic"><use href="#i-note"/></svg><span>${esc(w.note)}</span></div>` : ''}
      <div class="card-a">
        <button class="btn danger sm" data-wdel="${w.id}"><svg class="ic"><use href="#i-trash"/></svg>წაშლა</button>
      </div>
    </article>`;
  }).join('');
  $$('[data-wdel]').forEach(b => b.onclick = async () => {
    const w = db.writeoffs.find(x => sameId(x.id, b.dataset.wdel));
    if (!w || !confirm(`წაიშალოს ჩამოწერა (${fmtDate(w.date)}, ${stemsOf(w)} ღერო)? ამ მოქმედებას ვეღარ გააუქმებთ.`)) return;
    b.disabled = true;
    try {
      await api(`writeoffs/${w.id}`, { method: 'DELETE' });
    } catch (err) {
      b.disabled = false;
      if (err.status !== 404) { toast(err.message); return; }
    }
    db.writeoffs = db.writeoffs.filter(x => !sameId(x.id, w.id)); renderWriteOffs();
    toast('ჩამოწერა წაიშალა.');
  });
}

/* ---------- შეჯამება ---------- */
function flowerTotals(records) {
  const totals = new Map();
  records.forEach(o => o.items.forEach(i => {
    const name = flowerName(i.flowerId) || i.name;
    totals.set(name, (totals.get(name) || 0) + i.qty);
  }));
  return [...totals].sort((a, b) => b[1] - a[1]);
}
function barsCard(rows, cls = '') {
  const total = rows.reduce((t, r) => t + r[1], 0), max = rows[0][1];
  return `
    <div class="card table-card ${cls}">
      <div class="t-head"><span>ყვავილი</span><span>რაოდენობა</span></div>
      <ul class="bars">${rows.map(([n, q]) => `
        <li><div class="bar-l"><span>${esc(n)}</span><b>${q}</b></div>
        <div class="bar"><i style="width:${Math.max(4, Math.round(q / max * 100))}%"></i></div></li>`).join('')}
      </ul>
      <div class="t-foot"><span>სულ</span><b>${total}</b></div>
    </div>`;
}
function renderSummary() {
  const inRange = r => summaryRange.has(r);
  const orders = db.orders.filter(inRange);
  const wos = db.writeoffs.filter(inRange);
  if (!orders.length && !wos.length) { $('#summary').innerHTML = empty('🌱', 'ამ პერიოდში შეკვეთა და ჩამოწერა არ არის.'); return; }
  const sold = flowerTotals(orders), lost = flowerTotals(wos);
  const stems = sold.reduce((t, r) => t + r[1], 0);
  const lostStems = lost.reduce((t, r) => t + r[1], 0);
  const revenue = orders.reduce((t, o) => t + (o.price || 0), 0);
  $('#summary').innerHTML = `
    <div class="stats">
      <div class="stat"><b>${orders.length}</b><span>შეკვეთა</span></div>
      <div class="stat"><b>${stems}</b><span>ღერო</span></div>
      <div class="stat accent"><b>${revenue.toFixed(0)} ₾</b><span>შემოსავალი</span></div>
    </div>
    <h3 class="sec-h">გაყიდული</h3>
    ${sold.length ? barsCard(sold) : `<div class="card muted-card">ამ პერიოდში შეკვეთა არ არის.</div>`}
    <h3 class="sec-h">ჩამოწერილი${lostStems ? ` <span class="sec-n">${lostStems} ღერო</span>` : ''}</h3>
    ${lost.length ? barsCard(lost, 'loss') : `<div class="card muted-card">ამ პერიოდში ჩამოწერა არ არის.</div>`}`;
}


/* ---------- CSV ---------- */
$('#btn-csv').onclick = () => {
  const list = visibleOrders();
  if (!list.length) { toast(db.orders.length ? 'არჩეულ პერიოდში ჩამოსატვირთი შეკვეთა არ არის.' : 'ჩამოსატვირთი შეკვეთა ჯერ არ არის.'); return; }
  const head = ['შეკვეთის ნომერი', 'თარიღი', 'ყვავილი', 'რაოდენობა', 'ფასი (₾)', 'შენიშვნა'];
  const cell = v => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [head.map(cell).join(',')];
  [...list].sort((a, b) => a.number - b.number).forEach(o => {
    o.items.forEach((i, idx) => lines.push([
      o.number, dayOf(o.date),
      flowerName(i.flowerId) || i.name, i.qty, idx === 0 ? (o.price ?? '') : '', idx === 0 ? o.note : '',
    ].map(cell).join(',')));
  });
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `shekvetebi-${ordersRange.slug()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

/* ---------- გასვლა ---------- */
$('#btn-logout').onclick = async () => {
  if (!confirm('გამოხვიდეთ ანგარიშიდან?')) return;
  try { await fetch('/api/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', credentials: 'same-origin' }); } catch {}
  location.replace('/login');
};

/* ---------- ჩატვირთვა ---------- */
{ const d = new Date(), DAYS = ['კვირა', 'ორშაბათი', 'სამშაბათი', 'ოთხშაბათი', 'ხუთშაბათი', 'პარასკევი', 'შაბათი'];
  $('#today-line').textContent = `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`; }
document.body.dataset.view = 'orders';

let booted = false;
async function boot() {
  $('#boot').hidden = false; $('#boot-load').hidden = false; $('#boot-err').hidden = true;
  // ძალიან ნელი ქსელის შემთხვევაში „იტვირთება…“ სამუდამოდ არ უნდა დარჩეს
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new ApiError('სერვერი დიდხანს არ პასუხობს. სცადეთ თავიდან.', 0)), 20000));
  try {
    await Promise.race([Promise.all([fetchFlowers(), fetchOrders(), fetchWriteOffs()]), timeout]);
    resetForm(); resetWoForm(); renderOrders();
  } catch (e) {
    if (e.status === 401) return; // გადამისამართება შესვლის გვერდზე
    $('#boot-load').hidden = true; $('#boot-err').hidden = false; $('#boot-msg').textContent = e.message;
    return;
  }
  booted = true;
  // ჩატვირთვის ეკრანი DOM-იდან ამოვიღოთ, რომ „იტვირთება…“ აღარსად გამოჩნდეს
  $('#boot').remove();
}
$('#btn-retry').onclick = boot;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !booted) return;
  const v = document.body.dataset.view;
  if (v === 'orders') refreshOrders(renderOrders);
  else if (v === 'writeoff') refreshWriteOffs(renderWriteOffs);
  else if (v === 'summary') { refreshOrders(renderSummary); refreshWriteOffs(renderSummary); }
});
// iOS Safari-ში „უკან“ ღილაკით (bfcache) დაბრუნებისას მონაცემები განვაახლოთ
window.addEventListener('pageshow', e => { if (e.persisted && !booted) location.reload(); });
boot();

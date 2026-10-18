'use strict';
/* შეკვეთების ჟურნალი — პროტოტიპი. მონაცემები localStorage-ში ინახება. */
const KEY = 'florist-orders-v1';
const DEFAULT_FLOWERS = ['ვარდი წითელი', 'ვარდი თეთრი', 'ტულიფანი', 'ქრიზანთემა', 'ევკალიფტი', 'გიპსოფილა', 'ლისიანთუსი'];

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const toLocalInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toDateInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'];
const fmtDate = iso => { const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const money = v => (v == null || v === '') ? '' : Number(v).toFixed(2) + ' ₾';

/* ---------- მონაცემები ---------- */
let db;
function seed() {
  const flowers = DEFAULT_FLOWERS.map(name => ({ id: uid(), name }));
  const f = name => flowers.find(x => x.name === name);
  const at = (daysAgo, h, m) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const item = (name, qty) => ({ flowerId: f(name).id, name, qty });
  const orders = [
    { id: uid(), number: 1001, date: at(1, 17, 40), price: 85, note: 'დაბადების დღისთვის', example: true,
      items: [item('ვარდი წითელი', 11), item('გიპსოფილა', 2), item('ევკალიფტი', 3)] },
    { id: uid(), number: 1002, date: at(0, 11, 15), price: 60, note: '', example: true,
      items: [item('ტულიფანი', 15), item('ევკალიფტი', 2)] },
    { id: uid(), number: 1003, date: at(0, 13, 5), price: 120, note: 'მიტანით, ვაკე', example: true,
      items: [item('ვარდი თეთრი', 7), item('ლისიანთუსი', 5), item('ქრიზანთემა', 3), item('გიპსოფილა', 1)] },
  ];
  return { flowers, orders };
}
function load() {
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db || !Array.isArray(db.orders) || !Array.isArray(db.flowers)) { db = seed(); save(); }
  db.orders.forEach(o => { delete o.florist; }); // ძველი ველი აღარ გამოიყენება
}
function save() { localStorage.setItem(KEY, JSON.stringify(db)); }
const flowerName = id => db.flowers.find(f => f.id === id)?.name;

/* ---------- ნავიგაცია ---------- */
function show(view) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  document.body.dataset.view = view;
  if (view === 'list') renderOrders();
  if (view === 'summary') renderSummary();
  window.scrollTo(0, 0);
}
$$('.tab').forEach(t => t.addEventListener('click', () => show(t.dataset.view)));

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- ფორმა ---------- */
let editingId = null;

function flowerOptions(selected) {
  const opts = db.flowers.map(f => `<option value="${f.id}"${f.id === selected ? ' selected' : ''}>${esc(f.name)}</option>`);
  return `<option value="">ყვავილი…</option>${opts.join('')}<option value="__new">＋ ახალი ყვავილი…</option>`;
}
function addRow(flowerId = '', qty = 1, fallbackName = '') {
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
  sel.addEventListener('change', () => {
    if (sel.value === '__new') {
      const name = (prompt('ახალი ყვავილის სახელი:') || '').trim();
      if (name) { const f = addFlower(name); refreshSelects(); sel.value = f.id; }
      else sel.value = '';
    }
    updateTotal();
  });
  $('.dec', row).onclick = () => { q.value = Math.max(1, (+q.value || 1) - 1); updateTotal(); };
  $('.inc', row).onclick = () => { q.value = (+q.value || 0) + 1; updateTotal(); };
  q.addEventListener('input', updateTotal);
  $('.rm', row).onclick = () => { row.remove(); if (!$$('#rows .row').length) addRow(); updateTotal(); };
  $('#rows').appendChild(row);
  updateTotal();
}
function refreshSelects() {
  $$('#rows select').forEach(sel => {
    const v = sel.value, keep = sel.querySelector('option[data-name]');
    sel.innerHTML = (keep ? keep.outerHTML : '') + flowerOptions(v);
    sel.value = v;
  });
}
function updateTotal() {
  const n = $$('#rows .row').reduce((s, r) => s + ($('select', r).value ? (+$('input', r).value || 0) : 0), 0);
  $('#total-line').innerHTML = n ? `სულ <b>${n}</b> ღერო` : '';
}
function resetForm() {
  editingId = null;
  $('#order-form').reset();
  $('#form-title').textContent = 'ახალი შეკვეთა';
  $('#btn-save').textContent = 'შენახვა';
  $('#btn-cancel').hidden = true;
  $('#f-number').value = '';
  $('#f-date').value = toLocalInput(new Date());
  $('#rows').innerHTML = '';
  clearErrors();
  addRow();
}
function clearErrors() {
  $('#err-number').textContent = ''; $('#err-rows').textContent = '';
  $('#f-number').classList.remove('invalid');
}
function startEdit(id) {
  const o = db.orders.find(x => x.id === id); if (!o) return;
  show('form');
  editingId = id;
  clearErrors();
  $('#form-title').textContent = `შეკვეთის რედაქტირება (№${o.number})`;
  $('#btn-save').textContent = 'ცვლილებების შენახვა';
  $('#btn-cancel').hidden = false;
  $('#f-number').value = o.number;
  $('#f-date').value = toLocalInput(new Date(o.date));
  $('#f-price').value = o.price ?? '';
  $('#f-note').value = o.note || '';
  $('#rows').innerHTML = '';
  o.items.forEach(it => addRow(it.flowerId, it.qty, it.name));
}
$('#btn-cancel').onclick = () => { resetForm(); show('list'); };
$('#btn-add-row').onclick = () => addRow();

$('#order-form').addEventListener('submit', e => {
  e.preventDefault();
  clearErrors();
  let ok = true;
  const number = parseInt($('#f-number').value, 10);
  if (!number || number < 1) {
    $('#err-number').textContent = 'მიუთითეთ შეკვეთის ნომერი.'; ok = false;
  } else if (db.orders.some(o => o.number === number && o.id !== editingId)) {
    $('#err-number').textContent = `№${number} უკვე არსებობს. ჩაწერეთ სხვა ნომერი.`; ok = false;
  }
  if (!ok) $('#f-number').classList.add('invalid');

  // ერთნაირი ყვავილის მწკრივები გავაერთიანოთ
  const map = new Map();
  $$('#rows .row').forEach(r => {
    const sel = $('select', r), id = sel.value, qty = parseInt($('input', r).value, 10) || 0;
    if (!id || qty < 1) return;
    const name = flowerName(id) || sel.selectedOptions[0]?.dataset.name || sel.selectedOptions[0]?.textContent;
    const cur = map.get(id);
    map.set(id, { flowerId: id, name, qty: (cur?.qty || 0) + qty });
  });
  const items = [...map.values()];
  if (!items.length) { $('#err-rows').textContent = 'დაამატეთ ერთი ყვავილი მაინც.'; ok = false; }
  if (!ok) { $('.err:not(:empty)')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }

  const priceRaw = $('#f-price').value;
  const data = {
    number,
    date: new Date($('#f-date').value || Date.now()).toISOString(),
    price: priceRaw === '' ? null : Math.round(parseFloat(priceRaw) * 100) / 100,
    note: $('#f-note').value.trim(),
    items,
  };
  if (editingId) {
    const o = db.orders.find(x => x.id === editingId);
    Object.assign(o, data);
    toast(`შეკვეთა №${number} განახლდა.`);
  } else {
    db.orders.push({ id: uid(), example: false, ...data });
    toast(`შეკვეთა №${number} შენახულია.`);
  }
  save();
  const wasEdit = !!editingId;
  resetForm();
  if (wasEdit) show('list');
});

/* ---------- ყვავილების სია ---------- */
function addFlower(name) {
  const existing = db.flowers.find(f => f.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const f = { id: uid(), name }; db.flowers.push(f); save(); return f;
}
function renderFlowerList() {
  $('#flower-list').innerHTML = db.flowers.map(f => `
    <li data-id="${f.id}">
      <input type="text" value="${esc(f.name)}" aria-label="ყვავილის სახელი">
      <button type="button" class="rm" aria-label="წაშლა"><svg class="ic"><use href="#i-trash"/></svg></button>
    </li>`).join('') || '<li class="meta">სია ცარიელია.</li>';
  $$('#flower-list li[data-id]').forEach(li => {
    const id = li.dataset.id;
    $('input', li).addEventListener('change', e => {
      const name = e.target.value.trim(); const f = db.flowers.find(x => x.id === id);
      if (!name) { e.target.value = f.name; return; }
      f.name = name;
      db.orders.forEach(o => o.items.forEach(it => { if (it.flowerId === id) it.name = name; }));
      save(); refreshSelects();
    });
    $('.rm', li).onclick = () => {
      const f = db.flowers.find(x => x.id === id);
      if (!confirm(`წაიშალოს „${f.name}“ სიიდან? ძველ შეკვეთებში ეს სახელი შენარჩუნდება.`)) return;
      db.flowers = db.flowers.filter(x => x.id !== id); save(); renderFlowerList(); refreshSelects();
    };
  });
}
$('#btn-flowers').onclick = () => { renderFlowerList(); $('#dlg-flowers').showModal(); };
$('#btn-new-flower').onclick = () => {
  const inp = $('#new-flower'), name = inp.value.trim(); if (!name) return;
  addFlower(name); inp.value = ''; renderFlowerList(); refreshSelects();
};
$('#new-flower').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#btn-new-flower').click(); } });

/* ---------- შეკვეთების სია ---------- */
const empty = (emoji, text) => `<div class="empty"><div class="empty-ic" aria-hidden="true">${emoji}</div><p>${text}</p></div>`;
function renderOrders() {
  const q = $('#search').value.trim();
  const list = db.orders
    .filter(o => !q || String(o.number).includes(q))
    .sort((a, b) => new Date(b.date) - new Date(a.date) || b.number - a.number);
  if (!list.length) {
    $('#orders').innerHTML = empty(q ? '🔍' : '💐', q ? 'ამ ნომრით შეკვეთა ვერ მოიძებნა.' : 'შეკვეთები ჯერ არ არის.');
    return;
  }
  $('#orders').innerHTML = list.map(o => {
    const stems = o.items.reduce((s, i) => s + i.qty, 0);
    return `
    <article class="card order">
      <div class="card-h">
        <div class="num">№${o.number}${o.example ? '<span class="badge">მაგალითი</span>' : ''}</div>
        ${o.price != null && o.price !== '' ? `<div class="price">${money(o.price)}</div>` : ''}
      </div>
      <div class="meta">
        <span><svg class="ic"><use href="#i-clock"/></svg>${fmtDate(o.date)}</span>
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
  $$('[data-del]').forEach(b => b.onclick = () => {
    const o = db.orders.find(x => x.id === b.dataset.del);
    if (!confirm(`წაიშალოს შეკვეთა №${o.number}? ამ მოქმედებას ვეღარ გააუქმებთ.`)) return;
    db.orders = db.orders.filter(x => x.id !== o.id); save(); renderOrders();
    if (editingId === o.id) resetForm();
    toast(`შეკვეთა №${o.number} წაიშალა.`);
  });
}
$('#search').addEventListener('input', renderOrders);

/* ---------- შეჯამება ---------- */
let range = 'today';
function rangeBounds() {
  const now = new Date(), start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  if (range === 'week') start.setDate(start.getDate() - 6);
  if (range === 'month') start.setDate(1);
  if (range === 'custom') {
    const f = $('#r-from').value, t = $('#r-to').value;
    const s = f ? new Date(f + 'T00:00') : new Date(0);
    const e = t ? new Date(t + 'T00:00') : new Date(8.64e15); if (t) e.setDate(e.getDate() + 1);
    return [s, e];
  }
  return [start, end];
}
function renderSummary() {
  $('#custom-range').hidden = range !== 'custom';
  const [s, e] = rangeBounds();
  const orders = db.orders.filter(o => { const d = new Date(o.date); return d >= s && d < e; });
  if (!orders.length) { $('#summary').innerHTML = empty('🌱', 'ამ პერიოდში შეკვეთა არ არის.'); return; }
  const totals = new Map();
  orders.forEach(o => o.items.forEach(i => {
    const name = flowerName(i.flowerId) || i.name;
    totals.set(name, (totals.get(name) || 0) + i.qty);
  }));
  const rows = [...totals].sort((a, b) => b[1] - a[1]);
  const stems = rows.reduce((t, r) => t + r[1], 0);
  const revenue = orders.reduce((t, o) => t + (o.price || 0), 0);
  const max = rows[0][1];
  $('#summary').innerHTML = `
    <div class="stats">
      <div class="stat"><b>${orders.length}</b><span>შეკვეთა</span></div>
      <div class="stat"><b>${stems}</b><span>ღერო</span></div>
      <div class="stat accent"><b>${revenue.toFixed(0)} ₾</b><span>შემოსავალი</span></div>
    </div>
    <div class="card table-card">
      <div class="t-head"><span>ყვავილი</span><span>რაოდენობა</span></div>
      <ul class="bars">${rows.map(([n, q]) => `
        <li><div class="bar-l"><span>${esc(n)}</span><b>${q}</b></div>
        <div class="bar"><i style="width:${Math.max(4, Math.round(q / max * 100))}%"></i></div></li>`).join('')}
      </ul>
      <div class="t-foot"><span>სულ</span><b>${stems}</b></div>
    </div>`;
}
$$('.chip').forEach(c => c.addEventListener('click', () => {
  range = c.dataset.range;
  $$('.chip').forEach(x => x.classList.toggle('active', x === c));
  if (range === 'custom' && !$('#r-from').value) {
    const d = new Date(); $('#r-to').value = toDateInput(d); d.setDate(d.getDate() - 6); $('#r-from').value = toDateInput(d);
  }
  renderSummary();
}));
['#r-from', '#r-to'].forEach(s => $(s).addEventListener('change', renderSummary));

/* ---------- CSV ---------- */
$('#btn-csv').onclick = () => {
  const head = ['შეკვეთის ნომერი', 'თარიღი', 'დრო', 'ყვავილი', 'რაოდენობა', 'ფასი (₾)', 'შენიშვნა', 'მაგალითი'];
  const cell = v => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [head.map(cell).join(',')];
  [...db.orders].sort((a, b) => a.number - b.number).forEach(o => {
    const d = new Date(o.date);
    o.items.forEach((i, idx) => lines.push([
      o.number, toDateInput(d), `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      flowerName(i.flowerId) || i.name, i.qty, idx === 0 ? (o.price ?? '') : '', idx === 0 ? o.note : '', o.example ? 'კი' : '',
    ].map(cell).join(',')));
  });
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `shekvetebi-${toDateInput(new Date())}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

/* ---------- თავიდან ჩატვირთვა ---------- */
$('#btn-reset').onclick = () => {
  if (!confirm('წაიშალოს ყველა მონაცემი და ჩაიტვირთოს მაგალითები?')) return;
  db = seed(); save(); resetForm(); show('form'); toast('მაგალითები ჩაიტვირთა.');
};

load();
resetForm();
document.body.dataset.view = 'form';
{ const d = new Date(), DAYS = ['კვირა', 'ორშაბათი', 'სამშაბათი', 'ოთხშაბათი', 'ხუთშაბათი', 'პარასკევი', 'შაბათი'];
  $('#today-line').textContent = `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`; }

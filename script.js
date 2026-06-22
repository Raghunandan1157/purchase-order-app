// ============================================================
// Supabase Client
// ============================================================
const SUPABASE_URL = 'https://zovnmmdfthpbubrorsgh.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpvdm5tbWRmdGhwYnVicm9yc2doIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1NzE3ODgsImV4cCI6MjA3NzE0Nzc4OH0.92BH2sjUOgkw6iSRj1_4gt0p3eThg3QT4VK-Q4EdmBE';

const T_USERS = 'purchase_order_users';
const T_ORDERS = 'purchase_order_orders';
const T_SETTINGS = 'purchase_order_settings';

let supa = null;
try {
  supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
} catch (e) {
  console.error('Supabase init failed', e);
}

// ============================================================
// Session state
// ============================================================
const LS_USER = 'po_current_user';        // { name, display_name }
const LS_ADMIN_SESSION = 'po_admin_session'; // "1" while admin
let currentUser = null;
let currentPoId = null;          // DB id of currently loaded PO (null = new)
let userOrdersCache = [];        // all orders for current user
let allOrdersCache = [];         // admin: all orders
let allUsersCache = [];          // admin: all users
let monthChartInstance = null;
let adminChartInstance = null;

// Auto-save state
let autosaveTimer = null;
let suppressAutosave = false;    // true while programmatically populating fields
const AUTOSAVE_DELAY = 1500;

// ============================================================
// Save status chip
// ============================================================
function setSaveStatus(state, text) {
  const el = document.getElementById('saveStatus');
  const tx = document.getElementById('saveStatusText');
  if (!el || !tx) return;
  el.classList.remove('saving', 'dirty', 'error');
  if (state && state !== 'saved') el.classList.add(state);
  tx.textContent = text || ({
    saved: 'Saved',
    saving: 'Saving…',
    dirty: 'Unsaved',
    error: 'Error'
  }[state] || 'Saved');
}

function hasFormContent() {
  const hasSupplier = getAddressLines('supplier').some(l => l && l.trim());
  const hasShipping = getAddressLines('shipping').some(l => l && l.trim());
  const hasItems = !!document.querySelector('#itemsBody .item-desc[value]:not([value=""])')
    || Array.from(document.querySelectorAll('#itemsBody .item-desc')).some(i => i.value && i.value.trim())
    || Array.from(document.querySelectorAll('#itemsBody .item-price')).some(i => parseFloat(i.value) > 0);
  const hasRemarks = !!(document.getElementById('remarks').value || '').trim();
  const hasGstin = !!(document.getElementById('supplierGstin').value || '').trim();
  return hasSupplier || hasShipping || hasItems || hasRemarks || hasGstin;
}

function scheduleAutosave() {
  if (suppressAutosave) return;
  if (!currentUser) return;
  if (!hasFormContent()) return;
  setSaveStatus('dirty');
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    savePO({ auto: true });
  }, AUTOSAVE_DELAY);
}

async function flushAutosave() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    await savePO({ auto: true });
  }
}

// ============================================================
// Toast
// ============================================================
function showToast(message, type) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' toast-' + type : '');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// ============================================================
// Helpers: date / format / words
// ============================================================
function formatDate(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function numberToWords(num) {
  if (num === 0) return 'Zero rupees only';
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  function twoDigits(n) {
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  }
  function threeDigits(n) {
    if (n >= 100) return ones[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + twoDigits(n % 100) : '');
    return twoDigits(n);
  }
  const totalPaise = Math.round(num * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;
  let result = '';
  let rem = rupees;
  if (rem >= 10000000) { result += threeDigits(Math.floor(rem / 10000000)) + ' crore '; rem = rem % 10000000; }
  if (rem >= 100000)   { result += twoDigits(Math.floor(rem / 100000))     + ' lakh ';  rem = rem % 100000; }
  if (rem >= 1000)     { result += twoDigits(Math.floor(rem / 1000))       + ' thousand '; rem = rem % 1000; }
  if (rem > 0)         { result += threeDigits(rem); }
  result = result.trim();
  result = result.charAt(0).toUpperCase() + result.slice(1);
  result += ' rupees';
  if (paise > 0) result += ' and ' + twoDigits(paise).toLowerCase() + ' paise';
  result += ' only';
  return result;
}

function formatINR(num) {
  const parts = (Number(num) || 0).toFixed(2).split('.');
  let intPart = parts[0];
  const decPart = parts[1];
  let result = '';
  const sign = intPart.startsWith('-') ? '-' : '';
  if (sign) intPart = intPart.slice(1);
  const len = intPart.length;
  if (len <= 3) result = intPart;
  else {
    result = intPart.substring(len - 3);
    intPart = intPart.substring(0, len - 3);
    while (intPart.length > 2) {
      result = intPart.substring(intPart.length - 2) + ',' + result;
      intPart = intPart.substring(0, intPart.length - 2);
    }
    result = intPart + ',' + result;
  }
  return sign + result + '.' + decPart;
}

function monthKey(dt) {
  const d = dt instanceof Date ? dt : new Date(dt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

// ============================================================
// PO Table rows
// ============================================================
function getQty(row) {
  const raw = parseFloat(row.querySelector('.item-qty').value);
  return isFinite(raw) && raw > 0 ? raw : 1;
}

function addItemRow(desc = '', qty = '', price = '', gst = '18', total = '') {
  const tbody = document.getElementById('itemsBody');
  const tr = document.createElement('tr');
  tr.className = 'item-row';
  tr.innerHTML = `
    <td class="desc-cell"><input type="text" class="item-desc" value="${escapeAttr(desc)}" placeholder="Item description" /></td>
    <td class="qty-cell"><input type="number" class="item-qty" value="${escapeAttr(qty)}" min="0" placeholder="1" /></td>
    <td class="price-cell"><input type="number" class="item-price" value="${escapeAttr(price)}" min="0" step="0.01" placeholder="0.00" /></td>
    <td class="gst-select-cell">
      <select class="item-gst">
        <option value="0" ${gst === '0' ? 'selected' : ''}>0%</option>
        <option value="5" ${gst === '5' ? 'selected' : ''}>5%</option>
        <option value="18" ${gst === '18' || !gst ? 'selected' : ''}>18%</option>
      </select>
    </td>
    <td class="gst-amt-cell">0.00</td>
    <td class="row-total-cell"><input type="number" class="item-total" value="${escapeAttr(total)}" min="0" step="0.01" placeholder="0.00" /></td>
    <td class="action-cell no-print"><button class="btn-remove" onclick="removeRow(this)">&times;</button></td>
  `;
  tbody.appendChild(tr);
  tr.querySelector('.item-qty').addEventListener('input', () => recalcRow(tr, 'price'));
  tr.querySelector('.item-price').addEventListener('input', () => recalcRow(tr, 'price'));
  tr.querySelector('.item-gst').addEventListener('change', () => recalcRow(tr, 'price'));
  tr.querySelector('.item-total').addEventListener('input', () => recalcRow(tr, 'total'));
  recalcRow(tr, 'price');
}

function escapeAttr(v) {
  return String(v ?? '').replace(/"/g, '&quot;');
}

function removeRow(btn) {
  btn.closest('tr').remove();
  recalculate();
}

function recalcRow(row, source) {
  const qty = getQty(row);
  const gst = parseFloat(row.querySelector('.item-gst').value) || 0;
  const priceInput = row.querySelector('.item-price');
  const totalInput = row.querySelector('.item-total');
  if (source === 'total') {
    const total = parseFloat(totalInput.value) || 0;
    const lineSub = total / (1 + gst / 100);
    const unitPrice = lineSub / qty;
    priceInput.value = total > 0 ? unitPrice.toFixed(2) : '';
  } else {
    const price = parseFloat(priceInput.value) || 0;
    const total = price * qty * (1 + gst / 100);
    totalInput.value = price > 0 ? total.toFixed(2) : '';
  }
  recalculate();
}

function recalculate() {
  let subtotal = 0;
  let totalGst = 0;
  document.querySelectorAll('#itemsBody .item-row').forEach(row => {
    const qty = getQty(row);
    const price = parseFloat(row.querySelector('.item-price').value) || 0;
    const gstPercent = parseFloat(row.querySelector('.item-gst').value) || 0;
    const lineSub = qty * price;
    const lineGst = lineSub * gstPercent / 100;
    row.querySelector('.gst-amt-cell').textContent = formatINR(lineGst);
    subtotal += lineSub;
    totalGst += lineGst;
  });
  const grandTotal = subtotal + totalGst;
  document.getElementById('subtotal').textContent = formatINR(subtotal);
  document.getElementById('totalGst').textContent = formatINR(totalGst);
  document.getElementById('grandTotal').textContent = formatINR(grandTotal);
  document.getElementById('amountWords').textContent = numberToWords(grandTotal);
  scheduleAutosave();
}

// ============================================================
// Print / PDF helpers
// ============================================================
const A4_CONTENT_HEIGHT_PX = 1050;
function fitToSinglePage() {
  const page = document.getElementById('purchaseOrder');
  page.classList.remove('compact', 'ultra-compact', 'mini');
  if (page.offsetHeight <= A4_CONTENT_HEIGHT_PX) return;
  page.classList.add('compact');
  if (page.offsetHeight <= A4_CONTENT_HEIGHT_PX) return;
  page.classList.add('ultra-compact');
  if (page.offsetHeight <= A4_CONTENT_HEIGHT_PX) return;
  page.classList.add('mini');
}
function prepareForPrint() {
  document.querySelectorAll('#itemsBody .empty-row').forEach(r => r.remove());
  const itemCount = document.querySelectorAll('#itemsBody .item-row').length;
  const emptyNeeded = itemCount >= 8 ? 0 : Math.max(4 - itemCount, 0);
  const tbody = document.getElementById('itemsBody');
  for (let i = 0; i < emptyNeeded; i++) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td>';
    tbody.appendChild(tr);
  }
  fitToSinglePage();
}
function cleanupAfterPrint() {
  document.querySelectorAll('#itemsBody .empty-row').forEach(r => r.remove());
  const page = document.getElementById('purchaseOrder');
  page.classList.remove('compact', 'ultra-compact', 'mini');
}

// ============================================================
// Address helpers
// ============================================================
function getAddressLines(which) {
  return Array.from(document.querySelectorAll(`.addr-line[data-addr="${which}"]`))
    .sort((a, b) => (+a.dataset.idx) - (+b.dataset.idx))
    .map(i => i.value);
}
function setAddressLines(which, value) {
  const inputs = Array.from(document.querySelectorAll(`.addr-line[data-addr="${which}"]`))
    .sort((a, b) => (+a.dataset.idx) - (+b.dataset.idx));
  let lines = [];
  if (Array.isArray(value)) lines = value;
  else if (typeof value === 'string') lines = value.split('\n');
  inputs.forEach((inp, i) => { inp.value = lines[i] || ''; });
}

// ============================================================
// Form data <-> DB row
// ============================================================
function getFormData() {
  const items = [];
  document.querySelectorAll('#itemsBody .item-row').forEach(row => {
    items.push({
      desc: row.querySelector('.item-desc').value,
      qty: row.querySelector('.item-qty').value,
      price: row.querySelector('.item-price').value,
      gst: row.querySelector('.item-gst').value,
      total: row.querySelector('.item-total').value,
    });
  });
  const supplierAddressLines = getAddressLines('supplier');
  const shippingAddressLines = getAddressLines('shipping');

  // Compute totals
  let subtotal = 0, gstTotal = 0;
  items.forEach(it => {
    const qty = parseFloat(it.qty) || 1;
    const price = parseFloat(it.price) || 0;
    const gstP = parseFloat(it.gst) || 0;
    const sub = qty * price;
    subtotal += sub;
    gstTotal += sub * gstP / 100;
  });
  const grandTotal = subtotal + gstTotal;

  return {
    poDate: document.getElementById('poDateDisplay').textContent,
    poNumber: document.getElementById('poNumDisplay').textContent,
    supplierName: supplierAddressLines[0] || '',
    supplierAddressLines,
    supplierAddress: supplierAddressLines.join('\n'),
    supplierGstin: document.getElementById('supplierGstin').value,
    shippingName: shippingAddressLines[0] || '',
    shippingAddressLines,
    shippingAddress: shippingAddressLines.join('\n'),
    remarks: document.getElementById('remarks').value,
    items,
    subtotal: Number(subtotal.toFixed(2)),
    gstTotal: Number(gstTotal.toFixed(2)),
    grandTotal: Number(grandTotal.toFixed(2)),
  };
}

function loadFormData(data) {
  suppressAutosave = true;
  document.getElementById('poDateDisplay').textContent = data.poDate || '';
  document.getElementById('poNumDisplay').textContent = data.poNumber || '';
  setAddressLines('supplier', data.supplierAddressLines || data.supplierAddress || '');
  document.getElementById('supplierGstin').value = data.supplierGstin || '';
  setAddressLines('shipping', data.shippingAddressLines || data.shippingAddress || '');
  document.getElementById('remarks').value = data.remarks || '';
  document.getElementById('itemsBody').innerHTML = '';
  if (data.items && data.items.length > 0) {
    data.items.forEach(item => addItemRow(item.desc, item.qty, item.price, item.gst || '18', item.total || ''));
  } else {
    addItemRow();
  }
  recalculate();
  suppressAutosave = false;
  setSaveStatus('saved');
}

// Map DB row -> form data
function rowToForm(row) {
  return {
    poDate: row.po_date || '',
    poNumber: row.po_number || '',
    supplierAddressLines: (row.supplier_address || '').split('\n'),
    supplierGstin: row.supplier_gstin || '',
    shippingAddressLines: (row.shipping_address || '').split('\n'),
    remarks: row.remarks || '',
    items: row.items || [],
  };
}

// ============================================================
// Supabase: PO number generation (globally sequential)
// ============================================================
async function nextPoNumber() {
  const year = new Date().getFullYear();
  if (!supa) return `PO-${year}-0001`;
  // Prefer atomic server-side RPC (single sequence bump = negligible compute,
  // collision-proof across concurrent users). Falls back to max+1 query if
  // the function isn't deployed yet.
  try {
    const { data, error } = await supa.rpc('next_purchase_order_number');
    if (!error && data) return data;
  } catch (_) {}
  try {
    const { data, error } = await supa
      .from(T_ORDERS)
      .select('po_number')
      .order('id', { ascending: false })
      .limit(1);
    if (error) throw error;
    let next = 1;
    if (data && data.length > 0) {
      const m = /PO-\d{4}-(\d+)/.exec(data[0].po_number || '');
      if (m) next = parseInt(m[1], 10) + 1;
    }
    return `PO-${year}-${String(next).padStart(4, '0')}`;
  } catch (e) {
    console.error('nextPoNumber', e);
    return `PO-${year}-${String(Date.now() % 10000).padStart(4, '0')}`;
  }
}

async function setAutoFieldsAsync() {
  document.getElementById('poDateDisplay').textContent = formatDate(new Date());
  document.getElementById('poNumDisplay').textContent = await nextPoNumber();
}

// ============================================================
// Supabase: save PO
// ============================================================
async function savePO(opts) {
  const auto = !!(opts && opts.auto);
  if (!currentUser) { if (!auto) showToast('Please login first', 'error'); return; }
  const data = getFormData();
  const hasSupplierAddr = (data.supplierAddressLines || []).some(l => l && l.trim());
  if (!hasSupplierAddr && !data.items.some(i => i.desc)) {
    if (!auto) showToast('Please fill in some details before saving', 'error');
    return;
  }
  if (!supa) { if (!auto) showToast('Supabase unavailable', 'error'); return; }

  setSaveStatus('saving');

  let poNum = data.poNumber;
  if (!currentPoId) {
    poNum = await nextPoNumber();
    data.poNumber = poNum;
    document.getElementById('poNumDisplay').textContent = poNum;
  }

  const payload = {
    po_number: poNum,
    user_name: currentUser.name,
    po_date: data.poDate,
    supplier_name: data.supplierName,
    supplier_address: data.supplierAddress,
    supplier_gstin: data.supplierGstin,
    shipping_name: data.shippingName,
    shipping_address: data.shippingAddress,
    items: data.items,
    subtotal: data.subtotal,
    gst_total: data.gstTotal,
    grand_total: data.grandTotal,
    remarks: data.remarks,
    updated_at: new Date().toISOString(),
  };

  try {
    let res;
    if (currentPoId) {
      res = await supa.from(T_ORDERS).update(payload).eq('id', currentPoId).select().single();
    } else {
      res = await supa.from(T_ORDERS).insert(payload).select().single();
    }
    if (res.error) throw res.error;
    currentPoId = res.data.id;
    const cached = userOrdersCache.findIndex(o => o.id === currentPoId);
    if (cached >= 0) userOrdersCache[cached] = res.data;
    else userOrdersCache.unshift(res.data);
    setSaveStatus('saved');
    if (!auto) showToast('Saved', 'success');
    renderSidebar();
    if (!document.getElementById('docsView').classList.contains('hidden')) renderDocsGrid();
  } catch (e) {
    console.error('savePO', e);
    if (String(e.message || '').includes('duplicate') || e.code === '23505') {
      // Concurrent PO-number collision: client drops its guess and retries once.
      currentPoId = null;
      return savePO(opts);
    }
    setSaveStatus('error', 'Save failed');
    if (!auto) showToast('Save failed: ' + (e.message || 'Unknown error'), 'error');
  }
}

// ============================================================
// Supabase: fetch user orders
// ============================================================
async function fetchUserOrders() {
  if (!supa || !currentUser) return [];
  try {
    const { data, error } = await supa
      .from(T_ORDERS)
      .select('*')
      .eq('user_name', currentUser.name)
      .order('created_at', { ascending: false });
    if (error) throw error;
    userOrdersCache = data || [];
    return userOrdersCache;
  } catch (e) {
    console.error('fetchUserOrders', e);
    userOrdersCache = [];
    return [];
  }
}

// ============================================================
// Sidebar rendering
// ============================================================
function renderSidebar() {
  const list = document.getElementById('historyList');
  const search = (document.getElementById('historySearch').value || '').toLowerCase().trim();
  const filtered = userOrdersCache.filter(o => {
    if (!search) return true;
    return (
      (o.po_number || '').toLowerCase().includes(search) ||
      (o.supplier_name || '').toLowerCase().includes(search) ||
      (o.remarks || '').toLowerCase().includes(search)
    );
  });
  if (filtered.length === 0) {
    list.innerHTML = '<div class="history-empty">No purchase orders yet</div>';
  } else {
    list.innerHTML = filtered.map(o => `
      <div class="history-item" data-id="${o.id}">
        <div class="history-item-top">
          <div class="history-item-po">${escapeHtml(o.po_number || '—')}</div>
          <div class="history-item-total">₹${formatINR(o.grand_total || 0)}</div>
        </div>
        <div class="history-item-sub">${escapeHtml(o.supplier_name || 'No supplier')} · ${escapeHtml(o.po_date || '')}</div>
      </div>
    `).join('');
    list.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', () => loadOrderById(el.dataset.id));
    });
  }
  renderStatsAndChart();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function loadOrderById(id) {
  const order = userOrdersCache.find(o => String(o.id) === String(id));
  if (!order) return;
  await showEditorView(() => {
    currentPoId = order.id;
    loadFormData(rowToForm(order));
  });
  showToast(`Loaded ${order.po_number}`, 'success');
}

// ============================================================
// Stats + chart
// ============================================================
function renderStatsAndChart() {
  const now = new Date();
  const curKey = monthKey(now);
  let monthCount = 0, monthTotal = 0;
  const byMonth = {};
  userOrdersCache.forEach(o => {
    const k = monthKey(o.created_at);
    byMonth[k] = byMonth[k] || { count: 0, total: 0 };
    byMonth[k].count += 1;
    byMonth[k].total += Number(o.grand_total || 0);
    if (k === curKey) {
      monthCount += 1;
      monthTotal += Number(o.grand_total || 0);
    }
  });
  document.getElementById('statMonthCount').textContent = monthCount;
  document.getElementById('statMonthTotal').textContent = formatINR(monthTotal).replace('.00', '');
  renderMonthChart(byMonth);
}

function lastNMonthKeys(n) {
  const keys = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const dd = new Date(d.getFullYear(), d.getMonth() - i, 1);
    keys.push(monthKey(dd));
  }
  return keys;
}

function renderMonthChart(byMonth) {
  const canvas = document.getElementById('monthChart');
  if (!canvas || !window.Chart) return;
  const keys = lastNMonthKeys(6);
  const labels = keys.map(monthLabel);
  const counts = keys.map(k => byMonth[k] ? byMonth[k].count : 0);
  if (monthChartInstance) monthChartInstance.destroy();
  monthChartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'POs',
        data: counts,
        backgroundColor: 'rgba(192,57,43,0.75)',
        borderColor: 'rgba(192,57,43,1)',
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8a94a2', font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: '#8a94a2', font: { size: 10 }, precision: 0 }, grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true }
      }
    }
  });
}

// ============================================================
// New PO
// ============================================================
async function newPO() {
  await flushAutosave();
  suppressAutosave = true;
  currentPoId = null;
  setAddressLines('supplier', '');
  document.getElementById('supplierGstin').value = '';
  setAddressLines('shipping', '');
  document.getElementById('remarks').value = '';
  document.getElementById('itemsBody').innerHTML = '';
  await setAutoFieldsAsync();
  addItemRow();
  recalculate();
  suppressAutosave = false;
  setSaveStatus('dirty', 'New');
}

// ============================================================
// Local Saved Modal (fallback / legacy)
// ============================================================
function showSavedList() {
  const saved = userOrdersCache;
  const list = document.getElementById('savedList');
  if (saved.length === 0) {
    list.innerHTML = '<p class="no-saved">No saved purchase orders yet.</p>';
  } else {
    list.innerHTML = saved.map((po) => `
      <div class="saved-item">
        <div class="saved-item-info">
          <strong>${escapeHtml(po.po_number || 'No PO#')} - ${escapeHtml(po.supplier_name || 'No Supplier')}</strong>
          <small>${escapeHtml(po.po_date || '')} | ₹${formatINR(po.grand_total || 0)}</small>
        </div>
        <div class="saved-item-actions">
          <button class="btn-load-item" data-id="${po.id}">Load</button>
          <button class="btn-delete-item" data-id="${po.id}">Delete</button>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('.btn-load-item').forEach(btn => {
      btn.addEventListener('click', () => {
        loadOrderById(btn.dataset.id);
        document.getElementById('savedModal').classList.add('hidden');
      });
    });
    list.querySelectorAll('.btn-delete-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this purchase order?')) return;
        await deleteOrder(btn.dataset.id);
        showSavedList();
      });
    });
  }
  document.getElementById('savedModal').classList.remove('hidden');
}

async function deleteOrder(id) {
  if (!supa) return;
  try {
    const { error } = await supa.from(T_ORDERS).delete().eq('id', id);
    if (error) throw error;
    userOrdersCache = userOrdersCache.filter(o => String(o.id) !== String(id));
    if (String(currentPoId) === String(id)) currentPoId = null;
    renderSidebar();
    if (!document.getElementById('docsView').classList.contains('hidden')) renderDocsGrid();
    showToast('Deleted', 'success');
  } catch (e) {
    showToast('Delete failed', 'error');
  }
}

function clearLocalCache() {
  if (!confirm('Clear local cached data? Cloud data stays intact.')) return;
  localStorage.removeItem('purchaseOrders');
  showToast('Local cache cleared', 'success');
}

// ============================================================
// Login
// ============================================================
function showLogin() {
  document.getElementById('loginOverlay').classList.remove('hidden');
  document.getElementById('appShell').classList.add('hidden');
  document.getElementById('adminPanel').classList.add('hidden');
  document.getElementById('loginPwWrap').classList.add('hidden');
  document.getElementById('loginName').value = '';
  document.getElementById('loginPw').value = '';
  document.getElementById('loginError').textContent = '';
  setTimeout(() => document.getElementById('loginName').focus(), 100);
}

async function getAdminPassword() {
  if (!supa) return 'Nava@123';
  try {
    const { data, error } = await supa
      .from(T_SETTINGS)
      .select('value')
      .eq('key', 'admin_password')
      .maybeSingle();
    if (error) throw error;
    return (data && data.value) || 'Nava@123';
  } catch (e) {
    console.error('getAdminPassword', e);
    return 'Nava@123';
  }
}

async function setAdminPassword(newPw) {
  if (!supa) throw new Error('Supabase unavailable');
  const { error } = await supa
    .from(T_SETTINGS)
    .upsert({ key: 'admin_password', value: newPw, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

async function doUserLogin(rawName) {
  const displayName = rawName.trim();
  const name = displayName.toLowerCase();
  if (!supa) {
    currentUser = { name, display_name: displayName };
    localStorage.setItem(LS_USER, JSON.stringify(currentUser));
    await enterApp();
    return;
  }
  try {
    // Upsert user (insert if new, update last_login_at if exists)
    const { error } = await supa
      .from(T_USERS)
      .upsert(
        { name, display_name: displayName, last_login_at: new Date().toISOString() },
        { onConflict: 'name' }
      );
    if (error) throw error;
  } catch (e) {
    console.error('upsert user', e);
  }
  currentUser = { name, display_name: displayName };
  localStorage.setItem(LS_USER, JSON.stringify(currentUser));
  await enterApp();
}

async function enterApp() {
  document.getElementById('loginOverlay').classList.add('hidden');
  document.getElementById('adminPanel').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  // Header
  const name = currentUser.display_name || currentUser.name;
  document.getElementById('userNameDisplay').textContent = name;
  document.getElementById('userAvatar').textContent = name.charAt(0).toUpperCase();
  document.getElementById('userMetaDisplay').textContent = 'signed in';
  // Fetch orders, render
  await fetchUserOrders();
  renderSidebar();
  // Land on docs grid, not editor
  showDocsView();
}

function showDocsView() {
  document.getElementById('docsView').classList.remove('hidden');
  document.getElementById('editorView').classList.add('hidden');
  renderDocsGrid();
}

async function showEditorView(initFn) {
  document.getElementById('docsView').classList.add('hidden');
  document.getElementById('editorView').classList.remove('hidden');
  if (initFn) await initFn();
}

function renderDocsGrid() {
  const grid = document.getElementById('docsGrid');
  const search = (document.getElementById('docsSearch').value || '').toLowerCase().trim();
  const filtered = userOrdersCache.filter(o => {
    if (!search) return true;
    return (
      (o.po_number || '').toLowerCase().includes(search) ||
      (o.supplier_name || '').toLowerCase().includes(search) ||
      (o.remarks || '').toLowerCase().includes(search)
    );
  });

  const sub = document.getElementById('docsSub');
  sub.textContent = userOrdersCache.length === 0
    ? 'Start a new one — your saved orders will appear here'
    : `${userOrdersCache.length} saved order${userOrdersCache.length === 1 ? '' : 's'}`;

  const newCardHtml = `
    <div class="doc-card doc-new" id="docNewCard">
      <div class="doc-thumb">
        <div class="doc-thumb-plus">+</div>
      </div>
      <div class="doc-meta">
        <div class="doc-po">Blank Purchase Order</div>
        <div class="doc-supplier">Start a new order</div>
      </div>
    </div>
  `;

  const cardsHtml = filtered.map(o => {
    const created = o.created_at ? new Date(o.created_at) : null;
    const createdStr = created ? created.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    return `
      <div class="doc-card" data-id="${o.id}">
        <button class="doc-card-delete" data-del="${o.id}" title="Delete">×</button>
        <div class="doc-thumb">
          <div class="doc-thumb-bar"></div>
          <div class="doc-thumb-title">PURCHASE ORDER</div>
          <div class="doc-thumb-lines">
            <div class="doc-thumb-line w-80"></div>
            <div class="doc-thumb-line w-60"></div>
            <div class="doc-thumb-line w-40"></div>
          </div>
          <div class="doc-thumb-table"></div>
          <div class="doc-thumb-total">₹ ${formatINR(o.grand_total || 0)}</div>
        </div>
        <div class="doc-meta">
          <div class="doc-po">${escapeHtml(o.po_number || '—')}</div>
          <div class="doc-supplier">${escapeHtml(o.supplier_name || 'No supplier')}</div>
          <div class="doc-date">${escapeHtml(o.po_date || createdStr)}</div>
        </div>
      </div>
    `;
  }).join('');

  const emptyHint = (userOrdersCache.length > 0 && filtered.length === 0)
    ? `<div class="docs-empty-hint">No matches for "${escapeHtml(search)}"</div>`
    : '';

  grid.innerHTML = newCardHtml + cardsHtml + emptyHint;

  document.getElementById('docNewCard').addEventListener('click', async () => {
    await showEditorView(async () => { await newPO(); });
  });
  grid.querySelectorAll('.doc-card[data-id]').forEach(card => {
    card.addEventListener('click', async (e) => {
      if (e.target.closest('.doc-card-delete')) return;
      const id = card.dataset.id;
      await showEditorView(() => {
        const order = userOrdersCache.find(o => String(o.id) === String(id));
        if (!order) return;
        currentPoId = order.id;
        loadFormData(rowToForm(order));
      });
    });
  });
  grid.querySelectorAll('.doc-card-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this purchase order?')) return;
      await deleteOrder(btn.dataset.del);
      renderDocsGrid();
    });
  });
}

async function enterAdmin() {
  localStorage.setItem(LS_ADMIN_SESSION, '1');
  document.getElementById('loginOverlay').classList.add('hidden');
  document.getElementById('appShell').classList.add('hidden');
  document.getElementById('adminPanel').classList.remove('hidden');
  await loadAdminData();
}

async function logout() {
  await flushAutosave();
  localStorage.removeItem(LS_USER);
  localStorage.removeItem(LS_ADMIN_SESSION);
  currentUser = null;
  currentPoId = null;
  userOrdersCache = [];
  if (monthChartInstance) { monthChartInstance.destroy(); monthChartInstance = null; }
  if (adminChartInstance) { adminChartInstance.destroy(); adminChartInstance = null; }
  showLogin();
}

// ============================================================
// Login form handler
// ============================================================
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('loginName').value.trim();
  const pwWrap = document.getElementById('loginPwWrap');
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  if (!name) { errEl.textContent = 'Please enter a name'; return; }

  if (name.toLowerCase() === 'admin') {
    if (pwWrap.classList.contains('hidden')) {
      pwWrap.classList.remove('hidden');
      setTimeout(() => document.getElementById('loginPw').focus(), 80);
      document.getElementById('loginBtn').textContent = 'Login as Admin';
      return;
    }
    const pw = document.getElementById('loginPw').value;
    const expected = await getAdminPassword();
    if (pw !== expected) {
      errEl.textContent = 'Incorrect admin password';
      return;
    }
    await enterAdmin();
    return;
  }

  // Non-admin: hide password wrap if visible, proceed
  pwWrap.classList.add('hidden');
  document.getElementById('loginBtn').textContent = 'Continue';
  await doUserLogin(name);
});

document.getElementById('loginName').addEventListener('input', (e) => {
  const val = (e.target.value || '').trim().toLowerCase();
  const pwWrap = document.getElementById('loginPwWrap');
  const btn = document.getElementById('loginBtn');
  if (val === 'admin') {
    pwWrap.classList.remove('hidden');
    btn.textContent = 'Login as Admin';
  } else {
    pwWrap.classList.add('hidden');
    btn.textContent = 'Continue';
  }
});

document.getElementById('btnLogout').addEventListener('click', logout);
document.getElementById('btnAdminLogout').addEventListener('click', logout);

// ============================================================
// Admin dashboard
// ============================================================
async function loadAdminData() {
  if (!supa) return;
  try {
    const [usersRes, ordersRes] = await Promise.all([
      supa.from(T_USERS).select('*').order('created_at', { ascending: false }),
      supa.from(T_ORDERS).select('*').order('created_at', { ascending: false }),
    ]);
    if (usersRes.error) throw usersRes.error;
    if (ordersRes.error) throw ordersRes.error;
    allUsersCache = usersRes.data || [];
    allOrdersCache = ordersRes.data || [];
    renderAdmin();
  } catch (e) {
    console.error('loadAdminData', e);
    showToast('Failed to load admin data', 'error');
  }
}

function renderAdmin() {
  // KPIs
  const now = new Date();
  const curKey = monthKey(now);
  let monthCount = 0, totalValue = 0;
  const byMonth = {};
  const byUser = {};
  allOrdersCache.forEach(o => {
    const k = monthKey(o.created_at);
    byMonth[k] = byMonth[k] || { count: 0, total: 0 };
    byMonth[k].count += 1;
    byMonth[k].total += Number(o.grand_total || 0);
    totalValue += Number(o.grand_total || 0);
    if (k === curKey) monthCount += 1;
    byUser[o.user_name] = byUser[o.user_name] || { count: 0, total: 0 };
    byUser[o.user_name].count += 1;
    byUser[o.user_name].total += Number(o.grand_total || 0);
  });
  document.getElementById('adminKpiUsers').textContent = allUsersCache.length;
  document.getElementById('adminKpiPos').textContent = allOrdersCache.length;
  document.getElementById('adminKpiMonth').textContent = monthCount;
  document.getElementById('adminKpiValue').textContent = formatINR(totalValue);

  renderAdminChart(byMonth);
  renderAdminUsers(byUser);
  renderAdminPos();
}

function renderAdminChart(byMonth) {
  const canvas = document.getElementById('adminChart');
  if (!canvas || !window.Chart) return;
  const keys = lastNMonthKeys(12);
  const labels = keys.map(monthLabel);
  const counts = keys.map(k => byMonth[k] ? byMonth[k].count : 0);
  const values = keys.map(k => byMonth[k] ? byMonth[k].total : 0);
  if (adminChartInstance) adminChartInstance.destroy();
  adminChartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'PO Count',
          data: counts,
          backgroundColor: 'rgba(192,57,43,0.75)',
          borderColor: 'rgba(192,57,43,1)',
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'y',
        },
        {
          type: 'line',
          label: 'Total Value (₹)',
          data: values,
          borderColor: '#1f8a4e',
          backgroundColor: 'rgba(31,138,78,0.15)',
          tension: 0.3,
          fill: true,
          yAxisID: 'y1',
          pointRadius: 3,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { font: { size: 12 } } }
      },
      scales: {
        x: { grid: { display: false } },
        y:  { beginAtZero: true, position: 'left',  title: { display: true, text: 'POs' } },
        y1: { beginAtZero: true, position: 'right', title: { display: true, text: '₹' },
              grid: { drawOnChartArea: false },
              ticks: { callback: (v) => formatINR(v) } }
      }
    }
  });
}

function renderAdminUsers(byUser) {
  const search = (document.getElementById('adminUserSearch').value || '').toLowerCase().trim();
  const filtered = allUsersCache.filter(u => {
    if (!search) return true;
    return (u.display_name || '').toLowerCase().includes(search) || (u.name || '').toLowerCase().includes(search);
  });
  const wrap = document.getElementById('adminUsersList');
  if (filtered.length === 0) {
    wrap.innerHTML = '<div class="admin-empty">No users</div>';
    return;
  }
  wrap.innerHTML = `
    <table class="admin-table">
      <thead><tr><th>Name</th><th>POs</th><th>Value (₹)</th><th>Last Login</th></tr></thead>
      <tbody>
        ${filtered.map(u => {
          const b = byUser[u.name] || { count: 0, total: 0 };
          const last = u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('en-IN') : '—';
          return `
            <tr>
              <td>${escapeHtml(u.display_name || u.name)}</td>
              <td>${b.count}</td>
              <td class="amount">${formatINR(b.total)}</td>
              <td>${last}</td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

function renderAdminPos() {
  const search = (document.getElementById('adminPoSearch').value || '').toLowerCase().trim();
  const filtered = allOrdersCache.filter(o => {
    if (!search) return true;
    return (
      (o.po_number || '').toLowerCase().includes(search) ||
      (o.user_name || '').toLowerCase().includes(search) ||
      (o.supplier_name || '').toLowerCase().includes(search)
    );
  });
  const wrap = document.getElementById('adminPosList');
  if (filtered.length === 0) {
    wrap.innerHTML = '<div class="admin-empty">No purchase orders</div>';
    return;
  }
  wrap.innerHTML = `
    <table class="admin-table">
      <thead><tr><th>PO #</th><th>User</th><th>Supplier</th><th>Date</th><th>Total (₹)</th></tr></thead>
      <tbody>
        ${filtered.map(o => `
          <tr class="clickable" data-id="${o.id}">
            <td>${escapeHtml(o.po_number || '—')}</td>
            <td>${escapeHtml(o.user_name || '—')}</td>
            <td>${escapeHtml(o.supplier_name || '—')}</td>
            <td>${escapeHtml(o.po_date || '—')}</td>
            <td class="amount">${formatINR(o.grand_total || 0)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  wrap.querySelectorAll('tr.clickable').forEach(tr => {
    tr.addEventListener('click', () => showPoDetail(tr.dataset.id));
  });
}

function showPoDetail(id) {
  const o = allOrdersCache.find(x => String(x.id) === String(id));
  if (!o) return;
  document.getElementById('poDetailTitle').textContent = o.po_number || 'PO Details';
  const itemsHtml = (o.items || []).map(it => `
    <tr>
      <td>${escapeHtml(it.desc || '')}</td>
      <td>${escapeHtml(it.qty || '')}</td>
      <td>${escapeHtml(it.price || '')}</td>
      <td>${escapeHtml(it.gst || '')}%</td>
      <td>${escapeHtml(it.total || '')}</td>
    </tr>
  `).join('');
  document.getElementById('poDetailBody').innerHTML = `
    <div class="kv-grid">
      <div>User</div><div>${escapeHtml(o.user_name || '—')}</div>
      <div>Date</div><div>${escapeHtml(o.po_date || '—')}</div>
      <div>Supplier</div><div>${escapeHtml(o.supplier_name || '—')}</div>
      <div>Supplier Address</div><div>${escapeHtml(o.supplier_address || '—').replace(/\n/g, '<br>')}</div>
      <div>Supplier GSTIN</div><div>${escapeHtml(o.supplier_gstin || '—')}</div>
      <div>Shipping</div><div>${escapeHtml(o.shipping_address || '—').replace(/\n/g, '<br>')}</div>
      <div>Subtotal</div><div>₹${formatINR(o.subtotal || 0)}</div>
      <div>GST</div><div>₹${formatINR(o.gst_total || 0)}</div>
      <div>Grand Total</div><div><strong>₹${formatINR(o.grand_total || 0)}</strong></div>
      <div>Remarks</div><div>${escapeHtml(o.remarks || '—')}</div>
    </div>
    <table>
      <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>GST</th><th>Total</th></tr></thead>
      <tbody>${itemsHtml || '<tr><td colspan="5">No items</td></tr>'}</tbody>
    </table>
  `;
  document.getElementById('poDetailModal').classList.remove('hidden');
}

document.getElementById('btnClosePoDetail').addEventListener('click', () => {
  document.getElementById('poDetailModal').classList.add('hidden');
});

document.getElementById('adminUserSearch').addEventListener('input', () => {
  // recompute byUser on current cache
  const byUser = {};
  allOrdersCache.forEach(o => {
    byUser[o.user_name] = byUser[o.user_name] || { count: 0, total: 0 };
    byUser[o.user_name].count += 1;
    byUser[o.user_name].total += Number(o.grand_total || 0);
  });
  renderAdminUsers(byUser);
});
document.getElementById('adminPoSearch').addEventListener('input', renderAdminPos);

// ============================================================
// Admin settings modal
// ============================================================
document.getElementById('btnAdminSettings').addEventListener('click', () => {
  document.getElementById('settingsCurrentPw').value = '';
  document.getElementById('settingsNewPw').value = '';
  document.getElementById('settingsConfirmPw').value = '';
  document.getElementById('settingsError').textContent = '';
  document.getElementById('settingsModal').classList.remove('hidden');
});
document.getElementById('btnCloseSettings').addEventListener('click', () => {
  document.getElementById('settingsModal').classList.add('hidden');
});
document.getElementById('btnSaveSettings').addEventListener('click', async () => {
  const cur = document.getElementById('settingsCurrentPw').value;
  const nw = document.getElementById('settingsNewPw').value;
  const cf = document.getElementById('settingsConfirmPw').value;
  const err = document.getElementById('settingsError');
  err.textContent = '';
  const expected = await getAdminPassword();
  if (cur !== expected) { err.textContent = 'Current password is incorrect'; return; }
  if (!nw || nw.length < 4) { err.textContent = 'New password must be at least 4 characters'; return; }
  if (nw !== cf) { err.textContent = 'Passwords do not match'; return; }
  try {
    await setAdminPassword(nw);
    document.getElementById('settingsModal').classList.add('hidden');
    showToast('Admin password updated', 'success');
  } catch (e) {
    err.textContent = 'Failed to update: ' + (e.message || 'error');
  }
});

// ============================================================
// History search
// ============================================================
document.getElementById('historySearch').addEventListener('input', renderSidebar);

// Sidebar toggle (mobile)
document.getElementById('btnSidebarToggle').addEventListener('click', () => {
  document.getElementById('appShell').classList.toggle('show-sidebar');
});

// ============================================================
// Toolbar handlers
// ============================================================
document.getElementById('btnBack').addEventListener('click', async () => {
  await flushAutosave();
  showDocsView();
});
document.getElementById('docsSearch').addEventListener('input', renderDocsGrid);
document.getElementById('btnNew').addEventListener('click', newPO);
document.getElementById('btnPrint').addEventListener('click', () => {
  prepareForPrint();
  window.print();
  setTimeout(cleanupAfterPrint, 500);
});
document.getElementById('btnAddRow').addEventListener('click', () => addItemRow());
document.getElementById('btnCloseModal').addEventListener('click', () => {
  document.getElementById('savedModal').classList.add('hidden');
});
document.getElementById('savedModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('savedModal')) {
    document.getElementById('savedModal').classList.add('hidden');
  }
});

// ============================================================
// Date picker
// ============================================================
(function initDatePicker() {
  const display = document.getElementById('poDateDisplay');
  const picker = document.getElementById('poDatePicker');
  if (!display || !picker) return;
  function toISO(ddmmyyyy) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmmyyyy || '');
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
  }
  display.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    picker.value = toISO(display.textContent.trim()) || toISO(formatDate(new Date()));
    if (typeof picker.showPicker === 'function') picker.showPicker();
    else picker.focus();
  });
  picker.addEventListener('change', () => {
    if (!picker.value) return;
    const [y, m, d] = picker.value.split('-');
    display.textContent = `${d}/${m}/${y}`;
  });
})();

// ============================================================
// Click-to-edit fields
// ============================================================
function addResetButton(el, onReset) {
  const wrap = document.createElement('span');
  wrap.className = 'editable-wrap';
  el.parentNode.insertBefore(wrap, el);
  wrap.appendChild(el);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'editable-reset no-print';
  btn.title = 'Reset to default';
  btn.textContent = '↺';
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', (e) => {
    e.stopPropagation(); e.preventDefault();
    onReset();
  });
  wrap.appendChild(btn);
}

(function initEditables() {
  document.querySelectorAll('.editable').forEach((el) => {
    const key = el.dataset.key;
    const def = el.dataset.default || el.textContent;
    const sessionOnly = el.dataset.sessionOnly === '1';
    const isPicker = !!el.dataset.picker;
    if (key && !sessionOnly && localStorage.getItem(key)) {
      el.textContent = localStorage.getItem(key);
    }
    if (key && !sessionOnly) {
      addResetButton(el, () => {
        localStorage.removeItem(key);
        el.textContent = def;
      });
    }
    if (isPicker) return;
    let previous = '';
    el.addEventListener('click', () => {
      if (el.isContentEditable) return;
      previous = el.textContent;
      el.contentEditable = 'true';
      el.focus();
    });
    function commit() {
      const val = el.textContent.trim() || def || previous;
      el.textContent = val;
      el.contentEditable = 'false';
      if (key && !sessionOnly) localStorage.setItem(key, val);
    }
    el.addEventListener('blur', commit);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        el.textContent = previous;
        el.contentEditable = 'false';
        el.blur();
      }
    });
  });
})();

// ============================================================
// PDF export
// ============================================================
function savePDF() {
  const poNum = (document.getElementById('poNumDisplay').textContent || 'PO').trim();
  const originalTitle = document.title;
  document.title = poNum;
  prepareForPrint();
  showToast('In the print dialog, choose "Save as PDF"', 'success');
  const cleanup = () => {
    cleanupAfterPrint();
    document.title = originalTitle;
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 50);
}
document.getElementById('btnPdf').addEventListener('click', savePDF);

// ============================================================
// Ctrl/Cmd+S shortcut
// ============================================================
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (currentUser) savePO();
  }
});

// ============================================================
// GSTIN: force uppercase, strip spaces
// ============================================================
(function initGstin() {
  const el = document.getElementById('supplierGstin');
  if (!el) return;
  el.addEventListener('input', () => {
    const pos = el.selectionStart;
    const cleaned = el.value.toUpperCase().replace(/\s+/g, '');
    if (cleaned !== el.value) {
      el.value = cleaned;
      try { el.setSelectionRange(pos, pos); } catch (_) {}
    }
  });
})();

// ============================================================
// Form-change listeners for autosave
// ============================================================
(function initAutosaveListeners() {
  const editor = document.getElementById('editorView');
  if (!editor) return;
  // Fires for every user keystroke on inputs/textareas and contentEditable spans.
  editor.addEventListener('input', (e) => {
    if (!e.target.closest('#toolbarNone') && (e.target.matches('input, textarea, select') || e.target.isContentEditable)) {
      scheduleAutosave();
    }
  }, true);
  editor.addEventListener('change', (e) => {
    if (e.target.matches('select')) scheduleAutosave();
  }, true);
  // Best-effort flush when leaving the page.
  window.addEventListener('beforeunload', () => {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
      // fire-and-forget; navigator.sendBeacon would be ideal but we can't
      // easily reach Supabase REST without CORS complications.
      savePO({ auto: true });
    }
  });
})();

// ============================================================
// Boot
// ============================================================
(async function boot() {
  addItemRow();          // placeholder row so recalc doesn't choke
  recalculate();

  // Resume admin session
  if (localStorage.getItem(LS_ADMIN_SESSION) === '1') {
    await enterAdmin();
    return;
  }
  // Resume user session
  const savedUser = localStorage.getItem(LS_USER);
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      await enterApp();
      return;
    } catch (_) {}
  }
  // No session: show login
  showLogin();
})();

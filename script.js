// === Auto Date & PO Number ===
function formatDate(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function generatePONumber() {
  const saved = JSON.parse(localStorage.getItem('purchaseOrders') || '[]');
  const num = saved.length + 1;
  const year = new Date().getFullYear();
  return `PO-${year}-${String(num).padStart(4, '0')}`;
}

function setAutoFields() {
  const dateEl = document.getElementById('poDateDisplay');
  const numEl = document.getElementById('poNumDisplay');
  const savedDate = localStorage.getItem('poDate');
  const savedNum = localStorage.getItem('poNum');
  dateEl.textContent = savedDate || formatDate(new Date());
  numEl.textContent = savedNum || generatePONumber();
}

// === Number to Words (Indian System) ===
function numberToWords(num) {
  if (num === 0) return 'Zero rupees only';

  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function twoDigits(n) {
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  }

  function threeDigits(n) {
    if (n >= 100) {
      return ones[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + twoDigits(n % 100) : '');
    }
    return twoDigits(n);
  }

  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);

  let result = '';
  let rem = rupees;

  if (rem >= 10000000) {
    result += threeDigits(Math.floor(rem / 10000000)) + ' crore ';
    rem = rem % 10000000;
  }
  if (rem >= 100000) {
    result += twoDigits(Math.floor(rem / 100000)) + ' lakh ';
    rem = rem % 100000;
  }
  if (rem >= 1000) {
    result += twoDigits(Math.floor(rem / 1000)) + ' thousand ';
    rem = rem % 1000;
  }
  if (rem > 0) {
    result += threeDigits(rem);
  }

  result = result.trim();
  result = result.charAt(0).toUpperCase() + result.slice(1);

  result += ' rupees';
  if (paise > 0) {
    result += ' and ' + twoDigits(paise).toLowerCase() + ' paise';
  }
  result += ' only';
  return result;
}

// === Indian number format ===
function formatINR(num) {
  const parts = num.toFixed(2).split('.');
  let intPart = parts[0];
  const decPart = parts[1];

  let result = '';
  const len = intPart.length;
  if (len <= 3) {
    result = intPart;
  } else {
    result = intPart.substring(len - 3);
    intPart = intPart.substring(0, len - 3);
    while (intPart.length > 2) {
      result = intPart.substring(intPart.length - 2) + ',' + result;
      intPart = intPart.substring(0, intPart.length - 2);
    }
    result = intPart + ',' + result;
  }
  return result + '.' + decPart;
}

// === Item Rows (with per-item GST) ===
function addItemRow(desc = '', qty = '', price = '', gst = '18') {
  const tbody = document.getElementById('itemsBody');
  const tr = document.createElement('tr');
  tr.className = 'item-row';
  tr.innerHTML = `
    <td class="desc-cell"><input type="text" class="item-desc" value="${desc}" placeholder="Item description" /></td>
    <td class="qty-cell"><input type="number" class="item-qty" value="${qty}" min="0" placeholder="0" /></td>
    <td class="price-cell"><input type="number" class="item-price" value="${price}" min="0" step="0.01" placeholder="0.00" /></td>
    <td class="gst-select-cell">
      <select class="item-gst">
        <option value="5" ${gst === '5' ? 'selected' : ''}>5%</option>
        <option value="18" ${gst === '18' || !gst ? 'selected' : ''}>18%</option>
      </select>
    </td>
    <td class="gst-amt-cell">0.00</td>
    <td class="row-total-cell">0.00</td>
    <td class="action-cell no-print"><button class="btn-remove" onclick="removeRow(this)">&times;</button></td>
  `;
  tbody.appendChild(tr);
  tr.querySelector('.item-qty').addEventListener('input', recalculate);
  tr.querySelector('.item-price').addEventListener('input', recalculate);
  tr.querySelector('.item-gst').addEventListener('change', recalculate);
  recalculate();
}

function removeRow(btn) {
  btn.closest('tr').remove();
  recalculate();
}

function recalculate() {
  let subtotal = 0;
  let totalGst = 0;

  document.querySelectorAll('#itemsBody .item-row').forEach(row => {
    const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
    const price = parseFloat(row.querySelector('.item-price').value) || 0;
    const gstPercent = parseFloat(row.querySelector('.item-gst').value) || 0;

    const lineTotal = qty * price;
    const lineGst = lineTotal * gstPercent / 100;
    const lineGrand = lineTotal + lineGst;

    row.querySelector('.gst-amt-cell').textContent = formatINR(lineGst);
    row.querySelector('.row-total-cell').textContent = formatINR(lineGrand);

    subtotal += lineTotal;
    totalGst += lineGst;
  });

  const grandTotal = subtotal + totalGst;

  document.getElementById('subtotal').textContent = formatINR(subtotal);
  document.getElementById('totalGst').textContent = formatINR(totalGst);
  document.getElementById('grandTotal').textContent = formatINR(grandTotal);
  document.getElementById('amountWords').textContent = numberToWords(grandTotal);
}

// === Print: add empty rows ===
function prepareForPrint() {
  document.querySelectorAll('#itemsBody .empty-row').forEach(r => r.remove());

  const itemCount = document.querySelectorAll('#itemsBody .item-row').length;
  const emptyNeeded = Math.max(4 - itemCount, 0);

  const tbody = document.getElementById('itemsBody');
  for (let i = 0; i < emptyNeeded; i++) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td>';
    tbody.appendChild(tr);
  }
}

function cleanupAfterPrint() {
  document.querySelectorAll('#itemsBody .empty-row').forEach(r => r.remove());
}

// === Local Storage ===
function getFormData() {
  const items = [];
  document.querySelectorAll('#itemsBody .item-row').forEach(row => {
    items.push({
      desc: row.querySelector('.item-desc').value,
      qty: row.querySelector('.item-qty').value,
      price: row.querySelector('.item-price').value,
      gst: row.querySelector('.item-gst').value,
    });
  });

  return {
    poDate: document.getElementById('poDateDisplay').textContent,
    poNumber: document.getElementById('poNumDisplay').textContent,
    supplierName: document.getElementById('supplierName').value,
    supplierAddress: document.getElementById('supplierAddress').value,
    supplierGstin: document.getElementById('supplierGstin').value,
    remarks: document.getElementById('remarks').value,
    items,
    savedAt: new Date().toISOString(),
  };
}

function loadFormData(data) {
  document.getElementById('poDateDisplay').textContent = data.poDate || '';
  document.getElementById('poNumDisplay').textContent = data.poNumber || '';
  document.getElementById('supplierName').value = data.supplierName || '';
  document.getElementById('supplierAddress').value = data.supplierAddress || '';
  document.getElementById('supplierGstin').value = data.supplierGstin || '';
  document.getElementById('remarks').value = data.remarks || '';

  document.getElementById('itemsBody').innerHTML = '';
  if (data.items && data.items.length > 0) {
    data.items.forEach(item => addItemRow(item.desc, item.qty, item.price, item.gst || '18'));
  } else {
    addItemRow();
  }
  recalculate();
}

function savePO() {
  const data = getFormData();
  if (!data.supplierName && !data.items.some(i => i.desc)) {
    showToast('Please fill in some details before saving');
    return;
  }
  const saved = JSON.parse(localStorage.getItem('purchaseOrders') || '[]');
  saved.push(data);
  localStorage.setItem('purchaseOrders', JSON.stringify(saved));
  showToast('Purchase Order saved!');
}

function showSavedList() {
  const saved = JSON.parse(localStorage.getItem('purchaseOrders') || '[]');
  const list = document.getElementById('savedList');

  if (saved.length === 0) {
    list.innerHTML = '<p class="no-saved">No saved purchase orders yet.</p>';
  } else {
    list.innerHTML = saved.map((po, i) => `
      <div class="saved-item">
        <div class="saved-item-info">
          <strong>${po.poNumber || 'No PO#'} - ${po.supplierName || 'No Supplier'}</strong>
          <small>${po.poDate || ''} | Saved: ${new Date(po.savedAt).toLocaleString()}</small>
        </div>
        <div class="saved-item-actions">
          <button class="btn-load-item" onclick="loadSavedPO(${i})">Load</button>
          <button class="btn-delete-item" onclick="deleteSavedPO(${i})">Delete</button>
        </div>
      </div>
    `).join('');
  }
  document.getElementById('savedModal').classList.remove('hidden');
}

function loadSavedPO(index) {
  const saved = JSON.parse(localStorage.getItem('purchaseOrders') || '[]');
  if (saved[index]) {
    loadFormData(saved[index]);
    document.getElementById('savedModal').classList.add('hidden');
    showToast('Purchase Order loaded!');
  }
}

function deleteSavedPO(index) {
  const saved = JSON.parse(localStorage.getItem('purchaseOrders') || '[]');
  saved.splice(index, 1);
  localStorage.setItem('purchaseOrders', JSON.stringify(saved));
  showSavedList();
  showToast('Purchase Order deleted');
}

function clearAllPOs() {
  if (confirm('Are you sure you want to delete all saved purchase orders?')) {
    localStorage.removeItem('purchaseOrders');
    showToast('All saved purchase orders cleared');
  }
}

function newPO() {
  document.getElementById('supplierName').value = '';
  document.getElementById('supplierAddress').value = '';
  document.getElementById('supplierGstin').value = '';
  document.getElementById('remarks').value = '';
  document.getElementById('itemsBody').innerHTML = '';
  setAutoFields();
  addItemRow();
  recalculate();
}

// === Toast ===
function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// === Event Listeners ===
document.getElementById('btnNew').addEventListener('click', newPO);
document.getElementById('btnSave').addEventListener('click', savePO);
document.getElementById('btnPrint').addEventListener('click', () => {
  prepareForPrint();
  window.print();
  setTimeout(cleanupAfterPrint, 500);
});
document.getElementById('btnLoad').addEventListener('click', showSavedList);
document.getElementById('btnClear').addEventListener('click', clearAllPOs);
document.getElementById('btnAddRow').addEventListener('click', () => addItemRow());
document.getElementById('btnCloseModal').addEventListener('click', () => {
  document.getElementById('savedModal').classList.add('hidden');
});
document.getElementById('savedModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('savedModal')) {
    document.getElementById('savedModal').classList.add('hidden');
  }
});

// === Date picker for PO Date ===
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
    const formatted = `${d}/${m}/${y}`;
    display.textContent = formatted;
    localStorage.setItem('poDate', formatted);
  });
})();

// === Click-to-edit fields ===
(function initEditables() {
  document.querySelectorAll('.editable').forEach((el) => {
    if (el.dataset.picker) return;
    const key = el.dataset.key;
    const def = el.dataset.default || el.textContent;

    if (key && localStorage.getItem(key)) {
      el.textContent = localStorage.getItem(key);
    }

    let previous = '';
    el.addEventListener('click', () => {
      if (el.isContentEditable) return;
      previous = el.textContent;
      el.contentEditable = 'true';
      el.textContent = '';
      el.focus();
    });

    function commit() {
      const val = el.textContent.trim() || def || previous;
      el.textContent = val;
      el.contentEditable = 'false';
      if (key) localStorage.setItem(key, val);
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

// === Init ===
setAutoFields();
addItemRow();

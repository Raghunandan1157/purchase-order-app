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
  document.getElementById('poDate').value = formatDate(new Date());
  document.getElementById('poNumber').value = generatePONumber();
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
      return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + twoDigits(n % 100) : '');
    }
    return twoDigits(n);
  }

  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);

  let words = '';
  if (rupees >= 10000000) {
    words += threeDigits(Math.floor(rupees / 10000000)) + ' Crore ';
    num = rupees % 10000000;
  } else {
    num = rupees;
  }
  if (num >= 100000) {
    words += twoDigits(Math.floor(num / 100000)) + ' Lakh ';
    num = num % 100000;
  }
  if (num >= 1000) {
    words += twoDigits(Math.floor(num / 1000)) + ' Thousand ';
    num = num % 1000;
  }
  if (num > 0) {
    words += threeDigits(num);
  }

  words = words.trim() + ' Rupees';
  if (paise > 0) {
    words += ' and ' + twoDigits(paise) + ' Paise';
  }
  words += ' Only';
  return words;
}

// === Item Rows ===
let rowCount = 0;

function addItemRow(desc = '', qty = '', price = '') {
  rowCount++;
  const tbody = document.getElementById('itemsBody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="col-sno">${rowCount}</td>
    <td><input type="text" class="item-desc" value="${desc}" placeholder="Item description" /></td>
    <td><input type="number" class="item-qty" value="${qty}" min="0" placeholder="0" /></td>
    <td><input type="number" class="item-price" value="${price}" min="0" step="0.01" placeholder="0.00" /></td>
    <td class="row-total">0.00</td>
    <td class="no-print" style="text-align:center"><button class="btn-remove" onclick="removeRow(this)">&times;</button></td>
  `;
  tbody.appendChild(tr);

  tr.querySelector('.item-qty').addEventListener('input', recalculate);
  tr.querySelector('.item-price').addEventListener('input', recalculate);
  recalculate();
}

function removeRow(btn) {
  btn.closest('tr').remove();
  renumberRows();
  recalculate();
}

function renumberRows() {
  const rows = document.querySelectorAll('#itemsBody tr');
  rowCount = rows.length;
  rows.forEach((row, i) => {
    row.querySelector('.col-sno').textContent = i + 1;
  });
}

function recalculate() {
  let subtotal = 0;
  document.querySelectorAll('#itemsBody tr').forEach(row => {
    const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
    const price = parseFloat(row.querySelector('.item-price').value) || 0;
    const total = qty * price;
    row.querySelector('.row-total').textContent = total.toFixed(2);
    subtotal += total;
  });

  const gstRate = parseFloat(document.getElementById('gstRate').value) || 0;
  const gstAmount = subtotal * gstRate / 100;
  const grandTotal = subtotal + gstAmount;

  document.getElementById('subtotal').textContent = subtotal.toFixed(2);
  document.getElementById('gstAmount').textContent = gstAmount.toFixed(2);
  document.getElementById('grandTotal').textContent = grandTotal.toFixed(2);
  document.getElementById('amountWords').value = numberToWords(grandTotal);
}

// === Local Storage ===
function getFormData() {
  const items = [];
  document.querySelectorAll('#itemsBody tr').forEach(row => {
    items.push({
      desc: row.querySelector('.item-desc').value,
      qty: row.querySelector('.item-qty').value,
      price: row.querySelector('.item-price').value,
    });
  });

  return {
    poDate: document.getElementById('poDate').value,
    poNumber: document.getElementById('poNumber').value,
    supplierName: document.getElementById('supplierName').value,
    supplierAddress: document.getElementById('supplierAddress').value,
    supplierGstin: document.getElementById('supplierGstin').value,
    gstRate: document.getElementById('gstRate').value,
    remarks: document.getElementById('remarks').value,
    items,
    savedAt: new Date().toISOString(),
  };
}

function loadFormData(data) {
  document.getElementById('poDate').value = data.poDate || '';
  document.getElementById('poNumber').value = data.poNumber || '';
  document.getElementById('supplierName').value = data.supplierName || '';
  document.getElementById('supplierAddress').value = data.supplierAddress || '';
  document.getElementById('supplierGstin').value = data.supplierGstin || '';
  document.getElementById('gstRate').value = data.gstRate || '18';
  document.getElementById('remarks').value = data.remarks || '';

  document.getElementById('itemsBody').innerHTML = '';
  rowCount = 0;
  if (data.items && data.items.length > 0) {
    data.items.forEach(item => addItemRow(item.desc, item.qty, item.price));
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
  document.getElementById('gstRate').value = '18';
  document.getElementById('itemsBody').innerHTML = '';
  rowCount = 0;
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
document.getElementById('btnPrint').addEventListener('click', () => window.print());
document.getElementById('btnLoad').addEventListener('click', showSavedList);
document.getElementById('btnClear').addEventListener('click', clearAllPOs);
document.getElementById('btnAddRow').addEventListener('click', () => addItemRow());
document.getElementById('btnCloseModal').addEventListener('click', () => {
  document.getElementById('savedModal').classList.add('hidden');
});
document.getElementById('gstRate').addEventListener('input', recalculate);

// Close modal on outside click
document.getElementById('savedModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('savedModal')) {
    document.getElementById('savedModal').classList.add('hidden');
  }
});

// === Init ===
setAutoFields();
addItemRow();

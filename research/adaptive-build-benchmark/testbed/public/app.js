let currentStatus = 'ALL';
let currentQuery = '';
let allItems = [];

const rowsEl = document.getElementById('expenseRows');
const kpiApprovedEl = document.getElementById('kpiApproved');
const kpiPendingEl = document.getElementById('kpiPending');
const kpiCountEl = document.getElementById('kpiCount');
const searchInput = document.getElementById('searchInput');
const modalOverlay = document.getElementById('modalOverlay');
const expenseForm = document.getElementById('expenseForm');

async function fetchExpenses() {
  const params = new URLSearchParams();
  if (currentStatus !== 'ALL') params.set('status', currentStatus);
  if (currentQuery) params.set('q', currentQuery);

  const res = await fetch(`/api/expenses?${params.toString()}`);
  const data = await res.json();
  allItems = data.items || [];
  render(allItems);
}

function render(items) {
  let approvedSum = 0;
  let pendingSum = 0;

  for (const item of items) {
    if (item.status !== 'PENDING_L2_APPROVAL') {
      approvedSum += item.amount;
    } else {
      pendingSum += item.amount;
    }
  }

  kpiApprovedEl.textContent = `$${approvedSum}`;
  kpiPendingEl.textContent = `$${pendingSum}`;
  kpiCountEl.textContent = String(items.length);

  rowsEl.innerHTML = items
    .map((item) => {
      const cls =
        item.status === 'APPROVED'
          ? 'approved'
          : item.status === 'REJECTED'
          ? 'rejected'
          : '';
      return `
        <tr>
          <td>${item.id}</td>
          <td>${item.title}</td>
          <td>${item.category}</td>
          <td>${item.requester}</td>
          <td>${item.createdAt}</td>
          <td><span class="status-pill ${cls}">${item.status}</span></td>
          <td>$${item.amount}</td>
          <td>
            <div class="row-actions">
              ${
                item.status === 'PENDING_L2_APPROVAL'
                  ? `<button class="row-btn" data-approve="${item.id}">Approve</button>`
                  : ''
              }
              <button class="row-btn danger" data-delete="${item.id}">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    currentStatus = btn.dataset.status;
    fetchExpenses();
  });
});

searchInput.addEventListener('input', (e) => {
  currentQuery = e.target.value.trim();
  fetchExpenses();
});

document.getElementById('resetBtn').addEventListener('click', () => {
  currentStatus = 'ALL';
  currentQuery = '';
  searchInput.value = '';
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.status === 'ALL'));
  fetchExpenses();
});

document.getElementById('exportBtn').addEventListener('click', () => {
  const csv = ['id,title,category,requester,status,amount']
    .concat(allItems.map((i) => `${i.id},${i.title},${i.category},${i.requester},${i.status},${i.amount}`))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'expenses.csv';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('newExpenseBtn').addEventListener('click', () => {
  modalOverlay.classList.remove('hidden');
});

document.getElementById('cancelModalBtn').addEventListener('click', () => {
  modalOverlay.classList.add('hidden');
});

expenseForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(expenseForm);
  const payload = {
    title: fd.get('title'),
    requesterName: fd.get('requesterName'),
    category: fd.get('category'),
    amount: Number(fd.get('amount')),
  };
  await fetch('/api/expenses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  modalOverlay.classList.add('hidden');
  expenseForm.reset();
  fetchExpenses();
});

rowsEl.addEventListener('click', async (e) => {
  const approveId = e.target.dataset.approve;
  const deleteId = e.target.dataset.delete;
  if (approveId) {
    await fetch(`/api/expenses/${approveId}/approve`, { method: 'PATCH' });
    fetchExpenses();
  }
  if (deleteId) {
    await fetch(`/api/expenses/${deleteId}`, { method: 'DELETE' });
    fetchExpenses();
  }
});

fetchExpenses();

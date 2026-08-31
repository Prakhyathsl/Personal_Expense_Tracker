const $ = id => document.getElementById(id);
const money = v => '₹' + Number(v || 0).toLocaleString('en-IN', {minimumFractionDigits: 0, maximumFractionDigits: 2});

let pendingRequests = 0;
let dataRevision = 0;
let loadingTimer = null;

function setLoading(show, message = 'Loading your data…') {
    const overlay = $('loadingOverlay');
    if (!overlay) return;
    if (show) {
        overlay.querySelector('.loading-text').textContent = message;
        overlay.classList.add('visible');
    } else if (pendingRequests === 0) {
        overlay.classList.remove('visible');
    }
}

function beginLoading(message) {
    pendingRequests += 1;
    clearTimeout(loadingTimer);
    setLoading(true, message);
}

function endLoading() {
    pendingRequests = Math.max(0, pendingRequests - 1);
    if (pendingRequests === 0) {
        loadingTimer = setTimeout(() => setLoading(false), 120);
    }
}

async function api(url, opts = {}, loadingMessage) {
    const method = (opts.method || 'GET').toUpperCase();
    beginLoading(loadingMessage || (method === 'GET' ? 'Loading your data…' : 'Saving your changes…'));
    try {
        const r = await fetch(url, {
            headers: {'Content-Type': 'application/json', ...(opts.headers || {})},
            cache: 'no-store',
            ...opts
        });
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(d?.error || 'Request failed');
        return d;
    } finally {
        endLoading();
    }
}

function toast(t, ok = false) {
    const e = $('toast');
    e.textContent = t;
    e.className = ok ? 'show ok' : 'show';
    setTimeout(() => e.className = '', 2500);
}

const pages = ['dashboard', 'expenses', 'add', 'categories', 'academic', 'savings', 'backup', 'settings'];

async function showPage(name) {
    pages.forEach(p => $('page-' + p).classList.toggle('active', p === name));
    document.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === name));
    $('pageTitle').textContent = name === 'academic' ? 'Academic Year & Semester' : name.replace(/\b\w/g, c => c.toUpperCase()).replace('Add', 'Add Expense');

    if (name === 'dashboard') await loadDashboard();
    if (name === 'expenses') await loadExpenses();
    if (name === 'categories') await loadCategories();
    if (name === 'academic') await loadAcademic();
    if (name === 'add') setSemesters();
    if (name === 'savings') await loadSavings();
    if (name === 'settings') await loadSettings();
}

document.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));

$('logout').onclick = async () => {
    try {
        await api('/api/auth/logout', {method: 'POST'}, 'Logging out…');
    } finally {
        location = '/login';
    }
};

function renderBars(el, data) {
    el.innerHTML = '';
    const vals = Object.entries(data || {});
    if (!vals.length) {
        el.innerHTML = '<div class="empty">No expenses yet</div>';
        return;
    }
    const max = Math.max(...vals.map(x => Number(x[1]) || 0), 1);
    vals.forEach(([k, v]) => el.insertAdjacentHTML('beforeend', `<div class="bar-row"><div><span>${escapeHtml(k)}</span><b>${money(v)}</b></div><div class="bar"><i style="width:${Math.max(4, Number(v) / max * 100)}%"></i></div></div>`));
}

function escapeHtml(s) {
    return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function renderDashboardStats(s) {
    $('totalSpending').textContent = money(s.total_spending);
    $('transactionCount').textContent = s.transaction_count;
    $('averageExpense').textContent = money(s.average_expense);
    $('highestExpense').textContent = money(s.highest_expense);
    $('monthlyAverage').textContent = money(s.monthly_average);
    renderBars($('categoryChart'), s.category_totals);
    renderBars($('paymentChart'), s.payment_totals);
    $('recentExpenses').innerHTML = table(s.recent_expenses, true);
}

async function loadDashboard(revision = dataRevision) {
    try {
        const s = await api('/api/stats');
        // Ignore an older GET response that completed after a mutation.
        if (revision !== dataRevision) return;
        renderDashboardStats(s);
    } catch (e) {
        toast(e.message);
    }
}

function table(items, recent = false) {
    if (!items?.length) return '<div class="empty"><div class="empty-icon">₹</div><strong>No expenses yet</strong><span>Add your first expense to see it here.</span></div>';
    return `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Amount</th><th>Payment</th><th>Description</th>${recent ? '' : '<th>Actions</th>'}</tr></thead><tbody>${items.map(x => `<tr><td>${escapeHtml(x.date)}</td><td><span class="tag">${escapeHtml(x.category)}</span></td><td><b>${money(x.amount)}</b></td><td>${escapeHtml(x.payment_method)}</td><td>${escapeHtml(x.description || '—')}</td>${recent ? '' : `<td><button class="text-btn" onclick="editExpense(${x.id})">Edit</button><button class="text-btn danger" onclick="deleteExpense(${x.id})">Delete</button></td>`}</tr>`).join('')}</tbody></table></div>`;
}

async function loadExpenses(revision = dataRevision) {
    try {
        const items = await api('/api/expenses');
        if (revision !== dataRevision) return;
        $('expenseTable').innerHTML = table(items);
    } catch (e) {
        toast(e.message);
    }
}

async function refreshExpenseViews() {
    const revision = ++dataRevision;
    // One stats request is enough for dashboard/category/academic data.
    // The expense list is fetched separately because it contains CRUD rows.
    try {
        const [stats, expenses] = await Promise.all([
            api('/api/stats', {}, 'Refreshing your expense data…'),
            api('/api/expenses', {}, 'Refreshing your expense list…')
        ]);
        if (revision !== dataRevision) return;
        renderDashboardStats(stats);
        $('expenseTable').innerHTML = table(expenses);
        renderCategoryTotals(stats);
        renderAcademicTotals(stats);
    } catch (e) {
        toast(e.message);
        throw e;
    }
}

function renderCategoryTotals(s) {
    const totals = s.category_totals || {};
    $('categoryList').innerHTML = window.APP_DATA.categories.map(x => `<div class="category-card"><div><span class="chip">${escapeHtml(x)}</span></div><strong>${money(totals[x] || 0)}</strong><small>Spent</small></div>`).join('');
}

function renderAcademicTotals(s) {
    const years = s.year_totals || {};
    const semesters = s.semester_totals || {};
    $('academicList').innerHTML = Object.entries(window.APP_DATA.year_semesters).map(([y, sem]) => `<div class="academic-card"><div class="academic-head"><strong>${escapeHtml(y)}</strong><b>${money(years[y] || 0)}</b></div><div class="academic-sems">${sem.map(x => `<span>${escapeHtml(x)} <b>${money(semesters[x] || 0)}</b></span>`).join('')}</div></div>`).join('');
}

$('expenseForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!e.target.reportValidity()) return;
    try {
        const d = {
            academic_year: $('academic_year').value,
            semester: $('semester').value,
            date: $('date').value,
            category: $('category').value,
            amount: $('amount').value,
            payment_method: $('payment_method').value,
            description: $('description').value
        };
        await api('/api/expenses', {method:'POST', body:JSON.stringify(d)}, 'Saving expense…');
        e.target.reset();
        setSemesters();
        await refreshExpenseViews();
        toast('Expense added successfully.', true);
        await showPage('dashboard');
    } catch (x) {
        toast(x.message);
    }
});

function setSemesters() {
    const arr = window.APP_DATA.year_semesters[$('academic_year').value] || [];
    $('semester').innerHTML = arr.map(x => `<option>${escapeHtml(x)}</option>`).join('');
}
$('academic_year').addEventListener('change', setSemesters);
setSemesters();

window.editExpense = async id => {
    try {
        const items = await api('/api/expenses', {}, 'Loading expense…');
        const x = items.find(i => i.id === id);
        if (!x) return toast('Expense not found.');
        const amount = prompt('Amount (₹)', x.amount);
        if (amount === null) return;
        const description = prompt('Description', x.description || '');
        if (description === null) return;
        const d = {...x, amount, description};
        await api('/api/expenses/' + id, {method:'PUT', body:JSON.stringify(d)}, 'Updating expense…');
        await refreshExpenseViews();
        toast('Expense updated.', true);
        await showPage('expenses');
    } catch (e) {
        toast(e.message);
    }
};

window.deleteExpense = async id => {
    if (!confirm('Delete this expense?')) return;
    try {
        await api('/api/expenses/' + id, {method:'DELETE'}, 'Deleting expense…');
        await refreshExpenseViews();
        toast('Expense deleted.', true);
        await showPage('expenses');
    } catch (e) {
        toast(e.message);
    }
};

$('goalForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!e.target.reportValidity()) return;
    try {
        await api('/api/savings/goals', {
            method:'POST',
            body:JSON.stringify({name:$('goalName').value,target_amount:$('targetAmount').value,target_date:$('targetDate').value,description:$('goalDescription').value})
        }, 'Saving your goal…');
        e.target.reset();
        await loadSavings();
        toast('Savings goal created.', true);
    } catch (x) {
        toast(x.message);
    }
});

async function loadSavings() {
    try {
        const d = await api('/api/savings');
        $('goals').innerHTML = d.goals.length ? d.goals.map(g => `<div class="goal"><div class="goal-head"><div><strong>${escapeHtml(g.name)}</strong><small>Target ${money(g.target_amount)} · ${g.target_date}</small></div><button class="text-btn danger" onclick="deleteGoal(${g.id})">Delete</button></div><div class="progress"><i style="width:${Math.min(100, Number(g.progress) || 0)}%"></i></div><div class="goal-meta"><span>${money(g.contributed)} saved</span><span>${g.progress}%</span></div><button class="btn secondary small" onclick="addSaving(${g.id},${g.remaining})">+ Add contribution</button></div>`).join('') : '<div class="empty">No savings goals yet.</div>';
        $('savingsHistory').innerHTML = d.history.length ? tableSavings(d.history) : '<div class="empty">No savings contributions yet.</div>';
    } catch (e) {
        toast(e.message);
    }
}

function tableSavings(a) {
    return `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Goal</th><th>Amount</th><th>Note</th><th></th></tr></thead><tbody>${a.map(x => `<tr><td>${escapeHtml(x.date)}</td><td>${escapeHtml(x.goal_id)}</td><td><b>${money(x.amount)}</b></td><td>${escapeHtml(x.note || '—')}</td><td><button class="text-btn danger" onclick="deleteSaving(${x.id})">Delete</button></td></tr>`).join('')}</tbody></table></div>`;
}

window.addSaving = async (gid, remaining) => {
    const amount = prompt(`Contribution amount (remaining ${money(remaining)})`);
    if (amount === null) return;
    const date = prompt('Date (DD-MM-YYYY)', new Date().toLocaleDateString('en-GB').replaceAll('/','-'));
    if (date === null) return;
    const note = prompt('Note', '');
    try {
        await api('/api/savings', {method:'POST', body:JSON.stringify({goal_id:gid,amount,date,note})}, 'Saving contribution…');
        await loadSavings();
        toast('Contribution added.', true);
    } catch (e) {
        toast(e.message);
    }
};

window.deleteSaving = async id => {
    if (!confirm('Delete contribution?')) return;
    try {
        await api('/api/savings/' + id, {method:'DELETE'}, 'Deleting contribution…');
        await loadSavings();
        toast('Contribution deleted.', true);
    } catch (e) {
        toast(e.message);
    }
};

window.deleteGoal = async id => {
    if (!confirm('Delete goal and its contributions?')) return;
    try {
        await api('/api/savings/goals/' + id, {method:'DELETE'}, 'Deleting savings goal…');
        await loadSavings();
        toast('Goal deleted.', true);
    } catch (e) {
        toast(e.message);
    }
};

async function loadCategories(revision = dataRevision) {
    try {
        const s = await api('/api/stats');
        if (revision !== dataRevision) return;
        renderCategoryTotals(s);
    } catch (e) {
        toast(e.message);
    }
}

async function loadAcademic(revision = dataRevision) {
    try {
        const s = await api('/api/stats');
        if (revision !== dataRevision) return;
        renderAcademicTotals(s);
    } catch (e) {
        toast(e.message);
    }
}

function formatDateInput(el) {
    if (!el) return;
    el.addEventListener('input', () => {
        const digits = el.value.replace(/\D/g,'').slice(0,8);
        let out = digits;
        if (digits.length > 4) out = digits.slice(0,2) + '-' + digits.slice(2,4) + '-' + digits.slice(4);
        else if (digits.length > 2) out = digits.slice(0,2) + '-' + digits.slice(2);
        el.value = out;
        el.setCustomValidity('');
    });
    el.addEventListener('blur', () => {
        if (el.value && !/^\d{2}-\d{2}-\d{4}$/.test(el.value)) el.setCustomValidity('Enter date as DD-MM-YYYY');
        else el.setCustomValidity('');
    });
}
formatDateInput($('date'));
formatDateInput($('targetDate'));

async function loadSettings() {
    try {
        const d = await api('/api/settings');
        $('version').textContent = d.version;
        $('settingsData').innerHTML = `<div class="setting"><span>Expense records</span><strong>${d.records.expenses}</strong></div><div class="setting"><span>Savings goals</span><strong>${d.records.savings_goals}</strong></div><div class="setting"><span>Savings contributions</span><strong>${d.records.savings_contributions}</strong></div><div class="setting"><span>Data location</span><strong class="path">${escapeHtml(d.storage.data_location)}</strong></div>`;
    } catch (e) {
        toast(e.message);
    }
}

$('themeToggle').onclick = () => {
    document.body.classList.toggle('dark');
    localStorage.theme = document.body.classList.contains('dark') ? 'dark' : 'light';
};
if (localStorage.theme === 'dark') document.body.classList.add('dark');

async function initializeApp() {
    setLoading(true, 'Loading your account…');
    try {
        const stats = await api('/api/stats', {}, 'Loading your account…');
        renderDashboardStats(stats);
        renderCategoryTotals(stats);
        renderAcademicTotals(stats);
    } catch (e) {
        toast(e.message);
    } finally {
        setLoading(false);
    }
}

initializeApp();

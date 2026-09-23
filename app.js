// ===== Frilans Timeklokke =====
// Alt lagres lokalt i nettleseren (localStorage). Ingen server nødvendig.

const STORAGE_KEY_PROJECTS = "freelance_projects";
const STORAGE_KEY_ENTRIES = "freelance_entries";
const STORAGE_KEY_EXPENSES = "freelance_expenses";
const STORAGE_KEY_TIMER = "freelance_active_timer";
const STORAGE_KEY_SYNC_QUEUE = "freelance_sync_queue";

let state = {
  projects: [],
  entries: [],
  expenses: [],
  activeTimer: null, // { projectId, startedAt (timestamp ms), notesLog: [{time, text}] }
};

let tickInterval = null;

// ---------- Supabase: klient, auth og synk ----------

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser = null;
let syncQueue = [];

function loadSyncQueue() {
  try {
    syncQueue = JSON.parse(localStorage.getItem(STORAGE_KEY_SYNC_QUEUE)) || [];
  } catch { syncQueue = []; }
}

function saveSyncQueue() {
  localStorage.setItem(STORAGE_KEY_SYNC_QUEUE, JSON.stringify(syncQueue));
}

function updateSyncStatus(status) {
  const el = document.getElementById("syncStatus");
  if (!el) return;
  if (status === "syncing") el.textContent = "Synkroniserer...";
  else if (status === "offline") el.textContent = "Frakoblet – bruker lokale data";
  else if (status === "pending") el.textContent = `${syncQueue.length} endring(er) venter på synk`;
  else el.textContent = "Synkronisert";
}

async function performSyncOp(op) {
  if (op.type === "insert") {
    const { error } = await sb.from(op.table).insert(op.payload);
    if (error) throw error;
  } else if (op.type === "update") {
    const { error } = await sb.from(op.table).update(op.payload).eq("id", op.id);
    if (error) throw error;
  } else if (op.type === "delete") {
    const { error } = await sb.from(op.table).delete().eq("id", op.id);
    if (error) throw error;
  }
}

function queueOp(op) {
  syncQueue.push(op);
  saveSyncQueue();
  updateSyncStatus("pending");
}

async function syncWrite(op) {
  if (!currentUser) return;
  try {
    await performSyncOp(op);
    if (syncQueue.length === 0) updateSyncStatus("synced");
  } catch (err) {
    console.warn("Synk feilet, lagres i kø for senere:", err);
    queueOp(op);
  }
}

async function processSyncQueue() {
  if (!currentUser || syncQueue.length === 0) return;
  updateSyncStatus("syncing");
  const remaining = [];
  for (const op of syncQueue) {
    try {
      await performSyncOp(op);
    } catch (err) {
      remaining.push(op);
    }
  }
  syncQueue = remaining;
  saveSyncQueue();
  updateSyncStatus(syncQueue.length ? "pending" : "synced");
}

window.addEventListener("online", processSyncQueue);
setInterval(processSyncQueue, 30000);

// ---------- Supabase <-> lokalt format ----------

function toDbProject(p) {
  return {
    id: p.id,
    user_id: currentUser.id,
    name: p.name,
    number: p.number || null,
    rate_type: p.rateType,
    rate: p.rate,
    day_hours: p.dayHours,
    overtime_enabled: p.overtimeEnabled,
    overtime_50_hours: p.overtime50Hours || null,
    overtime_100_hours: p.overtime100Hours || null,
    currency: p.currency,
  };
}

function fromDbProject(row) {
  return {
    id: row.id,
    name: row.name,
    number: row.number || "",
    rateType: row.rate_type,
    rate: Number(row.rate),
    dayHours: Number(row.day_hours) || 8,
    overtimeEnabled: !!row.overtime_enabled,
    overtime50Hours: row.overtime_50_hours ? Number(row.overtime_50_hours) : 0,
    overtime100Hours: row.overtime_100_hours ? Number(row.overtime_100_hours) : 0,
    currency: row.currency || "kr",
  };
}

function toDbEntry(e) {
  return {
    id: e.id,
    user_id: currentUser.id,
    project_id: e.projectId || null,
    project_number: e.projectNumber || null,
    date: e.date,
    start_time: e.startTime || null,
    end_time: e.endTime || null,
    minutes: e.minutes,
    notes: e.notes || null,
    source: e.source,
    invoiced: !!e.invoiced,
  };
}

function fromDbEntry(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    projectNumber: row.project_number || "",
    date: row.date,
    startTime: row.start_time || "",
    endTime: row.end_time || "",
    minutes: Number(row.minutes),
    notes: row.notes || "",
    source: row.source || "manual",
    invoiced: !!row.invoiced,
  };
}

function toDbExpense(e) {
  return {
    id: e.id,
    user_id: currentUser.id,
    project_id: e.projectId || null,
    project_number: e.projectNumber || null,
    date: e.date,
    description: e.description || null,
    amount: e.amount,
    invoiced: !!e.invoiced,
    source: e.source,
  };
}

function fromDbExpense(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    projectNumber: row.project_number || "",
    date: row.date,
    description: row.description || "",
    amount: Number(row.amount),
    invoiced: !!row.invoiced,
    source: row.source || "clock",
  };
}

function renderEverything() {
  renderProjectSelects();
  renderProjectsTable();
  renderProjectNumberDatalist();
  renderClockExpenseList();
  renderOverview();
}

async function loadRemoteData() {
  updateSyncStatus("syncing");
  try {
    const [projRes, entRes, expRes] = await Promise.all([
      sb.from("freelance_projects").select("*").order("created_at", { ascending: true }),
      sb.from("freelance_entries").select("*").order("date", { ascending: false }),
      sb.from("freelance_expenses").select("*").order("date", { ascending: false }),
    ]);
    if (projRes.error) throw projRes.error;
    if (entRes.error) throw entRes.error;
    if (expRes.error) throw expRes.error;

    state.projects = projRes.data.map(fromDbProject);
    state.entries = entRes.data.map(fromDbEntry);
    state.expenses = expRes.data.map(fromDbExpense);
    saveState();
    renderEverything();
    updateSyncStatus(syncQueue.length ? "pending" : "synced");
  } catch (err) {
    console.warn("Kunne ikke hente data fra Supabase, bruker lokal cache:", err);
    updateSyncStatus("offline");
    renderEverything();
  }
}

async function initAfterSignIn(user) {
  currentUser = user;
  document.getElementById("authOverlay").style.display = "none";
  document.getElementById("appRoot").style.display = "block";
  loadState();
  renderEverything();
  resumeTimerIfActive();
  await processSyncQueue();
  await loadRemoteData();
}

function showAuthScreen() {
  currentUser = null;
  document.getElementById("appRoot").style.display = "none";
  document.getElementById("authOverlay").style.display = "flex";
}

function initAuth() {
  const emailInput = document.getElementById("authEmail");
  const passwordInput = document.getElementById("authPassword");
  const errorEl = document.getElementById("authError");
  const statusEl = document.getElementById("authStatus");

  function setError(msg) { errorEl.textContent = msg || ""; }

  document.getElementById("authSignInBtn").addEventListener("click", async () => {
    setError("");
    statusEl.textContent = "Logger inn...";
    const { error } = await sb.auth.signInWithPassword({
      email: emailInput.value.trim(),
      password: passwordInput.value,
    });
    statusEl.textContent = "";
    if (error) setError(error.message);
  });

  document.getElementById("authSignUpBtn").addEventListener("click", async () => {
    setError("");
    statusEl.textContent = "Oppretter konto...";
    const { error } = await sb.auth.signUp({
      email: emailInput.value.trim(),
      password: passwordInput.value,
    });
    if (error) {
      setError(error.message);
      statusEl.textContent = "";
    } else {
      statusEl.textContent = "Konto opprettet! Sjekk e-posten din for å bekrefte, logg deretter inn.";
    }
  });

  document.getElementById("signOutBtn").addEventListener("click", async () => {
    if (syncQueue.length > 0) {
      const ok = confirm(`Du har ${syncQueue.length} endring(er) som ikke er synkronisert enda. Logge ut likevel? Prøv gjerne igjen med nett først.`);
      if (!ok) return;
    }
    await sb.auth.signOut();
  });

  sb.auth.onAuthStateChange((event, session) => {
    if (session && session.user) {
      initAfterSignIn(session.user);
    } else {
      showAuthScreen();
    }
  });
}

// ---------- Utils ----------

function uid() {
  // Bruker ekte UUID-er slik at ID-ene er kompatible med Supabase (uuid-kolonner),
  // enten de lages online eller offline.
  if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function saveState() {
  localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(state.projects));
  localStorage.setItem(STORAGE_KEY_ENTRIES, JSON.stringify(state.entries));
  localStorage.setItem(STORAGE_KEY_EXPENSES, JSON.stringify(state.expenses));
  if (state.activeTimer) {
    localStorage.setItem(STORAGE_KEY_TIMER, JSON.stringify(state.activeTimer));
  } else {
    localStorage.removeItem(STORAGE_KEY_TIMER);
  }
}

function loadState() {
  try {
    state.projects = JSON.parse(localStorage.getItem(STORAGE_KEY_PROJECTS)) || [];
  } catch { state.projects = []; }
  try {
    state.entries = JSON.parse(localStorage.getItem(STORAGE_KEY_ENTRIES)) || [];
  } catch { state.entries = []; }
  try {
    state.expenses = JSON.parse(localStorage.getItem(STORAGE_KEY_EXPENSES)) || [];
  } catch { state.expenses = []; }
  try {
    state.activeTimer = JSON.parse(localStorage.getItem(STORAGE_KEY_TIMER)) || null;
  } catch { state.activeTimer = null; }
}

function getProject(id) {
  return state.projects.find((p) => p.id === id);
}

function entryProjectNumber(entry) {
  if (entry.projectNumber) return entry.projectNumber;
  const project = getProject(entry.projectId);
  return project ? project.number || "" : "";
}

function renderProjectNumberDatalist() {
  const numbers = new Set();
  state.projects.forEach((p) => { if (p.number) numbers.add(p.number); });
  state.entries.forEach((e) => { if (e.projectNumber) numbers.add(e.projectNumber); });
  state.expenses.forEach((e) => { if (e.projectNumber) numbers.add(e.projectNumber); });
  const list = document.getElementById("projectNumbersList");
  list.innerHTML = [...numbers].sort().map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
}

function formatMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}t ${m}m`;
}

function formatAmount(amount, currency) {
  return `${amount.toFixed(2)} ${currency || "kr"}`;
}

function getProjectDayEntries(projectId, date) {
  return state.entries
    .filter((e) => e.projectId === projectId && e.date === date)
    .sort((a, b) => {
      const at = a.startTime || "99:99";
      const bt = b.startTime || "99:99";
      if (at !== bt) return at < bt ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
}

function splitHoursIntoBands(startHour, endHour, thr50, thr100) {
  const overlap = (lo, hi) => Math.max(0, Math.min(endHour, hi) - Math.max(startHour, lo));
  return {
    normal: overlap(0, thr50),
    ot50: overlap(thr50, thr100),
    ot100: overlap(thr100, Infinity),
  };
}

function computeEntryAmount(entry) {
  const project = getProject(entry.projectId);
  if (!project) return 0;
  const hours = entry.minutes / 60;

  if (project.rateType === "daily") {
    const dayHours = project.dayHours || 8;
    return (hours / dayHours) * project.rate;
  }

  // Timelønn uten overtidstillegg
  if (!project.overtimeEnabled || !project.overtime50Hours) {
    return hours * project.rate;
  }

  // Timelønn med overtidstillegg: beregn basert på akkumulerte timer
  // for dette prosjektet denne dagen, slik at tillegget slår inn riktig
  // selv om dagen består av flere registreringer.
  const thr50 = project.overtime50Hours;
  const thr100 = project.overtime100Hours && project.overtime100Hours > thr50
    ? project.overtime100Hours
    : Infinity;

  const dayEntries = getProjectDayEntries(entry.projectId, entry.date);
  let startHour = 0;
  for (const e of dayEntries) {
    if (e.id === entry.id) break;
    startHour += e.minutes / 60;
  }
  const endHour = startHour + hours;
  const bands = splitHoursIntoBands(startHour, endHour, thr50, thr100);

  return bands.normal * project.rate + bands.ot50 * project.rate * 1.5 + bands.ot100 * project.rate * 2;
}

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

// ---------- Tabs ----------

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
      if (btn.dataset.tab === "overview") renderOverview();
    });
  });
}

// ---------- Projects ----------

function renderProjectSelects() {
  const selects = [
    document.getElementById("clockProject"),
    document.getElementById("manualProject"),
  ];
  const filterSelect = document.getElementById("filterProject");

  selects.forEach((sel) => {
    const current = sel.value;
    sel.innerHTML = "";
    if (state.projects.length === 0) {
      sel.innerHTML = `<option value="">Ingen prosjekter - legg til et først</option>`;
      return;
    }
    state.projects.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name}${p.number ? " (" + p.number + ")" : ""}`;
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  });

  const currentFilter = filterSelect.value;
  filterSelect.innerHTML = `<option value="">Alle prosjekter</option>`;
  state.projects.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name}${p.number ? " (" + p.number + ")" : ""}`;
    filterSelect.appendChild(opt);
  });
  filterSelect.value = currentFilter;
}

function renderProjectsTable() {
  const tbody = document.querySelector("#projectsTable tbody");
  tbody.innerHTML = "";
  if (state.projects.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Ingen prosjekter enda</td></tr>`;
    return;
  }
  state.projects.forEach((p) => {
    let details = "-";
    if (p.rateType === "daily") {
      details = `${p.dayHours} t/dag`;
    } else if (p.overtimeEnabled && p.overtime50Hours) {
      details = `OT 50% &gt; ${p.overtime50Hours}t`;
      if (p.overtime100Hours) details += ` · 100% &gt; ${p.overtime100Hours}t`;
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="Navn">${escapeHtml(p.name)}</td>
      <td data-label="Prosjektnr">${escapeHtml(p.number || "")}</td>
      <td data-label="Type">${p.rateType === "daily" ? "Dagsats" : "Timelønn"}</td>
      <td data-label="Sats">${formatAmount(p.rate, p.currency)}</td>
      <td data-label="Detaljer">${details}</td>
      <td class="row-actions"><button class="btn-small danger" data-id="${p.id}">Slett</button></td>
    `;
    tr.querySelector("button").addEventListener("click", () => deleteProject(p.id));
    tbody.appendChild(tr);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function addProject(data) {
  const project = {
    id: uid(),
    name: data.name,
    number: data.number,
    rateType: data.rateType,
    rate: parseFloat(data.rate),
    dayHours: parseFloat(data.dayHours) || 8,
    overtimeEnabled: !!data.overtimeEnabled,
    overtime50Hours: parseFloat(data.overtime50Hours) || 0,
    overtime100Hours: parseFloat(data.overtime100Hours) || 0,
    currency: "kr",
  };
  state.projects.push(project);
  saveState();
  renderProjectSelects();
  renderProjectsTable();
  renderProjectNumberDatalist();
  syncWrite({ type: "insert", table: "freelance_projects", payload: toDbProject(project) });
}

function deleteProject(id) {
  const hasEntries = state.entries.some((e) => e.projectId === id);
  if (hasEntries && !confirm("Dette prosjektet har registrerte timer. Slette prosjektet likevel? Timene beholdes men mister prosjektreferansen.")) {
    return;
  }
  state.projects = state.projects.filter((p) => p.id !== id);
  saveState();
  renderProjectSelects();
  renderProjectsTable();
  syncWrite({ type: "delete", table: "freelance_projects", id });
}

function initProjectForm() {
  const form = document.getElementById("projectForm");
  const rateTypeSelect = document.getElementById("projRateType");
  const dayHoursField = document.getElementById("dayHoursField");
  const overtimeToggleField = document.getElementById("overtimeToggleField");
  const overtimeRatesFields = document.getElementById("overtimeRatesFields");
  const overtimeEnabledCheckbox = document.getElementById("projOvertimeEnabled");

  function updateVisibility() {
    const isDaily = rateTypeSelect.value === "daily";
    dayHoursField.style.display = isDaily ? "flex" : "none";
    overtimeToggleField.style.display = isDaily ? "none" : "flex";
    overtimeRatesFields.style.display = (!isDaily && overtimeEnabledCheckbox.checked) ? "flex" : "none";
    if (isDaily) overtimeEnabledCheckbox.checked = false;
  }
  rateTypeSelect.addEventListener("change", updateVisibility);
  overtimeEnabledCheckbox.addEventListener("change", updateVisibility);
  updateVisibility();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const overtimeEnabled = overtimeEnabledCheckbox.checked;
    const overtime50Hours = document.getElementById("projOvertime50").value;
    if (overtimeEnabled && (!overtime50Hours || parseFloat(overtime50Hours) <= 0)) {
      alert("Angi antall timer per dag før 50%-tillegget starter.");
      return;
    }
    addProject({
      name: document.getElementById("projName").value.trim(),
      number: document.getElementById("projNumber").value.trim(),
      rateType: rateTypeSelect.value,
      rate: document.getElementById("projRate").value,
      dayHours: document.getElementById("projDayHours").value,
      overtimeEnabled,
      overtime50Hours,
      overtime100Hours: document.getElementById("projOvertime100").value,
    });
    form.reset();
    updateVisibility();
  });
}

// ---------- Punch clock ----------

function initClock() {
  document.getElementById("startBtn").addEventListener("click", startTimer);
  document.getElementById("stopBtn").addEventListener("click", stopTimer);
  document.getElementById("addNoteBtn").addEventListener("click", addTimerNote);
  document.getElementById("clockNoteInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addTimerNote(); }
  });
  document.getElementById("clockProject").addEventListener("change", (e) => {
    const project = getProject(e.target.value);
    const numberField = document.getElementById("clockProjectNumber");
    if (project && project.number && !numberField.value) {
      numberField.value = project.number;
    }
  });
  resumeTimerIfActive();
}

function startTimer() {
  const projectId = document.getElementById("clockProject").value;
  if (!projectId) { alert("Velg et prosjekt først."); return; }
  const projectNumber = document.getElementById("clockProjectNumber").value.trim();
  state.activeTimer = { projectId, projectNumber, startedAt: Date.now(), notesLog: [] };
  saveState();
  updateClockUI();
  startTicking();
}

function stopTimer() {
  if (!state.activeTimer) return;
  const elapsedMs = Date.now() - state.activeTimer.startedAt;
  const minutes = elapsedMs / 1000 / 60;
  const notesText = state.activeTimer.notesLog.map((n) => `[${n.time}] ${n.text}`).join("\n");

  const entry = {
    id: uid(),
    projectId: state.activeTimer.projectId,
    projectNumber: state.activeTimer.projectNumber || "",
    date: todayStr(),
    startTime: new Date(state.activeTimer.startedAt).toTimeString().slice(0, 5),
    endTime: new Date().toTimeString().slice(0, 5),
    minutes: Math.max(0, minutes),
    notes: notesText,
    source: "timer",
    invoiced: false,
  };
  state.entries.push(entry);

  state.activeTimer = null;
  saveState();
  stopTicking();
  updateClockUI();
  document.getElementById("clockNotesLog").value = "";
  document.getElementById("clockProjectNumber").value = "";
  renderProjectNumberDatalist();
  syncWrite({ type: "insert", table: "freelance_entries", payload: toDbEntry(entry) });
}

function addTimerNote() {
  if (!state.activeTimer) { alert("Start timeren først."); return; }
  const input = document.getElementById("clockNoteInput");
  const text = input.value.trim();
  if (!text) return;
  const time = new Date().toTimeString().slice(0, 5);
  state.activeTimer.notesLog.push({ time, text });
  saveState();
  input.value = "";
  renderTimerNotes();
}

function renderTimerNotes() {
  const log = document.getElementById("clockNotesLog");
  if (!state.activeTimer) { log.value = ""; return; }
  log.value = state.activeTimer.notesLog.map((n) => `[${n.time}] ${n.text}`).join("\n");
}

function resumeTimerIfActive() {
  if (state.activeTimer) {
    document.getElementById("clockProject").value = state.activeTimer.projectId;
    document.getElementById("clockProjectNumber").value = state.activeTimer.projectNumber || "";
    updateClockUI();
    renderTimerNotes();
    startTicking();
  }
}

function updateClockUI() {
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const projectSelect = document.getElementById("clockProject");
  const numberField = document.getElementById("clockProjectNumber");
  const label = document.getElementById("timerProjectLabel");

  if (state.activeTimer) {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    projectSelect.disabled = true;
    numberField.disabled = true;
    const proj = getProject(state.activeTimer.projectId);
    const num = state.activeTimer.projectNumber;
    label.textContent = proj ? `Kjører for: ${proj.name}${num ? " · " + num : ""}` : "";
  } else {
    startBtn.disabled = false;
    stopBtn.disabled = true;
    projectSelect.disabled = false;
    numberField.disabled = false;
    label.textContent = "";
    document.getElementById("timerDisplay").textContent = "00:00:00";
  }
}

function startTicking() {
  stopTicking();
  tick();
  tickInterval = setInterval(tick, 1000);
}

function stopTicking() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = null;
}

function tick() {
  if (!state.activeTimer) return;
  const elapsed = Date.now() - state.activeTimer.startedAt;
  const totalSec = Math.floor(elapsed / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  document.getElementById("timerDisplay").textContent = `${h}:${m}:${s}`;
}

// ---------- Expenses (utlegg) ----------

function initExpenseForm() {
  document.getElementById("addExpenseBtn").addEventListener("click", () => {
    const projectId = document.getElementById("clockProject").value;
    if (!projectId) { alert("Velg et prosjekt først."); return; }
    const amountInput = document.getElementById("expenseAmount");
    const descriptionInput = document.getElementById("expenseDescription");
    const amount = parseFloat(amountInput.value);
    if (!amount || amount <= 0) { alert("Angi et beløp større enn 0."); return; }
    const projectNumber = document.getElementById("clockProjectNumber").value.trim();

    const expense = {
      id: uid(),
      projectId,
      projectNumber,
      date: todayStr(),
      description: descriptionInput.value.trim(),
      amount,
      invoiced: false,
      source: "clock",
    };
    state.expenses.push(expense);
    saveState();
    renderProjectNumberDatalist();
    amountInput.value = "";
    descriptionInput.value = "";
    renderClockExpenseList();
    syncWrite({ type: "insert", table: "freelance_expenses", payload: toDbExpense(expense) });
  });
}

function renderClockExpenseList() {
  const container = document.getElementById("clockExpenseList");
  const todays = state.expenses
    .filter((e) => e.date === todayStr())
    .sort((a, b) => (a.id < b.id ? 1 : -1));

  if (todays.length === 0) {
    container.innerHTML = `<p class="empty-state">Ingen utlegg lagt til i dag</p>`;
    return;
  }

  container.innerHTML = todays.map((e) => {
    const project = getProject(e.projectId);
    return `
      <div class="expense-row">
        <div>
          <strong>${formatAmount(e.amount, project ? project.currency : "kr")}</strong>
          <span class="expense-meta">${project ? escapeHtml(project.name) : ""}${e.description ? " · " + escapeHtml(e.description) : ""}</span>
        </div>
        <button class="btn-small danger" data-id="${e.id}">Slett</button>
      </div>
    `;
  }).join("");

  container.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => deleteExpense(btn.dataset.id));
  });
}

function deleteExpense(id) {
  state.expenses = state.expenses.filter((x) => x.id !== id);
  saveState();
  renderOverview();
  renderClockExpenseList();
  syncWrite({ type: "delete", table: "freelance_expenses", id });
}

function toggleExpenseInvoiced(id) {
  const expense = state.expenses.find((x) => x.id === id);
  if (!expense) return;
  expense.invoiced = !expense.invoiced;
  saveState();
  renderOverview();
  syncWrite({ type: "update", table: "freelance_expenses", id, payload: { invoiced: expense.invoiced } });
}

function toggleEntryInvoiced(id) {
  const entry = state.entries.find((x) => x.id === id);
  if (!entry) return;
  entry.invoiced = !entry.invoiced;
  saveState();
  renderOverview();
  syncWrite({ type: "update", table: "freelance_entries", id, payload: { invoiced: entry.invoiced } });
}

// ---------- Manual entry ----------

function initManualForm() {
  document.getElementById("manualDate").value = todayStr();
  document.getElementById("manualForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const projectId = document.getElementById("manualProject").value;
    if (!projectId) { alert("Velg et prosjekt."); return; }
    const projectNumber = document.getElementById("manualProjectNumber").value.trim();
    const date = document.getElementById("manualDate").value;
    const start = document.getElementById("manualStart").value;
    const end = document.getElementById("manualEnd").value;
    const hoursDirect = document.getElementById("manualHours").value;
    const notes = document.getElementById("manualNotes").value.trim();

    let minutes = 0;
    if (hoursDirect) {
      minutes = parseFloat(hoursDirect) * 60;
    } else if (start && end) {
      const [sh, sm] = start.split(":").map(Number);
      const [eh, em] = end.split(":").map(Number);
      minutes = (eh * 60 + em) - (sh * 60 + sm);
      if (minutes < 0) minutes += 24 * 60;
    } else {
      alert("Angi enten start/slutt-tid eller timer direkte.");
      return;
    }

    const entry = {
      id: uid(),
      projectId,
      projectNumber,
      date,
      startTime: hoursDirect ? "" : start,
      endTime: hoursDirect ? "" : end,
      minutes,
      notes,
      source: "manual",
      invoiced: false,
    };
    state.entries.push(entry);
    saveState();
    renderProjectNumberDatalist();
    e.target.reset();
    document.getElementById("manualDate").value = todayStr();
    syncWrite({ type: "insert", table: "freelance_entries", payload: toDbEntry(entry) });
    alert("Registrering lagt til.");
  });
}

// ---------- Overview ----------

function getInvoicedFilterValue() {
  return document.getElementById("filterInvoiced").value; // "", "yes", "no"
}

function matchesInvoicedFilter(item) {
  const filter = getInvoicedFilterValue();
  if (filter === "yes") return !!item.invoiced;
  if (filter === "no") return !item.invoiced;
  return true;
}

function getFilteredEntries() {
  const projectId = document.getElementById("filterProject").value;
  const from = document.getElementById("filterFrom").value;
  const to = document.getElementById("filterTo").value;

  return state.entries
    .filter((e) => !projectId || e.projectId === projectId)
    .filter((e) => !from || e.date >= from)
    .filter((e) => !to || e.date <= to)
    .filter(matchesInvoicedFilter)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

function getFilteredExpenses() {
  const projectId = document.getElementById("filterProject").value;
  const from = document.getElementById("filterFrom").value;
  const to = document.getElementById("filterTo").value;

  return state.expenses
    .filter((e) => !projectId || e.projectId === projectId)
    .filter((e) => !from || e.date >= from)
    .filter((e) => !to || e.date <= to)
    .filter(matchesInvoicedFilter)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

function renderOverview() {
  const entries = getFilteredEntries();
  const expenses = getFilteredExpenses();
  renderEntriesTable(entries);
  renderExpensesTable(expenses);
  renderSummaryCards(entries, expenses);
}

function renderEntriesTable(entries) {
  const tbody = document.querySelector("#entriesTable tbody");
  tbody.innerHTML = "";
  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-state">Ingen registreringer for valgt filter</td></tr>`;
    return;
  }
  entries.forEach((e) => {
    const project = getProject(e.projectId);
    const amount = computeEntryAmount(e);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="Dato">${e.date}</td>
      <td data-label="Prosjekt">${project ? escapeHtml(project.name) : "(slettet prosjekt)"}</td>
      <td data-label="Prosjektnr">${escapeHtml(entryProjectNumber(e))}</td>
      <td data-label="Start">${e.startTime || ""}</td>
      <td data-label="Slutt">${e.endTime || ""}</td>
      <td data-label="Timer">${formatMinutes(e.minutes)}</td>
      <td data-label="Merknad">${escapeHtml((e.notes || "").slice(0, 60))}</td>
      <td data-label="Beløp">${formatAmount(amount, project ? project.currency : "kr")}</td>
      <td data-label="Fakturert"><button class="btn-small toggle-invoiced ${e.invoiced ? "invoiced" : ""}" data-id="${e.id}">${e.invoiced ? "Fakturert" : "Ikke fakturert"}</button></td>
      <td class="row-actions"><button class="btn-small danger" data-id="${e.id}">Slett</button></td>
    `;
    tr.querySelector(".toggle-invoiced").addEventListener("click", () => toggleEntryInvoiced(e.id));
    tr.querySelector(".danger").addEventListener("click", () => {
      if (confirm("Slette denne registreringen?")) {
        state.entries = state.entries.filter((x) => x.id !== e.id);
        saveState();
        renderOverview();
        syncWrite({ type: "delete", table: "freelance_entries", id: e.id });
      }
    });
    tbody.appendChild(tr);
  });
}

function renderExpensesTable(expenses) {
  const tbody = document.querySelector("#expensesTable tbody");
  tbody.innerHTML = "";
  if (expenses.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Ingen utlegg for valgt filter</td></tr>`;
    return;
  }
  expenses.forEach((e) => {
    const project = getProject(e.projectId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="Dato">${e.date}</td>
      <td data-label="Prosjekt">${project ? escapeHtml(project.name) : "(slettet prosjekt)"}</td>
      <td data-label="Prosjektnr">${escapeHtml(entryProjectNumber(e))}</td>
      <td data-label="Beskrivelse">${escapeHtml(e.description || "")}</td>
      <td data-label="Beløp">${formatAmount(e.amount, project ? project.currency : "kr")}</td>
      <td data-label="Fakturert"><button class="btn-small toggle-invoiced ${e.invoiced ? "invoiced" : ""}" data-id="${e.id}">${e.invoiced ? "Fakturert" : "Ikke fakturert"}</button></td>
      <td class="row-actions"><button class="btn-small danger" data-id="${e.id}">Slett</button></td>
    `;
    tr.querySelector(".toggle-invoiced").addEventListener("click", () => toggleExpenseInvoiced(e.id));
    tr.querySelector(".danger").addEventListener("click", () => {
      if (confirm("Slette dette utlegget?")) deleteExpense(e.id);
    });
    tbody.appendChild(tr);
  });
}

function renderSummaryCards(entries, expenses) {
  const container = document.getElementById("summaryCards");
  container.innerHTML = "";

  const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
  const totalHoursAmount = entries.reduce((sum, e) => sum + computeEntryAmount(e), 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const grandTotal = totalHoursAmount + totalExpenses;

  const cards = [
    { label: "Totale timer", value: formatMinutes(totalMinutes) },
    { label: "Timebeløp", value: formatAmount(totalHoursAmount, "kr") },
    { label: "Utlegg", value: formatAmount(totalExpenses, "kr") },
    { label: "Totalt fakturerbart", value: formatAmount(grandTotal, "kr") },
  ];

  cards.forEach((c) => {
    const div = document.createElement("div");
    div.className = "summary-card";
    div.innerHTML = `<div class="label">${c.label}</div><div class="value">${c.value}</div>`;
    container.appendChild(div);
  });
}

function initOverviewFilters() {
  ["filterProject", "filterFrom", "filterTo", "filterInvoiced"].forEach((id) => {
    document.getElementById(id).addEventListener("change", renderOverview);
  });
  document.getElementById("exportExcelBtn").addEventListener("click", exportExcel);
  document.getElementById("exportPdfBtn").addEventListener("click", exportPdf);
  document.getElementById("markInvoicedBtn").addEventListener("click", () => {
    const entries = getFilteredEntries();
    const expenses = getFilteredExpenses();
    if (entries.length === 0 && expenses.length === 0) { alert("Ingen registreringer å merke."); return; }
    if (!confirm(`Merke ${entries.length} registrering(er) og ${expenses.length} utlegg som fakturert?`)) return;
    entries.forEach((e) => { e.invoiced = true; });
    expenses.forEach((e) => { e.invoiced = true; });
    saveState();
    renderOverview();
    entries.forEach((e) => syncWrite({ type: "update", table: "freelance_entries", id: e.id, payload: { invoiced: true } }));
    expenses.forEach((e) => syncWrite({ type: "update", table: "freelance_expenses", id: e.id, payload: { invoiced: true } }));
  });
}

// ---------- Export: Excel ----------

function exportExcel() {
  const entries = getFilteredEntries();
  const expenses = getFilteredExpenses();
  if (entries.length === 0 && expenses.length === 0) { alert("Ingen registreringer å eksportere."); return; }

  const wb = XLSX.utils.book_new();

  if (entries.length > 0) {
    const rows = entries.map((e) => {
      const project = getProject(e.projectId);
      return {
        Dato: e.date,
        Prosjekt: project ? project.name : "",
        Prosjektnr: entryProjectNumber(e),
        Start: e.startTime,
        Slutt: e.endTime,
        Timer: +(e.minutes / 60).toFixed(2),
        Merknad: e.notes,
        "Beløp (kr)": +computeEntryAmount(e).toFixed(2),
        Fakturert: e.invoiced ? "Ja" : "Nei",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Registreringer");
  }

  if (expenses.length > 0) {
    const expenseRows = expenses.map((e) => {
      const project = getProject(e.projectId);
      return {
        Dato: e.date,
        Prosjekt: project ? project.name : "",
        Prosjektnr: entryProjectNumber(e),
        Beskrivelse: e.description,
        "Beløp (kr)": +e.amount.toFixed(2),
        Fakturert: e.invoiced ? "Ja" : "Nei",
      };
    });
    const wsExpenses = XLSX.utils.json_to_sheet(expenseRows);
    XLSX.utils.book_append_sheet(wb, wsExpenses, "Utlegg");
  }

  // Summary sheet
  const byProject = {};
  entries.forEach((e) => {
    const project = getProject(e.projectId);
    const key = project ? project.name : "Ukjent";
    if (!byProject[key]) byProject[key] = { Timer: 0, "Timebeløp (kr)": 0, "Utlegg (kr)": 0 };
    byProject[key].Timer += e.minutes / 60;
    byProject[key]["Timebeløp (kr)"] += computeEntryAmount(e);
  });
  expenses.forEach((e) => {
    const project = getProject(e.projectId);
    const key = project ? project.name : "Ukjent";
    if (!byProject[key]) byProject[key] = { Timer: 0, "Timebeløp (kr)": 0, "Utlegg (kr)": 0 };
    byProject[key]["Utlegg (kr)"] += e.amount;
  });
  const summaryRows = Object.entries(byProject).map(([name, v]) => ({
    Prosjekt: name,
    Timer: +v.Timer.toFixed(2),
    "Timebeløp (kr)": +v["Timebeløp (kr)"].toFixed(2),
    "Utlegg (kr)": +v["Utlegg (kr)"].toFixed(2),
    "Totalt (kr)": +(v["Timebeløp (kr)"] + v["Utlegg (kr)"]).toFixed(2),
  }));
  if (summaryRows.length > 0) {
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, wsSummary, "Sammendrag");
  }

  XLSX.writeFile(wb, `timeliste_${todayStr()}.xlsx`);
}

// ---------- Export: PDF ----------

function exportPdf() {
  const entries = getFilteredEntries();
  const expenses = getFilteredExpenses();
  if (entries.length === 0 && expenses.length === 0) { alert("Ingen registreringer å eksportere."); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text("Timeliste", 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(100);
  const from = document.getElementById("filterFrom").value;
  const to = document.getElementById("filterTo").value;
  const periodText = (from || to) ? `Periode: ${from || "..."} - ${to || "i dag"}` : "Alle registreringer";
  doc.text(`${periodText}  |  Generert: ${todayStr()}`, 14, 22);

  let cursorY = 28;

  if (entries.length > 0) {
    const body = entries.map((e) => {
      const project = getProject(e.projectId);
      return [
        e.date,
        project ? project.name : "",
        entryProjectNumber(e),
        formatMinutes(e.minutes),
        (e.notes || "").slice(0, 30),
        formatAmount(computeEntryAmount(e), project ? project.currency : "kr"),
        e.invoiced ? "Ja" : "Nei",
      ];
    });

    doc.autoTable({
      startY: cursorY,
      head: [["Dato", "Prosjekt", "Prosjektnr", "Timer", "Merknad", "Beløp", "Fakturert"]],
      body,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [18, 58, 99] },
    });
    cursorY = doc.lastAutoTable.finalY + 10;
  }

  if (expenses.length > 0) {
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text("Utlegg", 14, cursorY);
    cursorY += 4;

    const expenseBody = expenses.map((e) => {
      const project = getProject(e.projectId);
      return [
        e.date,
        project ? project.name : "",
        entryProjectNumber(e),
        (e.description || "").slice(0, 40),
        formatAmount(e.amount, project ? project.currency : "kr"),
        e.invoiced ? "Ja" : "Nei",
      ];
    });

    doc.autoTable({
      startY: cursorY,
      head: [["Dato", "Prosjekt", "Prosjektnr", "Beskrivelse", "Beløp", "Fakturert"]],
      body: expenseBody,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [18, 58, 99] },
    });
    cursorY = doc.lastAutoTable.finalY + 10;
  }

  const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
  const totalHoursAmount = entries.reduce((sum, e) => sum + computeEntryAmount(e), 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const grandTotal = totalHoursAmount + totalExpenses;

  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text(`Timer: ${formatMinutes(totalMinutes)}  —  Timebeløp: ${formatAmount(totalHoursAmount, "kr")}`, 14, cursorY);
  cursorY += 6;
  doc.text(`Utlegg: ${formatAmount(totalExpenses, "kr")}`, 14, cursorY);
  cursorY += 8;
  doc.setFontSize(13);
  doc.setFont(undefined, "bold");
  doc.text(`Totalt fakturerbart: ${formatAmount(grandTotal, "kr")}`, 14, cursorY);

  doc.save(`timeliste_${todayStr()}.pdf`);
}

// ---------- Init ----------

function init() {
  loadSyncQueue();
  initTabs();
  initProjectForm();
  initClock();
  initExpenseForm();
  initManualForm();
  initOverviewFilters();
  initAuth();
  // initAuth() lytter på Supabase sin auth-status og kaller initAfterSignIn()
  // (som laster data og tegner opp UI) eller showAuthScreen() automatisk.
}

document.addEventListener("DOMContentLoaded", init);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((err) => {
      console.warn("Service worker kunne ikke registreres:", err);
    });
  });
}

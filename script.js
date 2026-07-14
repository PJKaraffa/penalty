console.log("Transportation Penalty Tracker JavaScript loaded.");

const PENALTY_FREE_INCIDENTS = 2;
const PENALTY_PER_ADDITIONAL_INCIDENT = 50;

let currentUser = null;
let currentProfile = null;
let schools = [];
let myEntries = [];
let adminEntries = [];

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", initializeApp);

async function initializeApp() {
  setDefaultDates();
  bindEvents();

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    await loadApplication(session.user);
  }
}

function bindEvents() {
  $("loginButton").addEventListener("click", login);
  $("loginPassword").addEventListener("keydown", e => {
    if (e.key === "Enter") login();
  });
  $("logoutButton").addEventListener("click", logout);
  $("refreshButton").addEventListener("click", refreshAll);
  $("lateBusForm").addEventListener("submit", saveEntry);
  $("cancelEditButton").addEventListener("click", resetEntryForm);

  $("scheduledTime").addEventListener("input", calculateMinutesLate);
  $("actualTime").addEventListener("input", calculateMinutesLate);

  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => showView(tab.dataset.view));
  });

  $("myMonthFilter").addEventListener("input", renderMyEntries);
  $("mySearchFilter").addEventListener("input", renderMyEntries);
  $("clearMyFiltersButton").addEventListener("click", () => {
    $("myMonthFilter").value = "";
    $("mySearchFilter").value = "";
    renderMyEntries();
  });

  $("adminMonthFilter").addEventListener("input", renderAdminDashboard);
  $("adminSchoolFilter").addEventListener("change", renderAdminDashboard);
  $("adminSearchFilter").addEventListener("input", renderAdminDashboard);
  $("clearAdminFiltersButton").addEventListener("click", () => {
    $("adminMonthFilter").value = getCurrentMonth();
    $("adminSchoolFilter").value = "";
    $("adminSearchFilter").value = "";
    renderAdminDashboard();
  });

  $("exportMyEntriesButton").addEventListener("click", exportMyEntries);
  $("exportAdminDetailButton").addEventListener("click", exportAdminDetail);
  $("exportBillingButton").addEventListener("click", exportBillingSummary);
}

async function login() {
  clearMessage("loginMessage");
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  if (!email || !password) {
    showMessage("loginMessage", "Enter your email and password.", true);
    return;
  }

  toggleButton("loginButton", true, "Signing In...");

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

  toggleButton("loginButton", false, "Sign In");

  if (error) {
    showMessage("loginMessage", error.message, true);
    return;
  }

  await loadApplication(data.user);
}

window.login = login;

async function loadApplication(user) {
  currentUser = user;

  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("id, full_name, email, role, school_id, active, schools(id, school_name)")
    .eq("id", user.id)
    .single();

  if (error) {
    console.error("Profile error:", error);
    showMessage("loginMessage", `Profile error: ${error.message}`, true);
    await supabaseClient.auth.signOut();
    return;
  }

  if (!profile) {
    showMessage("loginMessage", "Your login worked, but no profile record was found.", true);
    await supabaseClient.auth.signOut();
    return;
  }

  if (profile.active === false) {
    showMessage("loginMessage", "Your profile is inactive.", true);
    await supabaseClient.auth.signOut();
    return;
  }

  currentProfile = profile;
  await loadSchools();

  $("loginPage").classList.add("hidden");
  $("application").classList.remove("hidden");
  $("welcomeUser").textContent = `${profile.full_name || profile.email} (${profile.role})`;
  $("adminTab").classList.toggle("hidden", profile.role !== "admin");

  populateSchoolSelectors();

  if (profile.role !== "admin") {
    $("schoolSelect").value = profile.school_id || "";
    $("schoolSelect").disabled = true;
  } else {
    $("schoolSelect").disabled = false;
  }

  await refreshAll();
}

async function logout() {
  await supabaseClient.auth.signOut();
  currentUser = null;
  currentProfile = null;
  myEntries = [];
  adminEntries = [];
  $("application").classList.add("hidden");
  $("loginPage").classList.remove("hidden");
  $("loginPassword").value = "";
  showView("entryView");
}

async function loadSchools() {
  const { data, error } = await supabaseClient
    .from("schools")
    .select("id, school_name, active")
    .eq("active", true)
    .order("school_name");

  if (error) throw new Error(error.message);
  schools = data || [];
}

function populateSchoolSelectors() {
  const entryOptions = ['<option value="">Select a school</option>']
    .concat(schools.map(s => `<option value="${s.id}">${escapeHtml(s.school_name)}</option>`));
  $("schoolSelect").innerHTML = entryOptions.join("");

  const adminOptions = ['<option value="">All schools</option>']
    .concat(schools.map(s => `<option value="${s.id}">${escapeHtml(s.school_name)}</option>`));
  $("adminSchoolFilter").innerHTML = adminOptions.join("");
}

async function refreshAll() {
  toggleButton("refreshButton", true, "Refreshing...");

  try {
    await loadMyEntries();
    if (currentProfile.role === "admin") {
      await loadAdminEntries();
    }
    renderMyEntries();
    renderAdminDashboard();
  } catch (error) {
    alert(`Refresh failed: ${error.message}`);
  } finally {
    toggleButton("refreshButton", false, "Refresh");
  }
}

async function loadMyEntries() {
  const { data, error } = await supabaseClient
    .from("late_bus_entries")
    .select(`
      id, incident_date, bus_number, route_number, scheduled_time, actual_time,
      minutes_late, reason, notes, created_at, updated_at, school_id,
      schools(school_name)
    `)
    .eq("created_by", currentUser.id)
    .order("incident_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  myEntries = data || [];
}

async function loadAdminEntries() {
  const { data, error } = await supabaseClient
    .from("late_bus_entries")
    .select(`
      id, incident_date, bus_number, route_number, scheduled_time, actual_time,
      minutes_late, reason, notes, created_at, updated_at, school_id, created_by,
      schools(school_name),
      profiles!late_bus_entries_created_by_fkey(full_name, email)
    `)
    .order("incident_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  adminEntries = data || [];
}

async function saveEntry(event) {
  event.preventDefault();
  clearMessage("entryMessage");
  calculateMinutesLate();

  const entryId = $("entryId").value;
  const payload = {
    incident_date: $("incidentDate").value,
    school_id: Number($("schoolSelect").value),
    bus_number: $("busNumber").value.trim(),
    route_number: emptyToNull($("routeNumber").value),
    scheduled_time: $("scheduledTime").value,
    actual_time: $("actualTime").value,
    minutes_late: Number($("minutesLate").value),
    reason: emptyToNull($("reasonSelect").value),
    notes: $("notes").value.trim()
  };

  if (!payload.incident_date || !payload.school_id || !payload.bus_number ||
      !payload.scheduled_time || !payload.actual_time || !payload.notes) {
    showMessage("entryMessage", "Complete all required fields.", true);
    return;
  }

  if (payload.minutes_late <= 0) {
    showMessage("entryMessage", "Actual arrival must be later than the scheduled arrival.", true);
    return;
  }

  toggleButton("saveEntryButton", true, entryId ? "Updating..." : "Saving...");

  let result;
  if (entryId) {
    result = await supabaseClient
      .from("late_bus_entries")
      .update(payload)
      .eq("id", entryId);
  } else {
    result = await supabaseClient
      .from("late_bus_entries")
      .insert({ ...payload, created_by: currentUser.id });
  }

  toggleButton("saveEntryButton", false, entryId ? "Update Entry" : "Save Entry");

  if (result.error) {
    const duplicate = result.error.code === "23505";
    showMessage(
      "entryMessage",
      duplicate ? "This bus already has a matching entry for the selected school, date, and scheduled time." : result.error.message,
      true
    );
    return;
  }

  showMessage("entryMessage", entryId ? "Entry updated successfully." : "Late bus entry saved successfully.");
  resetEntryForm(false);
  await refreshAll();
}

function calculateMinutesLate() {
  const scheduled = $("scheduledTime").value;
  const actual = $("actualTime").value;

  if (!scheduled || !actual) {
    $("minutesLate").value = "";
    return;
  }

  const scheduledMinutes = timeToMinutes(scheduled);
  let actualMinutes = timeToMinutes(actual);

  if (actualMinutes < scheduledMinutes) actualMinutes += 24 * 60;
  $("minutesLate").value = Math.max(0, actualMinutes - scheduledMinutes);
}

function timeToMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function renderMyEntries() {
  const month = $("myMonthFilter").value;
  const search = $("mySearchFilter").value.trim().toLowerCase();

  const filtered = myEntries.filter(entry => {
    const monthMatch = !month || entry.incident_date.startsWith(month);
    const haystack = [
      entry.bus_number,
      entry.route_number,
      entry.reason,
      entry.notes,
      entry.schools?.school_name
    ].join(" ").toLowerCase();
    return monthMatch && (!search || haystack.includes(search));
  });

  $("myEntriesBody").innerHTML = filtered.map(entry => `
    <tr>
      <td>${formatDate(entry.incident_date)}</td>
      <td>${escapeHtml(entry.schools?.school_name || "")}</td>
      <td>${escapeHtml(entry.bus_number)}</td>
      <td>${escapeHtml(entry.route_number || "")}</td>
      <td>${formatTime(entry.scheduled_time)}</td>
      <td>${formatTime(entry.actual_time)}</td>
      <td>${entry.minutes_late}</td>
      <td>${escapeHtml(entry.reason || "")}</td>
      <td class="notes-cell">${escapeHtml(entry.notes)}</td>
      <td class="actions-cell">
        <button class="small-button edit-button" onclick="editEntry('${entry.id}', false)">Edit</button>
        <button class="small-button delete-button" onclick="deleteEntry('${entry.id}')">Delete</button>
      </td>
    </tr>
  `).join("");

  $("myEntriesEmpty").classList.toggle("hidden", filtered.length > 0);
}

function getFilteredAdminEntries() {
  const month = $("adminMonthFilter").value;
  const schoolId = $("adminSchoolFilter").value;
  const search = $("adminSearchFilter").value.trim().toLowerCase();

  return adminEntries.filter(entry => {
    const monthMatch = !month || entry.incident_date.startsWith(month);
    const schoolMatch = !schoolId || String(entry.school_id) === schoolId;
    const haystack = [
      entry.bus_number,
      entry.route_number,
      entry.reason,
      entry.notes,
      entry.schools?.school_name,
      entry.profiles?.full_name,
      entry.profiles?.email
    ].join(" ").toLowerCase();

    return monthMatch && schoolMatch && (!search || haystack.includes(search));
  });
}

function renderAdminDashboard() {
  if (!currentProfile || currentProfile.role !== "admin") return;

  const filtered = getFilteredAdminEntries();
  const month = $("adminMonthFilter").value;
  const monthEntries = adminEntries.filter(entry => !month || entry.incident_date.startsWith(month));

  // Contract calculation is district-wide for the single transportation company.
  const totalIncidents = monthEntries.length;
  const nonBillable = Math.min(totalIncidents, PENALTY_FREE_INCIDENTS);
  const billable = Math.max(0, totalIncidents - PENALTY_FREE_INCIDENTS);
  const amount = billable * PENALTY_PER_ADDITIONAL_INCIDENT;
  const schoolsReporting = new Set(monthEntries.map(e => e.school_id)).size;

  $("metricIncidents").textContent = totalIncidents;
  $("metricFree").textContent = nonBillable;
  $("metricBillable").textContent = billable;
  $("metricAmount").textContent = formatCurrency(amount);
  $("metricSchools").textContent = `${schoolsReporting} / ${schools.length || 38}`;

  $("billingTotal").textContent = totalIncidents;
  $("billingCount").textContent = billable;
  $("billingEquation").textContent = `${billable} × $${PENALTY_PER_ADDITIONAL_INCIDENT}`;
  $("billingAmount").textContent = formatCurrency(amount);

  const schoolCounts = {};
  monthEntries.forEach(entry => {
    const name = entry.schools?.school_name || "Unknown";
    schoolCounts[name] = (schoolCounts[name] || 0) + 1;
  });

  $("schoolSummaryBody").innerHTML = Object.entries(schoolCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => `<tr><td>${escapeHtml(name)}</td><td>${count}</td></tr>`)
    .join("") || '<tr><td colspan="2">No entries for this month.</td></tr>';

  $("adminEntriesBody").innerHTML = filtered.map(entry => `
    <tr>
      <td>${formatDate(entry.incident_date)}</td>
      <td>${escapeHtml(entry.schools?.school_name || "")}</td>
      <td>${escapeHtml(entry.bus_number)}</td>
      <td>${escapeHtml(entry.route_number || "")}</td>
      <td>${formatTime(entry.scheduled_time)}</td>
      <td>${formatTime(entry.actual_time)}</td>
      <td>${entry.minutes_late}</td>
      <td>${escapeHtml(entry.reason || "")}</td>
      <td>${escapeHtml(entry.profiles?.full_name || entry.profiles?.email || "")}</td>
      <td class="notes-cell">${escapeHtml(entry.notes)}</td>
      <td class="actions-cell">
        <button class="small-button edit-button" onclick="editEntry('${entry.id}', true)">Edit</button>
        <button class="small-button delete-button" onclick="deleteEntry('${entry.id}')">Delete</button>
      </td>
    </tr>
  `).join("");

  $("adminEntriesEmpty").classList.toggle("hidden", filtered.length > 0);
}

function editEntry(id, fromAdmin) {
  const source = fromAdmin ? adminEntries : myEntries;
  const entry = source.find(item => item.id === id);
  if (!entry) return;

  $("entryId").value = entry.id;
  $("incidentDate").value = entry.incident_date;
  $("schoolSelect").value = entry.school_id;
  $("busNumber").value = entry.bus_number;
  $("routeNumber").value = entry.route_number || "";
  $("scheduledTime").value = entry.scheduled_time.slice(0, 5);
  $("actualTime").value = entry.actual_time.slice(0, 5);
  $("minutesLate").value = entry.minutes_late;
  $("reasonSelect").value = entry.reason || "";
  $("notes").value = entry.notes;
  $("saveEntryButton").textContent = "Update Entry";
  $("cancelEditButton").classList.remove("hidden");

  if (currentProfile.role === "admin") $("schoolSelect").disabled = false;
  showView("entryView");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

window.editEntry = editEntry;

async function deleteEntry(id) {
  if (!confirm("Delete this late bus entry? This cannot be undone.")) return;

  const { error } = await supabaseClient
    .from("late_bus_entries")
    .delete()
    .eq("id", id);

  if (error) {
    alert(error.message);
    return;
  }

  await refreshAll();
}

window.deleteEntry = deleteEntry;

function resetEntryForm(clearMessageToo = true) {
  $("lateBusForm").reset();
  $("entryId").value = "";
  $("incidentDate").value = getToday();
  $("minutesLate").value = "";
  $("saveEntryButton").textContent = "Save Entry";
  $("cancelEditButton").classList.add("hidden");

  if (currentProfile?.role !== "admin") {
    $("schoolSelect").value = currentProfile?.school_id || "";
    $("schoolSelect").disabled = true;
  } else {
    $("schoolSelect").disabled = false;
  }

  if (clearMessageToo) clearMessage("entryMessage");
}

function showView(viewId) {
  document.querySelectorAll(".view").forEach(view => view.classList.add("hidden"));
  $(viewId).classList.remove("hidden");

  document.querySelectorAll(".tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.view === viewId);
  });

  if (viewId === "myEntriesView") renderMyEntries();
  if (viewId === "adminView") renderAdminDashboard();
}

function exportMyEntries() {
  const month = $("myMonthFilter").value;
  const search = $("mySearchFilter").value.trim().toLowerCase();
  const rows = myEntries.filter(entry => {
    const monthMatch = !month || entry.incident_date.startsWith(month);
    const haystack = [entry.bus_number, entry.route_number, entry.reason, entry.notes, entry.schools?.school_name]
      .join(" ").toLowerCase();
    return monthMatch && (!search || haystack.includes(search));
  });

  downloadEntriesCsv(rows, `my-late-bus-entries-${month || "all"}.csv`, false);
}

function exportAdminDetail() {
  const rows = getFilteredAdminEntries();
  downloadEntriesCsv(rows, `district-late-bus-detail-${$("adminMonthFilter").value || "all"}.csv`, true);
}

function exportBillingSummary() {
  const month = $("adminMonthFilter").value;
  const rows = adminEntries.filter(entry => !month || entry.incident_date.startsWith(month));
  const billable = Math.max(0, rows.length - PENALTY_FREE_INCIDENTS);
  const amount = billable * PENALTY_PER_ADDITIONAL_INCIDENT;

  const schoolCounts = {};
  rows.forEach(entry => {
    const school = entry.schools?.school_name || "Unknown";
    schoolCounts[school] = (schoolCounts[school] || 0) + 1;
  });

  const csvRows = [
    ["Transportation Penalty Billing Summary"],
    ["Month", month || "All"],
    ["Total Late Incidents", rows.length],
    ["Non-Billable Incidents", Math.min(rows.length, PENALTY_FREE_INCIDENTS)],
    ["Billable Incidents", billable],
    ["Penalty Per Billable Incident", PENALTY_PER_ADDITIONAL_INCIDENT],
    ["Total Amount Due", amount],
    [],
    ["School", "Late Incidents"],
    ...Object.entries(schoolCounts).sort((a,b) => b[1]-a[1])
  ];

  downloadCsv(csvRows, `transportation-penalty-billing-${month || "all"}.csv`);
}

function downloadEntriesCsv(rows, filename, includeUser) {
  const header = [
    "Date", "School", "Bus Number", "Route", "Scheduled Arrival", "Actual Arrival",
    "Minutes Late", "Reason", ...(includeUser ? ["Entered By", "User Email"] : []), "Notes"
  ];

  const data = rows.map(entry => [
    entry.incident_date,
    entry.schools?.school_name || "",
    entry.bus_number,
    entry.route_number || "",
    entry.scheduled_time?.slice(0,5) || "",
    entry.actual_time?.slice(0,5) || "",
    entry.minutes_late,
    entry.reason || "",
    ...(includeUser ? [entry.profiles?.full_name || "", entry.profiles?.email || ""] : []),
    entry.notes
  ]);

  downloadCsv([header, ...data], filename);
}

function downloadCsv(rows, filename) {
  const csv = rows.map(row =>
    row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")
  ).join("\r\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function setDefaultDates() {
  $("incidentDate").value = getToday();
  $("adminMonthFilter").value = getCurrentMonth();
}

function getToday() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function getCurrentMonth() {
  return getToday().slice(0, 7);
}

function formatDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${month}-${day}-${year}`;
}

function formatTime(value) {
  if (!value) return "";
  const [hourText, minute] = value.slice(0,5).split(":");
  let hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${hour}:${minute} ${suffix}`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function emptyToNull(value) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function showMessage(id, text, isError = false) {
  const element = $(id);
  element.textContent = text;
  element.className = `message ${isError ? "error" : "success"}`;
}

function clearMessage(id) {
  const element = $(id);
  element.textContent = "";
  element.className = "message";
}

function toggleButton(id, disabled, text) {
  const button = $(id);
  button.disabled = disabled;
  button.textContent = text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

```javascript
const PENALTY_FREE_INCIDENTS = 2;
const PENALTY_PER_ADDITIONAL_INCIDENT = 50;

let currentUser = null;
let currentProfile = null;
let schools = [];
let myEntries = [];
let adminEntries = [];

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", initializeApp);

/* =========================================================
   INITIALIZE
========================================================= */

async function initializeApp() {
  try {
    setDefaultDates();
    bindEvents();

    const {
      data: { session },
      error
    } = await supabaseClient.auth.getSession();

    if (error) {
      console.error("Session error:", error);
      return;
    }

    if (session?.user) {
      await loadApplication(session.user);
    }
  } catch (error) {
    console.error("Initialization error:", error);
    showMessage(
      "loginMessage",
      `Application startup error: ${error.message}`,
      true
    );
  }
}

/* =========================================================
   EVENT LISTENERS
========================================================= */

function bindEvents() {
  $("loginButton")?.addEventListener("click", login);

  $("loginPassword")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      login();
    }
  });

  $("logoutButton")?.addEventListener("click", logout);
  $("refreshButton")?.addEventListener("click", refreshAll);

  $("lateBusForm")?.addEventListener("submit", saveEntry);
  $("cancelEditButton")?.addEventListener("click", () => resetEntryForm());

  $("scheduledTime")?.addEventListener("input", calculateMinutesLate);
  $("actualTime")?.addEventListener("input", calculateMinutesLate);

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      showView(tab.dataset.view);
    });
  });

  $("myMonthFilter")?.addEventListener("input", renderMyEntries);
  $("mySearchFilter")?.addEventListener("input", renderMyEntries);

  $("clearMyFiltersButton")?.addEventListener("click", () => {
    $("myMonthFilter").value = "";
    $("mySearchFilter").value = "";
    renderMyEntries();
  });

  $("adminMonthFilter")?.addEventListener("input", renderAdminDashboard);
  $("adminSchoolFilter")?.addEventListener("change", renderAdminDashboard);
  $("adminSearchFilter")?.addEventListener("input", renderAdminDashboard);

  $("clearAdminFiltersButton")?.addEventListener("click", () => {
    $("adminMonthFilter").value = getCurrentMonth();
    $("adminSchoolFilter").value = "";
    $("adminSearchFilter").value = "";
    renderAdminDashboard();
  });

  $("exportMyEntriesButton")?.addEventListener("click", exportMyEntries);
  $("exportAdminDetailButton")?.addEventListener("click", exportAdminDetail);
  $("exportBillingButton")?.addEventListener("click", exportBillingSummary);
}

/* =========================================================
   LOGIN
========================================================= */

async function login() {
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  clearMessage("loginMessage");

  if (!email || !password) {
    showMessage(
      "loginMessage",
      "Please enter your email and password.",
      true
    );
    return;
  }

  toggleButton("loginButton", true, "Signing In...");

  try {
    const { data, error } =
      await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

    if (error) {
      throw error;
    }

    if (!data?.user) {
      throw new Error("Login succeeded, but no user account was returned.");
    }

    await loadApplication(data.user);
  } catch (error) {
    console.error("Login error:", error);

    showMessage(
      "loginMessage",
      error.message || "Unable to sign in.",
      true
    );
  } finally {
    toggleButton("loginButton", false, "Sign In");
  }
}

/* =========================================================
   LOAD APPLICATION
========================================================= */

async function loadApplication(user) {
  currentUser = user;

  try {
    const { data: profile, error } = await supabaseClient
      .from("profiles")
      .select(`
        id,
        email,
        full_name,
        role,
        school_id,
        active,
        schools (
          id,
          school_name
        )
      `)
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      throw new Error(`Profile error: ${error.message}`);
    }

    if (!profile) {
      throw new Error(
        "Your login worked, but your profile record has not been configured."
      );
    }

    if (profile.active === false) {
      throw new Error("Your account is inactive.");
    }

    if (!["admin", "user"].includes(profile.role)) {
      throw new Error("Your profile does not have a valid role.");
    }

    currentProfile = profile;

    await loadSchools();

    $("loginPage").classList.add("hidden");
    $("application").classList.remove("hidden");

    $("welcomeUser").textContent =
      `${profile.full_name || profile.email} (${profile.role})`;

    $("adminTab").classList.toggle(
      "hidden",
      profile.role !== "admin"
    );

    populateSchoolSelectors();

    if (profile.role === "admin") {
      $("schoolSelect").disabled = false;
    } else {
      $("schoolSelect").value = profile.school_id || "";
      $("schoolSelect").disabled = true;
    }

    await refreshAll();
  } catch (error) {
    console.error("Application loading error:", error);

    $("application").classList.add("hidden");
    $("loginPage").classList.remove("hidden");

    showMessage(
      "loginMessage",
      error.message || "The application could not be loaded.",
      true
    );

    await supabaseClient.auth.signOut();
  }
}

/* =========================================================
   LOGOUT
========================================================= */

async function logout() {
  try {
    await supabaseClient.auth.signOut();
  } catch (error) {
    console.error("Logout error:", error);
  }

  currentUser = null;
  currentProfile = null;
  schools = [];
  myEntries = [];
  adminEntries = [];

  $("application").classList.add("hidden");
  $("loginPage").classList.remove("hidden");

  $("loginPassword").value = "";
  clearMessage("loginMessage");

  showView("entryView");
}

/* =========================================================
   SCHOOLS
========================================================= */

async function loadSchools() {
  const { data, error } = await supabaseClient
    .from("schools")
    .select("id, school_name, active")
    .eq("active", true)
    .order("school_name", { ascending: true });

  if (error) {
    throw new Error(`Unable to load schools: ${error.message}`);
  }

  schools = data || [];
}

function populateSchoolSelectors() {
  const entryOptions = [
    '<option value="">Select a school</option>',
    ...schools.map(
      (school) =>
        `<option value="${school.id}">
          ${escapeHtml(school.school_name)}
        </option>`
    )
  ];

  $("schoolSelect").innerHTML = entryOptions.join("");

  const adminOptions = [
    '<option value="">All schools</option>',
    ...schools.map(
      (school) =>
        `<option value="${school.id}">
          ${escapeHtml(school.school_name)}
        </option>`
    )
  ];

  $("adminSchoolFilter").innerHTML = adminOptions.join("");
}

/* =========================================================
   REFRESH
========================================================= */

async function refreshAll() {
  if (!currentUser || !currentProfile) {
    return;
  }

  toggleButton("refreshButton", true, "Refreshing...");

  try {
    await loadMyEntries();

    if (currentProfile.role === "admin") {
      await loadAdminEntries();
    }

    renderMyEntries();
    renderAdminDashboard();
  } catch (error) {
    console.error("Refresh error:", error);
    alert(`Refresh failed: ${error.message}`);
  } finally {
    toggleButton("refreshButton", false, "Refresh");
  }
}

/* =========================================================
   LOAD ENTRIES
========================================================= */

async function loadMyEntries() {
  const { data, error } = await supabaseClient
    .from("late_bus_entries")
    .select(`
      id,
      incident_date,
      school_id,
      bus_number,
      route_number,
      scheduled_time,
      actual_time,
      minutes_late,
      reason,
      notes,
      created_at,
      updated_at,
      schools (
        school_name
      )
    `)
    .eq("created_by", currentUser.id)
    .order("incident_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Unable to load your entries: ${error.message}`);
  }

  myEntries = data || [];
}

async function loadAdminEntries() {
  const { data, error } = await supabaseClient
    .from("late_bus_entries")
    .select(`
      id,
      incident_date,
      school_id,
      bus_number,
      route_number,
      scheduled_time,
      actual_time,
      minutes_late,
      reason,
      notes,
      created_at,
      updated_at,
      created_by,
      schools (
        school_name
      ),
      profiles!late_bus_entries_created_by_fkey (
        full_name,
        email
      )
    `)
    .order("incident_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Unable to load district entries: ${error.message}`);
  }

  adminEntries = data || [];
}

/* =========================================================
   SAVE ENTRY
========================================================= */

async function saveEntry(event) {
  event.preventDefault();

  clearMessage("entryMessage");
  calculateMinutesLate();

  const entryId = $("entryId").value;

  const schoolId = Number($("schoolSelect").value);

  const payload = {
    incident_date: $("incidentDate").value,
    school_id: schoolId,
    bus_number: $("busNumber").value.trim(),
    route_number: emptyToNull($("routeNumber").value),
    scheduled_time: $("scheduledTime").value,
    actual_time: $("actualTime").value,
    minutes_late: Number($("minutesLate").value),
    reason: emptyToNull($("reasonSelect").value),
    notes: $("notes").value.trim()
  };

  if (
    !payload.incident_date ||
    !payload.school_id ||
    !payload.bus_number ||
    !payload.scheduled_time ||
    !payload.actual_time ||
    !payload.notes
  ) {
    showMessage(
      "entryMessage",
      "Complete all required fields.",
      true
    );
    return;
  }

  if (!Number.isFinite(payload.minutes_late) || payload.minutes_late <= 0) {
    showMessage(
      "entryMessage",
      "Actual arrival must be later than the scheduled arrival.",
      true
    );
    return;
  }

  toggleButton(
    "saveEntryButton",
    true,
    entryId ? "Updating..." : "Saving..."
  );

  try {
    let result;

    if (entryId) {
      result = await supabaseClient
        .from("late_bus_entries")
        .update(payload)
        .eq("id", entryId);
    } else {
      result = await supabaseClient
        .from("late_bus_entries")
        .insert({
          ...payload,
          created_by: currentUser.id
        });
    }

    if (result.error) {
      throw result.error;
    }

    showMessage(
      "entryMessage",
      entryId
        ? "Entry updated successfully."
        : "Late bus entry saved successfully."
    );

    resetEntryForm(false);
    await refreshAll();
  } catch (error) {
    console.error("Save entry error:", error);

    const duplicateEntry =
      error.code === "23505";

    showMessage(
      "entryMessage",
      duplicateEntry
        ? "A matching entry already exists for this bus, school, date, and scheduled time."
        : error.message,
      true
    );
  } finally {
    toggleButton(
      "saveEntryButton",
      false,
      entryId ? "Update Entry" : "Save Entry"
    );
  }
}

/* =========================================================
   CALCULATE MINUTES LATE
========================================================= */

function calculateMinutesLate() {
  const scheduled = $("scheduledTime").value;
  const actual = $("actualTime").value;

  if (!scheduled || !actual) {
    $("minutesLate").value = "";
    return;
  }

  const scheduledMinutes = timeToMinutes(scheduled);
  let actualMinutes = timeToMinutes(actual);

  if (actualMinutes < scheduledMinutes) {
    actualMinutes += 24 * 60;
  }

  $("minutesLate").value =
    Math.max(0, actualMinutes - scheduledMinutes);
}

function timeToMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);

  return hours * 60 + minutes;
}

/* =========================================================
   MY ENTRIES
========================================================= */

function getFilteredMyEntries() {
  const month = $("myMonthFilter").value;
  const search = $("mySearchFilter").value.trim().toLowerCase();

  return myEntries.filter((entry) => {
    const matchesMonth =
      !month || entry.incident_date.startsWith(month);

    const searchableText = [
      entry.bus_number,
      entry.route_number,
      entry.reason,
      entry.notes,
      entry.schools?.school_name
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchesSearch =
      !search || searchableText.includes(search);

    return matchesMonth && matchesSearch;
  });
}

function renderMyEntries() {
  const filteredEntries = getFilteredMyEntries();

  $("myEntriesBody").innerHTML = filteredEntries
    .map(
      (entry) => `
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
            <button
              class="small-button edit-button"
              onclick="editEntry('${entry.id}', false)"
            >
              Edit
            </button>

            <button
              class="small-button delete-button"
              onclick="deleteEntry('${entry.id}')"
            >
              Delete
            </button>
          </td>
        </tr>
      `
    )
    .join("");

  $("myEntriesEmpty").classList.toggle(
    "hidden",
    filteredEntries.length > 0
  );
}

/* =========================================================
   ADMIN ENTRIES
========================================================= */

function getFilteredAdminEntries() {
  const month = $("adminMonthFilter").value;
  const schoolId = $("adminSchoolFilter").value;
  const search = $("adminSearchFilter").value.trim().toLowerCase();

  return adminEntries.filter((entry) => {
    const matchesMonth =
      !month || entry.incident_date.startsWith(month);

    const matchesSchool =
      !schoolId || String(entry.school_id) === schoolId;

    const searchableText = [
      entry.bus_number,
      entry.route_number,
      entry.reason,
      entry.notes,
      entry.schools?.school_name,
      entry.profiles?.full_name,
      entry.profiles?.email
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchesSearch =
      !search || searchableText.includes(search);

    return matchesMonth && matchesSchool && matchesSearch;
  });
}

/* =========================================================
   ADMIN DASHBOARD
========================================================= */

function renderAdminDashboard() {
  if (!currentProfile || currentProfile.role !== "admin") {
    return;
  }

  const filteredEntries = getFilteredAdminEntries();
  const month = $("adminMonthFilter").value;

  const monthEntries = adminEntries.filter((entry) => {
    return !month || entry.incident_date.startsWith(month);
  });

  const totalIncidents = monthEntries.length;

  const nonBillableIncidents =
    Math.min(totalIncidents, PENALTY_FREE_INCIDENTS);

  const billableIncidents =
    Math.max(0, totalIncidents - PENALTY_FREE_INCIDENTS);

  const amountDue =
    billableIncidents * PENALTY_PER_ADDITIONAL_INCIDENT;

  const schoolsReporting =
    new Set(monthEntries.map((entry) => entry.school_id)).size;

  $("metricIncidents").textContent = totalIncidents;
  $("metricFree").textContent = nonBillableIncidents;
  $("metricBillable").textContent = billableIncidents;
  $("metricAmount").textContent = formatCurrency(amountDue);
  $("metricSchools").textContent =
    `${schoolsReporting} / ${schools.length || 38}`;

  $("billingTotal").textContent = totalIncidents;
  $("billingCount").textContent = billableIncidents;
  $("billingEquation").textContent =
    `${billableIncidents} × $${PENALTY_PER_ADDITIONAL_INCIDENT}`;
  $("billingAmount").textContent = formatCurrency(amountDue);

  renderSchoolSummary(monthEntries);

  $("adminEntriesBody").innerHTML = filteredEntries
    .map(
      (entry) => `
        <tr>
          <td>${formatDate(entry.incident_date)}</td>
          <td>${escapeHtml(entry.schools?.school_name || "")}</td>
          <td>${escapeHtml(entry.bus_number)}</td>
          <td>${escapeHtml(entry.route_number || "")}</td>
          <td>${formatTime(entry.scheduled_time)}</td>
          <td>${formatTime(entry.actual_time)}</td>
          <td>${entry.minutes_late}</td>
          <td>${escapeHtml(entry.reason || "")}</td>
          <td>
            ${escapeHtml(
              entry.profiles?.full_name ||
              entry.profiles?.email ||
              ""
            )}
          </td>
          <td class="notes-cell">${escapeHtml(entry.notes)}</td>
          <td class="actions-cell">
            <button
              class="small-button edit-button"
              onclick="editEntry('${entry.id}', true)"
            >
              Edit
            </button>

            <button
              class="small-button delete-button"
              onclick="deleteEntry('${entry.id}')"
            >
              Delete
            </button>
          </td>
        </tr>
      `
    )
    .join("");

  $("adminEntriesEmpty").classList.toggle(
    "hidden",
    filteredEntries.length > 0
  );
}

function renderSchoolSummary(entries) {
  const counts = {};

  entries.forEach((entry) => {
    const schoolName =
      entry.schools?.school_name || "Unknown School";

    counts[schoolName] = (counts[schoolName] || 0) + 1;
  });

  const rows = Object.entries(counts)
    .sort((a, b) => {
      return b[1] - a[1] || a[0].localeCompare(b[0]);
    })
    .map(
      ([schoolName, count]) => `
        <tr>
          <td>${escapeHtml(schoolName)}</td>
          <td>${count}</td>
        </tr>
      `
    );

  $("schoolSummaryBody").innerHTML =
    rows.join("") ||
    '<tr><td colspan="2">No entries for this month.</td></tr>';
}

/* =========================================================
   EDIT ENTRY
========================================================= */

function editEntry(id, fromAdmin = false) {
  const source = fromAdmin ? adminEntries : myEntries;

  const entry = source.find((item) => item.id === id);

  if (!entry) {
    alert("Entry not found.");
    return;
  }

  $("entryId").value = entry.id;
  $("incidentDate").value = entry.incident_date;
  $("schoolSelect").value = entry.school_id;
  $("busNumber").value = entry.bus_number;
  $("routeNumber").value = entry.route_number || "";
  $("scheduledTime").value =
    entry.scheduled_time?.slice(0, 5) || "";
  $("actualTime").value =
    entry.actual_time?.slice(0, 5) || "";
  $("minutesLate").value = entry.minutes_late;
  $("reasonSelect").value = entry.reason || "";
  $("notes").value = entry.notes || "";

  $("saveEntryButton").textContent = "Update Entry";
  $("cancelEditButton").classList.remove("hidden");

  if (currentProfile.role === "admin") {
    $("schoolSelect").disabled = false;
  }

  showView("entryView");

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

/* =========================================================
   DELETE ENTRY
========================================================= */

async function deleteEntry(id) {
  const confirmed = confirm(
    "Delete this late bus entry? This cannot be undone."
  );

  if (!confirmed) {
    return;
  }

  try {
    const { error } = await supabaseClient
      .from("late_bus_entries")
      .delete()
      .eq("id", id);

    if (error) {
      throw error;
    }

    await refreshAll();
  } catch (error) {
    console.error("Delete error:", error);
    alert(`Unable to delete entry: ${error.message}`);
  }
}

/* =========================================================
   RESET FORM
========================================================= */

function resetEntryForm(clearMessageToo = true) {
  $("lateBusForm").reset();

  $("entryId").value = "";
  $("incidentDate").value = getToday();
  $("minutesLate").value = "";

  $("saveEntryButton").textContent = "Save Entry";
  $("cancelEditButton").classList.add("hidden");

  if (currentProfile?.role === "admin") {
    $("schoolSelect").disabled = false;
  } else {
    $("schoolSelect").value =
      currentProfile?.school_id || "";

    $("schoolSelect").disabled = true;
  }

  if (clearMessageToo) {
    clearMessage("entryMessage");
  }
}

/* =========================================================
   VIEW NAVIGATION
========================================================= */

function showView(viewId) {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.add("hidden");
  });

  const selectedView = $(viewId);

  if (selectedView) {
    selectedView.classList.remove("hidden");
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle(
      "active",
      tab.dataset.view === viewId
    );
  });

  if (viewId === "myEntriesView") {
    renderMyEntries();
  }

  if (viewId === "adminView") {
    renderAdminDashboard();
  }
}

/* =========================================================
   EXPORTS
========================================================= */

function exportMyEntries() {
  const rows = getFilteredMyEntries();

  downloadEntriesCsv(
    rows,
    `my-late-bus-entries-${$("myMonthFilter").value || "all"}.csv`,
    false
  );
}

function exportAdminDetail() {
  const rows = getFilteredAdminEntries();

  downloadEntriesCsv(
    rows,
    `district-late-bus-detail-${
      $("adminMonthFilter").value || "all"
    }.csv`,
    true
  );
}

function exportBillingSummary() {
  const month = $("adminMonthFilter").value;

  const rows = adminEntries.filter((entry) => {
    return !month || entry.incident_date.startsWith(month);
  });

  const billableIncidents =
    Math.max(0, rows.length - PENALTY_FREE_INCIDENTS);

  const amountDue =
    billableIncidents * PENALTY_PER_ADDITIONAL_INCIDENT;

  const schoolCounts = {};

  rows.forEach((entry) => {
    const schoolName =
      entry.schools?.school_name || "Unknown School";

    schoolCounts[schoolName] =
      (schoolCounts[schoolName] || 0) + 1;
  });

  const csvRows = [
    ["Transportation Penalty Billing Summary"],
    ["Month", month || "All"],
    ["Total Late Incidents", rows.length],
    [
      "Non-Billable Incidents",
      Math.min(rows.length, PENALTY_FREE_INCIDENTS)
    ],
    ["Billable Incidents", billableIncidents],
    [
      "Penalty Per Billable Incident",
      PENALTY_PER_ADDITIONAL_INCIDENT
    ],
    ["Total Amount Due", amountDue],
    [],
    ["School", "Late Incidents"],
    ...Object.entries(schoolCounts).sort(
      (a, b) => b[1] - a[1]
    )
  ];

  downloadCsv(
    csvRows,
    `transportation-penalty-billing-${month || "all"}.csv`
  );
}

function downloadEntriesCsv(rows, filename, includeUser) {
  const header = [
    "Date",
    "School",
    "Bus Number",
    "Route",
    "Scheduled Arrival",
    "Actual Arrival",
    "Minutes Late",
    "Reason",
    ...(includeUser
      ? ["Entered By", "User Email"]
      : []),
    "Notes"
  ];

  const data = rows.map((entry) => [
    entry.incident_date,
    entry.schools?.school_name || "",
    entry.bus_number,
    entry.route_number || "",
    entry.scheduled_time?.slice(0, 5) || "",
    entry.actual_time?.slice(0, 5) || "",
    entry.minutes_late,
    entry.reason || "",
    ...(includeUser
      ? [
          entry.profiles?.full_name || "",
          entry.profiles?.email || ""
        ]
      : []),
    entry.notes
  ]);

  downloadCsv([header, ...data], filename);
}

function downloadCsv(rows, filename) {
  const csv = rows
    .map((row) =>
      row
        .map((value) =>
          `"${String(value ?? "").replace(/"/g, '""')}"`
        )
        .join(",")
    )
    .join("\r\n");

  const blob = new Blob(
    ["\uFEFF" + csv],
    { type: "text/csv;charset=utf-8;" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

/* =========================================================
   DATE AND TIME HELPERS
========================================================= */

function setDefaultDates() {
  if ($("incidentDate")) {
    $("incidentDate").value = getToday();
  }

  if ($("adminMonthFilter")) {
    $("adminMonthFilter").value = getCurrentMonth();
  }
}

function getToday() {
  const now = new Date();

  const localDate = new Date(
    now.getTime() - now.getTimezoneOffset() * 60000
  );

  return localDate.toISOString().slice(0, 10);
}

function getCurrentMonth() {
  return getToday().slice(0, 7);
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  const [year, month, day] = value.split("-");

  return `${month}-${day}-${year}`;
}

function formatTime(value) {
  if (!value) {
    return "";
  }

  const [hourText, minute] =
    value.slice(0, 5).split(":");

  let hour = Number(hourText);

  const suffix = hour >= 12 ? "PM" : "AM";

  hour = hour % 12 || 12;

  return `${hour}:${minute} ${suffix}`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(value);
}

/* =========================================================
   GENERAL HELPERS
========================================================= */

function emptyToNull(value) {
  const trimmed = String(value ?? "").trim();

  return trimmed ? trimmed : null;
}

function showMessage(id, text, isError = false) {
  const element = $(id);

  if (!element) {
    return;
  }

  element.textContent = text;
  element.className =
    `message ${isError ? "error" : "success"}`;
}

function clearMessage(id) {
  const element = $(id);

  if (!element) {
    return;
  }

  element.textContent = "";
  element.className = "message";
}

function toggleButton(id, disabled, text) {
  const button = $(id);

  if (!button) {
    return;
  }

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
```

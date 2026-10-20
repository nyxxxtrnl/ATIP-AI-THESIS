"use strict";

const $ = id => document.getElementById(id);
const DARK_MODE_KEY = "atip_demo_psychiatrist_dark_mode";
let currentUser;
let clients = [];
let results = [];
let appointments = [];
let selectedMessageClient = "";

function setNotice(id, text, isError = false) {
  const notice = $(id);
  notice.textContent = text;
  notice.classList.toggle("error", isError);
  notice.hidden = !text;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
}

function showTab(tabId) {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const panels = [...document.querySelectorAll('[role="tabpanel"]')];
  const selected = tabs.find(tab => tab.getAttribute("aria-controls") === tabId);
  if (!selected) return;
  tabs.forEach(tab => {
    const active = tab === selected;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  panels.forEach(panel => { panel.hidden = panel.id !== tabId; });
  $("pageTitle").textContent = tabId === "dashboard"
    ? "Psychiatrist Dashboard"
    : selected.textContent.trim();
}

document.querySelectorAll('[role="tab"]').forEach(tab => {
  tab.addEventListener("click", event => {
    event.preventDefault();
    const tabId = tab.getAttribute("aria-controls");
    setMobileNavOpen(false);
    showTab(tabId);
    window.location.hash = tabId;
  });
});

function setMobileNavOpen(open) {
  document.body.classList.toggle("mobile-nav-open", open);
  $("mobileNavToggle").setAttribute("aria-expanded", String(open));
  $("mobileNavBackdrop").hidden = !open;
}

$("mobileNavToggle").addEventListener("click", () => {
  setMobileNavOpen($("mobileNavToggle").getAttribute("aria-expanded") !== "true");
});
$("mobileNavBackdrop").addEventListener("click", () => setMobileNavOpen(false));
document.addEventListener("keydown", event => {
  if (event.key === "Escape") setMobileNavOpen(false);
});

let navigationTouchStart;
document.addEventListener("touchstart", event => {
  if (event.touches.length !== 1) return;
  navigationTouchStart = {
    x: event.touches[0].clientX,
    y: event.touches[0].clientY
  };
}, { passive: true });
document.addEventListener("touchend", event => {
  if (!navigationTouchStart || !event.changedTouches.length) return;
  const touch = event.changedTouches[0];
  const deltaX = touch.clientX - navigationTouchStart.x;
  const deltaY = touch.clientY - navigationTouchStart.y;
  const startedAtLeftEdge = navigationTouchStart.x <= 24;
  navigationTouchStart = undefined;
  if (Math.abs(deltaX) < 60 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
  if (startedAtLeftEdge && deltaX > 0) setMobileNavOpen(true);
  else if (document.body.classList.contains("mobile-nav-open") && deltaX < 0) {
    setMobileNavOpen(false);
  }
}, { passive: true });

document.querySelector('[role="tablist"]').addEventListener("keydown", event => {
  const isMobile = window.matchMedia("(max-width: 600px)").matches;
  const keys = isMobile ? ["ArrowRight", "ArrowLeft"] : ["ArrowDown", "ArrowUp"];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const tabs = [...document.querySelectorAll('[role="tab"]')]
    .filter(tab => !isMobile || tab.classList.contains("mobile-primary"));
  const index = Math.max(0, tabs.indexOf(document.activeElement));
  const offset = event.key === (isMobile ? "ArrowRight" : "ArrowDown") ? 1 : -1;
  const next = tabs[(index + offset + tabs.length) % tabs.length];
  next.focus();
  next.click();
});

function updateTabOrientation() {
  document.querySelector('[role="tablist"]').setAttribute(
    "aria-orientation",
    window.matchMedia("(max-width: 600px)").matches ? "horizontal" : "vertical"
  );
}

updateTabOrientation();
window.addEventListener("resize", updateTabOrientation);

document.querySelectorAll("[data-tab-target]").forEach(button => {
  button.addEventListener("click", () => {
    const tabId = button.dataset.tabTarget;
    showTab(tabId);
    window.location.hash = tabId;
  });
});

$("mobileProfileSettings").addEventListener("click", () => $("settingsAction").click());

window.addEventListener("hashchange", () => {
  showTab(window.location.hash.slice(1) || "dashboard");
});
showTab(window.location.hash.slice(1) || "dashboard");

function applyDarkMode(enabled) {
  document.body.classList.toggle("dark-mode", enabled);
  $("darkModeAction").textContent = "Dark mode: " + (enabled ? "On" : "Off");
  $("darkModeAction").setAttribute("aria-pressed", String(enabled));
}

function closeAccountMenu() {
  $("accountMenu").hidden = true;
  $("accountMenuButton").setAttribute("aria-expanded", "false");
}

function statusKey(value) {
  const state = String(value || "").toLowerCase();
  if (/\b(at[\s-]?risk|high risk|elevated risk)\b/.test(state)) return "atRisk";
  if (/\b(improving|improved)\b/.test(state)) return "improving";
  if (/\bstable\b/.test(state)) return "stable";
  return "";
}

function latestResultByClient() {
  const latest = new Map();
  [...results].sort((a, b) =>
    new Date(b.recordedAt) - new Date(a.recordedAt)
  ).forEach(result => {
    if (!latest.has(result.clientUserId)) latest.set(result.clientUserId, result);
  });
  return latest;
}

function updateClientOptions() {
  [
    ["appointmentClient", "Choose a client"],
    ["assessmentClient", "All clients"],
    ["clinicalNoteClient", "Choose a client"]
  ]
    .forEach(([id, placeholder]) => {
      const select = $(id);
      const previous = select.value;
      const option = document.createElement("option");
      option.value = "";
      option.textContent = placeholder;
      select.replaceChildren(option);
      clients.forEach(client => {
        const item = document.createElement("option");
        item.value = String(client.id);
        item.textContent = `${client.clientId} · ${client.name || "Name unavailable"}`;
        select.appendChild(item);
      });
      if (clients.some(client => String(client.id) === previous)) select.value = previous;
    });
}

function renderOverview() {
  const latest = latestResultByClient();
  const counts = { atRisk: 0, improving: 0, stable: 0 };
  latest.forEach(result => {
    const key = statusKey(result.overallState);
    if (key) counts[key] += 1;
  });
  $("totalClients").textContent = String(clients.length);
  $("totalResults").textContent = String(results.length);
  const today = new Date().toDateString();
  $("latestUpdates").textContent = String(results.filter(item =>
    new Date(item.recordedAt).toDateString() === today
  ).length);
  $("atRiskCount").textContent = String(counts.atRisk);
  $("improvingCount").textContent = String(counts.improving);
  $("stableCount").textContent = String(counts.stable);
}

function renderClients() {
  const search = $("searchClient").value.trim().toLowerCase();
  const latest = latestResultByClient();
  const filtered = clients.filter(client =>
    `${client.clientId} ${client.name || ""}`.toLowerCase().includes(search)
  );
  const table = $("clientTable");
  table.replaceChildren();
  if (!filtered.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "empty";
    cell.textContent = search
      ? "No matching authorized clients."
      : "No clients have shared records with your account yet.";
    row.appendChild(cell);
    table.appendChild(row);
    return;
  }
  filtered.forEach(client => {
    const row = document.createElement("tr");
    const result = latest.get(client.id);
    [client.clientId, result?.overallState || "No result", result?.recordedAt
      ? formatDate(result.recordedAt)
      : "Not recorded"].forEach(text => {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.appendChild(cell);
    });
    const actionCell = document.createElement("td");
    const button = document.createElement("button");
    button.className = "small-btn";
    button.textContent = "View Results";
    button.addEventListener("click", () => {
      $("assessmentClient").value = String(client.id);
      renderAssessments();
      showTab("assessments");
      window.location.hash = "assessments";
    });
    actionCell.appendChild(button);
    row.appendChild(actionCell);
    table.appendChild(row);
  });
}

function renderResultRows(container, records, { showClient = true } = {}) {
  container.replaceChildren();
  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No assessment results are available for this client.";
    container.appendChild(empty);
    return;
  }
  [...records].sort((a, b) =>
    new Date(b.recordedAt) - new Date(a.recordedAt)
  ).forEach(item => {
    const row = document.createElement("article");
    row.className = "result-row";
    const info = document.createElement("div");
    const title = document.createElement("h3");
    const details = document.createElement("p");
    title.textContent = showClient
      ? `Client: ${item.clientId}`
      : item.overallState || "Result recorded";
    details.textContent =
      `Recorded: ${formatDate(item.recordedAt)} · Source: ${item.source || "Connected system"}` +
      (item.summary ? ` · ${item.summary}` : "");
    info.append(title, details);
    const value = document.createElement("div");
    value.className = "result-value";
    value.textContent = item.overallState || "Result recorded";
    row.append(info, value);
    container.appendChild(row);
  });
}

function renderAssessments() {
  const clientId = $("assessmentClient").value;
  const selectedResults = results.filter(result =>
    !clientId || String(result.clientUserId) === clientId
  );
  renderResultRows($("assessmentList"), selectedResults);
}

function renderResults(records = results) {
  renderResultRows($("resultsList"), records);
}

function renderAppointments() {
  const list = $("appointmentList");
  list.replaceChildren();
  if (!appointments.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No appointments have been scheduled.";
    list.appendChild(empty);
    return;
  }
  appointments.forEach(appointment => {
    const row = document.createElement("article");
    row.className = "result-row";
    const info = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = `Client: ${appointment.clientId}`;
    const details = document.createElement("p");
    details.textContent = formatDate(appointment.scheduledAt) +
      (appointment.note ? ` · ${appointment.note}` : "");
    const status = document.createElement("div");
    status.className = "result-value";
    status.textContent = appointment.status;
    info.append(title, details);
    row.append(info, status);
    list.appendChild(row);
  });
}

function renderConversationList() {
  const search = $("clientSearch").value.trim().toLowerCase();
  const list = $("conversationList");
  list.replaceChildren();
  const filtered = clients.filter(client =>
    `${client.clientId} ${client.name || ""}`.toLowerCase().includes(search)
  );
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "conversation-list-empty";
    empty.textContent = search
      ? "No clients match your search."
      : "No clients have authorized this account yet.";
    list.appendChild(empty);
    return;
  }
  filtered.forEach(client => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-client";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(String(client.id) === selectedMessageClient));
    const avatar = document.createElement("span");
    avatar.className = "conversation-avatar";
    avatar.textContent = (client.name || client.clientId).charAt(0).toUpperCase();
    const info = document.createElement("span");
    info.className = "conversation-client-info";
    const name = document.createElement("strong");
    name.textContent = client.name || "Name unavailable";
    const id = document.createElement("span");
    id.textContent = client.clientId;
    info.append(name, id);
    button.append(avatar, info);
    button.addEventListener("click", () => {
      selectedMessageClient = String(client.id);
      renderConversationList();
      loadConversation().catch(error => setNotice("messageNotice", error.message, true));
    });
    list.appendChild(button);
  });
}

async function loadConversation() {
  const client = clients.find(item => String(item.id) === selectedMessageClient);
  const empty = $("conversationEmpty");
  const messages = $("chatMessages");
  if (!client) {
    selectedMessageClient = "";
    $("conversationClientName").textContent = "Select a client";
    $("conversationClientId").textContent = "Choose a client from the list";
    $("conversationAvatar").textContent = "?";
    empty.hidden = false;
    messages.hidden = true;
    $("messageForm").hidden = true;
    messages.replaceChildren();
    return;
  }
  $("conversationClientName").textContent = client.name || "Name unavailable";
  $("conversationClientId").textContent = "Client ID: " + client.clientId;
  $("conversationAvatar").textContent =
    (client.name || client.clientId).charAt(0).toUpperCase();
  empty.hidden = true;
  messages.hidden = false;
  $("messageForm").hidden = false;
  const data = await window.atipApi.request(
    `/api/psychiatrist/clients/${encodeURIComponent(client.id)}/messages`
  );
  messages.replaceChildren();
  if (!data.messages.length) {
    const noMessages = document.createElement("p");
    noMessages.className = "chat-empty";
    noMessages.textContent = "No messages yet. Start the conversation.";
    messages.appendChild(noMessages);
  } else {
    data.messages.forEach(item => {
      const group = document.createElement("article");
      group.className = item.senderId === currentUser.id
        ? "chat-message-group"
        : "chat-message-group received";
      const bubble = document.createElement("p");
      bubble.className = "chat-bubble";
      bubble.textContent = item.text;
      const timestamp = document.createElement("time");
      timestamp.className = "chat-timestamp";
      timestamp.dateTime = item.sentAt;
      timestamp.textContent = formatDate(item.sentAt);
      group.append(bubble, timestamp);
      messages.appendChild(group);
    });
  }
  messages.scrollTop = messages.scrollHeight;
}

async function loadClinicalNotes() {
  const clientId = $("clinicalNoteClient").value;
  const list = $("clinicalNotesList");
  list.replaceChildren();
  if (!clientId) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Choose an authorized client to view your private notes.";
    list.appendChild(empty);
    return;
  }
  const { notes } = await window.atipApi.request(
    `/api/psychiatrist/clients/${encodeURIComponent(clientId)}/notes`
  );
  if (!notes.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "You have no private notes for this client.";
    list.appendChild(empty);
    return;
  }
  notes.forEach(note => {
    const row = document.createElement("article");
    row.className = "result-row";
    const text = document.createElement("p");
    text.className = "saved-message-text";
    text.textContent = note.text;
    const time = document.createElement("time");
    time.className = "chat-timestamp";
    time.textContent = formatDate(note.createdAt);
    row.append(text, time);
    list.appendChild(row);
  });
}

async function refreshDashboard() {
  const data = await window.atipApi.request("/api/psychiatrist/dashboard");
  currentUser = data.user;
  clients = data.clients;
  results = data.results;
  const appointmentData = await window.atipApi.request("/api/psychiatrist/appointments");
  appointments = appointmentData.appointments;
  $("professionalAccountInfo").textContent = `${currentUser.name} · ${currentUser.email}`;
  renderOverview();
  updateClientOptions();
  renderClients();
  renderResults();
  renderAssessments();
  renderAppointments();
  renderConversationList();
  if ($("clinicalNoteClient").value &&
      !clients.some(client => String(client.id) === $("clinicalNoteClient").value)) {
    $("clinicalNoteClient").value = "";
  }
  await loadClinicalNotes();
  if (selectedMessageClient && !clients.some(
    client => String(client.id) === selectedMessageClient
  )) selectedMessageClient = "";
  await loadConversation();
}

$("accountMenuButton").addEventListener("click", () => {
  const isOpen = $("accountMenuButton").getAttribute("aria-expanded") === "true";
  $("accountMenu").hidden = isOpen;
  $("accountMenuButton").setAttribute("aria-expanded", String(!isOpen));
});
$("settingsAction").addEventListener("click", () => {
  closeAccountMenu();
  $("settingsDialog").hidden = false;
  $("closeSettings").focus();
});
$("closeSettings").addEventListener("click", () => {
  $("settingsDialog").hidden = true;
  $("accountMenuButton").focus();
});
$("settingsDialog").addEventListener("click", event => {
  if (event.target === $("settingsDialog")) $("settingsDialog").hidden = true;
});
$("darkModeAction").addEventListener("click", () => {
  const enabled = !document.body.classList.contains("dark-mode");
  localStorage.setItem(DARK_MODE_KEY, String(enabled));
  applyDarkMode(enabled);
});
$("logoutAction").addEventListener("click", async () => {
  closeAccountMenu();
  if (!confirm("Log out and return to the ATIP AI login page?")) return;
  try {
    await window.atipApi.request("/api/auth/logout", { method: "POST" });
    window.location.assign("/AUTH/auth.html");
  } catch (error) {
    setNotice("messageNotice", error.message, true);
  }
});
document.addEventListener("click", event => {
  if (!event.target.closest(".account-menu")) closeAccountMenu();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    $("settingsDialog").hidden = true;
    closeAccountMenu();
  }
});

$("searchClient").addEventListener("input", renderClients);
$("clientSearch").addEventListener("input", renderConversationList);
$("assessmentClient").addEventListener("change", renderAssessments);
$("clinicalNoteClient").addEventListener("change", () => {
  loadClinicalNotes().catch(error => setNotice("clinicalNoteNotice", error.message, true));
});
$("refreshResults").addEventListener("click", () => {
  refreshDashboard().catch(error => setNotice("appointmentNotice", error.message, true));
});

$("appointmentForm").addEventListener("submit", async event => {
  event.preventDefault();
  const clientId = Number($("appointmentClient").value);
  const scheduledAt = new Date($("appointmentDate").value);
  try {
    await window.atipApi.request("/api/psychiatrist/appointments", {
      method: "POST",
      body: JSON.stringify({
        clientId,
        scheduledAt: scheduledAt.toISOString(),
        note: $("appointmentPurpose").value.trim()
      })
    });
    $("appointmentForm").reset();
    setNotice("appointmentNotice", "Appointment scheduled and added to the client's account.");
    await refreshDashboard();
  } catch (error) {
    setNotice("appointmentNotice", error.message, true);
  }
});

$("messageForm").addEventListener("submit", async event => {
  event.preventDefault();
  const text = $("messageText").value.trim();
  if (!selectedMessageClient || !text) {
    setNotice("messageNotice", "Select an authorized client and write a message.", true);
    return;
  }
  try {
    await window.atipApi.request(
      `/api/psychiatrist/clients/${encodeURIComponent(selectedMessageClient)}/messages`,
      { method: "POST", body: JSON.stringify({ text }) }
    );
    $("messageText").value = "";
    setNotice("messageNotice", "Message sent to the client's inbox.");
    await loadConversation();
  } catch (error) {
    setNotice("messageNotice", error.message, true);
  }
});

$("clinicalNoteForm").addEventListener("submit", async event => {
  event.preventDefault();
  const clientId = $("clinicalNoteClient").value;
  const text = $("clinicalNoteText").value.trim();
  if (!clientId || !text) {
    setNotice("clinicalNoteNotice", "Choose an authorized client and write a note.", true);
    return;
  }
  try {
    await window.atipApi.request(
      `/api/psychiatrist/clients/${encodeURIComponent(clientId)}/notes`,
      { method: "POST", body: JSON.stringify({ text }) }
    );
    $("clinicalNoteText").value = "";
    setNotice("clinicalNoteNotice", "Private note saved.");
    await loadClinicalNotes();
  } catch (error) {
    setNotice("clinicalNoteNotice", error.message, true);
  }
});

$("exportReport").addEventListener("click", () => {
  if (!results.length) {
    setNotice("messageNotice", "There are no authorized results to export.", true);
    return;
  }
  const columns = ["clientId", "clientName", "overallState", "recordedAt", "source", "summary"];
  const cell = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [
    columns.join(","),
    ...results.map(result => columns.map(key => cell(result[key])).join(","))
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8;"
  }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "atip-wellness-report.csv";
  link.click();
  URL.revokeObjectURL(url);
});

applyDarkMode(localStorage.getItem(DARK_MODE_KEY) === "true");
window.atipApi.account("psychiatrist")
  .then(refreshDashboard)
  .catch(error => setNotice("messageNotice", error.message, true));

setInterval(() => {
  if (document.visibilityState === "visible" && selectedMessageClient) {
    loadConversation().catch(error => setNotice("messageNotice", error.message, true));
  }
}, 10000);

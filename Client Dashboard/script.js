"use strict";

const $ = id => document.getElementById(id);
const DARK_MODE_KEY = "atip_demo_dark_mode";
let currentUser;
let connections = [];
let selectedPsychiatristId = "";

function showTab(tabId) {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const panels = [...document.querySelectorAll('[role="tabpanel"]')];
  const selectedTab = tabs.find(tab => tab.getAttribute("aria-controls") === tabId);
  if (!selectedTab) return;

  tabs.forEach(tab => {
    const selected = tab === selectedTab;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  panels.forEach(panel => { panel.hidden = panel.id !== tabId; });
  $("pageTitle").textContent = tabId === "dashboard"
    ? "My Wellness Dashboard"
    : selectedTab.textContent.trim();
  const selectedPanel = panels.find(panel => panel.id === tabId);
  const description = selectedPanel.querySelector(".panel-heading p");
  $("pageDescription").textContent = description
    ? description.textContent
    : "Your personal emotional wellness space.";
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
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault();
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const currentIndex = Math.max(0, tabs.indexOf(document.activeElement));
  const step = event.key === "ArrowDown" ? 1 : -1;
  const next = tabs[(currentIndex + step + tabs.length) % tabs.length];
  next.focus();
  next.click();
});

window.addEventListener("hashchange", () => {
  showTab(window.location.hash.slice(1) || "dashboard");
});
showTab(window.location.hash.slice(1) || "dashboard");

function setNotice(id, text, isError = false) {
  const notice = $(id);
  if (!notice) return;
  notice.textContent = text;
  notice.classList.toggle("error", isError);
  notice.hidden = !text;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
}

function applyDarkMode(enabled) {
  document.body.classList.toggle("dark-mode", enabled);
  $("darkModeAction").textContent = "Dark mode: " + (enabled ? "On" : "Off");
  $("darkModeAction").setAttribute("aria-pressed", String(enabled));
}

function renderProfile() {
  const name = currentUser.name || "Client";
  $("clientName").textContent = name;
  $("welcomeName").textContent = name;
  $("clientAvatar").textContent = name.charAt(0).toUpperCase();
  $("clientIdLabel").textContent = "ID: " + currentUser.clientId;
  $("clientIdInput").value = currentUser.clientId;
  $("nameInput").value = currentUser.name;
}

function renderResults(results) {
  const latest = $("latestResult");
  const history = $("historyTable");
  latest.replaceChildren();
  history.replaceChildren();

  if (!results.length) {
    latest.className = "latest-result";
    const icon = document.createElement("div");
    icon.className = "empty-icon";
    icon.textContent = "♡";
    const title = document.createElement("h3");
    title.textContent = "No results yet";
    const explanation = document.createElement("p");
    explanation.textContent = "Your results will appear here when the connected system records one.";
    latest.append(icon, title, explanation);
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.className = "empty";
    cell.textContent = "No history available yet.";
    row.appendChild(cell);
    history.appendChild(row);
    return;
  }

  latest.className = "latest-result has-result";
  const title = document.createElement("h3");
  title.textContent = results[0].overallState || "Result recorded";
  const date = document.createElement("p");
  date.textContent = "Recorded: " + formatDate(results[0].recordedAt);
  const summary = document.createElement("p");
  summary.textContent = results[0].summary ||
    "This is a recorded wellness indicator, not a medical diagnosis.";
  latest.append(title, date, summary);

  results.forEach(item => {
    const row = document.createElement("tr");
    [formatDate(item.recordedAt), item.overallState || "Recorded", item.source || "Connected system"]
      .forEach(value => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });
    history.appendChild(row);
  });
}

function renderConnections() {
  const list = $("connectionList");
  list.replaceChildren();
  const conversationList = $("clientConversationList");
  const search = $("psychiatristSearch").value.trim().toLowerCase();
  conversationList.replaceChildren();
  $("conversationCount").textContent = String(connections.length);

  if (!connections.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No psychiatrist accounts are currently connected.";
    list.appendChild(empty);
    selectedPsychiatristId = "";
    renderConversation();
    return;
  }

  connections.forEach(connection => {
    const row = document.createElement("article");
    row.className = "journal-entry connection-row";
    const info = document.createElement("p");
    info.textContent = `${connection.name} · ${connection.email} · Connected ${formatDate(connection.consented_at)}`;
    const revoke = document.createElement("button");
    revoke.type = "button";
    revoke.className = "secondary-btn";
    revoke.textContent = "Revoke access";
    revoke.addEventListener("click", () => revokeConnection(connection.id));
    row.append(info, revoke);
    list.appendChild(row);
  });

  const filtered = connections.filter(connection =>
    `${connection.name} ${connection.email}`.toLowerCase().includes(search)
  );
  if (!filtered.some(connection => String(connection.id) === selectedPsychiatristId)) {
    selectedPsychiatristId = filtered.length ? String(filtered[0].id) : "";
  }
  if (filtered.length === 0) {
    const empty = document.createElement("p");
    empty.className = "client-conversation-empty";
    empty.textContent = "No conversations match your search.";
    conversationList.appendChild(empty);
  } else {
    filtered.forEach(connection => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "client-conversation-item";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected",
        String(String(connection.id) === selectedPsychiatristId));
      const avatar = document.createElement("span");
      avatar.className = "client-conversation-avatar";
      avatar.textContent = (connection.name || "P").charAt(0).toUpperCase();
      const details = document.createElement("span");
      details.className = "client-conversation-details";
      const name = document.createElement("strong");
      name.textContent = connection.name;
      const email = document.createElement("span");
      email.textContent = connection.email;
      details.append(name, email);
      button.append(avatar, details);
      button.addEventListener("click", () => {
        selectedPsychiatristId = String(connection.id);
        renderConnections();
        loadMessages().catch(error =>
          setNotice("clientMessageNotice", error.message, true)
        );
      });
      conversationList.appendChild(button);
    });
  }
  renderConversation();
}

async function refreshConnections() {
  const data = await window.atipApi.request("/api/client/connections");
  connections = data.connections;
  renderConnections();
  await loadMessages();
}

async function loadMessages() {
  const psychiatristId = selectedPsychiatristId;
  const container = $("clientChatMessages");
  container.replaceChildren();
  if (!psychiatristId) {
    const empty = document.createElement("div");
    empty.className = "client-chat-empty";
    const heading = document.createElement("strong");
    heading.textContent = connections.length
      ? "No conversations found"
      : "Your conversations, all in one place";
    const description = document.createElement("p");
    description.textContent = connections.length
      ? "Try another search or choose a psychiatrist from your inbox."
      : "Connect with a psychiatrist to securely start a conversation.";
    empty.append(heading, description);
    container.appendChild(empty);
    return;
  }
  const { messages } = await window.atipApi.request(
    `/api/client/messages/${encodeURIComponent(psychiatristId)}`
  );
  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "client-chat-empty";
    const heading = document.createElement("strong");
    heading.textContent = "Start the conversation";
    const description = document.createElement("p");
    description.textContent = "Send a message to your psychiatrist using the box below.";
    empty.append(heading, description);
    container.appendChild(empty);
    return;
  }
  messages.forEach(message => {
    const bubble = document.createElement("article");
    bubble.className = message.senderId === currentUser.id
      ? "client-chat-bubble sent"
      : "client-chat-bubble received";
    const text = document.createElement("p");
    text.textContent = message.text;
    const time = document.createElement("time");
    time.textContent = formatDate(message.sentAt);
    bubble.append(text, time);
    container.appendChild(bubble);
  });
  container.scrollTop = container.scrollHeight;
}

function renderConversation() {
  const connection = connections.find(item =>
    String(item.id) === selectedPsychiatristId
  );
  const form = $("clientMessageForm");
  if (!connection) {
    $("conversationPsychiatristAvatar").textContent = "?";
    $("conversationPsychiatristName").textContent = "Your messages";
    $("conversationPsychiatristStatus").textContent =
      "Select a conversation to get started";
    form.hidden = true;
    return;
  }
  $("conversationPsychiatristAvatar").textContent =
    (connection.name || "P").charAt(0).toUpperCase();
  $("conversationPsychiatristName").textContent = connection.name;
  $("conversationPsychiatristStatus").textContent =
    "Authorized psychiatrist · Private conversation";
  form.hidden = false;
}

async function loadDashboard() {
  const [profileData, resultData, appointmentData] = await Promise.all([
    window.atipApi.request("/api/client/profile"),
    window.atipApi.request("/api/client/results"),
    window.atipApi.request("/api/client/appointments")
  ]);
  currentUser = profileData.user;
  renderProfile();
  renderResults(resultData.results);
  const appointmentList = $("clientAppointmentList");
  appointmentList.replaceChildren();
  if (!appointmentData.appointments.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No appointments have been scheduled.";
    appointmentList.appendChild(empty);
  } else {
    appointmentData.appointments.forEach(appointment => {
      const row = document.createElement("article");
      row.className = "journal-entry";
      const title = document.createElement("strong");
      title.textContent = appointment.status === "scheduled" ? "Scheduled appointment" : appointment.status;
      const details = document.createElement("p");
      details.textContent = `${formatDate(appointment.scheduledAt)} · ${appointment.psychiatristName}` +
        (appointment.note ? ` · ${appointment.note}` : "");
      row.append(title, details);
      appointmentList.appendChild(row);
    });
  }
  await refreshConnections();
}

async function revokeConnection(psychiatristId) {
  if (!confirm("Revoke this psychiatrist's access to your records and messages?")) return;
  try {
    await window.atipApi.request(`/api/client/connect/${psychiatristId}`, {
      method: "DELETE"
    });
    setNotice("clientNotice", "Psychiatrist access revoked.");
    await refreshConnections();
  } catch (error) {
    setNotice("clientNotice", error.message, true);
  }
}

function applyAccountDropdown() {
  const button = $("accountMenuButton");
  const isOpen = button.getAttribute("aria-expanded") === "true";
  $("accountMenu").hidden = isOpen;
  button.setAttribute("aria-expanded", String(!isOpen));
}

$("accountMenuButton").addEventListener("click", applyAccountDropdown);
$("settingsAction").addEventListener("click", () => {
  $("accountMenu").hidden = true;
  $("accountMenuButton").setAttribute("aria-expanded", "false");
  showTab("settings");
  window.location.hash = "settings";
});
$("addAccountAction").addEventListener("click", () => {
  $("accountMenu").hidden = true;
  $("providerStatus").textContent =
    "Social sign-in is not configured. Google, Facebook, and Discord require provider credentials and a secure OAuth callback.";
  $("providerStatus").hidden = false;
  $("providerDialog").hidden = false;
  $("closeProviderDialog").focus();
});
$("closeProviderDialog").addEventListener("click", () => {
  $("providerDialog").hidden = true;
  $("accountMenuButton").focus();
});
$("providerDialog").addEventListener("click", event => {
  if (event.target === $("providerDialog")) $("providerDialog").hidden = true;
});
document.querySelectorAll("[data-provider]").forEach(button => {
  button.addEventListener("click", () => {
    $("providerStatus").textContent =
      `${button.dataset.provider} sign-in is not configured. OAuth credentials and a secure callback are required.`;
    $("providerStatus").hidden = false;
  });
});
$("darkModeAction").addEventListener("click", () => {
  const enabled = !document.body.classList.contains("dark-mode");
  localStorage.setItem(DARK_MODE_KEY, String(enabled));
  applyDarkMode(enabled);
});
$("logoutAction").addEventListener("click", async () => {
  $("accountMenu").hidden = true;
  if (!confirm("Log out of your ATIP account?")) return;
  try {
    await window.atipApi.request("/api/auth/logout", { method: "POST" });
    window.location.replace("/AUTH/auth.html");
  } catch (error) {
    setNotice("clientNotice", error.message, true);
  }
});
document.addEventListener("click", event => {
  if (!event.target.closest(".account-menu")) {
    $("accountMenu").hidden = true;
    $("accountMenuButton").setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    $("providerDialog").hidden = true;
    $("accountMenu").hidden = true;
  }
});
applyDarkMode(localStorage.getItem(DARK_MODE_KEY) === "true");

$("profileForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const { user } = await window.atipApi.request("/api/client/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: $("nameInput").value.trim() })
    });
    currentUser = user;
    renderProfile();
    setNotice("clientNotice", "Display name updated.");
  } catch (error) {
    setNotice("clientNotice", error.message, true);
  }
});

$("connectPsychiatristForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await window.atipApi.request("/api/client/connect", {
      method: "POST",
      body: JSON.stringify({
        psychiatristEmail: $("psychiatristEmail").value.trim(),
        consent: $("sharingConsent").checked
      })
    });
    $("connectPsychiatristForm").reset();
    setNotice("clientNotice", "Your consent was saved; the psychiatrist can now access your results.");
    await refreshConnections();
  } catch (error) {
    setNotice("clientNotice", error.message, true);
  }
});

$("psychiatristSearch").addEventListener("input", () => {
  renderConnections();
  loadMessages().catch(error => setNotice("clientMessageNotice", error.message, true));
});
$("connectFromMessages").addEventListener("click", () => {
  showTab("settings");
  window.location.hash = "settings";
  $("psychiatristEmail").focus();
});
$("clientMessageForm").addEventListener("submit", async event => {
  event.preventDefault();
  const psychiatristId = selectedPsychiatristId;
  const text = $("clientMessageText").value.trim();
  if (!psychiatristId || !text) {
    setNotice("clientMessageNotice", "Choose an authorized psychiatrist and write a message.", true);
    return;
  }
  try {
    await window.atipApi.request(`/api/client/messages/${encodeURIComponent(psychiatristId)}`, {
      method: "POST",
      body: JSON.stringify({ text })
    });
    $("clientMessageText").value = "";
    setNotice("clientMessageNotice", "Message sent.");
    await loadMessages();
  } catch (error) {
    setNotice("clientMessageNotice", error.message, true);
  }
});

window.atipApi.account("client")
  .then(loadDashboard)
  .catch(error => setNotice("clientNotice", error.message, true));

setInterval(() => {
  if (document.visibilityState === "visible" && selectedPsychiatristId) {
    loadMessages().catch(error => setNotice("clientMessageNotice", error.message, true));
  }
}, 10000);

import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const rootDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

test("auth, consent, records, appointments, messages, and revocation are enforced", async t => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "atip-api-test-"));
  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverProcess = spawn(process.execPath, ["server.mjs"], {
    cwd: rootDirectory,
    env: {
      ...process.env,
      PORT: String(port),
      ATIP_DATA_DIR: dataDirectory,
      ATIP_INGEST_API_KEY: "test-ingest-key"
    },
    stdio: ["ignore", "ignore", "inherit"]
  });

  t.after(async () => {
    serverProcess.kill();
    await new Promise(resolve => {
      if (serverProcess.exitCode !== null) return resolve();
      serverProcess.once("exit", resolve);
      setTimeout(resolve, 3000).unref();
    });
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  });

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, "server should start successfully");

  async function request(url, { cookie, origin = baseUrl, ...options } = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Origin", origin);
    if (typeof options.body === "string" && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (cookie) headers.set("Cookie", cookie);
    const response = await fetch(`${baseUrl}${url}`, { ...options, headers });
    let data = {};
    try {
      data = await response.json();
    } catch {}
    return { response, data };
  }

  const rootPage = await fetch(`${baseUrl}/`);
  assert.equal(rootPage.status, 200);
  const dashboardPage = await fetch(`${baseUrl}/Client%20Dashboard/index.html`);
  assert.equal(dashboardPage.status, 200);
  assert.equal(dashboardPage.headers.get("cache-control"), "no-store, max-age=0");
  const psychiatristScript = await fetch(
    `${baseUrl}/Psychiatrist%20Dashboard/psychiatrist.js`
  );
  assert.equal(psychiatristScript.status, 200);
  assert.equal(psychiatristScript.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal((await fetch(`${baseUrl}/api.js`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/server.mjs`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/package.json`)).status, 404);

  const blockedOrigin = await request("/api/auth/login", {
    origin: "https://attacker.example",
    method: "POST",
    body: JSON.stringify({ email: "nobody@example.test", password: "wrong-password" })
  });
  assert.equal(blockedOrigin.response.status, 403);

  const clientForm = new FormData();
  clientForm.set("role", "client");
  clientForm.set("fullName", "Test Client");
  clientForm.set("email", "client@example.test");
  clientForm.set("password", "client-password-123");
  clientForm.set("termsConsent", "true");
  const clientRegistration = await request("/api/auth/register", {
    method: "POST",
    body: clientForm
  });
  assert.equal(clientRegistration.response.status, 201);
  const clientId = clientRegistration.data.user.clientId;
  assert.match(clientId, /^ATIP-/);

  const license = new Blob([Buffer.from("%PDF-1.4\nverification-test")], {
    type: "application/pdf"
  });
  const psychiatristForm = new FormData();
  psychiatristForm.set("role", "psychiatrist");
  psychiatristForm.set("fullName", "Test Psychiatrist");
  psychiatristForm.set("email", "doctor@example.test");
  psychiatristForm.set("password", "doctor-password-123");
  psychiatristForm.set("termsConsent", "true");
  psychiatristForm.set("professionalName", "Test Psychiatrist");
  psychiatristForm.set("licenseNumber", "LICENSE-TEST-1");
  psychiatristForm.set("verificationConsent", "true");
  psychiatristForm.set("licenseDocument", license, "license.pdf");
  const psychiatristRegistration = await request("/api/auth/register", {
    method: "POST",
    body: psychiatristForm
  });
  assert.equal(psychiatristRegistration.response.status, 201);
  const psychiatristId = psychiatristRegistration.data.user.id;

  const pendingLogin = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "doctor@example.test",
      password: "doctor-password-123"
    })
  });
  assert.equal(pendingLogin.response.status, 403);

  execFileSync(process.execPath, [
    path.join(rootDirectory, "scripts", "psychiatrists.mjs"),
    "approve",
    String(psychiatristId)
  ], {
    cwd: rootDirectory,
    env: { ...process.env, ATIP_DATA_DIR: dataDirectory },
    stdio: "ignore"
  });

  const clientLogin = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "client@example.test",
      password: "client-password-123"
    })
  });
  assert.equal(clientLogin.response.status, 200);
  const clientCookie = clientLogin.response.headers.get("set-cookie")
    .match(/atip_session=[A-Za-z0-9_-]+/)[0];

  const unauthenticated = await request("/api/psychiatrist/dashboard");
  assert.equal(unauthenticated.response.status, 401);
  const clientForbidden = await request("/api/psychiatrist/dashboard", {
    cookie: clientCookie
  });
  assert.equal(clientForbidden.response.status, 403);

  const psychiatristLogin = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "doctor@example.test",
      password: "doctor-password-123"
    })
  });
  assert.equal(psychiatristLogin.response.status, 200);
  const psychiatristCookie = psychiatristLogin.response.headers.get("set-cookie")
    .match(/atip_session=[A-Za-z0-9_-]+/)[0];

  const noConsentDashboard = await request("/api/psychiatrist/dashboard", {
    cookie: psychiatristCookie
  });
  assert.equal(noConsentDashboard.data.clients.length, 0);

  const consent = await request("/api/client/connect", {
    method: "POST",
    cookie: clientCookie,
    body: JSON.stringify({
      psychiatristEmail: "doctor@example.test",
      consent: true
    })
  });
  assert.equal(consent.response.status, 201);

  const ingestion = await fetch(`${baseUrl}/api/ingest/results`, {
    method: "POST",
    headers: { Authorization: "Bearer test-ingest-key", "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId,
      overallState: "Stable",
      summary: "Test result",
      source: "Automated test"
    })
  });
  assert.equal(ingestion.status, 201);

  const dashboard = await request("/api/psychiatrist/dashboard", {
    cookie: psychiatristCookie
  });
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.data.clients.length, 1);
  assert.equal(dashboard.data.clients[0].clientId, clientId);
  assert.equal(dashboard.data.results[0].overallState, "Stable");

  const clinicalNote = await request(
    `/api/psychiatrist/clients/${clientRegistration.data.user.id}/notes`,
    {
      method: "POST",
      cookie: psychiatristCookie,
      body: JSON.stringify({ text: "Private note for this clinician only." })
    }
  );
  assert.equal(clinicalNote.response.status, 201);
  const notesForClient = await request(
    `/api/psychiatrist/clients/${clientRegistration.data.user.id}/notes`,
    { cookie: clientCookie }
  );
  assert.equal(notesForClient.response.status, 403);

  const appointment = await request("/api/psychiatrist/appointments", {
    method: "POST",
    cookie: psychiatristCookie,
    body: JSON.stringify({
      clientId: clientRegistration.data.user.id,
      scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      note: "Test appointment"
    })
  });
  assert.equal(appointment.response.status, 201);

  const clientAppointments = await request("/api/client/appointments", {
    cookie: clientCookie
  });
  assert.equal(clientAppointments.data.appointments.length, 1);
  assert.equal(clientAppointments.data.appointments[0].note, "Test appointment");

  const sentMessage = await request(
    `/api/psychiatrist/clients/${clientRegistration.data.user.id}/messages`,
    {
      method: "POST",
      cookie: psychiatristCookie,
      body: JSON.stringify({ text: "A secure test message" })
    }
  );
  assert.equal(sentMessage.response.status, 201);
  const receivedMessages = await request(
    `/api/client/messages/${psychiatristId}`,
    { cookie: clientCookie }
  );
  assert.equal(receivedMessages.data.messages[0].text, "A secure test message");

  const privateJournal = await request("/api/client/journal", {
    method: "POST",
    cookie: clientCookie,
    body: JSON.stringify({ text: "Private journal entry" })
  });
  assert.equal(privateJournal.response.status, 201);
  const clinicianJournalAccess = await request("/api/client/journal", {
    cookie: psychiatristCookie
  });
  assert.equal(clinicianJournalAccess.response.status, 403);

  const revoked = await request(`/api/client/connect/${psychiatristId}`, {
    method: "DELETE",
    cookie: clientCookie
  });
  assert.equal(revoked.response.status, 200);
  const noLongerShared = await request("/api/psychiatrist/dashboard", {
    cookie: psychiatristCookie
  });
  assert.equal(noLongerShared.data.clients.length, 0);

  const logout = await request("/api/auth/logout", {
    method: "POST",
    cookie: clientCookie
  });
  assert.equal(logout.response.status, 200);
  const repeatedLogout = await request("/api/auth/logout", {
    method: "POST",
    cookie: clientCookie
  });
  assert.equal(repeatedLogout.response.status, 200);
  const expiredSession = await request("/api/auth/me", { cookie: clientCookie });
  assert.equal(expiredSession.response.status, 200);
  assert.equal(expiredSession.data.user, null);
});

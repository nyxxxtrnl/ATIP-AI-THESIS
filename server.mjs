import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(
  process.env.ATIP_DATA_DIR || path.join(__dirname, ".data")
);
const verificationDirectory = path.join(dataDirectory, "verifications");
const databasePath = path.join(dataDirectory, "atip.sqlite");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const ingestApiKey = process.env.ATIP_INGEST_API_KEY || "";
const secureCookie = process.env.ATIP_SECURE_COOKIE === "true";
const sessionDurationMs = 7 * 24 * 60 * 60 * 1000;
const maxUploadBytes = 5 * 1024 * 1024;
const scrypt = promisify(crypto.scrypt);
const loginFailures = new Map();
const registrationAttempts = new Map();
const loginWindowMs = 15 * 60 * 1000;
const maxLoginFailures = 10;
const registrationWindowMs = 60 * 60 * 1000;
const maxRegistrationsPerWindow = 8;
const allowedUploadTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["application/pdf", ".pdf"]
]);

fs.mkdirSync(verificationDirectory, { recursive: true, mode: 0o700 });

const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
`);
db.exec(fs.readFileSync(path.join(__dirname, "database", "schema.sql"), "utf8"));

const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}
app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(express.json({ limit: "32kb" }));
app.use((request, response, next) => {
  if (request.body === undefined) request.body = {};
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes, files: 1 },
  fileFilter(request, file, callback) {
    if (!allowedUploadTypes.has(file.mimetype)) {
      callback(new ApiError(400, "Use a JPG, PNG, or PDF document."));
      return;
    }
    callback(null, true);
  }
});

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendError(response, status, message) {
  response.status(status).json({ error: message });
}

function getSessionToken(request) {
  const cookie = request.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)atip_session=([A-Za-z0-9_-]+)/);
  return match ? match[1] : "";
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    clientId: user.client_id || null
  };
}

function createSession(userId, response) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + sessionDurationMs;
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(hashToken(token), userId, expiresAt, new Date().toISOString());

  response.setHeader(
    "Set-Cookie",
    `atip_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionDurationMs / 1000)}${secureCookie ? "; Secure" : ""}`
  );
}

function requireAuth(request, response, next) {
  const token = getSessionToken(request);
  if (!token) {
    sendError(response, 401, "Sign in to continue.");
    return;
  }

  const user = db.prepare(`
    SELECT users.id, users.email, users.name, users.role, users.status,
           users.client_id, sessions.token_hash
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashToken(token), Date.now());

  if (!user) {
    sendError(response, 401, "Your session expired. Please sign in again.");
    return;
  }

  request.user = user;
  request.sessionHash = user.token_hash;
  next();
}

function requireRole(role) {
  return (request, response, next) => {
    if (!request.user || request.user.role !== role) {
      sendError(response, 403, "You do not have access to this resource.");
      return;
    }
    if (request.user.status !== "active") {
      sendError(response, 403, "Your account is awaiting verification.");
      return;
    }
    next();
  };
}

function requireOrigin(request, response, next) {
  const origin = request.get("origin");
  if (origin) {
    const expectedOrigin = `${request.protocol}://${request.get("host")}`;
    if (origin !== expectedOrigin) {
      sendError(response, 403, "Request origin is not allowed.");
      return;
    }
  }
  next();
}

function parseText(value, label, maxLength, { optional = false } = {}) {
  if (typeof value !== "string") {
    if (optional && (value === undefined || value === null)) return "";
    throw new ApiError(400, `${label} is required.`);
  }
  const text = value.trim();
  if (!text && !optional) throw new ApiError(400, `${label} is required.`);
  if (text.length > maxLength) {
    throw new ApiError(400, `${label} must be ${maxLength} characters or fewer.`);
  }
  return text;
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function validDocumentSignature(file) {
  if (!file) return false;
  const bytes = file.buffer;
  if (file.mimetype === "application/pdf") {
    return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  }
  if (file.mimetype === "image/png") {
    return bytes.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    );
  }
  if (file.mimetype === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return false;
}

function makeClientId() {
  return "ATIP-" + crypto.randomBytes(5).toString("hex").toUpperCase();
}

async function makePasswordHash(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  const [algorithm, saltHex, hashHex] = storedHash.split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function checkLoginRateLimit(request, response, next) {
  const key = request.ip;
  const now = Date.now();
  const attempts = (loginFailures.get(key) || []).filter(
    timestamp => now - timestamp < loginWindowMs
  );
  loginFailures.set(key, attempts);
  if (attempts.length >= maxLoginFailures) {
    sendError(response, 429, "Too many sign-in attempts. Try again in 15 minutes.");
    return;
  }
  request.loginRateKey = key;
  next();
}

function checkRegistrationRateLimit(request, response, next) {
  const now = Date.now();
  const attempts = (registrationAttempts.get(request.ip) || []).filter(
    timestamp => now - timestamp < registrationWindowMs
  );
  if (attempts.length >= maxRegistrationsPerWindow) {
    sendError(response, 429, "Too many registration attempts. Try again later.");
    return;
  }
  attempts.push(now);
  registrationAttempts.set(request.ip, attempts);
  next();
}

app.get("/api/health", (request, response) => {
  response.json({ status: "ok" });
});

app.post("/api/auth/register", requireOrigin, checkRegistrationRateLimit,
  upload.single("licenseDocument"),
  asyncRoute(async (request, response) => {
    const body = request.body;
    const email = parseText(body.email, "Email", 254).toLowerCase();
    const name = parseText(body.fullName, "Full name", 100);
    const password = body.password;
    if (typeof password !== "string" || password.length > 200) {
      throw new ApiError(400, "Enter a valid password.");
    }
    const role = body.role;
    if (!validEmail(email)) throw new ApiError(400, "Enter a valid email address.");
    if (password.length < 8) {
      throw new ApiError(400, "Password must be at least 8 characters.");
    }
    if (role !== "client" && role !== "psychiatrist") {
      throw new ApiError(400, "Choose a valid account type.");
    }
    if (body.termsConsent !== "true") {
      throw new ApiError(400, "Confirm the registration consent.");
    }

    const isPsychiatrist = role === "psychiatrist";
    let professionalName = null;
    let licenseNumber = null;
    let licenseFilePath = null;

    if (isPsychiatrist) {
      professionalName = parseText(body.professionalName, "License name", 100);
      licenseNumber = parseText(body.licenseNumber, "License number", 60);
      if (body.verificationConsent !== "true") {
        throw new ApiError(400, "Confirm the professional verification consent.");
      }
      if (!validDocumentSignature(request.file)) {
        throw new ApiError(400, "Upload a valid JPG, PNG, or PDF license document.");
      }
      const extension = allowedUploadTypes.get(request.file.mimetype);
      const filename = `${crypto.randomUUID()}${extension}`;
      licenseFilePath = path.join(verificationDirectory, filename);
      fs.writeFileSync(licenseFilePath, request.file.buffer, { mode: 0o600, flag: "wx" });
    }

    const passwordHash = await makePasswordHash(password);
    const clientId = isPsychiatrist ? null : makeClientId();
    const status = isPsychiatrist ? "pending" : "active";
    const now = new Date().toISOString();
    let result;
    try {
      result = db.prepare(`
        INSERT INTO users (
          email, name, role, password_hash, status, client_id,
          professional_name, license_number, license_file,
          verification_consent, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        email, name, role, passwordHash, status, clientId,
        professionalName, licenseNumber, licenseFilePath,
        isPsychiatrist ? 1 : 0, now
      );
    } catch (error) {
      if (licenseFilePath) fs.rmSync(licenseFilePath, { force: true });
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new ApiError(409, "An account with this email already exists.");
      }
      throw error;
    }

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
    response.status(201).json({
      user: publicUser(user),
      message: isPsychiatrist
        ? "Registration received. A reviewer must approve your professional credentials before you can sign in."
        : "Account created. Your client ID is " + clientId + "."
    });
  })
);

app.post("/api/auth/login", requireOrigin, checkLoginRateLimit,
  asyncRoute(async (request, response) => {
  const email = parseText(request.body.email, "Email", 254).toLowerCase();
  const password = parseText(request.body.password, "Password", 200);
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    const attempts = loginFailures.get(request.loginRateKey) || [];
    attempts.push(Date.now());
    loginFailures.set(request.loginRateKey, attempts);
    sendError(response, 401, "Email or password is incorrect.");
    return;
  }
  loginFailures.delete(request.loginRateKey);
  if (user.status === "pending") {
    sendError(response, 403, "Your professional account is awaiting credential review.");
    return;
  }
  if (user.status !== "active") {
    sendError(response, 403, "This account is not active. Contact the system administrator.");
    return;
  }

  createSession(user.id, response);
  response.json({ user: publicUser(user) });
  })
);

app.get("/api/auth/me", (request, response) => {
  const token = getSessionToken(request);
  if (!token) {
    response.json({ user: null });
    return;
  }
  const user = db.prepare(`
    SELECT users.id, users.email, users.name, users.role, users.status, users.client_id
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashToken(token), Date.now());
  response.json({ user: user ? publicUser(user) : null });
});

app.post("/api/auth/logout", requireOrigin, (request, response) => {
  const token = getSessionToken(request);
  if (token) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  }
  response.setHeader(
    "Set-Cookie",
    `atip_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie ? "; Secure" : ""}`
  );
  response.json({ ok: true });
});

app.get("/api/client/profile", requireAuth, requireRole("client"), (request, response) => {
  response.json({ user: publicUser(request.user) });
});

app.patch("/api/client/profile", requireOrigin, requireAuth, requireRole("client"),
  (request, response) => {
    const name = parseText(request.body.name, "Display name", 100);
    db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, request.user.id);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(request.user.id);
    response.json({ user: publicUser(user) });
  }
);

app.post("/api/client/connect", requireOrigin, requireAuth, requireRole("client"),
  (request, response) => {
    if (request.body.consent !== true) {
      throw new ApiError(400, "Client consent is required to share records.");
    }
    const email = parseText(request.body.psychiatristEmail, "Psychiatrist email", 254)
      .toLowerCase();
    if (!validEmail(email)) throw new ApiError(400, "Enter a valid email address.");
    const psychiatrist = db.prepare(`
      SELECT id FROM users
      WHERE email = ? AND role = 'psychiatrist' AND status = 'active'
    `).get(email);
    if (!psychiatrist) {
      throw new ApiError(404, "No verified psychiatrist account was found for that email.");
    }
    db.prepare(`
      INSERT INTO client_links (client_id, psychiatrist_id, consented_at)
      VALUES (?, ?, ?)
      ON CONFLICT(client_id, psychiatrist_id)
      DO UPDATE SET consented_at = excluded.consented_at
    `).run(request.user.id, psychiatrist.id, new Date().toISOString());
    response.status(201).json({ ok: true, message: "Client records are now shared with this psychiatrist." });
  }
);

app.delete("/api/client/connect/:psychiatristId", requireOrigin, requireAuth,
  requireRole("client"), (request, response) => {
    const psychiatristId = Number(request.params.psychiatristId);
    if (!Number.isSafeInteger(psychiatristId)) {
      throw new ApiError(400, "Invalid psychiatrist account.");
    }
    db.prepare("DELETE FROM client_links WHERE client_id = ? AND psychiatrist_id = ?")
      .run(request.user.id, psychiatristId);
    response.json({ ok: true });
  }
);

app.get("/api/client/connections", requireAuth, requireRole("client"), (request, response) => {
  const connections = db.prepare(`
    SELECT users.id, users.name, users.email, client_links.consented_at
    FROM client_links JOIN users ON users.id = client_links.psychiatrist_id
    WHERE client_links.client_id = ? AND users.status = 'active'
    ORDER BY users.name
  `).all(request.user.id);
  response.json({ connections });
});

app.get("/api/client/results", requireAuth, requireRole("client"), (request, response) => {
  const results = db.prepare(`
    SELECT id, overall_state AS overallState, summary, source,
           recorded_at AS recordedAt
    FROM results WHERE client_id = ? ORDER BY recorded_at DESC
  `).all(request.user.id);
  response.json({ results });
});

app.get("/api/client/journal", requireAuth, requireRole("client"), (request, response) => {
  const entries = db.prepare(`
    SELECT id, text, created_at AS createdAt
    FROM journal_entries WHERE client_id = ? ORDER BY created_at DESC
  `).all(request.user.id);
  response.json({ entries });
});

app.post("/api/client/journal", requireOrigin, requireAuth, requireRole("client"),
  (request, response) => {
    const text = parseText(request.body.text, "Journal entry", 3000);
    const createdAt = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO journal_entries (client_id, text, created_at) VALUES (?, ?, ?)
    `).run(request.user.id, text, createdAt);
    response.status(201).json({
      entry: { id: result.lastInsertRowid, text, createdAt }
    });
  }
);

function requireLinkedClient(request, response, next) {
  const clientId = Number(request.params.clientId);
  if (!Number.isSafeInteger(clientId)) {
    sendError(response, 400, "Invalid client account.");
    return;
  }
  const linked = db.prepare(`
    SELECT users.id, users.client_id AS clientId, users.name
    FROM client_links
    JOIN users ON users.id = client_links.client_id
    WHERE client_links.client_id = ? AND client_links.psychiatrist_id = ?
      AND users.status = 'active'
  `).get(clientId, request.user.id);
  if (!linked) {
    sendError(response, 404, "Client not found or has not consented to share records.");
    return;
  }
  request.linkedClient = linked;
  next();
}

app.get("/api/psychiatrist/dashboard", requireAuth, requireRole("psychiatrist"),
  (request, response) => {
    const clients = db.prepare(`
      SELECT users.id, users.client_id AS clientId, users.name,
             MAX(results.recorded_at) AS latestRecordedAt
      FROM client_links
      JOIN users ON users.id = client_links.client_id
      LEFT JOIN results ON results.client_id = users.id
      WHERE client_links.psychiatrist_id = ? AND users.status = 'active'
      GROUP BY users.id
      ORDER BY users.name
    `).all(request.user.id);
    const results = db.prepare(`
      SELECT results.id, users.id AS clientUserId,
             users.client_id AS clientId, users.name AS clientName,
             results.overall_state AS overallState, results.summary,
             results.source, results.recorded_at AS recordedAt
      FROM results
      JOIN users ON users.id = results.client_id
      JOIN client_links ON client_links.client_id = users.id
      WHERE client_links.psychiatrist_id = ?
      ORDER BY results.recorded_at DESC
    `).all(request.user.id);
    response.json({ user: publicUser(request.user), clients, results });
  }
);

app.get("/api/psychiatrist/clients/:clientId/results", requireAuth,
  requireRole("psychiatrist"), requireLinkedClient, (request, response) => {
    const results = db.prepare(`
      SELECT id, overall_state AS overallState, summary, source,
             recorded_at AS recordedAt
      FROM results WHERE client_id = ? ORDER BY recorded_at DESC
    `).all(request.linkedClient.id);
    response.json({ results });
  }
);

app.get("/api/psychiatrist/clients/:clientId/messages", requireAuth,
  requireRole("psychiatrist"), requireLinkedClient, (request, response) => {
    const messages = db.prepare(`
      SELECT id, sender_id AS senderId, text, sent_at AS sentAt
      FROM messages WHERE client_id = ? AND psychiatrist_id = ?
      ORDER BY sent_at
    `).all(request.linkedClient.id, request.user.id);
    response.json({ messages });
  }
);

app.post("/api/psychiatrist/clients/:clientId/messages", requireOrigin,
  requireAuth, requireRole("psychiatrist"), requireLinkedClient, (request, response) => {
    const text = parseText(request.body.text, "Message", 2000);
    const sentAt = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO messages (client_id, psychiatrist_id, sender_id, text, sent_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(request.linkedClient.id, request.user.id, request.user.id, text, sentAt);
    response.status(201).json({
      message: { id: result.lastInsertRowid, senderId: request.user.id, text, sentAt }
    });
  }
);

app.get("/api/psychiatrist/clients/:clientId/notes", requireAuth,
  requireRole("psychiatrist"), requireLinkedClient, (request, response) => {
    const notes = db.prepare(`
      SELECT id, text, created_at AS createdAt
      FROM clinical_notes
      WHERE client_id = ? AND psychiatrist_id = ?
      ORDER BY created_at DESC
    `).all(request.linkedClient.id, request.user.id);
    response.json({ notes });
  }
);

app.post("/api/psychiatrist/clients/:clientId/notes", requireOrigin,
  requireAuth, requireRole("psychiatrist"), requireLinkedClient, (request, response) => {
    const text = parseText(request.body.text, "Clinical note", 5000);
    const createdAt = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO clinical_notes (client_id, psychiatrist_id, text, created_at)
      VALUES (?, ?, ?, ?)
    `).run(request.linkedClient.id, request.user.id, text, createdAt);
    response.status(201).json({
      note: { id: result.lastInsertRowid, text, createdAt }
    });
  }
);

app.get("/api/client/messages/:psychiatristId", requireAuth, requireRole("client"),
  (request, response) => {
    const psychiatristId = Number(request.params.psychiatristId);
    const linked = db.prepare(`
      SELECT 1 FROM client_links WHERE client_id = ? AND psychiatrist_id = ?
    `).get(request.user.id, psychiatristId);
    if (!linked) throw new ApiError(404, "This psychiatrist is not connected.");
    const messages = db.prepare(`
      SELECT id, sender_id AS senderId, text, sent_at AS sentAt
      FROM messages WHERE client_id = ? AND psychiatrist_id = ?
      ORDER BY sent_at
    `).all(request.user.id, psychiatristId);
    response.json({ messages });
  }
);

app.post("/api/client/messages/:psychiatristId", requireOrigin, requireAuth,
  requireRole("client"), (request, response) => {
    const psychiatristId = Number(request.params.psychiatristId);
    const linked = db.prepare(`
      SELECT 1 FROM client_links WHERE client_id = ? AND psychiatrist_id = ?
    `).get(request.user.id, psychiatristId);
    if (!linked) throw new ApiError(404, "This psychiatrist is not connected.");
    const text = parseText(request.body.text, "Message", 2000);
    const sentAt = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO messages (client_id, psychiatrist_id, sender_id, text, sent_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(request.user.id, psychiatristId, request.user.id, text, sentAt);
    response.status(201).json({
      message: { id: result.lastInsertRowid, senderId: request.user.id, text, sentAt }
    });
  }
);

app.get("/api/client/appointments", requireAuth, requireRole("client"), (request, response) => {
  const appointments = db.prepare(`
    SELECT appointments.id, appointments.scheduled_at AS scheduledAt,
           appointments.note, appointments.status,
           users.id AS psychiatristId, users.name AS psychiatristName
    FROM appointments JOIN users ON users.id = appointments.psychiatrist_id
    WHERE appointments.client_id = ?
    ORDER BY appointments.scheduled_at
  `).all(request.user.id);
  response.json({ appointments });
});

app.get("/api/psychiatrist/appointments", requireAuth, requireRole("psychiatrist"),
  (request, response) => {
    const appointments = db.prepare(`
      SELECT appointments.id, appointments.client_id AS clientUserId,
             clients.client_id AS clientId, clients.name AS clientName,
             appointments.scheduled_at AS scheduledAt, appointments.note,
             appointments.status
      FROM appointments
      JOIN users AS clients ON clients.id = appointments.client_id
      JOIN client_links ON client_links.client_id = clients.id
        AND client_links.psychiatrist_id = appointments.psychiatrist_id
      WHERE appointments.psychiatrist_id = ?
      ORDER BY appointments.scheduled_at
    `).all(request.user.id);
    response.json({ appointments });
  }
);

app.post("/api/psychiatrist/appointments", requireOrigin, requireAuth,
  requireRole("psychiatrist"), (request, response) => {
    const clientId = Number(request.body.clientId);
    const scheduledDate = new Date(request.body.scheduledAt);
    if (!Number.isSafeInteger(clientId) || Number.isNaN(scheduledDate.getTime())) {
      throw new ApiError(400, "Choose a linked client and valid appointment time.");
    }
    const linked = db.prepare(`
      SELECT 1 FROM client_links WHERE client_id = ? AND psychiatrist_id = ?
    `).get(clientId, request.user.id);
    if (!linked) throw new ApiError(404, "Client not found or consent is not active.");
    if (scheduledDate.getTime() <= Date.now()) {
      throw new ApiError(400, "Appointment time must be in the future.");
    }
    const note = parseText(request.body.note, "Appointment note", 160, { optional: true });
    const scheduledAt = scheduledDate.toISOString();
    const result = db.prepare(`
      INSERT INTO appointments (client_id, psychiatrist_id, scheduled_at, note, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(clientId, request.user.id, scheduledAt, note, new Date().toISOString());
    response.status(201).json({
      appointment: { id: result.lastInsertRowid, clientId, scheduledAt, note, status: "scheduled" }
    });
  }
);

app.post("/api/ingest/results", requireOrigin, (request, response, next) => {
  if (!ingestApiKey) {
    sendError(response, 503, "Result ingestion is not configured.");
    return;
  }
  const authorization = request.get("authorization") || "";
  const suppliedKey = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  const suppliedHash = crypto.createHash("sha256").update(suppliedKey).digest();
  const expectedHash = crypto.createHash("sha256").update(ingestApiKey).digest();
  if (suppliedKey.length === 0 || !crypto.timingSafeEqual(suppliedHash, expectedHash)) {
    sendError(response, 401, "Invalid ingestion credentials.");
    return;
  }
  next();
}, (request, response) => {
  const clientId = parseText(request.body.clientId, "Client ID", 50);
  const client = db.prepare(`
    SELECT id FROM users WHERE client_id = ? AND role = 'client' AND status = 'active'
  `).get(clientId);
  if (!client) throw new ApiError(404, "Client ID was not found.");
  const overallState = parseText(request.body.overallState, "Result label", 80);
  const summary = parseText(request.body.summary, "Summary", 2000, { optional: true });
  const source = parseText(request.body.source, "Source", 100, { optional: true }) ||
    "Connected system";
  const recordedAt = request.body.recordedAt
    ? new Date(request.body.recordedAt)
    : new Date();
  if (Number.isNaN(recordedAt.getTime())) {
    throw new ApiError(400, "Result date is invalid.");
  }
  const result = db.prepare(`
    INSERT INTO results (client_id, overall_state, summary, source, recorded_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(client.id, overallState, summary, source, recordedAt.toISOString());
  response.status(201).json({ id: result.lastInsertRowid });
});

const staticOptions = {
  dotfiles: "deny",
  index: false,
  setHeaders(response, filePath) {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.setHeader("Pragma", "no-cache");
  }
};
app.use((request, response, next) => {
  let requestedPath;
  try {
    requestedPath = decodeURIComponent(request.path);
  } catch {
    sendError(response, 400, "Invalid resource path.");
    return;
  }
  const isAllowedFile = requestedPath === "/api.js" ||
    requestedPath === "/healthz" ||
    /^\/(?:AUTH|Client Dashboard|Psychiatrist Dashboard)\/[^/]+$/.test(requestedPath);
  if (requestedPath !== "/" && !isAllowedFile) {
    sendError(response, 404, "Resource not found.");
    return;
  }
  next();
});
app.use(express.static(__dirname, staticOptions));

app.get("/healthz", (request, response) => {
  response.json({ status: "ok" });
});

app.get("/", (request, response) => {
  response.redirect(302, "/AUTH/auth.html");
});

app.use((error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  if (error instanceof multer.MulterError) {
    sendError(response, 400, error.code === "LIMIT_FILE_SIZE"
      ? "The selected file exceeds the 5 MB limit."
      : "The uploaded file could not be accepted.");
    return;
  }
  if (error.type === "entity.parse.failed") {
    sendError(response, 400, "Request body is not valid JSON.");
    return;
  }
  if (error.type === "entity.too.large") {
    sendError(response, 413, "Request body exceeds the allowed size.");
    return;
  }
  if (error instanceof ApiError) {
    sendError(response, error.status, error.message);
    return;
  }
  console.error("Request failed:", error);
  sendError(response, 500, "The server could not complete the request.");
});

setInterval(() => {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
}, 60 * 60 * 1000).unref();

if (process.env.NODE_ENV === "production" && !secureCookie) {
  console.error("Refusing production mode without ATIP_SECURE_COOKIE=true.");
  process.exit(1);
}

app.listen(port, host, () => {
  console.log(`ATIP is running at http://${host}:${port}`);
  console.log(`Private database and verification files: ${dataDirectory}`);
});

function shutdown() {
  try {
    db.close();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

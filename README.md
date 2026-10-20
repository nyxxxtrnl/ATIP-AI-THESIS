# ATIP AI local backend

This project uses Node.js, Express, and the built-in SQLite module. Use Node.js 22.13 or newer (Node.js 24 is recommended). The SQL schema is in [`database/schema.sql`](./database/schema.sql); the server applies it on startup and stores records in `.data/atip.sqlite`.

## Start the app

1. Run `npm install`.
2. Copy `.env.example` to `.env` if you want to configure result ingestion or a custom private data directory.
3. Run `npm start`.
4. Open `http://127.0.0.1:3000/` and use the app through this address. Do not open the HTML files directly with `file://`.

The SQLite database and private psychiatrist verification uploads are kept in `.data` beside the server by default. That folder is excluded from Git and is not served publicly. Set `ATIP_DATA_DIR` to a protected folder on a production host. Back up this folder securely.

## Render thesis demo

The root `render.yaml` configures a free Render web service for a thesis demonstration. Free services may spin down when idle, which can make the first page load take about a minute. Their filesystem is temporary: SQLite accounts, appointments, messages, and uploaded documents can be erased when the service restarts, spins down, or redeploys. This setup has no persistent disk and is not suitable for important data.

This configuration is for synthetic test data only. The app is not certified or configured for real patient information. Do not enter real names, credentials, health details, or professional documents. Use HTTPS, keep deployment access restricted to the project team where possible, and delete demo accounts and data when they are no longer needed.

## Account access and client consent

- Client accounts become active after registration. A generated Client ID is shown in the registration confirmation.
- Psychiatrist registrations remain pending. A trusted system operator must independently verify the professional credentials before approving access.
- The operator can review pending applications with `npm run admin:psychiatrists -- list`, inspect a private application and its document path with `npm run admin:psychiatrists -- show <user-id>`, then approve or reject using the listed user ID. Run these commands only on the trusted server machine and verify the documents independently.
- A client shares data by signing in, opening **Profile & Settings**, entering the email of an already approved psychiatrist, and confirming consent. The client can revoke that connection from the same page.
- A psychiatrist can access only records for clients who have consented to that specific account.
- Social sign-in (Google, Facebook, Discord) is not enabled; OAuth provider credentials and callback configuration are required.

## Dashboard data stored in SQL

| Dashboard feature | SQLite table |
| --- | --- |
| Client and psychiatrist accounts | `users` |
| Login sessions | `sessions` |
| Client-approved psychiatrist access | `client_links` |
| Wellness results and mood history | `results` |
| Client journal | `journal_entries` |
| Shared appointments | `appointments` |
| Messages between connected accounts | `messages` |
| Psychiatrist-only clinical notes | `clinical_notes` |

Client and psychiatrist dashboards load these records through authenticated API routes. Dashboard counts and CSV reports are derived from the authorized SQL results. Static wellness suggestions/videos and the display-only dark-mode preference are not patient records and do not need database rows.

## API and data notes

- Passwords are stored as salted scrypt hashes. Authentication uses opaque, server-side sessions in HttpOnly, SameSite=Strict cookies.
- Results are added by the connected system using `POST /api/ingest/results` with `Authorization: Bearer <ATIP_INGEST_API_KEY>`. The key must be configured on the server. Never put it in browser code.
- Journals, appointments, and messages are stored in SQLite and require the authenticated account and role. Messages and appointments are visible to both linked accounts.
- This local starter is not, by itself, a compliance certification or production deployment. Use HTTPS, set `ATIP_SECURE_COOKIE=true`, protect the host and database backups, arrange an auditable professional-review process, and perform a privacy/security assessment before entering real health information. Do not use the demo status labels as diagnosis or emergency-care guidance.

The database is created automatically on first server start. Do not delete `.data/atip.sqlite` to reset the app; that permanently removes accounts and dashboard records.

## Environment variables

- `PORT` — HTTP port (default `3000`).
- `ATIP_DATA_DIR` — private directory for SQLite and verification files (default `.data`).
- `ATIP_INGEST_API_KEY` — optional secret that enables trusted result ingestion.
- `ATIP_SECURE_COOKIE=true` — set when serving over HTTPS.

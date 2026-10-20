import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const rootDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDirectory = path.resolve(
  process.env.ATIP_DATA_DIR || path.join(rootDirectory, ".data")
);
const db = new DatabaseSync(path.join(dataDirectory, "atip.sqlite"));
const [action, userIdText] = process.argv.slice(2);

try {
  if (action === "list") {
    const pending = db.prepare(`
      SELECT id, name, email, professional_name AS professionalName,
             license_number AS licenseNumber, license_file AS privateDocumentPath,
             created_at AS submittedAt
      FROM users WHERE role = 'psychiatrist' AND status = 'pending'
      ORDER BY created_at
    `).all();
    if (pending.length === 0) {
      console.log("No psychiatrist applications are pending.");
    } else {
      console.table(pending);
    }
  } else if (action === "show") {
    const userId = Number(userIdText);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new Error("Provide a valid psychiatrist user ID.");
    }
    const application = db.prepare(`
      SELECT id, name, email, professional_name AS professionalName,
             license_number AS licenseNumber, license_file AS privateDocumentPath,
             status, created_at AS submittedAt
      FROM users WHERE id = ? AND role = 'psychiatrist'
    `).get(userId);
    if (!application) throw new Error("Psychiatrist application was not found.");
    console.table([application]);
  } else if (action === "approve" || action === "reject") {
    const userId = Number(userIdText);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new Error("Provide a valid pending psychiatrist user ID.");
    }
    const status = action === "approve" ? "active" : "rejected";
    const result = db.prepare(`
      UPDATE users SET status = ?
      WHERE id = ? AND role = 'psychiatrist' AND status = 'pending'
    `).run(status, userId);
    if (result.changes !== 1) {
      throw new Error("No pending psychiatrist application was found for that ID.");
    }
    console.log(`Psychiatrist account ${userId} marked ${status}.`);
  } else {
    console.log(
      "Usage:\n" +
      "  npm run admin:psychiatrists -- list\n" +
      "  npm run admin:psychiatrists -- show <user-id>\n" +
      "  npm run admin:psychiatrists -- approve <user-id>\n" +
      "  npm run admin:psychiatrists -- reject <user-id>"
    );
    if (action) process.exitCode = 1;
  }
} finally {
  db.close();
}

import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Anchor to server/src/db/ so paths are cwd-independent.
const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const MIGRATIONS_DIR = path.join(DATA_DIR, "migrations");

export const db = new Database(path.join(DATA_DIR, "podsub.db"));

db.pragma("journal_mode = WAL");
// better-sqlite3 defaults this to OFF, making ON DELETE CASCADE a no-op.
db.pragma("foreign_keys = ON");

function migrate(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    database
      .prepare("SELECT name FROM _migrations")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  for (const file of files) {
    if (applied.has(file)) continue;

    console.log(`Applying migration ${file}...`);
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");

    database.transaction(() => {
      database.exec(sql);
      database
        .prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)")
        .run(file, Date.now());
    })();
  }
}

migrate(db);

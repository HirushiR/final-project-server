// rn-infra/db/index.mjs
import Database from "better-sqlite3"; // Use default import
import path from "path";
import fs from "fs/promises"; // Use promises for async fs operations
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbDir = path.join(path.dirname(__dirname), "var", "db"); // Place DBs in var/db
const dbPath = path.join(dbDir, "users.db");

async function initializeDatabase() {
  // Ensure the directory exists before opening the database
  await fs.mkdir(dbDir, { recursive: true });

  // Open the database connection
  // `better-sqlite3` throws an error if connection fails, so wrap in try/catch
  let db;
  try {
    db = new Database(dbPath, { verbose: console.log }); // Options: verbose logs SQL executed
    console.log("Connected to better-sqlite3 database.");
  } catch (err) {
    console.error("Could not connect to better-sqlite3 database:", err);
    process.exit(1); // Exit if DB connection fails
  }

  // WAL mode is generally recommended for better concurrency
  db.pragma("journal_mode = WAL");

  // Create users table if it doesn't exist
  const createTableSql = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    hashed_password BLOB NOT NULL, -- Store as BLOB
    salt BLOB NOT NULL,            -- Store as BLOB
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  `;

  try {
    db.exec(createTableSql); // Use exec for statements that don't return rows
    console.log("Users table verified/created successfully.");
  } catch (err) {
    console.error("Error creating users table:", err.message);
    // Depending on severity, you might want to exit here too
  }

  // Close the DB connection on process exit
  process.on("exit", () => {
    if (db && db.open) {
      // Check if db is initialized and open
      console.log("Closing better-sqlite3 database connection.");
      db.close();
    }
  });
  process.on("SIGINT", () => process.exit()); // Ensure exit handler runs on Ctrl+C

  return db; // Return the db instance
}

// Initialize and export the database instance
const db = await initializeDatabase();

export default db;

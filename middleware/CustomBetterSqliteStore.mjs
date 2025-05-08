// rn-infra/middleware/CustomBetterSqliteStore.mjs
import session from "express-session"; // We need this to extend Store and access Cookie
import crypto from "crypto"; // For session ID generation in regenerate (optional)

const Store = session.Store;
const ONE_DAY = 86400; // seconds in a day, used for default expiry

class CustomBetterSqliteStore extends Store {
  constructor(options = {}) {
    super(options); // Call Store constructor for EventEmitter setup

    if (!options.client) {
      throw new Error(
        "A better-sqlite3 client must be provided as options.client"
      );
    }
    this.client = options.client;
    this.table = options.table || "sessions";
    this.cleanupInterval = options.cleanupInterval || ONE_DAY * 1000; // Default: clean up daily

    // Ensure the sessions table exists
    try {
      this.client.exec(`
        CREATE TABLE IF NOT EXISTS ${this.table} (
          sid TEXT PRIMARY KEY NOT NULL,
          sess TEXT NOT NULL,
          expire INTEGER NOT NULL
        );
      `);
      // Create index for faster cleanup/lookup by expiry (optional but good)
      this.client.exec(
        `CREATE INDEX IF NOT EXISTS idx_${this.table}_expire ON ${this.table}(expire);`
      );
      console.log(
        `Custom session store using table '${this.table}' verified/created.`
      );
    } catch (err) {
      console.error(`Failed to create session table '${this.table}':`, err);
      throw err; // Re-throw critical error
    }

    // Prepare statements for efficiency
    this._prepareStatements();

    // Start periodic cleanup of expired sessions
    this._scheduleCleanup();
  }

  _prepareStatements() {
    this.getStmt = this.client.prepare(
      `SELECT sess, expire FROM ${this.table} WHERE sid = ?`
    );
    // Use REPLACE for set (upsert)
    this.setStmt = this.client.prepare(
      `REPLACE INTO ${this.table} (sid, sess, expire) VALUES (?, ?, ?)`
    );
    this.destroyStmt = this.client.prepare(
      `DELETE FROM ${this.table} WHERE sid = ?`
    );
    this.touchStmt = this.client.prepare(
      `UPDATE ${this.table} SET expire = ? WHERE sid = ?`
    );
    // For cleanup
    this.cleanupStmt = this.client.prepare(
      `DELETE FROM ${this.table} WHERE expire < ?`
    );
    // For length (optional)
    this.lengthStmt = this.client.prepare(
      `SELECT COUNT(*) AS count FROM ${this.table}`
    );
    // For clear (optional)
    this.clearStmt = this.client.prepare(`DELETE FROM ${this.table}`);
  }

  // Get session by Session ID
  get(sid, callback) {
    console.log(`[Session Store GET] sid: ${sid}`);
    try {
      const row = this.getStmt.get(sid);

      if (!row) {
        console.log(`[Session Store GET] Session not found for sid: ${sid}`);
        return callback(null, null); // No session found is not an error
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      if (row.expire < nowSeconds) {
        console.log(
          `[Session Store GET] Session expired for sid: ${sid}. Destroying.`
        );
        // Expired session, destroy it and return null
        this.destroy(sid, () => callback(null, null));
        return;
      }

      // Parse the session data
      try {
        const sess = JSON.parse(row.sess);
        console.log(
          `[Session Store GET] Session found and valid for sid: ${sid}`
        );
        callback(null, sess);
      } catch (parseErr) {
        console.error(
          `[Session Store GET] Error parsing session data for sid ${sid}:`,
          parseErr
        );
        // Corrupted data, treat as error or destroy? Destroying is safer.
        this.destroy(sid, () => callback(parseErr));
      }
    } catch (dbErr) {
      console.error(`[Session Store GET] DB error for sid ${sid}:`, dbErr);
      callback(dbErr);
    }
  }

  // Set session data
  set(sid, session, callback) {
    console.log(`[Session Store SET] sid: ${sid}`);
    try {
      const maxAge = session.cookie.maxAge;
      // Calculate expiry timestamp in seconds since epoch
      const nowSeconds = Math.floor(Date.now() / 1000);
      const expire = maxAge
        ? nowSeconds + Math.floor(maxAge / 1000)
        : nowSeconds + ONE_DAY; // Default expiry if maxAge not set

      const sessString = JSON.stringify(session);

      // Use prepared statement for REPLACE (handles INSERT and UPDATE)
      this.setStmt.run(sid, sessString, expire);
      console.log(
        `[Session Store SET] Session saved for sid: ${sid}, expires: ${new Date(
          expire * 1000
        ).toISOString()}`
      );
      callback(null);
    } catch (err) {
      console.error(`[Session Store SET] Error for sid ${sid}:`, err);
      callback(err);
    }
  }

  // Destroy session by Session ID
  destroy(sid, callback) {
    console.log(`[Session Store DESTROY] sid: ${sid}`);
    try {
      this.destroyStmt.run(sid);
      console.log(`[Session Store DESTROY] Session destroyed for sid: ${sid}`);
      // destroy doesn't strictly need a callback in many implementations,
      // but express-session might expect one. Call it safely.
      if (callback) callback(null);
    } catch (err) {
      console.error(`[Session Store DESTROY] Error for sid ${sid}:`, err);
      if (callback) callback(err);
    }
  }

  // Touch session (update expiry)
  touch(sid, session, callback) {
    console.log(`[Session Store TOUCH] sid: ${sid}`);
    try {
      const maxAge = session.cookie.maxAge;
      const nowSeconds = Math.floor(Date.now() / 1000);
      const expire = maxAge
        ? nowSeconds + Math.floor(maxAge / 1000)
        : nowSeconds + ONE_DAY;

      const info = this.touchStmt.run(expire, sid);
      if (info.changes > 0) {
        console.log(
          `[Session Store TOUCH] Session touched for sid: ${sid}, new expire: ${new Date(
            expire * 1000
          ).toISOString()}`
        );
      } else {
        console.log(
          `[Session Store TOUCH] Session not found for touch: ${sid}`
        );
      }
      callback(null);
    } catch (err) {
      console.error(`[Session Store TOUCH] Error for sid ${sid}:`, err);
      callback(err);
    }
  }

  // Optional methods (implement if needed)
  length(callback) {
    console.log(`[Session Store LENGTH]`);
    try {
      const row = this.lengthStmt.get();
      callback(null, row ? row.count : 0);
    } catch (err) {
      console.error(`[Session Store LENGTH] Error:`, err);
      callback(err);
    }
  }

  clear(callback) {
    console.log(`[Session Store CLEAR]`);
    try {
      this.clearStmt.run();
      callback(null);
    } catch (err) {
      console.error(`[Session Store CLEAR] Error:`, err);
      callback(err);
    }
  }

  // Internal method for cleaning up expired sessions
  _cleanupExpiredSessions() {
    const nowSeconds = Math.floor(Date.now() / 1000);
    console.log(
      `[Session Store Cleanup] Running cleanup for sessions expired before ${new Date(
        nowSeconds * 1000
      ).toISOString()}...`
    );
    try {
      const info = this.cleanupStmt.run(nowSeconds);
      console.log(
        `[Session Store Cleanup] ${info.changes} expired sessions removed.`
      );
    } catch (err) {
      console.error("[Session Store Cleanup] Error during cleanup:", err);
    }
  }

  // Schedule the cleanup interval
  _scheduleCleanup() {
    this._cleanupIntervalId = setInterval(() => {
      this._cleanupExpiredSessions();
    }, this.cleanupInterval);
    // Allow Node.js to exit even if the interval is pending
    this._cleanupIntervalId.unref();
  }
}

export default CustomBetterSqliteStore;

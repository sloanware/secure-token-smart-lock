import sqlite3 from "sqlite3";

// Logger for DB (simple wrapper)
const logInfo = (msg) => console.log(`[DB] ${new Date().toISOString()} - ${msg}`);
const logError = (msg, err) => console.error(`[DB ERROR] ${new Date().toISOString()} - ${msg}`, err);

// Initialize DB connection
const db = new sqlite3.Database('./smartlock.db', (err) => {
    if (err) logError("Could not connect to database", err);
    else logInfo("Connected to SQLite database");
});

// Promise Wrappers allow the use of 'await' in other files
export const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
    });
});

export const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
    });
});

export const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
    });
});

// Table initialization runs immediately when this file is imported
(async () => {
    try {
        await dbRun(`
            CREATE TABLE IF NOT EXISTS enrollments (
                token TEXT PRIMARY KEY,
                permissions TEXT,
                created_at INTEGER,
                expires_at INTEGER
            )
        `);

        // Links real people to tokens. Only used for Revocation.
        await dbRun(`
            CREATE TABLE IF NOT EXISTS identity_map (
                student_id TEXT PRIMARY KEY,
                token TEXT UNIQUE
            )
        `);

        await dbRun(`
            CREATE TABLE IF NOT EXISTS short_tokens (
                token TEXT PRIMARY KEY,
                enrollment_token TEXT,
                created_at INTEGER,
                expires_at INTEGER,
                used INTEGER DEFAULT 0
            )
        `);

        await dbRun(`
            CREATE TABLE IF NOT EXISTS rate_limits (
                enrollment_token TEXT PRIMARY KEY,
                requests TEXT, 
                suspended_until INTEGER
            )
        `);

        logInfo("Tables initialized");

        // Seed database for demo
        const ALICE_TOKEN = "ALICE_ENROLLMENT_TOKEN";
        const ALICE_ID = "40000000";
        const ALICE_PERMS = "LAB_968";
        const date1 = new Date("2026-05-01").getTime(); // Expires May 1, 2026

        const BOB_TOKEN = "BOB_ENROLLMENT_TOKEN";
        const BOB_ID = "50000000";
        const BOB_PERMS = "LAB_969";
        const date2 = new Date("2026-12-01").getTime(); // Expires December 1, 2026

        const EVE_TOKEN = "EVE_ENROLLMENT_TOKEN";
        const EVE_ID = "60000000";
        const EVE_PERMS = "ALL";
        const date3 = new Date("2025-12-01").getTime(); // Expired December 1, 2025

        const now = Date.now();

        // Insert demo enrollment tokens (anonymous)
        await dbRun(`INSERT OR IGNORE INTO enrollments (token, permissions, created_at, expires_at) VALUES (?, ?, ?, ?)`, 
            [ALICE_TOKEN, ALICE_PERMS, now, date1]);
        await dbRun(`INSERT OR IGNORE INTO enrollments (token, permissions, created_at, expires_at) VALUES (?, ?, ?, ?)`, 
            [BOB_TOKEN, BOB_PERMS, now, date2]);
        await dbRun(`INSERT OR IGNORE INTO enrollments (token, permissions, created_at, expires_at) VALUES (?, ?, ?, ?)`, 
            [EVE_TOKEN, EVE_PERMS, now, date3]);

        // Insert demo identity Map (admin only)
        await dbRun(`INSERT OR IGNORE INTO identity_map (student_id, token) VALUES (?, ?)`, [ALICE_ID, ALICE_TOKEN]);
        await dbRun(`INSERT OR IGNORE INTO identity_map (student_id, token) VALUES (?, ?)`, [BOB_ID, BOB_TOKEN]);
        await dbRun(`INSERT OR IGNORE INTO identity_map (student_id, token) VALUES (?, ?)`, [EVE_ID, EVE_TOKEN]);

        logInfo("Demo tokens seeded and mapped to identities");

    } catch (err) {
        logError("Failed to initialize tables", err);
    }
})();
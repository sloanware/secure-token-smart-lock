/**
 * Token Proximity-Based Smart Lock
 * SOEN 422 Embedded Systems and Software 
 * Fall 2025 at Concordia University
 * 
 * Server
 * Running ExpressJS and SQLite
 */

import express from "express";
import cors from "cors";
import crypto from "crypto";
import { dbRun, dbGet, dbAll } from "./database.js";
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 3000;
const SHORT_TOKEN_TTL_MS = 1 * 60 * 1000; // 1 minute
const SHORT_TOKEN_BYTES = 9;
const CLEANUP_TOKEN_INTERVAL_MS = 30 * 1000; // Every 30 seconds
const CLEANUP_ENROLL_INTERVAL_MS = 24 * 60 * 60 * 1000; // Every 24 Hours

const ADMIN_SECRET = process.env.ADMIN_SECRET;

// Device and person must be close to the door
const RSSI_THRESHOLD = -70;
const DISTANCE_THRESHOLD = 90; // 60 cm = 3 feet 

// Rate limiting: maximum 3 access requests in 3 minutes
const WINDOW_MS = 3 * 60 * 1000;
const MAX_REQUESTS = 3;

// Logger
const nowDate = () => Date().toString();
const logInfo = (msg, meta = null) => console.log(`[INFO]  ${nowDate()} - ${msg}` + (meta ? ` | ${JSON.stringify(meta)}` : ""));
const logWarn = (msg, meta = null) => console.warn(`[WARN]  ${nowDate()} - ${msg}` + (meta ? ` | ${JSON.stringify(meta)}` : ""));
const logError = (msg, meta = null) => console.error(`[ERROR] ${nowDate()} - ${msg}` + (meta ? ` | ${JSON.stringify(meta)}` : ""));

/**
 * Helper functions
 */
const nowMs = () => Date.now();

function genRandomToken(bytes = SHORT_TOKEN_BYTES) {
    return crypto.randomBytes(bytes).toString("hex");
}

async function cleanupExpiredTokens() {
    const time = nowMs();
    try {
        // Delete where expiresAt is less than now
        const result = await dbRun(`DELETE FROM short_tokens WHERE expires_at <= ?`, [time]);
        if (result.changes > 0) {
            logInfo("Cleanup removed expired tokens", { removed: result.changes });
        }
    } catch (err) {
        logError("Cleanup failed", err);
    }
}

async function cleanupEnrollmentTokens() {
    const time = nowMs();
    try {
        // Find expired tokens
        const expiredRows = await dbAll(`SELECT token FROM enrollments WHERE expires_at <= ?`, [time]);
        
        if (expiredRows.length > 0) {
            const expiredTokens = expiredRows.map(row => row.token);
            
            // Delete from enrollments
            await dbRun(`DELETE FROM enrollments WHERE expires_at <= ?`, [time]);

            // Delete from identity_map
            let mapRemoved = 0;
            for (const t of expiredTokens) {
                const res = await dbRun(`DELETE FROM identity_map WHERE token = ?`, [t]);
                mapRemoved += res.changes;
            }

            logInfo("Cleanup removed expired enrollments", { 
                enrollmentsRemoved: expiredRows.length, 
                identitiesRemoved: mapRemoved 
            });
        } else {
            logInfo("Daily cleanup: No expired enrollments found");
        }
    } catch (err) {
        logError("Enrollment cleanup failed", err);
    }
}

/**
 * Server setup
 */
const app = express();
app.use(cors());
app.use(express.json());

/**
 * Admin page (for demo)
 */
app.use(express.static('public'));

/**
 * API routes
 */

// Enroll a new student (admin required)
app.post("/enroll", async (req, res) => {
const { enrollmentToken, studentId, permissions, adminSecret, expiresAt } = req.body ?? {};

    if (adminSecret !== ADMIN_SECRET) return res.status(403).json({ error: "unauthorized" });
    if (!enrollmentToken || !studentId) return res.status(400).json({ error: "enrollmentToken and studentID required" });

    const expiry = expiresAt || (nowMs() + (120 * 24 * 60 * 60 * 1000));
    const perms = permissions || "ALL";

    try {
        // Insert into enrollments (anonymous)
        await dbRun(`INSERT INTO enrollments (token, permissions, created_at, expires_at) VALUES (?, ?, ?, ?)`, 
            [enrollmentToken, perms, nowMs(), expiry]);

        // Insert into identity map (admin tracking)
        await dbRun(`INSERT INTO identity_map (student_id, token) VALUES (?, ?)`, 
            [studentId, enrollmentToken]);
        
        logInfo("Enrolled new student", { enrollmentToken, studentId, permissions, expiry });
        return res.json({ ok: true });
    } catch (err) {
        // SQLITE_CONSTRAINT means duplicate key
        if (err.code === 'SQLITE_CONSTRAINT') {
            return res.status(409).json({ error: "token or studentId already exists" });
        }
        logError("Enroll db error", err);
        return res.status(500).json({ error: "database error" });
    }
});

// Request a short lived token to access a lab (from app) with rate-limiting
app.post("/request-token", async (req, res) => {
    const { enrollmentToken } = req.body ?? {};
    const now = nowMs();

    if (!enrollmentToken) {
        return res.status(400).json({ error: "enrollmentToken required" });
    }

    try {
        // Check if enrollment token exists AND not expired
        const user = await dbGet(`SELECT * FROM enrollments WHERE token = ?`, [enrollmentToken]);
        
        if (!user) {
            logWarn("request-token unknown user", { enrollmentToken });
            return res.status(403).json({ error: "unknown enrollmentToken" });
        }

        // Expiry Check
        if (user.expires_at < now) {
            logWarn("request-token user expired", { enrollmentToken, expiresAt: new Date(user.expires_at).toISOString() });
            return res.status(403).json({ error: "enrollment_expired" });
        }

        // --- RATE LIMITING ---
        let rateRow = await dbGet(`SELECT * FROM rate_limits WHERE enrollment_token = ?`, [enrollmentToken]);
        
        // Default structure if no record exists
        let rateData = rateRow ? 
            { requests: JSON.parse(rateRow.requests), suspendedUntil: rateRow.suspended_until } : 
            { requests: [], suspendedUntil: 0 };

        // Check suspension
        if (rateData.suspendedUntil > now) {
            logWarn("Rate limit suspension", { enrollmentToken });
            return res.status(429).json({ error: "rate_limited", suspendedUntil: rateData.suspendedUntil });
        }

        // Filter old requests (keep only those within WINDOW_MS)
        rateData.requests = rateData.requests.filter(ts => ts > now - WINDOW_MS);

        if (rateData.requests.length >= MAX_REQUESTS) {
            // Suspend user
            rateData.suspendedUntil = now + WINDOW_MS;
            rateData.requests = []; // Clear requests during suspension
            logWarn("Rate limit exceeded, user suspended", { enrollmentToken });
            
            // Upsert (Update or Insert) rate limit record
            await dbRun(`INSERT OR REPLACE INTO rate_limits (enrollment_token, requests, suspended_until) VALUES (?, ?, ?)`, 
                [enrollmentToken, JSON.stringify(rateData.requests), rateData.suspendedUntil]);
            
            return res.status(429).json({ error: "rate_limited", suspendedUntil: rateData.suspendedUntil });
        }

        // Add current request
        rateData.requests.push(now);
        rateData.suspendedUntil = 0;
        
        // Save updated rate limit data
        await dbRun(`INSERT OR REPLACE INTO rate_limits (enrollment_token, requests, suspended_until) VALUES (?, ?, ?)`, 
            [enrollmentToken, JSON.stringify(rateData.requests), rateData.suspendedUntil]);
        // -------------------------

        // Issue Short Token
        const tokenStr = genRandomToken();
        const expiresAt = now + SHORT_TOKEN_TTL_MS;

        await dbRun(`INSERT INTO short_tokens (token, enrollment_token, created_at, expires_at, used) VALUES (?, ?, ?, ?, 0)`, 
            [tokenStr, enrollmentToken, now, expiresAt]);

        logInfo("Issued short-lived token", { token: tokenStr, expiresAt });
        return res.json({ token: tokenStr, expiresAt });

    } catch (err) {
        logError("request-token error", err);
        return res.status(500).json({ error: "internal error" });
    }
});

// Validate a request access (from TTGO)
app.post("/validate", async (req, res) => {
    const { token, rssi, distanceCm, doorId } = req.body ?? {};

    if (!token) return res.status(400).json({ error: "token required" });
    if (!doorId) return res.status(400).json({ error: "doorId required" });

    try {
        const entry = await dbGet(`SELECT * FROM short_tokens WHERE token = ?`, [token]);

        // Check Short Token Validity
        if (!entry) return res.status(403).json({ granted: false, reason: "unknown_or_expired" });
        if (entry.expires_at <= nowMs()) {
            // Delete immediately so app gets "expired" status faster
            await dbRun(`DELETE FROM short_tokens WHERE token = ?`, [token]);
            return res.status(403).json({ granted: false, reason: "expired" });
        }
        if (entry.used === 1) return res.status(403).json({ granted: false, reason: "already_used" });
        if (entry.used === 2) return res.status(403).json({ granted: false, reason: "already_denied" });

        // Check Enrollment Token (The User Identity)
        const user = await dbGet(`SELECT * FROM enrollments WHERE token = ?`, [entry.enrollment_token]);
        
        if (!user) {
            // If user was revoked/deleted, mark token as DENIED so app turns Red instantly
            await dbRun(`UPDATE short_tokens SET used = 2 WHERE token = ?`, [token]);
            return res.status(403).json({ granted: false, reason: "access_revoked" });
        }

        // Check Permissions (Door ID)
        const perms = user.permissions || "";
        const canAccess = perms === "ALL" || perms.includes(doorId);

        if (!canAccess) {
            // Mark as DENIED
            await dbRun(`UPDATE short_tokens SET used = 2 WHERE token = ?`, [token]);
            logWarn("Access Denied: Permissions", { doorId, perms });
            return res.status(403).json({ granted: false, reason: "insufficient_permissions" });
        }

        logInfo("Checking sensors", { token, rssi, distanceCm });

        // Check Sensor (RSSI)
        if (typeof rssi !== "undefined" && rssi < RSSI_THRESHOLD) {
            // Mark as DENIED
            await dbRun(`UPDATE short_tokens SET used = 2 WHERE token = ?`, [token]);
            logWarn("Access Denied: Weak Signal", { rssi });
            return res.status(403).json({ granted: false, reason: "rssi_too_weak" });
        }

        // Check Sensor (LIDAR)
        if (typeof distanceCm !== "undefined" && distanceCm > DISTANCE_THRESHOLD) {
            // Mark as DENIED
            await dbRun(`UPDATE short_tokens SET used = 2 WHERE token = ?`, [token]);
            logWarn("Access Denied: Too Far", { distanceCm });
            return res.status(403).json({ granted: false, reason: "distance_too_far" });
        }

        // SUCCESS
        await dbRun(`UPDATE short_tokens SET used = 1 WHERE token = ?`, [token]);
        logInfo("Validation granted", { token, doorId });
        return res.json({ granted: true });

    } catch (err) {
        logError("validate error", err);
        return res.status(500).json({ error: "internal error" });
    }
});

// Revoke an enrollment token (admin required)
app.post("/revoke-enrollment", async (req, res) => {
    const { studentId, adminSecret } = req.body ?? {};

    if (adminSecret !== ADMIN_SECRET) return res.status(403).json({ error: "unauthorized" });
    if (!studentId) return res.status(400).json({ error: "studentId required" });

    try {
        // Find the token associated with this student
        const mapEntry = await dbGet(`SELECT token FROM identity_map WHERE student_id = ?`, [studentId]);
        
        if (!mapEntry) return res.status(404).json({ error: "student_not_found" });

        // Delete the enrollment (stops access immediately)
        await dbRun(`DELETE FROM enrollments WHERE token = ?`, [mapEntry.token]);

        // Delete the map entry
        await dbRun(`DELETE FROM identity_map WHERE student_id = ?`, [studentId]);
        
        logInfo("Admin revoked student access", { studentId });
        return res.json({ ok: true, message: `Access revoked for student ${studentId}` });
    } catch (err) {
        return res.status(500).json({ error: "internal error" });
    }
});

// App polling
app.get("/check-status", async (req, res) => {
    const { token } = req.query;

    if (!token) return res.status(400).json({ error: "token required" });

    try {
        const entry = await dbGet(`SELECT used FROM short_tokens WHERE token = ?`, [token]);

        if (!entry) {
            // Token deleted/expired
            return res.json({ status: "expired" });
        }

        if (entry.used === 1) {
            return res.json({ status: "granted" });
        } else if (entry.used === 2) {
            return res.json({ status: "denied" });
        } else {
            return res.json({ status: "pending" });
        }
    } catch (err) {
        return res.status(500).json({ error: "db error" });
    }
});

// Server status check (admin required)
app.get("/server-status", async (req, res) => {
    const adminSecret = req.query.adminSecret;
    if (adminSecret !== ADMIN_SECRET) {
        return res.status(403).json({ error: "unauthorized" });
    }

    try {
        const enrollCount = await dbGet(`SELECT COUNT(*) as count FROM enrollments`);
        const activeTokens = await dbAll(`SELECT * FROM short_tokens`);
        
        return res.json({
            now: nowMs(),
            enrollmentCount: enrollCount.count,
            activeShortTokens: activeTokens
        });
    } catch (err) {
        return res.status(500).json({ error: "db error" });
    }
});

/**
 * Start server
 */
app.listen(PORT, () => {
    logInfo(`SmartDoor server listening on port ${PORT}`);
})

/**
 * Token cleanup task
 */
setInterval(cleanupExpiredTokens, CLEANUP_TOKEN_INTERVAL_MS);
setInterval(cleanupEnrollmentTokens, CLEANUP_ENROLL_INTERVAL_MS);
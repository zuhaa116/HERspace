const { Pool } = require('pg');

// Railway provides DATABASE_URL automatically once you add a Postgres plugin.
// Locally, fall back to nothing (server uses JSON files when DATABASE_URL is missing).
const pool = process.env.DATABASE_URL
    ? new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    })
    : null;

async function initDb() {
    if (!pool) {
        console.log('[HerSpace] No DATABASE_URL — using JSON file fallback.');
        return;
    }
    await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      email        TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name         TEXT NOT NULL,
      city         TEXT NOT NULL,
      age          INT  NOT NULL,
      independent  BOOLEAN NOT NULL,
      cv_filename  TEXT,
      created_at   BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      sid     TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS reports (
      id          SERIAL PRIMARY KEY,
      lat         DOUBLE PRECISION NOT NULL,
      lng         DOUBLE PRECISION NOT NULL,
      category    TEXT NOT NULL,
      description TEXT NOT NULL,
      time_of_day TEXT,
      created_at  BIGINT NOT NULL,
      user_id     TEXT
    );
  `);
    console.log('[HerSpace] Postgres ready.');
}

// Row-to-object helpers
function userFromRow(r) {
    if (!r) return null;
    return {
        id: r.id, email: r.email, passwordHash: r.password_hash,
        name: r.name, city: r.city, age: r.age,
        independent: r.independent,
        cvFilename: r.cv_filename,
        createdAt: Number(r.created_at),
    };
}
function reportFromRow(r) {
    return {
        id: r.id, lat: r.lat, lng: r.lng,
        category: r.category, description: r.description,
        timeOfDay: r.time_of_day, createdAt: Number(r.created_at),
        userId: r.user_id,
    };
}

module.exports = { pool, initDb, userFromRow, reportFromRow };
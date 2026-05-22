const { Pool } = require('pg');

// Railway provides DATABASE_URL automatically once you add a Postgres plugin.
// Locally, fall back to nothing (server uses JSON files when DATABASE_URL is missing).
let pool = null;
if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 8000,
    });
    pool.on('error', (err) => {
        console.error('[HerSpace] Postgres pool error:', err.message);
    });
}
async function initDb() {
    if (!pool) {
        console.log('[HerSpace] No DATABASE_URL — using JSON file fallback.');
        return;
    }
    console.log('[HerSpace] Connecting to Postgres…');
    try {
        await pool.query('SELECT 1');
        console.log('[HerSpace] Postgres connection OK.');
    } catch (err) {
        console.error('[HerSpace] Postgres connection FAILED:', err.message);
        throw err;
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
       cv_text      TEXT,
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
    CREATE TABLE IF NOT EXISTS trips (
  id          SERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  destination TEXT NOT NULL,
  origin_lat  DOUBLE PRECISION,
  origin_lng  DOUBLE PRECISION,
  dest_lat    DOUBLE PRECISION,
  dest_lng    DOUBLE PRECISION,
  duration_seconds INT,
  distance_m  INT,
  status      TEXT,
  created_at  BIGINT NOT NULL
);
  `);
    console.log('[HerSpace] Postgres tables ready.');
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cv_text TEXT;`);
    await pool.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS distance_m INT;`);
}

// Row-to-object helpers
function userFromRow(r) {
  if (!r) return null;
  return {
    id: r.id, email: r.email, passwordHash: r.password_hash,
    name: r.name, city: r.city, age: r.age,
    independent: r.independent,
    cvFilename: r.cv_filename,
    cvText: r.cv_text,                          // ← add this
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

function tripFromRow(r) {
  return {
    id: r.id, userId: r.user_id, destination: r.destination,
    originLat: r.origin_lat, originLng: r.origin_lng,
    destLat: r.dest_lat, destLng: r.dest_lng,
    durationSeconds: r.duration_seconds,
    distanceM: r.distance_m,
    status: r.status,
    createdAt: Number(r.created_at),
  };
}
module.exports = { pool, initDb, userFromRow, reportFromRow, tripFromRow };
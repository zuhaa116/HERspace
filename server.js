require('dotenv').config();
const { pool, initDb, userFromRow, reportFromRow, tripFromRow } = require('./db');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-not-for-production';
// ═══════════════════════════════════════════════════════════════════════════════
// JSON FILE DATABASE
// ═══════════════════════════════════════════════════════════════════════════════
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '{}');
// JSON helpers (used as fallback when no DATABASE_URL is set, e.g. local dev)
function loadUsersFile() { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
function saveUsersFile(arr) { fs.writeFileSync(USERS_FILE, JSON.stringify(arr, null, 2)); }
function loadSessionsFile() { return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); }
function saveSessionsFile(obj) { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2)); }

// ── Unified data access (Postgres in prod, JSON files in local dev) ──
async function findUserByEmail(email) {
  if (pool) {
    const r = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    return userFromRow(r.rows[0]);
  }
  return loadUsersFile().find(u => u.email === email) || null;
}
async function findUserById(id) {
  if (pool) {
    const r = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
    return userFromRow(r.rows[0]);
  }
  return loadUsersFile().find(u => u.id === id) || null;
}
async function insertUser(u) {
  if (pool) {
    await pool.query(
      `INSERT INTO users (id,email,password_hash,name,city,age,independent,cv_filename,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [u.id, u.email, u.passwordHash, u.name, u.city, u.age, u.independent, u.cvFilename, u.createdAt]
    );
    return;
  }
  const arr = loadUsersFile(); arr.push(u); saveUsersFile(arr);
}
async function getSession(sid) {
  if (pool) {
    const r = await pool.query('SELECT user_id FROM sessions WHERE sid=$1', [sid]);
    return r.rows[0]?.user_id || null;
  }
  return loadSessionsFile()[sid] || null;
}
async function setSession(sid, userId) {
  if (pool) { await pool.query('INSERT INTO sessions (sid,user_id) VALUES ($1,$2)', [sid, userId]); return; }
  const s = loadSessionsFile(); s[sid] = userId; saveSessionsFile(s);
}
async function deleteSession(sid) {
  if (pool) { await pool.query('DELETE FROM sessions WHERE sid=$1', [sid]); return; }
  const s = loadSessionsFile(); delete s[sid]; saveSessionsFile(s);
}
async function getAllReports() {
  if (pool) {
    const r = await pool.query('SELECT * FROM reports ORDER BY created_at DESC');
    return r.rows.map(reportFromRow);
  }
  return reports; // the in-memory array seeded at the top
}
async function insertReport(rep) {
  if (pool) {
    const r = await pool.query(
      `INSERT INTO reports (lat,lng,category,description,time_of_day,created_at,user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [rep.lat, rep.lng, rep.category, rep.description, rep.timeOfDay, rep.createdAt, rep.userId]
    );
    rep.id = r.rows[0].id;
    return rep;
  }
  rep.id = nextReportId++;
  reports.push(rep);
  return rep;
}
async function seedReportsIfEmpty() {
  if (!pool) return;
  const r = await pool.query('SELECT COUNT(*)::int AS n FROM reports');
  if (r.rows[0].n > 0) return;
  for (const rep of reports) {
    await pool.query(
      `INSERT INTO reports (lat,lng,category,description,time_of_day,created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [rep.lat, rep.lng, rep.category, rep.description, rep.timeOfDay, rep.createdAt]
    );
  }
  console.log('[HerSpace] Seeded initial reports into Postgres.');
}

// ═══════════════════════════════════════════════════════════════════════════════
// FILE UPLOAD (CV)
// ═══════════════════════════════════════════════════════════════════════════════
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    cb(null, `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    cb(ok.includes(file.mimetype) ? null : new Error('CV must be a PDF or Word document.'), ok.includes(file.mimetype));
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: true, limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function requireAuth(req, res, next) {
  const sid = req.cookies.hs_session;
  if (!sid) return res.status(401).json({ error: 'Not authenticated.' });
  const userId = await getSession(sid);
  if (!userId) return res.status(401).json({ error: 'Session expired.' });
  const user = await findUserById(userId);
  if (!user) return res.status(401).json({ error: 'User no longer exists.' });
  req.user = user;
  next();
}
// Token-based auth middleware — for Flutter / mobile clients
// Looks for "Authorization: Bearer <token>" header
function requireToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.tokenUserId = payload.userId;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// Hybrid middleware: accepts EITHER cookie session OR Bearer token
// Use this on endpoints that should work for both web and mobile
async function requireAuthOrToken(req, res, next) {
  // Try token first
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const u = await findUserById(payload.userId);
      if (u) {
        req.user = u;
        return next();
      }
    } catch (e) { /* fall through to cookie */ }
  }
  // Fall back to cookie auth
  return requireAuth(req, res, next);
}


function sanitize(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}
async function extractCvText(filePath, mimetype) {
  const buf = fs.readFileSync(filePath);
  try {
    if (mimetype === 'application/pdf') {
      const data = await pdfParse(buf);
      return (data.text || '').trim().slice(0, 8000);
    }
    if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimetype === 'application/msword') {
      const result = await mammoth.extractRawText({ buffer: buf });
      return (result.value || '').trim().slice(0, 8000);
    }
  } catch (err) {
    console.error('[HerSpace] CV parse error:', err.message);
  }
  return '';
}

// DB helper
async function updateUserCv(userId, cvFilename, cvText) {
  if (pool) {
    await pool.query('UPDATE users SET cv_filename=$1, cv_text=$2 WHERE id=$3', [cvFilename, cvText, userId]);
    return;
  }
  const arr = loadUsersFile();
  const u = arr.find(x => x.id === userId);
  if (u) { u.cvFilename = cvFilename; u.cvText = cvText; saveUsersFile(arr); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/signup', upload.single('cv'), async (req, res) => {
  try {
    const { email, password, name, city, age, independent } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (!name || name.trim().length < 2) return res.status(400).json({ error: 'Please enter your name.' });
    if (!city || city.trim().length < 2) return res.status(400).json({ error: 'Please enter your city.' });
    const ageNum = parseInt(age, 10);
    if (!ageNum || ageNum < 13 || ageNum > 100) return res.status(400).json({ error: 'Please enter a valid age (13-100).' });
    if (!['yes', 'no'].includes(independent)) return res.status(400).json({ error: 'Please answer the independence question.' });

    const emailLower = email.toLowerCase().trim();
    const existing = await findUserByEmail(emailLower);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = {
      id: crypto.randomBytes(8).toString('hex'),
      email: emailLower,
      passwordHash,
      name: name.trim(),
      city: city.trim(),
      age: ageNum,
      independent: independent === 'yes',
      cvFilename: req.file ? req.file.filename : null,
      createdAt: Date.now(),
    };
    await insertUser(newUser);

    const sid = crypto.randomBytes(24).toString('hex');
    await setSession(sid, newUser.id);
    res.cookie('hs_session', sid, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });

    return res.json({ ok: true, user: sanitize(newUser) });
  } catch (err) {
    console.error('[HerSpace] Signup error:', err.message);
    return res.status(400).json({ error: err.message || 'Could not create account.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const user = await findUserByEmail(email.toLowerCase().trim());
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password.' });

    const sid = crypto.randomBytes(24).toString('hex');
    await setSession(sid, user.id);
    res.cookie('hs_session', sid, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });

    return res.json({ ok: true, user: sanitize(user) });
  } catch (err) {
    console.error('[HerSpace] Login error:', err.message);
    return res.status(500).json({ error: 'Login failed.' });
  }
});
// ═══════════════════════════════════════════════════════════════════════════════
// TOKEN-BASED AUTH for Flutter / mobile clients
// Same login flow as /api/login, but returns a JWT token instead of setting a cookie
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

  try {
    const user = await findUserByEmail(email.toLowerCase().trim());
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password.' });

    // Sign a token valid for 30 days
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    return res.json({ token, user: sanitize(user) });
  } catch (e) {
    console.error('[HerSpace] /api/auth/login:', e.message);
    return res.status(500).json({ error: 'Could not log in.' });
  }
});

app.post('/api/auth/signup', async (req, res) => {
  const { email, password, name, city, age, independent } = req.body;
  if (!email || !password || !name || !city) {
    return res.status(400).json({ error: 'Email, password, name, and city required.' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  try {
    const existing = await findUserByEmail(email.toLowerCase().trim());
    if (existing) return res.status(400).json({ error: 'An account with that email already exists.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await createUser({
      email: email.toLowerCase().trim(),
      passwordHash,
      name: name.trim(),
      city: city.trim(),
      age: parseInt(age, 10) || null,
      independent: !!independent,
    });

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    return res.json({ token, user: sanitize(user) });
  } catch (e) {
    console.error('[HerSpace] /api/auth/signup:', e.message);
    return res.status(500).json({ error: 'Could not create account.' });
  }
});
app.post('/api/logout', async (req, res) => {
  const sid = req.cookies.hs_session;
  if (sid) await deleteSession(sid);
  res.clearCookie('hs_session');
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  const sid = req.cookies.hs_session;
  if (!sid) return res.json({ user: null });
  const userId = await getSession(sid);
  if (!userId) return res.json({ user: null });
  const user = await findUserById(userId);
  if (!user) return res.json({ user: null });
  res.json({ user: sanitize(user) });
});
// ═══════════════════════════════════════════════════════════════════════════════
// C.A.R.E. CHAT
// ═══════════════════════════════════════════════════════════════════════════════
const SYSTEM_PROMPTS = {
  career:
    'You are C.A.R.E., the AI inside HerSpace, a women\'s empowerment app for South Asia. ' +
    'Focus: careers — CV tailoring, interview prep, scholarships, mentors, skill gaps. ' +
    'C = Context: remember the user\'s name, applications, cycle phase if mentioned, mood. ' +
    'A = Action: combine career help with awareness of her cycle and mood when relevant. ' +
    'R = Rules: never diagnose, never shame, always end with one practical next step, ' +
    'keep replies under 3 sentences unless she asks for more, never repeat generic advice. ' +
    'E = tone: warm, intelligent, Pakistani/South Asian context aware.',
  health:
    'You are C.A.R.E., the AI inside HerSpace. ' +
    'Focus: women\'s health — cycle tracking, PCOS, pregnancy guidance, medication reminders, general wellness. ' +
    'Never diagnose or replace a doctor. Always suggest seeing a qualified professional for medical decisions. ' +
    'Be culturally sensitive to South Asian users. ' +
    'Keep replies under 3 sentences unless she asks for more. Always end with one practical next step.',
  wellbeing:
    'You are C.A.R.E., the AI inside HerSpace. ' +
    'Focus: mental wellbeing — mood, stress, rest, burnout, anxiety. ' +
    'You are supportive, not a therapist. ' +
    'If the user mentions self-harm, suicidal thoughts, or crisis, gently encourage contacting a professional ' +
    'or local helpline (in Pakistan: Umang 0311-7786264). ' +
    'Keep replies under 3 sentences unless she asks for more. Always end with one practical next step.',
};

app.post('/api/chat', requireAuth, async (req, res) => {
  const { subTab, messages } = req.body;
  if (!subTab || !SYSTEM_PROMPTS[subTab]) return res.status(400).json({ error: 'Invalid subTab.' });
  if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'messages required.' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'sk-replace-me') return res.status(500).json({ error: 'Server not configured.' });

 const cvSnippet = (req.user.cvText || '').slice(0, 2500);
const profileNote = ` The user you are speaking to is ${req.user.name}, age ${req.user.age}, based in ${req.user.city}. ` +
  `She has indicated she is ${req.user.independent ? 'financially independent' : 'not yet financially independent'}.` +
  (cvSnippet ? ` Here is her CV for context — reference her actual experience when relevant:\n"""${cvSnippet}"""` : '');
  const fullMessages = [
    { role: 'system', content: SYSTEM_PROMPTS[subTab] + profileNote },
    ...messages,
  ];

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: fullMessages, max_tokens: 300, temperature: 0.7 }),
    });
    if (!response.ok) return res.status(502).json({ error: 'Upstream AI service error.' });
    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim() ?? '';
    return res.json({ reply });
  } catch (err) {
    console.error('[HerSpace] Chat error:', err.message);
    return res.status(503).json({ error: 'Could not reach the AI service.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMMUNITY SAFETY REPORTS
// ═══════════════════════════════════════════════════════════════════════════════
const reports = [
  { id: 1, lat: 31.5180, lng: 74.3470, category: 'dimly_lit', description: 'Street lights broken on the back lane after 8pm.', timeOfDay: 'night', createdAt: Date.now() - 86400000 * 2 },
  { id: 2, lat: 31.5172, lng: 74.3478, category: 'crowd', description: 'Groups of men loitering near the corner shop most evenings.', timeOfDay: 'evening', createdAt: Date.now() - 86400000 * 5 },
  { id: 3, lat: 31.5188, lng: 74.3462, category: 'harassment', description: 'Catcalling reported by multiple women walking alone here.', timeOfDay: 'night', createdAt: Date.now() - 86400000 * 1 },
  { id: 4, lat: 31.5683, lng: 74.3142, category: 'dimly_lit', description: 'Underpass has no working lights.', timeOfDay: 'night', createdAt: Date.now() - 86400000 * 8 },
  { id: 5, lat: 31.5675, lng: 74.3150, category: 'infrastructure', description: 'Broken footpath forces pedestrians onto the road.', timeOfDay: 'any', createdAt: Date.now() - 86400000 * 10 },
  { id: 6, lat: 31.5689, lng: 74.3135, category: 'harassment', description: 'Three reports of following incidents in the last month.', timeOfDay: 'night', createdAt: Date.now() - 86400000 * 3 },
  { id: 7, lat: 31.5485, lng: 74.3318, category: 'crowd', description: 'Crowd density very high; pickpocketing common after dark.', timeOfDay: 'night', createdAt: Date.now() - 86400000 * 4 },
  { id: 8, lat: 31.5492, lng: 74.3325, category: 'dimly_lit', description: 'Several stretches without working street lights.', timeOfDay: 'night', createdAt: Date.now() - 86400000 * 6 },
];
let nextReportId = reports.length + 1;
const VALID_CATEGORIES = ['dimly_lit', 'crowd', 'harassment', 'infrastructure', 'other'];

app.get('/api/reports', async (req, res) => {
  const all = await getAllReports();
  res.json({ reports: all });
});

app.post('/api/reports', requireAuth, async (req, res) => {
  const { lat, lng, description, category, timeOfDay } = req.body;
  if (typeof lat !== 'number' || typeof lng !== 'number') return res.status(400).json({ error: 'lat and lng must be numbers.' });
  if (!description || description.length < 5 || description.length > 500) return res.status(400).json({ error: 'description must be 5-500 chars.' });
  if (!VALID_CATEGORIES.includes(category)) return res.status(400).json({ error: 'invalid category.' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'sk-replace-me') return res.status(500).json({ error: 'Server not configured.' });

  const moderationPrompt = `You are a content moderator for HerSpace, a women's safety app where users report unsafe areas.

A user submitted this report:
- Category: ${category}
- Time of day: ${timeOfDay || 'unspecified'}
- Description: "${description}"

Your job:
1. Decide if this report should be ACCEPTED or REJECTED.
2. REJECT if it contains: discrimination against any group, ethnic/religious/class slurs, harassment of specific named individuals, obvious spam, jokes, or claims that don't relate to physical safety of women in a public space.
3. ACCEPT genuine safety reports about lighting, infrastructure, crowd behavior, harassment incidents, etc.
4. If ACCEPTED, rewrite the description into one neutral, factual sentence (under 100 chars).

Respond in JSON: {"decision": "ACCEPT" | "REJECT", "reason": "...", "cleanDescription": "..."}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: moderationPrompt }],
        max_tokens: 200, temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) return res.status(502).json({ error: 'Moderation service unavailable.' });
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim() ?? '{}';
    let parsed; try { parsed = JSON.parse(raw); } catch { parsed = {}; }
    if (parsed.decision === 'REJECT') return res.status(400).json({ error: 'Report could not be accepted.', reason: parsed.reason || 'Did not meet guidelines.' });
    const cleanDescription = (parsed.cleanDescription || description).slice(0, 200);
    const newReport = { lat, lng, category, description: cleanDescription, timeOfDay: timeOfDay || 'any', createdAt: Date.now(), userId: req.user.id };
    const saved = await insertReport(newReport);
    return res.json({ ok: true, report: saved });
  } catch (err) {
    console.error('[HerSpace] Report error:', err.message);
    return res.status(503).json({ error: 'Could not reach moderation service.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMMUNITY — AI-generated companies for the user's city
// ═══════════════════════════════════════════════════════════════════════════════
const companyCache = new Map();
const COMPANY_CACHE_TTL = 1000 * 60 * 60;

// ═══════════════════════════════════════════════════════════════════════════════
// REAL JOBS via JSearch (RapidAPI) — falls back to AI generation if no key
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/companies', requireAuth, async (req, res) => {
  // Hard request timeout — Railway kills slow requests
  req.setTimeout(25000, () => {
    if (!res.headersSent) {
      console.warn('[HerSpace] /api/companies timeout');
      res.status(504).json({ error: 'Request timed out', companies: [] });
    }
  });
  const city = req.user.city;
  const cached = companyCache.get(`${req.user.id}:${city.toLowerCase()}`);
  if (cached && Date.now() - cached.generatedAt < COMPANY_CACHE_TTL) {
    return res.json({ city, companies: cached.companies, cached: true });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const rapidKey = process.env.RAPIDAPI_KEY;
  if (!apiKey || apiKey === 'sk-replace-me') return res.status(500).json({ error: 'Server not configured.' });

  const user = await findUserById(req.user.id);
  const cvSnippet = (user.cvText || '').slice(0, 3500);

  // ── Step 1: ask GPT to extract a single best search query from the CV ──
  let searchQuery = `jobs in ${city}`;
  if (cvSnippet) {
    try {
      const kwRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{
            role: 'user',
            content: `From this CV, extract a SHORT 2-4 word job search query that best represents the candidate's most likely next role (e.g. "junior software engineer", "marketing intern", "graphic designer"). Return ONLY the query string, no quotes, no explanation.

CV:
"""${cvSnippet}"""`
          }],
          max_tokens: 30,
          temperature: 0.3,
        }),
      });
      if (kwRes.ok) {
        const kwData = await kwRes.json();
        const q = kwData.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, '');
        if (q && q.length < 80) searchQuery = `${q} in ${city}`;
      }
    } catch (e) {
      console.error('[HerSpace] keyword extraction failed:', e.message);
    }
  }

  // ── Step 2: call JSearch with the query ──
  let jobs = [];
  if (rapidKey) {
    try {
      const jsUrl = `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(searchQuery)}&page=1&num_pages=1&country=pk&date_posted=month`;
     const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), 12000);
let jsRes;
try {
  jsRes = await fetch(jsUrl, {
    headers: {
      'X-RapidAPI-Key': rapidKey,
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
    },
    signal: ctrl.signal,
  });
} catch (e) {
  console.error('[HerSpace] JSearch aborted/error:', e.message);
} finally {
  clearTimeout(t);
}
      if (jsRes.ok) {
        const jsData = await jsRes.json();
        jobs = (jsData.data || []).slice(0, 8);
      } else {
        console.error('[HerSpace] JSearch error:', jsRes.status, await jsRes.text());
      }
    } catch (e) {
      console.error('[HerSpace] JSearch network error:', e.message);
    }
  }

  // ── Step 3: shape the JSearch results into our card schema ──
  let companies = jobs.map(j => ({
    name: j.employer_name || 'Unknown company',
    industry: j.job_employment_type || 'Full-time',
    locationNote: [j.job_city, j.job_country].filter(Boolean).join(', ') || city,
    rating: j.employer_company_rating || (4 + Math.random()).toFixed(1),
    ratingNote: j.job_is_remote ? 'Remote-friendly' : 'On-site role',
    tags: [
      j.job_is_remote ? 'Hybrid OK' : null,
      j.job_employment_type === 'PARTTIME' ? 'Flexible hours' : null,
      'Real listing',
    ].filter(Boolean),
    reviewCount: j.employer_reviews || Math.floor(50 + Math.random() * 200),
    quote: j.job_description ? j.job_description.slice(0, 100) + '…' : '',
    website: j.employer_website || j.job_apply_link || null,
    email: null,
    phone: null,
    openRoles: [j.job_title || 'Open role'],
    matchReason: null, // filled in next step
    realJobLink: j.job_apply_link, // real apply URL
    jobTitle: j.job_title,
  }));

  // ── Step 4: ask GPT for a match reason per job (only if we have a CV) ──
  // ── Step 4: ask GPT to RANK + FILTER jobs based on CV match strength ──
if (cvSnippet && companies.length > 0) {
  try {
    const summary = companies.map((c, i) =>
      `${i + 1}. ${c.jobTitle} at ${c.name} (${c.industry || ''}) — ${(c.quote || '').slice(0, 150)}`
    ).join('\n');

    const rankRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `User's CV:\n"""${cvSnippet}"""\n\nReview these ${companies.length} job listings. For EACH, decide:
- score: 0-100 — how well does this role match the user's actual skills/background/interests in the CV?
  • 70-100 = strong match (skills clearly align)
  • 40-69 = partial match (some overlap but stretch)
  • 0-39 = poor match (unrelated field or wrong level)
- reason: ONE short sentence (under 90 chars) explaining the match (or why it's not one)

Be strict — don't inflate scores. If a job is in a completely different field from the CV, give it a low score.

Jobs:
${summary}

Return ONLY this JSON: {"matches":[{"score":N,"reason":"..."}, ... one per job in order]}`
        }],
        max_tokens: 1000,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    if (rankRes.ok) {
      const md = await rankRes.json();
      const raw = md.choices?.[0]?.message?.content?.trim() ?? '{}';
      let parsed; try { parsed = JSON.parse(raw); } catch { parsed = {}; }
      const matches = Array.isArray(parsed.matches) ? parsed.matches : [];

      // Attach scores and reasons, then filter + sort
      companies = companies
        .map((c, i) => ({
          ...c,
          matchScore: matches[i]?.score ?? 0,
          matchReason: matches[i]?.reason ?? null,
        }))
       .filter(c => c.matchScore >= 25) // drop only obvious mismatches
        .sort((a, b) => b.matchScore - a.matchScore); // best first

      console.log(`[HerSpace] Ranked ${matches.length} jobs, kept ${companies.length} above threshold`);
    }
  } catch (e) {
    console.error('[HerSpace] ranking failed:', e.message);
  }
}

  // ── Step 5: if JSearch returned nothing, fall back to AI-only mode ──
  if (companies.length === 0) {
    const fbPrompt = `You are a careers research assistant for HerSpace, a women's empowerment app in Pakistan. The user lives in ${city}.${cvSnippet ? `\nCV:\n"""${cvSnippet}"""` : ''}\n\nGenerate 6 realistic women-friendly companies hiring in ${city}. Each: name, industry, locationNote, rating (3.5-4.9), ratingNote, tags (1-3 from ["Safe workplace","Women promoted","Maternity covered","Flexible hours","Hybrid OK","Equal pay"]), reviewCount (30-300), quote (under 100 chars), website, email, phone (+92), openRoles (2-3), matchReason (if CV provided). Return ONLY: {"companies":[...]}`;
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: fbPrompt }],
          max_tokens: 1800, temperature: 0.7,
          response_format: { type: 'json_object' },
        }),
      });
      if (r.ok) {
        const d = await r.json();
        const raw = d.choices?.[0]?.message?.content?.trim() ?? '{}';
        let p; try { p = JSON.parse(raw); } catch { p = {}; }
        companies = Array.isArray(p.companies) ? p.companies.slice(0, 8) : [];
      }
    } catch (e) {
      console.error('[HerSpace] fallback gen failed:', e.message);
    }
  }

  companyCache.set(`${req.user.id}:${city.toLowerCase()}`, { companies, generatedAt: Date.now() });
  return res.json({ city, companies, cached: false, source: jobs.length > 0 ? 'jsearch' : 'ai' });
});
// ═══════════════════════════════════════════════════════════════════════════════
// COMMUNITY — AI-generated mentors (women in industry)
// ═══════════════════════════════════════════════════════════════════════════════
const mentorCache = new Map();
const MENTOR_CACHE_TTL = 1000 * 60 * 60;

app.get('/api/mentors', requireAuth, async (req, res) => {
  const city = req.user.city;
  const cached = mentorCache.get(city.toLowerCase());
  if (cached && Date.now() - cached.generatedAt < MENTOR_CACHE_TTL) {
    return res.json({ city, mentors: cached.mentors, cached: true });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'sk-replace-me') return res.status(500).json({ error: 'Server not configured.' });

  const prompt = `You are a research assistant for HerSpace, a women's empowerment app in Pakistan.

Generate 8 realistic mentor profiles of senior women professionals working in ${city}, Pakistan. Mix across industries: Technology, Banking, FMCG, Telecom, NGOs, Healthcare, Education, Media.

For EACH mentor, return:
- name: realistic Pakistani woman's full name
- title: current job title
- company: company they work at (real Pakistani companies)
- industry: short tag (Technology, Banking, FMCG, Telecom, NGO, Healthcare, Education, Media)
- yearsExperience: number between 5 and 25
- expertise: array of 2-4 short expertise tags (e.g. "Product Management", "Career switch", "Negotiation", "Leadership", "Working mothers")
- bio: one warm sentence about her mentoring focus (under 130 chars)
- availability: short phrase (e.g. "2 sessions/month", "Weekends only", "Open to coffee chats")
- mentees: realistic number of past mentees, 5-80
- rating: 4.3-5.0 as number
- languages: array, e.g. ["English","Urdu"] or ["English","Urdu","Punjabi"]
- linkedin: best-guess linkedin URL format (linkedin.com/in/firstname-lastname) — null if uncertain
- email: best-guess professional email — null if uncertain

CRITICAL: only fill linkedin/email if reasonably confident the format is correct. Use null otherwise.

Return ONLY valid JSON: {"mentors": [ ... 8 objects ... ]}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000, temperature: 0.7,
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) return res.status(502).json({ error: 'Could not load mentors.' });
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim() ?? '{}';
    let parsed; try { parsed = JSON.parse(raw); } catch { parsed = {}; }
    const mentors = Array.isArray(parsed.mentors) ? parsed.mentors.slice(0, 8) : [];
    mentorCache.set(city.toLowerCase(), { mentors, generatedAt: Date.now() });
    return res.json({ city, mentors, cached: false });
  } catch (err) {
    console.error('[HerSpace] /api/mentors error:', err.message);
    return res.status(503).json({ error: 'Could not reach AI service.' });
  }
});
// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE UPDATE (phone, profile picture, CV)
// ═══════════════════════════════════════════════════════════════════════════════
const profileUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      cb(null, `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${safe}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

app.post('/api/profile', requireAuth,
  profileUpload.fields([{ name: 'cv', maxCount: 1 }, { name: 'avatar', maxCount: 1 }]),
  async (req, res) => {
    try {
      const { phone } = req.body;
      const cvFile = req.files?.cv?.[0];
      const avatarFile = req.files?.avatar?.[0];

      // Update in-memory user object
      const updates = {};
      if (typeof phone === 'string') updates.phone = phone.trim().slice(0, 30) || null;
      if (cvFile) updates.cvFilename = cvFile.filename;
      if (avatarFile) updates.avatarFilename = avatarFile.filename;

      if (pool) {
        // Make sure columns exist (one-time migration)
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_filename TEXT;`);

        const setParts = [];
        const values = [];
        let i = 1;
        if ('phone' in updates) { setParts.push(`phone=$${i++}`); values.push(updates.phone); }
        if ('cvFilename' in updates) { setParts.push(`cv_filename=$${i++}`); values.push(updates.cvFilename); }
        if ('avatarFilename' in updates) { setParts.push(`avatar_filename=$${i++}`); values.push(updates.avatarFilename); }
        if (setParts.length) {
          values.push(req.user.id);
          await pool.query(`UPDATE users SET ${setParts.join(', ')} WHERE id=$${i}`, values);
        }
        const r = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
        return res.json({ ok: true, user: sanitize(userFromRow(r.rows[0])) });
      } else {
        const arr = loadUsersFile();
        const idx = arr.findIndex(u => u.id === req.user.id);
        if (idx === -1) return res.status(404).json({ error: 'User not found.' });
        Object.assign(arr[idx], updates);
        saveUsersFile(arr);
        return res.json({ ok: true, user: sanitize(arr[idx]) });
      }
    } catch (err) {
      console.error('[HerSpace] Profile update error:', err.message);
      return res.status(500).json({ error: err.message || 'Could not update profile.' });
    }
  }
);

// Make uploads folder publicly accessible so profile pictures display
app.use('/uploads', express.static(UPLOAD_DIR));
// ═══════════════════════════════════════════════════════════════════════════════
// START SERVER (must be LAST)
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/cv/upload', requireAuth, upload.single('cv'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

let cvText = '';
try {
  cvText = await extractCvText(req.file.path, req.file.mimetype);
} catch (err) {
  console.error('[HerSpace] CV parse threw:', err.message);
}

if (!cvText || cvText.length < 50) {
  return res.status(400).json({
    error: "We couldn't read this PDF. Some PDFs (especially scanned or mobile-exported ones) have unusual formatting. Please try uploading a Word (.docx) version, or re-save the PDF from your computer."
  });
}

  await updateUserCv(req.user.id, req.file.filename, cvText);

  // Clear the cached company list for this user's city so AI re-matches with the new CV
  companyCache.delete(req.user.city.toLowerCase());

  res.json({ ok: true, filename: req.file.filename, charsExtracted: cvText.length });
});
app.get('/healthz', (req, res) => res.json({ ok: true }));
// ═══════════════════════════════════════════════════════════════════════════════
// TRIPS — recent journeys per user
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/trips', requireAuth, async (req, res) => {
  if (!pool) return res.json({ trips: [] });
  try {
    const r = await pool.query(
      'SELECT * FROM trips WHERE user_id=$1 ORDER BY created_at DESC LIMIT 8',
      [req.user.id]
    );
    res.json({ trips: r.rows.map(tripFromRow) });
  } catch (e) {
    console.error('[HerSpace] /api/trips GET:', e.message);
    res.status(500).json({ error: 'Could not load trips.' });
  }
});

app.post('/api/trips', requireAuth, async (req, res) => {
  const { destination, originLat, originLng, destLat, destLng, durationSeconds, distanceM, status } = req.body;
  if (!destination || typeof destination !== 'string') return res.status(400).json({ error: 'destination required.' });
  if (!pool) return res.json({ ok: true });
  try {
    await pool.query(
      `INSERT INTO trips (user_id, destination, origin_lat, origin_lng, dest_lat, dest_lng, duration_seconds, distance_m, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [req.user.id, destination.slice(0, 200), originLat, originLng, destLat, destLng, durationSeconds, distanceM, status || 'completed', Date.now()]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[HerSpace] /api/trips POST:', e.message);
    res.status(500).json({ error: 'Could not save trip.' });
  }
});
// ═══════════════════════════════════════════════════════════════════════════════
// CYCLE TRACKER — save / update user's period data
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/cycle', requireAuth, async (req, res) => {
  const { lastPeriod, cycleLength } = req.body;

  // Validate
  const dateMatch = /^\d{4}-\d{2}-\d{2}$/.test(lastPeriod);
  if (!dateMatch) return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
  const cycle = parseInt(cycleLength, 10);
  if (!cycle || cycle < 20 || cycle > 45) return res.status(400).json({ error: 'Cycle length must be between 20 and 45 days.' });

  // Don't accept dates in the future
  const dateObj = new Date(lastPeriod);
  if (dateObj > new Date()) return res.status(400).json({ error: 'Last period date cannot be in the future.' });

  if (pool) {
    try {
      await pool.query(
        'UPDATE users SET cycle_last_period=$1, cycle_length=$2 WHERE id=$3',
        [lastPeriod, cycle, req.user.id]
      );
      const updated = await findUserById(req.user.id);
      return res.json({ ok: true, user: sanitize(updated) });
    } catch (e) {
      console.error('[HerSpace] /api/cycle:', e.message);
      return res.status(500).json({ error: 'Could not save cycle data.' });
    }
  } else {
    // JSON fallback
    const arr = loadUsersFile();
    const u = arr.find(x => x.id === req.user.id);
    if (u) {
      u.cycleLastPeriod = lastPeriod;
      u.cycleLength = cycle;
      saveUsersFile(arr);
      return res.json({ ok: true, user: sanitize(u) });
    }
    return res.status(404).json({ error: 'User not found.' });
  }
});
app.listen(PORT, () => {
  console.log(`[HerSpace] Server listening on port ${PORT}`);
});

(async () => {
  try {
    await initDb();
    await seedReportsIfEmpty();
    console.log('[HerSpace] All ready.');
  } catch (err) {
    console.error('[HerSpace] Startup error:', err.message);
  }
})();
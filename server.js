require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// The Card Binder page is a published Artifact hosted on a different domain,
// so the browser will send cross-origin requests here. Since auth uses a
// Bearer token (not cookies), an open CORS policy doesn't expose you to
// CSRF — but you can tighten this to specific origins later if you want.
app.use(cors());

// Card photos are saved as base64 data URLs, so allow a generous JSON body.
app.use(express.json({ limit: '15mb' }));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('Missing JWT_SECRET environment variable. Set one in Railway → Variables before deploying.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway's managed Postgres works with SSL enabled but doesn't need a
  // verified certificate chain for this.
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_data (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      collection JSONB NOT NULL DEFAULT '[]',
      want JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

function signToken(user) {
  return jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired session — please log in again.' });
  }
}

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'card-binder-server' });
});

// ---- Sign up ----
app.post('/api/signup', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || String(password).length < 6) {
    return res.status(400).json({ error: 'Name, email, and a password of at least 6 characters are required.' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'An account with that email already exists — try logging in instead.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [String(name).trim(), normalizedEmail, passwordHash]
    );
    const user = result.rows[0];
    await pool.query(
      'INSERT INTO user_data (user_id, collection, want) VALUES ($1, $2, $3)',
      [user.id, '[]', '[]']
    );

    const token = signToken(user);
    res.json({ token, user: { name: user.name, email: user.email } });
  } catch (e) {
    console.error('Signup failed', e);
    res.status(500).json({ error: 'Could not create the account. Please try again.' });
  }
});

// ---- Log in ----
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    const result = await pool.query(
      'SELECT id, name, email, password_hash FROM users WHERE email = $1',
      [normalizedEmail]
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'No account found with that email.' });

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) return res.status(401).json({ error: 'Incorrect password.' });

    const token = signToken(user);
    res.json({ token, user: { name: user.name, email: user.email } });
  } catch (e) {
    console.error('Login failed', e);
    res.status(500).json({ error: 'Could not log in. Please try again.' });
  }
});

// ---- Get the signed-in user's collection + want list ----
app.get('/api/data', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT collection, want FROM user_data WHERE user_id = $1',
      [req.userId]
    );
    const row = result.rows[0] || { collection: [], want: [] };
    res.json({ collection: row.collection || [], want: row.want || [] });
  } catch (e) {
    console.error('Load data failed', e);
    res.status(500).json({ error: 'Could not load your data.' });
  }
});

// ---- Save the signed-in user's collection + want list ----
app.put('/api/data', auth, async (req, res) => {
  const { collection, want } = req.body || {};
  try {
    await pool.query(
      `INSERT INTO user_data (user_id, collection, want, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id)
       DO UPDATE SET collection = $2, want = $3, updated_at = now()`,
      [req.userId, JSON.stringify(collection || []), JSON.stringify(want || [])]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('Save data failed', e);
    res.status(500).json({ error: 'Could not save your data.' });
  }
});

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`card-binder-server listening on port ${PORT}`));
  })
  .catch((e) => {
    console.error('Failed to set up the database tables', e);
    process.exit(1);
  });

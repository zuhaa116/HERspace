/* ═══════════════════════════════════════════════
   HerSpace — auth.js
   Landing / Login / Signup page logic
   ═══════════════════════════════════════════════ */

// If already logged in, skip the landing page entirely
// Hide intro splash after 3.6s (matches CSS animation timing)
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const splash = document.getElementById('intro-splash');
    if (splash) splash.classList.add('hidden');
  }, 7600);
});
(async function checkExistingSession() {
  try {
    const res = await fetch('/api/me');
    const data = await res.json();
    if (data.user) window.location.replace('/app.html');
  } catch (e) { /* offline — let user proceed */ }
})();

function showView(name) {
  ['landing', 'login', 'signup'].forEach(v => {
    document.getElementById('view-' + v).classList.toggle('active', v === name);
  });
  // Clear errors when switching views
  const loginErr = document.getElementById('login-error');
  const signupErr = document.getElementById('signup-error');
  if (loginErr) { loginErr.hidden = true; loginErr.textContent = ''; }
  if (signupErr) { signupErr.hidden = true; signupErr.textContent = ''; }
}

/* ─── Signup: independence toggle ─── */
let signupIndependent = 'yes';
function setIndep(value) {
  signupIndependent = value;
  document.getElementById('indep-yes').classList.toggle('active', value === 'yes');
  document.getElementById('indep-no').classList.toggle('active', value === 'no');
}

/* ─── Signup: CV filename display ─── */
function onCvChosen(e) {
  const file = e.target.files[0];
  const label = document.getElementById('signup-cv-name');
  label.textContent = file ? file.name : 'Choose file…';
}

/* ─── Signup submit ─── */
async function submitSignup() {
  const errEl = document.getElementById('signup-error');
  const btn = document.getElementById('signup-submit');
  errEl.hidden = true; errEl.textContent = '';

  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const city = document.getElementById('signup-city').value.trim();
  const age = document.getElementById('signup-age').value;
  const cvInput = document.getElementById('signup-cv');

  // Client-side checks (mirrored on the server)
  if (name.length < 2)        return showErr(errEl, 'Please enter your full name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErr(errEl, 'Please enter a valid email.');
  if (password.length < 6)    return showErr(errEl, 'Password must be at least 6 characters.');
  if (city.length < 2)        return showErr(errEl, 'Please enter your city.');
  const ageNum = parseInt(age, 10);
  if (!ageNum || ageNum < 13 || ageNum > 100) return showErr(errEl, 'Please enter a valid age.');

  // multipart/form-data because of the optional CV file
  const form = new FormData();
  form.append('name', name);
  form.append('email', email);
  form.append('password', password);
  form.append('city', city);
  form.append('age', ageNum);
  form.append('independent', signupIndependent);
  if (cvInput.files[0]) form.append('cv', cvInput.files[0]);

  btn.disabled = true; btn.textContent = 'Creating account…';
  try {
    const res = await fetch('/api/signup', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) return showErr(errEl, data.error || 'Could not create account.', btn, 'Create account');
    // Success — session cookie set, redirect to app
    window.location.replace('/app.html');
  } catch (err) {
    showErr(errEl, 'Could not reach the server. Try again.', btn, 'Create account');
  }
}

/* ─── Login submit ─── */
async function submitLogin() {
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-submit');
  errEl.hidden = true; errEl.textContent = '';

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) return showErr(errEl, 'Email and password are required.');

  btn.disabled = true; btn.textContent = 'Logging in…';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) return showErr(errEl, data.error || 'Login failed.', btn, 'Log in');
    window.location.replace('/app.html');
  } catch (err) {
    showErr(errEl, 'Could not reach the server. Try again.', btn, 'Log in');
  }
}

/* ─── Error helper ─── */
function showErr(el, msg, btn, btnLabel) {
  el.textContent = msg;
  el.hidden = false;
  if (btn) { btn.disabled = false; btn.textContent = btnLabel || btn.textContent; }
}

/* ─── Submit on Enter key inside any input ─── */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const active = document.querySelector('.auth-view.active');
  if (!active) return;
  if (active.id === 'view-login') submitLogin();
  if (active.id === 'view-signup') submitSignup();
});

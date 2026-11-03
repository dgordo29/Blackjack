// Login with Supabase: email + password, Google, password reset, and profiles.
// The publishable key is safe to ship in the browser; row level security
// on the profiles table keeps each user to their own row.
const SUPABASE_URL = 'https://fhdgeodqraxyuxgaowpg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_IvRB5Nb_SHE9NPpNqPsw0Q_OvA9jP3E';

(function () {
  const el = (id) => document.getElementById(id);
  const authScreen = el('auth-screen');
  const game = el('game');
  const authMsg = el('auth-message');

  function say(text, isError = false) {
    authMsg.textContent = text || '';
    authMsg.classList.toggle('error', !!isError);
  }

  function showView(view) {
    el('auth-main').classList.toggle('hidden', view !== 'main');
    el('forgot-form').classList.toggle('hidden', view !== 'forgot');
    el('reset-form').classList.toggle('hidden', view !== 'reset');
  }

  function showAuth(view = 'main') {
    game.classList.add('hidden');
    authScreen.classList.remove('hidden');
    showView(view);
  }

  if (!window.supabase || !window.supabase.createClient) {
    showAuth();
    say('Could not load the login service. Check your connection and refresh.', true);
    return;
  }

  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const redirectTo = window.location.origin + window.location.pathname;

  let user = null;
  let profile = null;
  let recovering = false;

  // ---------- Signed in / out ----------
  function showGame() {
    authScreen.classList.add('hidden');
    game.classList.remove('hidden');
    say('');
  }

  function displayName() {
    const meta = user?.user_metadata || {};
    return profile?.display_name || meta.full_name || meta.name || user?.email || '';
  }

  function renderUser() {
    el('user-name').textContent = displayName();
    el('user-name').title = user?.email || '';
    const meta = user?.user_metadata || {};
    const avatar = profile?.avatar_url || meta.avatar_url || meta.picture;
    const img = el('user-avatar');
    if (avatar) { img.src = avatar; img.classList.remove('hidden'); }
    else { img.removeAttribute('src'); img.classList.add('hidden'); }
  }

  async function loadProfile() {
    const { data, error } = await db
      .from('profiles')
      .select('display_name, avatar_url, bank')
      .eq('id', user.id)
      .maybeSingle();
    if (error) { console.error(error); return; }
    profile = data;
    renderUser();
    if (profile && window.blackjack) window.blackjack.setBank(profile.bank);
  }

  db.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      recovering = true;
      showAuth('reset');
      say('');
      return;
    }
    user = session?.user || null;
    if (!user) {
      profile = null;
      showAuth(recovering ? 'reset' : 'main');
      return;
    }
    if (recovering) return;
    showGame();
    renderUser();
    // Don't call Supabase inside this callback directly; defer it.
    setTimeout(loadProfile, 0);
  });

  // ---------- Save bank to the profile ----------
  let bankTimer = null;
  window.onBankSaved = (bank) => {
    if (!user) return;
    clearTimeout(bankTimer);
    bankTimer = setTimeout(async () => {
      const { error } = await db.from('profiles').update({ bank }).eq('id', user.id);
      if (error) console.error('Could not save bank', error);
      else if (profile) profile.bank = bank;
    }, 400);
  };

  // ---------- Log in / sign up ----------
  let mode = 'login';
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      mode = tab.dataset.mode;
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      el('auth-submit').textContent = mode === 'login' ? 'Log in' : 'Create account';
      el('auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
      say('');
    });
  });

  async function busy(button, fn) {
    button.disabled = true;
    try { await fn(); } finally { button.disabled = false; }
  }

  el('auth-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = el('auth-email').value.trim();
    const password = el('auth-password').value;
    busy(el('auth-submit'), async () => {
      say(mode === 'login' ? 'Logging in…' : 'Creating your account…');
      if (mode === 'login') {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) say(error.message, true);
      } else {
        const { data, error } = await db.auth.signUp({
          email, password, options: { emailRedirectTo: redirectTo },
        });
        if (error) say(error.message, true);
        else if (!data.session) say('Check your email to confirm your account, then log in.');
      }
    });
  });

  el('google-login').addEventListener('click', () => {
    busy(el('google-login'), async () => {
      const { error } = await db.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (error) say(error.message, true);
    });
  });

  // ---------- Forgot / reset password ----------
  el('forgot-link').addEventListener('click', () => {
    el('forgot-email').value = el('auth-email').value;
    showView('forgot');
    say('');
  });
  el('forgot-back').addEventListener('click', () => { showView('main'); say(''); });

  el('forgot-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = e.submitter || el('forgot-form').querySelector('button[type=submit]');
    busy(btn, async () => {
      const { error } = await db.auth.resetPasswordForEmail(el('forgot-email').value.trim(), { redirectTo });
      if (error) say(error.message, true);
      else say('If that email has an account, a reset link is on its way.');
    });
  });

  el('reset-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = el('reset-form').querySelector('button[type=submit]');
    busy(btn, async () => {
      const { data, error } = await db.auth.updateUser({ password: el('reset-password').value });
      if (error) { say(error.message, true); return; }
      recovering = false;
      el('reset-password').value = '';
      user = data.user;
      showGame();
      renderUser();
      loadProfile();
      el('message').textContent = 'Password updated. Place your bet!';
    });
  });

  // ---------- Log out ----------
  el('logout').addEventListener('click', async () => {
    await db.auth.signOut();
    say('You are logged out.');
  });

  // ---------- Profile ----------
  const dialog = el('profile-dialog');
  el('profile-open').addEventListener('click', () => {
    el('profile-email').textContent = user?.email || '';
    el('profile-name').value = profile?.display_name || '';
    el('profile-message').textContent = '';
    dialog.showModal();
  });
  el('profile-close').addEventListener('click', () => dialog.close());

  el('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = el('profile-message');
    const display_name = el('profile-name').value.trim() || null;
    el('profile-save').disabled = true;
    const { error } = await db.from('profiles').update({ display_name }).eq('id', user.id);
    el('profile-save').disabled = false;
    if (error) {
      msg.textContent = error.message;
      msg.classList.add('error');
      return;
    }
    msg.classList.remove('error');
    msg.textContent = 'Saved.';
    profile = { ...(profile || {}), display_name };
    renderUser();
  });
})();

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
    renderGreeting(avatar);
  }

  // ---------- Greeting ----------
  let greetingDismissed = false;
  function renderGreeting(avatar) {
    const box = el('greeting');
    if (!user || greetingDismissed) { box.classList.add('hidden'); return; }
    const name = displayName();
    // First name only, unless the "name" is an email address
    const first = name.includes('@') ? name : name.split(' ')[0];
    const hour = new Date().getHours();
    const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    el('greeting-title').textContent = `${part}, ${first}!`;
    const img = el('greeting-avatar');
    if (avatar) { img.src = avatar; img.classList.remove('hidden'); }
    else { img.removeAttribute('src'); img.classList.add('hidden'); }
    box.classList.remove('hidden');
  }
  el('greeting-close').addEventListener('click', () => {
    greetingDismissed = true;
    el('greeting').classList.add('hidden');
  });

  async function loadProfile() {
    const { data, error } = await db
      .from('profiles')
      .select('display_name, avatar_url, bank, username, hometown, bio, hands_played, hands_won, hands_lost, hands_pushed, blackjacks, biggest_win, created_at')
      .eq('id', user.id)
      .maybeSingle();
    if (error) { console.error(error); return; }
    profile = data;
    renderUser();
    renderStats();
    if (profile && window.blackjack) window.blackjack.setBank(profile.bank);
    // First visit: ask the player to create their profile
    if (profile && !profile.username) showTab('profile');
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
      greetingDismissed = false;
      showAuth(recovering ? 'reset' : 'main');
      return;
    }
    if (recovering) return;
    if (game.classList.contains('hidden')) showTab('table');
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

  // ---------- Tabs ----------
  function showTab(name) {
    document.querySelectorAll('.view-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
    el('table-view').classList.toggle('hidden', name !== 'table');
    el('profile-view').classList.toggle('hidden', name !== 'profile');
    if (name === 'profile') fillProfileForm();
  }
  document.querySelectorAll('.view-tab').forEach((t) => {
    t.addEventListener('click', () => showTab(t.dataset.view));
  });

  // ---------- Profile ----------
  const money = (n) => '$' + Number(n || 0).toLocaleString();

  function fillProfileForm() {
    const meta = user?.user_metadata || {};
    const isNew = !profile?.username;
    el('profile-heading').textContent = isNew ? 'Create your profile' : 'Your profile';
    el('profile-intro').classList.toggle('hidden', !isNew);
    el('profile-save').textContent = isNew ? 'Create profile' : 'Save profile';
    el('profile-email').textContent = user?.email || '';
    el('profile-name').value = profile?.display_name || meta.full_name || meta.name || '';
    el('profile-username').value = profile?.username || '';
    el('profile-hometown').value = profile?.hometown || '';
    el('profile-bio').value = profile?.bio || '';
    el('bio-count').textContent = el('profile-bio').value.length;
    el('profile-message').textContent = '';
    const avatar = profile?.avatar_url || meta.avatar_url || meta.picture;
    const img = el('profile-avatar');
    if (avatar) { img.src = avatar; img.classList.remove('hidden'); }
    else { img.removeAttribute('src'); img.classList.add('hidden'); }
    renderStats();
  }

  function renderStats() {
    const p = profile || {};
    const played = p.hands_played || 0;
    el('stat-bank').textContent = money(p.bank ?? 1000);
    el('stat-played').textContent = played.toLocaleString();
    el('stat-rate').textContent = played ? Math.round((p.hands_won / played) * 100) + '%' : '–';
    el('stat-wlp').textContent = (p.hands_won || 0) + ' / ' + (p.hands_lost || 0) + ' / ' + (p.hands_pushed || 0);
    el('stat-bj').textContent = (p.blackjacks || 0).toLocaleString();
    el('stat-biggest').textContent = money(p.biggest_win);
    el('stat-since').textContent = p.created_at
      ? new Date(p.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
      : '–';
  }

  el('profile-bio').addEventListener('input', () => {
    el('bio-count').textContent = el('profile-bio').value.length;
  });

  el('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = el('profile-message');
    const wasNew = !profile?.username;
    const updates = {
      display_name: el('profile-name').value.trim() || null,
      username: el('profile-username').value.trim(),
      hometown: el('profile-hometown').value.trim() || null,
      bio: el('profile-bio').value.trim() || null,
    };
    el('profile-save').disabled = true;
    const { error } = await db.from('profiles').update(updates).eq('id', user.id);
    el('profile-save').disabled = false;
    if (error) {
      msg.textContent = error.code === '23505' ? 'That username is taken. Try another.' : error.message;
      msg.classList.add('error');
      return;
    }
    profile = { ...(profile || {}), ...updates };
    renderUser();
    fillProfileForm();
    msg.classList.remove('error');
    msg.textContent = wasNew ? 'Profile created! Head to the Table to play.' : 'Saved.';
  });

  // ---------- Stats ----------
  window.onRoundFinished = async (r) => {
    if (!user) return;
    clearTimeout(bankTimer); // record_round saves the bank too
    const { error } = await db.rpc('record_round', {
      p_won: r.won, p_lost: r.lost, p_pushed: r.pushed,
      p_blackjacks: r.blackjacks, p_net: r.net, p_bank: r.bank,
    });
    if (error) { console.error('Could not save stats', error); return; }
    if (profile) {
      profile.hands_played = (profile.hands_played || 0) + r.won + r.lost + r.pushed;
      profile.hands_won = (profile.hands_won || 0) + r.won;
      profile.hands_lost = (profile.hands_lost || 0) + r.lost;
      profile.hands_pushed = (profile.hands_pushed || 0) + r.pushed;
      profile.blackjacks = (profile.blackjacks || 0) + r.blackjacks;
      profile.biggest_win = Math.max(profile.biggest_win || 0, r.net);
      profile.bank = r.bank;
      renderStats();
    }
  };
})();

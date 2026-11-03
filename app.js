// Blackjack powered by the Deck of Cards API (https://deckofcardsapi.com/)
const API = 'https://deckofcardsapi.com/api/deck';
const CARD_BACK = 'https://deckofcardsapi.com/static/img/back.png';
const DECK_COUNT = 6;
const RESHUFFLE_AT = 75; // reshuffle the shoe when fewer cards remain
const START_BANK = 1000;
const STORAGE_KEY = 'blackjack-bank';
const PREFS_KEY = 'blackjack-prefs';

const $ = (id) => document.getElementById(id);

const state = {
  deckId: null,
  remaining: 0,
  bank: loadBank(),
  pendingBet: 0,
  dealer: [],
  hands: [], // [{ cards, bet, done, doubled }]
  active: 0,
  inRound: false,
  busy: false,
  // Tracking for stats
  runningCount: 0,     // Hi-Lo count of every card seen since the last shuffle
  roundCards: [],      // cards drawn this round (added to the count at round end)
  round: null,         // snapshot taken at the deal
};

// ---------- Preferences (strategy label, hints, count) ----------
const prefs = loadPrefs();
function loadPrefs() {
  try { return { strategy: 'Basic strategy', hints: false, count: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; }
  catch { return { strategy: 'Basic strategy', hints: false, count: false }; }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

// ---------- Storage ----------
function loadBank() {
  try {
    const v = parseInt(localStorage.getItem(STORAGE_KEY), 10);
    return Number.isFinite(v) && v > 0 ? v : START_BANK;
  } catch { return START_BANK; }
}
function saveBank() {
  try { localStorage.setItem(STORAGE_KEY, String(state.bank)); } catch { /* ignore */ }
  if (typeof window.onBankSaved === 'function') window.onBankSaved(state.bank);
}

// ---------- API ----------
async function api(path) {
  const res = await fetch(`${API}/${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'API request failed');
  state.remaining = data.remaining;
  return data;
}

async function newShoe() {
  const data = await api(`new/shuffle/?deck_count=${DECK_COUNT}`);
  state.deckId = data.deck_id;
  state.runningCount = 0;
}

async function reshuffle() {
  await api(`${state.deckId}/shuffle/`); // returns all cards to the shoe
  state.runningCount = 0;
}

async function draw(count = 1) {
  const data = await api(`${state.deckId}/draw/?count=${count}`);
  state.roundCards.push(...data.cards);
  return data.cards;
}

const trueCount = () => {
  const decksLeft = Math.max(state.remaining / 52, 0.5);
  return Math.round((state.runningCount / decksLeft) * 100) / 100;
};

// ---------- Rules ----------
function cardValue(card) {
  if (card.value === 'ACE') return 11;
  if (['KING', 'QUEEN', 'JACK'].includes(card.value)) return 10;
  return parseInt(card.value, 10);
}

function handTotal(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.value === 'ACE') aces++;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}

const isBlackjack = (cards) => cards.length === 2 && handTotal(cards).total === 21;

// ---------- Rendering ----------
function cardImg(card, faceDown = false) {
  const img = document.createElement('img');
  img.src = faceDown ? CARD_BACK : (card.images?.svg || card.image);
  img.onerror = () => { if (card.image && img.src !== card.image) img.src = card.image; };
  img.alt = faceDown ? 'Face-down card' : `${card.value} of ${card.suit}`;
  return img;
}

function scoreLabel(cards) {
  const { total, soft } = handTotal(cards);
  return soft && total < 21 ? `${total - 10} / ${total}` : String(total);
}

function render() {
  $('bank').textContent = `$${state.bank.toLocaleString()}`;
  $('bet').textContent = `$${(state.inRound
    ? state.hands.reduce((s, h) => s + h.bet, 0)
    : state.pendingBet).toLocaleString()}`;
  $('remaining').textContent = state.deckId ? state.remaining : '–';

  // Dealer
  const dealerEl = $('dealer-hand');
  dealerEl.innerHTML = '';
  const hideHole = state.inRound && state.dealer.length === 2;
  state.dealer.forEach((c, i) => dealerEl.appendChild(cardImg(c, hideHole && i === 1)));
  $('dealer-score').textContent = state.dealer.length
    ? (hideHole ? scoreLabel([state.dealer[0]]) : scoreLabel(state.dealer))
    : '';

  // Player
  const handsEl = $('player-hands');
  handsEl.innerHTML = '';
  state.hands.forEach((h, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'player-hand' + (state.inRound && i === state.active && state.hands.length > 1 ? ' active' : '');
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<span class="score">${scoreLabel(h.cards)}</span> Bet $${h.bet}${h.result ? ` · <strong>${h.result}</strong>` : ''}`;
    const cardsEl = document.createElement('div');
    cardsEl.className = 'hand';
    h.cards.forEach((c) => cardsEl.appendChild(cardImg(c)));
    wrap.append(meta, cardsEl);
    handsEl.appendChild(wrap);
  });

  // Controls
  $('betting').classList.toggle('hidden', state.inRound);
  $('actions').classList.toggle('hidden', !state.inRound);
  document.querySelectorAll('.chip').forEach((b) => {
    b.disabled = state.busy || state.pendingBet + Number(b.dataset.chip) > state.bank;
  });
  $('deal').disabled = state.busy || !state.deckId || state.pendingBet <= 0;
  $('clear-bet').disabled = state.busy || state.pendingBet <= 0;

  const hand = state.hands[state.active];
  const canAct = state.inRound && !state.busy && hand && !hand.done;

  // Optional training aids
  const hintEl = $('hint');
  if (hintEl) {
    const showHint = prefs.hints && canAct;
    hintEl.classList.toggle('hidden', !showHint);
    if (showHint) hintEl.textContent = `Basic strategy says: ${recommendation(hand)}`;
  }
  const countEl = $('count');
  if (countEl) {
    countEl.classList.toggle('hidden', !prefs.count);
    countEl.textContent = `Running count ${state.runningCount >= 0 ? '+' : ''}${state.runningCount} · True count ${trueCount() >= 0 ? '+' : ''}${trueCount().toFixed(1)}`;
  }
  $('hit').disabled = !canAct;
  $('stand').disabled = !canAct;
  $('double').disabled = !canAct || hand.cards.length !== 2 || state.bank < hand.bet;
  $('split').disabled = !canAct || state.hands.length > 1 || hand.cards.length !== 2
    || cardValue(hand.cards[0]) !== cardValue(hand.cards[1]) || state.bank < hand.bet;
}

function setMessage(text) { $('message').textContent = text; }

async function withBusy(fn) {
  if (state.busy) return;
  state.busy = true;
  render();
  try { await fn(); } catch (err) {
    console.error(err);
    setMessage(`Couldn't reach the card API (${err.message}). Try again.`);
  } finally {
    state.busy = false;
    render();
  }
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Decisions (what you did vs. basic strategy) ----------
function options(hand) {
  return {
    canDouble: hand.cards.length === 2 && state.bank >= hand.bet,
    canSplit: state.hands.length === 1 && hand.cards.length === 2
      && cardValue(hand.cards[0]) === cardValue(hand.cards[1]) && state.bank >= hand.bet,
  };
}

function recommendation(hand) {
  const { canDouble, canSplit } = options(hand);
  return Strategy.recommend(hand.cards, Strategy.rank(state.dealer[0]), canDouble, canSplit);
}

function recordDecision(action) {
  const hand = state.hands[state.active];
  const { total, soft } = handTotal(hand.cards);
  const { canDouble, canSplit } = options(hand);
  const isPair = hand.cards.length === 2 && Strategy.rank(hand.cards[0]) === Strategy.rank(hand.cards[1]);
  hand.actions.push(action);
  hand.decisions.push({
    step: hand.decisions.length + 1,
    cards: hand.cards.map(Strategy.code),
    total,
    soft,
    pair: isPair && canSplit,
    pair_rank: isPair ? Strategy.rank(hand.cards[0]) : null,
    dealer_up: Strategy.rank(state.dealer[0]),
    can_double: canDouble,
    can_split: canSplit,
    action,
    recommended: Strategy.recommend(hand.cards, Strategy.rank(state.dealer[0]), canDouble, canSplit),
    true_count: state.round ? state.round.true_count : null,
  });
}

function newHand(cards, bet, extra = {}) {
  const { total, soft } = handTotal(cards);
  return {
    cards, bet, done: false, result: '', doubled: false, fromSplit: false,
    startCards: cards.slice(), startTotal: total, startSoft: soft,
    startPair: cards.length === 2 && Strategy.rank(cards[0]) === Strategy.rank(cards[1]),
    actions: [], decisions: [], ...extra,
  };
}

// ---------- Game flow ----------
async function deal() {
  if (state.pendingBet <= 0 || state.pendingBet > state.bank) return;
  if (state.remaining < RESHUFFLE_AT) {
    setMessage('Shuffling the shoe…');
    await reshuffle();
  }
  state.roundCards = [];
  state.round = {
    strategy: (prefs.strategy || '').trim() || 'Unlabeled',
    bank_before: state.bank,
    running_count: state.runningCount,
    true_count: trueCount(),
    cards_remaining: state.remaining,
  };
  const cards = await draw(4);
  const bet = state.pendingBet;
  state.bank -= bet;
  state.hands = [newHand([cards[0], cards[2]], bet)];
  state.dealer = [cards[1], cards[3]];
  state.active = 0;
  state.inRound = true;
  saveBank();
  setMessage('Hit or stand?');

  const playerBJ = isBlackjack(state.hands[0].cards);
  const dealerBJ = isBlackjack(state.dealer);
  if (playerBJ || dealerBJ) {
    state.hands[0].done = true;
    await finishRound();
  }
}

async function hit() {
  const hand = state.hands[state.active];
  recordDecision('hit');
  const [card] = await draw(1);
  hand.cards.push(card);
  const { total } = handTotal(hand.cards);
  if (total > 21) {
    hand.done = true;
    hand.result = 'Bust';
    await nextHand();
  } else if (total === 21) {
    hand.done = true;
    await nextHand();
  }
}

async function stand() {
  recordDecision('stand');
  state.hands[state.active].done = true;
  await nextHand();
}

async function doubleDown() {
  const hand = state.hands[state.active];
  recordDecision('double');
  state.bank -= hand.bet;
  hand.bet *= 2;
  hand.doubled = true;
  saveBank();
  const [card] = await draw(1);
  hand.cards.push(card);
  hand.done = true;
  if (handTotal(hand.cards).total > 21) hand.result = 'Bust';
  await nextHand();
}

async function split() {
  const hand = state.hands[0];
  recordDecision('split');
  state.bank -= hand.bet;
  saveBank();
  const splitAces = hand.cards[0].value === 'ACE';
  const newCards = await draw(2);
  // The split decision is kept on hand 1 only, so it is counted once
  state.hands = [
    newHand([hand.cards[0], newCards[0]], hand.bet, {
      done: splitAces, fromSplit: true, actions: ['split'], decisions: hand.decisions.slice(),
      startCards: hand.cards.slice(), startTotal: hand.startTotal, startSoft: hand.startSoft, startPair: true,
    }),
    newHand([hand.cards[1], newCards[1]], hand.bet, {
      done: splitAces, fromSplit: true, actions: ['split'], startCards: hand.cards.slice(),
      startTotal: hand.startTotal, startSoft: hand.startSoft, startPair: true,
    }),
  ];
  state.hands[0].handIndex = 0;
  state.hands[1].handIndex = 1;
  state.active = 0;
  if (splitAces) {
    setMessage('Split aces get one card each.');
    await finishRound();
  } else {
    setMessage('Playing hand 1…');
    if (handTotal(state.hands[0].cards).total === 21) { state.hands[0].done = true; await nextHand(); }
  }
}

async function nextHand() {
  while (state.active < state.hands.length && state.hands[state.active].done) state.active++;
  if (state.active >= state.hands.length) {
    state.active = state.hands.length - 1;
    await finishRound();
  } else {
    setMessage(`Playing hand ${state.active + 1}…`);
    if (handTotal(state.hands[state.active].cards).total === 21) {
      state.hands[state.active].done = true;
      await nextHand();
    }
  }
}

async function finishRound() {
  const split = state.hands.length > 1;
  const allBust = state.hands.every((h) => handTotal(h.cards).total > 21);
  const playerBJ = !split && isBlackjack(state.hands[0].cards);
  const dealerBJ = isBlackjack(state.dealer);

  // Reveal hole card
  state.inRound = false;
  state.busy = true;
  render();

  // Dealer draws to 17 (stands on all 17s) unless nothing is left to play for
  if (!allBust && !playerBJ && !dealerBJ) {
    while (handTotal(state.dealer).total < 17) {
      await pause(450);
      const [card] = await draw(1);
      state.dealer.push(card);
      render();
    }
  }

  const dealerTotal = handTotal(state.dealer).total;
  let net = 0;
  for (const h of state.hands) {
    const total = handTotal(h.cards).total;
    let payout = 0;
    if (total > 21) {
      h.result = 'Bust';
    } else if (playerBJ && !dealerBJ) {
      h.result = 'Blackjack!';
      payout = h.bet + Math.floor(h.bet * 1.5);
    } else if (dealerBJ && !playerBJ) {
      h.result = 'Dealer blackjack';
    } else if (playerBJ && dealerBJ) {
      h.result = 'Push';
      payout = h.bet;
    } else if (dealerTotal > 21 || total > dealerTotal) {
      h.result = 'Win';
      payout = h.bet * 2;
    } else if (total === dealerTotal) {
      h.result = 'Push';
      payout = h.bet;
    } else {
      h.result = 'Lose';
    }
    state.bank += payout;
    net += payout - h.bet;
  }
  saveBank();

  // Every card from this round is now face up: add them to the count
  for (const c of state.roundCards) state.runningCount += Strategy.hiLo(c);
  state.roundCards = [];

  // Report the round so auth.js can save it
  if (typeof window.onRoundFinished === 'function' && state.round) {
    const RESULT = { 'Win': 'win', 'Blackjack!': 'blackjack', 'Push': 'push', 'Lose': 'lose', 'Bust': 'bust', 'Dealer blackjack': 'dealer_blackjack' };
    const PAYOUT = { win: 2, blackjack: 2.5, push: 1 };
    const hands = state.hands.map((h, i) => {
      const result = RESULT[h.result] || 'lose';
      const payout = result === 'blackjack' ? h.bet + Math.floor(h.bet * 1.5) : Math.round(h.bet * (PAYOUT[result] || 0));
      return {
        hand_index: i,
        from_split: h.fromSplit,
        start_cards: h.startCards.map(Strategy.code),
        start_total: h.startTotal,
        start_soft: h.startSoft,
        start_pair: h.startPair,
        final_cards: h.cards.map(Strategy.code),
        final_total: handTotal(h.cards).total,
        bet: h.bet,
        doubled: h.doubled,
        result,
        net: payout - h.bet,
        actions: h.actions,
        decisions: h.decisions,
      };
    });
    window.onRoundFinished({
      round: {
        ...state.round,
        dealer_upcard: Strategy.rank(state.dealer[0]),
        dealer_cards: state.dealer.map(Strategy.code),
        dealer_total: dealerTotal,
        dealer_blackjack: dealerBJ,
        dealer_bust: dealerTotal > 21,
        total_bet: state.hands.reduce((sum, h) => sum + h.bet, 0),
        net,
        bank_after: state.bank,
        was_split: split,
      },
      hands,
    });
  }
  state.round = null;

  const summary = net > 0 ? `You won $${net}!` : net < 0 ? `You lost $${-net}.` : (state.hands.length > 1 ? 'You broke even.' : 'Push — bet returned.');
  const dealerNote = dealerTotal > 21 ? 'Dealer busts. ' : '';
  setMessage(`${dealerNote}${summary} Place a bet to play again.`);

  if (state.pendingBet > state.bank) state.pendingBet = 0;
  if (state.bank <= 0) setMessage('You\'re out of money! Reset your bank to keep playing.');
}

// ---------- Events ----------
document.querySelectorAll('.chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    const v = Number(btn.dataset.chip);
    if (state.pendingBet + v <= state.bank) state.pendingBet += v;
    render();
  });
});
$('clear-bet').addEventListener('click', () => { state.pendingBet = 0; render(); });
$('deal').addEventListener('click', () => withBusy(deal));
$('hit').addEventListener('click', () => withBusy(hit));
$('stand').addEventListener('click', () => withBusy(stand));
$('double').addEventListener('click', () => withBusy(doubleDown));
$('split').addEventListener('click', () => withBusy(split));
$('reset').addEventListener('click', () => {
  if (state.inRound) return;
  state.bank = START_BANK;
  state.pendingBet = 0;
  saveBank();
  setMessage('Bank reset. Place your bet.');
  render();
});

$('strategy').value = prefs.strategy;
$('strategy').addEventListener('change', () => { prefs.strategy = $('strategy').value.trim().slice(0, 40) || 'Unlabeled'; $('strategy').value = prefs.strategy; savePrefs(); });
$('show-hints').checked = prefs.hints;
$('show-hints').addEventListener('change', () => { prefs.hints = $('show-hints').checked; savePrefs(); render(); });
$('show-count').checked = prefs.count;
$('show-count').addEventListener('change', () => { prefs.count = $('show-count').checked; savePrefs(); render(); });

// Lets auth.js load a signed-in player's saved bank
window.blackjack = {
  setBank(amount) {
    if (state.inRound || !Number.isFinite(amount)) return;
    state.bank = amount;
    state.pendingBet = 0;
    try { localStorage.setItem(STORAGE_KEY, String(amount)); } catch { /* ignore */ }
    render();
  },
};

// ---------- Start ----------
withBusy(async () => {
  await newShoe();
  setMessage('Place your bet, then press Deal.');
});
render();

// Blackjack powered by the Deck of Cards API (https://deckofcardsapi.com/)
const API = 'https://deckofcardsapi.com/api/deck';
const CARD_BACK = 'https://deckofcardsapi.com/static/img/back.png';
const DECK_COUNT = 6;
const RESHUFFLE_AT = 75; // reshuffle the shoe when fewer cards remain
const START_BANK = 1000;
const STORAGE_KEY = 'blackjack-bank';

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
};

// ---------- Storage ----------
function loadBank() {
  try {
    const v = parseInt(localStorage.getItem(STORAGE_KEY), 10);
    return Number.isFinite(v) && v > 0 ? v : START_BANK;
  } catch { return START_BANK; }
}
function saveBank() {
  try { localStorage.setItem(STORAGE_KEY, String(state.bank)); } catch { /* ignore */ }
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
}

async function reshuffle() {
  await api(`${state.deckId}/shuffle/`); // returns all cards to the shoe
}

async function draw(count = 1) {
  const data = await api(`${state.deckId}/draw/?count=${count}`);
  return data.cards;
}

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

// ---------- Game flow ----------
async function deal() {
  if (state.pendingBet <= 0 || state.pendingBet > state.bank) return;
  if (state.remaining < RESHUFFLE_AT) {
    setMessage('Shuffling the shoe…');
    await reshuffle();
  }
  const cards = await draw(4);
  const bet = state.pendingBet;
  state.bank -= bet;
  state.hands = [{ cards: [cards[0], cards[2]], bet, done: false, result: '' }];
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
  state.hands[state.active].done = true;
  await nextHand();
}

async function doubleDown() {
  const hand = state.hands[state.active];
  state.bank -= hand.bet;
  hand.bet *= 2;
  saveBank();
  const [card] = await draw(1);
  hand.cards.push(card);
  hand.done = true;
  if (handTotal(hand.cards).total > 21) hand.result = 'Bust';
  await nextHand();
}

async function split() {
  const hand = state.hands[0];
  state.bank -= hand.bet;
  saveBank();
  const splitAces = hand.cards[0].value === 'ACE';
  const newCards = await draw(2);
  state.hands = [
    { cards: [hand.cards[0], newCards[0]], bet: hand.bet, done: splitAces, result: '' },
    { cards: [hand.cards[1], newCards[1]], bet: hand.bet, done: splitAces, result: '' },
  ];
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

// ---------- Start ----------
withBusy(async () => {
  await newShoe();
  setMessage('Place your bet, then press Deal.');
});
render();

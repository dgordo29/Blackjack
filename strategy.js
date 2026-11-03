// Basic strategy and card counting helpers.
// Rules this matches: 6 decks, dealer stands on all 17s, double after split
// allowed, no surrender. Returns 'hit' | 'stand' | 'double' | 'split'.
(function () {
  // '2'..'10' or 'A' (face cards count as '10')
  function rank(card) {
    if (card.value === 'ACE') return 'A';
    if (['KING', 'QUEEN', 'JACK'].includes(card.value)) return '10';
    return String(parseInt(card.value, 10));
  }

  const upValue = (up) => (up === 'A' ? 11 : Number(up));

  function totals(cards) {
    let total = 0;
    let aces = 0;
    for (const c of cards) {
      const r = rank(c);
      total += r === 'A' ? 11 : Number(r);
      if (r === 'A') aces++;
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return { total, soft: aces > 0 };
  }

  // Basic strategy recommendation for a hand against the dealer's up card.
  function recommend(cards, dealerUp, canDouble, canSplit) {
    const d = upValue(dealerUp);
    const between = (lo, hi) => d >= lo && d <= hi;
    const dbl = (fallback) => (canDouble ? 'double' : fallback);

    // Pairs
    if (canSplit && cards.length === 2 && rank(cards[0]) === rank(cards[1])) {
      const r = rank(cards[0]);
      if (r === 'A' || r === '8') return 'split';
      if ((r === '2' || r === '3' || r === '7') && between(2, 7)) return 'split';
      if (r === '4' && between(5, 6)) return 'split';
      if (r === '6' && between(2, 6)) return 'split';
      if (r === '9' && (between(2, 6) || d === 8 || d === 9)) return 'split';
      // 5s and 10s fall through to the totals below
    }

    const { total, soft } = totals(cards);

    // Soft totals (an ace counted as 11)
    if (soft) {
      if (total >= 19) return 'stand';
      if (total === 18) {
        if (between(3, 6)) return dbl('stand');
        if (d === 2 || d === 7 || d === 8) return 'stand';
        return 'hit';
      }
      if (total === 17) return between(3, 6) ? dbl('hit') : 'hit';
      if (total === 15 || total === 16) return between(4, 6) ? dbl('hit') : 'hit';
      if (total === 13 || total === 14) return between(5, 6) ? dbl('hit') : 'hit';
      return 'hit';
    }

    // Hard totals
    if (total >= 17) return 'stand';
    if (total >= 13) return between(2, 6) ? 'stand' : 'hit';
    if (total === 12) return between(4, 6) ? 'stand' : 'hit';
    if (total === 11) return d === 11 ? 'hit' : dbl('hit');
    if (total === 10) return between(2, 9) ? dbl('hit') : 'hit';
    if (total === 9) return between(3, 6) ? dbl('hit') : 'hit';
    return 'hit';
  }

  // Hi-Lo count value: 2-6 = +1, 7-9 = 0, 10-A = -1
  function hiLo(card) {
    const r = rank(card);
    if (r === 'A' || r === '10') return -1;
    const n = Number(r);
    return n <= 6 ? 1 : 0;
  }

  // Short card code for storage, e.g. 'KH', '0S' (10), 'AD'
  function code(card) {
    if (card.code) return card.code;
    const v = card.value === '10' ? '0' : card.value[0];
    return v + (card.suit ? card.suit[0] : '');
  }

  // A readable name for a situation, e.g. 'Hard 16 vs 10', 'Pair of 8s vs A'
  function situation(d) {
    const kind = d.pair ? `Pair of ${d.pair_rank === 'A' ? 'A' : d.pair_rank}s` : `${d.soft ? 'Soft' : 'Hard'} ${d.total}`;
    return `${kind} vs ${d.dealer_up}`;
  }

  window.Strategy = { rank, totals, recommend, hiLo, code, situation };
})();

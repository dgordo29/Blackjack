// Stats tab: loads every saved round for the signed-in player and turns it
// into KPIs, insights, charts, and tables. Everything is computed in the
// browser from the rounds + hands tables, so new metrics are easy to add.
(function () {
  const el = (id) => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';

  let rounds = null; // all of this player's rounds, oldest first, each with .hands
  let stale = true;
  let loading = false;

  // ---------- Formatting ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString();
  const signed = (n) => (n > 0 ? '+' : '') + money(n);
  const pctSigned = (n) => (Number.isFinite(n) ? (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n * 100).toFixed(1) + '%' : '–');
  const pct = (n) => (Number.isFinite(n) ? Math.round(n * 100) + '%' : '–');
  const WON = ['win', 'blackjack'];
  const LOST = ['lose', 'bust', 'dealer_blackjack'];
  const RESULT_LABEL = { win: 'Win', blackjack: 'Blackjack', push: 'Push', lose: 'Lose', bust: 'Bust', dealer_blackjack: 'Dealer BJ' };
  const cardText = (codes) => (codes || []).map((c) => (c[0] === '0' ? '10' : c[0]) + ({ S: '♠', H: '♥', D: '♦', C: '♣' }[c[1]] || '')).join(' ');

  // ---------- Loading ----------
  async function load() {
    const auth = window.blackjackAuth;
    if (!auth || !auth.getUser()) return;
    loading = true;
    el('stats-status').textContent = 'Loading your history…';
    el('stats-status').classList.remove('hidden');
    const all = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await auth.db
        .from('rounds')
        .select('*, hands(*)')
        .order('played_at', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        loading = false;
        el('stats-status').textContent = `Couldn't load your history: ${error.message}`;
        return;
      }
      all.push(...data);
      if (data.length < PAGE) break;
    }
    all.forEach((r) => r.hands.sort((a, b) => a.hand_index - b.hand_index));
    rounds = all;
    stale = false;
    loading = false;
    fillStrategyFilter();
    render();
  }

  function fillStrategyFilter() {
    const select = el('f-strategy');
    const current = select.value;
    const names = [...new Set(rounds.map((r) => r.strategy))].sort();
    select.innerHTML = '<option value="">All strategies</option>' + names.map((n) => `<option>${esc(n)}</option>`).join('');
    if (names.includes(current)) select.value = current;
  }

  function filtered() {
    const strategy = el('f-strategy').value;
    const days = el('f-time').value;
    const since = days === 'all' ? 0 : Date.now() - Number(days) * 86400000;
    return rounds.filter((r) => (!strategy || r.strategy === strategy) && new Date(r.played_at).getTime() >= since);
  }

  // ---------- Metrics ----------
  function summarize(rs) {
    const hands = rs.flatMap((r) => r.hands.map((h) => ({ ...h, round: r })));
    const decisions = hands.flatMap((h) => (h.decisions || []).map((d) => ({ ...d, hand: h })));
    const won = hands.filter((h) => WON.includes(h.result)).length;
    const lost = hands.filter((h) => LOST.includes(h.result)).length;
    const wagered = hands.reduce((s, h) => s + h.bet, 0);
    const net = rs.reduce((s, r) => s + r.net, 0);
    const mistakes = decisions.filter((d) => d.action !== d.recommended).length;
    return {
      rounds: rs.length,
      hands,
      decisions,
      won,
      lost,
      pushed: hands.length - won - lost,
      winRate: hands.length ? won / hands.length : NaN,
      net,
      wagered,
      roi: wagered ? net / wagered : NaN,
      avgBet: rs.length ? rs.reduce((s, r) => s + r.total_bet, 0) / rs.length : NaN,
      blackjacks: hands.filter((h) => h.result === 'blackjack').length,
      busts: hands.filter((h) => h.result === 'bust').length,
      accuracy: decisions.length ? 1 - mistakes / decisions.length : NaN,
      mistakes,
    };
  }

  function groupBy(items, keyFn) {
    const map = new Map();
    for (const it of items) {
      const k = keyFn(it);
      if (k == null) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(it);
    }
    return map;
  }

  const handWinRate = (hs) => (hs.length ? hs.filter((h) => WON.includes(h.result)).length / hs.length : NaN);

  function startGroup(h) {
    if (h.start_cards.length === 2 && h.start_total === 21 && !h.from_split) return 'Blackjack';
    if (h.start_pair) return 'Pairs';
    if (h.start_soft) return h.start_total >= 19 ? 'Soft 19–20' : 'Soft 13–18';
    const t = h.start_total;
    if (t <= 8) return 'Hard 5–8';
    if (t <= 11) return `Hard ${t}`;
    if (t <= 16) return t === 12 ? 'Hard 12' : 'Hard 13–16';
    return 'Hard 17+';
  }
  const START_ORDER = ['Hard 5–8', 'Hard 9', 'Hard 10', 'Hard 11', 'Hard 12', 'Hard 13–16', 'Hard 17+', 'Soft 13–18', 'Soft 19–20', 'Pairs', 'Blackjack'];
  const UPCARDS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];
  const COUNT_BUCKETS = ['≤ −3', '−2', '−1', '0', '+1', '+2', '≥ +3'];
  function countBucket(tc) {
    if (tc == null) return null;
    const n = Math.round(Number(tc));
    if (n <= -3) return '≤ −3';
    if (n >= 3) return '≥ +3';
    return n === 0 ? '0' : (n > 0 ? '+' : '−') + Math.abs(n);
  }

  function streaks(rs) {
    let bestW = 0; let bestL = 0; let w = 0; let l = 0;
    for (const r of rs) {
      if (r.net > 0) { w++; l = 0; } else if (r.net < 0) { l++; w = 0; } else { w = 0; l = 0; }
      bestW = Math.max(bestW, w); bestL = Math.max(bestL, l);
    }
    return { bestW, bestL };
  }

  // ---------- Render ----------
  function render() {
    if (!rounds) return;
    const rs = filtered();
    const body = el('stats-body');
    if (!rs.length) {
      body.classList.add('hidden');
      el('stats-status').classList.remove('hidden');
      el('stats-status').textContent = rounds.length
        ? 'No rounds match these filters.'
        : 'No hands yet. Every round you play while logged in is saved here, so head to the Table and deal a few.';
      return;
    }
    el('stats-status').classList.add('hidden');
    body.classList.remove('hidden');
    const s = summarize(rs);
    renderKpis(s);
    renderInsights(rs, s);
    renderStrategyTable(rs);
    renderBankChart(rs);
    renderUpcardChart(s);
    renderCountChart(rs);
    renderStartChart(s);
    renderMistakes(s);
    renderRecent(s);
  }

  function renderKpis(s) {
    const tiles = [
      ['Hands played', s.hands.length.toLocaleString(), `${s.rounds.toLocaleString()} rounds`],
      ['Win rate', pct(s.winRate), `${s.won} W · ${s.lost} L · ${s.pushed} P`],
      ['Net result', signed(s.net), `${money(s.wagered)} wagered`],
      ['Return on bets', pctSigned(s.roi), 'net ÷ wagered'],
      ['Strategy accuracy', pct(s.accuracy), `${s.mistakes} of ${s.decisions.length} decisions off-chart`],
      ['Blackjacks', s.blackjacks.toLocaleString(), `${pct(s.hands.length ? s.blackjacks / s.hands.length : NaN)} of hands`],
      ['Bust rate', pct(s.hands.length ? s.busts / s.hands.length : NaN), `${s.busts} busts`],
      ['Average bet', Number.isFinite(s.avgBet) ? money(s.avgBet) : '–', 'per round'],
    ];
    el('kpis').innerHTML = tiles.map(([label, value, sub]) =>
      `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${esc(value)}</div><div class="kpi-sub">${esc(sub)}</div></div>`).join('');
  }

  function renderInsights(rs, s) {
    const out = [];
    const n = s.hands.length;

    // Following basic strategy vs. deviating
    const decided = s.hands.filter((h) => h.followed_strategy !== null);
    const followed = decided.filter((h) => h.followed_strategy);
    const deviated = decided.filter((h) => !h.followed_strategy);
    if (s.decisions.length >= 10) {
      let line = `You follow basic strategy on <strong>${pct(s.accuracy)}</strong> of your decisions.`;
      if (followed.length >= 5 && deviated.length >= 5) {
        const fNet = followed.reduce((a, h) => a + h.net, 0) / followed.length;
        const dNet = deviated.reduce((a, h) => a + h.net, 0) / deviated.length;
        line += ` Hands where you followed it won ${pct(handWinRate(followed))} (avg ${signed(fNet)}); hands where you went off-chart won ${pct(handWinRate(deviated))} (avg ${signed(dNet)}).`;
      }
      out.push(line);
    }

    // Most common mistake
    const mistakes = groupBy(s.decisions.filter((d) => d.action !== d.recommended), (d) => `${Strategy.situation(d)}|${d.action}|${d.recommended}`);
    const top = [...mistakes.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (top && top[1].length >= 2) {
      const [situation, action, rec] = top[0].split('|');
      out.push(`Your most common mistake: <strong>${esc(situation)}</strong>. You chose <em>${action}</em> ${top[1].length} times; basic strategy says <em>${rec}</em>.`);
    }

    // Dealer up cards
    const byUp = groupBy(s.hands, (h) => h.round.dealer_upcard);
    const ups = [...byUp.entries()].filter(([, hs]) => hs.length >= 8).map(([k, hs]) => [k, handWinRate(hs), hs.length]);
    if (ups.length >= 3) {
      ups.sort((a, b) => b[1] - a[1]);
      const best = ups[0]; const worst = ups[ups.length - 1];
      out.push(`You do best against a dealer <strong>${best[0]}</strong> (${pct(best[1])} won, ${best[2]} hands) and worst against a <strong>${worst[0]}</strong> (${pct(worst[1])}, ${worst[2]} hands).`);
    }

    // Doubles
    const doubles = s.hands.filter((h) => h.doubled);
    if (doubles.length >= 5) {
      const dn = doubles.reduce((a, h) => a + h.net, 0);
      out.push(`Your doubles win ${pct(handWinRate(doubles))} of the time and have netted <strong>${signed(dn)}</strong> over ${doubles.length} doubles.`);
    }

    // Strategies
    const byStrat = [...groupBy(rs, (r) => r.strategy).entries()]
      .map(([k, list]) => [k, summarize(list)]).filter(([, sum]) => sum.hands.length >= 20);
    if (byStrat.length >= 2) {
      byStrat.sort((a, b) => b[1].roi - a[1].roi);
      const [bestName, best] = byStrat[0];
      const [worstName, worst] = byStrat[byStrat.length - 1];
      out.push(`Best strategy so far: <strong>${esc(bestName)}</strong> at ${pctSigned(best.roi)} return on bets, versus <strong>${esc(worstName)}</strong> at ${pctSigned(worst.roi)}.`);
    }

    // Card count
    const high = rs.filter((r) => Number(r.true_count) >= 2);
    const rest = rs.filter((r) => r.true_count != null && Number(r.true_count) < 2);
    if (high.length >= 5 && rest.length >= 5) {
      const avg = (list, f) => list.reduce((a, r) => a + f(r), 0) / list.length;
      out.push(`When the true count was +2 or higher you averaged <strong>${signed(avg(high, (r) => r.net))}</strong> per round (avg bet ${money(avg(high, (r) => r.total_bet))}), versus ${signed(avg(rest, (r) => r.net))} otherwise (avg bet ${money(avg(rest, (r) => r.total_bet))}). Counters raise their bets when the count is high.`);
    }

    // Streaks
    const { bestW, bestL } = streaks(rs);
    if (rs.length >= 10) out.push(`Longest winning streak: <strong>${bestW}</strong> rounds. Longest losing streak: <strong>${bestL}</strong> rounds.`);

    if (n < 200) out.push(`<span class="muted">Blackjack results swing a lot. With ${n} hands, most differences above can still be luck; patterns get trustworthy past a few hundred hands per strategy.</span>`);
    if (!out.length) out.push('Play a few more hands and patterns will show up here.');
    el('insights').innerHTML = out.map((t) => `<li>${t}</li>`).join('');
  }

  function renderStrategyTable(rs) {
    const rows = [...groupBy(rs, (r) => r.strategy).entries()].map(([name, list]) => [name, summarize(list)])
      .sort((a, b) => b[1].hands.length - a[1].hands.length);
    el('strategy-table').innerHTML = `<thead><tr><th>Strategy</th><th>Hands</th><th>Win rate</th><th>Net</th><th>Return</th><th>Avg bet</th><th>Accuracy</th></tr></thead><tbody>` +
      rows.map(([name, s]) => `<tr><td>${esc(name)}</td><td>${s.hands.length}</td><td>${pct(s.winRate)}</td><td class="${s.net < 0 ? 'neg' : ''}">${signed(s.net)}</td><td>${pctSigned(s.roi)}</td><td>${money(s.avgBet)}</td><td>${pct(s.accuracy)}</td></tr>`).join('') +
      '</tbody>';
  }

  function renderMistakes(s) {
    const groups = [...groupBy(s.decisions.filter((d) => d.action !== d.recommended), (d) => `${Strategy.situation(d)}|${d.action}|${d.recommended}`).entries()]
      .sort((a, b) => b[1].length - a[1].length).slice(0, 10);
    const table = el('mistake-table');
    if (!groups.length) {
      table.innerHTML = '<tbody><tr><td>No mistakes recorded. Every decision matched basic strategy.</td></tr></tbody>';
      return;
    }
    table.innerHTML = '<thead><tr><th>Situation</th><th>You chose</th><th>Basic strategy</th><th>Times</th><th>Net on those hands</th></tr></thead><tbody>' +
      groups.map(([key, ds]) => {
        const [situation, action, rec] = key.split('|');
        const handsNet = [...new Set(ds.map((d) => d.hand))].reduce((a, h) => a + h.net, 0);
        return `<tr><td>${esc(situation)}</td><td>${action}</td><td>${rec}</td><td>${ds.length}</td><td class="${handsNet < 0 ? 'neg' : ''}">${signed(handsNet)}</td></tr>`;
      }).join('') + '</tbody>';
  }

  function renderRecent(s) {
    const recent = s.hands.slice(-20).reverse();
    el('recent-table').innerHTML = '<thead><tr><th>When</th><th>Strategy</th><th>Your cards</th><th>Dealer</th><th>Moves</th><th>Result</th><th>Net</th></tr></thead><tbody>' +
      recent.map((h) => {
        const when = new Date(h.round.played_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        const moves = (h.decisions || []).map((d) => d.action === d.recommended ? d.action : `<span class="off" title="Basic strategy: ${d.recommended}">${d.action}✱</span>`).join(' → ') || '—';
        return `<tr><td>${when}</td><td>${esc(h.round.strategy)}</td><td>${cardText(h.final_cards)} <span class="muted">(${h.final_total})</span></td><td>${cardText(h.round.dealer_cards)} <span class="muted">(${h.round.dealer_total})</span></td><td>${moves}</td><td>${RESULT_LABEL[h.result] || h.result}</td><td class="${h.net < 0 ? 'neg' : ''}">${signed(h.net)}</td></tr>`;
      }).join('') + '</tbody>';
  }

  // ---------- Charts (inline SVG) ----------
  const tip = () => el('chart-tip');
  function showTip(evt, html) {
    const t = tip();
    t.innerHTML = html;
    t.classList.remove('hidden');
    const pad = 14;
    const w = t.offsetWidth; const h = t.offsetHeight;
    let x = evt.clientX + pad; let y = evt.clientY - h - pad;
    if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
    if (y < 8) y = evt.clientY + pad;
    t.style.left = x + 'px';
    t.style.top = y + 'px';
  }
  const hideTip = () => tip().classList.add('hidden');

  function svgEl(name, attrs = {}, parent) {
    const node = document.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  // Bar path with 4px rounded data end, square at the baseline
  function barPath(x, y0, w, y1) {
    const r = Math.min(4, w / 2, Math.abs(y1 - y0));
    if (y1 < y0) { // grows up
      return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
    }
    return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
  }

  function dataTable(box, headers, rows) {
    const d = document.createElement('details');
    d.className = 'chart-data';
    d.innerHTML = `<summary>Show data</summary><table class="data"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    box.appendChild(d);
  }

  function niceTicks(min, max, count = 4) {
    if (min === max) { min -= 1; max += 1; }
    const step0 = (max - min) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
    const start = Math.floor(min / step) * step;
    const ticks = [];
    for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v * 100) / 100);
    return ticks;
  }

  function renderBankChart(rs) {
    const box = el('chart-bank').querySelector('.chart-box');
    box.innerHTML = '';
    const W = 480; const H = 240; const m = { t: 12, r: 16, b: 28, l: 56 };
    const pts = rs.map((r, i) => ({ i, v: r.bank_after, r }));
    const values = [rs[0].bank_before, ...pts.map((p) => p.v)];
    const ticks = niceTicks(Math.min(...values), Math.max(...values));
    const yMin = ticks[0]; const yMax = ticks[ticks.length - 1];
    const x = (i) => m.l + (pts.length === 1 ? (W - m.l - m.r) / 2 : (i / (pts.length - 1)) * (W - m.l - m.r));
    const y = (v) => m.t + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - m.t - m.b);
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Line chart of bank after each round' }, box);
    for (const t of ticks) {
      svgEl('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: 'grid' }, svg);
      svgEl('text', { x: m.l - 8, y: y(t) + 4, class: 'axis', 'text-anchor': 'end' }, svg).textContent = money(t);
    }
    svgEl('text', { x: m.l, y: H - 8, class: 'axis' }, svg).textContent = 'Round 1';
    svgEl('text', { x: W - m.r, y: H - 8, class: 'axis', 'text-anchor': 'end' }, svg).textContent = `Round ${pts.length}`;
    svgEl('path', { d: pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i)},${y(p.v)}`).join(''), class: 'line' }, svg);
    const last = pts[pts.length - 1];
    svgEl('circle', { cx: x(last.i), cy: y(last.v), r: 4, class: 'dot' }, svg);
    const label = svgEl('text', { x: Math.min(x(last.i), W - m.r), y: y(last.v) - 10, class: 'direct', 'text-anchor': 'end' }, svg);
    label.textContent = money(last.v);

    // Crosshair + tooltip
    const cross = svgEl('line', { y1: m.t, y2: H - m.b, class: 'cross hidden' }, svg);
    const hot = svgEl('circle', { r: 5, class: 'dot hidden' }, svg);
    const hit = svgEl('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
    hit.addEventListener('mousemove', (evt) => {
      const rect = svg.getBoundingClientRect();
      const sx = ((evt.clientX - rect.left) / rect.width) * W;
      const i = Math.max(0, Math.min(pts.length - 1, Math.round(((sx - m.l) / (W - m.l - m.r)) * (pts.length - 1))));
      const p = pts[i];
      cross.setAttribute('x1', x(p.i)); cross.setAttribute('x2', x(p.i)); cross.classList.remove('hidden');
      hot.setAttribute('cx', x(p.i)); hot.setAttribute('cy', y(p.v)); hot.classList.remove('hidden');
      showTip(evt, `<strong>Round ${i + 1}</strong><br>Bank ${money(p.v)}<br>Net ${signed(p.r.net)} on ${money(p.r.total_bet)} bet<br><span class="muted">${esc(p.r.strategy)}</span>`);
    });
    hit.addEventListener('mouseleave', () => { cross.classList.add('hidden'); hot.classList.add('hidden'); hideTip(); });
    dataTable(box, ['Round', 'Strategy', 'Bet', 'Net', 'Bank after'], pts.slice(-50).map((p) => [p.i + 1, p.r.strategy, money(p.r.total_bet), signed(p.r.net), money(p.v)]));
  }

  // Vertical bars: items = [{ label, value, tip, n }], value in [0,1] or signed
  function verticalBars(box, items, { diverging = false, format, ariaLabel }) {
    box.innerHTML = '';
    const W = 480; const H = 240; const m = { t: 16, r: 12, b: 30, l: 48 };
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': ariaLabel }, box);
    const vals = items.filter((d) => d.n).map((d) => d.value);
    let ticks;
    if (diverging) {
      const ext = Math.max(1, ...vals.map(Math.abs));
      ticks = niceTicks(-ext, ext);
    } else {
      ticks = [0, 0.25, 0.5, 0.75, 1];
    }
    const yMin = ticks[0]; const yMax = ticks[ticks.length - 1];
    const y = (v) => m.t + (1 - (v - yMin) / (yMax - yMin)) * (H - m.t - m.b);
    for (const t of ticks) {
      svgEl('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: t === 0 && diverging ? 'baseline' : 'grid' }, svg);
      svgEl('text', { x: m.l - 8, y: y(t) + 4, class: 'axis', 'text-anchor': 'end' }, svg).textContent = format(t);
    }
    const band = (W - m.l - m.r) / items.length;
    const bw = Math.min(24, band * 0.6);
    const base = diverging ? y(0) : y(0);
    items.forEach((d, k) => {
      const cx = m.l + band * k + band / 2;
      svgEl('text', { x: cx, y: H - 10, class: 'axis', 'text-anchor': 'middle' }, svg).textContent = d.label;
      if (d.n) {
        const y1 = y(d.value);
        if (Math.abs(y1 - base) > 0.5) {
          svgEl('path', { d: barPath(cx - bw / 2, base, bw, y1), class: d.value < 0 ? 'bar neg' : 'bar' }, svg);
        } else {
          svgEl('line', { x1: cx - bw / 2, x2: cx + bw / 2, y1: base, y2: base, class: 'bar-zero' }, svg);
        }
      }
      const hit = svgEl('rect', { x: m.l + band * k, y: m.t, width: band, height: H - m.t - m.b, fill: 'transparent' }, svg);
      hit.addEventListener('mousemove', (evt) => showTip(evt, d.tip));
      hit.addEventListener('mouseleave', hideTip);
    });
  }

  function renderUpcardChart(s) {
    const box = el('chart-upcard').querySelector('.chart-box');
    const byUp = groupBy(s.hands, (h) => h.round.dealer_upcard);
    const items = UPCARDS.map((u) => {
      const hs = byUp.get(u) || [];
      const won = hs.filter((h) => WON.includes(h.result)).length;
      return { label: u, value: hs.length ? won / hs.length : 0, n: hs.length,
        tip: hs.length ? `<strong>Dealer shows ${u}</strong><br>Won ${won} of ${hs.length} hands (${pct(won / hs.length)})` : `<strong>Dealer shows ${u}</strong><br>No hands yet` };
    });
    verticalBars(box, items, { format: (t) => Math.round(t * 100) + '%', ariaLabel: 'Bar chart of win rate by dealer up card' });
    dataTable(box, ['Dealer up card', 'Hands', 'Win rate'], items.map((d) => [d.label, d.n, d.n ? pct(d.value) : '–']));
  }

  function renderCountChart(rs) {
    const box = el('chart-count').querySelector('.chart-box');
    const byBucket = groupBy(rs, (r) => countBucket(r.true_count));
    const items = COUNT_BUCKETS.map((b) => {
      const list = byBucket.get(b) || [];
      const avg = list.length ? list.reduce((a, r) => a + r.net, 0) / list.length : 0;
      const avgBet = list.length ? list.reduce((a, r) => a + r.total_bet, 0) / list.length : 0;
      return { label: b, value: avg, n: list.length,
        tip: list.length ? `<strong>True count ${b}</strong><br>${list.length} rounds<br>Avg net ${signed(avg)} · avg bet ${money(avgBet)}` : `<strong>True count ${b}</strong><br>No rounds yet` };
    });
    verticalBars(box, items, { diverging: true, format: (t) => signed(t), ariaLabel: 'Bar chart of average net per round by true count' });
    dataTable(box, ['True count', 'Rounds', 'Avg net per round'], items.map((d) => [d.label, d.n, d.n ? signed(d.value) : '–']));
  }

  function renderStartChart(s) {
    const box = el('chart-start').querySelector('.chart-box');
    box.innerHTML = '';
    const byStart = groupBy(s.hands, startGroup);
    const items = START_ORDER.map((g) => {
      const hs = byStart.get(g) || [];
      return { label: g, n: hs.length, value: hs.length ? handWinRate(hs) : 0, net: hs.reduce((a, h) => a + h.net, 0) };
    });
    const W = 480; const rowH = 22; const m = { t: 8, r: 52, b: 24, l: 96 };
    const H = m.t + m.b + rowH * items.length;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Bar chart of win rate by starting hand' }, box);
    const x = (v) => m.l + v * (W - m.l - m.r);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      svgEl('line', { x1: x(t), x2: x(t), y1: m.t, y2: H - m.b, class: 'grid' }, svg);
      svgEl('text', { x: x(t), y: H - 6, class: 'axis', 'text-anchor': 'middle' }, svg).textContent = Math.round(t * 100) + '%';
    }
    items.forEach((d, k) => {
      const cy = m.t + rowH * k + rowH / 2;
      svgEl('text', { x: m.l - 8, y: cy + 4, class: 'axis', 'text-anchor': 'end' }, svg).textContent = d.label;
      if (d.n && d.value > 0) {
        const bh = 12; const w = x(d.value) - m.l; const r = Math.min(4, w / 2);
        svgEl('path', { d: `M${m.l},${cy - bh / 2}H${m.l + w - r}Q${m.l + w},${cy - bh / 2} ${m.l + w},${cy - bh / 2 + r}V${cy + bh / 2 - r}Q${m.l + w},${cy + bh / 2} ${m.l + w - r},${cy + bh / 2}H${m.l}Z`, class: 'bar' }, svg);
      }
      if (d.n) svgEl('text', { x: x(d.value) + 6, y: cy + 4, class: 'axis' }, svg).textContent = `${pct(d.value)} · ${d.n}`;
      const hit = svgEl('rect', { x: 0, y: cy - rowH / 2, width: W, height: rowH, fill: 'transparent' }, svg);
      hit.addEventListener('mousemove', (evt) => showTip(evt, d.n ? `<strong>${d.label}</strong><br>Won ${pct(d.value)} of ${d.n} hands<br>Net ${signed(d.net)}` : `<strong>${d.label}</strong><br>No hands yet`));
      hit.addEventListener('mouseleave', hideTip);
    });
    dataTable(box, ['Starting hand', 'Hands', 'Win rate', 'Net'], items.map((d) => [d.label, d.n, d.n ? pct(d.value) : '–', d.n ? signed(d.net) : '–']));
  }

  // ---------- Export ----------
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function exportCsv() {
    if (!rounds) return;
    const cols = ['played_at', 'round_id', 'strategy', 'hand_index', 'from_split', 'start_cards', 'start_total', 'start_soft', 'start_pair',
      'final_cards', 'final_total', 'dealer_upcard', 'dealer_cards', 'dealer_total', 'dealer_blackjack', 'dealer_bust', 'bet', 'doubled',
      'actions', 'result', 'net', 'decision_count', 'mistakes', 'followed_strategy', 'running_count', 'true_count', 'cards_remaining',
      'bank_before', 'bank_after', 'decisions_json'];
    const cell = (v) => {
      const s = Array.isArray(v) ? v.join(' ') : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(',')];
    for (const r of filtered()) {
      for (const h of r.hands) {
        const row = { ...h, played_at: r.played_at, round_id: r.id, strategy: r.strategy, dealer_upcard: r.dealer_upcard, dealer_cards: r.dealer_cards,
          dealer_total: r.dealer_total, dealer_blackjack: r.dealer_blackjack, dealer_bust: r.dealer_bust, running_count: r.running_count,
          true_count: r.true_count, cards_remaining: r.cards_remaining, bank_before: r.bank_before, bank_after: r.bank_after, decisions_json: h.decisions };
        lines.push(cols.map((c) => cell(row[c])).join(','));
      }
    }
    download(`blackjack-hands-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'), 'text/csv');
  }

  function exportJson() {
    if (!rounds) return;
    download(`blackjack-rounds-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(filtered(), null, 2), 'application/json');
  }

  el('f-strategy').addEventListener('change', render);
  el('f-time').addEventListener('change', render);
  el('export-csv').addEventListener('click', exportCsv);
  el('export-json').addEventListener('click', exportJson);

  window.StatsPage = {
    open() { if ((stale || !rounds) && !loading) load(); else render(); },
    markStale() { stale = true; if (!el('stats-view').classList.contains('hidden')) load(); },
    reset() { rounds = null; stale = true; },
  };
})();

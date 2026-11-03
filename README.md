# Blackjack

A browser Blackjack game built with plain HTML, CSS, and JavaScript. Cards are shuffled and dealt by the free [Deck of Cards API](https://deckofcardsapi.com/).

## Features

- 6-deck shoe, reshuffled automatically when it runs low
- Chip betting with a $1,000 bank that's saved in your browser
- Hit, stand, double down, and split (one split; split aces get one card each)
- Dealer stands on all 17s; blackjack pays 3:2
- Accounts with Supabase: email + password, Continue with Google, forgot password, log out
- Profile tab: display name, unique username, hometown, bio; new players are asked to create a profile on first login
- Stats saved per player: bank, hands played, wins/losses/pushes, blackjacks, biggest win
- Every round and hand is saved (cards, each decision, what basic strategy recommended, Hi-Lo count, strategy label)
- Stats tab: KPIs, automatic insights, strategy comparison, charts, most common mistakes, recent hands, CSV/JSON export
- Table options: label the strategy you're testing, show basic strategy hints, show the running/true count

## How it uses the API

| Action | Endpoint |
| --- | --- |
| New shuffled shoe | `GET /api/deck/new/shuffle/?deck_count=6` |
| Deal / hit | `GET /api/deck/<deck_id>/draw/?count=N` |
| Reshuffle | `GET /api/deck/<deck_id>/shuffle/` |

Card images come from the API response; the face-down card uses `https://deckofcardsapi.com/static/img/back.png`.

## Accounts (Supabase)

`auth.js` connects to the Supabase project `my-app` using its **publishable** key, which is safe in the browser. Data lives in a `profiles` table (one row per user, created automatically on sign-up by a database trigger). Finished rounds are saved with the `save_round` database function, which writes the round, its hands, and the profile totals in one step.

| Table | One row per | Key columns |
| --- | --- | --- |
| `profiles` | player | username, hometown, bio, bank, lifetime totals |
| `rounds` | round dealt | strategy, dealer cards/total, bet, net, bank before/after, running and true count |
| `hands` | player hand (2 for a split) | start and final cards/totals, actions, decisions (JSON), mistakes, result, net |

Basic strategy (`strategy.js`) matches these rules: 6 decks, dealer stands on all 17s, double after split, no surrender. Row level security lets each user read and update only their own row.

Dashboard settings to set in Supabase (Authentication):

- **Sign In / Providers → Email:** turn off *Confirm email* while testing (the built-in sender only sends ~2 emails/hour).
- **URL Configuration:** set *Site URL* to your Netlify address and add `http://localhost:8000` under *Redirect URLs*.
- **Sign In / Providers → Google:** paste the Client ID and secret from Google Cloud to enable *Continue with Google*.

## Run locally

No build step. Serve the folder with any static server, for example:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy to Netlify

The repo includes `netlify.toml` (publish directory is the repo root, no build command). In Netlify, choose **Add new site → Import an existing project**, pick this repo and the `main` branch, and deploy. You can also drag the folder into Netlify's manual deploy page.

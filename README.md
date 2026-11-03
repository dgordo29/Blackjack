# Blackjack

A browser Blackjack game built with plain HTML, CSS, and JavaScript. Cards are shuffled and dealt by the free [Deck of Cards API](https://deckofcardsapi.com/).

## Features

- 6-deck shoe, reshuffled automatically when it runs low
- Chip betting with a $1,000 bank that's saved in your browser
- Hit, stand, double down, and split (one split; split aces get one card each)
- Dealer stands on all 17s; blackjack pays 3:2

## How it uses the API

| Action | Endpoint |
| --- | --- |
| New shuffled shoe | `GET /api/deck/new/shuffle/?deck_count=6` |
| Deal / hit | `GET /api/deck/<deck_id>/draw/?count=N` |
| Reshuffle | `GET /api/deck/<deck_id>/shuffle/` |

Card images come from the API response; the face-down card uses `https://deckofcardsapi.com/static/img/back.png`.

## Run locally

No build step. Serve the folder with any static server, for example:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy to Netlify

The repo includes `netlify.toml` (publish directory is the repo root, no build command). In Netlify, choose **Add new site → Import an existing project**, pick this repo and the `main` branch, and deploy. You can also drag the folder into Netlify's manual deploy page.

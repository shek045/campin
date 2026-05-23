# Campin

Campin is a web app for campsite discovery that combines:

- Live campground data from Recreation.gov (RIDB + availability)
- Campground discovery from NPS
- Intent parsing with Microsoft Foundry (Azure OpenAI)
- A chat-style campsite search experience with live ranking and fallback controls

## Features

- Chat-style natural-language campsite search
- Live availability badges when inventory is available
- LLM-based intent parsing with deterministic fallback
- Strict intent matching with closest-match top-up to maintain a minimum result set
- Detail-page campground photo hydration when provider media is sparse
- Explicit demo mode for offline demos and fallback testing
- Local API proxy to avoid browser CORS issues

## Dependencies

This project intentionally keeps npm dependencies minimal.

### npm package dependencies

- None. `package.json` does not declare any `dependencies` or `devDependencies`.

### Runtime dependencies

- Node.js 18+ (uses the built-in `fetch` API and Node core modules)
- Node core modules used by the server:
  - `http`
  - `fs`
  - `path`

### External services and APIs

- Recreation.gov RIDB API (`https://ridb.recreation.gov/api/v1/facilities`)
- Recreation.gov Availability API (`https://www.recreation.gov/api/camps/availability/...`)
- National Park Service API (`https://developer.nps.gov/api/v1/campgrounds`)
- Azure OpenAI / Microsoft Foundry Chat Completions API (intent parsing)
- Wikimedia Commons API (fallback campground photos)

### Design dependency

- Google Fonts stylesheet in `index.html`
  - `Playfair Display`
  - `DM Sans`

## Demo Screenshot

![Campin demo screenshot](assets/demo-screenshot.svg)

Home and results views with live API-powered recommendations, chat-based search, and intent-aware ranking.

## Project Structure

- index.html: App shell and views
- assets/css/styles.css: UI styles and tokens
- assets/js/app.js: Chat UI, search, rendering, ranking, and detail photo hydration
- server.js: Static hosting + API proxy + intent/config/media endpoints
- .env.example: Environment template (no secrets)

## Prerequisites

- Node.js 18+ (or newer)

## Quick Start

- Clone and open this project.
- Create a local environment file from the template.

macOS/Linux:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

- Fill in `.env` values.
- Start the app:

```bash
npm start
```

- Open <http://localhost:5500>.

## Environment Variables

Required for live APIs:

- REC_API_KEY: Recreation.gov RIDB key
- NPS_API_KEY: National Park Service API key
- GOOGLE_PLACES_API_KEY: Google Places API key (used for live campground reviews)

Required for Foundry intent parsing:

- FOUNDRY_ENDPOINT: Azure OpenAI resource base URL (example: `https://your-resource.openai.azure.com`)
- FOUNDRY_API_KEY: Azure OpenAI key
- FOUNDRY_MODEL_DEPLOYMENT: deployed chat model name

Optional:

- FOUNDRY_API_VERSION: defaults to `2024-10-21`
- DEMO_MODE: set to `true` to allow mock data fallback for demos and offline development
- PORT: defaults to `5500`

## How Search Works

1. Frontend sends query + lightweight UI context to `POST /api/intent/parse`.
2. Server calls Foundry for intent extraction.
3. App fetches and merges live records from these endpoints:

- `GET /api/ridb/facilities`
- `GET /api/nps/campgrounds`
- `GET /api/recreation/availability/:campgroundId/month`
- `GET /api/media/photos` for detail-page photo fallback when needed
- `GET /api/config` for runtime flags such as demo mode

1. Results are scored by intent relevance, strict matches are preferred, and the list is topped up with closest matches until the UI has enough results.
2. Campground detail pages reuse provider media first and hydrate empty photo slots with fallback images only when needed.

## Fallback Behavior

- If Foundry is unavailable, intent parser falls back safely.
- If a provider is unavailable, app still renders partial results.
- If strict intent filtering returns too few matches, results are topped up with the closest intent matches.
- If live APIs return no matches, app only falls back to mock cards when `DEMO_MODE=true`.
- If provider photos are missing on the detail page, Campin fetches fallback imagery for empty slots.

## Demo Mode

- Set `DEMO_MODE=true` in `.env` to allow mock inventory fallback for demos or offline development.
- With `DEMO_MODE=false`, Campin shows only live results and explicit empty/error states.

## Security Notes

- Never commit `.env`.
- Rotate any key that has been exposed.
- Keep all provider keys server-side only.

## Verification

After startup, test parser endpoint:

```bash
curl -X POST http://localhost:5500/api/intent/parse \
  -H "Content-Type: application/json" \
  -d '{"query":"quiet lakeside campsite near Seattle","context":{"dateSelection":"June 6-8","guestSelection":"2 guests","activePills":["dog-friendly"]}}'
```

Expected: JSON response with `intent.enabled` and `intent.source` fields.

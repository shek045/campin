# Campin Architecture

This diagram shows the high-level architecture for the Campin application: the browser app, the local Node proxy server (with its helper modules), and the external data providers.

```mermaid
flowchart LR
  U[User Browser]

  subgraph FE[Frontend - Vanilla ES Modules]
    H[index.html]
    A[assets/js/app.js]
    RV[views/resultsView.js]
    SVC[services/apiClient.js / savedListings.js]
    DOM[domain/trip.js, search.js, listings.js, booking.js]
    CSS[assets/css/styles.css]
  end

  subgraph BE[Backend - Node HTTP Server]
    S[server.js]
    LH[lib/http.js - static allowlist, body limits, rate limit, param validation]
    LP[lib/providers.js - timeout, cache, coalescing, concurrency]
    CFG[GET /api/config]
    INT[POST /api/intent/parse]
    JR[POST /api/judge/results]
    RIDB[GET ridb facilities and campsites]
    NPS[GET /api/nps/campgrounds]
    AV[GET recreation availability month]
    PH[GET /api/media/photos]
    GR[GET /api/google/reviews]
    GEO[GET location search and reverse geocode]
  end

  subgraph EXT[External Services]
    RG[Recreation.gov RIDB + Availability]
    NP[NPS API]
    AZ[Azure OpenAI via Foundry]
    WM[Wikimedia Commons]
    GP[Google Places + Geocoding]
  end

  U --> H
  H --> A
  A --> RV
  A --> SVC
  A --> DOM
  RV --> DOM
  H --> CSS

  SVC --> CFG
  SVC --> INT
  SVC --> JR
  SVC --> RIDB
  SVC --> NPS
  SVC --> AV
  SVC --> PH
  SVC --> GR
  SVC --> GEO

  S --> LH
  S --> LP
  S --> CFG
  S --> INT
  S --> JR
  S --> RIDB
  S --> NPS
  S --> AV
  S --> PH
  S --> GR
  S --> GEO

  S -.serves static assets.-> H

  LH --> S
  LP --> S

  RIDB --> RG
  AV --> RG
  NPS --> NP
  INT --> AZ
  JR --> AZ
  PH --> WM
  GR --> GP
  GEO --> GP
```

Notes:

- The browser only talks to same-origin `/api` routes; provider keys stay in the server process.
- `lib/providers.js` wraps every upstream fetch with a timeout, in-memory TTL cache, request coalescing, and a concurrency cap, so provider outages degrade instead of cascading.
- `lib/http.js` rejects non-allowlisted static paths, caps JSON bodies, rate limits clients, and validates query parameters before any provider work happens.
- Availability is requested per month of the requested stay and intersected per campsite across all nights; the resulting state (`not_checked`, `checking`, `unknown`, `available`, `unavailable`) is computed in `assets/js/domain/trip.js`.

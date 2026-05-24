const http = require('http');
const fs = require('fs');
const path = require('path');

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const sep = trimmed.indexOf('=');
    if (sep <= 0) {
      return;
    }

    const key = trimmed.slice(0, sep).trim();
    const value = trimmed.slice(sep + 1).trim().replace(/^['\"]|['\"]$/g, '');
    if (!key) {
      return;
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

loadDotEnv(path.join(process.cwd(), '.env'));

const PORT = Number(process.env.PORT || 5500);
const ROOT = process.cwd();

const REC_API_KEY = process.env.REC_API_KEY || '';
const NPS_API_KEY = process.env.NPS_API_KEY || '';
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';
const FOUNDRY_ENDPOINT = (process.env.FOUNDRY_ENDPOINT || '').trim().replace(/\/$/, '');
const FOUNDRY_API_KEY = process.env.FOUNDRY_API_KEY || '';
const FOUNDRY_MODEL_DEPLOYMENT = process.env.FOUNDRY_MODEL_DEPLOYMENT || '';
const FOUNDRY_API_VERSION = process.env.FOUNDRY_API_VERSION || '2024-10-21';
const DEMO_MODE = /^(1|true|yes|on)$/i.test(String(process.env.DEMO_MODE || '').trim());
const GOOGLE_REVIEWS_CACHE_TTL_MS = 30 * 60 * 1000;
const googleReviewsCache = new Map();
const googleReviewsInFlight = new Map();
const GOOGLE_REVIEWS_UPSTREAM_TIMEOUT_MS = 4500;
const GEO_LOCATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const geoLocationCache = new Map();
const GOOGLE_REVIEWS_CACHE_MAX_ENTRIES = 500;
const GEO_LOCATION_CACHE_MAX_ENTRIES = 1000;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data:; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function pruneExpiringCache(cache, maxEntries) {
  const now = Date.now();

  for (const [key, value] of cache.entries()) {
    if (!value || !Number.isFinite(Number(value.expiresAt)) || value.expiresAt <= now) {
      cache.delete(key);
    }
  }

  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    cache.delete(oldestKey);
  }
}

async function fetchJsonWithTimeout(url, timeoutMs = GOOGLE_REVIEWS_UPSTREAM_TIMEOUT_MS) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timeoutId = null;

  if (controller && Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0) {
    timeoutId = setTimeout(() => controller.abort(), Number(timeoutMs));
  }

  try {
    const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function makeFallbackIntent(queryText = '') {
  return {
    enabled: false,
    source: 'fallback',
    queryRewrite: String(queryText || '').trim(),
    location: '',
    partySize: null,
    constraints: {
      dogFriendly: null,
      rv: null,
      tent: null,
      waterfront: null,
      maxPrice: null
    },
    priorities: [],
    clarificationQuestions: [],
    confidence: 0
  };
}

function buildFoundryChatEndpoint() {
  if (!FOUNDRY_ENDPOINT || !FOUNDRY_API_KEY || !FOUNDRY_MODEL_DEPLOYMENT) {
    return '';
  }

  return `${FOUNDRY_ENDPOINT}/openai/deployments/${encodeURIComponent(FOUNDRY_MODEL_DEPLOYMENT)}/chat/completions?api-version=${encodeURIComponent(FOUNDRY_API_VERSION)}`;
}

function buildClarificationQuestions(intent) {
  const questions = [];

  if (!String(intent?.location || '').trim()) {
    questions.push('What location, park, or region should I search around?');
  }

  if (!Number.isFinite(Number(intent?.partySize))) {
    questions.push('How many campers are in your group?');
  }

  if (!Array.isArray(intent?.priorities) || intent.priorities.length === 0) {
    questions.push('What matters most for this trip: hookups, waterfront, dog-friendly, quiet, budget, or something else?');
  }

  return questions.slice(0, 3);
}

function normalizeIntentResponse(parsed, originalQuery) {
  if (!parsed || typeof parsed !== 'object') {
    return makeFallbackIntent(originalQuery);
  }

  const constraints = parsed.constraints && typeof parsed.constraints === 'object' ? parsed.constraints : {};
  const partySize = Number(parsed.partySize);
  const maxPrice = Number(constraints.maxPrice);

  const normalized = {
    enabled: true,
    source: 'foundry',
    queryRewrite: String(parsed.queryRewrite || parsed.searchQuery || originalQuery || '').trim(),
    location: String(parsed.location || '').trim(),
    partySize: Number.isFinite(partySize) && partySize > 0 ? partySize : null,
    constraints: {
      dogFriendly: typeof constraints.dogFriendly === 'boolean' ? constraints.dogFriendly : null,
      rv: typeof constraints.rv === 'boolean' ? constraints.rv : null,
      tent: typeof constraints.tent === 'boolean' ? constraints.tent : null,
      waterfront: typeof constraints.waterfront === 'boolean' ? constraints.waterfront : null,
      maxPrice: Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : null
    },
    priorities: Array.isArray(parsed.priorities)
      ? parsed.priorities.map(x => String(x).trim()).filter(Boolean).slice(0, 6)
      : [],
    clarificationQuestions: Array.isArray(parsed.clarificationQuestions)
      ? parsed.clarificationQuestions.map(x => String(x).trim()).filter(Boolean).slice(0, 3)
      : [],
    confidence: Number.isFinite(Number(parsed.confidence))
      ? Math.max(0, Math.min(1, Number(parsed.confidence)))
      : 0.5
  };

  if (normalized.clarificationQuestions.length === 0) {
    normalized.clarificationQuestions = buildClarificationQuestions(normalized);
  }

  return normalized;
}

function parseJsonObject(rawContent) {
  if (!rawContent || typeof rawContent !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(rawContent);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch (err) {
    return null;
  }
}

function validateIntentCandidate(candidate) {
  const issues = [];

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { valid: false, issues: ['Intent payload must be a JSON object.'] };
  }

  if (typeof candidate.queryRewrite !== 'string') {
    issues.push('queryRewrite must be a string.');
  }

  if (typeof candidate.location !== 'string') {
    issues.push('location must be a string.');
  }

  const partySize = candidate.partySize;
  if (partySize !== null && !(Number.isInteger(Number(partySize)) && Number(partySize) > 0 && Number(partySize) <= 30)) {
    issues.push('partySize must be null or an integer between 1 and 30.');
  }

  const constraints = candidate.constraints;
  if (!constraints || typeof constraints !== 'object' || Array.isArray(constraints)) {
    issues.push('constraints must be an object.');
  } else {
    ['dogFriendly', 'rv', 'tent', 'waterfront'].forEach(key => {
      const value = constraints[key];
      if (value !== null && typeof value !== 'boolean') {
        issues.push(`constraints.${key} must be boolean or null.`);
      }
    });

    const maxPrice = constraints.maxPrice;
    if (maxPrice !== null && !(Number.isFinite(Number(maxPrice)) && Number(maxPrice) > 0)) {
      issues.push('constraints.maxPrice must be a positive number or null.');
    }
  }

  if (!Array.isArray(candidate.priorities)) {
    issues.push('priorities must be an array.');
  } else {
    if (candidate.priorities.length > 6) {
      issues.push('priorities cannot contain more than 6 items.');
    }
    if (candidate.priorities.some(item => typeof item !== 'string')) {
      issues.push('priorities must contain only strings.');
    }
  }

  if (!Array.isArray(candidate.clarificationQuestions)) {
    issues.push('clarificationQuestions must be an array.');
  } else {
    if (candidate.clarificationQuestions.length > 3) {
      issues.push('clarificationQuestions cannot contain more than 3 items.');
    }
    if (candidate.clarificationQuestions.some(item => typeof item !== 'string')) {
      issues.push('clarificationQuestions must contain only strings.');
    }
  }

  const confidence = candidate.confidence;
  if (!(Number.isFinite(Number(confidence)) && Number(confidence) >= 0 && Number(confidence) <= 1)) {
    issues.push('confidence must be a number between 0 and 1.');
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

async function callFoundryJsonObject(endpoint, requestBody, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': FOUNDRY_API_KEY
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const rawContent = payload?.choices?.[0]?.message?.content;
    return typeof rawContent === 'string' ? rawContent : null;
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';

    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Request body too large.'));
      }
    });

    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('Invalid JSON body.'));
      }
    });

    req.on('error', reject);
  });
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': type
    });
    res.end(data);
  });
}

function safeResolvePath(urlPathname) {
  const decodedPath = decodeURIComponent(urlPathname);
  const normalized = path.normalize(decodedPath).replace(/^[/\\]+/, '');
  const resolved = path.resolve(ROOT, normalized);

  const relative = path.relative(ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}

async function proxyRidbFacilities(reqUrl, res) {
  if (!REC_API_KEY) {
    sendJson(res, 503, { error: 'REC_API_KEY is missing on server.' });
    return;
  }

  const query = reqUrl.searchParams.get('query') || '';
  const limit = reqUrl.searchParams.get('limit') || '12';

  const upstream = new URL('https://ridb.recreation.gov/api/v1/facilities');
  upstream.searchParams.set('query', query);
  upstream.searchParams.set('limit', limit);

  try {
    const response = await fetch(upstream, {
      headers: {
        apikey: REC_API_KEY,
        Accept: 'application/json'
      }
    });

    const text = await response.text();
    res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(text);
  } catch (error) {
    sendJson(res, 502, { error: 'Failed to fetch RIDB facilities.', details: String(error) });
  }
}

async function proxyRidbCampsites(reqUrl, res, facilityId) {
  if (!REC_API_KEY) {
    sendJson(res, 503, { error: 'REC_API_KEY is missing on server.' });
    return;
  }

  const limit = reqUrl.searchParams.get('limit') || '200';
  const offset = reqUrl.searchParams.get('offset') || '0';

  const upstream = new URL(`https://ridb.recreation.gov/api/v1/facilities/${encodeURIComponent(String(facilityId))}/campsites`);
  upstream.searchParams.set('limit', limit);
  upstream.searchParams.set('offset', offset);

  try {
    const response = await fetch(upstream, {
      headers: {
        apikey: REC_API_KEY,
        Accept: 'application/json'
      }
    });

    const text = await response.text();
    res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(text);
  } catch (error) {
    sendJson(res, 502, { error: 'Failed to fetch RIDB campsites.', details: String(error) });
  }
}

async function proxyNpsCampgrounds(reqUrl, res) {
  if (!NPS_API_KEY) {
    sendJson(res, 503, { error: 'NPS_API_KEY is missing on server.' });
    return;
  }

  const query = reqUrl.searchParams.get('q') || '';
  const limit = reqUrl.searchParams.get('limit') || '12';

  const upstream = new URL('https://developer.nps.gov/api/v1/campgrounds');
  upstream.searchParams.set('q', query);
  upstream.searchParams.set('limit', limit);
  upstream.searchParams.set('api_key', NPS_API_KEY);

  try {
    const response = await fetch(upstream);
    const text = await response.text();
    res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(text);
  } catch (error) {
    sendJson(res, 502, { error: 'Failed to fetch NPS campgrounds.', details: String(error) });
  }
}

async function proxyRecreationAvailability(reqUrl, res, campgroundId) {
  const startDate = reqUrl.searchParams.get('start_date') || new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();

  const upstream = new URL(`https://www.recreation.gov/api/camps/availability/campground/${campgroundId}/month`);
  upstream.searchParams.set('start_date', startDate);

  try {
    const response = await fetch(upstream);
    const text = await response.text();
    res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(text);
  } catch (error) {
    sendJson(res, 502, { error: 'Failed to fetch Recreation availability.', details: String(error) });
  }
}

async function proxyCampgroundPhotos(reqUrl, res) {
  const query = String(reqUrl.searchParams.get('query') || '').trim();

  if (!query) {
    sendJson(res, 400, { error: 'query is required.' });
    return;
  }

  const upstream = new URL('https://commons.wikimedia.org/w/api.php');
  upstream.searchParams.set('action', 'query');
  upstream.searchParams.set('format', 'json');
  upstream.searchParams.set('generator', 'search');
  upstream.searchParams.set('gsrnamespace', '6');
  upstream.searchParams.set('gsrsearch', query);
  upstream.searchParams.set('gsrlimit', '8');
  upstream.searchParams.set('prop', 'imageinfo');
  upstream.searchParams.set('iiprop', 'url');
  upstream.searchParams.set('iiurlwidth', '1600');
  upstream.searchParams.set('origin', '*');

  try {
    const response = await fetch(upstream);
    if (!response.ok) {
      sendJson(res, response.status, { error: 'Failed to fetch fallback campground photos.' });
      return;
    }

    const payload = await response.json();
    const pages = payload?.query?.pages ? Object.values(payload.query.pages) : [];
    const photos = [...new Set(
      pages
        .map(page => page?.imageinfo?.[0]?.thumburl || page?.imageinfo?.[0]?.url || '')
        .filter(Boolean)
    )].slice(0, 5);

    sendJson(res, 200, { photos });
  } catch (error) {
    sendJson(res, 502, { error: 'Failed to fetch fallback campground photos.', details: String(error) });
  }
}

async function proxyGoogleReviews(reqUrl, res) {
  if (!GOOGLE_PLACES_API_KEY) {
    sendJson(res, 503, {
      enabled: false,
      source: 'fallback',
      reviews: [],
      error: 'GOOGLE_PLACES_API_KEY is missing on server.'
    });
    return;
  }

  const query = String(reqUrl.searchParams.get('query') || '').trim();
  if (!query) {
    sendJson(res, 400, { error: 'query is required.' });
    return;
  }

  pruneExpiringCache(googleReviewsCache, GOOGLE_REVIEWS_CACHE_MAX_ENTRIES);
  const cacheKey = query.toLowerCase();
  const now = Date.now();
  const cached = googleReviewsCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    sendJson(res, 200, cached.payload);
    return;
  }

  const inFlight = googleReviewsInFlight.get(cacheKey);
  if (inFlight) {
    try {
      const payload = await inFlight;
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, 200, {
        enabled: false,
        source: 'fallback',
        reviews: [],
        error: 'Google reviews request failed.'
      });
    }
    return;
  }

  const findPlaceUrl = new URL('https://maps.googleapis.com/maps/api/place/findplacefromtext/json');
  findPlaceUrl.searchParams.set('input', query);
  findPlaceUrl.searchParams.set('inputtype', 'textquery');
  findPlaceUrl.searchParams.set('fields', 'place_id,name,rating,user_ratings_total');
  findPlaceUrl.searchParams.set('key', GOOGLE_PLACES_API_KEY);

  const requestPromise = (async () => {
    const { response: placeResp, payload: placePayload } = await fetchJsonWithTimeout(findPlaceUrl);
    if (!placeResp.ok) {
      return {
        enabled: false,
        source: 'fallback',
        reviews: [],
        error: 'Failed to search Google Places candidates.'
      };
    }

    const placeStatus = String(placePayload?.status || '').trim().toUpperCase();
    const placeError = String(placePayload?.error_message || '').trim();

    if (placeStatus && placeStatus !== 'OK' && placeStatus !== 'ZERO_RESULTS') {
      return {
        enabled: false,
        source: 'google',
        reviews: [],
        error: placeError || `Google Places findplace failed with status ${placeStatus}.`
      };
    }

    const candidate = Array.isArray(placePayload?.candidates) ? placePayload.candidates[0] : null;
    const placeId = String(candidate?.place_id || '').trim();

    if (!placeId) {
      return {
        enabled: false,
        source: 'google',
        reviews: [],
        placeName: candidate?.name || '',
        rating: Number.isFinite(Number(candidate?.rating)) ? Number(candidate.rating) : null,
        userRatingsTotal: Number.isFinite(Number(candidate?.user_ratings_total)) ? Number(candidate.user_ratings_total) : null
      };
    }

    const detailsUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    detailsUrl.searchParams.set('place_id', placeId);
    detailsUrl.searchParams.set('fields', 'name,rating,user_ratings_total,reviews,url');
    detailsUrl.searchParams.set('reviews_sort', 'newest');
    detailsUrl.searchParams.set('key', GOOGLE_PLACES_API_KEY);

    const { response: detailsResp, payload: detailsPayload } = await fetchJsonWithTimeout(detailsUrl);
    if (!detailsResp.ok) {
      return {
        enabled: false,
        source: 'fallback',
        reviews: [],
        error: 'Failed to fetch Google Place details.'
      };
    }

    const detailsStatus = String(detailsPayload?.status || '').trim().toUpperCase();
    const detailsError = String(detailsPayload?.error_message || '').trim();

    if (detailsStatus && detailsStatus !== 'OK' && detailsStatus !== 'ZERO_RESULTS') {
      return {
        enabled: false,
        source: 'google',
        reviews: [],
        error: detailsError || `Google Places details failed with status ${detailsStatus}.`
      };
    }

    const result = detailsPayload?.result || {};
    const reviews = (Array.isArray(result?.reviews) ? result.reviews : [])
      .map(review => ({
        author: String(review?.author_name || 'Google user').trim(),
        text: String(review?.text || '').trim().slice(0, 1200),
        rating: Number.isFinite(Number(review?.rating)) ? Number(review.rating) : null,
        relativeTime: String(review?.relative_time_description || '').trim(),
        profilePhotoUrl: String(review?.profile_photo_url || '').trim()
      }))
      .filter(review => !!review.text)
      .slice(0, 5);

    return {
      enabled: reviews.length > 0,
      source: 'google',
      placeName: String(result?.name || candidate?.name || '').trim(),
      rating: Number.isFinite(Number(result?.rating))
        ? Number(result.rating)
        : (Number.isFinite(Number(candidate?.rating)) ? Number(candidate.rating) : null),
      userRatingsTotal: Number.isFinite(Number(result?.user_ratings_total))
        ? Number(result.user_ratings_total)
        : (Number.isFinite(Number(candidate?.user_ratings_total)) ? Number(candidate.user_ratings_total) : null),
      placeUrl: String(result?.url || '').trim(),
      reviews
    };
  })();

  googleReviewsInFlight.set(cacheKey, requestPromise);
  try {
    const payload = await requestPromise;
    googleReviewsCache.set(cacheKey, {
      expiresAt: now + GOOGLE_REVIEWS_CACHE_TTL_MS,
      payload
    });
    sendJson(res, 200, payload);
  } catch (error) {
    const isAbort = String(error?.name || '').toLowerCase() === 'aborterror';
    sendJson(res, 200, {
      enabled: false,
      source: 'fallback',
      reviews: [],
      error: isAbort
        ? 'Google reviews request timed out. Please try again.'
        : `Failed to fetch Google reviews: ${String(error)}`
    });
  } finally {
    googleReviewsInFlight.delete(cacheKey);
  }
}

function extractCityStateFromGeocodeResult(result = {}) {
  const components = Array.isArray(result.address_components) ? result.address_components : [];
  const findByType = type => components.find(component => Array.isArray(component.types) && component.types.includes(type)) || null;

  const cityComponent = findByType('locality')
    || findByType('postal_town')
    || findByType('administrative_area_level_3')
    || findByType('sublocality')
    || findByType('administrative_area_level_2');
  const stateComponent = findByType('administrative_area_level_1');

  const city = String(cityComponent?.long_name || '').trim();
  const state = String(stateComponent?.short_name || stateComponent?.long_name || '').trim();

  if (city && state) {
    return `${city}, ${state}`;
  }

  if (city) {
    return city;
  }

  if (state) {
    return state;
  }

  const formatted = String(result.formatted_address || '').trim();
  if (!formatted) {
    return '';
  }

  const parts = formatted.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]}, ${parts[parts.length - 2] || parts[parts.length - 1]}`;
  }

  return formatted;
}

async function proxyReverseGeocode(reqUrl, res) {
  if (!GOOGLE_PLACES_API_KEY) {
    sendJson(res, 503, {
      enabled: false,
      error: 'GOOGLE_PLACES_API_KEY is missing on server.'
    });
    return;
  }

  const lat = Number(reqUrl.searchParams.get('lat'));
  const lon = Number(reqUrl.searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    sendJson(res, 400, { error: 'lat and lon are required.' });
    return;
  }

  pruneExpiringCache(geoLocationCache, GEO_LOCATION_CACHE_MAX_ENTRIES);
  const cacheKey = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const now = Date.now();
  const cached = geoLocationCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    sendJson(res, 200, cached.payload);
    return;
  }

  const geocodeUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  geocodeUrl.searchParams.set('latlng', `${lat},${lon}`);
  geocodeUrl.searchParams.set('key', GOOGLE_PLACES_API_KEY);

  try {
    const response = await fetch(geocodeUrl);
    if (!response.ok) {
      sendJson(res, response.status, {
        enabled: false,
        error: 'Failed to reverse geocode location.'
      });
      return;
    }

    const payload = await response.json();
    const status = String(payload?.status || '').trim().toUpperCase();
    const errorMessage = String(payload?.error_message || '').trim();
    if (status && status !== 'OK' && status !== 'ZERO_RESULTS') {
      sendJson(res, 200, {
        enabled: false,
        error: errorMessage || `Google geocoding failed with status ${status}.`
      });
      return;
    }

    const results = Array.isArray(payload?.results) ? payload.results : [];
    const locationCandidates = results
      .map(result => extractCityStateFromGeocodeResult(result))
      .filter(Boolean);
    const locationLabel = locationCandidates.find(label => /,/.test(label)) || locationCandidates[0] || '';
    const result = results[0] || null;
    const responsePayload = {
      enabled: Boolean(locationLabel),
      locationLabel,
      formattedAddress: String(result?.formatted_address || '').trim(),
      source: 'google'
    };

    geoLocationCache.set(cacheKey, {
      expiresAt: now + GEO_LOCATION_CACHE_TTL_MS,
      payload: responsePayload
    });

    sendJson(res, 200, responsePayload);
  } catch (error) {
    sendJson(res, 502, {
      enabled: false,
      error: `Failed to reverse geocode location: ${String(error)}`
    });
  }
}

async function parseIntentWithFoundry(queryText, context) {
  const endpoint = buildFoundryChatEndpoint();
  if (!endpoint) {
    return makeFallbackIntent(queryText);
  }

  const systemPrompt = [
    'Extract campsite search intent from the user query and UI context.',
    'Return JSON only with this exact shape:',
    '{queryRewrite,location,partySize,constraints:{dogFriendly,rv,tent,waterfront,maxPrice},priorities,clarificationQuestions,confidence}.',
    'Rules:',
    '- queryRewrite: short provider-friendly campground search phrase.',
    '- location: explicit place only, else empty string.',
    '- partySize: integer if clear, else null.',
    '- constraints booleans: true only when clearly requested, otherwise null.',
    '- maxPrice: nightly budget number only when explicit, else null.',
    '- priorities: up to 6 short phrases for amenities, setting, access, or trip style.',
    '- clarificationQuestions: ask concise follow-up questions when location, partySize, or priorities are missing.',
    '- confidence: 0 to 1 based on how specific the request is.',
    'Do not invent facts. Use null for unknown values. No prose, no markdown, JSON only.'
  ].join(' ');

  const rawContext = context && typeof context === 'object' ? context : {};
  const compactContext = {
    d: String(rawContext.dateSelection || '').slice(0, 20),
    g: String(rawContext.guestSelection || '').slice(0, 20),
    p: Array.isArray(rawContext.activePills) ? rawContext.activePills.slice(0, 3).map(x => String(x).slice(0, 16)) : []
  };

  const userPayload = {
    q: String(queryText || '').slice(0, 220),
    c: compactContext
  };

  const requestBody = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(userPayload) }
    ],
    temperature: 0.1,
    max_completion_tokens: 160,
    response_format: { type: 'json_object' }
  };

  const rawContent = await callFoundryJsonObject(endpoint, requestBody, 4000);
  const parsed = parseJsonObject(rawContent);
  const validation = validateIntentCandidate(parsed);

  if (validation.valid) {
    return normalizeIntentResponse(parsed, queryText);
  }

  const repairSystemPrompt = [
    'Repair the intent JSON so it strictly matches this schema and types:',
    '{queryRewrite:string,location:string,partySize:int|null,constraints:{dogFriendly:boolean|null,rv:boolean|null,tent:boolean|null,waterfront:boolean|null,maxPrice:number|null},priorities:string[<=6],clarificationQuestions:string[<=3],confidence:number(0..1)}.',
    'Return JSON only.',
    'Do not include extra keys.',
    'Use null for unknown values.'
  ].join(' ');

  const repairBody = {
    messages: [
      { role: 'system', content: repairSystemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          query: String(queryText || '').slice(0, 220),
          context: compactContext,
          invalidOutput: String(rawContent || '').slice(0, 2000),
          validationErrors: validation.issues.slice(0, 8)
        })
      }
    ],
    temperature: 0,
    max_completion_tokens: 180,
    response_format: { type: 'json_object' }
  };

  const repairedRaw = await callFoundryJsonObject(endpoint, repairBody, 4000);
  const repairedParsed = parseJsonObject(repairedRaw);
  const repairedValidation = validateIntentCandidate(repairedParsed);

  if (!repairedValidation.valid) {
    return makeFallbackIntent(queryText);
  }

  return normalizeIntentResponse(repairedParsed, queryText);
}

function makeFallbackJudge(candidateIds = []) {
  return {
    enabled: false,
    source: 'fallback',
    validatedIds: candidateIds,
    rejectedIds: [],
    reasons: {},
    confidence: 0
  };
}

function normalizeJudgeResponse(parsed, candidateIds) {
  if (!parsed || typeof parsed !== 'object') {
    return makeFallbackJudge(candidateIds);
  }

  const allowed = new Set(candidateIds);
  const validatedIdsRaw = Array.isArray(parsed.validatedIds) ? parsed.validatedIds : [];
  const rejectedIdsRaw = Array.isArray(parsed.rejectedIds) ? parsed.rejectedIds : [];

  const validatedIds = [...new Set(
    validatedIdsRaw
      .map(id => String(id || '').trim())
      .filter(id => allowed.has(id))
  )];

  const rejectedIds = [...new Set(
    rejectedIdsRaw
      .map(id => String(id || '').trim())
      .filter(id => allowed.has(id) && !validatedIds.includes(id))
  )];

  const reasonsRaw = parsed.reasons && typeof parsed.reasons === 'object' ? parsed.reasons : {};
  const reasons = {};
  Object.keys(reasonsRaw).forEach(id => {
    if (allowed.has(id) && !validatedIds.includes(id)) {
      reasons[id] = String(reasonsRaw[id] || '').trim().slice(0, 180);
    }
  });

  const confidenceNum = Number(parsed.confidence);
  const confidence = Number.isFinite(confidenceNum)
    ? Math.max(0, Math.min(1, confidenceNum))
    : 0.5;

  if (validatedIds.length === 0) {
    return {
      ...makeFallbackJudge(candidateIds),
      rejectedIds,
      reasons,
      confidence
    };
  }

  return {
    enabled: true,
    source: 'foundry',
    validatedIds,
    rejectedIds,
    reasons,
    confidence
  };
}

async function judgeResultsWithFoundry(queryText, intent, cards) {
  const candidateCards = Array.isArray(cards) ? cards.slice(0, 12) : [];
  const candidateIds = candidateCards
    .map(card => String(card?.id || '').trim())
    .filter(Boolean);

  if (!queryText || candidateCards.length === 0 || candidateIds.length === 0) {
    return makeFallbackJudge(candidateIds);
  }

  const endpoint = buildFoundryChatEndpoint();
  if (!endpoint) {
    return makeFallbackJudge(candidateIds);
  }

  const compactIntent = intent && typeof intent === 'object'
    ? {
      enabled: intent.enabled === true,
      location: String(intent.location || '').slice(0, 64),
      constraints: intent.constraints && typeof intent.constraints === 'object' ? intent.constraints : {},
      priorities: Array.isArray(intent.priorities) ? intent.priorities.slice(0, 6) : []
    }
    : {};

  const compactCards = candidateCards.map(card => ({
    id: String(card.id || '').slice(0, 80),
    name: String(card.name || '').slice(0, 100),
    type: String(card.type || '').slice(0, 80),
    loc: String(card.loc || '').slice(0, 80),
    price: Number.isFinite(Number(card.price)) ? Number(card.price) : null,
    tags: Array.isArray(card.tags) ? card.tags.map(tag => String(tag).slice(0, 24)).slice(0, 6) : [],
    badge: String(card.badge || '').slice(0, 60)
  }));

  const systemPrompt = [
    'You are a strict campsite result judge.',
    'Decide if each candidate campground actually matches the user request.',
    'Return JSON only with shape:',
    '{validatedIds,rejectedIds,reasons,confidence}.',
    'Rules:',
    '- Keep only cards that clearly satisfy the user request and intent constraints.',
    '- validatedIds/rejectedIds must contain only provided candidate ids.',
    '- reasons is an object keyed by rejected id with a short reason (max 120 chars).',
    '- confidence is 0..1 and reflects judging certainty.',
    '- Never invent ids. No markdown or prose outside JSON.'
  ].join(' ');

  const requestBody = {
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          query: String(queryText || '').slice(0, 260),
          intent: compactIntent,
          candidates: compactCards
        })
      }
    ],
    temperature: 0.1,
    max_completion_tokens: 300,
    response_format: { type: 'json_object' }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': FOUNDRY_API_KEY
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
      return makeFallbackJudge(candidateIds);
    }

    const payload = await response.json();
    const rawContent = payload?.choices?.[0]?.message?.content;
    if (!rawContent || typeof rawContent !== 'string') {
      return makeFallbackJudge(candidateIds);
    }

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (err) {
      return makeFallbackJudge(candidateIds);
    }

    return normalizeJudgeResponse(parsed, candidateIds);
  } catch (err) {
    return makeFallbackJudge(candidateIds);
  } finally {
    clearTimeout(timeout);
  }
}

async function handleIntentParse(req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (err) {
    sendJson(res, 400, { error: err.message });
    return;
  }

  const queryText = String(body?.query || '').trim();
  const context = body?.context || {};

  if (!queryText) {
    sendJson(res, 200, { intent: makeFallbackIntent('') });
    return;
  }

  const intent = await parseIntentWithFoundry(queryText, context);
  sendJson(res, 200, { intent });
}

async function handleResultJudge(req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (err) {
    sendJson(res, 400, { error: err.message });
    return;
  }

  const queryText = String(body?.query || '').trim();
  const intent = body?.intent && typeof body.intent === 'object' ? body.intent : null;
  const cards = Array.isArray(body?.cards) ? body.cards : [];

  const judge = await judgeResultsWithFoundry(queryText, intent, cards);
  sendJson(res, 200, { judge });
}

function handleAppConfig(res) {
  sendJson(res, 200, {
    demoMode: DEMO_MODE
  });
}

const server = http.createServer(async (req, res) => {
  Object.entries(SECURITY_HEADERS).forEach(([header, value]) => {
    res.setHeader(header, value);
  });

  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (reqUrl.pathname === '/api/config' && req.method === 'GET') {
    handleAppConfig(res);
    return;
  }

  if (reqUrl.pathname === '/api/ridb/facilities' && req.method === 'GET') {
    await proxyRidbFacilities(reqUrl, res);
    return;
  }

  const ridbCampsitesMatch = reqUrl.pathname.match(/^\/api\/ridb\/facilities\/(\d+)\/campsites$/);
  if (ridbCampsitesMatch && req.method === 'GET') {
    await proxyRidbCampsites(reqUrl, res, ridbCampsitesMatch[1]);
    return;
  }

  if (reqUrl.pathname === '/api/nps/campgrounds' && req.method === 'GET') {
    await proxyNpsCampgrounds(reqUrl, res);
    return;
  }

  const availabilityMatch = reqUrl.pathname.match(/^\/api\/recreation\/availability\/(\d+)\/month$/);
  if (availabilityMatch && req.method === 'GET') {
    await proxyRecreationAvailability(reqUrl, res, availabilityMatch[1]);
    return;
  }

  if (reqUrl.pathname === '/api/media/photos' && req.method === 'GET') {
    await proxyCampgroundPhotos(reqUrl, res);
    return;
  }

  if (reqUrl.pathname === '/api/google/reviews' && req.method === 'GET') {
    await proxyGoogleReviews(reqUrl, res);
    return;
  }

  if (reqUrl.pathname === '/api/location/reverse' && req.method === 'GET') {
    await proxyReverseGeocode(reqUrl, res);
    return;
  }

  if (reqUrl.pathname === '/api/intent/parse' && req.method === 'POST') {
    await handleIntentParse(req, res);
    return;
  }

  if (reqUrl.pathname === '/api/judge/results' && req.method === 'POST') {
    await handleResultJudge(req, res);
    return;
  }

  let filePath = reqUrl.pathname === '/' ? path.join(ROOT, 'index.html') : safeResolvePath(reqUrl.pathname);
  if (!filePath) {
    sendJson(res, 403, { error: 'Forbidden path' });
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    sendFile(res, filePath);
  });
});

server.listen(PORT, () => {
  console.log(`Campin server running at http://localhost:${PORT}`);
});

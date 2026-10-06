export function distanceKm(a, b) {
  if (![a?.lat, a?.lon, b?.lat, b?.lon].every(Number.isFinite)) return null;
  const radians = value => value * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function evaluateRequirements(card, intent, origin, radiusKm = 80) {
  const missing = [];
  const labels = { dogFriendly: 'dogs allowed', rv: 'RV sites', tent: 'tent sites', waterfront: 'waterfront' };
  for (const [key, label] of Object.entries(labels)) {
    const required = intent?.constraints?.[key];
    if (typeof required !== 'boolean') continue;
    const actual = card.features?.[key];
    if (actual !== required) missing.push(`${label}: ${typeof actual === 'boolean' ? 'requirement not met' : 'not verified'}`);
  }
  const budget = intent?.constraints?.maxPrice;
  if (budget !== null && budget !== undefined && Number.isFinite(Number(budget))) {
    if (card.price === null || card.price === undefined) missing.push('nightly price: not verified');
    else if (card.price > Number(budget)) missing.push(`nightly price exceeds $${budget}`);
  }
  if (Number.isInteger(intent?.partySize) && intent.partySize > 0) {
    const capacity = card.campsiteSummary?.maxOccupancy;
    if (!Number.isFinite(capacity)) missing.push('group capacity: not verified');
    else if (capacity < intent.partySize) missing.push('group exceeds listed site capacity');
  }
  const distance = distanceKm(origin, card);
  if (intent?.location) {
    if (origin) {
      if (distance === null) missing.push('distance: not verified');
      else if (distance > radiusKm) missing.push(`outside ${radiusKm} km search area`);
    } else {
      // Text alone is not evidence of proximity.
      missing.push('distance: location lookup unavailable');
    }
  }
  if (card.availabilityTrip?.checkIn) {
    if (card.availability?.state === 'unavailable') missing.push('no sites available for the selected stay');
    else if (card.availability?.state !== 'available') missing.push('stay availability: not verified');
  }
  const corpus = [card.name, card.descriptionText, ...(card.tags || [])].join(' ').toLowerCase();
  const preferenceScore = (intent?.priorities || []).filter(priority => corpus.includes(String(priority).toLowerCase())).length;
  const distanceLabel = distance === null || !origin?.label
    ? null
    : `${Math.round(distance)} km from ${origin.label}`;
  return { ...card, distanceKm: distance, distanceLabel, preferenceScore, missingRequirements: missing, matchGroup: missing.length ? 'near' : 'exact' };
}

// Radii (km) tried in order for geo searches; the server caps radius at 500 km.
export const RADIUS_SCHEDULE_KM = [50, 150, 400];

const QUERY_STOPWORDS = new Set([
  'campground', 'campgrounds', 'camping', 'campsite', 'campsites', 'near', 'in', 'around',
  'for', 'with', 'under', 'the', 'a', 'an', 'and', 'or', 'to', 'of', 'at', 'on', 'this',
  'next', 'weekend', 'weekends', 'night', 'nights', 'guest', 'guests', 'people', 'person',
  'updated', 'request', 'additional', 'user', 'details', 'find', 'want', 'looking', 'something'
]);

export function tokenizeQuery(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3 && !QUERY_STOPWORDS.has(token));
}

export function termOverlapScore(queryTokens, card) {
  const tokens = Array.isArray(queryTokens) ? queryTokens.filter(Boolean) : [];
  if (!tokens.length) return 0;
  const fields = [
    { text: card?.name, weight: 3 },
    { text: [card?.type, ...(Array.isArray(card?.tags) ? card.tags : [])].join(' '), weight: 2 },
    { text: [card?.cityName, card?.stateCode, card?.loc].filter(Boolean).join(' '), weight: 2 },
    { text: card?.descriptionText, weight: 1 }
  ];
  let earned = 0;
  for (const token of tokens) {
    earned += Math.max(0, ...fields.map(field =>
      String(field.text || '').toLowerCase().includes(token) ? field.weight : 0));
  }
  return earned / (tokens.length * 3);
}

// Composite relevance within a match group: term overlap (0-30), priority-word hits
// (0-20), distance decay (0-15, full within 25 km, zero at 150 km), stay availability
// (+15 available / -10 unavailable once dates are set), and campsite-verified required
// amenities (0-10). Never changes the exact/near grouping, only the order within it.
export function compositeRelevanceScore(card, context = {}) {
  const { queryTokens = [], intent = null } = context;
  let score = termOverlapScore(queryTokens, card) * 30;
  score += Math.min((card?.preferenceScore || 0) * 5, 20);
  const distance = card?.distanceKm;
  if (Number.isFinite(distance)) {
    score += distance <= 25 ? 15 : Math.max(0, 15 - 15 * (distance - 25) / 125);
  }
  if (card?.availabilityTrip?.checkIn) {
    const state = card.availability?.state;
    if (state === 'available') score += 15;
    else if (state === 'unavailable') score -= 10;
  }
  const constraints = intent?.constraints || {};
  let verified = 0;
  if (constraints.tent === true && card?.campsiteSummary?.tentAllowed === true) verified += 1;
  if (constraints.rv === true && card?.campsiteSummary?.rvAllowed === true) verified += 1;
  if (constraints.dogFriendly === true && card?.features?.dogFriendly === true) verified += 1;
  if (constraints.waterfront === true && card?.features?.waterfront === true) verified += 1;
  score += Math.min(verified * 5, 10);
  return Math.round(score * 10) / 10;
}

export function fallbackIntent(query, context = {}) {
  const text = String(query || '');
  const segments = text.split(/\. (?:Updated request|Additional user details): /);
  if (segments.length > 1) {
    const combined = fallbackIntent(segments[0], context);
    for (const segment of segments.slice(1)) {
      const update = fallbackIntent(segment);
      if (update.location) combined.location = update.location;
      if (update.partySize) combined.partySize = update.partySize;
      for (const [key, value] of Object.entries(update.constraints)) {
        if (value !== null) combined.constraints[key] = value;
      }
      combined.priorities = [...new Set([...combined.priorities, ...update.priorities])];
    }
    combined.queryRewrite = combined.location ? `${combined.location} campground` : text;
    return combined;
  }
  const location = text.match(/\b(?:near|in|around)\s+(.+?)(?=\s+(?:with|under|for|this|next|that|and)\b|[.!?]|$)/i)?.[1]?.trim() || '';
  const party = text.match(/\b(\d+)\s+(?:people|campers|guests)\b/i)?.[1] || String(context.guestSelection || '').match(/\d+/)?.[0];
  const budget = text.match(/(?:under\s*\$?|\$)\s*(\d+(?:\.\d+)?)/i)?.[1];
  const constraints = {
    dogFriendly: /\b(?:dog|dogs|pet|pets)\b/i.test(text) ? !/\b(?:no|without)\s+(?:dogs?|pets?)\b/i.test(text) : null,
    rv: /\brv\b/i.test(text) ? !/\b(?:no|without)\s+rv\b/i.test(text) : null,
    tent: /\btent\b/i.test(text) ? true : null,
    waterfront: /\b(?:waterfront|lakeside|lakefront|riverfront|beachfront)\b/i.test(text) ? true : null,
    maxPrice: budget ? Number(budget) : null
  };
  for (const pill of context.activePills || []) {
    if (/dog/i.test(pill) && constraints.dogFriendly === null) constraints.dogFriendly = true;
    if (/\brv\b/i.test(pill) && constraints.rv === null) constraints.rv = true;
    if (/tent/i.test(pill) && constraints.tent === null) constraints.tent = true;
  }
  const priorities = ['quiet', 'campfire', 'hiking', 'showers', 'electric'].filter(word => text.toLowerCase().includes(word));
  return { enabled: true, source: 'fallback', queryRewrite: location ? `${location} campground` : text, location,
    partySize: party ? Number(party) : null, constraints, priorities, clarificationQuestions: [], confidence: 0 };
}

export function createSearchSession() {
  let current = null;
  return {
    start() {
      current?.controller.abort();
      const controller = new AbortController();
      const token = { controller, signal: controller.signal, isCurrent: () => current === token && !controller.signal.aborted };
      current = token;
      return token;
    },
    cancel() { current?.controller.abort(); current = null; }
  };
}

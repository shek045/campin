function buildUrl(apiBaseUrl, path, searchParams) {
  const url = new URL(`${apiBaseUrl}${path}`, window.location.origin);
  Object.entries(searchParams || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url;
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 12_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json();
    return { ok: response.ok, status: response.status, json: async () => payload };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

export function createApiClient(apiBaseUrl) {
  return {
    getConfig() {
      return requestJson(buildUrl(apiBaseUrl, '/config'));
    },

    parseIntent(payload, options = {}) {
      return requestJson(buildUrl(apiBaseUrl, '/intent/parse'), {
        ...options,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    },

    getRidbFacilities(query, limit = 12, options = {}, location = null) {
      return requestJson(buildUrl(apiBaseUrl, '/ridb/facilities', {
        query, limit, latitude: location?.lat, longitude: location?.lon,
        radius: location ? (location.radiusKm ?? 50) : undefined
      }), options);
    },

    getRidbCampsites(facilityId, limit = 200, offset = 0, options = {}) {
      return requestJson(buildUrl(apiBaseUrl, `/ridb/facilities/${encodeURIComponent(String(facilityId))}/campsites`, {
        limit,
        offset
      }), options);
    },

    getNpsCampgrounds(query, limit = 12, options = {}) {
      return requestJson(buildUrl(apiBaseUrl, '/nps/campgrounds', { q: query, limit }), options);
    },

    getRecreationAvailability(campgroundId, startDate, options = {}) {
      return requestJson(buildUrl(apiBaseUrl, `/recreation/availability/${encodeURIComponent(String(campgroundId))}/month`, {
        start_date: startDate
      }), options);
    },

    judgeResults(payload, options = {}) {
      return requestJson(buildUrl(apiBaseUrl, '/judge/results'), {
        ...options,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    },

    getMediaPhotos(query) {
      return requestJson(buildUrl(apiBaseUrl, '/media/photos', { query }));
    },

    getGoogleReviews(query, options = {}) {
      return requestJson(buildUrl(apiBaseUrl, '/google/reviews', { query }), options);
    },

    reverseGeocode(lat, lon) {
      return requestJson(buildUrl(apiBaseUrl, '/location/reverse', {
        lat,
        lon
      }));
    },

    getSearchLocation(query, options = {}) {
      return requestJson(buildUrl(apiBaseUrl, '/location/search', { query }), options);
    }
  };
}

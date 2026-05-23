function buildUrl(apiBaseUrl, path, searchParams) {
  const url = new URL(`${apiBaseUrl}${path}`, window.location.origin);
  Object.entries(searchParams || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url;
}

function requestJson(url, options = {}) {
  return fetch(url, options);
}

export function createApiClient(apiBaseUrl) {
  return {
    getConfig() {
      return requestJson(buildUrl(apiBaseUrl, '/config'));
    },

    parseIntent(payload) {
      return requestJson(buildUrl(apiBaseUrl, '/intent/parse'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    },

    getRidbFacilities(query, limit = 12) {
      return requestJson(buildUrl(apiBaseUrl, '/ridb/facilities', { query, limit }));
    },

    getNpsCampgrounds(query, limit = 12) {
      return requestJson(buildUrl(apiBaseUrl, '/nps/campgrounds', { q: query, limit }));
    },

    getRecreationAvailability(campgroundId, startDate) {
      return requestJson(buildUrl(apiBaseUrl, `/recreation/availability/${encodeURIComponent(String(campgroundId))}/month`, {
        start_date: startDate
      }));
    },

    judgeResults(payload) {
      return requestJson(buildUrl(apiBaseUrl, '/judge/results'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    },

    getMediaPhotos(query) {
      return requestJson(buildUrl(apiBaseUrl, '/media/photos', { query }));
    },

    getGoogleReviews(query) {
      return requestJson(buildUrl(apiBaseUrl, '/google/reviews', { query }));
    }
  };
}

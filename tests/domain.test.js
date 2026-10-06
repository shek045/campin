const { test, before } = require('node:test');
const assert = require('node:assert/strict');
let trip, listings, search, booking, saved, explore;
before(async () => {
  [trip, listings, search, booking, saved, explore] = await Promise.all([
    import('../assets/js/domain/trip.js'), import('../assets/js/domain/listings.js'),
    import('../assets/js/domain/search.js'), import('../assets/js/domain/booking.js'),
    import('../assets/js/services/savedListings.js'),
    import('../assets/js/domain/explore.js')
  ]);
});

const stay = { checkIn: '2027-01-31', checkOut: '2027-02-02' };
const month = days => ({ campsites: Object.fromEntries(Object.entries(days).map(([id, availabilities]) => [id, { availabilities }])) });

test('trip dates reject invalid dates, reversed ranges, past dates and long stays', () => {
  assert.equal(trip.isValidIsoDate('2027-02-30'), false);
  assert.equal(trip.isValidIsoDate('2028-02-29'), true);
  assert.ok(trip.validateTrip({ checkIn: '2027-02-02', checkOut: '2027-02-01' }, '2027-01-01'));
  assert.ok(trip.validateTrip({ checkIn: '2026-12-31', checkOut: '2027-01-02' }, '2027-01-01'));
  assert.ok(trip.validateTrip({ checkIn: '2027-01-01', checkOut: '2027-02-02' }, '2027-01-01'));
  assert.equal(trip.validateTrip(stay, '2027-01-01'), '');
  assert.equal(trip.validateTrip({}), '');
});

test('cross-month availability intersects nights on the same campsite, excluding checkout', () => {
  assert.deepEqual(trip.tripNights(stay), ['2027-01-31', '2027-02-01']);
  assert.deepEqual(trip.tripMonths(stay), ['2027-01-01T00:00:00.000Z', '2027-02-01T00:00:00.000Z']);
  const result = trip.summarizeAvailability([
    month({ a: { '2027-01-31T00:00:00Z': 'Available' }, b: { '2027-01-31T00:00:00Z': 'Reserved' } }),
    month({ a: { '2027-02-01T00:00:00Z': 'Available', '2027-02-02T00:00:00Z': 'Reserved' }, b: { '2027-02-01T00:00:00Z': 'Available' } })
  ], stay, 'checked');
  assert.deepEqual(result, { state: 'available', count: 1, checkedAt: 'checked' });
});

test('one available night, missing data, no dates and provider failure are distinct', () => {
  const oneMonth = { checkIn: '2027-02-01', checkOut: '2027-02-03' };
  assert.equal(trip.summarizeAvailability([month({ a: { '2027-02-01': 'Available', '2027-02-02': 'Reserved' } })], oneMonth).state, 'unavailable');
  assert.equal(trip.summarizeAvailability([month({ a: { '2027-02-01': 'Available' } })], oneMonth).state, 'unknown');
  assert.equal(trip.summarizeAvailability([null], oneMonth).count, null);
  assert.equal(trip.summarizeAvailability([], {}).state, 'not_checked');
  assert.equal(trip.summarizeAvailability([month({})], oneMonth).state, 'unknown');
  assert.equal(trip.summarizeAvailability([month({})], stay).state, 'unknown');
});

test('DST boundaries use calendar nights', () => {
  assert.deepEqual(trip.tripNights({ checkIn: '2027-03-13', checkOut: '2027-03-15' }), ['2027-03-13', '2027-03-14']);
  assert.deepEqual(trip.weekendTrip('This weekend', new Date(2027, 0, 4)), { checkIn: '2027-01-08', checkOut: '2027-01-10' });
  assert.deepEqual(trip.weekendTrip('Next weekend', new Date(2027, 0, 9)), { checkIn: '2027-01-15', checkOut: '2027-01-17' });
});

test('stay dates come from query text while dateless searches stay dateless', () => {
  assert.equal(trip.stayFromQueryText('tent campground near Seattle for 2 guests'), null);
  assert.equal(trip.stayFromQueryText(''), null);
  assert.equal(trip.stayFromQueryText('campground near Seattle 2027-01-31 with a lone date'), null);
  assert.deepEqual(trip.stayFromQueryText('campground near Seattle 2027-01-31 to 2027-02-02'), { checkIn: '2027-01-31', checkOut: '2027-02-02' });
  const weekend = trip.stayFromQueryText('tent campground near Seattle next weekend', new Date(2027, 0, 9));
  assert.deepEqual(weekend, { checkIn: '2027-01-15', checkOut: '2027-01-17' });
  assert.equal(trip.validateTrip(weekend, '2027-01-01'), '');
});

test('provider normalization never fabricates prices, coordinates, ratings or permissions', () => {
  const nps = listings.normalizeNpsCampgroundRecord({ id: 'nps-1', name: 'Camp', description: 'No dogs. Permit costs $50.' });
  assert.equal(nps.price, null);
  assert.equal(nps.lat, null);
  assert.equal(nps.features.dogFriendly, null);
  assert.equal(listings.normalizeNpsCampgroundRecord({ fees: [{ cost: '0' }] }).price, 0);
  const ridb = listings.normalizeRidbFacilityRecord({ FacilityID: '1', FacilityLatitude: '', FacilityLongitude: null });
  assert.equal(ridb.lat, null);
  assert.equal(ridb.lon, null);
  assert.equal(listings.extractPriceFromCampsite({ CampsiteDescription: 'Parking $25' }), null);
  const summary = listings.summarizeRidbCampsites([]);
  assert.equal(summary.avgPrice, null);
  assert.equal(summary.rvAllowed, null);
  assert.equal(listings.summarizeRidbCampsites([{ CampsiteType: 'RV' }]).rvAllowed, true);
  assert.equal(listings.safeHttpUrl('javascript:alert(1)'), '');
});

test('booking estimates preserve cents and never invent fees', () => {
  const price = booking.calculateBookingBreakdown(22.75, 3, 6);
  assert.equal(price.total, 68.25);
  assert.equal(price.parkFee, null);
  assert.equal(price.guestExtraFee, null);
  assert.equal(booking.calculateBookingBreakdown(null, 2, 2).total, null);
  assert.equal(booking.calculateBookingBreakdown(0, 2, 2).total, 0);
});

test('unknown or unmet hard constraints cannot become exact matches', () => {
  const origin = { lat: 47.6, lon: -122.3 };
  const intent = { location: 'Seattle', constraints: { rv: true, maxPrice: 50 } };
  const card = { lat: 47.61, lon: -122.31, price: 25, features: { rv: true } };
  assert.equal(search.evaluateRequirements(card, intent, origin).matchGroup, 'exact');
  assert.equal(search.evaluateRequirements({ ...card, price: null }, intent, origin).matchGroup, 'near');
  assert.equal(search.evaluateRequirements({ ...card, features: {} }, intent, origin).matchGroup, 'near');
  assert.equal(search.evaluateRequirements({ ...card, lat: 34, lon: -118 }, intent, origin).matchGroup, 'near');
  assert.equal(search.evaluateRequirements(card, intent, null).matchGroup, 'near');
  assert.equal(search.evaluateRequirements({ ...card, availabilityTrip: stay, availability: { state: 'unavailable' } }, intent, origin).matchGroup, 'near');
});

test('fallback follow-ups preserve requirements but update explicit changes', () => {
  const intent = search.fallbackIntent('RV campground near Seattle under $50 for 4 guests. Updated request: near Portland under $30');
  assert.equal(intent.location, 'Portland');
  assert.equal(intent.constraints.rv, true);
  assert.equal(intent.constraints.maxPrice, 30);
  assert.equal(intent.partySize, 4);
});

test('superseded searches are aborted and cannot commit results', () => {
  const sessions = search.createSearchSession();
  const first = sessions.start();
  const second = sessions.start();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
  sessions.cancel();
  assert.equal(second.isCurrent(), false);
});

test('saved listing IDs survive reload and tolerate unavailable or corrupt storage', () => {
  let value = '';
  const storage = { getItem: () => value, setItem: (key, next) => { value = next; } };
  const first = saved.createSavedListings(storage);
  assert.equal(first.toggle('ridb-1'), true);
  assert.equal(saved.createSavedListings(storage).has('ridb-1'), true);
  assert.equal(first.toggle('ridb-1'), false);
  assert.equal(saved.createSavedListings({ getItem: () => '{invalid' }).has('ridb-1'), false);
  assert.equal(saved.createSavedListings().toggle('ridb-1'), true);
});

test('query tokenization drops stopwords, punctuation, and conversation glue', () => {
  assert.deepEqual(search.tokenizeQuery('Tent campground near Seattle, for 2 guests! Updated request: something'), ['tent', 'seattle']);
  assert.deepEqual(search.tokenizeQuery('Waterfront quiet sites under $100 this weekend'), ['waterfront', 'quiet', 'sites', '100']);
  assert.deepEqual(search.tokenizeQuery(''), []);
});

test('term overlap weights name matches above description matches', () => {
  const card = {
    name: 'Seattle Creek Campground', type: 'Campground', tags: [],
    cityName: 'Seattle', stateCode: 'WA', loc: 'Seattle, WA',
    descriptionText: 'A quiet place near the water.'
  };
  assert.equal(search.termOverlapScore(['seattle'], card), 1);
  assert.equal(search.termOverlapScore(['quiet'], card), 1 / 3);
  assert.equal(search.termOverlapScore(['zephyr'], card), 0);
  assert.equal(search.termOverlapScore([], card), 0);
});

test('composite relevance rewards availability, proximity, and verified amenities', () => {
  const base = { name: 'Fixture Creek Campground', preferenceScore: 0, distanceKm: 10, campsiteSummary: { tentAllowed: true }, features: {} };
  const available = { ...base, availabilityTrip: { checkIn: '2027-01-31' }, availability: { state: 'available' } };
  const unavailable = { ...base, availabilityTrip: { checkIn: '2027-01-31' }, availability: { state: 'unavailable' } };
  const unverifiedTent = { ...base, campsiteSummary: {} };
  assert.ok(search.compositeRelevanceScore(available) > search.compositeRelevanceScore(base));
  assert.ok(search.compositeRelevanceScore(unavailable) < search.compositeRelevanceScore(base));
  assert.ok(search.compositeRelevanceScore(base, { intent: { constraints: { tent: true } } })
    > search.compositeRelevanceScore(unverifiedTent, { intent: { constraints: { tent: true } } }));
  assert.ok(search.compositeRelevanceScore({ ...base, distanceKm: 120 }, { intent: { constraints: {} } })
    < search.compositeRelevanceScore(base, { intent: { constraints: {} } }));
});

test('radius schedule expands for sparse areas and distance misses honor the searched radius', () => {
  assert.deepEqual(search.RADIUS_SCHEDULE_KM, [50, 150, 400]);
  const origin = { lat: 0, lon: 0, label: 'Seattle, WA' };
  const intent = { location: 'Seattle', constraints: {} };
  const card = { name: 'Distant Campground', lat: 1, lon: 1 };
  const wide = search.evaluateRequirements(card, intent, origin, 400);
  assert.equal(wide.missingRequirements.length, 0);
  assert.match(wide.distanceLabel, /km from Seattle, WA$/);
  const strict = search.evaluateRequirements(card, intent, origin, 50);
  assert.ok(strict.missingRequirements.some(item => item.includes('outside 50 km search area')));
  assert.ok(search.evaluateRequirements(card, intent, null)
    .missingRequirements.some(item => item.includes('location lookup unavailable')));
});

test('explore plan covers five regions with four destination queries each', () => {
  assert.equal(explore.EXPLORE_PLAN.length, 20);
  const counts = {};
  for (const item of explore.EXPLORE_PLAN) counts[item.region] = (counts[item.region] || 0) + 1;
  assert.deepEqual(counts, { west: 4, rockies: 4, south: 4, midwest: 4, northeast: 4 });
  assert.deepEqual(Object.keys(explore.REGION_STATES).sort(), ['midwest', 'northeast', 'rockies', 'south', 'west']);
  for (const item of explore.EXPLORE_PLAN) {
    assert.ok(item.query.toLowerCase().includes('campground'));
    assert.ok(explore.REGION_STATES[item.region].length > 0);
  }
});

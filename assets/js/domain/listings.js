export const PROVIDER_SCHEMA_VERSION = 'campin.provider-campground.v1';

export function knownNumber(value) {
  return value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value))
    ? Number(value) : null;
}

export function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['https:', 'http:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function text(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeRidbFacilityRecord(facility) {
  const mediaUrls = [...new Set((Array.isArray(facility?.MEDIA) ? facility.MEDIA : [])
    .filter(item => String(item.MediaType).toLowerCase() === 'image')
    .map(item => safeHttpUrl(item.URL)).filter(Boolean))];
  const address = facility?.FACILITYADDRESS?.find(item => item.FacilityAddressType === 'Physical') || facility?.FACILITYADDRESS?.[0] || {};
  return {
    schemaVersion: PROVIDER_SCHEMA_VERSION, sourceProvider: 'recreation_gov',
    providerId: String(facility?.FacilityID || ''), name: text(facility?.FacilityName),
    typeDescription: text(facility?.FacilityTypeDescription || 'Federal'),
    city: text(facility?.FacilityCity || address.City),
    stateCode: text(facility?.FacilityStateCode || facility?.FacilityState || address.AddressStateCode || 'US'),
    lat: knownNumber(facility?.FacilityLatitude), lon: knownNumber(facility?.FacilityLongitude),
    description: text(facility?.FacilityDescription), feeDescription: text(facility?.FacilityUseFeeDescription),
    directions: text(facility?.FacilityDirections), mediaUrls
  };
}

export function normalizeNpsCampgroundRecord(campground) {
  const address = campground?.addresses?.find(item => item.type === 'Physical') || campground?.addresses?.[0] || {};
  const coordinates = String(campground?.latLong || '');
  const prices = (Array.isArray(campground?.fees) ? campground.fees : [])
    .map(fee => knownNumber(fee.cost)).filter(value => value !== null && value >= 0);
  const tentCount = knownNumber(campground?.campsites?.tentOnly);
  const rvCount = knownNumber(campground?.campsites?.rvOnly);
  return {
    schemaVersion: PROVIDER_SCHEMA_VERSION, sourceProvider: 'nps',
    providerId: String(campground?.id || ''), name: text(campground?.name),
    typeDescription: 'National Park Service · Campground', city: text(address.city || 'National Park'),
    stateCode: text(address.stateCode || 'US'),
    lat: knownNumber(campground?.latitude) ?? knownNumber(coordinates.match(/lat:([\d.\-]+)/)?.[1]),
    lon: knownNumber(campground?.longitude) ?? knownNumber(coordinates.match(/long:([\d.\-]+)/)?.[1]),
    description: text(campground?.description || campground?.shortDescription),
    directions: text(campground?.directionsOverview || campground?.directions || campground?.directionsInfo),
    reservationUrl: safeHttpUrl(campground?.reservationUrl || campground?.reservationsUrl),
    mediaUrls: [...new Set((Array.isArray(campground?.images) ? campground.images : []).map(item => safeHttpUrl(item.url)).filter(Boolean))],
    price: prices.length ? Math.min(...prices) : null,
    features: { rv: rvCount > 0 ? true : null, tent: tentCount > 0 ? true : null, dogFriendly: null, waterfront: null },
    campsiteSummary: { count: knownNumber(campground?.campsites?.totalSites), maxOccupancy: null }
  };
}

export function extractPriceFromCampsite(campsite) {
  for (const key of ['CampsiteCost', 'CampsiteFee', 'NightlyFee', 'CampsiteMinCost']) {
    const price = knownNumber(campsite?.[key]);
    if (price !== null && price >= 0) return price;
  }
  // Descriptions can mention parking, permits, or unrelated costs. Do not infer a nightly rate.
  return null;
}

function trueFlag(value) {
  return value === true || /^(true|1|y|yes)$/i.test(String(value || ''));
}

export function summarizeRidbCampsites(rows = []) {
  const prices = rows.map(extractPriceFromCampsite).filter(value => value !== null);
  const capacities = rows.flatMap(site => [site.CampsiteMaxOccupancy, site.MaxNumPeople].map(knownNumber))
    .filter(value => value !== null && value > 0);
  const includes = (keys, pattern) => rows.some(site =>
    keys.some(key => trueFlag(site[key])) || pattern.test(String(site.CampsiteType || ''))) ? true : null;
  return {
    count: rows.length,
    avgPrice: prices.length ? Math.min(...prices) : null,
    maxOccupancy: capacities.length ? Math.max(...capacities) : null,
    rvAllowed: includes(['CampsiteRVAllowed', 'RVAllowed'], /\brv\b/i),
    tentAllowed: includes(['CampsiteTentAllowed', 'TentAllowed'], /\btent\b/i),
    electricHookup: includes(['CampsiteElectricalHookup', 'ElectricalHookups'], /electric/i),
    accessible: includes(['CampsiteAccessible', 'Accessible'], /\baccessible\b/i)
  };
}

const http = require('node:http');
const { server: app } = require('../server');

// Deterministic fixture facilities for the Explore plan. Each entry is
// [destination keyword, facility name, city, state, lat, lon]; ids are stable
// (201..) in array order. Search-style queries that match no keyword keep
// returning the original single fixture so search tests stay stable.
const EXPLORE_FIXTURES = [
  ['yosemite', 'Yosemite Creek Campground', 'Yosemite Valley', 'CA', 37.74, -119.59],
  ['yosemite', 'Wawona Campground', 'Wawona', 'CA', 37.54, -119.66],
  ['olympic', 'Kalaloch Campground', 'Forks', 'WA', 47.61, -124.37],
  ['olympic', 'Hoh Rain Forest Campground', 'Forks', 'WA', 47.86, -123.93],
  ['tahoe', 'Sand Harbor Campground', 'Incline Village', 'NV', 39.04, -119.95],
  ['tahoe', 'Zephyr Cove Campground', 'Zephyr Cove', 'NV', 38.97, -119.95],
  ['mount hood', 'Trillium Lake Campground', 'Government Camp', 'OR', 45.28, -121.75],
  ['mount hood', 'Lost Lake Campground', 'Hood River', 'OR', 45.49, -121.64],
  ['yellowstone', 'Madison Campground', 'West Yellowstone', 'MT', 44.65, -111.10],
  ['yellowstone', 'Canyon Campground', 'Yellowstone National Park', 'WY', 44.73, -110.50],
  ['glacier', 'Apgar Campground', 'West Glacier', 'MT', 48.50, -113.99],
  ['glacier', 'Many Glacier Campground', 'Babb', 'MT', 48.79, -113.66],
  ['rocky mountain', 'Moraine Park Campground', 'Estes Park', 'CO', 40.36, -105.61],
  ['rocky mountain', 'Glacier Basin Campground', 'Estes Park', 'CO', 40.35, -105.60],
  ['grand teton', 'Jenny Lake Campground', 'Moose', 'WY', 43.75, -110.72],
  ['grand teton', 'Colter Bay Campground', 'Moran', 'WY', 43.91, -110.58],
  ['smoky', 'Cades Cove Campground', 'Townsend', 'TN', 35.60, -83.77],
  ['smoky', 'Elkmont Campground', 'Gatlinburg', 'TN', 35.65, -83.58],
  ['big bend', 'Chisos Basin Campground', 'Big Bend National Park', 'TX', 29.27, -103.30],
  ['big bend', 'Rio Grande Village Campground', 'Big Bend National Park', 'TX', 29.18, -102.95],
  ['ozark', 'Buffalo River Campground', 'Jasper', 'AR', 36.01, -93.19],
  ['ozark', 'Greers Ferry Lake Campground', 'Heber Springs', 'AR', 35.53, -92.06],
  ['shenandoah', 'Big Meadows Campground', 'Luray', 'VA', 38.52, -78.43],
  ['shenandoah', 'Lewis Mountain Campground', 'Luray', 'VA', 38.56, -78.40],
  ['sleeping bear', 'Dune Valley Campground', 'Empire', 'MI', 44.70, -86.06],
  ['sleeping bear', 'Platte River Campground', 'Honor', 'MI', 44.65, -86.27],
  ['boundary waters', 'Sawbill Lake Campground', 'Tofte', 'MN', 47.64, -91.14],
  ['boundary waters', 'Fall Lake Campground', 'Ely', 'MN', 47.92, -91.86],
  ['custer', 'Sylvan Lake Campground', 'Custer', 'SD', 43.83, -103.51],
  ['custer', 'Legion Lake Campground', 'Custer', 'SD', 43.74, -103.44],
  ['porcupine', 'Lake Superior Campground', 'Silver City', 'MI', 46.65, -89.14],
  ['porcupine', 'Union Bay Campground', 'Bergland', 'MI', 46.66, -89.60],
  ['acadia', 'Blackwoods Campground', 'Bar Harbor', 'ME', 44.35, -68.21],
  ['acadia', 'Seawall Campground', 'Southwest Harbor', 'ME', 44.28, -68.30],
  ['adirondack', 'Lake Placid Campground', 'Lake Placid', 'NY', 44.28, -73.98],
  ['adirondack', 'Forked Lake Campground', 'Long Lake', 'NY', 44.13, -74.45],
  ['white mountain', 'Pinkham Notch Campground', 'Gorham', 'NH', 44.27, -71.25],
  ['white mountain', 'Twin Mountain Campground', 'Twin Mountain', 'NH', 44.25, -71.52],
  ['finger lakes', 'Watkins Glen Campground', 'Watkins Glen', 'NY', 42.38, -76.87],
  ['finger lakes', 'Taughannock Falls Campground', 'Trumansburg', 'NY', 42.54, -76.60]
];

function makeFacility(id, name, city, state, lat, lon) {
  return {
    FacilityID: String(id), FacilityName: name, FacilityTypeDescription: 'Campground',
    FacilityCity: city, FacilityStateCode: state, FacilityLatitude: lat, FacilityLongitude: lon,
    FacilityDescription: `${name} is a fixture campground near ${city}, ${state}. Confirm details with the provider.`
  };
}

function fixtureResponse(url) {
  if (url.pathname === '/api/config') return { demoMode: false };
  if (url.pathname === '/api/intent/parse') return { intent: { enabled: false, source: 'fallback' } };
  if (url.pathname === '/api/location/search') return { location: { lat: 47.6, lon: -122.3, label: 'Seattle, WA' } };
  if (url.pathname === '/api/location/reverse') return { locationLabel: 'Seattle, WA' };
  if (url.pathname === '/api/ridb/facilities') {
    const query = (url.searchParams.get('query') || '').toLowerCase();
    const destinationRows = EXPLORE_FIXTURES
      .filter(([keyword]) => keyword && query.includes(keyword))
      .map(([keyword, name, city, state, lat, lon], index) => makeFacility(201 + index, name, city, state, lat, lon));
    if (destinationRows.length) return { RECDATA: destinationRows };
    return {
      RECDATA: [{
        FacilityID: '123', FacilityName: 'Fixture Creek Campground', FacilityTypeDescription: 'Campground',
        FacilityCity: 'Seattle', FacilityStateCode: 'WA', FacilityLatitude: 47.61, FacilityLongitude: -122.31,
        FacilityDescription: 'A campground with tent sites. Confirm pet policies with the provider.'
      }]
    };
  }
  if (url.pathname.endsWith('/campsites')) {
    const facilityId = String((url.pathname.match(/facilities\/(\d+)/) || [])[1] || '123');
    if (facilityId === '123') {
      return { RECDATA: [{ CampsiteID: 'site-1', CampsiteType: 'TENT', CampsiteMaxOccupancy: 6, NightlyFee: 22.75 }] };
    }
    return Number(facilityId) % 2 === 0
      ? { RECDATA: [{ CampsiteID: `rv-${facilityId}`, CampsiteType: 'RV', CampsiteRVAllowed: true, CampsiteMaxOccupancy: 8, NightlyFee: 31 }] }
      : { RECDATA: [{ CampsiteID: `tent-${facilityId}`, CampsiteType: 'TENT', CampsiteTentAllowed: true, CampsiteMaxOccupancy: 6, NightlyFee: 24.5 }] };
  }
  if (url.pathname === '/api/nps/campgrounds') return { data: [] };
  if (/\/availability\/\d+\/month$/.test(url.pathname)) {
    const month = (url.searchParams.get('start_date') || '2099-01-01').slice(0, 7);
    const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    const availabilities = {};
    for (let day = 1; day <= days; day += 1) availabilities[`${month}-${String(day).padStart(2, '0')}T00:00:00Z`] = 'Available';
    return { campsites: { 'site-1': { availabilities } } };
  }
  if (url.pathname === '/api/google/reviews') return { enabled: false, source: 'fallback', reviews: [], rating: null, userRatingsTotal: null };
  if (url.pathname === '/api/media/photos') return { photos: [] };
  return { error: 'Fixture API route not found.' };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    app.emit('request', req, res);
    return;
  }
  req.resume();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(fixtureResponse(url)));
});

if (require.main === module) {
  server.listen(Number(process.env.PORT || 5502), '127.0.0.1', () => console.log('Campin fixture server ready.'));
}
module.exports = { server, fixtureResponse };

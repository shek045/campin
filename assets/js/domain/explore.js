// Explore inventory plan: four destination queries per region, mixing national parks
// with state parks, lakes, and forests so each region has broad coverage.
export const EXPLORE_PLAN = [
  { region: 'west', query: 'Yosemite National Park campground' },
  { region: 'west', query: 'Olympic National Park campground' },
  { region: 'west', query: 'Lake Tahoe campground' },
  { region: 'west', query: 'Mount Hood campground' },
  { region: 'rockies', query: 'Yellowstone National Park campground' },
  { region: 'rockies', query: 'Glacier National Park campground' },
  { region: 'rockies', query: 'Rocky Mountain National Park campground' },
  { region: 'rockies', query: 'Grand Teton campground' },
  { region: 'south', query: 'Great Smoky Mountains campground' },
  { region: 'south', query: 'Big Bend campground' },
  { region: 'south', query: 'Ozark National Forest campground' },
  { region: 'south', query: 'Shenandoah campground' },
  { region: 'midwest', query: 'Sleeping Bear Dunes campground' },
  { region: 'midwest', query: 'Boundary Waters campground' },
  { region: 'midwest', query: 'Custer State Park campground' },
  { region: 'midwest', query: 'Porcupine Mountains campground' },
  { region: 'northeast', query: 'Acadia National Park campground' },
  { region: 'northeast', query: 'Adirondacks campground' },
  { region: 'northeast', query: 'White Mountains campground' },
  { region: 'northeast', query: 'Finger Lakes campground' }
];

export const REGION_STATES = {
  west: ['WA', 'OR', 'CA', 'NV', 'AZ', 'UT', 'ID', 'MT', 'WY', 'CO', 'NM', 'AK', 'HI'],
  rockies: ['MT', 'WY', 'CO', 'ID', 'UT'],
  south: ['TX', 'OK', 'AR', 'LA', 'MS', 'AL', 'GA', 'FL', 'SC', 'NC', 'TN', 'KY', 'VA', 'WV'],
  midwest: ['ND', 'SD', 'NE', 'KS', 'MN', 'IA', 'MO', 'WI', 'IL', 'MI', 'IN', 'OH'],
  northeast: ['PA', 'NY', 'VT', 'NH', 'ME', 'MA', 'CT', 'RI', 'NJ', 'DE', 'MD']
};

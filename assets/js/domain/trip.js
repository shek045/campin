const DAY_MS = 86_400_000;

export function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateTrip({ checkIn, checkOut } = {}, today = new Date().toISOString().slice(0, 10)) {
  if (!checkIn && !checkOut) return '';
  if (!isValidIsoDate(checkIn) || !isValidIsoDate(checkOut)) return 'Choose valid check-in and check-out dates.';
  if (checkIn < today) return 'Check-in must be today or later.';
  const nights = (Date.parse(checkOut) - Date.parse(checkIn)) / DAY_MS;
  if (nights <= 0) return 'Check-out must be after check-in.';
  if (nights > 30) return 'Search up to 30 nights at a time.';
  return '';
}

export function tripNights(trip) {
  if (!trip?.checkIn && !trip?.checkOut) return [];
  if (validateTrip(trip, '0000-01-01')) return [];
  const result = [];
  for (let day = Date.parse(trip.checkIn); day < Date.parse(trip.checkOut); day += DAY_MS) {
    result.push(new Date(day).toISOString().slice(0, 10));
  }
  return result;
}

export function tripMonths(trip) {
  return [...new Set(tripNights(trip).map(day => `${day.slice(0, 7)}-01T00:00:00.000Z`))];
}

export function stayFromQueryText(queryText, now = new Date()) {
  const text = String(queryText || '');
  const explicitDates = text.match(/\b\d{4}-\d{2}-\d{2}\b/g);
  if (explicitDates?.length === 2) return { checkIn: explicitDates[0], checkOut: explicitDates[1] };
  const relative = text.match(/\b(this|next) weekend\b/i)?.[0];
  if (relative) return weekendTrip(relative, now);
  return null;
}

export function weekendTrip(selection, now = new Date()) {
  if (!/^(this|next) weekend$/i.test(selection)) return { checkIn: null, checkOut: null };
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  // On Saturday/Sunday, "this weekend" starts today. Otherwise it starts Friday.
  const day = date.getUTCDay();
  const offset = day === 6 || day === 0 ? 0 : (5 - day + 7) % 7;
  date.setUTCDate(date.getUTCDate() + offset + (/^next/i.test(selection) ? (day === 0 ? 5 : day === 6 ? 6 : 7) : 0));
  const checkIn = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + (day === 0 && /^this/i.test(selection) ? 1 : day === 6 && /^this/i.test(selection) ? 1 : 2));
  return { checkIn, checkOut: date.toISOString().slice(0, 10) };
}

export function summarizeAvailability(payloads, trip, checkedAt = new Date().toISOString()) {
  const nights = tripNights(trip);
  if (!nights.length) return { state: 'not_checked', count: null, checkedAt: null };
  if (!Array.isArray(payloads) || payloads.length !== tripMonths(trip).length ||
      payloads.some(payload => !payload?.campsites || typeof payload.campsites !== 'object' || Array.isArray(payload.campsites))) {
    return { state: 'unknown', count: null, checkedAt };
  }
  const siteIds = new Set(payloads.flatMap(payload => Object.keys(payload.campsites)));
  let count = 0;
  let incomplete = false;
  for (const id of siteIds) {
    const days = {};
    for (const payload of payloads) {
      for (const [date, status] of Object.entries(payload.campsites[id]?.availabilities || {})) {
        days[date.slice(0, 10)] = status;
      }
    }
    if (nights.every(day => days[day] === 'Available')) count += 1;
    else if (nights.some(day => !days[day])) incomplete = true;
  }
  return {
    state: count > 0 ? 'available' : (incomplete || !siteIds.size ? 'unknown' : 'unavailable'),
    count: count > 0 || (!incomplete && siteIds.size) ? count : null,
    checkedAt
  };
}

export function availabilityLabel(camp) {
  if (camp?.isDemo) return 'Demo listing, not live inventory';
  const availability = camp?.availability;
  if (!availability || availability.state === 'not_checked') return 'Choose dates to check availability';
  if (availability.state === 'checking') return 'Checking availability for the full stay…';
  if (availability.state === 'unknown') return 'Availability could not be verified';
  const dates = camp.availabilityTrip ? ` (${camp.availabilityTrip.checkIn} to ${camp.availabilityTrip.checkOut})` : '';
  return availability.state === 'available'
    ? `${availability.count} site${availability.count === 1 ? '' : 's'} available for the full stay${dates}`
    : `No sites available for the full stay${dates}`;
}

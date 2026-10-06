export function calculateBookingBreakdown(nightlyPrice, nights, guestCount) {
  const safeNightly = nightlyPrice !== null && nightlyPrice !== undefined && nightlyPrice !== '' &&
    Number.isFinite(Number(nightlyPrice)) && Number(nightlyPrice) >= 0
    ? Number(nightlyPrice)
    : null;
  const safeNights = Math.max(1, Number.isFinite(Number(nights)) ? Math.round(Number(nights)) : 1);
  const safeGuests = Math.max(1, Number.isFinite(Number(guestCount)) ? Math.round(Number(guestCount)) : 1);

  const nightsSubtotal = safeNightly === null ? null : Math.round(safeNightly * safeNights * 100) / 100;

  return {
    nightly: safeNightly,
    nights: safeNights,
    guests: safeGuests,
    guestExtraFee: null,
    parkFee: null,
    nightsSubtotal,
    total: nightsSubtotal
  };
}

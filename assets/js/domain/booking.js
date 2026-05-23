export function calculateBookingBreakdown(nightlyPrice, nights, guestCount) {
  const safeNightly = Number.isFinite(Number(nightlyPrice)) && Number(nightlyPrice) > 0
    ? Math.round(Number(nightlyPrice))
    : 0;
  const safeNights = Math.max(1, Number.isFinite(Number(nights)) ? Math.round(Number(nights)) : 1);
  const safeGuests = Math.max(1, Number.isFinite(Number(guestCount)) ? Math.round(Number(guestCount)) : 1);

  const guestExtraFee = Math.max(0, safeGuests - 2) * 2;
  const parkFee = 5 + guestExtraFee;
  const nightsSubtotal = safeNightly * safeNights;
  const total = nightsSubtotal + parkFee;

  return {
    nightly: safeNightly,
    nights: safeNights,
    guests: safeGuests,
    guestExtraFee,
    parkFee,
    nightsSubtotal,
    total
  };
}

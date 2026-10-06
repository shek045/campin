import { knownNumber, safeHttpUrl } from '../domain/listings.js';
import { availabilityLabel } from '../domain/trip.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function message(grid, text, retry) {
  const element = document.createElement('div');
  element.className = 'results-message';
  element.textContent = text;
  if (retry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'retry-search';
    button.textContent = 'Retry search';
    button.addEventListener('click', retry);
    element.appendChild(button);
  }
  grid.appendChild(element);
}

export function createResultCardElement(card, onOpenDetail, savedListings) {
  const price = knownNumber(card.price);
  const rating = knownNumber(card.rating);
  const reviews = knownNumber(card.reviews);
  const cardEl = document.createElement('article');
  cardEl.className = 'camp-card';
  const image = safeHttpUrl(card.imageUrl);
  const priceText = price === null ? 'Price unavailable' : `From $${price}`;
  const ratingText = rating === null ? 'Rating unavailable' : `${rating}${reviews === null ? '' : ` (${reviews} reviews)`}${card.isDemo ? ' · Demo' : ''}`;
  const requirements = card.missingRequirements || [];
  cardEl.innerHTML = `
    <div class="camp-img-placeholder">
      ${image ? `<img class="camp-img" src="${escapeHtml(image)}" alt="${escapeHtml(card.name)}" loading="lazy" referrerpolicy="no-referrer">` : ''}
      <span class="camp-fallback-emoji" aria-hidden="true"${image ? ' hidden' : ''}>${escapeHtml(card.renderEmoji || card.emoji || '🏕️')}</span>
      <div class="camp-badge">${card.isDemo ? 'Demo listing' : 'Provider listing'}</div>
      <button type="button" class="camp-wishlist" aria-label="Save ${escapeHtml(card.name)}" aria-pressed="false">♡</button>
    </div>
    <div class="camp-body">
      <div class="camp-type">${escapeHtml(card.type)}</div>
      <h2 class="camp-name"><button type="button" class="camp-open">${escapeHtml(card.name)}</button></h2>
      <div class="camp-location">${escapeHtml(card.loc)}${Number.isFinite(card.distanceKm) ? ` · ${escapeHtml(card.distanceLabel || `${Math.round(card.distanceKm)} km away`)}` : ''}</div>
      <p class="camp-availability">${escapeHtml(availabilityLabel(card))}</p>
      ${requirements.length ? `<p class="camp-requirements">Unmet or unverified: ${escapeHtml(requirements.join('; '))}</p>` : ''}
      <div class="camp-tags">${(card.tags || []).slice(0, 5).map(tag => `<span class="camp-tag">${escapeHtml(tag)}</span>`).join('')}</div>
      <div class="camp-footer">
        <div class="camp-price"><span class="price">${priceText}</span>${price === null ? '' : '<span class="per"> / night</span>'}</div>
        <div class="camp-rating">${escapeHtml(ratingText)}</div>
      </div>
    </div>`;
  const imageElement = cardEl.querySelector('img');
  imageElement?.addEventListener('error', () => {
    imageElement.hidden = true;
    cardEl.querySelector('.camp-fallback-emoji').hidden = false;
  });
  const save = cardEl.querySelector('.camp-wishlist');
  const syncSave = () => {
    const selected = savedListings?.has(card.id) || false;
    save.setAttribute('aria-pressed', String(selected));
    save.setAttribute('aria-label', `${selected ? 'Unsave' : 'Save'} ${card.name}`);
    save.textContent = selected ? '♥' : '♡';
  };
  syncSave();
  save.addEventListener('click', event => {
    event.stopPropagation();
    savedListings?.toggle(card.id);
    syncSave();
  });
  cardEl.addEventListener('click', event => {
    if (!event.target.closest('.camp-wishlist')) onOpenDetail(card);
  });
  return cardEl;
}

export function renderResultsView({
  grid, countEl, aiTextEl, isLoading, inventorySourceText, pendingClarification,
  campsites, cardsForRender, onOpenDetail, savedListings, searchError, onRetry, savedOnly = false
}) {
  if (!grid || !countEl) return;
  grid.replaceChildren();
  grid.setAttribute('aria-busy', String(isLoading));
  if (isLoading) {
    countEl.textContent = 'Searching provider listings…';
    if (aiTextEl) aiTextEl.textContent = 'Checking your trip requirements and selected dates.';
    message(grid, 'Searching live sources. Results will appear here.');
    return;
  }
  countEl.textContent = `${campsites.length} campground listings found`;
  if (aiTextEl) aiTextEl.textContent = `${inventorySourceText}. Campground-level matches do not guarantee an eligible campsite. Confirm site suitability, rates, and availability with the provider.`;
  if (pendingClarification) {
    message(grid, 'Add the missing trip details in the conversation to continue.');
    return;
  }
  if (searchError) message(grid, searchError, onRetry);
  const cards = cardsForRender.filter(card => !savedOnly || savedListings.has(card.id));
  if (!cards.length) {
    if (!searchError) message(grid, savedOnly ? 'No saved listings in these results. Save a campground with its heart button.' : 'No campground listings found. Try another location or broaden your search.');
    return;
  }
  for (const [group, label] of [['exact', 'Verified campground requirements'], ['near', 'Alternatives, requirements unmet or unverified']]) {
    const items = cards.filter(card => (card.matchGroup || 'near') === group);
    if (!items.length) continue;
    const heading = document.createElement('h2');
    heading.className = 'result-group-title';
    heading.textContent = label;
    grid.appendChild(heading);
    items.forEach(card => grid.appendChild(createResultCardElement(card, onOpenDetail, savedListings)));
  }
}

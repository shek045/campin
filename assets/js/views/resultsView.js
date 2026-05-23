function setLoadingStateView(countEl, aiTextEl, grid) {
  countEl.textContent = 'Loading live availability...';
  if (aiTextEl) {
    aiTextEl.textContent = 'Fetching live inventory from Recreation.gov + NPS...';
  }
  grid.innerHTML = '<div style="background:white; border:1px solid var(--border); border-radius:var(--radius-md); padding:1rem 1.2rem; color:var(--text-mid);">Searching live sources and scoring your best matches...</div>';
}

function setClarificationStateView(grid) {
  grid.innerHTML = '<div style="background:white; border:1px solid var(--border); border-radius:var(--radius-md); padding:1rem 1.2rem; color:var(--text-mid);">Add the missing trip details in the conversation to run a live search.</div>';
}

function setEmptyStateView(grid) {
  grid.innerHTML = '<div style="background:white; border:1px solid var(--border); border-radius:var(--radius-md); padding:1rem 1.2rem; color:var(--text-mid);">No exact matches yet. Try expanding your area or removing one filter and we will surface the closest great options.</div>';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch (error) {
    return '';
  }

  return '';
}

function sanitizeBackgroundColor(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '#F5F3EE';
  }

  const isHex = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw);
  const isRgb = /^rgba?\(\s*\d{1,3}(\s*,\s*\d{1,3}){2}(\s*,\s*(0|1|0?\.\d+))?\s*\)$/.test(raw);
  return (isHex || isRgb) ? raw : '#F5F3EE';
}

function createResultCardElement(card, getMatchPercent, onOpenDetail) {
  const matchPercent = Number(getMatchPercent(card));
  const safeName = escapeHtml(card.name);
  const safeType = escapeHtml(card.type);
  const safeLocation = escapeHtml(card.loc);
  const safeBadge = escapeHtml(card.badge);
  const safeEmoji = escapeHtml(card.renderEmoji);
  const safeImageUrl = sanitizeImageUrl(card.imageUrl);
  const safeBg = sanitizeBackgroundColor(card.renderBg);
  const safePrice = Number.isFinite(Number(card.price)) ? Number(card.price) : 0;
  const safeRating = Number.isFinite(Number(card.rating)) ? Number(card.rating) : 0;
  const safeReviews = Number.isFinite(Number(card.reviews)) ? Math.round(Number(card.reviews)) : 0;
  const safeTags = Array.isArray(card.tags)
    ? card.tags.map(tag => `<span class="camp-tag">${escapeHtml(tag)}</span>`).join('')
    : '';

  const cardEl = document.createElement('div');
  cardEl.className = 'camp-card';
  cardEl.innerHTML = `
    <div class="camp-img-placeholder" style="background:${safeBg}">
      ${safeImageUrl ? `<img class="camp-img" src="${safeImageUrl}" alt="${safeName}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'; const f=this.parentElement.querySelector('.camp-fallback-emoji'); if (f) f.style.display='inline';">` : ''}
      <span class="camp-fallback-emoji" style="font-size:3.5rem; ${safeImageUrl ? 'display:none;' : ''}">${safeEmoji}</span>
      ${safeBadge ? `<div class="camp-badge">${safeBadge}</div>` : ''}
      <button class="camp-wishlist" onclick="event.stopPropagation(); this.textContent = this.textContent === '♡' ? '♥' : '♡'; this.style.color = this.textContent === '♥' ? '#C4622D' : ''" title="Save to wishlist">♡</button>
    </div>
    <div class="camp-body">
      <div class="camp-type">${safeType}</div>
      <div class="camp-name">${safeName}</div>
      <div class="camp-location">📍 ${safeLocation}</div>
      ${Number.isFinite(matchPercent) ? `<div class="camp-match"><span class="camp-match-label">Match</span><span class="camp-match-value">${Math.round(matchPercent)}%</span></div>` : ''}
      <div class="camp-tags">${safeTags}</div>
      <div class="camp-footer">
        <div class="camp-price"><span class="price">$${safePrice}</span><span class="per"> / night</span></div>
        <div class="camp-rating"><span class="star">★</span><span class="score">${safeRating}</span><span class="count"> (${safeReviews})</span></div>
      </div>
    </div>`;

  cardEl.onclick = () => onOpenDetail(card);
  return cardEl;
}

export function renderResultsView({
  grid,
  countEl,
  aiTextEl,
  isLoading,
  inventorySourceText,
  pendingClarification,
  campsites,
  cardsForRender,
  getMatchPercent,
  onOpenDetail
}) {
  if (!grid || !countEl) {
    return;
  }

  grid.innerHTML = '';

  if (isLoading) {
    setLoadingStateView(countEl, aiTextEl, grid);
    return;
  }

  countEl.textContent = `${campsites.length} campsites found`;
  if (aiTextEl) {
    aiTextEl.textContent = `Source: ${inventorySourceText}. We prioritized campgrounds that match your location, trip style, and must-have amenities.`;
  }

  if (pendingClarification || inventorySourceText === 'Waiting for required trip details') {
    setClarificationStateView(grid);
    return;
  }

  if (campsites.length === 0) {
    setEmptyStateView(grid);
    return;
  }

  cardsForRender.forEach(card => {
    grid.appendChild(createResultCardElement(card, getMatchPercent, onOpenDetail));
  });
}

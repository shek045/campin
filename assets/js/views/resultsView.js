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

function createResultCardElement(card, getMatchPercent, onOpenDetail) {
  const matchPercent = getMatchPercent(card);
  const cardEl = document.createElement('div');
  cardEl.className = 'camp-card';
  cardEl.innerHTML = `
    <div class="camp-img-placeholder" style="background:${card.renderBg}">
      ${card.imageUrl ? `<img class="camp-img" src="${card.imageUrl}" alt="${card.name}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'; const f=this.parentElement.querySelector('.camp-fallback-emoji'); if (f) f.style.display='inline';">` : ''}
      <span class="camp-fallback-emoji" style="font-size:3.5rem; ${card.imageUrl ? 'display:none;' : ''}">${card.renderEmoji}</span>
      ${card.badge ? `<div class="camp-badge">${card.badge}</div>` : ''}
      <button class="camp-wishlist" onclick="event.stopPropagation(); this.textContent = this.textContent === '♡' ? '♥' : '♡'; this.style.color = this.textContent === '♥' ? '#C4622D' : ''" title="Save to wishlist">♡</button>
    </div>
    <div class="camp-body">
      <div class="camp-type">${card.type}</div>
      <div class="camp-name">${card.name}</div>
      <div class="camp-location">📍 ${card.loc}</div>
      ${matchPercent !== null ? `<div class="camp-match"><span class="camp-match-label">Match</span><span class="camp-match-value">${matchPercent}%</span></div>` : ''}
      <div class="camp-tags">${card.tags.map(tag => `<span class="camp-tag">${tag}</span>`).join('')}</div>
      <div class="camp-footer">
        <div class="camp-price"><span class="price">$${card.price}</span><span class="per"> / night</span></div>
        <div class="camp-rating"><span class="star">★</span><span class="score">${card.rating}</span><span class="count"> (${card.reviews})</span></div>
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

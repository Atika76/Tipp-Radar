const state = { data: null, filtered: [] };

const el = (id) => document.getElementById(id);
const fmtPct = (n) => Number.isFinite(Number(n)) ? `${Number(n).toFixed(1)}%` : '—';
const fmtOdds = (n) => Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n).toFixed(2) : '—';
const fmtKickoff = (iso) => {
  if (!iso) return 'Időpont nem ismert';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('hu-HU', { weekday:'short', hour:'2-digit', minute:'2-digit', timeZone:'Europe/Budapest' }).format(d);
};

async function api(path) {
  const res = await fetch(path, { headers: { 'Accept':'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}

async function loadHealth() {
  try {
    const h = await api('/.netlify/functions/health');
    const badge = el('modeBadge');
    if (h.apiConfigured && h.supabaseConfigured) {
      badge.textContent = '● ÉLES • API + SUPABASE';
      badge.className = 'badge badge-green';
    } else if (h.apiConfigured) {
      badge.textContent = '● ÉLES • SUPABASE NÉLKÜL';
      badge.className = 'badge badge-yellow';
    } else {
      badge.textContent = '● DEMÓ • API KULCS KELL';
      badge.className = 'badge badge-red';
    }
  } catch {
    const badge = el('modeBadge');
    badge.textContent = '● HIBA A BEÁLLÍTÁSBAN';
    badge.className = 'badge badge-red';
  }
}

async function loadToday() {
  const btn = el('refreshBtn');
  btn.disabled = true;
  btn.textContent = 'Elemzés betöltése…';
  try {
    const data = await api('/.netlify/functions/today');
    state.data = data;
    renderSummary(data);
    applyFilters();
    if (data.demo) showMessage('Ez most DEMÓ adat. Amint beállítjuk az API_FOOTBALL_KEY környezeti változót a Netlify-ban, automatikusan valódi mai meccsek jelennek meg.');
    else if (!data.persistence) showMessage('A focis API működik, de a Supabase még nincs beállítva. Emiatt az eredmények és a korábbi tippek még nem kerülnek tartósan mentésre.');
    else hideMessage();
  } catch (err) {
    showMessage(`Nem sikerült betölteni a mai elemzést: ${err.message}`);
    el('picksGrid').innerHTML = `<article class="card empty"><h3>Betöltési hiba</h3><p class="muted">${escapeHtml(err.message)}</p></article>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Mai elemzés frissítése';
  }
}

async function loadPerformance() {
  try {
    const p = await api('/.netlify/functions/performance');
    const items = [
      ['Eltárolt tippek', p.total ?? 0],
      ['Találati arány', p.hitRate != null ? fmtPct(p.hitRate) : '—'],
      ['ROI', p.roi != null ? fmtPct(p.roi) : '—'],
      ['Egység profit', p.profit != null ? Number(p.profit).toFixed(2) : '—']
    ];
    el('performance').innerHTML = items.map(([a,b]) => `<div class="performance-item"><span>${a}</span><strong>${b}</strong></div>`).join('');
  } catch {
    el('performance').innerHTML = '<div class="performance-item"><span>Állapot</span><strong>Még nincs adat</strong></div>';
  }
}

function renderSummary(data) {
  el('todayTitle').textContent = `${data.date || 'Mai'} – napi elemzés`;
  el('generatedAt').textContent = data.generatedAt ? `Készült: ${new Intl.DateTimeFormat('hu-HU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Budapest'}).format(new Date(data.generatedAt))}` : '';
  const picks = data.picks || [];
  const green = picks.filter(x => x.rating === 'green').length;
  const yellow = picks.filter(x => x.rating === 'yellow').length;
  const red = picks.filter(x => x.rating === 'red').length;
  const stats = [
    ['Mai összes meccs', data.totalFixtures ?? picks.length],
    ['Részletesen elemzett', picks.length],
    ['🟢 Megfontolható', green],
    ['🔴 Kihagyás', red + (yellow ? 0 : 0)]
  ];
  el('summaryStats').innerHTML = stats.map(([a,b]) => `<div class="stat"><span>${a}</span><strong>${b}</strong></div>`).join('');
}

function applyFilters() {
  const q = el('searchInput').value.trim().toLowerCase();
  const rating = el('ratingFilter').value;
  const sort = el('sortSelect').value;
  let picks = [...(state.data?.picks || [])];
  if (q) picks = picks.filter(p => `${p.home} ${p.away} ${p.league}`.toLowerCase().includes(q));
  if (rating !== 'all') picks = picks.filter(p => p.rating === rating);
  picks.sort((a,b) => {
    if (sort === 'probability') return (b.probability || 0) - (a.probability || 0);
    if (sort === 'kickoff') return new Date(a.kickoff || 0) - new Date(b.kickoff || 0);
    return (b.edge || -999) - (a.edge || -999);
  });
  state.filtered = picks;
  renderPicks(picks);
}

function renderPicks(picks) {
  const grid = el('picksGrid');
  el('resultCount').textContent = `${picks.length} meccs`;
  grid.innerHTML = '';
  if (!picks.length) {
    grid.innerHTML = '<article class="card empty"><h3>Nincs találat</h3><p class="muted">A mostani szűréshez nincs megjeleníthető meccs.</p></article>';
    return;
  }
  const tpl = el('pickTemplate');
  for (const p of picks) {
    const node = tpl.content.cloneNode(true);
    const card = node.querySelector('.pick-card');
    node.querySelector('.league').textContent = `${p.country ? p.country + ' • ' : ''}${p.league || 'Ismeretlen bajnokság'}`;
    node.querySelector('.fixture').textContent = `${p.home} – ${p.away}`;
    node.querySelector('.kickoff').textContent = fmtKickoff(p.kickoff);
    const rb = node.querySelector('.rating-badge');
    const label = p.rating === 'green' ? '🟢 Megfontolható' : p.rating === 'yellow' ? '🟡 Óvatos' : '🔴 Kihagyás';
    rb.textContent = label;
    rb.classList.add(p.rating === 'green' ? 'badge-green' : p.rating === 'yellow' ? 'badge-yellow' : 'badge-red');
    node.querySelector('.recommendation').textContent = p.recommendation || 'Kihagyás';
    node.querySelector('.market-odds').textContent = p.marketOdds ? `@ ${fmtOdds(p.marketOdds)}` : 'nincs odds';
    node.querySelector('.probability').textContent = fmtPct(p.probability);
    node.querySelector('.fair-odds').textContent = fmtOdds(p.fairOdds);
    node.querySelector('.odds').textContent = fmtOdds(p.marketOdds);
    const edge = Number(p.edge);
    node.querySelector('.edge').textContent = Number.isFinite(edge) ? `${edge >= 0 ? '+' : ''}${edge.toFixed(1)}%` : '—';
    node.querySelector('.probability-bar span').style.width = `${Math.max(0,Math.min(100,Number(p.probability)||0))}%`;
    const probs = p.probabilities || {};
    node.querySelector('.triple-prob').textContent = `1: ${fmtPct(probs.home)}   •   X: ${fmtPct(probs.draw)}   •   2: ${fmtPct(probs.away)}`;
    const reasons = node.querySelector('.reasons');
    (p.reasons?.length ? p.reasons : ['Nincs elég részletes indoklás.']).forEach(r => {
      const li = document.createElement('li'); li.textContent = r; reasons.appendChild(li);
    });
    node.querySelector('.injuries').textContent = `${p.injuries?.home ?? 0} / ${p.injuries?.away ?? 0}`;
    node.querySelector('.api-advice').textContent = p.apiAdvice || '—';
    node.querySelector('.coverage').textContent = p.coverage || 'Közepes';
    card.dataset.rating = p.rating;
    grid.appendChild(node);
  }
}

function showMessage(text) { const n=el('systemMessage'); n.textContent=text; n.classList.remove('hidden'); }
function hideMessage() { el('systemMessage').classList.add('hidden'); }
function escapeHtml(str) { return String(str).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c])); }

el('refreshBtn').addEventListener('click', loadToday);
el('searchInput').addEventListener('input', applyFilters);
el('ratingFilter').addEventListener('change', applyFilters);
el('sortSelect').addEventListener('change', applyFilters);

loadHealth();
loadToday();
loadPerformance();

/* Wales Trail Atlas — day stages (v0.4). No tracking and no third-party API. */
(() => {
  'use strict';
  const atlas = window.WalesAtlas;
  if (!atlas) return;

  const STORE_KEY = 'wales-atlas-stages-v1';
  const EARTH = 111195;
  const $ = id => document.getElementById(id);
  const ns = 'http://www.w3.org/2000/svg';
  let map = null;
  let path = null;
  let plan = null;
  let signature = '';
  let selectedDay = -1;
  let editBoundary = -1;
  let stageMarkers = [];
  let lastPublishedPlan = null;

  const node = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const btn = (label, handler, cls = 'secondary') => {
    const e = node('button', cls, label);
    e.type = 'button';
    e.addEventListener('click', handler);
    return e;
  };
  const formatKm = m => (m / 1000).toFixed(1).replace('.', ',') + ' км';
  const duration = m => {
    const n = Math.round(m / 3800 * 60);
    return n >= 60 ? Math.floor(n / 60) + ' ч ' + (n % 60) + ' мин' : n + ' мин';
  };
  const copy = a => [a[0], a[1], a[2] == null ? null : a[2]];
  function interpolate(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
      Number.isFinite(a[2]) && Number.isFinite(b[2]) ? a[2] + (b[2] - a[2]) * t : null];
  }
  function geoDistance(a, b) {
    const rad = Math.PI / 180;
    const dy = (b[1] - a[1]) * rad;
    const dx = (b[0] - a[0]) * rad;
    const q = Math.sin(dy / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dx / 2) ** 2;
    return 12742000 * Math.atan2(Math.sqrt(q), Math.sqrt(Math.max(0, 1 - q)));
  }

  function buildPath(segments) {
    const edges = [];
    let total = 0;
    segments.forEach((seg, group) => {
      for (let i = 1; i < seg.length; i++) {
        const a = seg[i - 1], b = seg[i];
        const size = geoDistance(a, b);
        if (!Number.isFinite(size) || size < 0.01) continue;
        edges.push({ a, b, group, from: total, to: total + size });
        total += size;
      }
    });
    return { edges, total };
  }

  function projectToPath(ll) {
    if (!path) return null;
    const xScale = EARTH * Math.cos(ll[1] * Math.PI / 180);
    let best = null;
    path.edges.forEach(edge => {
      const x = (edge.b[0] - edge.a[0]) * xScale, y = (edge.b[1] - edge.a[1]) * EARTH;
      const px = (ll[0] - edge.a[0]) * xScale, py = (ll[1] - edge.a[1]) * EARTH;
      const t = Math.min(1, Math.max(0, (px * x + py * y) / (x * x + y * y || 1)));
      const gap = Math.hypot(px - x * t, py - y * t);
      if (!best || gap < best.gap) best = { at: edge.from + (edge.to - edge.from) * t, gap };
    });
    return best;
  }
  function atDistance(m) {
    if (!path || !path.edges.length) return null;
    const target = Math.min(path.total, Math.max(0, m));
    const edge = path.edges.find(e => e.to >= target) || path.edges[path.edges.length - 1];
    return interpolate(edge.a, edge.b, Math.min(1, Math.max(0, (target - edge.from) / (edge.to - edge.from))));
  }
  function slice(from, to) {
    if (!path || to <= from) return [];
    const lines = [];
    let current = [], lastGroup = -1;
    for (const edge of path.edges) {
      if (edge.to < from || edge.from > to) continue;
      const lo = Math.max(from, edge.from), hi = Math.min(to, edge.to);
      if (hi <= lo) continue;
      if (edge.group !== lastGroup && current.length) { if (current.length >= 2) lines.push(current); current = []; }
      const a = interpolate(edge.a, edge.b, (lo - edge.from) / (edge.to - edge.from));
      const b = interpolate(edge.a, edge.b, (hi - edge.from) / (edge.to - edge.from));
      if (!current.length || geoDistance(current[current.length - 1], a) > 0.03) current.push(a);
      current.push(b);
      lastGroup = edge.group;
    }
    if (current.length >= 2) lines.push(current);
    return lines;
  }
  function summary(from, to) {
    const lines = slice(from, to);
    let ascent = 0, descent = 0, elevations = [];
    for (const line of lines) {
      for (let i = 0; i < line.length; i++) {
        if (Number.isFinite(line[i][2])) elevations.push(line[i][2]);
        if (i === 0 || !Number.isFinite(line[i][2]) || !Number.isFinite(line[i - 1][2])) continue;
        const difference = line[i][2] - line[i - 1][2];
        if (difference > 2) ascent += difference;
        if (difference < -2) descent -= difference;
      }
    }
    return { from, to, metres: to - from, ascent, descent, elevations, lines };
  }
  function keyForTrack(segments) {
    const first = segments[0]?.[0], lastSeg = segments[segments.length - 1];
    const last = lastSeg?.[lastSeg.length - 1];
    return [segments.length, segments.reduce((n, s) => n + s.length, 0),
      first?.[0], first?.[1], last?.[0], last?.[1]].join(':');
  }
  function preferredBounds() {
    const places = atlas.getPoints();
    const find = name => places.find(p => p.title.toLowerCase().includes(name));
    const startP = find('chepstow'), endP = find('hay-on-wye');
    const start = startP && projectToPath([Number(startP.lng), Number(startP.lat)]);
    const end = endP && projectToPath([Number(endP.lng), Number(endP.lat)]);
    // Never claim to use a named point on a trail if it is many kilometres away.
    if (start && end && start.gap < 3000 && end.gap < 3000 && end.at - start.at > 3000) {
      return { start: start.at, end: end.at, scoped: true };
    }
    return { start: 0, end: path.total, scoped: false };
  }
  function validPlan(p, s) {
    return Boolean(p && p.signature === s && Number.isFinite(p.start) && Number.isFinite(p.end) &&
      p.end > p.start && p.end <= path.total + 10 && p.start >= 0 &&
      Array.isArray(p.fractions) && p.fractions.length >= 3 && p.fractions.length <= 16 &&
      p.fractions[0] === 0 && p.fractions[p.fractions.length - 1] === 1 &&
      p.fractions.every((v, i) => Number.isFinite(v) && v >= 0 && v <= 1 &&
        (i === 0 || v > p.fractions[i - 1])));
  }
  function readPlan() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch (_) { return null; }
  }
  function savePlan() {
    if (!plan) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(plan)); }
    catch (_) { atlas.toast('Невозможно сохранить этапы: браузерное хранилище переполнено.'); }
  }
  function initialPlan() {
    const bounds = preferredBounds(), count = 6;
    return { signature, start: bounds.start, end: bounds.end, scoped: bounds.scoped,
      fractions: Array.from({ length: count + 1 }, (_, i) => i / count) };
  }
  function dayRange(i) {
    const length = plan.end - plan.start;
    return [plan.start + length * plan.fractions[i], plan.start + length * plan.fractions[i + 1]];
  }
  const daysCount = () => plan ? plan.fractions.length - 1 : 0;

  function setGeoSource(id, lines) {
    if (!map?.getSource(id)) return;
    map.getSource(id).setData({ type: 'FeatureCollection',
      features: lines.map(line => ({ type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: line.map(p => p.slice(0, 2)) } })) });
  }
  function prepareLayers() {
    if (!map || !map.isStyleLoaded() || map.getSource('trip-section')) return;
    for (const id of ['trip-section', 'trip-day']) {
      map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    map.addLayer({ id: 'trip-section-outline', type: 'line', source: 'trip-section',
      paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.8 } });
    map.addLayer({ id: 'trip-section-line', type: 'line', source: 'trip-section',
      paint: { 'line-color': '#23634f', 'line-width': 4, 'line-opacity': 0.95 } });
    map.addLayer({ id: 'trip-day-outline', type: 'line', source: 'trip-day',
      paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.85 } });
    map.addLayer({ id: 'trip-day-line', type: 'line', source: 'trip-day',
      paint: { 'line-color': '#d46e49', 'line-width': 5 } });
    // The original, possibly much longer GPX remains visible in the background.
    if (map.getLayer('track-line')) {
      map.setPaintProperty('track-line', 'line-color', '#718e84');
      map.setPaintProperty('track-line', 'line-opacity', 0.35);
      map.setPaintProperty('track-line', 'line-width', 2);
    }
    if (map.getLayer('track-outline')) map.setPaintProperty('track-outline', 'line-width', 0);
  }
  function clearMarkers() {
    stageMarkers.forEach(marker => marker.remove());
    stageMarkers = [];
  }
  function renderMarkers() {
    clearMarkers();
    if (!map || !plan || !path) return;
    for (let i = 1; i < plan.fractions.length - 1; i++) {
      const loc = atDistance(dayRange(i - 1)[1]);
      if (!loc) continue;
      const button = btn(String(i), () => openDay(i - 1), 'trip-stop');
      button.title = 'Конец дня ' + i + ' (план, не подтверждённая ночёвка)';
      button.setAttribute('aria-label', button.title);
      stageMarkers.push(new maplibregl.Marker({ element: button, anchor: 'center' })
        .setLngLat([loc[0], loc[1]]).addTo(map));
    }
  }
  function redraw() {
    if (!map || !path || !plan) return;
    prepareLayers();
    setGeoSource('trip-section', slice(plan.start, plan.end));
    setGeoSource('trip-day', selectedDay >= 0 && selectedDay < daysCount()
      ? slice(...dayRange(selectedDay)) : []);
    renderMarkers();
    const fab = $('trip-current');
    if (fab) {
      fab.hidden = selectedDay < 0;
      fab.textContent = selectedDay >= 0 ? 'День ' + (selectedDay + 1) + ' · открыть' : '';
    }
    const counter = $('stage-count');
    if (counter) counter.textContent = String(daysCount());
  }
  function recalculate() {
    const segs = atlas.getSegments();
    if (!segs.length) {
      path = null; plan = null; selectedDay = -1; clearMarkers();
      setGeoSource('trip-section', []);
      setGeoSource('trip-day', []);
      if ($('stage-count')) $('stage-count').textContent = '—';
      if ($('trip-current')) $('trip-current').hidden = true;
      return;
    }
    path = buildPath(segs);
    if (path.total < 10) return;
    signature = keyForTrack(segs);
    const saved = readPlan();
    plan = validPlan(saved, signature) ? saved : initialPlan();
    if (!validPlan(saved, signature) && validPlan(lastPublishedPlan, signature)) plan = lastPublishedPlan;
    if (selectedDay >= daysCount()) selectedDay = -1;
    redraw();
  }
  function fitSection(from, to) {
    if (!map || !path) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const line of slice(from, to)) for (const p of line) bounds.extend([p[0], p[1]]);
    if (bounds.isEmpty()) return;
    const narrow = window.innerWidth <= 650;
    map.fitBounds(bounds, { padding: { top: 90, bottom: narrow ? 210 : 80, left: 65, right: 65 },
      maxZoom: 14, duration: 500 });
  }
  function svgProfile(lines, width = 320, height = 110) {
    const profile = node('div', 'trip-profile');
    const samples = [];
    let along = 0;
    for (const line of lines) {
      for (let i = 0; i < line.length; i++) {
        if (i > 0) along += geoDistance(line[i - 1], line[i]);
        const elev = line[i][2];
        if (Number.isFinite(elev)) samples.push({ height: elev, along });
      }
    }
    if (samples.length < 2) {
      profile.append(node('p', 'help', 'В GPX нет данных о высоте для этого этапа.'));
      return profile;
    }
    const min = Math.floor(samples.reduce((low, s) => Math.min(low, s.height), Infinity) / 25) * 25;
    const max = Math.ceil(samples.reduce((high, s) => Math.max(high, s.height), -Infinity) / 25) * 25 || 1;
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Профиль высот: от ' + min + ' до ' + max + ' метров');
    const step = Math.max(1, Math.ceil(samples.length / 160));
    const coords = samples.filter((_, i) => i % step === 0);
    if (coords[coords.length - 1] !== samples[samples.length - 1]) coords.push(samples[samples.length - 1]);
    const p = coords.map(v => {
      const x = 5 + (v.along - samples[0].along) / Math.max(1, along - samples[0].along) * (width - 10);
      const y = 9 + (max - v.height) / Math.max(1, max - min) * (height - 25);
      return [x, y];
    });
    const area = document.createElementNS(ns, 'path');
    area.setAttribute('d', 'M' + p[0][0] + ' ' + (height - 12) + ' L' +
      p.map(x => x[0] + ' ' + x[1]).join(' L') + ' L' + p[p.length - 1][0] + ' ' + (height - 12) + ' Z');
    area.setAttribute('fill', 'rgba(35,99,79,.13)');
    const trace = document.createElementNS(ns, 'path');
    trace.setAttribute('d', 'M' + p.map(x => x[0] + ' ' + x[1]).join(' L'));
    trace.setAttribute('fill', 'none');
    trace.setAttribute('stroke', '#23634f');
    trace.setAttribute('stroke-width', '2.6');
    trace.setAttribute('stroke-linecap', 'round');
    trace.setAttribute('stroke-linejoin', 'round');
    svg.append(area, trace);
    profile.append(svg, node('div', 'trip-profile-legend', min + ' м — ' + max + ' м · профиль из GPX'));
    return profile;
  }
  function detailMetrics(data) {
    const grid = node('div', 'trip-metrics');
    for (const [value, title] of [
      [formatKm(data.metres), 'По треку'],
      ['+' + Math.round(data.ascent) + ' м', 'Набор высоты'],
      ['−' + Math.round(data.descent) + ' м', 'Спуск'],
      [duration(data.metres + data.ascent * 3800 / 600), 'Время ходьбы ≈']
    ]) {
      const item = node('div');
      item.append(node('strong', '', value), node('small', '', title));
      grid.append(item);
    }
    return grid;
  }
  function openOverview() {
    if (!plan || !path) { atlas.toast('Сначала загрузи GPX-маршрут.'); return; }
    const body = atlas.showSheet('Этапы похода · ' + daysCount());
    body.append(node('p', 'trip-lead', (plan.scoped
      ? 'Chepstow → Hay-on-Wye · ' : 'Весь импортированный GPX · ')
      + formatKm(plan.end - plan.start)));
    body.append(node('p', 'help', 'Черновик: дни разделены по расстоянию вдоль GPX. Маркеры границ — не подтверждённые места ночёвок. Время без остановок, переходов к жилью и отклонений от тропы.'));
    const tools = node('div', 'button-row');
    tools.append(btn('Показать участок', () => {
      selectedDay = -1; redraw(); atlas.closeSheet(); fitSection(plan.start, plan.end);
    }));
    tools.append(btn('Изменить число дней', showCountEditor));
    body.append(tools);
    const list = node('div', 'trip-days');
    for (let i = 0; i < daysCount(); i++) {
      const [from, to] = dayRange(i), info = summary(from, to);
      const row = btn('', () => openDay(i), 'trip-day-card');
      const head = node('div', 'trip-day-card-head');
      head.append(node('strong', '', 'День ' + (i + 1)), node('span', '', formatKm(info.metres)));
      row.append(head, node('small', '', '↑ ' + Math.round(info.ascent) + ' м · ↓ ' +
        Math.round(info.descent) + ' м · ≈ ' + duration(info.metres + info.ascent * 3800 / 600)));
      list.append(row);
    }
    body.append(list);
    body.append(node('p', 'help', 'Нажми этап, чтобы увидеть профиль высот, изменить его конец по карте и добавить точку ночёвки.'));
  }
  function showCountEditor() {
    const body = atlas.showSheet('Число дней');
    body.append(node('p', '', 'Изменение количества дней сбрасывает предварительные границы на равные участки по длине трека.'));
    const wrap = node('label', 'field');
    wrap.append(node('span', '', 'Дней похода'));
    const select = node('select');
    for (let n = 2; n <= 14; n++) {
      const opt = node('option', '', String(n));
      opt.value = n;
      if (n === daysCount()) opt.selected = true;
      select.append(opt);
    }
    wrap.append(select);
    body.append(wrap, btn('Разделить маршрут', () => {
      const n = Number(select.value);
      plan.fractions = Array.from({ length: n + 1 }, (_, i) => i / n);
      selectedDay = -1; savePlan(); redraw(); openOverview();
    }, 'primary'));
    body.append(btn('Назад', openOverview));
  }
  function placesNearStage(from, to) {
    if (!path) return [];
    return atlas.getPoints().map(p => {
      const projection = projectToPath([Number(p.lng), Number(p.lat)]);
      return { p, projection };
    }).filter(x => x.projection &&
      x.projection.at >= from - 300 && x.projection.at <= to + 300 &&
      x.projection.gap <= 2500)
      .sort((a, b) => a.projection.at - b.projection.at);
  }
  function renderNearbyPlaces(from, to) {
    const places = placesNearStage(from, to);
    const section = node('div', 'trip-nearby');
    section.append(node('div', 'section-label', 'Места рядом с этапом'));
    if (!places.length) {
      section.append(node('p', 'help', 'Пока нет точек в пределах 2,5 км от линии этого этапа.'));
      return section;
    }
    for (const { p, projection } of places) {
      const row = btn('', () => atlas.openPoint(p.id), 'item-row');
      const body = node('span', 'item-main');
      body.append(node('strong', '', p.title),
        node('small', '', (projection.gap < 100 ? 'На треке / рядом' :
          Math.round(projection.gap) + ' м от GPX по прямой') +
          ' · ' + formatKm(Math.max(0, projection.at - from)) + ' от начала этапа'));
      row.append(node('span', 'item-icon', '⌖'), body, node('span', 'chevron', '›'));
      section.append(row);
    }
    return section;
  }
  function openDay(i) {
    if (!plan || i < 0 || i >= daysCount()) return;
    selectedDay = i; redraw();
    const [from, to] = dayRange(i), data = summary(from, to);
    const body = atlas.showSheet('День ' + (i + 1) + ' из ' + daysCount());
    body.append(node('p', 'trip-lead', 'Участок ' + formatKm(from - plan.start) +
      '–' + formatKm(to - plan.start) + ' от начала поездки'));
    body.append(detailMetrics(data), svgProfile(data.lines), renderNearbyPlaces(from, to));
    const actions = node('div', 'button-row');
    actions.append(btn('Показать на карте', () => {
      atlas.closeSheet(); redraw(); fitSection(from, to);
    }, 'primary'));
    if (i < daysCount() - 1) actions.append(btn('Изменить конец дня', () => beginMove(i)));
    body.append(actions);
    const end = atDistance(to);
    if (end) {
      body.append(node('p', 'help', 'Конец дня отмечен на линии GPX. Реальная стоянка может находиться в стороне от тропы.'));
      body.append(btn('＋ Добавить точку ночёвки', () => {
        atlas.closeSheet();
        atlas.createNightPoint([end[0], end[1]], i + 1);
      }));
    }
    body.append(node('div', 'divider'), btn('← Ко всем этапам', openOverview));
  }
  function beginMove(i) {
    atlas.resetTools();
    editBoundary = i;
    atlas.closeSheet();
    const hint = $('trip-hint');
    hint.textContent = 'Выбери на треке новую границу дня ' + (i + 1) + '. Нажми «Отмена», чтобы выйти.';
    hint.hidden = false;
    $('trip-cancel').hidden = false;
    atlas.toast('Нажми на нужное место трека, чтобы изменить границу дня.');
  }
  function cancelMove() {
    editBoundary = -1;
    $('trip-hint').hidden = true;
    $('trip-cancel').hidden = true;
  }
  function onMapClick(e) {
    if (editBoundary < 0 || !plan) return;
    const found = projectToPath([e.lngLat.lng, e.lngLat.lat]);
    if (!found || found.gap > 1500) {
      atlas.toast('Нажми ближе к линии GPX (не дальше 1,5 км).');
      return;
    }
    const i = editBoundary, minDistance = 400;
    const previous = i === 0 ? plan.start : plan.start + (plan.end - plan.start) * plan.fractions[i];
    const next = i === daysCount() - 2 ? plan.end :
      plan.start + (plan.end - plan.start) * plan.fractions[i + 2];
    if (found.at < previous + minDistance || found.at > next - minDistance) {
      atlas.toast('Граница должна быть между соседними днями, с запасом 400 м.');
      return;
    }
    plan.fractions[i + 1] = (found.at - plan.start) / (plan.end - plan.start);
    savePlan();
    cancelMove();
    redraw();
    atlas.toast('Граница дня ' + (i + 1) + ' сохранена.');
    openDay(i);
  }
  function applyPublishedStagePlan(p) {
    lastPublishedPlan = p || null;
    if (path && validPlan(p, signature) && !readPlan()) {
      plan = p;
      redraw();
    }
  }
  function init() {
    map = atlas.getMap();
    const openButton = $('open-stages');
    if (!map || !openButton) return;
    openButton.addEventListener('click', openOverview);
    $('trip-current').addEventListener('click', () => {
      if (selectedDay >= 0) openDay(selectedDay);
    });
    $('trip-cancel').addEventListener('click', cancelMove);
    map.on('click', onMapClick);
    document.addEventListener('atlas:route-changed', recalculate);
    document.addEventListener('atlas:shared-data', event => {
      applyPublishedStagePlan(event.detail?.stagePlan);
    });
    map.on('load', () => { prepareLayers(); recalculate(); });
    if (map.isStyleLoaded()) { prepareLayers(); recalculate(); }
  }
  window.WalesTripPlanner = { exportPlan: () => plan ? JSON.parse(JSON.stringify(plan)) : null };
  init();
})();

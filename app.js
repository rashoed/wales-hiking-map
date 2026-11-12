/* Wales Trail Atlas MVP. Personal data stays on this device. */
(() => {
  'use strict';

  const KEY = 'wales-trail-atlas-v1';
  const CATEGORIES = {
    town: { label: 'Населённый пункт', icon: '⌂' },
    poi: { label: 'Интересное место', icon: '✦' },
    maybe: { label: 'Возможно посещу', icon: '◇' },
    night: { label: 'Ночёвка', icon: '☾' },
    supply: { label: 'Еда / вода', icon: '◈' },
    transport: { label: 'Транспорт', icon: '↗' }
  };
  const STARTER = [
    { id: 'chepstow', title: 'Chepstow', category: 'town', lat: 51.640, lng: -2.676, description: 'Город у южного начала Offa’s Dyke Path. Возможная отправная точка похода.', photo: '', url: '' },
    { id: 'tintern', title: 'Tintern Abbey', category: 'poi', lat: 51.6974, lng: -2.6766, description: 'Руины средневекового аббатства в долине реки Wye. Проверь, подходит ли отклонение от тропы по времени.', photo: '', url: '' },
    { id: 'monmouth', title: 'Monmouth', category: 'town', lat: 51.812, lng: -2.714, description: 'Город на южном участке маршрута. Доступ к магазинам и транспорту.', photo: '', url: '' },
    { id: 'pandy', title: 'Pandy', category: 'town', lat: 51.899, lng: -2.972, description: 'Населённый пункт перед горным участком Hatterrall Ridge.', photo: '', url: '' },
    { id: 'hay', title: 'Hay-on-Wye', category: 'town', lat: 52.075, lng: -3.127, description: 'Город книг у северной границы Black Mountains.', photo: '', url: '' }
  ];
  const CORRIDOR = STARTER.filter(p => p.id !== 'tintern').map(p => [p.lng, p.lat]);
  const $ = id => document.getElementById(id);
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; } };
  const original = read();
  let points = Array.isArray(original?.points) ? original.points.filter(validPoint) : STARTER;
  let segments = Array.isArray(original?.segments) ? normalizeSegments(original.segments) : [];
  let routeName = typeof original?.routeName === 'string' ? original.routeName : '';
  // Local changes are never uploaded by this public static website.
  let localChanged = typeof original?.localChanged === 'boolean' ? original.localChanged :
    Boolean(original && (segments.length || JSON.stringify(points) !== JSON.stringify(STARTER)));
  let sharedRevision = typeof original?.sharedRevision === 'string' ? original.sharedRevision : '';
  let lastExportRevision = typeof original?.lastExportRevision === 'string' ? original.lastExportRevision : '';
  let map = null, markers = [], gpsMarker = null, gps = null, gpsWatch = null;
  let activePointId = null, addMode = false, measureMode = false, measurePoints = [];
  let toastTimer = 0;
  let filters = new Set(Object.keys(CATEGORIES));

  function validPoint(p) { return p && typeof p.title === 'string' && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && Math.abs(Number(p.lat)) <= 90 && Math.abs(Number(p.lng)) <= 180; }
  function normalizeSegments(input) {
    return input.filter(Array.isArray).map(seg => seg.filter(p => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]))).map(p => [Number(p[0]), Number(p[1]), p[2] == null ? null : Number(p[2])])).filter(seg => seg.length > 1);
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify({ points, segments, routeName, localChanged, sharedRevision, lastExportRevision })); }
    catch (_) { toast('Не удалось сохранить данные: место в памяти браузера закончилось. Сделай резервную копию.'); }
  }
  function save() {
    localChanged = true;
    lastExportRevision = '';
    persist();
  }
  function isSharedData(data) {
    return data && data.schema === 1 && typeof data.revision === 'string' &&
      data.revision.length > 0 && Array.isArray(data.points) &&
      Array.isArray(data.segments) && data.points.every(validPoint) &&
      typeof data.routeName === 'string' &&
      data.segments.every(seg => Array.isArray(seg) && seg.length > 1 && seg.every(p =>
        Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) &&
        Number.isFinite(Number(p[1])) && Math.abs(Number(p[0])) <= 180 && Math.abs(Number(p[1])) <= 90));
  }
  async function loadPublishedData(force = false) {
    // The public itinerary is read-only: local edits never leave this browser.
    // Importantly, a locally edited POI must not prevent an empty device from
    // getting the published track.
    const hasLocalTrack = segments.length > 0;
    if (!force && !hasLocalTrack) {
      $('route-note').textContent = 'Загружаю общий маршрут из GitHub…';
    }
    try {
      const response = await fetch('./data/shared-data.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(response.status === 404
        ? 'Файл общего маршрута не опубликован (404)'
        : 'HTTP ' + response.status);
      const data = await response.json();
      if (!isSharedData(data)) throw new Error('Некорректный формат общего маршрута');

      if (!force && hasLocalTrack) {
        // Keep an imported/offline GPX. Never replace a device's existing route
        // in the background, even if a newer GitHub revision is published.
        refreshStats();
        return;
      }

      if (force && localChanged && !window.confirm(
        'Заменить текущие точки и трек опубликованной версией из GitHub? Локальные изменения будут потеряны.'
      )) { refreshStats(); return; }

      const preserveLocalPoints = !force && localChanged;
      // When the phone has only edited points, use the published GPX but retain
      // its entire local point list (including deleted and renamed items).
      if (!preserveLocalPoints) points = data.points;
      segments = normalizeSegments(data.segments);
      routeName = data.routeName;
      sharedRevision = data.revision;
      localChanged = preserveLocalPoints;
      lastExportRevision = '';
      persist();
      refreshStats();
      refreshLines();
      refreshMarkers();
      if (segments.length) fitTrack();
      if (force) closeSheet();
      toast(preserveLocalPoints
        ? 'Общий маршрут загружен. Локальные точки сохранены.'
        : 'Общий маршрут загружен из GitHub.');
    } catch (error) {
      if (!segments.length) {
        refreshStats();
        $('route-note').textContent = 'Общий маршрут не загрузился: ' + error.message
          + '. Проверь интернет или нажми ⋯ → Загрузить опубликованную версию.';
      }
      toast('Ошибка загрузки маршрута: ' + error.message);
      console.warn('Published route unavailable:', error);
    }
  }
  function downloadSharedData() {
    const revision = new Date().toISOString();
    lastExportRevision = revision;
    persist();
    download('shared-data.json', JSON.stringify({
      schema: 1, revision, routeName, points, segments
    }), 'application/json');
    toast('Файл скачан. Загрузите shared-data.json в папку data репозитория GitHub.');
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function toast(message) {
    const target = $('toast');
    target.textContent = message; target.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => target.hidden = true, 4200);
  }
  function distance(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
    const t = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
    return 12742000 * Math.atan2(Math.sqrt(t), Math.sqrt(Math.max(0, 1 - t)));
  }
  function km(m) { return m >= 1000 ? (m / 1000).toFixed(1).replace('.', ',') + ' км' : Math.round(m) + ' м'; }
  function minutesOfWalking(metres, ascent = 0) { return (metres / 3800 * 60) + (ascent / 600 * 60); }
  function duration(min) { if (!Number.isFinite(min)) return '—'; const m = Math.round(min); return m >= 60 ? Math.floor(m / 60) + ' ч ' + (m % 60) + ' м' : m + ' м'; }
  function statistics() {
    let total = 0, ascent = 0, hasElevation = false;
    const progress = [];
    segments.forEach(seg => {
      const prefix = [total];
      for (let i = 1; i < seg.length; i++) {
        total += distance(seg[i-1], seg[i]);
        prefix.push(total);
        const a = seg[i-1][2], b = seg[i][2];
        if (Number.isFinite(a) && Number.isFinite(b)) {
          hasElevation = true;
          if (b > a + 2) ascent += b - a;
        }
      }
      progress.push(prefix);
    });
    return { total, ascent, hasElevation, progress };
  }
  function nearestOnTrack(position, stats) {
    if (!stats.total) return null;
    // Local equirectangular projection is sufficient for picking a nearest segment in this region.
    const metresLat = 111195;
    const metresLng = metresLat * Math.cos(position[1] * Math.PI / 180);
    let result = null;
    segments.forEach((seg, s) => {
      for (let i = 1; i < seg.length; i++) {
        const a = seg[i - 1], b = seg[i];
        const x = (b[0] - a[0]) * metresLng, y = (b[1] - a[1]) * metresLat;
        const px = (position[0] - a[0]) * metresLng, py = (position[1] - a[1]) * metresLat;
        const t = Math.max(0, Math.min(1, (px*x + py*y) / Math.max(1, x*x + y*y)));
        const gap = Math.hypot(px-t*x, py-t*y);
        const along = stats.progress[s][i - 1] + t * distance(a,b);
        if (!result || gap < result.gap) result = { gap, along };
      }
    });
    return result;
  }
  function refreshStats() {
    const stats = statistics();
    $('route-label').textContent = stats.total ? (routeName || 'ЗАГРУЖЕННЫЙ GPX') : 'МАРШРУТ ЕЩЁ НЕ ЗАГРУЖЕН';
    $('route-distance').textContent = stats.total ? km(stats.total) : '—';
    $('route-ascent').textContent = stats.total && stats.hasElevation ? '≈ +' + Math.round(stats.ascent) + ' м' : '—';
    $('route-time').textContent = stats.total ? '≈ ' + duration(minutesOfWalking(stats.total, stats.ascent)) : '—';
    if (stats.total) {
      let note = 'Расчёт вдоль импортированного GPX. Время приблизительное (3,8 км/ч плюс подъёмы).';
      if (gps) {
        const near = nearestOnTrack([gps.lng, gps.lat], stats);
        if (near) note = 'До конца трека ≈ ' + km(Math.max(0, stats.total - near.along)) + ' · до линии маршрута ≈ ' + km(near.gap) + '. Оценка без учёта отклонений и остановок.';
      }
      $('route-note').textContent = note;
    } else $('route-note').textContent = 'Пунктирная линия — только схема между городами, не тропа. Импортируй GPX для точного маршрута.';
    $('point-count').textContent = points.length;
  }
  function featureCollection(lines) {
    return { type: 'FeatureCollection', features: lines.map(coords => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} })) };
  }
  function updateLine(id, lines) { if (map?.getSource(id)) map.getSource(id).setData(featureCollection(lines)); }
  function refreshLines() {
    if (!map?.getSource('track')) return;
    updateLine('track', segments.map(seg => seg.map(p => p.slice(0,2))));
    updateLine('corridor', segments.length ? [] : [CORRIDOR]);
    updateLine('measure', measurePoints.length === 2 ? [measurePoints] : []);
  }
  function refreshMarkers() {
    if (!map) return;
    markers.forEach(marker => marker.remove()); markers = [];
    points.forEach(p => {
      if (!filters.has(p.category)) return;
      const btn = el('button', 'map-marker ' + (CATEGORIES[p.category] ? p.category : 'maybe'));
      btn.type = 'button'; btn.title = p.title; btn.setAttribute('aria-label', p.title);
      btn.append(el('span', '', (CATEGORIES[p.category] || CATEGORIES.maybe).icon));
      if (p.id === activePointId) btn.classList.add('selected');
      btn.addEventListener('click', event => { event.stopPropagation(); addMode = false; measureMode = false; setToolState(); openPoint(p.id); });
      const marker = new maplibregl.Marker({ element: btn, anchor: 'center' }).setLngLat([Number(p.lng), Number(p.lat)]).addTo(map);
      markers.push(marker);
    });
  }
  function initMap() {
    if (!window.maplibregl) { toast('Не удалось загрузить библиотеку карты. Проверь подключение к интернету.'); return; }
    map = new maplibregl.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/positron', center: [-3.15, 52.1], zoom: 8.1, attributionControl: false });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), 'bottom-right');
    map.on('load', () => {
      map.addSource('corridor', { type: 'geojson', data: featureCollection([]) });
      map.addSource('track', { type: 'geojson', data: featureCollection([]) });
      map.addSource('measure', { type: 'geojson', data: featureCollection([]) });
      map.addLayer({ id: 'corridor-line', type: 'line', source: 'corridor', paint: { 'line-color': '#b88e70', 'line-width': 3, 'line-dasharray': [2,3], 'line-opacity': .75 } });
      map.addLayer({ id: 'track-outline', type: 'line', source: 'track', paint: { 'line-color': '#fffefa', 'line-width': 7 } });
      map.addLayer({ id: 'track-line', type: 'line', source: 'track', paint: { 'line-color': '#cf6345', 'line-width': 4, 'line-opacity': .95 } });
      map.addLayer({ id: 'measure-line', type: 'line', source: 'measure', paint: { 'line-color': '#1e5eaa', 'line-width': 3, 'line-dasharray': [2, 2] } });
      refreshLines(); refreshMarkers();
      if (segments.length) fitTrack();
    });
    map.on('click', event => {
      if (addMode) { addMode = false; setToolState(); openForm(null, [event.lngLat.lng, event.lngLat.lat]); }
      else if (measureMode) {
        measurePoints.push([event.lngLat.lng, event.lngLat.lat]);
        if (measurePoints.length > 2) measurePoints = [measurePoints[2]];
        refreshLines();
        if (measurePoints.length === 2) {
          toast('По прямой: ' + km(distance(measurePoints[0], measurePoints[1])) + '. Это НЕ расстояние по тропе.');
          measureMode = false; setToolState();
        } else hint('Нажми вторую точку. Результат — расстояние по прямой.');
      }
    });
    map.on('contextmenu', event => { event.preventDefault(); openForm(null, [event.lngLat.lng, event.lngLat.lat]); });
    map.on('error', e => { if (e.error) console.warn('Map error:', e.error); });
  }
  function fitTrack() {
    if (!map || !segments.length) return;
    const bounds = new maplibregl.LngLatBounds();
    segments.forEach(seg => seg.forEach(p => bounds.extend(p.slice(0,2))));
    map.fitBounds(bounds, { padding: { top: 90, bottom: 220, left: 70, right: 70 }, maxZoom: 13, duration: 700 });
  }
  function hint(message) { $('hint').textContent = message; $('hint').hidden = !message; }
  function setToolState() {
    $('add').classList.toggle('active', addMode); $('measure').classList.toggle('active', measureMode);
    const canvas = map?.getCanvas(); if (canvas) canvas.style.cursor = addMode || measureMode ? 'crosshair' : '';
    hint(addMode ? 'Нажми на карте, чтобы добавить точку.' : measureMode ? 'Выбери первую точку для измерения по прямой.' : '');
  }
  function showSheet(title) { $('sheet-title').textContent = title; $('sheet-content').replaceChildren(); $('sheet').hidden = false; $('backdrop').hidden = false; }
  function closeSheet() { $('sheet').hidden = true; $('backdrop').hidden = true; activePointId = null; refreshMarkers(); }
  function button(text, onClick, klass = 'secondary') { const b = el('button', klass, text); b.type = 'button'; b.addEventListener('click', onClick); return b; }
  function para(text, klass) { return el('p', klass || '', text); }
  function openPoint(id) {
    const p = points.find(item => item.id === id); if (!p) return;
    activePointId = id; refreshMarkers(); showSheet(p.title);
    const body = $('sheet-content');
    body.append(el('div', 'point-tag', (CATEGORIES[p.category] || CATEGORIES.maybe).label));
    if (p.description) body.append(para(p.description));
    body.append(el('div', 'coords', Number(p.lat).toFixed(5) + ', ' + Number(p.lng).toFixed(5)));
    if (gps) {
      body.append(para('От тебя по прямой: ' + km(distance([gps.lng, gps.lat], [Number(p.lng), Number(p.lat)])), 'help'));
    }
    if (p.photo && /^https:\/\//i.test(p.photo)) {
      const image = el('img', 'point-photo'); image.loading = 'lazy'; image.alt = p.title; image.src = p.photo; image.referrerPolicy = 'no-referrer'; body.append(image);
    }
    const actions = el('div', 'button-row');
    actions.append(button('Показать на карте', () => { closeSheet(); map?.flyTo({ center: [Number(p.lng), Number(p.lat)], zoom: 13 }); }));
    actions.append(button('Изменить', () => openForm(p)));
    body.append(actions);
    const links = el('div', 'button-row');
    links.append(button('Google Maps ↗', () => window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.lat + ',' + p.lng), '_blank', 'noopener,noreferrer')));
    if (p.url && /^https?:\/\//i.test(p.url)) links.append(button('Источник ↗', () => window.open(p.url, '_blank', 'noopener,noreferrer')));
    body.append(links);
  }
  function field(label, value, type, required) {
    const wrap = el('label', 'field'); wrap.append(el('span', '', label));
    const input = el(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
    if (type === 'select') Object.entries(CATEGORIES).forEach(([key, cat]) => { const opt = el('option', '', cat.label); opt.value = key; input.append(opt); });
    else if (type !== 'textarea') input.type = type || 'text';
    input.value = value == null ? '' : String(value); if (required) input.required = true;
    wrap.append(input); return [wrap, input];
  }
  function openForm(old, coords) {
    const editing = Boolean(old?.id);
    showSheet(editing ? 'Редактировать точку' : 'Новая точка');
    const form = el('form'); const body = $('sheet-content');
    const [titleWrap,title] = field('Название', old?.title || '', 'text', true);
    const [catWrap,cat] = field('Категория', old?.category || 'maybe', 'select');
    const [descWrap,desc] = field('Описание', old?.description || '', 'textarea');
    const [latWrap,lat] = field('Широта', old?.lat ?? coords?.[1] ?? 51.8, 'number', true);
    const [lngWrap,lng] = field('Долгота', old?.lng ?? coords?.[0] ?? -2.7, 'number', true);
    lat.step = 'any'; lng.step = 'any';
    const [photoWrap,photo] = field('URL фотографии (необязательно)', old?.photo || '', 'url');
    const [urlWrap,url] = field('Ссылка на источник (необязательно)', old?.url || '', 'url');
    form.append(titleWrap,catWrap,descWrap,latWrap,lngWrap,photoWrap,urlWrap);
    const actions = el('div','button-row');
    const saveButton = el('button','primary',editing ? 'Сохранить' : 'Добавить'); saveButton.type = 'submit';
    actions.append(saveButton);
    if (editing) actions.append(button('Удалить', () => {
      if (!window.confirm('Удалить «' + old.title + '»?')) return;
      points = points.filter(p => p.id !== old.id); save(); closeSheet(); refreshStats(); toast('Точка удалена');
    }, 'danger'));
    form.append(actions);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const y = Number(lat.value), x = Number(lng.value);
      if (!title.value.trim() || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(y) > 90 || Math.abs(x) > 180) { toast('Проверь название и координаты.'); return; }
      const data = { id: old?.id || ('point-' + Date.now() + '-' + Math.random().toString(36).slice(2,8)), title: title.value.trim(), category: cat.value, description: desc.value.trim(), lat: y, lng: x, photo: photo.value.trim(), url: url.value.trim() };
      if (editing) points = points.map(p => p.id === old.id ? data : p); else points.push(data);
      save(); refreshStats(); closeSheet(); refreshMarkers(); map?.flyTo({center:[x,y],zoom:Math.max(map.getZoom(),12)}); toast('Точка сохранена');
    });
    body.append(form);
  }
  function showList() {
    showSheet('Места · ' + points.length);
    const body = $('sheet-content');
    body.append(para('Нажми на точку для описания и редактирования. В режиме ＋ можно поставить новую точку на карте.', 'help'));
    const list = el('div','item-list');
    points.forEach(p => {
      const row = el('button','item-row'); row.type='button';
      const ic = el('span','item-icon', (CATEGORIES[p.category] || CATEGORIES.maybe).icon);
      const content = el('span','item-main'); content.append(el('strong','',p.title),el('small','',(CATEGORIES[p.category] || CATEGORIES.maybe).label));
      row.append(ic,content,el('span','chevron','›')); row.addEventListener('click', () => openPoint(p.id)); list.append(row);
    });
    body.append(list);
    const more = el('div','button-row');
    more.append(button('＋ Добавить вручную', () => openForm(null)));
    more.append(button('Из ссылки Google', showFromLink)); body.append(more);
  }
  function coordinatesFromGoogle(raw) {
    const s = raw.trim();
    let m = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (m) return [Number(m[2]), Number(m[1])];
    m = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (m) return [Number(m[2]), Number(m[1])];
    try {
      const u = new URL(s);
      for (const key of ['q','query','ll','center','destination']) {
        const value = u.searchParams.get(key) || '';
        m = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
        if (m) return [Number(m[2]), Number(m[1])];
      }
    } catch (_) {
      m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (m) return [Number(m[2]), Number(m[1])];
    }
    return null;
  }
  function showFromLink() {
    showSheet('Добавить из Google Maps');
    const body = $('sheet-content');
    body.append(para('Вставь ссылку с координатами, например google.com/maps/@51.64,-2.67,14z, или просто «51.64,-2.67». Короткие maps.app.goo.gl ссылки в браузере пока не раскрываются.'));
    const [wrap,input] = field('Ссылка или координаты', '', 'text', true);
    const form = el('form'); form.append(wrap);
    const submit = el('button','primary','Найти координаты'); submit.type='submit'; form.append(submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const coords = coordinatesFromGoogle(input.value);
      if (!coords || Math.abs(coords[1]) > 90 || Math.abs(coords[0]) > 180) { toast('Координаты в ссылке не найдены. Нужна полная ссылка с координатами либо точка на карте.'); return; }
      openForm({ title:'', category:'maybe', description:'', photo:'', url: /^https?:\/\//.test(input.value.trim()) ? input.value.trim() : '', lat:coords[1], lng:coords[0] }, coords);
    });
    body.append(form);
  }
  function parseGPX(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Некорректный GPX/XML.');
    function nodes(parent, local) { return Array.from(parent.getElementsByTagNameNS('*', local)); }
    function dataFor(parent, child) {
      return nodes(parent, child).map(p => {
        const lat = Number(p.getAttribute('lat')), lng = Number(p.getAttribute('lon'));
        const elev = nodes(p, 'ele')[0];
        const height = elev ? Number(elev.textContent) : null;
        return [lng,lat,Number.isFinite(height)?height:null];
      }).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1]) <=90 && Math.abs(p[0])<=180);
    }
    let raw = nodes(doc,'trkseg').map(seg => dataFor(seg,'trkpt')).filter(s => s.length>1);
    if (!raw.length) raw = nodes(doc,'rte').map(rte => dataFor(rte,'rtept')).filter(s=>s.length>1);
    if (!raw.length) throw new Error('В GPX нет трека (trkseg/trkpt) или маршрута (rte/rtept).');
    const total = raw.reduce((sum,s)=>sum+s.length,0);
    if (total > 100000) throw new Error('Слишком большой GPX (более 100 000 точек).');
    const name = nodes(doc,'name')[0]?.textContent?.trim() || 'Импортированный GPX';
    return { raw, name };
  }
  async function importGPX(file) {
    if (!file) return;
    try {
      const parsed = parseGPX(await file.text());
      segments = parsed.raw; routeName = parsed.name; save(); refreshLines(); refreshStats(); fitTrack(); closeSheet();
      toast('GPX загружен: ' + segments.reduce((n,s)=>n+s.length,0) + ' точек.');
    } catch (e) { toast('Ошибка GPX: ' + e.message); }
  }
  function download(name, data, mime) {
    const blob = new Blob([data], { type: mime }); const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href=url; link.download=name; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  function showMenu() {
    showSheet('Управление');
    const body = $('sheet-content');
    body.append(el('div','section-label','МАРШРУТ И ТОЧКИ'));
    body.append(button('↑ Импортировать GPX', () => $('gpx-file').click(),'primary'));
    body.append(button('＋ Добавить по ссылке', showFromLink));
    body.append(button('＋ Поставить точку на карте', () => { closeSheet(); addMode = true; measureMode = false; setToolState(); }));
    body.append(el('div','divider'));
    body.append(el('div','section-label','ОДИН МАРШРУТ НА ВСЕХ УСТРОЙСТВАХ'));
    body.append(button('↓ Скачать общие данные для GitHub', downloadSharedData, 'primary'));
    body.append(button('↻ Загрузить опубликованную версию', () => loadPublishedData(true)));
    body.append(para('Чтобы тот же трек и точки появились на телефоне, помести скачанный shared-data.json в папку data/ репозитория. После публикации GitHub Pages данные загрузятся автоматически на новых устройствах. Изменения в браузере остаются локальными до следующей публикации файла.', 'help'));
    body.append(el('div','divider'));
    body.append(el('div','section-label','РЕЗЕРВНАЯ КОПИЯ'));
    body.append(button('↓ Скачать данные JSON', () => download('wales-trail-backup.json', JSON.stringify({schema:1,points,segments,routeName},null,2),'application/json')));
    body.append(button('↑ Восстановить из JSON', () => $('backup-file').click()));
    body.append(para('Данные хранятся только в браузере этого устройства, не синхронизируются. Скачай резервную копию перед походом.', 'help'));
    if (segments.length) {
      body.append(el('div','divider'));
      body.append(button('Удалить импортированный трек', () => {
        if (!window.confirm('Убрать GPX из приложения? Твои точки останутся.')) return;
        segments=[];routeName='';save();refreshLines();refreshStats();closeSheet();
      },'danger'));
    }
    body.append(el('div','divider'));
    body.append(para('Версия 0.3 · карта требует интернет. Это ранний планировщик, а не автономный походный навигатор.', 'help'));
  }
  async function importBackup(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.schema !== 1 || !Array.isArray(data.points) || !Array.isArray(data.segments)) throw new Error('Неизвестный формат резервной копии.');
      const nextPoints = data.points.filter(validPoint);
      const nextSegments = normalizeSegments(data.segments);
      if (!window.confirm('Заменить текущие точки и трек содержимым резервной копии?')) return;
      points=nextPoints;segments=nextSegments;routeName=typeof data.routeName==='string'?data.routeName:'';
      save();refreshLines();refreshStats();refreshMarkers();closeSheet();fitTrack();toast('Резервная копия восстановлена.');
    } catch(e) {toast('Не удалось восстановить: '+e.message);}
  }
  function locate() {
    if (!navigator.geolocation) { toast('Геолокация недоступна в этом браузере.'); return; }
    if (gps && map) map.flyTo({ center: [gps.lng,gps.lat], zoom: 13 });
    if (gpsWatch !== null) return;
    toast('Запрашиваю разрешение на геолокацию…');
    gpsWatch = navigator.geolocation.watchPosition(pos => {
      gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (!map) return;
      if (!gpsMarker) {
        gpsMarker = new maplibregl.Marker({element:el('div','gps-dot')}).setLngLat([gps.lng,gps.lat]).addTo(map);
        map.flyTo({center:[gps.lng,gps.lat],zoom:13});
      } else gpsMarker.setLngLat([gps.lng,gps.lat]);
      refreshStats();
    }, err => {
      toast('GPS: ' + err.message);
      if (gpsWatch !== null) navigator.geolocation.clearWatch(gpsWatch);
      gpsWatch = null;
    }, { enableHighAccuracy:true, timeout:18000, maximumAge:10000 });
  }
  function init() {
    $('sheet-close').addEventListener('click',closeSheet); $('backdrop').addEventListener('click',closeSheet);
    $('open-list').addEventListener('click',showList); $('menu-open').addEventListener('click',showMenu);
    $('import-gpx').addEventListener('click',()=>$('gpx-file').click());
    $('gpx-file').addEventListener('change',e=>{importGPX(e.target.files?.[0]);e.target.value='';});
    $('backup-file').addEventListener('change',e=>{importBackup(e.target.files?.[0]);e.target.value='';});
    $('locate').addEventListener('click',locate);
    $('add').addEventListener('click',()=>{addMode=!addMode;measureMode=false;measurePoints=[];setToolState();refreshLines();});
    $('measure').addEventListener('click',()=>{measureMode=!measureMode;addMode=false;measurePoints=[];setToolState();refreshLines();});
    $('layers').addEventListener('click',()=>{$('filter-menu').hidden=!$('filter-menu').hidden;});
    document.querySelectorAll('[data-filter]').forEach(input=>input.addEventListener('change',e=>{
      if (e.target.checked) filters.add(e.target.dataset.filter); else filters.delete(e.target.dataset.filter); refreshMarkers();
    }));
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeSheet();addMode=false;measureMode=false;measurePoints=[];setToolState();refreshLines();}});
    refreshStats();initMap();
    loadPublishedData();
    if ('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  }
  init();
})();

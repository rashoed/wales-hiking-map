'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const plannerSource = fs.readFileSync(path.join(root, 'trip-planner.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'shared-data.json'), 'utf8'));

class Element {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.textContent = '';
    this.className = '';
    this.value = '';
    this.style = {};
    this.hidden = false;
  }
  append(...items) { this.children.push(...items); }
  setAttribute(key, val) { this.attributes[key] = val; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  click() { this.listeners.click?.(); }
}
function descendants(root) {
  return [root, ...root.children.filter(n => n instanceof Element).flatMap(descendants)];
}
class Source { setData(value) { this.data = value; } }
class MapStub {
  constructor() { this.sources = {}; this.layers = {}; this.listeners = {}; this.lastFit = null; }
  getSource(key) { return this.sources[key] || null; }
  addSource(key) { this.sources[key] = new Source(); }
  getLayer(key) { return ['track-line', 'track-outline'].includes(key) || this.layers[key] || null; }
  addLayer(obj) { this.layers[obj.id] = obj; }
  setPaintProperty() {}
  isStyleLoaded() { return true; }
  on(name, fn) { this.listeners[name] = fn; }
  fitBounds(b, options) { this.lastFit = { points: b.points, options }; }
}
class MarkerStub {
  setLngLat(v) { this.location = v; return this; }
  addTo() { return this; }
  remove() {}
}
class BoundsStub {
  constructor() { this.points = []; }
  extend(v) { this.points.push(v); }
  isEmpty() { return this.points.length === 0; }
}
function mount({ offline = false } = {}) {
  const elements = {};
  const domListeners = {};
  const storage = new Map();
  const document = {
    getElementById(id) { return elements[id] ||= new Element(); },
    createElement(tag) { return new Element(tag); },
    createElementNS(_ns, tag) { return new Element(tag); },
    addEventListener(key, fn) { domListeners[key] = fn; }
  };
  const localStorage = {
    getItem(k) { return storage.get(k) || null; },
    setItem(k, v) { storage.set(k, v); }
  };
  const map = offline ? null : new MapStub();
  let lastSheet, lastTitle;
  const captured = { nights: [], shownPOIs: [], statsCalls: 0 };
  const atlas = {
    getMap: () => map,
    getSegments: () => data.segments,
    getPoints: () => data.points,
    showSheet(title) { lastTitle = title; return (lastSheet = new Element('sheet')); },
    closeSheet() {},
    toast() {},
    resetTools() {},
    refreshStats() { captured.statsCalls++; },
    createNightPoint(coords, day) { captured.nights.push({ coords, day }); },
    openPoint(id) { captured.shownPOIs.push(id); }
  };
  const window = { WalesAtlas: atlas, innerWidth: 390 };
  const context = { window, document, localStorage, maplibregl: {
    Marker: MarkerStub, LngLatBounds: BoundsStub
  }, Promise, console };
  vm.runInNewContext(plannerSource, context, { timeout: 3000 });
  return {
    window, document, map, storage, captured,
    get sheet() { return lastSheet; },
    get title() { return lastTitle; },
    click(id) { document.getElementById(id).click(); }
  };
}

test('published GPX focuses Chepstow to Hay-on-Wye in six provisional days', () => {
  const state = mount();
  const overview = state.window.WalesTripPlanner.getOverview();
  assert.equal(overview.days, 6);
  assert.equal(overview.label, 'CHEPSTOW → HAY-ON-WYE');
  assert.ok(overview.metres > 65000 && overview.metres < 110000);
  assert.ok(overview.ascent > 0);
  assert.ok(state.map.getSource('trip-section').data.features.length > 0);
  assert.equal(state.document.getElementById('stage-count').textContent, '6');
  state.click('open-stages');
  const stages = descendants(state.sheet).filter(x => x.className === 'trip-day-card');
  assert.equal(stages.length, 6);
  stages[0].click();
  const detail = descendants(state.sheet);
  assert.ok(detail.some(x => x.tag === 'svg'), 'elevation diagram exists');
  assert.ok(detail.some(x => x.className === 'trip-nearby'), 'nearby POIs exist');
  const night = detail.find(x => x.textContent.includes('Добавить точку ночёвки'));
  assert.ok(night);
  night.click();
  assert.equal(state.captured.nights[0].day, 1);
});

test('day boundary can be edited by clicking GPX and remains locally saved', () => {
  const state = mount();
  state.click('open-stages');
  descendants(state.sheet).find(x => x.className === 'trip-day-card').click();
  const edit = descendants(state.sheet).find(x => x.textContent.includes('Изменить конец дня'));
  edit.click();
  assert.equal(state.document.getElementById('trip-cancel').hidden, false);
  // Pick a point inside day two, but before its boundary.
  const target = state.window.WalesTripPlanner.getOverview().start + 19000;
  let traversed = 0, coord;
  for (const segment of data.segments) {
    for (let i = 1; i < segment.length; i++) {
      const a = segment[i - 1], b = segment[i], scale = Math.PI / 180;
      const dy = (b[1] - a[1]) * scale, dx = (b[0] - a[0]) * scale;
      const t = Math.sin(dy / 2) ** 2 + Math.cos(a[1] * scale) *
        Math.cos(b[1] * scale) * Math.sin(dx / 2) ** 2;
      traversed += 12742000 * Math.atan2(Math.sqrt(t), Math.sqrt(Math.max(0, 1 - t)));
      if (traversed > target) { coord = b; break; }
    }
    if (coord) break;
  }
  assert.ok(coord);
  state.map.listeners.click({ lngLat: { lng: coord[0], lat: coord[1] } });
  const saved = JSON.parse(state.storage.get('wales-atlas-stages-v1'));
  assert.ok(saved.fractions[1] > 1 / 6);
  assert.ok(saved.fractions[1] < saved.fractions[2]);
  assert.equal(state.document.getElementById('trip-cancel').hidden, true);
});

test('stages and elevations remain readable without MapLibre or a basemap', () => {
  const state = mount({ offline: true });
  assert.equal(state.window.WalesTripPlanner.getOverview().days, 6);
  state.click('open-stages');
  const cards = descendants(state.sheet).filter(x => x.className === 'trip-day-card');
  assert.equal(cards.length, 6);
  cards[0].click();
  assert.ok(descendants(state.sheet).some(x => x.tag === 'svg'));
});

test('stage plan is exportable for manual publication to second device', () => {
  const state = mount();
  const plan = state.window.WalesTripPlanner.exportPlan();
  assert.equal(plan.fractions.length, 7);
  assert.equal(plan.fractions[0], 0);
  assert.equal(plan.fractions.at(-1), 1);
  assert.ok(plan.end > plan.start);
});

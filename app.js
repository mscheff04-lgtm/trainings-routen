// Routen-Helfer: liest die Angaben aus dem Fragment, ruft Wind (Open-Meteo) und Strecken
// (BRouter) ab und bietet GPX-Dateien an. Speichert nichts.
import { parseParams, windAdvice, compass, extensionPlan, correctRadius, destination, toGpx, fileName, nextHours } from './helfer.js';

const $ = id => document.getElementById(id);
const UNIT = { E1: 'Lange Fahrt', E2: 'Schwelle', E3: 'VO₂max' };
const urls = [];

function msg(text, kind = 'alert') {
  const d = document.createElement('div');
  d.className = `advice ${kind}`;
  d.textContent = text;
  $('msg').append(d);
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function wind(start) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${start.lat}&longitude=${start.lon}`
    + '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m'
    + '&wind_speed_unit=kmh&timezone=auto&forecast_days=2';
  const w = await getJson(u);
  return { now: w.current, hours: nextHours(w.hourly, w.current.time, 10) };
}

/** Strecke über BRouter; Punkte [{lat, lon}, …] → {km, hm, coords}. */
async function route(points) {
  const lonlats = points.map(p => `${p.lon},${p.lat}`).join('|');
  const r = await getJson(`https://brouter.de/brouter?lonlats=${lonlats}&profile=fastbike&alternativeidx=0&format=geojson`);
  const f = r.features[0];
  return { km: Number(f.properties['track-length']) / 1000, hm: Number(f.properties['filtered ascend']) || 0, coords: f.geometry.coordinates };
}

function gpxButton(box, name, suffix, label, r, kmh) {
  const blob = new Blob([toGpx(`${name} ${label}`, r.coords)], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob); urls.push(url);
  const a = document.createElement('a');
  a.className = 'btn fill'; a.href = url; a.download = fileName(name, suffix);
  a.textContent = `${label} · ${r.km.toFixed(1)} km`;
  const info = document.createElement('span');
  info.className = 'muted small';
  info.textContent = `${Math.round(r.hm)} hm · ca. ${Math.round((r.km / kmh) * 60)} min`;
  box.append(a, info);
}

async function run(p) {
  urls.splice(0).forEach(u => URL.revokeObjectURL(u));
  for (const id of ['wind-box', 'approach-box', 'ext-box']) $(id).hidden = true;
  $('msg').textContent = ''; $('approach').textContent = ''; $('ext').textContent = '';
  const name = p.name || 'Tour';
  $('title').textContent = name;
  $('eyebrow').textContent = `Routen-Helfer${p.unit ? ` · ${p.unit}${UNIT[p.unit] ? ` ${UNIT[p.unit]}` : ''}` : ''}`;
  if (!p.start) { msg('Kein Startpunkt im Link. Unten „Ohne App-Link verwenden“ öffnen.', 'warn'); $('manual').open = true; return; }

  let windFrom = null;
  try {
    const w = await wind(p.start);
    windFrom = w.now.wind_direction_10m;
    $('wind-now').textContent = `${Math.round(w.now.wind_speed_10m)} km/h aus ${compass(windFrom)}`;
    const adv = windAdvice(windFrom, w.now.wind_speed_10m, p.bearing);
    const unitHint = p.unit === 'E2' && p.bearing !== null ? 'E2 im Flachen: Intervalle gegen den Wind (Widerstand für niedrige Kadenz), heim mit Rückenwind. ' : '';
    $('advice').textContent = unitHint + adv.text;
    $('wind-hours').innerHTML = w.hours.map(h => `<tr><td>${h.time.slice(11, 16)}</td><td>${Math.round(h.speed)} km/h</td><td>${compass(h.from)} (${Math.round(h.from)}°)</td><td>${h.gust === null ? '–' : `${Math.round(h.gust)} km/h`}</td></tr>`).join('');
    $('wind-box').hidden = false;
  } catch (e) { msg(`Wind nicht abrufbar (${e.message}).`, 'warn'); }

  if (p.home) {
    $('approach-box').hidden = false;
    try {
      gpxButton($('approach'), name, 'anfahrt', 'Anfahrt', await route([p.home, p.start]), p.kmh);
      gpxButton($('approach'), name, 'rueckweg', 'Rückweg', await route([p.start, p.home]), p.kmh);
    } catch (e) { msg(`Anfahrt nicht berechenbar (${e.message}).`); }
  }

  if (p.ext > 0) {
    $('ext-box').hidden = false;
    const plan = extensionPlan(p.ext, p.kmh, windFrom, p.bearing);
    $('ext-text').textContent = `Es fehlen ${p.ext} min (≈ ${plan.wantKm.toFixed(1)} km bei ${p.kmh} km/h). Vorschlag: vor oder nach der Tour vom Start aus hin und zurück, `
      + (windFrom !== null ? `hin nach ${compass(plan.direction)} gegen den Wind, zurück mit Rückenwind.` : `Richtung ${compass(plan.direction)}.`)
      + ' Locker fahren, Grundlage unter LT1.';
    try {
      let radius = plan.radiusKm;
      let r = await route([p.start, destination(p.start, plan.direction, radius), p.start]);
      const radius2 = correctRadius(radius, r.km, plan.wantKm);
      if (radius2 !== radius) r = await route([p.start, destination(p.start, plan.direction, radius2), p.start]);
      gpxButton($('ext'), name, 'verlaengerung', 'Verlängerung', r, p.kmh);
    } catch (e) { msg(`Verlängerung nicht berechenbar (${e.message}).`); }
  }
}

function fromManual() {
  const v = id => $(id).value.trim();
  const q = new URLSearchParams();
  if (v('m-start')) q.set('start', v('m-start').replace(/\s/g, ''));
  if (v('m-home')) q.set('home', v('m-home').replace(/\s/g, ''));
  if (v('m-ext')) q.set('ext', v('m-ext'));
  if (v('m-bearing')) q.set('bearing', v('m-bearing'));
  if (v('m-kmh')) q.set('kmh', v('m-kmh'));
  // Fragment statt Query: bleibt im Browser.
  location.hash = q.toString();
}

$('m-go').addEventListener('click', fromManual);
window.addEventListener('hashchange', () => run(parseParams(location.hash)));
if (location.hash.length > 1) run(parseParams(location.hash));
else $('manual').open = true;

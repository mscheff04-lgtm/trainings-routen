// Routen-Helfer: liest die Angaben aus dem Fragment, ruft Wind (Open-Meteo) und Strecken
// (BRouter) ab und bietet GPX-Dateien an. Speichert nichts.
import { parseParams, windAdvice, compass, extensionPlan, correctRadius, destination, toGpx, fileName, nextHours, tourSequence, fitToTarget, PROFILE } from './helfer.js';

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
async function route(points, profile = 'fastbike') {
  const lonlats = points.map(p => `${p.lon},${p.lat}`).join('|');
  const r = await getJson(`https://brouter.de/brouter?lonlats=${lonlats}&profile=${profile}&alternativeidx=0&format=geojson`);
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

/** Verlängerung als Hin-und-zurück von from (hin gegen den Wind) als GPX-Knopf. */
async function extension(p, from, extMin, windFrom, name, profile) {
  $('ext-box').hidden = false;
  const plan = extensionPlan(extMin, p.kmh, windFrom, p.bearing);
  $('ext-text').textContent = `Es fehlen ${extMin} min (≈ ${plan.wantKm.toFixed(1)} km bei ${p.kmh} km/h). Vorschlag: vorher oder nachher ${p.home && from === p.home ? 'von zu Hause' : 'vom Start'} aus hin und zurück, `
    + (windFrom !== null ? `hin nach ${compass(plan.direction)} gegen den Wind, zurück mit Rückenwind.` : `Richtung ${compass(plan.direction)}.`)
    + ' Locker fahren, Grundlage unter LT1.';
  try {
    const radius = plan.radiusKm;
    let r = await route([from, destination(from, plan.direction, radius), from], profile);
    const radius2 = correctRadius(radius, r.km, plan.wantKm);
    if (radius2 !== radius) r = await route([from, destination(from, plan.direction, radius2), from], profile);
    gpxButton($('ext'), name, 'verlaengerung', 'Verlängerung', r, p.kmh);
  } catch (e) { msg(`Verlängerung nicht berechenbar (${e.message}).`); }
}

async function run(p) {
  urls.splice(0).forEach(u => URL.revokeObjectURL(u));
  for (const id of ['wind-box', 'tour-box', 'approach-box', 'ext-box']) $(id).hidden = true;
  $('msg').textContent = ''; $('approach').textContent = ''; $('ext').textContent = ''; $('tour').textContent = '';
  const name = p.name || 'Tour';
  const profile = PROFILE[p.bike] || 'fastbike';
  const fromHome = p.via.length >= 2 && p.home;
  $('title').textContent = name;
  $('eyebrow').textContent = `Routen-Helfer${p.unit ? ` · ${p.unit}${UNIT[p.unit] ? ` ${UNIT[p.unit]}` : ''}` : ''}${p.bike === 'gravel' ? ' · Gravel' : ''}`;
  const windAt = fromHome ? p.home : p.start || p.via[0];
  if (!windAt) { msg('Kein Startpunkt im Link. Unten „Ohne App-Link verwenden“ öffnen.', 'warn'); $('manual').open = true; return; }

  let windFrom = null, adv = null;
  try {
    const w = await wind(windAt);
    windFrom = w.now.wind_direction_10m;
    $('wind-now').textContent = `${Math.round(w.now.wind_speed_10m)} km/h aus ${compass(windFrom)}`;
    adv = windAdvice(windFrom, w.now.wind_speed_10m, p.bearing);
    const unitHint = p.unit === 'E2' && p.bearing !== null ? 'E2 im Flachen: Intervalle gegen den Wind (Widerstand für niedrige Kadenz), heim mit Rückenwind. ' : '';
    const turned = fromHome && adv.kind === 'umgekehrt' ? ' Die GPX unten ist schon umgedreht.' : '';
    $('advice').textContent = unitHint + adv.text + turned;
    $('wind-hours').innerHTML = w.hours.map(h => `<tr><td>${h.time.slice(11, 16)}</td><td>${Math.round(h.speed)} km/h</td><td>${compass(h.from)} (${Math.round(h.from)}°)</td><td>${h.gust === null ? '–' : `${Math.round(h.gust)} km/h`}</td></tr>`).join('');
    $('wind-box').hidden = false;
  } catch (e) { msg(`Wind nicht abrufbar (${e.message}).`, 'warn'); }

  if (fromHome) {
    // Tour ab Zuhause: Einstieg am nächstgelegenen Punkt, Richtung nach Wind, Länge gegen die Zieldauer.
    $('tour-box').hidden = false;
    const reverse = !!adv && adv.kind === 'umgekehrt';
    try {
      const r = await route(tourSequence(p.via, { loop: p.loop, home: p.home, reverse }), profile);
      const fit = fitToTarget(r.km, p.kmh, p.target);
      $('tour-text').textContent = `Von zu Hause über die Tour und zurück${reverse ? ' (gegen die gespeicherte Richtung)' : ''}: ${r.km.toFixed(1)} km, ca. ${fit.minutes} min bei ${p.kmh} km/h`
        + (fit.kind === 'passt' ? ` – passt zur geplanten Dauer (${p.target} min).`
          : fit.kind === 'kurz' ? ` – ${-fit.delta} min kürzer als geplant (${p.target} min), Verlängerung unten.`
            : fit.kind === 'lang' ? ` – ${fit.delta} min länger als geplant (${p.target} min): unterwegs abkürzen oder eine kürzere Tour wählen.` : '.');
      gpxButton($('tour'), name, 'ab-zuhause', 'Tour ab Zuhause', r, p.kmh);
      if (fit.kind === 'kurz') await extension(p, p.home, -fit.delta, windFrom, name, profile);
    } catch (e) { msg(`Tour nicht berechenbar (${e.message}).`); }
    return;
  }

  if (p.home && p.start) {
    $('approach-box').hidden = false;
    try {
      gpxButton($('approach'), name, 'anfahrt', 'Anfahrt', await route([p.home, p.start], profile), p.kmh);
      gpxButton($('approach'), name, 'rueckweg', 'Rückweg', await route([p.start, p.home], profile), p.kmh);
    } catch (e) { msg(`Anfahrt nicht berechenbar (${e.message}).`); }
  }
  if (p.ext > 0 && p.start) await extension(p, p.start, p.ext, windFrom, name, profile);
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

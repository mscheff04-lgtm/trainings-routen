import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseParams, windAdvice, destination, extensionPlan, correctRadius, toGpx, fileName, nextHours, compass } from '../helfer.js';

test('Parameter aus dem Fragment', () => {
  const p = parseParams('#start=50.3%2C8.6&home=50.2,8.6&ext=40&bearing=-90&kmh=26&unit=E2&name=Flachrunde');
  assert.deepEqual(p.start, { lat: 50.3, lon: 8.6 });
  assert.deepEqual(p.home, { lat: 50.2, lon: 8.6 });
  assert.equal(p.ext, 40);
  assert.equal(p.bearing, 270);
  assert.equal(p.kmh, 26);
  assert.equal(p.unit, 'E2');
  assert.equal(parseParams('').start, null);
  assert.equal(parseParams('#start=999,8').start, null);
  assert.equal(parseParams('#kmh=3').kmh, 10);
});

test('Wind-Empfehlung für die Flachstrecke', () => {
  // Flachstrecke nach Westen (270°), Wind aus Westen → von vorn
  assert.equal(windAdvice(270, 20, 270).kind, 'wie-geplant');
  // Wind aus Osten → umgekehrt fahren
  assert.equal(windAdvice(90, 20, 270).kind, 'umgekehrt');
  assert.match(windAdvice(90, 20, 270).text, /nach O/);
  // Wind aus Norden auf West-Strecke → seitlich
  assert.equal(windAdvice(0, 20, 270).kind, 'seitlich');
  // schwacher Wind
  assert.equal(windAdvice(270, 6, 270).kind, 'ruhig');
  // ohne Richtung: hin gegen den Wind
  assert.match(windAdvice(225, 20, null).text, /nach SW/);
  // Grenze ±70°: 60° daneben noch von vorn, 80° seitlich
  assert.equal(windAdvice(330, 20, 270).kind, 'wie-geplant');
  assert.equal(windAdvice(350, 20, 270).kind, 'seitlich');
});

test('Zielpunkt: 10 km nach Norden ≈ +0,09° Breite', () => {
  const d = destination({ lat: 50, lon: 8 }, 0, 10);
  assert.ok(Math.abs(d.lat - 50.08993) < 1e-4);
  assert.equal(d.lon, 8);
});

test('Verlängerung: hin gegen den Wind, Radius aus Zeit und Schnitt', () => {
  const p = extensionPlan(30, 25, 250, 90);
  assert.equal(p.direction, 250);
  assert.ok(Math.abs(p.wantKm - 12.5) < 1e-9);
  assert.ok(Math.abs(p.radiusKm - 12.5 / 2 / 1.3) < 1e-9);
  assert.equal(extensionPlan(30, 25, null, 90).direction, 90);
  assert.equal(extensionPlan(30, 25, null, null).direction, 0);
  assert.equal(correctRadius(5, 12, 12.5), 5);
  assert.equal(correctRadius(5, 20, 10), 2.5);
});

test('GPX und Dateiname', () => {
  const g = toGpx('Tour & Co', [[8.6, 50.2, 120], [8.61, 50.21]]);
  assert.match(g, /<name>Tour &amp; Co<\/name>/);
  assert.match(g, /<trkpt lat="50.2" lon="8.6"><ele>120<\/ele><\/trkpt>/);
  assert.match(g, /<trkpt lat="50.21" lon="8.61"><\/trkpt>/);
  assert.equal(fileName('Flachrunde Nord', 'anfahrt'), 'flachrunde-nord-anfahrt.gpx');
});

test('Stundenwerte ab jetzt', () => {
  const hourly = { time: ['2026-10-12T08:00', '2026-10-12T09:00', '2026-10-12T10:00'], wind_speed_10m: [5, 10, 15], wind_direction_10m: [0, 90, 180], wind_gusts_10m: [9, 19, 29] };
  const h = nextHours(hourly, '2026-10-12T09:15', 5);
  assert.equal(h.length, 2);
  assert.deepEqual(h[0], { time: '2026-10-12T09:00', speed: 10, from: 90, gust: 19 });
  assert.equal(compass(359), 'N');
});

import { tourSequence, fitToTarget, PROFILE } from '../helfer.js';

test('Wegpunkte, Rundtour-Flag, Zieldauer, Rad aus dem Fragment', () => {
  const p = parseParams('#via=50.1,7.1;50.2,7.2;x;50.3,7.3&loop=1&target=150&bike=gravel');
  assert.equal(p.via.length, 3);
  assert.equal(p.loop, true);
  assert.equal(p.target, 150);
  assert.equal(p.bike, 'gravel');
  assert.equal(parseParams('#bike=foo').bike, 'rennrad');
  assert.equal(PROFILE.gravel, 'trekking');
});

test('Tour ab Zuhause: Einstieg am nächsten Punkt, Runde schließen, Richtung drehen', () => {
  const A = { lat: 50, lon: 7 }, B = { lat: 50, lon: 7.1 }, C = { lat: 50.1, lon: 7.1 }, D = { lat: 50.1, lon: 7 };
  const home = { lat: 50.11, lon: 7.11 }; // nahe C
  assert.deepEqual(tourSequence([A, B, C, D], { loop: true, home }), [home, C, D, A, B, C, home]);
  assert.deepEqual(tourSequence([A, B, C, D], { loop: true, home, reverse: true }), [home, C, B, A, D, C, home]);
  assert.deepEqual(tourSequence([A, B, C], { loop: false, reverse: true }), [C, B, A]);
  assert.deepEqual(tourSequence([], { home }), []);
});

test('Abgleich mit der Zieldauer', () => {
  assert.deepEqual(fitToTarget(60, 30, 120), { minutes: 120, kind: 'passt', delta: 0 });
  assert.equal(fitToTarget(40, 30, 120).kind, 'kurz');
  assert.equal(fitToTarget(80, 30, 120).kind, 'lang');
  assert.equal(fitToTarget(80, 30, 0).kind, 'ohne-ziel');
});

import { shortenToTarget } from '../helfer.js';

test('Runde kürzen: so weit wie möglich, dann direkt heim', () => {
  const home = { lat: 50, lon: 7 };
  // Runde: 4 Punkte im Quadrat mit 10 km Kantenlänge, Start am Zuhause
  const k = 10 / 111.2, l = 10 / (111.2 * Math.cos((50 * Math.PI) / 180));
  const A = home, B = { lat: 50, lon: 7 + l }, C = { lat: 50 + k, lon: 7 + l }, D = { lat: 50 + k, lon: 7 };
  const pts = [home, A, B, C, D, A, home];
  // ganze Runde 40 km × 1,3 bei 30 km/h ≈ 104 min; Ziel 75 min → bis C und heim (20 + 14,1 km) × 1,3 ≈ 88 min zu viel → bis B (20 km × 1,3 ≈ 52 min)
  assert.deepEqual(shortenToTarget(pts, 30, 75), [home, A, B, home]);
  assert.deepEqual(shortenToTarget(pts, 30, 90), [home, A, B, C, home]);
  assert.equal(shortenToTarget(pts, 30, 5), null);
  assert.equal(shortenToTarget(pts.slice(0, 3), 30, 60), null);
});

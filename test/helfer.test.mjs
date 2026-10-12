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

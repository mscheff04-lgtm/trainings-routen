// Routen-Helfer: reine Rechenfunktionen (ohne DOM, ohne Netz), damit sie testbar sind.
// Die Trainings-App ruft die Seite mit Angaben im Fragment auf (#start=…&home=…), das der
// Browser nicht an den Server schickt.

export const ROAD_FACTOR = 1.3;          // Annahme: Straße ≈ Luftlinie × 1,3
export const CALM_KMH = 10;              // darunter: Windrichtung praktisch egal
export const HEAD_COS = 0.34;            // |cos| ≥ 0,34 ≈ Wind innerhalb ±70° von vorn/hinten

const COMPASS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
export const compass = deg => COMPASS[Math.round(norm(deg) / 45) % 8];
export const norm = deg => ((deg % 360) + 360) % 360;
const rad = d => (d * Math.PI) / 180;

const point = s => {
  if (!s) return null;
  const [lat, lon] = String(s).split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
};
const num = s => (s === null || s === undefined || s === '' || !Number.isFinite(Number(s)) ? null : Number(s));

const pointList = s => String(s || '').split(';').map(point).filter(Boolean);

/** Fragment (#start=…&home=…&ext=…&bearing=…&kmh=…&unit=…&name=…&via=…&loop=1&target=…&bike=…) → Parameter. */
export function parseParams(hash) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const bearing = num(p.get('bearing'));
  return {
    start: point(p.get('start')),
    home: point(p.get('home')),
    ext: Math.max(0, Math.round(num(p.get('ext')) || 0)),
    bearing: bearing === null ? null : norm(bearing),
    kmh: Math.min(45, Math.max(10, num(p.get('kmh')) || 25)),
    unit: (p.get('unit') || '').slice(0, 10),
    name: (p.get('name') || '').slice(0, 80),
    via: pointList(p.get('via')).slice(0, 40),
    loop: p.get('loop') === '1',
    target: Math.max(0, Math.round(num(p.get('target')) || 0)),
    bike: p.get('bike') === 'gravel' ? 'gravel' : 'rennrad',
  };
}

/**
 * Empfehlung für die Flachstrecke (E2 im Flachen: Intervalle gegen den Wind).
 * windFrom = Richtung, AUS der der Wind kommt (meteorologisch). bearing = Fahrtrichtung auf
 * der Flachstrecke, so wie die Tour gefahren wird.
 * Gegenwindanteil = cos(windFrom − bearing): +1 genau von vorn, −1 genau von hinten.
 */
export function windAdvice(windFrom, speedKmh, bearing) {
  if (!Number.isFinite(speedKmh) || !Number.isFinite(windFrom)) return { kind: 'unbekannt', text: 'Kein Wind abrufbar.' };
  if (speedKmh < CALM_KMH) return { kind: 'ruhig', text: `Kaum Wind (${Math.round(speedKmh)} km/h): Richtung egal, Intervalle nach HF.` };
  if (!Number.isFinite(bearing)) {
    return { kind: 'ohne-richtung', text: `Hinweg nach ${compass(windFrom)} fahren (gegen den Wind), Intervalle dort; Rückweg mit Rückenwind.` };
  }
  const head = Math.cos(rad(windFrom - bearing));
  const pct = Math.round(Math.abs(head) * 100);
  if (head >= HEAD_COS) return { kind: 'wie-geplant', head, text: `Tour wie geplant fahren: Auf der Flachstrecke (nach ${compass(bearing)}) kommt der Wind von vorn (${pct} % Gegenwindanteil). Intervalle dort.` };
  if (head <= -HEAD_COS) return { kind: 'umgekehrt', head, text: `Tour umgekehrt fahren: So kommt der Wind auf der Flachstrecke (dann nach ${compass(bearing + 180)}) von vorn (${pct} % Gegenwindanteil). Intervalle dort.` };
  return { kind: 'seitlich', head, text: 'Seitenwind auf der Flachstrecke: Richtung egal, Intervalle gleichmäßig nach HF.' };
}

/** Punkt in Entfernung km und Richtung deg vom Ausgangspunkt (Großkreis). */
export function destination(from, bearingDeg, km) {
  const R = 6371, d = km / R, b = rad(bearingDeg), la = rad(from.lat), lo = rad(from.lon);
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  const r5 = x => Math.round(x * 1e5) / 1e5;
  return { lat: r5((la2 * 180) / Math.PI), lon: r5((((lo2 * 180) / Math.PI + 540) % 360) - 180) };
}

/**
 * Verlängerung als Hin-und-zurück vom Start: hin gegen den Wind (Gegenwind auf dem Hinweg,
 * Rückenwind heim), ohne Wind in Richtung der Flachstrecke bzw. nach Norden.
 * @returns {{direction: number, wantKm: number, radiusKm: number}}
 */
export function extensionPlan(extMin, kmh, windFrom, bearing) {
  const wantKm = (extMin / 60) * kmh;
  const direction = Number.isFinite(windFrom) ? norm(windFrom) : Number.isFinite(bearing) ? norm(bearing) : 0;
  return { direction, wantKm, radiusKm: wantKm / 2 / ROAD_FACTOR };
}

/** Nach dem ersten Routing den Radius so anpassen, dass die Länge passt (eine Korrektur). */
export function correctRadius(radiusKm, gotKm, wantKm) {
  if (!(gotKm > 0)) return radiusKm;
  const f = wantKm / gotKm;
  return Math.abs(f - 1) <= 0.15 ? radiusKm : radiusKm * Math.min(2, Math.max(0.5, f));
}

/** GeoJSON-Koordinaten [lon, lat, ele] → GPX 1.1 (Track). */
export function toGpx(name, coords) {
  const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + `<gpx version="1.1" creator="trainings-routen" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(name)}</name><trkseg>`
    + coords.map(q => `<trkpt lat="${q[1]}" lon="${q[0]}">${q[2] !== undefined ? `<ele>${q[2]}</ele>` : ''}</trkpt>`).join('')
    + '</trkseg></trk></gpx>\n';
}

/** Dateiname ohne Sonderzeichen. */
export const fileName = (name, suffix) => `${String(name || 'route').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '') || 'route'}-${suffix}.gpx`;

/** Stündliche Windwerte ab jetzt (Open-Meteo hourly) → [{time, speed, from, gust}] für die nächsten n Stunden. */
export function nextHours(hourly, nowIso, n = 8) {
  if (!hourly || !hourly.time) return [];
  const now = nowIso.slice(0, 13);
  let i = hourly.time.findIndex(t => t.slice(0, 13) >= now);
  if (i < 0) i = 0;
  return hourly.time.slice(i, i + n).map((t, k) => ({
    time: t, speed: hourly.wind_speed_10m[i + k], from: hourly.wind_direction_10m[i + k], gust: hourly.wind_gusts_10m ? hourly.wind_gusts_10m[i + k] : null,
  }));
}

/** BRouter-Profil je Rad: Rennrad „fastbike“, Gravel „trekking“ (lässt Feld- und Waldwege zu). */
export const PROFILE = { rennrad: 'fastbike', gravel: 'trekking' };

const dist = (a, b) => {
  const R = 6371, dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

/**
 * Reihenfolge der Wegpunkte für „Tour ab Zuhause“. Rundtour: Einstieg am Wegpunkt, der dem
 * Zuhause am nächsten liegt, Runde schließen; reverse dreht die Fahrtrichtung (Wind).
 * Strecke A→B: Wegpunkte wie gespeichert bzw. umgedreht.
 * @returns {{lat, lon}[]} Punkte für BRouter inkl. Zuhause am Anfang und Ende (falls home)
 */
export function tourSequence(via, { loop = false, home = null, reverse = false } = {}) {
  if (!via.length) return [];
  let seq = via.slice();
  if (loop) {
    if (home) {
      let k = 0;
      seq.forEach((p, i) => { if (dist(home, p) < dist(home, seq[k])) k = i; });
      seq = [...seq.slice(k), ...seq.slice(0, k)];
    }
    if (reverse) seq = [seq[0], ...seq.slice(1).reverse()];
    seq.push(seq[0]);
  } else if (reverse) seq.reverse();
  return home ? [home, ...seq, home] : seq;
}

/** Geschätzte Fahrzeit und Abgleich mit der Zieldauer (±15 %). */
export function fitToTarget(km, kmh, targetMin) {
  const minutes = Math.round((km / kmh) * 60);
  if (!targetMin) return { minutes, kind: 'ohne-ziel', delta: 0 };
  const delta = minutes - targetMin;
  const kind = minutes < targetMin * 0.85 ? 'kurz' : minutes > targetMin * 1.15 ? 'lang' : 'passt';
  return { minutes, kind, delta };
}

# trainings-routen

Öffentlicher Routen-Helfer für die Trainings-App (GitHub Pages): Wind am Tourstart (Open-Meteo), Empfehlung für die Fahrtrichtung bei E2 im Flachen und GPX-Dateien für Anfahrt oder Verlängerung (BRouter, OpenStreetMap). Das Repo enthält keine persönlichen Daten.

## Aufruf

Die Trainings-App verlinkt die Seite mit allen Angaben im Fragment (nach `#`). Das Fragment schickt der Browser nicht an den Server; Koordinaten stehen damit weder im Repo noch in Server-Logs.

```
https://mscheff04-lgtm.github.io/trainings-routen/#start=50.3,8.6&home=50.2,8.6&ext=30&bearing=270&kmh=25&unit=E2&name=Tour
```

| Parameter | Bedeutung |
|---|---|
| `start` | Tourstart (Breite, Länge); Wind wird hier abgerufen |
| `home` | Zuhause; nur gesetzt, wenn eine Anfahrt nötig ist → GPX Anfahrt und Rückweg |
| `ext` | fehlende Minuten → GPX Verlängerung (hin gegen den Wind, zurück mit Rückenwind) |
| `bearing` | Fahrtrichtung auf der Flachstrecke der Tour in Grad (0 = Nord) → Empfehlung „wie geplant“ oder „umgekehrt fahren“ |
| `kmh` | Schnitt für Zeit ↔ Strecke (10–45, Standard 25) |
| `unit`, `name` | Einheit (E1/E2/E3) und Tourname für Überschrift und Dateinamen |

Ohne Fragment lässt sich alles unten auf der Seite von Hand eingeben.

## Regeln und Annahmen

- Gegenwindanteil = cos(Windrichtung − Fahrtrichtung). Ab 0,34 (Wind innerhalb ±70° von vorn) „wie geplant“, ab −0,34 „umgekehrt“, dazwischen Seitenwind. Unter 10 km/h Wind ist die Richtung egal.
- E2 im Flachen: Intervalle gegen den Wind (Entscheidung MO, 12.10.2026); keine harte Evidenz, sondern Widerstand für niedrige Kadenz und Rückenwind auf dem Heimweg.
- Verlängerung: Radius = Strecke / 2 / 1,3 (Straße ≈ Luftlinie × 1,3), nach dem ersten Routing einmal korrigiert, wenn die Länge mehr als 15 % abweicht.

## Entwicklung

`npm test` prüft die Rechenfunktionen in `helfer.js` (ohne Netz). `app.js` macht die Abrufe und baut die Seite.

# Tipp Radar V6.0.2

Adatvezérelt, több sportágú valószínűségi elemző. Nem ígér biztos eredményt: hiányos vagy gyenge adatnál kihagyást jelez.

## V6 működés

- sportáganként külön modell, friss eredmények súlyozásával;
- 1X2 rendes játékidő és kétkimenetelű győztes piac külön kezelve;
- modellverzió, adatminőség és bizonyítékok mentése Supabase-be;
- napi automatikus elszámolás és Brier-alapú kalibráció;
- napi automatikus 9 sportos elemzés háttérfeladattal, Supabase-mentéssel és eltárolt TOP 5-tel;
- kérés-összevonás, elosztott elemzési zár és Netlify rate limit;
- MMA/F1 csak információs mód, amíg nincs kalibrált, ellenőrizhető modell;
- 18+ felelős játék, adatkezelési és modell-átláthatósági oldalak.

## Ellenőrzés

```sh
npm ci
npm run check
npm test
```

Az automatikus napi elemzés 02:00 UTC-kor indul, az eredményelszámolás 02:15 UTC-kor fut. Magyar nyári idő szerint ezek 04:00 és 04:15. A napi elemzés állapota a `/.netlify/functions/daily-status` végponton ellenőrizhető. Ehhez a kiadáshoz nem tartozik új Supabase-migráció.

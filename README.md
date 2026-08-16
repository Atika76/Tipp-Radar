# Tipp Radar V6

Adatvezérelt, több sportágú valószínűségi elemző. Nem ígér biztos eredményt: hiányos vagy gyenge adatnál kihagyást jelez.

## V6 működés

- sportáganként külön modell, friss eredmények súlyozásával;
- 1X2 rendes játékidő és kétkimenetelű győztes piac külön kezelve;
- modellverzió, adatminőség és bizonyítékok mentése Supabase-be;
- napi automatikus elszámolás és Brier-alapú kalibráció;
- kérés-összevonás, elosztott elemzési zár és Netlify rate limit;
- MMA/F1 csak információs mód, amíg nincs kalibrált, ellenőrizhető modell;
- 18+ felelős játék, adatkezelési és modell-átláthatósági oldalak.

## Ellenőrzés

```sh
npm ci
npm run check
npm test
```

Az adatbázis változása a `supabase/migrations` könyvtárban található. A Netlify ütemezett függvény UTC szerint naponta 02:15-kor fut.

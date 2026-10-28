# Zadania: backtest + silnik e1RM/RPE

Plan: [`tasks/plan.md`](plan.md) · Spec: [`SPEC.md`](../SPEC.md)
Weryfikacja dla każdego zadania: `npm test` (nie ma kroku budowania).

## Faza 1: backtest

### - [x] T1: `replay()` i ocena porównań
Czysta funkcja, która dla historii jednego ćwiczenia (od najnowszej) zwraca listę kroków: sesja → decyzja silnika na historii
do tej sesji → następna sesja → znacznik `=`/`↑`/`↓`/`·`, plus podsumowanie liczników.

**Akceptacja**
- [x] `=`: następna sesja na zaleconym ciężarze i każda seria ≥ celu (seria i-ta względem `repsAt(r, i)`); `↑`: cięższa;
      `↓`: lżejsza albo któraś seria poniżej celu; `·`: decyzja `skip`. Ostatnia sesja nie ma następnej, więc nie dostaje znacznika.
- [x] Moduł importuje statycznie tylko `engine.ts`. Test działa bez `HEVY_API_KEY`.
- [x] Testy na danych w kodzie pokrywają każdy znacznik i podsumowanie.

**Pliki:** `src/backtest.ts`, `src/backtest.test.ts` · **Zależy od:** — · **Rozmiar:** S

### - [x] T2: skrypt `npm run backtest`
Uruchomienie z terminala: pobiera routine i historię, bierze reguły z serwera, drukuje raport z SPEC.md.

**Akceptacja**
- [x] `server.ts` eksportuje `loadConfig` i `ruleFor` bez zmiany zachowania (istniejące testy przechodzą).
- [x] Część z siecią jest w `if (import.meta.main)` z dynamicznym importem `hevy.ts`/`server.ts`. Historia: `recentSessions(ids, 50)`.
- [x] Skrypt `"backtest": "node --env-file-if-exists=.env src/backtest.ts"` w `package.json`.
- [x] Brak jakiegokolwiek `PUT`. Dwa uruchomienia pod rząd dają identyczny wynik.

**Weryfikacja ręczna:** `npm run backtest > $TMP/b1.txt && npm run backtest > $TMP/b2.txt && diff $TMP/b1.txt $TMP/b2.txt` (pusto);
raport zgadza się z porównaniem z rozmowy (np. wyciskanie nad głowę: zalecenie 7 kg, a Ty zostałeś przy 6 kg, więc `↓`).
**Pliki:** `src/backtest.ts`, `src/server.ts`, `package.json` · **Zależy od:** T1 · **Rozmiar:** S

### - [x] Checkpoint A
- [x] `npm test` zielone
- [x] Raport bazowy zapisany w `data/backtest-baseline.txt` (poza gitem)
- [x] Raport przejrzany z Tobą, zanim ruszymy silnik

## Faza 2: silnik

### - [x] T3: drabinka +1 w najsłabszej serii
Reguła 3 ze specu (decyzja po backteście): ciężar zostaje, każda seria ≥ dolna granica, +1 powt. tylko w najsłabszej serii
(remis → pierwsza), ≤ górna granica.

**Akceptacja**
- [x] Testy: 11/10 → 11/11; 9/7 → 9/8; 13/9 → 12/10 (najpierw obcięcie do górnej granicy); 80×10, 80×9 → 10/10.
- [x] Zaktualizowane oczekiwania w istniejących testach (silnik, serwer, UI) wyłącznie tam, gdzie zmienia się cel powtórzeń drabinki.
- [x] Powód mówi, w której serii dokładasz powtórzenie.

**Weryfikacja ręczna:** `diff data/backtest-baseline.txt <(npm run -s backtest)`: różnice **tylko** w celach powtórzeń decyzji `hold`
(także w sesjach mieszanych, które poprawia T4); więcej `=`. Wynik: `=` 4 → 14, `↓` 31 → 21, nic poza `hold` się nie zmieniło. Zapisz raport jako `data/backtest-after-t3.txt`.
**Pliki:** `src/engine.ts`, `src/engine.test.ts`, ewentualnie `src/server.test.ts`, `src/frontend.test.ts` · **Zależy od:** Checkpoint A · **Rozmiar:** S

### - [ ] T4: poprawka serii na różnych ciężarach
Reguła 4 ze specu: ciężar zostaje W; serie lżejsze liczą się jak najsłabsza seria na W; potem drabinka z T3.

**Akceptacja**
- [ ] Testy: 70×12, 70×11, 80×10 → 80 × 11/10/10; hantle 7×9, 7×8, 9×8 → 9 × 9/8/8.
- [ ] Istniejący test „last set dropped to 25 kg” (30×12, 30×12, 25×12 → 30 × 12/12/12) przechodzi bez zmian.
- [ ] Powód mówi, że lżejsze serie dostały cel z serii na W.

**Weryfikacja ręczna:** `diff data/backtest-after-t3.txt <(npm run -s backtest)`: różnice **tylko** w sesjach z seriami na różnych
ciężarach. Zapisz raport jako `data/backtest-after-t4.txt`.
**Pliki:** `src/engine.ts`, `src/engine.test.ts` · **Zależy od:** T3 · **Rozmiar:** XS

### - [ ] T5: funkcje e1RM
`e1rm(w, r)` (Brzycki ≤ 10, Epley 11–15, obcięcie do 15), `weightFor(e1rm, r)` (odwrotność), `snapDown(x, rule)`
(największy dostępny ciężar ≤ x: z listy `weights` albo `W + k × increment`).

**Akceptacja**
- [ ] Testy: ciągłość przy 10 powt.; 20 powt. liczone jak 15; `weightFor(e1rm(w, r), r) ≈ w`; `snapDown` z listą hantli i ze skokiem.
- [ ] Brak zmian w decyzjach (`nextTarget` jeszcze ich nie używa).

**Pliki:** `src/engine.ts`, `src/engine.test.ts` · **Zależy od:** — (po T4 dla czytelności) · **Rozmiar:** S

### - [ ] T6: RPE i e1RM w regule podniesienia ciężaru
Reguła 2 ze specu: powtórzenia efektywne = reps + (10 − RPE); podniesienie, gdy wszystkie serie na W mają efektywne ≥ górna
granica; nowy ciężar = większy z (następny krok, `snapDown(weightFor(e1rm, min + 2))`); RPE podnosi e1RM najwyżej o 10%;
hamulec `maxRpe` bez zmian.

**Akceptacja**
- [ ] Wszystkie wiersze tabeli „Przykłady” ze SPEC.md są testami i przechodzą (80×12 @6 → 90 × 8/8; 80×10 @8 → 85 × 8/8; …).
- [ ] Test limitu +10%.
- [ ] Gdy RPE wpłynęło na decyzję, powód to mówi. Tekst po ostatnim „→” to decyzja (test).
- [ ] Testy z T3–T5 przechodzą bez zmian oczekiwań.

**Weryfikacja ręczna:** `diff data/backtest-after-t4.txt <(npm run -s backtest)` jest **pusty** (Twoja historia nie ma RPE).
**Pliki:** `src/engine.ts`, `src/engine.test.ts` · **Zależy od:** T5 · **Rozmiar:** S

### - [ ] Checkpoint B
- [ ] `npm test` zielone
- [ ] Diffy raportów zgodne z oczekiwaniami (T3: tylko cele drabinki; T4: tylko serie mieszane; T6: pusty)
- [ ] `npm start`: wiersze i szczegóły ćwiczeń pokazują sensowne decyzje i powody
- [ ] Przegląd z Tobą

## Faza 3: dokumentacja

### - [ ] T7: README
**Akceptacja**
- [ ] „Zasady progresji”: tabela zaktualizowana (drabinka w najsłabszej serii, RPE i powtórzenia efektywne, skok z e1RM i limit 10%, serie na różnych ciężarach).
- [ ] Sekcja „Backtest”: komendy lokalnie i w Dockerze, jak czytać znaczniki, raporty zapisywać poza repo.
- [ ] Przepis na n8n: `GET /api/plan`, `changed: true`, deduplikacja po `fingerprint`.
- [ ] „Do zrobienia”: odhaczone e1RM; dopisane `detraining`, `deload`, `timed-progression`, strojenie progów RPE.

**Pliki:** `README.md` · **Zależy od:** T6 · **Rozmiar:** XS

### - [ ] Checkpoint C
- [ ] Kryteria sukcesu 1–5 ze SPEC.md spełnione
- [ ] Decyzja o commicie, pushu i wydaniu obrazu po Twojej stronie

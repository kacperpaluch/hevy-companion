# Plan: backtest + silnik e1RM/RPE

Spec: [`SPEC.md`](../SPEC.md) (zaakceptowany 2026-10-28). Zadania ze szczegółami: [`tasks/todo.md`](todo.md).

## Przegląd
Najpierw narzędzie do sprawdzania algorytmu na Twojej historii z Hevy (`backtest`), potem przebudowa silnika w trzech małych
krokach. Każdy krok porównujemy z poprzednim raportem backtestu. Na końcu README.

## Decyzje architektoniczne
- **`replay()` jest czystą funkcją w `src/backtest.ts`.** Importuje tylko `engine.ts`. Część z siecią (`hevy.ts`, `server.ts`)
  ładuje się dynamicznie wyłącznie przy uruchomieniu skryptu, więc testy nie potrzebują klucza API.
- **Reguły bez kopii:** `server.ts` eksportuje `loadConfig` i `ruleFor`, a backtest ich używa. Import `server.ts` nie uruchamia
  nasłuchu (`import.meta.main`).
- **Historia w backteście:** `recentSessions(ids, 50)`, ta sama funkcja co aplikacja. Aplikacja zostaje przy 3 sesjach.
- **Kolejność zmian w silniku:** drabinka, poprawka serii na różnych ciężarach (obie widoczne na historii bez RPE),
  potem funkcje e1RM, na końcu RPE. Twoja historia nie ma jeszcze RPE, więc po kroku z RPE raport backtestu ma być
  **identyczny** jak po T4. To mocne sprawdzenie, że bez RPE nic się nie zmieniło.
- **Format powodu:** decyzja zawsze po ostatnim „→”, bo tak wiersz w UI wyciąga krótki opis (`public/index.html:161`).
- **Raporty backtestu poza repo.** Zawierają Twoje dane treningowe, więc trafiają do `data/backtest-*.txt` (w `.gitignore`).

## Graf zależności
```
T1 replay ──► T2 CLI backtest ──► [Checkpoint A: raport bazowy] ──► T3 drabinka ──► T4 serie mieszane
                                                                                        │
                                          T5 funkcje e1RM ──► T6 RPE w podniesieniu ◄───┘ ──► [Checkpoint B] ──► T7 README ──► [Checkpoint C]
```
Kroki T3–T6 po kolei, żeby każdy diff raportu dotyczył jednej zmiany.

## Lista zadań
### Faza 1: backtest
- [x] T1: `replay()` i ocena porównań (S)
- [x] T2: skrypt `npm run backtest` (S)
- [x] **Checkpoint A:** raport bazowy zapisany, przejrzany z Tobą → decyzja: drabinka +1 w najsłabszej serii (T3)

### Faza 2: silnik
- [x] T3: drabinka +1 w najsłabszej serii (S) — dodane po Checkpoint A
- [x] T4: poprawka serii na różnych ciężarach (XS)
- [x] T5: funkcje e1RM: `e1rm`, `weightFor`, `snapDown` (S)
- [ ] T6: RPE i e1RM w regule podniesienia ciężaru (S)
- [ ] **Checkpoint B:** testy, diffy raportów, podgląd w UI

### Faza 3: dokumentacja
- [ ] T7: README (zasady, backtest, n8n) (XS)
- [ ] **Checkpoint C:** kryteria sukcesu ze specu spełnione

## Ryzyka
| Ryzyko | Wpływ | Co robimy |
|---|---|---|
| Nowy powód psuje krótki opis w wierszu UI | Średni | Test: tekst po ostatnim „→” to decyzja. Ręczny podgląd w Checkpoint B. |
| Twoja historia nie ma RPE, więc reguł RPE nie da się sprawdzić na prawdziwych danych | Średni | Tabela przykładów jako testy. Strojenie progów po 2–3 tygodniach z RPE (osobne zadanie później). |
| Istniejące testy serwera/UI sprawdzają dokładny tekst powodów | Niski | Zmieniamy tylko oczekiwania dotyczące serii na różnych ciężarach. Każdą inną zmianę traktujemy jak błąd. |
| Backtest pobiera do 30 stron treningów | Niski | Uruchamiany ręcznie, jak odświeżenie w aplikacji. |
| Raport z danymi osobistymi trafi do gita | Niski | Zapis poza repo, opisany w README. |

## Poza tym planem (później, wg SPEC.md)
`detraining`, `deload`, `timed-progression` (plank), strojenie progów RPE, wydanie obrazu Docker (skill `ship`, po Twojej decyzji).

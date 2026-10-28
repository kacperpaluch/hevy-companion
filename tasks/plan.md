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
- **Kolejność zmian w silniku:** najpierw poprawka serii na różnych ciężarach (jedyna zmiana widoczna na historii bez RPE),
  potem funkcje e1RM, na końcu RPE. Twoja historia nie ma jeszcze RPE, więc po kroku z RPE raport backtestu ma być
  **identyczny** jak po poprawce. To mocne sprawdzenie, że bez RPE nic się nie zmieniło.
- **Format powodu:** decyzja zawsze po ostatnim „→”, bo tak wiersz w UI wyciąga krótki opis (`public/index.html:161`).
- **Raporty backtestu poza repo.** Zawierają Twoje dane treningowe, więc trafiają do katalogu tymczasowego, nie do gita.

## Graf zależności
```
T1 replay (czysta) ──► T2 CLI backtest ──► [Checkpoint A: raport bazowy]
                                                │
T3 serie na różnych ciężarach ◄─────────────────┘
T4 funkcje e1RM ──► T5 RPE w podniesieniu ──► [Checkpoint B]
                                                │
                                   T6 README ◄──┘ ──► [Checkpoint C]
```
T3 i T4 są niezależne (T4 to nowe funkcje bez użycia), ale robimy je po kolei, żeby każdy diff raportu był jednoznaczny.

## Lista zadań
### Faza 1: backtest
- [ ] T1: `replay()` i ocena porównań (S)
- [ ] T2: skrypt `npm run backtest` (S)
- [ ] **Checkpoint A:** raport bazowy zapisany, przejrzany z Tobą

### Faza 2: silnik
- [ ] T3: poprawka serii na różnych ciężarach (XS)
- [ ] T4: funkcje e1RM: `e1rm`, `weightFor`, `snapDown` (S)
- [ ] T5: RPE i e1RM w regule podniesienia ciężaru (S)
- [ ] **Checkpoint B:** testy, diff raportów, podgląd w UI

### Faza 3: dokumentacja
- [ ] T6: README (zasady, backtest, n8n) (XS)
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

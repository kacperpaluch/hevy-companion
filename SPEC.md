# Spec: Hevy Companion

Status: **zaakceptowany** · 2026-10-28 · plan: `tasks/plan.md`

## Cel

Prywatny „trener progresji” dla jednej osoby (właściciela), działający na danych z Hevy.
Po każdym treningu aplikacja liczy dla każdego ćwiczenia z routine następny cel (ciężar × powtórzenia), podaje powód
i po kliknięciu zapisuje go w routine w Hevy.

Kierunek: algorytm w stylu [Gravl](https://gravl.ai/blog/how-gravl-algorithm-works), czyli szacowany ciężar maksymalny (e1RM),
ocena wysiłku z RPE i drabinka powtórzeń, ale **tylko progresja**. Plan treningowy (dobór ćwiczeń, kolejność, serie) układa
właściciel w Hevy, aplikacja go nie generuje.

Użytkownik: początkujący (od października 2026), jedna routine full body (11 ćwiczeń × 2 serie), 2–3 razy w tygodniu.
Na siłowni loguje w Hevy na telefonie i od teraz wpisuje RPE. Z aplikacji korzysta na komputerze lub telefonie.

**Główny problem do rozwiązania: zaufanie do algorytmu.** Każda zmiana reguł ma być sprawdzalna na prawdziwej historii
z Hevy, a każda decyzja ma pokazywać powód.

### Założenia (potwierdzone)
1. Jeden użytkownik, sieć domowa lub VPN, bez logowania.
2. Prostota: zero zależności runtime, vanilla JS, bez kroku budowania.
3. Hevy jest jedynym źródłem historii. Lokalnie tylko `data/config.json` i `data/history.json`, bez bazy danych.
   e1RM jest liczony z historii przy każdym odświeżeniu, a nie przechowywany.
4. Bez periodyzacji, bez generowania treningów.

## Mapa modułów

| Id modułu | Odpowiedzialność | Zależy od | Stan |
|---|---|---|---|
| `hevy-client` | Pobieranie routine, historii i szablonów ćwiczeń, zapis routine (`src/hevy.ts`) | — | jest, bez zmian |
| `progression-engine` | Czyste reguły: z historii ćwiczenia → decyzja + powód (`src/engine.ts`) | — | jest → **przebudowa na e1RM + RPE** |
| `backtest` | Odtworzenie decyzji silnika na historii z Hevy, raport w terminalu (`src/backtest.ts`) | `hevy-client`, `progression-engine` | **nowy** |
| `plan-api` | Serwer HTTP: składanie planu, ustawienia, wysyłka z kopią (`src/server.ts`) | `hevy-client`, `progression-engine` | jest, drobne zmiany |
| `web-ui` | Jedna strona (`public/index.html`) | `plan-api` | jest, bez zmian (nowe powody przychodzą z silnika) |
| `detraining` | Po przerwie > 2 tyg. ok. −1% na tydzień | `progression-engine` | później |
| `deload` | Treningi deload nie wpływają na decyzje | `progression-engine` | później |
| `timed-progression` | Plank i ćwiczenia na czas (+5 s) | `progression-engine` | później |

**Kolejność:** `backtest` (raport dla obecnych reguł = punkt odniesienia) → `progression-engine` (nowe reguły, porównanie raportów
przed i po) → reszta według potrzeby.

Świadomie pominięte z Gravl: poprawka na zmęczenie zależna od pozycji ćwiczenia (stała kolejność w routine powoduje, że się znosi),
przenoszenie postępu między ćwiczeniami (ma sens dopiero przy wymianie ćwiczeń), startowe e1RM z poziomu zaawansowania,
dobór ćwiczeń.

---

## Moduł `backtest`

**Po co:** żeby zobaczyć, co algorytm zaleciłby po każdym Twoim treningu i co zrobiłeś w następnym.
Ten sam raport przed i po zmianie reguł pokazuje dokładnie, co zmiana zmienia.

**Działanie**
- Pobiera routine i do 300 ostatnich treningów (jak aplikacja), z historią do 50 sesji na ćwiczenie.
- Reguły (zakres, skok, lista ciężarów, `maxRpe`, `exclude`) bierze z tej samej funkcji co serwer: eksport `ruleFor`/`loadConfig` z `server.ts`, bez kopii logiki.
- Dla każdej sesji ćwiczenia, od najstarszej: decyzja silnika na historii do tej sesji → co zrobiono w następnej.
- Każde porównanie dostaje znacznik:
  - `=` trafione: następna sesja na zaleconym ciężarze i każda seria ≥ celu,
  - `↑` więcej: cięższy ciężar niż zalecony,
  - `↓` mniej: lżejszy ciężar albo któraś seria poniżej celu,
  - `·` pominięte: decyzja `skip`.
- Na końcu podsumowanie per ćwiczenie i łącznie: liczba `=`, `↑`, `↓`.
- **Tylko odczyt.** Żadnego `PUT` do Hevy. Wynik deterministyczny (bez dat bieżących i losowości), więc można robić `diff`.

**Przykład wyjścia**
```
## Wyciskanie nogami (maszyna) · 8–12 · co 5 kg
  70×12 70×11 80×10   → hold 80 kg × 11/11/11      → 70×14 70×13 70×12   ↓
  90×9 90×8 90×7      → hold 90 kg × 10/9/8        → 80×11 80×10 80×10   ↓
  podsumowanie: = 3 · ↑ 4 · ↓ 1 · pominięte 1
```

**Jak czytać:** dane sprzed korzystania z aplikacji to Twoje własne decyzje, a nie wzorzec. Dużo `↑` oznacza, że algorytm jest
ostrożniejszy od Ciebie, dużo `↓`, że celuje za wysoko. Docelowo, przy wpisywanym RPE, powinno przeważać `=`.

---

## Moduł `progression-engine` — e1RM + RPE

Zasada: **bez RPE silnik działa jak dziś** (podwójna progresja; brak oceny = „Ciężko”, tak jak w Gravl). RPE jedynie dodaje
powtórzenia „w zapasie”, więc może przyspieszyć podniesienie ciężaru, ale nigdy go nie wymusza na siłę.

### Definicje
- **Serie robocze:** `normal`, `failure` (jak dziś).
- **W:** najcięższy ciężar w ostatniej sesji. **Serie na W:** serie robocze z tym ciężarem.
- **Zapas (RIR):** `10 − RPE`; brak RPE = 0.
- **Powtórzenia efektywne:** `reps + RIR`.
- **e1RM(ciężar, powt.)**, powtórzenia obcięte do 15 (jak w Gravl):
  - ≤ 10 powt.: Brzycki `w × 36 / (37 − r)`,
  - 11–15 powt.: Epley `w × (1 + r / 30)` (oba wzory dają ten sam wynik przy 10).
- **Ciężar dla powtórzeń** to odwrotność tego samego wzoru.

### Reguły (w tej kolejności)
1. `exclude`, brak historii, brak ciężaru → `skip` (bez zmian).
2. **Podniesienie ciężaru**, gdy wszystkie serie robocze są na W i każda ma **powtórzenia efektywne ≥ górna granica**:
   - któraś seria ma RPE > `maxRpe` → zostaje W, cel = górna granica (bez zmian),
   - brak skoku ciężaru → `skip` z prośbą o skok (bez zmian),
   - inaczej nowy ciężar = **większy z**: następny dostępny ciężar oraz ciężar dla `min + 2` powt. z e1RM,
     zaokrąglony **w dół** do dostępnych ciężarów. Cel = dolna granica.
   - e1RM bierze najlepszą serię na W z powtórzeniami efektywnymi, ale **RPE może podnieść e1RM najwyżej o 10%**
     względem e1RM z samych powtórzeń.
   - Efekt: brak RPE albo RPE 9–10 → jeden krok (jak dziś). RPE ≤ 7 („Łatwo”) → większy skok, jeśli e1RM na to pozwala.
3. **Serie na różnych ciężarach** (poprawka błędu): ciężar zostaje W. Serie na W: +1 powt. Serie lżejsze: najmniej powtórzeń
   spośród serii na W, +1. Wszystko w granicach zakresu.
4. Pozostałe przypadki: drabinka +1 powt. w każdej serii i cofnięcie ciężaru po 2 sesjach poniżej zakresu, **bez zmian**.
   Dolna granica liczona z rzeczywistych powtórzeń, nie efektywnych.
5. Powód każdej decyzji po polsku. Gdy RPE wpłynęło na decyzję, powód to mówi,
   np. „Wszystkie serie ≥ 12 powt. z zapasem (12 @RPE 6, zapas 4, liczę jak 15; e1RM ≈ 120 kg) → 90 kg (+10 kg), wracasz do 8 powt.”.

### Przykłady (staną się testami; zakres 8–12, skok 5 kg)
| Ostatnia sesja | Decyzja | Uwagi |
|---|---|---|
| 80×12, 80×12 | 85 kg × 8/8 | jak dziś |
| 80×12 @6, 80×12 @6 | **90 kg** × 8/8 | Łatwo: e1RM 120 → 90 kg |
| 80×10 @8, 80×10 @8 | **85 kg** × 8/8 | 10 + 2 zapasu = 12, górna granica osiągnięta |
| 80×10 @9.5, 80×9 @9.5 | 80 kg × 11/10 | jak dziś |
| 80×12 @10, 80×12 @9 | 80 kg × 12/12 | hamulec `maxRpe` jak dziś |
| 70×12, 70×11, 80×10 | **80 kg × 11/11/11** | dziś: 12/12/11 |
| 7×9, 7×8, 9×8 (hantle) | **9 kg × 9/9/9** | dziś: 10/9/9 |

### Kryterium akceptacji przebudowy
Raport `backtest` przed i po zmianie na historii bez RPE różni się **tylko** sesjami z seriami na różnych ciężarach.
Każda inna różnica to błąd.

---

## Moduł `plan-api` — auto-sync przez n8n (bez nowego kodu)

n8n co kilka godzin wywołuje `GET http://<host>:3000/api/plan`. Gdy któreś ćwiczenie ma `changed: true`, wysyła powiadomienie.
n8n zapamiętuje `fingerprint` routine, o której już powiadomił, i nie powtarza powiadomienia, dopóki `fingerprint` się nie zmieni.
Opis trafi do README. Zmiana w kodzie tylko przy `backtest` (eksport `ruleFor`/`loadConfig`).

---

## Stack
- Node 26+ (uruchamia TypeScript bez kompilacji), `node:http`, `node:test`.
- Frontend: jeden plik HTML/CSS/JS bez frameworka.
- Docker `node:26-alpine`, obraz `kpa90/hevy-companion` (amd64 + arm64).
- Zero zależności npm.

## Komendy
```bash
npm start                   # node --env-file-if-exists=.env src/server.ts → http://localhost:3000
npm test                    # node --test src/*.test.ts (bez połączenia z Hevy)
npm run backtest            # node --env-file-if-exists=.env src/backtest.ts (nowe; wymaga HEVY_API_KEY)
npm run backtest > before.txt && <zmiana reguł> && npm run backtest > after.txt && diff before.txt after.txt
docker compose exec hevy-companion node src/backtest.ts   # to samo w kontenerze
docker build -t hevy-companion .
```
Wydanie obrazu i push na GitHuba przez skille `ship` / `git-push`.

## Struktura
```
src/engine.ts        → czyste reguły progresji (bez I/O)
src/hevy.ts          → klient Hevy API
src/server.ts        → HTTP, config, wysyłka, historia wysyłek
src/backtest.ts      → (nowy) raport decyzji na historii; czysta funkcja replay + main
src/*.test.ts        → testy obok kodu
src/exercises-pl.json → polskie nazwy ćwiczeń
public/index.html    → cały interfejs
scripts/             → narzędzia jednorazowe (odświeżanie nazw PL)
data/                → config.json, history.json (poza gitem; wolumen w Dockerze)
SPEC.md, README.md, PRODUCT.md → spec, dokumentacja użytkownika, opis produktu
```

## Styl kodu
Czyste funkcje w silniku, krótkie nazwy, komentarz tylko gdy kod nie mówi „dlaczego”. Komentarze po angielsku,
wszystko, co widzi użytkownik (powody, błędy, UI), po polsku.

```ts
// one bad session is noise; two in a row at the same load means the last jump was too big
const prevBelow = prev.length > 0 && prev.every((s) => s.weight_kg === weight && s.reps != null) && Math.max(...prev.map((s) => s.reps!)) < min;
const down = prevBelow ? stepDown(weight, rule) : undefined;
if (down != null)
  return { action: 'decrease', weight: down, reps: sets.map(() => min),
    reason: `Drugi trening z rzędu poniżej ${min} powt. na ${kg(weight)} (${fmt(sets)}; wcześniej ${fmt(prev)}) → za duży skok, wracasz do ${kg(down)}` };
```

## Testy
- `node:test` + `node:assert/strict`, pliki `src/<moduł>.test.ts`.
- Silnik: każda reguła i każdy wiersz tabeli przykładów to test (`wr(nextTarget(...))` → `[akcja, ciężar, powtórzenia]`).
- Backtest: czysta funkcja `replay(sesje, reguła)` testowana na danych w kodzie, bez Hevy i bez klucza API.
- Serwer i frontend: istniejące testy HTTP i UI muszą przechodzić bez zmian, poza oczekiwanymi nowymi powodami.
- Weryfikacja reguł na prawdziwych danych: `diff` raportów `backtest` przed i po.

## Granice
- **Zawsze:** `npm test` przed commitem. Powód przy każdej decyzji. Nic nie trafia do Hevy bez kliknięcia i potwierdzenia.
  Przy zmianie reguł raport `backtest` przed i po. README „Zasady progresji” aktualizowane razem z silnikiem.
- **Najpierw zapytaj:** nowa zależność (także `typescript` do sprawdzania typów), zmiana tego, co i jak jest zapisywane w Hevy
  (`toPutBody`), niezgodna zmiana formatu `config.json`, cokolwiek z listy „później” lub generowanie treningów.
- **Nigdy:** commit `.env`, klucza API ani `data/*.json`. Zapis do Hevy z backtestu lub testów. Usuwanie lub osłabianie
  testów, żeby przeszły. Automatyczna wysyłka do Hevy bez akcji użytkownika.

## Kryteria sukcesu
1. `npm run backtest` drukuje deterministyczny raport dla Twojej routine i nie wykonuje żadnego zapisu w Hevy.
2. Silnik przechodzi wszystkie testy z tabeli przykładów. Dotychczasowe testy przechodzą bez zmian oczekiwań,
   poza przypadkami serii na różnych ciężarach.
3. `diff` raportów przed i po przebudowie na historii bez RPE zawiera tylko sesje z seriami na różnych ciężarach.
4. Gdy RPE wpłynęło na decyzję, powód w UI to pokazuje.
5. README opisuje nowe reguły i przepis na n8n.

## Decyzje (zamknięte pytania)
1. **Serie na różnych ciężarach:** reguła z punktu 3 potwierdzona (70×12, 70×11, 80×10 → 80 × 11/11/11).
2. **Progi:** cel `min + 2` przy skoku, limit +10%, obcięcie do 15 powt. Do dostrojenia backtestem po 2–3 tygodniach z RPE.
3. **Deload:** sposób oznaczania w Hevy ustalimy razem z modułem `deload`.

Zasada powodów: wiersz w UI pokazuje tekst po ostatnim „→” (`public/index.html`), więc każdy powód kończy się decyzją,
a wcześniejsze kroki rozumowania nie używają „→” po decyzji.

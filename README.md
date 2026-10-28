# Hevy Companion

[![Docker Hub](https://img.shields.io/docker/pulls/kpa90/hevy-companion?logo=docker)](https://hub.docker.com/r/kpa90/hevy-companion)

Prywatna aplikacja do prowadzenia progresji na siłowni na bazie danych z [Hevy](https://hevy.com).
Robi **podwójną progresję (double progression)** zgodną z [ARF](https://arf.edu.pl/jak-progresowac-na-silowni/),
z elementami algorytmu [Gravl](https://gravl.ai/blog/how-gravl-algorithm-works): RPE wpisane w Hevy liczy się jako zapas
powtórzeń, a szacowany ciężar maksymalny (e1RM) pozwala na większy skok, gdy było wyraźnie łatwo.
Zasady można sprawdzić na własnej historii z Hevy poleceniem `npm run backtest`.

Co robi:
1. Pobiera z Hevy Twoje routine'y i historię treningów.
2. Dla każdego ćwiczenia liczy następny cel (ciężar × powtórzenia) i pisze **dlaczego**.
3. Pokazuje podgląd zmian w przeglądarce. Nic nie trafia do Hevy, dopóki nie klikniesz „Wyślij do Hevy”.
4. Po kliknięciu nadpisuje ciężary i powtórzenia w routine w Hevy.

Jeden użytkownik, bez logowania, bez bazy danych. Historia jest w Hevy, a ustawienia w jednym pliku JSON.
Ostatnia wysyłka każdego planu i jej kopia bezpieczeństwa są zapisywane lokalnie w `data/history.json`.

---

## Uruchomienie

Potrzebny jest klucz API Hevy (wymaga Hevy Pro): Hevy → Settings → Developer → API key.

### Docker

Obraz jest dostępny na [Docker Hub](https://hub.docker.com/r/kpa90/hevy-companion) (`linux/amd64` i `linux/arm64`).
Pobierz [`docker-compose.yml`](docker-compose.yml), wpisz swój klucz w `HEVY_API_KEY` i uruchom:

```bash
docker compose up -d     # http://localhost:3000
docker compose logs -f   # logi
```

```yaml
services:
  hevy-companion:
    image: kpa90/hevy-companion:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - HEVY_API_KEY=zmien_mnie
      - TZ=Europe/Warsaw
    volumes:
      - hevy-companion_data:/app/data

volumes:
  hevy-companion_data:
```

Plik działa też jako stack w Portainerze (wszystkie zmienne są w `environment:`).

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `HEVY_API_KEY` | — | Klucz API Hevy. **Wymagany.** |
| `PORT` | `3000` | Port wewnątrz kontenera. |
| `CONFIG_PATH` | `data/config.json` | Ścieżka pliku ustawień (względem `/app`). |
| `TZ` | — | Strefa czasowa kontenera. |

- Ustawienia (`config.json`) są w wolumenie `hevy-companion_data`, więc przetrwają aktualizację obrazu i restart.
- Aktualizacja: `docker compose pull && docker compose up -d`. Każde wydanie ma też stały tag z hashem commita, np. `kpa90/hevy-companion:89ea3ef`.
  Żeby wrócić do poprzedniej wersji, wpisz ten tag zamiast `:latest`.
- Przenosiny ustawień ze starej instalacji z katalogiem `./data`: `docker compose cp data/config.json hevy-companion:/app/data/config.json`.
- Port 3000 bez logowania: **nie wystawiaj go do internetu.** Tylko sieć domowa albo VPN (np. Tailscale).

### Lokalnie bez Dockera (Node 26+)

```bash
echo "HEVY_API_KEY=twój-klucz" > .env
npm start     # node --env-file-if-exists=.env src/server.ts
npm test      # testy silnika, API i interfejsu (bez połączenia z Hevy)
npm run backtest   # raport: co algorytm zaleciłby po każdym Twoim treningu (tylko odczyt z Hevy)
```

Nie ma `npm install`, bo projekt nie ma żadnych zależności. Własny obraz: `docker build -t hevy-companion .`

---

## Jak używać

Każda routine z Hevy ma swoją sekcję:
- **Pasek stanu** pod nazwą: jeden segment na ćwiczenie. Kolory odnoszą się do aktualnego planu w Hevy:
  zielony = więcej kg, niebieski = nowy cel powtórzeń albo zmiana ciężarów w obu kierunkach,
  pomarańczowy = mniej kg, szary = bez zmian albo pominięte. Pod paskiem są liczby dla każdego stanu.
- **„Wyślij N zmian do Hevy”**: zapisuje zmiany tej routine po potwierdzeniu ostrzeżenia o utracie notatki całego planu.
  Notatki poszczególnych ćwiczeń są zachowywane. Bez kliknięcia i potwierdzenia nic nie trafia do Hevy.
- **Wybór zmian:** checkbox przy ćwiczeniu pozwala odznaczyć propozycję. Do wysyłki trafiają tylko zaznaczone zmiany;
  pozostałe ćwiczenia zachowują dotychczasowe wartości w Hevy. Dwa wystąpienia tego samego ćwiczenia można wybrać osobno.
  Wybór jest zachowywany dla tego samego podglądu; gdy plan się zmieni, wszystkie nowe zmiany są ponownie zaznaczone.
- **Ostatnia wysyłka:** rozwijana sekcja pod planem pokazuje datę, wynik wysyłki oraz „było → zapisano”.
  Zawiera link do pobrania kopii JSON z planem sprzed zapisu, wysyłanym planem i podsumowaniem zmian.
  Kopia powstaje **przed** połączeniem zapisującym do Hevy; jeśli nie da się jej zapisać, wysyłka jest przerywana.
  Wynik niepotwierdzony jest wyraźnie oznaczony. Przechowywana jest ostatnia próba wysyłki dla każdego planu, również po restarcie.

Przy każdym ćwiczeniu:
- **Ostatnio:** serie z ostatniego treningu z tym ćwiczeniem, jedna linia na serię, i jego data.
- **Następny cel:** co zostanie zapisane w routine, jedna linia na serię roboczą. Kolor kropki oznacza stan jak na pasku.
- **Teraz w Hevy:** przy zmienionym celu pokazuje obecne wartości planu bez rozwijania szczegółów.
- **Pod nazwą:** krótka decyzja, np. „zostaje 25 kg, cel 12 / 10 powt. (+1 powt. w serii 2)”.
- **Ustawienia:** skrót zakresu i skoku (np. `8–12 · co 5 kg`). Kliknięcie (albo kliknięcie nazwy ćwiczenia) rozwija pełne uzasadnienie,
  „Teraz w Hevy” i listy **Zakres powtórzeń** oraz **Skok ciężaru**. Hantle mają domyślną listę ciężarów; maszyny i reszta wymagają
  wyboru skoku, a do tego czasu wiersz pokazuje „Ustaw skok”.
- **Limit RPE:** w szczegółach ćwiczenia można ustawić wartość od 1 do 10. Puste pole przywraca domyślny limit z konfiguracji (zwykle 9).
  Serię z RPE powyżej limitu traktujemy jako zrobioną bez zapasu, więc ciężar nie rośnie. RPE wpisuj w Hevy przy każdej serii.
- **Wyklucz z progresji:** trwałe wyłączenie ćwiczenia w ustawieniach. Można je ponownie włączyć w tym samym miejscu,
  także gdy ćwiczenie nie ma historii. Wykluczenie i RPE są wspólne dla danego ćwiczenia we wszystkich routine'ach.
- **Zastój:** komunikat „Brak poprawy w ostatnich 3 treningach” pojawia się, gdy trzy ostatnie sesje mają tę samą liczbę serii roboczych
  i te same ciężary w odpowiadających sobie seriach, a żadna seria nie poprawiła liczby powtórzeń w obu porównaniach kolejnych sesji.
  Szczegóły pokazują te trzy wyniki. Zmiana ciężaru lub liczby serii wyklucza takie porównanie; znacznik nie zmienia reguł progresji.

Zmiana zakresu albo skoku zapisuje się od razu w `data/config.json` i przelicza plan na danych z Hevy pobranych przy ostatnim odświeżeniu, więc trwa chwilę. Otwarcie strony, „Odśwież” i wysyłka zawsze pobierają świeże dane. Jasny i ciemny motyw zależą od ustawień systemu.

Podczas zapisu pozostałe akcje są zablokowane, a starsze odpowiedzi odświeżania nie zastępują nowszego widoku.
Jeśli połączenie urwie się podczas wysyłki, Hevy mogło już zapisać zmiany — odśwież plan i sprawdź wynik przed kolejną wysyłką.

---

## Zasady progresji (`src/engine.ts`)

Liczone są tylko serie robocze (`normal`, `failure`); rozgrzewki (`warmup`) i dropsety są pomijane.
Decyzja opiera się na **ostatniej sesji** danego ćwiczenia (przy cofaniu ciężaru także na przedostatniej).
**W** to najcięższy ciężar w ostatniej sesji.

**Zapas z RPE:** powtórzenia efektywne = powtórzenia + (10 − RPE). Na przykład 10 powt. przy RPE 8 liczy się jak 12.
Seria bez RPE nie ma zapasu, więc liczy się tak, jak została zrobiona.

| Sytuacja | Decyzja |
|---|---|
| Wszystkie serie na W i każda ma powtórzenia efektywne ≥ górna granica | następny dostępny ciężar, cel = dolna granica |
| …i któraś seria miała zapas z RPE | nowy ciężar = większy z: następny krok albo ciężar na `dolna granica + 2` powt. z e1RM, zaokrąglony w dół do dostępnych. RPE podnosi e1RM najwyżej o 10% |
| …ale któraś seria miała RPE > `maxRpe` (domyślnie 9) | ciężar zostaje, cel = górna granica (za mały zapas) |
| …ale to największy dostępny ciężar | ciężar zostaje |
| …ale nie ustawiono skoku | ćwiczenie pominięte, komunikat „wybierz skok” |
| Nie wszystkie serie doszły do górnej granicy | ciężar zostaje, **+1 powt. tylko w najsłabszej serii** (przy remisie w pierwszej z nich), każda seria co najmniej dolna granica, najwyżej górna (9/8/7 → 9/8/8; 11/10 → 11/11) |
| Któraś seria była na mniejszym ciężarze niż W | lżejsza seria liczy się jak najsłabsza seria na W, potem drabinka jak wyżej (70×12, 70×11, 80×10 → 80 kg × 11/10/10) |
| Najlepsza seria poniżej dolnej granicy, 1. raz | ciężar zostaje, cel jak wyżej (w praktyce dolna granica) |
| Poniżej dolnej granicy, 2. raz z rzędu na tym samym ciężarze | cofnięcie o jeden dostępny ciężar |
| Brak ciężaru (masa ciała, czas, dystans) / brak historii / `exclude` | pominięte |

**e1RM** (szacowany ciężar na 1 powtórzenie): Brzycki do 10 powt. (`w × 36 / (37 − r)`), Epley od 11 (`w × (1 + r / 30)`).
Oba wzory dają ten sam wynik przy 10 powt. Powyżej 15 powt. szacunek przestaje rosnąć.

Przykłady (zakres 8–12, skok 5 kg):

| Ostatnia sesja | Decyzja |
|---|---|
| 80×12, 80×12 | 85 kg × 8/8 |
| 80×12 @RPE 6, 80×12 @RPE 6 | 90 kg × 8/8 (e1RM 120 kg) |
| 80×10 @RPE 8, 80×10 @RPE 8 | 85 kg × 8/8 (10 + 2 zapasu = 12) |
| 80×12 @RPE 10, 80×12 @RPE 9 | 80 kg × 12/12 (hamulec `maxRpe`) |
| 80×15, 80×15 (bez RPE) | 85 kg × 8/8 (bez RPE zawsze jeden krok) |

Ciężar w routine jest ustawiany na **wszystkie serie robocze jednakowo**, a powtórzenia **dla każdej serii osobno**.
Gdy routine ma więcej serii roboczych niż ostatni trening, dodatkowe serie dostają cel ostatniej serii.

Skąd te reguły:
- **[ARF](https://arf.edu.pl/jak-progresowac-na-silowni/):** więcej kg dopiero, gdy wszystkie serie dojdą do górnej granicy.
  Za postęp wystarczy jedno powtórzenie w jednej serii. Jedna słabsza sesja to jeszcze nie powód do cofnięcia.
- **[Gravl](https://gravl.ai/blog/how-gravl-algorithm-works):** e1RM, ocena wysiłku (tu z RPE), limit +10% na trening.
  Brak oceny traktujemy jak „ciężko”, czyli jak zwykłą podwójną progresję.
- **Backtest na własnej historii:** drabinka „+1 w najsłabszej serii” trafiała w kolejny trening 12 razy na 38,
  a wcześniejsza „+1 w każdej serii” tylko 3 razy na 38.

---

## Backtest (`npm run backtest`)

Odtwarza decyzje algorytmu na Twojej historii z Hevy: dla każdej sesji ćwiczenia pokazuje, co zaleciłby algorytm
i co zrobiłeś w następnym treningu. **Tylko odczyt**, nic nie trafia do Hevy.

```
## Wyciskanie nogami (maszyna) · 8–12 · bez skoku
  70×12 70×11 80×10      → hold 80 kg × 11/10/10      → 70×14 70×13 70×12      ↓
  90×9 90×8 90×7         → hold 90 kg × 9/8/8         → 80×11 80×10 80×10      ↓
  podsumowanie: = 1 · ↑ 2 · ↓ 3 · pominięte 2
```

- `=` trafione: następny trening na zaleconym ciężarze i każda seria ≥ celu.
- `↑` zrobiłeś cięższy ciężar, niż zalecał algorytm.
- `↓` lżejszy ciężar albo któraś seria poniżej celu.
- `·` brak zalecenia (pominięte ćwiczenie).

Raport jest powtarzalny, więc zmianę reguł sprawdzisz porównaniem raportów z przed i po zmianie:

```bash
npm run -s backtest > data/backtest-przed.txt
# … zmiana w src/engine.ts …
npm run -s backtest | diff data/backtest-przed.txt -
```

W Dockerze: `docker compose exec hevy-companion node src/backtest.ts`.
Raporty zawierają Twoje dane treningowe. Pliki `data/backtest-*.txt` są w `.gitignore`.

---

## Powiadomienia przez n8n (bez zmian w aplikacji)

Aplikacja nie wysyła powiadomień sama. Wystarczy zewnętrzny harmonogram, np. [n8n](https://n8n.io):
1. **Schedule Trigger** co kilka godzin.
2. **HTTP Request** `GET http://<host>:3000/api/plan`.
3. Dla każdej routine z `routines[]`: jeśli któreś ćwiczenie ma `changed: true`, a `fingerprint` routine jest inny niż przy
   ostatnim powiadomieniu, wyślij powiadomienie (Telegram, ntfy, e-mail) i zapamiętaj `fingerprint`, np. w zmiennych n8n.

`changed` zostaje `true` do czasu wysyłki do Hevy, dlatego trzeba zapamiętywać `fingerprint`. Inaczej powiadomienie powtarzałoby się co uruchomienie.
`GET /api/plan` tylko czyta dane i nic nie zapisuje.

---

## Konfiguracja (`data/config.json`)

Plik tworzy UI. Można go też edytować ręcznie (wzór: `data/config.example.json`). Jest czytany przy każdym
odświeżeniu, więc restart nie jest potrzebny.

```json
{
  "defaults":  { "min": 8, "max": 12, "maxRpe": 9 },
  "equipment": { "dumbbell": [[1, 10, 1], [12.5, 60, 2.5]] },
  "exercises": {
    "75A4F6C4": { "increment": 5, "min": 12, "max": 15 },
    "C7973E0E": { "weights": [[10, 300, 10]] },
    "C6C9B8A0": { "exclude": true }
  }
}
```

- `equipment`: dostępne ciężary per typ sprzętu z Hevy (`dumbbell`, `machine`, `barbell`, …), jako listy `[od, do, krok]`.
  Domyślnie są tylko hantle: 1–10 kg co 1 kg, potem 12,5–60 co 2,5.
  Zakresy wymagają skończonych liczb, `0 ≤ od ≤ do` i dodatniego kroku; rozwinięta lista może mieć najwyżej 10000 pozycji.
  Niepoprawny zakres zgłasza błąd zamiast blokować serwer.
- `exercises.<id>`: ustawienia ćwiczenia. Kluczem jest `exercise_template_id` z Hevy.
  - `increment`: stały skok w kg (ustawiany z UI).
  - `weights`: własna lista ciężarów `[od, do, krok]`, tylko ręcznie. Wybór skoku w UI ją kasuje.
  - `min` / `max`: zakres powtórzeń (ustawiany z UI).
  - `maxRpe`: limit RPE od 1 do 10 (ustawiany z UI; puste pole usuwa nadpisanie).
  - `exclude`: wykluczenie z progresji (ustawiane z UI).

**Kolejność ważności:**
- zakres powtórzeń: `exercises` > rep range ustawiony w routine w Hevy > `defaults`;
- ciężary: `exercises.weights` > `exercises.increment` > `equipment`.

---

## Architektura

```
przeglądarka (public/index.html, vanilla JS)
   │  GET  /api/plan                      → plan dla wszystkich routine
   │  POST /api/exercises/:id/settings    → zapis zakresu / skoku / RPE / wykluczenia
   │  POST /api/routines/:id/push         → wysłanie zaznaczonych zmian do Hevy
   │  GET  /api/routines/:id/backup       → pobranie kopii ostatniej wysyłki
   ▼
src/server.ts  (node:http, bez frameworka)
   ├─ loadConfig / saveExercise  ↔  data/config.json  (zapis atomowy: .tmp + rename)
   ├─ kopia i historia wysyłki   ↔  data/history.json (obok CONFIG_PATH)
   ├─ PL_NAMES                   ←  src/exercises-pl.json
   ├─ src/engine.ts              (czysta logika: reguły progresji, budowa body do PUT)
   └─ src/hevy.ts                (klient API Hevy, fetch)
         ▼
   https://api.hevyapp.com/v1  (nagłówek api-key)
```

### Pliki

| Plik | Co robi |
|---|---|
| `src/engine.ts` | Reguły progresji (`nextTarget`), e1RM (`e1rm`, `weightFor`, `snapDown`), dostępne ciężary (`expandWeights`), body do zapisu routine (`toPutBody`). Bez I/O, w pełni testowalne. |
| `src/backtest.ts` | `npm run backtest`: odtworzenie decyzji silnika na historii z Hevy (`replay`, `report`). Tylko odczyt. |
| `src/*.test.ts` | Testy silnika, historii, endpointów HTTP i logiki interfejsu (`node:test`). Hevy jest zastąpione atrapą, a ustawienia testów trafiają do katalogu tymczasowego. |
| `src/hevy.ts` | Klient Hevy: routine'y, ostatnie 3 sesje robocze każdego ćwiczenia, szablony ćwiczeń (sprzęt, miniatura; cache w pamięci), zapis routine. |
| `src/server.ts` | Serwer HTTP: składa plan, obsługuje config, endpointy i zabezpieczenia. |
| `public/index.html` | Cały frontend: HTML, CSS i JS w jednym pliku, z jasnym i ciemnym motywem. |
| `PRODUCT.md` | Opis produktu i zasady projektowe interfejsu. |
| `SPEC.md`, `tasks/` | Specyfikacja algorytmu (e1RM, RPE, backtest) i plan zadań. |
| `dockerhub-description.md` | Opis repozytorium na Docker Hub. |
| `docker-compose.yml` | Uruchomienie z gotowego obrazu z Docker Hub. |
| `src/exercises-pl.json` | Mapa `exercise_template_id → polska nazwa` (454 ćwiczenia wbudowane w Hevy). |
| `scripts/update-pl-names.mjs` | Odświeża `exercises-pl.json` z publicznej wersji webowej Hevy. |
| `data/config.json` | Twoje ustawienia (w `.gitignore`). |
| `data/history.json` | Ostatnia próba wysyłki każdego planu, status, kopia przed i po oraz zestawienie zmian (w `.gitignore`). |
| `data/backtest-*.txt` | Zapisane raporty backtestu do porównań (w `.gitignore`). |

### Technologie

- **Node.js 26 + TypeScript bez kompilacji:** Node od razu uruchamia `.ts` (type stripping), więc nie ma `tsc`.
  Wymaga to importów z rozszerzeniem `.ts` i składni bez `enum` / `namespace`.
- **Zero zależności:** `fetch`, `node:http`, `node:test` i `--env-file` są wbudowane w Node. Nie ma `node_modules`.
- **Frontend:** czysty HTML, CSS i JS bez bundlera i frameworka. Ciemny motyw przez `prefers-color-scheme`.
  Font Hanken Grotesk ładuje się z Google Fonts; bez internetu strona używa fontu systemowego.
- **Docker:** `node:26-alpine`; obraz to skopiowane pliki źródłowe. Budowany na `linux/amd64` i `linux/arm64`.

### Hevy API: używane endpointy

| Endpoint | Po co |
|---|---|
| `GET /v1/routines?page&pageSize=10` | lista routine (stronicowana) |
| `GET /v1/workouts?page&pageSize=10` | historia, od najnowszych; przestaje czytać, gdy ma 3 sesje robocze każdego ćwiczenia (backtest: 50), max 30 stron = 300 treningów |
| `GET /v1/exercise_templates/{id}` | `equipment` i `thumbnail_url` |
| `PUT /v1/routines/{id}` | zapis routine |

Specyfika API, o której trzeba pamiętać:
- **Treningi mają `routine_id: null`**, więc historia jest dopasowywana po `exercise_template_id`, a nie po routine.
- **`PUT` nadpisuje całą listę ćwiczeń.** Dlatego `toPutBody` odsyła wszystkie ćwiczenia, z notatkami, przerwami, superseriami i rozgrzewkami.
  Pola tylko do odczytu (`index`, `title`) są usuwane, bo schemat `PUT` ich nie przewiduje.
- **`rep_range: null` daje 400**, choć specyfikacja mówi `nullable`. Dlatego pole jest wysyłane tylko w seriach, które mają zakres.
- **Nazwy są tylko po angielsku.** Polskie nazwy pochodzą z bundla JS hevy.com (pole `pl_title`), stąd `exercises-pl.json`.
- Specyfikacja OpenAPI: https://api.hevyapp.com/docs/ (osadzona w `swagger-ui-init.js`).

### Zabezpieczenia

- **Brak logowania** (świadoma decyzja). Każdy, kto ma dostęp do portu, może wysłać zmiany do Hevy.
- **Ochrona przed CSRF:** każdy `POST` wymaga `content-type: application/json`. Wymusza to preflight CORS, więc obca strona nie wywoła zapisu z Twojej przeglądarki.
- **Sprawdzanie podglądu przy wysyłce:** serwer przelicza plan od nowa i porównuje go z `fingerprint` z podglądu. Jeśli coś się zmieniło
  (nowy trening, edycja routine w Hevy, zmiana configu), odpowiada `409` i nic nie wysyła.
- **Potwierdzenie utraty notatki:** wysyłka z UI wymaga potwierdzenia ostrzeżenia, a endpoint push wymaga pola `acknowledgeNoteLoss: true` obok `fingerprint`.
- **Wybór ćwiczeń:** endpoint push wymaga tablicy `selected` z pozycjami ćwiczeń w podglądzie (liczonymi od 0).
  Odrzuca pozycje powtórzone, nieistniejące i ćwiczenia bez zmian; pusta tablica niczego nie zapisuje.
- **Kopia i równoległe zapisy:** kopia powstaje przed zapisem w Hevy. Druga wysyłka tego samego planu w trakcie pierwszej dostaje `409`.
- Wartości z UI są walidowane: skok musi być z listy `STEPS`, zakres z listy `RANGES`, RPE liczbą od 1 do 10, a wykluczenie wartością logiczną.
- Klucz Hevy jest tylko w `.env` (lokalnie) albo w `environment:` w compose. Nie ma go w gicie ani w obrazie Dockera.

---

## Stan i znane ograniczenia

- Zapis sprawdzony na żywo na testowej kopii routine: notatki ćwiczeń, superserie, przerwy, rozgrzewki, dropsety i rep range zostają bez zmian, a zmieniają się tylko ciężar i powtórzenia serii roboczych.
- **Notatka całej routine znika po zapisie** (sprawdzone na testowej kopii). `GET /routines` jej nie zwraca, więc nie da się jej odesłać.
  Interfejs pokazuje ostrzeżenie i wymaga potwierdzenia przed wysyłką. Notatki ćwiczeń są zachowywane.
  Kopia bezpieczeństwa także nie zawiera notatki całej routine i nie pozwala jej odzyskać. Kopię JSON można pobrać;
  aplikacja nie ma automatycznego przywracania planu z pliku.
- **Rep range ustawiony w Hevy jest odsyłany bez zmian, a aplikacja Hevy pokazuje wtedy zakres (np. „8-12 powt.”), nie cel powtórzeń.** Ciężar zmienia się normalnie. Cel powtórzeń widać tylko tutaj.
- **Ćwiczenia bez ciężaru** (plank, cardio, masa ciała) są pomijane.
- Gdy ćwiczenie nie wystąpiło w ostatnich 300 treningach, pokazuje „brak historii”.
- `exercises-pl.json` zależy od wewnętrznego układu hevy.com. Gdy Hevy go zmieni, skrypt odświeżania zgłosi błąd, ale aplikacja dalej działa na zapisanym pliku.
- Ćwiczenie w kilku routine'ach ma wspólne ustawienia, bo są przypisane do ćwiczenia, a nie do routine.

## Do zrobienia (pomysły, kolejność według przydatności)

- [x] Odznaczanie pojedynczych ćwiczeń przed wysyłką.
- [x] Znacznik zastoju w ostatnich 3 porównywalnych sesjach, bez wpływu na decyzję.
- [x] Historia ostatniej wysyłki każdego planu z kopią poprzednich wartości do pobrania.
- [ ] Osobny ciężar dla każdej serii, dla piramid i serii typu „top set” (powtórzenia już są liczone osobno).
- [x] e1RM i RPE w stylu Gravl: zapas z RPE liczy się jako powtórzenia, przy wyraźnym zapasie skok większy niż jeden krok.
- [x] Drabinka +1 w najsłabszej serii i poprawka serii na różnych ciężarach (wybrane backtestem).
- [x] `npm run backtest`: sprawdzanie reguł na własnej historii.
- [ ] Strojenie progów RPE (cel `dolna granica + 2`, limit +10%, 15 powt.) backtestem po 2–3 tygodniach wpisywania RPE.
- [ ] Progresja ćwiczeń z masą ciała i na czas (np. +5 s planka).
- [x] Ustawienia `maxRpe` i `exclude` w UI.
- [x] Powiadomienie o nowych zmianach: przepis na n8n z `GET /api/plan` (sekcja „Powiadomienia przez n8n”).
- [ ] Spadek po przerwie: po ponad 2 tygodniach bez ćwiczenia cel ok. 1% niżej za każdy tydzień (jak w Gravl).
- [ ] Deload: ręczny przełącznik („lżejszy tydzień”: mniej serii i mniejszy ciężar), zgodnie z ARF, czyli nie z automatu co N tygodni.
  Treningi deload nie powinny wpływać na decyzje (sposób oznaczania w Hevy do ustalenia).
- [ ] Periodyzacja i inne metody z Periodize (RPE-based, wave loading), jeśli będą potrzebne.

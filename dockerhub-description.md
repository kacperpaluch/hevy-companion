# Hevy Companion

Prywatna aplikacja webowa do **podwójnej progresji (double progression)** na bazie danych z [Hevy](https://hevy.com).

- Pobiera Twoje routine'y i historię treningów przez API Hevy.
- Dla każdego ćwiczenia liczy następny cel: ciężar i powtórzenia **dla każdej serii osobno**, i pisze, dlaczego.
- Pokazuje podgląd zmian. Nic nie trafia do Hevy, dopóki nie klikniesz „Wyślij do Hevy”.
- Ciężar rośnie dopiero, gdy wszystkie serie dojdą do górnej granicy zakresu (zgodnie z [ARF](https://arf.edu.pl/jak-progresowac-na-silowni/)).

Potrzebny jest klucz API Hevy (Hevy Pro: Settings → Developer → API key).

## Uruchomienie

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

```bash
docker compose up -d   # http://localhost:3000
```

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `HEVY_API_KEY` | — | Klucz API Hevy. **Wymagany.** |
| `PORT` | `3000` | Port wewnątrz kontenera. |
| `TZ` | — | Strefa czasowa. |

Ustawienia zapisują się w `/app/data/config.json` (wolumen). Aplikacja nie ma logowania: **nie wystawiaj portu do internetu**, tylko sieć domowa albo VPN.

## Tagi

- `latest`: najnowsza wersja.
- `<hash commita>`: stała wersja do rollbacku.

Platformy: `linux/amd64`, `linux/arm64`.

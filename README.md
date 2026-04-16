# Faelleshus TV (Webapp mode)

Ren lokal webapp-løsning:
- TV visning: `tv/`
- Telefon kontrolpanel: `controller/`
- Node.js server + API: `server/`

## Start
```bash
npm install
npm start
```

## Åbn på lokalnet
1. Find din computer-IP (macOS):
```bash
ipconfig getifaddr en0
```
2. Åbn på LG TV browser:
```text
http://<DIN_IP>:3000/tv/
```
3. Åbn på telefon:
```text
http://<DIN_IP>:3000/control
```

## API
- `GET /state`
- `POST /update`
- `GET /resolve-video?url=<DR_URL>` (intern brug: forsøger at finde direkte DR stream)

## Supabase (offentlig adgang uden lokalt net)
- Konfiguration ligger i [shared/supabase-config.js](/Users/simonvever/Desktop/VS code projekter/Plushusen introskærm/shared/supabase-config.js).
- `tv` og `controller` læser/skriver direkte til tabellen `app_state` (`id = 'main'`).
- Realtime bruges automatisk hvis tabellen er slået til i Supabase Realtime.

Body eksempel:
```json
{
  "videoUrl": "https://youtube.com/...",
  "tickerText": "Husk fællesspisning kl 18",
  "tickerBg": "#ff0000",
  "tickerColor": "#ffffff"
}
```

## DR links
- Appen forsøger automatisk at hente en direkte DR videostrøm (m3u8/mp4) via serveren.
- Hvis direkte stream ikke kan findes (fx DRM/beskyttet indhold), falder den tilbage til iframe.
- Hvis du har `yt-dlp` installeret på server-maskinen, bruges den automatisk som ekstra fallback til at finde stream-url.

## Struktur
```text
project/
 ├── tv/
 │   ├── index.html
 │   ├── style.css
 │   └── app.js
 ├── controller/
 │   ├── index.html
 │   └── controller.js
 └── server/
     └── server.js
```

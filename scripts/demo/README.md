# Demo video

How `docs/demo/resellflow-demo.mp4` and `.gif` are made. Everything runs in Docker
against a **separate, throwaway stack** filled with made-up data, so your real
database is never touched or shown.

| File | What it does |
|---|---|
| `seed-demo.py` | Prints SQL for a fictional year of purchases, lots, sales and expenses |
| `record.mjs` | Drives the app in headless Chromium (real clicks, fake cursor, captions) and saves a screencast |
| `encode.py` | Turns the screencast frames into the MP4 and the README GIF |
| `Dockerfile` | Recorder image: Playwright's Chromium + ffmpeg |

## Regenerate it

Run from the repo root. `demo.env` is a scratch env file (not the real `.env`) with
throwaway secrets, `ADMIN_EMAIL=demo@resellflow.test`,
`ADMIN_PASSWORD=demo-password-123`, `APP_PORT=3940` and `APPDATA=./demo-data` (its
own data folder — never point it at `./dev-data` or the real data, or the demo
seed lands in your database). `demo.override.yml` just sets
`services.app.image: resellflow:demo` so the demo build doesn't replace your image.

```bash
# 1. Start an isolated demo stack (own project name, own ./demo-data, port 3940)
docker compose -p resellflow-demo --env-file demo.env -f docker-compose.yml -f demo.override.yml up -d --build db app

# 2. Load the fictional data into it
python3 scripts/demo/seed-demo.py | docker exec -i resellflow-demo-db-1 psql -q -v ON_ERROR_STOP=1 -U resell -d resellflow

# 3. Build the recorder and record (SHOTS=1 for a screenshot-per-scene dry run)
docker build -t resellflow-recorder scripts/demo
docker run --rm --network resellflow-demo_default -v "$PWD/scripts/demo:/rec/src:ro" -v "$PWD/demo-out:/out" \
  resellflow-recorder sh -c "cp src/record.mjs . && node record.mjs && python3 src/encode.py /out"

# 4. Copy the results into docs/demo/, then tear the demo stack down
cp demo-out/resellflow-demo.mp4 demo-out/resellflow-demo.gif docs/demo/
docker compose -p resellflow-demo --env-file demo.env down && rm -rf demo-data
```

The walkthrough creates a lot, records a sale and bulk-edits items, so reseed (or
tear down, delete `demo-data/` and start over) before recording again.

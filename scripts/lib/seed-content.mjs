// Content for the screenshot/demo seeds (scripts/seed-showcase.mjs, scripts/seed-demo.mjs).
// Plain data and string builders only: no dependencies, so the demo seed runs in a bare Node image.
// Checklist items stay plain text: rendered mode does not yet format inline markdown inside "- [ ]".

export const bannerSvg = () => {
	const W = 1600, H = 640, horizon = 430;
	const stars = Array.from({ length: 70 }, (_, i) => {
		const x = (i * 211 + 37) % W, y = (i * 97 + 11) % 120, r = (i % 3 === 0) ? 1.6 : 1;
		return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${0.25 + (i % 5) * 0.12}"/>`;
	}).join('');
	const ridge = (pts, fill) => `<polygon points="0,${horizon} ${pts} ${W},${horizon}" fill="${fill}"/>`;
	const far = '0,330 120,280 230,310 340,240 450,290 560,215 680,275 790,230 900,285 1010,205 1130,265 1250,225 1370,280 1480,245 1600,290';
	const mid = '0,370 150,300 260,345 390,275 520,340 640,300 760,355 880,290 1000,345 1130,280 1260,340 1380,305 1500,350 1600,320';
	const near = '0,410 100,360 200,395 330,345 460,400 600,370 720,405 850,355 980,400 1100,365 1240,410 1360,372 1480,402 1600,380';
	const trees = Array.from({ length: 26 }, (_, i) => {
		const x = 20 + i * 63 + ((i * 37) % 25), h = 38 + ((i * 53) % 34), w = h * 0.42;
		return `<polygon points="${x},${horizon - h} ${x - w / 2},${horizon} ${x + w / 2},${horizon}" fill="#0f1712"/>`;
	}).join('');
	const scene = `${ridge(far, 'url(#far)')}${ridge(mid, 'url(#mid)')}${ridge(near, 'url(#near)')}${trees}`;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
	<defs>
		<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#16203d"/><stop offset="0.16" stop-color="#3a3b66"/>
			<stop offset="0.3" stop-color="#9a5b72"/><stop offset="0.42" stop-color="#e48a5a"/>
			<stop offset="0.55" stop-color="#f7c47c"/><stop offset="1" stop-color="#f7c47c"/>
		</linearGradient>
		<radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
			<stop offset="0" stop-color="#fff4d6"/><stop offset="0.25" stop-color="#ffd58a" stop-opacity="0.9"/>
			<stop offset="1" stop-color="#f3a35f" stop-opacity="0"/>
		</radialGradient>
		<linearGradient id="far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b5a78"/><stop offset="1" stop-color="#4d4560"/></linearGradient>
		<linearGradient id="mid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f3a50"/><stop offset="1" stop-color="#2c2a3b"/></linearGradient>
		<linearGradient id="near" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#232733"/><stop offset="1" stop-color="#181c24"/></linearGradient>
		<linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#e09a62" stop-opacity="0.55"/><stop offset="0.4" stop-color="#3a3c58" stop-opacity="0.85"/>
			<stop offset="1" stop-color="#10131d"/>
		</linearGradient>
	</defs>
	<rect width="${W}" height="${H}" fill="url(#sky)"/>
	${stars}
	<circle cx="1180" cy="195" r="260" fill="url(#sun)"/>
	<circle cx="1180" cy="195" r="48" fill="#fff1cf"/>
	${scene}
	<g transform="translate(0 ${2 * horizon}) scale(1 -1)" opacity="0.38">${scene}</g>
	<rect y="${horizon}" width="${W}" height="${H - horizon}" fill="url(#water)"/>
	${Array.from({ length: 9 }, (_, i) => `<rect x="${1010 + (i % 3) * 30 - i * 4}" y="${horizon + 14 + i * 19}" width="${200 - i * 16}" height="2" fill="#ffe0a8" opacity="${0.5 - i * 0.045}"/>`).join('')}
</svg>`;
};

export const backupBody = () => `Run on the first Sunday of every month. It takes about ten minutes.

## Checklist

- [x] Confirm last night's dump exists and is not empty
- [x] Copy the newest dump to the external drive
- [ ] Restore it into a scratch database
- [ ] Open a few notes in Joplock and spot-check them
- [ ] Rotate the external drive with the one at the office

## Restore test

\`\`\`bash
createdb joplin_restore_test
pg_restore -d joplin_restore_test \\
  /backups/joplin-latest.dump
psql -d joplin_restore_test \\
  -c "select count(*) from items"
\`\`\`

> If the count looks wrong, stop and compare it with last month's number in the log.
`;

export const mainBody = ({ bannerId, csvId, backupNoteId }) => `![Mountain lake at dawn](:/${bannerId})

A small, quiet home server that keeps my notes **private**, *synced* and reachable from every device. Everything runs on one mini PC with \`docker compose\`, and the phone uses Joplock as a home-screen app.

## Setup checklist

- [x] Mini PC with a 1 TB SSD
- [x] Debian with unattended upgrades
- [x] Point the domain at the proxy
- [x] Joplin Server and Joplock running
- [ ] Nightly backups
- [ ] Test a restore on a spare machine
- [ ] Add Joplock to the phone's home screen

The backup steps live in [Backup routine](:/${backupNoteId}).

## Services

| Service | Port | Role |
|---|---|---|
| Joplin Server | 22300 | Sync |
| Joplock | 3001 | Web app |
| PostgreSQL | 5432 | Database |
| Proxy | 443 | TLS |

## docker-compose.yml

\`\`\`yaml
services:
  joplock:
    image: ghcr.io/abort-retry-ignore/joplock
    restart: unless-stopped
    ports:
      - "3001:3001"
    environment:
      JOPLIN_SERVER_ORIGIN: http://server:22300
\`\`\`

## Nightly backup

\`\`\`bash
#!/usr/bin/env bash
set -euo pipefail
stamp=$(date +%F)
pg_dump -Fc -d joplin \\
  > "/backups/joplin-$stamp.dump"
find /backups -name '*.dump' \\
  -mtime +14 -delete
\`\`\`

> **Tip:** keep one copy off-site. A backup you have never restored is only a hope.

## Notes

1. Joplock reads the same database as Joplin Server, so nothing is copied.
2. Vault notebooks are encrypted in the browser; the server never sees the password.
3. Desktop, mobile and the CLI keep working alongside it.

Inventory: [server-inventory.csv](:/${csvId}) · More on [Joplin](https://joplinapp.org)
`;

export const inventoryCsv = `device,role,cpu,ram_gb,disk_tb
mini-pc,docker host,Intel N100,16,1
nas,backups,ARM Cortex-A55,4,8
router,network,MediaTek,1,0
`;

// ---- the rest of the public demo (scripts/seed-demo.mjs) ------------------------------------

export const recipeBody = () => `Twenty minutes, one pot, and it scales well for guests.

## Ingredients (serves 2)

- [x] 200 g spaghetti
- [x] 1 lemon, zest and juice
- [ ] 50 g parmesan
- [ ] 2 tbsp butter
- [ ] Black pepper
- [ ] A handful of basil

## Method

1. Boil the pasta in well-salted water.
2. Melt the butter with the lemon zest over low heat.
3. Toss the drained pasta with the butter, the lemon juice and a splash of pasta water.
4. Stir in the parmesan off the heat until glossy.
5. Finish with pepper and torn basil.

## Timing

| Step | Minutes |
|---|---|
| Water to boil | 8 |
| Pasta | 10 |
| Sauce | 3 |

> **Tip:** keep a cup of pasta water before draining. It is what makes the sauce silky.
`;

export const roadmapBody = () => `## Goals

1. Ship the mobile layout improvements.
2. Halve the cold-start time on slow connections.
3. Publish a public demo.

## Status

| Item | Owner | Status |
|---|---|---|
| Mobile keyboard fixes | Priya | Done |
| Static compression | Sam | Done |
| Offline page | Sam | Done |
| Public demo | Alex | In progress |

## Open questions

- Which features belong in the demo's first note?
- Should every visitor get their own account?

Meeting notes live in the **Meetings** notebook inside this one.
`;

export const kickoffBody = () => `**Attendees:** Alex, Priya, Sam

## Decisions

- Weekly check-ins on Tuesday mornings.
- The design doc is the single source of truth.
- Anything not in the doc by Friday waits for the next cycle.

## Action items

- [x] Share the design doc
- [ ] Draft the API outline
- [ ] Book a demo with the support team
- [ ] Collect feedback by Friday
`;

export const syncBody = () => `## Done since last week

- Static assets are compressed and cached.
- Phones keep the mobile layout in landscape.

## Blockers

None this week.

## Next

- [ ] Write the demo welcome note
- [ ] Check the reset timer after a reboot
`;

export const travelBody = () => `## Packing

- [x] Passport
- [x] Charger and adapter
- [ ] Comfortable walking shoes
- [ ] Light jacket for the evenings
- [ ] Offline maps downloaded

## Itinerary

| Day | Plan |
|---|---|
| Friday | Alfama, sunset at a miradouro |
| Saturday | Belém and LX Factory |
| Sunday | Day trip to Sintra |

## Notes

The trams fill up by mid-morning: ride the 28 before nine.
`;

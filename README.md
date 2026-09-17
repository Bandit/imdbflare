# imdbflare

A small Cloudflare Worker API that returns IMDb ratings from the official bulk
dataset. Rating data is stored as a fixed-width binary index in R2, while a
separate sparse index provides compact top-level title details.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Bandit/imdbflare)

## API

```http
GET /title/tt0000001
```

```json
{
	"id": "tt0000001",
	"rating": 5.7,
	"votes": 2232
}
```

Unknown or invalid IDs return `404`. The API is public and sends permissive
CORS headers.

### Title details

```http
GET /title/tt33332385/details
```

```json
{
	"id": "tt33332385",
	"title": "Widow's Bay",
	"originalTitle": "Widow's Bay",
	"type": "tvSeries",
	"genres": ["Comedy", "Drama", "Horror"],
	"startYear": 2026,
	"endYear": null,
	"runtimeMinutes": 40,
	"rating": 8.1,
	"votes": 76498
}
```

Details include non-adult, top-level titles only; `tvEpisode` records and titles
marked `isAdult` are intentionally excluded. Rated top-level titles are retained
regardless of age. Unrated titles are included when their `startYear` is unknown
or is the current build year minus three or later, including future years.
Unrated records return `null` for `rating` and `votes`.

## How it works

Each numeric IMDb title ID maps to a five-byte record in `ratings.bin`:

- byte 0: rating multiplied by 10; zero means no rating
- bytes 1-4: unsigned 32-bit vote count in little-endian order

The Worker converts the numeric part of a rating request to an offset and
fetches only that five-byte record from R2. Details use a sparse hash table in
`titles.bin`: one small range read finds the record and a second reads its packed
metadata. The daily build creates both indexes from `title.ratings.tsv.gz` and
`title.basics.tsv.gz`.

## Local setup

Requires Node.js 24 and a Cloudflare account with R2 enabled.

```bash
npm install
npm test
npm run check
npm run build:index
npm run upload:index:local
npm run dev
```

The builder reads both IMDb dumps in `data/` by default. With the local Worker
running, query it at the URL printed by Wrangler:

```bash
curl http://localhost:8787/title/tt0000001
```

## Deploy to Cloudflare

Use the button above to create your own deployment. Cloudflare will copy this
repository into your GitHub account, provision the Worker and R2 bucket from
`wrangler.jsonc`, and deploy the Worker. Keep the default `imdb-ratings` bucket
name because the upload scripts use it.

The new R2 bucket starts empty, so the API will return `404` until its first data
import completes. In the copied GitHub repository:

1. Add `CLOUDFLARE_ACCOUNT_ID` under **Settings > Secrets and variables >
	Actions > Repository secrets**.
2. Create a Cloudflare API token with write access to the `imdb-ratings` R2
	bucket and add it as `CLOUDFLARE_API_TOKEN` in the same place.
3. Open **Actions > Update IMDb data**, select **Run workflow**, and wait for the
	build and upload to finish.

The workflow will then refresh the data automatically every day at 16:17 UTC.
Cloudflare Workers Builds handles future Worker deployments when changes are
pushed to the copied repository.

### Manual deployment

Authenticate Wrangler, create the R2 bucket once, upload the initial index,
and deploy the Worker:

```bash
npx wrangler login
npx wrangler r2 bucket create imdb-ratings
npm run build:index
npm run upload:index
npm run deploy
```

To use a custom domain, configure a Worker route or custom domain in the
Cloudflare dashboard after deployment.

## Daily updates

[`.github/workflows/update-ratings.yml`](.github/workflows/update-ratings.yml)
runs every day at 16:17 UTC and can also be started manually. Add these
repository secrets before running it:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`, with permission to write objects to the
	`imdb-ratings` R2 bucket

The workflow downloads both required dumps, builds both indexes in one command,
then replaces the R2 objects. Each R2 object replacement is atomic.

## Data terms

IMDb makes these datasets available for personal and non-commercial use. Check
and comply with the current [IMDb dataset terms](https://developer.imdb.com/non-commercial-datasets/)
before exposing or using this API. The generated data and downloaded dumps are
excluded from Git.

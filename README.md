# imdbflare

A small Cloudflare Worker API that returns IMDb ratings from the official bulk
dataset. Rating data is stored as a fixed-width binary index in R2, so each
request needs one five-byte range read.

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

## How it works

Each numeric IMDb title ID maps to a five-byte record in `ratings.bin`:

- byte 0: rating multiplied by 10; zero means no rating
- bytes 1-4: unsigned 32-bit vote count in little-endian order

The Worker converts the numeric part of the requested ID to an offset and
fetches only that record from R2. The current supplied dump creates an index of
about 229 MB. `title.basics.tsv.gz` is not needed for this endpoint.

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

The builder reads `data/title.ratings.tsv.gz` by default. With the local Worker
running, query it at the URL printed by Wrangler:

```bash
curl http://localhost:8787/title/tt0000001
```

## Deploy

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

## Weekly updates

[`.github/workflows/update-ratings.yml`](.github/workflows/update-ratings.yml)
runs every Sunday and can also be started manually. Add these repository
secrets before running it:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`, with permission to write objects to the
	`imdb-ratings` R2 bucket

The workflow downloads only `title.ratings.tsv.gz`, builds the complete index,
then replaces the R2 objects. R2 object replacement is atomic, so requests see
either the old or new complete index.

## Data terms

IMDb makes these datasets available for personal and non-commercial use. Check
and comply with the current [IMDb dataset terms](https://developer.imdb.com/non-commercial-datasets/)
before exposing or using this API. The generated data and downloaded dumps are
excluded from Git.

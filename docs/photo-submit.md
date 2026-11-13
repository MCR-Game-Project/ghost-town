# Photo submissions

Visitors can send a historic photograph at `/submit`. The form asks for a year, an address, the photo, and optional notes. After a photo is sent, the visitor sees: "Thanks! Your photo will be reviewed before it's added."

Nothing is added to the 3D town automatically. Approved photos are only marked accepted on the review page.

The main walk has a "Submit a photo" link in the opening menu. That is the only change to the walk itself.

## Review page

The review page is at `/admin`. It is not for the public. Sign in with the site password, stored as the Cloudflare Pages secret `GT_ADMIN_PASSWORD`. After signing in, a cookie keeps you signed in for seven days. You can also send the password with HTTP Basic authentication when calling the review API.

The page lists pending submissions first, with the photo, year, address, notes, and the time it was sent, plus Approve and Reject buttons. Approved photos appear in the Approved list. Rejected photos appear in the Rejected list.

## How it is stored

Cloudflare Pages Functions handle the form and the review API. One R2 bucket, bound as `PHOTOS`, holds both the image files and the JSON records:

- `images/<id>.jpg` (or `.png` / `.webp`)
- `submissions/<id>.json`

Each record has the year, address, notes, image key, submitted time, and a status of `pending`, `approved`, or `rejected`. No KV or D1 database is used.

## Abuse checks

The form only accepts JPG, PNG, or WebP files, up to 15 MB, and checks the file headers as well as the file type. A hidden honeypot field named `company` is ignored: if a bot fills it in, the page still says thank you, and the file is not kept. Turnstile is not wired up, so going live does not need a Turnstile site key.

## Local test

From the project folder:

```bash
npm install
npm run pages:dev
```

Then open [http://localhost:8788/submit/](http://localhost:8788/submit/) and [http://localhost:8788/admin/](http://localhost:8788/admin/). The local review password is in `.dev.vars`, which is not committed. Wrangler stores local R2 data under `.wrangler/`, also not committed.

## Go live

Do not create the bucket, set the secret, or deploy until this branch is ready to publish. When it is time:

1. Create an R2 bucket named `ghost-town-photos` in the same Cloudflare account as the `ghost-town` Pages project. Do not turn on public access; photos are served only through the signed-in review API.
2. In the Pages project **Settings → Bindings**, add an R2 bucket binding:
   - Variable name: `PHOTOS`
   - R2 bucket: `ghost-town-photos`
3. In **Settings → Environment variables**, add a secret named `GT_ADMIN_PASSWORD` for Production (and for Preview if preview deployments should work). Pick a strong password and keep it off the public site.
4. Build with the Pages scripts so the Functions are included in the upload, even if only the `dist` folder is deployed:

   ```bash
   npm ci
   npm run pages:build
   ```

   `pages:build` uses `--base=/` and writes the Functions into `dist/_worker.js`. Deploy that `dist` folder to the `ghost-town` Pages project, after a backup, the same way other Ghost Town releases are published. If you deploy from the repo root with `wrangler pages deploy dist`, Wrangler can also pick up the `functions/` folder directly; either way, a `dist`-only upload without `_worker.js` and without `functions/` will publish the form pages but not the submit or review APIs.
5. Confirm the live form at `https://ghost-town-cbu.pages.dev/submit/` and that `/admin/` asks for the password. Approved photos must not appear in the town walk on their own.

`wrangler.jsonc` names the project `ghost-town`, sets `pages_build_output_dir` to `./dist`, and declares the `PHOTOS` binding to `ghost-town-photos`. Once a deploy uses that file, it becomes the source of truth for those bindings, so the bucket should already exist first.

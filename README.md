# NoteKart

A mobile friendly college work ordering site built with HTML, CSS, vanilla JavaScript, Express, and PostgreSQL.

## Run locally on Windows

Requirements: Node.js 20.19+, pnpm 11, and PostgreSQL 18 installed in the default location (`C:\Program Files\PostgreSQL\18\bin`).

1. Run `corepack enable` and `pnpm install` in this directory. On Windows, the local setup script provisions a private PostgreSQL database in the next step.
2. Run `npm run setup:local`. This creates a private PostgreSQL cluster under `storage/`, makes a NoteKart database, applies the schema, and writes random local-only credentials to `.env`. It binds the database to localhost port 55432 and does not modify the existing PostgreSQL service.
3. Run `npm start` and open `http://localhost:3000`.
4. Create an account in the website, then log in.

Stop the isolated database with `npm run stop:local`. To use another PostgreSQL installation folder, set `POSTGRES_BIN` to its `bin` directory before running the setup script. The local setup refuses to overwrite an existing `.env` or database directory.

For another operating system or an existing PostgreSQL server, create a database, apply `database/schema.sql`, copy `.env.example` to `.env`, then configure `DATABASE_URL` and a random `SESSION_SECRET` (at least 32 characters in production). Keep `.env` private.

The `storage/` directory is private and outside `public/`. Keep it on a persistent encrypted volume with restricted OS access and backups in production. Uploads are capped at 15 MB by default (configurable with `MAX_UPLOAD_MB`, hard capped at 25 MB).

## Operations and business flow

- Registration collects the student's college, course, branch, academic year, semester, section, and enrollment number along with name and contact details. The workspace lets students edit this profile; every upload form is prefilled and the server copies the saved profile into the order record.
- Passwords use Argon2id; only `password_hash` is persisted, never the plain password or confirmation.
- After login, students land in the `/dashboard/workspace` workspace to see upload counts, order status, recent submissions, and profile details.
- Sessions live in PostgreSQL and use HttpOnly, SameSite=Lax cookies. Set HTTPS and `NODE_ENV=production` to enable Secure cookies. Set `APP_ORIGIN` to the exact public origin.
- Location rows are database driven. The schema inserts Bhopal, and only active rows are returned.
- Place COD orders immediately. A Pay Now selection creates an unpaid order marked `RAZORPAY`; checkout is available only after an operator sets a trusted `final_amount` in PostgreSQL and Razorpay credentials are configured.
- The protected Order desk is available at `/admin.html`. To enable a staff account, register it and run `npm run admin:promote -- staff@example.com` from the project directory. The staff user must log out and back in before opening the Order desk. Staff can inspect work, quote orders and move them through the allowed status transitions. No public endpoint accepts a price.
- A Pay Now order stays unavailable until staff saves a quote and Razorpay credentials are configured. COD orders can be submitted without a gateway account.
- Configure the Razorpay webhook URL as `https://your-domain/api/payments/webhook` and set the webhook secret. The order API never trusts a browser success flag.
- Order notifications go to `ritulmastkar56@gmail.com` by default and include the full student/order fields and uploaded file when it is 10 MB or smaller. Larger files still generate the details email and remain downloadable in the protected order desk. Add a sending account's SMTP password to `SMTP_PASSWORD` to enable delivery; do not put a normal Gmail account password there.
- Receipts are generated from the owned, database-backed order record as PDF or HTML. Users can download only their own order file and receipt.
- Duplicate order submissions reuse a client idempotency key and the database enforces uniqueness per account.
- Run `npm run db:migrate` to safely apply the idempotent schema, and `npm run test:integration` while the local server is running to exercise the complete COD and staff quote flow.

## API overview

`POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `PATCH /api/auth/profile`, `GET /api/locations`, `POST /api/orders`, `GET /api/orders`, `GET /api/orders/:id`, `GET /api/orders/:id/file`, `GET /api/orders/:id/receipt`, `POST /api/payments/create`, `POST /api/payments/verify`, `POST /api/payments/webhook`.

Mutating authenticated requests require the CSRF token returned by `/api/auth/me` or login in `X-CSRF-Token`. The webhook is exempt from session CSRF and instead validates the Razorpay HMAC signature.

## Deployment checklist

- Apply `database/schema.sql` with a restricted database account; keep database/network access private.
- Use HTTPS, set strong secrets, exact `APP_ORIGIN`, SMTP and Razorpay credentials through the hosting secret manager.
- Run as an unprivileged OS user. Keep `storage/` private, encrypted and backed up; define retention/deletion procedures for user documents.
- Configure Razorpay webhook and monitor email/payment delivery failures.
- Promote staff accounts only after validating their identity. `is_admin` is never set by public registration.
- Set up a persistent database and file volume, automated backups, monitoring, and an HTTPS reverse proxy before accepting real student data.

## Deploy with Docker Compose

This deployment template runs NoteKart and PostgreSQL on one Docker host. It persists both the database and uploaded files in named volumes, applies the schema before starting the app, runs the app as the unprivileged Node user, and exposes the app only on `127.0.0.1:3000` for a host TLS reverse proxy.

1. Install Docker Engine with the Compose plugin and Caddy on a Linux host. Point your domain to the host, copy `deploy/Caddyfile.example` to `/etc/caddy/Caddyfile`, and replace the example domain. Caddy obtains HTTPS certificates and forwards requests to `127.0.0.1:3000`.
2. Copy `deploy/production.env.example` to `.env.production`. Generate two separate secrets with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`; use one for `POSTGRES_PASSWORD` and one for `SESSION_SECRET`. Set `APP_ORIGIN` to your exact HTTPS origin, without a trailing slash. Keep the environment file private; `.env.*` files are ignored by Git.
3. Start the stack with `docker compose --env-file .env.production up -d --build`. The migration service applies `database/schema.sql`; the app starts only after it succeeds.
4. Check `https://your-domain/api/health`. Promote a staff account with `docker compose --env-file .env.production exec app node scripts/promote-admin.js staff@example.com` after that account has registered.
5. Back up the `postgres_data` and `notekart_uploads` volumes and test restoring both before accepting live orders.

The Compose database is reachable only over its private Docker network, so `DATABASE_SSL=disable` is set only for that internal connection. For an externally managed database, deploy the Docker image with its TLS-enabled `DATABASE_URL`, leave `DATABASE_SSL` unset, run `node scripts/apply-schema.js` as the deployment release/migration command, and mount durable storage at `/app/storage` (or replace the local storage adapter with your object-storage provider before using ephemeral/container-scaled hosting). Configure the host TLS proxy to preserve the original HTTPS scheme; production cookies are Secure.

## Current scope

The project supplies the student workspace, profile management, registration and login, file submission, COD orders, order history, ownership checks, receipts, and a role-protected order desk. Razorpay checkout and webhook verification require valid merchant configuration; online checkout is only enabled after an operator saves a quote. Configure your mail provider to send notifications.

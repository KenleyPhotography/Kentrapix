import { DurableObject } from 'cloudflare:workers';

const PORT = 3000;
const STARTUP_TIMEOUT_MS = 60_000;
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const RETRY_DELAY_MS = 250;

const REQUIRED_SECRETS = ['DATABASE_URL', 'JWT_SECRET', 'CLOUDFLARE_PROXY_SECRET'];
const OPTIONAL_ENV = [
  'DATABASE_SSL', 'SESSION_DAYS', 'MAX_UPLOAD_MB', 'MAX_RAW_UPLOAD_MB',
  'PREVIEW_WIDTH', 'APP_URL', 'CORS_ORIGINS', 'RESEND_API_KEY', 'MAIL_FROM', 'MAIL_REPLY_TO',
  'S3_REGION', 'B2_ENDPOINT', 'B2_BUCKET', 'B2_KEY_ID', 'B2_APPLICATION_KEY', 'GITHUB_TOKEN', 'GITHUB_REPO', 'GITHUB_MEDIA_BRANCH', 'GITHUB_BASE_BRANCH',
];

function dynamicPath(pathname) {
  return pathname === '/suivi' || /^\/tarifs(?:\.html|\/)?$/.test(pathname) || /^\/photographes(?:\.html|\/)?$/.test(pathname) || pathname === '/' || pathname === '/reservation' || pathname === '/reservation/' || pathname === '/reservation.html' || pathname === '/portfolio' || pathname === '/portfolio/' || pathname === '/portfolio.html' || pathname === '/api' || pathname.startsWith('/api/')
    || pathname === '/media' || pathname.startsWith('/media/')
    || pathname === '/portfolio-media' || pathname.startsWith('/portfolio-media/')
    || /^\/(login|admin|client|gallery|share|facture|f|contrat|c|studio|outdoor|graduation|evenement|mariage|gaduation|conditions|maintenance)(\/|$|\.)/.test(pathname)
    || /^\/(index|admin|client|gallery|login|share|facture|contrat|conditions)\.html$/.test(pathname)
    || pathname === '/manifest.webmanifest' || pathname === '/sw.js'
    || pathname === '/robots.txt' || pathname === '/sitemap.xml'
    || pathname === '/favicon.ico' || pathname === '/KentraPix.apk';
}

function makeContainerEnv(env) {
  const values = {
    NODE_ENV: 'production',
    PORT: String(PORT),
    HOST: '0.0.0.0',
    TRUST_PROXY: 'true',
    STORAGE_REQUIRE_REMOTE: 'true',
    STORAGE_KEEP_FILES: 'true',
    S3_REGION: 'auto',
    ...Object.fromEntries(OPTIONAL_ENV.filter((key) => env[key] !== undefined).map((key) => [key, String(env[key])])),
  };
  for (const key of REQUIRED_SECRETS) {
    if (!env[key]) throw new Error(`Cloudflare Worker secret/binding missing: ${key}`);
    values[key] = String(env[key]);
  }
  // Accept both the S3_* names and the legacy B2_* names already supported by config.js.
  values.S3_ENDPOINT = String(env.S3_ENDPOINT || env.B2_ENDPOINT || '');
  values.S3_BUCKET = String(env.S3_BUCKET || env.B2_BUCKET || '');
  values.S3_KEY_ID = String(env.S3_KEY_ID || env.B2_KEY_ID || '');
  values.S3_SECRET = String(env.S3_SECRET || env.B2_APPLICATION_KEY || '');
  if (!values.S3_ENDPOINT || !values.S3_BUCKET || !values.S3_KEY_ID || !values.S3_SECRET) {
    throw new Error('Configurez les quatre secrets S3_* ou leurs équivalents B2_* pour le bucket R2.');
  }
  return values;
}

export class KentraPixBackend extends DurableObject {
  starting;

  constructor(ctx, env) {
    super(ctx, env);
    if (ctx.container?.running) {
      void ctx.blockConcurrencyWhile(() => ctx.container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS));
    }
  }

  async fetch(request) {
    await this.startAndWaitForPort();

    const incoming = new URL(request.url);
    const upstream = new URL(request.url);
    upstream.protocol = 'http:';
    upstream.hostname = 'container';
    upstream.port = String(PORT);

    const forwarded = new Request(upstream, request);
    forwarded.headers.delete('host');
    forwarded.headers.set('x-kentrapix-proxy-secret', this.env.CLOUDFLARE_PROXY_SECRET);
    forwarded.headers.set('x-kentrapix-public-host', incoming.host);
    forwarded.headers.set('x-forwarded-host', incoming.host);
    forwarded.headers.set('x-forwarded-proto', incoming.protocol.slice(0, -1));
    const clientIp = request.headers.get('CF-Connecting-IP');
    if (clientIp) forwarded.headers.set('x-kentrapix-client-ip', clientIp);
    return this.ctx.container.getTcpPort(PORT).fetch(forwarded);
  }

  async startAndWaitForPort() {
    this.starting ??= this.startOnce().finally(() => { this.starting = undefined; });
    return this.starting;
  }

  async startOnce() {
    const container = this.ctx.container;
    if (!container.running) {
      container.start({
        image: container.images.base,
        instance: 'standard-1',
        enableInternet: true,
        env: makeContainerEnv(this.env),
      });
    }
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);

    const port = container.getTcpPort(PORT);
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    let lastError;
    while (Date.now() < deadline) {
      try {
        const response = await port.fetch(`http://container:${PORT}/api/health`, {
          signal: AbortSignal.timeout(2_000),
        });
        await response.body?.cancel();
        if (response.ok) return;
        lastError = new Error(`Backend health check returned ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await scheduler.wait(RETRY_DELAY_MS);
    }
    throw new Error('KentraPix backend did not become ready within 60 seconds', { cause: lastError });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (dynamicPath(url.pathname)) {
      try {
        return await env.KENTRAPIX_BACKEND.getByName('primary').fetch(request);
      } catch (error) {
        const rayId = request.headers.get('cf-ray');
        console.error('KentraPix container request failed', {
          rayId,
          message: error.message,
          cause: error.cause?.message,
        });
        const headers = { 'Cache-Control': 'no-store' };
        if (rayId) headers['X-KentraPix-Ray'] = rayId;
        if (url.pathname === '/api/health') {
          return Response.json({ ok: false, error: 'backend_unavailable' }, { status: 503, headers });
        }
        return new Response('KentraPix est temporairement indisponible.', { status: 503, headers });
      }
    }
    return env.ASSETS.fetch(request);
  },
};

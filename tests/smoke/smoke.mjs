// NexusOS smoke test — WP1 (build & boot hardening). Runs against a live server.
// Prints one PASS/FAIL line per check and a final summary. Never throws.
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const OWNER = process.env.OWNER_SECRET || '';
let pass = 0, fail = 0;
const results = [];
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; results.push(`PASS  ${name}`); }
  else { fail++; results.push(`FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
};
const get = async (path, opts = {}) => {
  try {
    const r = await fetch(BASE + path, { redirect: 'manual', ...opts });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, headers: r.headers, text, json };
  } catch (e) { return { status: 0, headers: new Headers(), text: String(e), json: null }; }
};
const short = (s, n = 140) => String(s).replace(/\s+/g, ' ').slice(0, n);

// ── 1. health ────────────────────────────────────────────────────────────────
{
  const r = await get('/api/health');
  ok('health returns 200 + healthy', r.status === 200 && r.json?.status === 'healthy', `${r.status} ${short(r.text)}`);
  ok('health reports database provider', !!r.json?.checks?.database?.provider, short(JSON.stringify(r.json?.checks?.database)));
  console.log('INFO database:', JSON.stringify(r.json?.checks?.database), 'firebaseAdmin:', JSON.stringify(r.json?.checks?.firebaseAdmin), 'rateLimiter:', JSON.stringify(r.json?.checks?.rateLimiter));
  const l = await get('/api/health/live');  ok('liveness 200', l.status === 200);
  const rd = await get('/api/health/ready'); ok('readiness 200', rd.status === 200, short(rd.text));
}

// ── 2. the web app itself ────────────────────────────────────────────────────
let jsAsset = null;
{
  const r = await get('/');
  ok('home page 200 html', r.status === 200 && /<div id="root">/.test(r.text), `${r.status} ${short(r.text)}`);
  ok('home page: Cache-Control no-cache', /no-cache/.test(r.headers.get('cache-control') || ''), r.headers.get('cache-control'));
  ok('security header: nosniff', r.headers.get('x-content-type-options') === 'nosniff');
  ok('security header: CSP present', !!r.headers.get('content-security-policy'));
  ok('no X-Powered-By', !r.headers.get('x-powered-by'));
  const m = r.text.match(/src="(\/assets\/[^"]+\.js)"/);
  jsAsset = m ? m[1] : null;
  ok('index.html references a hashed JS asset', !!jsAsset, short(r.text, 300));
  const deep = await get('/store/global?x=1');
  ok('deep link serves the app shell (SPA fallback)', deep.status === 200 && /<div id="root">/.test(deep.text), `${deep.status}`);
  for (const f of ['/favicon.svg', '/icon-192.png', '/manifest.webmanifest']) {
    const a = await get(f);
    ok(`static file ${f} 200`, a.status === 200, `${a.status}`);
  }
}
if (jsAsset) {
  const r = await fetch(BASE + jsAsset, { headers: { 'accept-encoding': 'gzip' } });
  const buf = await r.arrayBuffer();
  ok('JS asset 200 javascript', r.status === 200 && /javascript/.test(r.headers.get('content-type') || ''), `${r.status} ${r.headers.get('content-type')}`);
  ok('JS asset immutable long cache', /immutable/.test(r.headers.get('cache-control') || '') && /max-age=31536000/.test(r.headers.get('cache-control') || ''), r.headers.get('cache-control'));
  console.log('INFO js asset', jsAsset, 'bytes(on wire)=', buf.byteLength, 'content-encoding=', r.headers.get('content-encoding'));
  const missing = await get('/assets/does-not-exist-123.js');
  ok('missing /assets file is a real 404 (not index.html)', missing.status === 404, `${missing.status} ${short(missing.text, 60)}`);
}

// ── 3. API routing ───────────────────────────────────────────────────────────
{
  const r = await get('/api/this-does-not-exist');
  ok('unknown /api path -> JSON 404', r.status === 404 && r.json?.error, `${r.status} ${short(r.text)}`);
  const v1 = await get('/api/v1/health');
  ok('/api/v1/health alias works', v1.status === 200 && v1.json?.status === 'healthy', `${v1.status} ${short(v1.text)}`);
  // routes registered AFTER the old SPA catch-all used to return the home page
  for (const p of ['/api/vendor/products', '/api/vendor/orders', '/api/vendor/store']) {
    const x = await get(p);
    ok(`late-registered GET ${p} answers JSON 401/403 (not HTML)`, (x.status === 401 || x.status === 403) && x.json, `${x.status} ${short(x.text, 80)}`);
  }
  const tax = await get('/api/tax/rules?country=BD');
  ok('GET /api/tax/rules returns JSON', tax.status === 200 && tax.json?.country === 'BD', `${tax.status} ${short(tax.text, 100)}`);
  const reviews = await get('/api/reviews/some-product');
  ok('GET /api/reviews/:id returns JSON (not HTML)', !!reviews.json || reviews.status === 404, `${reviews.status} ${short(reviews.text, 80)}`);
}

// ── 4. auth ──────────────────────────────────────────────────────────────────
{
  const noTok = await get('/api/admin/diagnostic');
  ok('admin route without token -> 401', noTok.status === 401, `${noTok.status}`);
  const bad = await get('/api/admin/diagnostic', { headers: { authorization: 'Bearer wrong-secret-wrong-secret' } });
  ok('admin route with wrong token -> 401', bad.status === 401, `${bad.status}`);
  const good = await get('/api/admin/diagnostic', { headers: { authorization: `Bearer ${OWNER}` } });
  ok('admin route with OWNER_SECRET -> 200', good.status === 200, `${good.status} ${short(good.text, 100)}`);
  // Information only: what the built-in self-check complains about (helps the owner/operator, never fails the run).
  if (good.json && Array.isArray(good.json.checks)) {
    const bad = good.json.checks.filter((c) => c.status === 'fail' || c.status === 'warn');
    console.log(`INFO self-check: ${good.json.overall} score=${good.json.score}/100, ${bad.length} item(s) need attention:`);
    for (const c of bad.slice(0, 20)) console.log(`INFO   [${c.status}] ${c.category}/${c.name}: ${short(c.detail, 150)}`);
  }
  const login = await get('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: 'not-a-real-token' }) });
  ok('login with a fake Firebase token -> clean 401', login.status === 401 && login.json?.error, `${login.status} ${short(login.text, 100)}`);
  const nobody = await get('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  ok('login without a token -> 400', nobody.status === 400, `${nobody.status}`);
}

// ── 5. request-size limit ────────────────────────────────────────────────────
{
  const big = JSON.stringify({ blob: 'x'.repeat(3 * 1024 * 1024) });
  const r = await get('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: big });
  ok('3 MB JSON body is refused (413)', r.status === 413, `${r.status} ${short(r.text, 80)}`);
}

// ── 6. rate limiting / proxy awareness ───────────────────────────────────────
{
  // Behind a proxy each visitor arrives with their own X-Forwarded-For. With `trust proxy`
  // set correctly they must NOT share one counter.
  const a = await get('/api/tax/rules', { headers: { 'x-forwarded-for': '203.0.113.10' } });
  const b = await get('/api/tax/rules', { headers: { 'x-forwarded-for': '203.0.113.11' } });
  const ra = Number(a.headers.get('x-ratelimit-remaining')), rb = Number(b.headers.get('x-ratelimit-remaining'));
  ok('two different visitors have separate limits', Number.isFinite(ra) && ra === rb, `remaining a=${ra} b=${rb}`);
  const limit = Number(a.headers.get('x-ratelimit-limit'));
  ok('anonymous per-IP limit is generous (>=1000/min)', limit >= 1000, `limit=${limit}`);
  // health must never be limited
  let healthBlocked = 0;
  for (let i = 0; i < 40; i++) { const h = await get('/api/health/live', { headers: { 'x-forwarded-for': '198.51.100.7' } }); if (h.status === 429) healthBlocked++; }
  ok('health endpoints are never rate-limited', healthBlocked === 0, `blocked=${healthBlocked}`);
  // flood from ONE address must eventually be refused, while another visitor is unaffected
  let first429 = -1;
  const N = Math.min(limit + 50, 3500);
  const FLOOD_IP = '192.0.2.99';
  for (let i = 0; i < N; i += 100) {
    const batch = await Promise.all(Array.from({ length: 100 }, () => get('/api/tax/rules', { headers: { 'x-forwarded-for': FLOOD_IP } })));
    const idx = batch.findIndex(x => x.status === 429);
    if (idx >= 0) { first429 = i + idx; break; }
  }
  ok('flooding from one address gets 429 after ~limit requests', first429 > 0, `first429 at ${first429} (limit ${limit})`);
  const other = await get('/api/tax/rules', { headers: { 'x-forwarded-for': '203.0.113.200' } });
  ok('a different visitor is unaffected by that flood', other.status === 200, `${other.status}`);
  const flooded = await get('/api/tax/rules', { headers: { 'x-forwarded-for': FLOOD_IP } });
  ok('429 carries Retry-After + bilingual message', flooded.status === 429 && !!flooded.headers.get('retry-after') && !!flooded.json?.message_bn, `${flooded.status} ${short(flooded.text, 100)}`);
}

console.log('\n==== SMOKE RESULTS ====');
for (const line of results) console.log(line);
console.log(`\nSUMMARY pass=${pass} fail=${fail}`);

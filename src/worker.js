// Bnder Notice — Cloudflare Worker (API + static assets)
const DAY = 86400000;
const KSA = 3 * 3600000; // توقيت الرياض
const STATUSES = ['new', 'review', 'referred', 'closed'];
const PRIORITIES = ['normal', 'urgent', 'critical'];

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await route(req, env, url);
    } catch (e) {
      return J({ error: 'تعذّر تنفيذ الطلب، حاول مرة أخرى', detail: String(e && e.message || e) }, 500);
    }
  }
};

async function route(req, env, url) {
  const p = url.pathname.replace(/\/+$/, '');
  const m = req.method;
  let mm;

  // ---------- عامة ----------
  if (p === '/api/login' && m === 'POST') return login(req, env);
  if (p === '/api/stats' && m === 'GET') return publicStats(env);
  if (p === '/api/reports' && m === 'POST') return createReport(req, env);
  if ((mm = p.match(/^\/api\/p\/(\d+)$/)) && m === 'GET') return photo(env, +mm[1], url.searchParams.get('s'));

  // ---------- لوحة التحكم ----------
  if (!(await checkAuth(req, env))) return J({ error: 'انتهت الجلسة، سجّل الدخول من جديد' }, 401);
  if (p === '/api/reports' && m === 'GET') return listReports(env, url);
  if ((mm = p.match(/^\/api\/reports\/(\d+)$/)) && m === 'GET') return getReport(env, +mm[1], url);
  if ((mm = p.match(/^\/api\/reports\/(\d+)\/action$/)) && m === 'POST') return act(req, env, +mm[1]);
  if (p === '/api/dashboard' && m === 'GET') return dashboard(env, url);
  if (p === '/api/entities' && m === 'GET') return listEntities(env);
  if (p === '/api/entities' && m === 'PUT') return saveEntities(req, env);
  return J({ error: 'المسار غير موجود' }, 404);
}

// ================= أدوات =================
function J(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
async function body(req) { try { return await req.json(); } catch { return {}; } }
const s = (v, n = 300) => (v == null ? '' : String(v)).trim().slice(0, n);
const num = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };

async function hmac(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const secretOf = env => (env.SESSION_SECRET || 'bnder') + '|' + (env.ADMIN_PASSWORD || '');

async function login(req, env) {
  if (!env.ADMIN_PASSWORD) return J({ error: 'لم تُضبط كلمة مرور اللوحة (ADMIN_PASSWORD) في إعدادات Cloudflare' }, 500);
  const b = await body(req);
  if (s(b.password, 200) !== env.ADMIN_PASSWORD) return J({ error: 'كلمة المرور غير صحيحة' }, 401);
  const exp = Date.now() + 12 * 3600000;
  return J({ token: exp + '.' + await hmac(secretOf(env), 'adm:' + exp), exp });
}
async function checkAuth(req, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const t = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const [exp, sig] = t.split('.');
  if (!exp || !sig || +exp < Date.now()) return false;
  return sig === await hmac(secretOf(env), 'adm:' + exp);
}
const photoSig = (env, id) => hmac(secretOf(env), 'photo:' + id);

// ================= البلاغ (عام) =================
async function createReport(req, env) {
  const b = await body(req);
  if (env.REPORT_KEY && s(b.key, 100) !== env.REPORT_KEY)
    return J({ error: 'رابط الإبلاغ غير صالح، اطلب الرابط الصحيح من المشرف' }, 403);

  const r = {
    mosque: s(b.mosque, 40), zone: s(b.zone, 80), floor: s(b.floor, 40),
    gate: s(b.gate, 40), spot: s(b.spot, 200),
    lat: num(b.lat), lng: num(b.lng), acc: num(b.acc),
    category: s(b.category, 40), category_label: s(b.category_label, 80), entity_id: s(b.entity_id, 40),
    priority: PRIORITIES.includes(b.priority) ? b.priority : 'normal',
    details: s(b.details, 1500), reporter_name: s(b.reporter_name, 80), reporter_phone: s(b.reporter_phone, 20)
  };
  if (!r.mosque || !r.zone || !r.category) return J({ error: 'حدّد المكان ونوع الملاحظة قبل الإرسال' }, 400);

  const photo = typeof b.photo === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(b.photo) ? b.photo : '';
  if (photo.length > 1800000) return J({ error: 'حجم الصورة كبير، التقطها من جديد' }, 413);

  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO reports (created_at,updated_at,mosque,zone,floor,gate,spot,lat,lng,acc,category,category_label,entity_id,priority,details,reporter_name,reporter_phone,has_photo,status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new') RETURNING id`
  ).bind(now, now, r.mosque, r.zone, r.floor, r.gate, r.spot, r.lat, r.lng, r.acc, r.category, r.category_label,
    r.entity_id, r.priority, r.details, r.reporter_name, r.reporter_phone, photo ? 1 : 0).first();

  const id = row.id;
  const ref = 'BN-' + String(id).padStart(5, '0');
  const stmts = [
    env.DB.prepare('UPDATE reports SET ref=? WHERE id=?').bind(ref, id),
    env.DB.prepare('INSERT INTO events (report_id,at,action,note,actor) VALUES (?,?,?,?,?)')
      .bind(id, now, 'created', '', r.reporter_name || 'مُبلّغ ميداني')
  ];
  if (photo) stmts.push(env.DB.prepare('INSERT INTO photos (report_id,data) VALUES (?,?)').bind(id, photo));
  await env.DB.batch(stmts);
  return J({ ok: true, id, ref, created_at: now });
}

async function publicStats(env) {
  const now = Date.now();
  const start = Math.floor((now + KSA) / DAY) * DAY - KSA;
  const [a, b, c] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) c FROM reports WHERE created_at>=?').bind(start),
    env.DB.prepare("SELECT COUNT(*) c FROM reports WHERE status='closed' AND closed_at>=?").bind(start),
    env.DB.prepare("SELECT AVG(closed_at-created_at) a FROM reports WHERE status='closed' AND closed_at>=?").bind(now - 30 * DAY)
  ]);
  return J({
    today: a.results[0].c,
    closed_today: b.results[0].c,
    avg_close_ms: c.results[0].a ? Math.round(c.results[0].a) : null
  });
}

async function photo(env, id, sig) {
  if (!sig || sig !== await photoSig(env, id)) return new Response('رابط الصورة غير صالح', { status: 403 });
  const row = await env.DB.prepare('SELECT data FROM photos WHERE report_id=?').bind(id).first();
  if (!row) return new Response('لا توجد صورة', { status: 404 });
  const mt = row.data.match(/^data:(image\/[a-z]+);base64,(.*)$/);
  if (!mt) return new Response('صيغة غير معروفة', { status: 415 });
  const bin = atob(mt[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: { 'content-type': mt[1], 'cache-control': 'private, max-age=86400' } });
}

// ================= لوحة التحكم =================
async function listReports(env, url) {
  const q = url.searchParams;
  const where = [], binds = [];
  const st = q.get('status');
  if (st === 'open') where.push("status!='closed'");
  else if (STATUSES.includes(st)) { where.push('status=?'); binds.push(st); }
  for (const f of ['mosque', 'entity_id', 'priority']) if (q.get(f)) { where.push(f + '=?'); binds.push(q.get(f)); }
  const since = rangeStart(q.get('range'));
  if (since) { where.push('created_at>=?'); binds.push(since); }
  const term = s(q.get('q'), 60);
  if (term) {
    where.push('(ref LIKE ? OR details LIKE ? OR zone LIKE ? OR spot LIKE ? OR gate LIKE ? OR category_label LIKE ? OR reporter_name LIKE ?)');
    for (let i = 0; i < 7; i++) binds.push('%' + term + '%');
  }
  const sql = `SELECT id,ref,created_at,updated_at,mosque,zone,floor,gate,spot,category,category_label,entity_id,priority,details,reporter_name,has_photo,status,closed_at
    FROM reports ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return J({ items: results });
}

async function getReport(env, id, url) {
  const [r, ev, ph] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM reports WHERE id=?').bind(id),
    env.DB.prepare('SELECT at,action,note,actor FROM events WHERE report_id=? ORDER BY at ASC').bind(id),
    env.DB.prepare('SELECT data FROM photos WHERE report_id=?').bind(id)
  ]);
  const report = r.results[0];
  if (!report) return J({ error: 'البلاغ غير موجود' }, 404);
  const p = ph.results[0];
  return J({
    report,
    events: ev.results,
    photo: p ? p.data : null,
    photo_link: p ? `${url.origin}/api/p/${id}?s=${await photoSig(env, id)}` : null
  });
}

async function act(req, env, id) {
  const b = await body(req);
  const r = await env.DB.prepare('SELECT id,status,entity_id FROM reports WHERE id=?').bind(id).first();
  if (!r) return J({ error: 'البلاغ غير موجود' }, 404);
  const now = Date.now();
  const note = s(b.note, 1000);
  const actor = s(b.actor, 60) || 'المشرف';
  let upd;
  switch (b.action) {
    case 'review':
      upd = env.DB.prepare("UPDATE reports SET status='review', updated_at=? WHERE id=?").bind(now, id); break;
    case 'refer': {
      const ent = s(b.entity_id, 40) || r.entity_id;
      upd = env.DB.prepare("UPDATE reports SET status='referred', entity_id=?, referred_at=?, updated_at=? WHERE id=?").bind(ent, now, now, id); break;
    }
    case 'close':
      upd = env.DB.prepare("UPDATE reports SET status='closed', closed_at=?, closure_note=?, updated_at=? WHERE id=?").bind(now, note, now, id); break;
    case 'reopen':
      upd = env.DB.prepare("UPDATE reports SET status='review', closed_at=NULL, updated_at=? WHERE id=?").bind(now, id); break;
    case 'note':
      if (!note) return J({ error: 'اكتب الملاحظة أولاً' }, 400);
      upd = env.DB.prepare('UPDATE reports SET updated_at=? WHERE id=?').bind(now, id); break;
    default:
      return J({ error: 'إجراء غير معروف' }, 400);
  }
  await env.DB.batch([
    upd,
    env.DB.prepare('INSERT INTO events (report_id,at,action,note,actor) VALUES (?,?,?,?,?)').bind(id, now, b.action, note, actor)
  ]);
  return J({ ok: true });
}

function rangeStart(range) {
  const now = Date.now();
  if (range === 'today') return Math.floor((now + KSA) / DAY) * DAY - KSA;
  if (range === '7') return now - 7 * DAY;
  if (range === '30') return now - 30 * DAY;
  return 0;
}

async function dashboard(env, url) {
  const since = rangeStart(url.searchParams.get('range'));
  const now = Date.now();
  const P = (sql, ...a) => env.DB.prepare(sql).bind(...a);
  const res = await env.DB.batch([
    P('SELECT status, COUNT(*) c FROM reports WHERE created_at>=? GROUP BY status', since),
    P('SELECT category_label l, COUNT(*) c FROM reports WHERE created_at>=? GROUP BY category_label ORDER BY c DESC LIMIT 10', since),
    P("SELECT mosque m, zone l, COUNT(*) c FROM reports WHERE created_at>=? GROUP BY mosque, zone ORDER BY c DESC LIMIT 10", since),
    P("SELECT entity_id e, COUNT(*) c, SUM(status='closed') d FROM reports WHERE created_at>=? GROUP BY entity_id ORDER BY c DESC", since),
    P("SELECT strftime('%Y-%m-%d', created_at/1000 + 10800, 'unixepoch') d, COUNT(*) c, SUM(status='closed') x FROM reports WHERE created_at>=? GROUP BY d ORDER BY d", now - 14 * DAY),
    P("SELECT CAST(strftime('%H', created_at/1000 + 10800, 'unixepoch') AS INTEGER) h, COUNT(*) c FROM reports WHERE created_at>=? GROUP BY h", since),
    P("SELECT AVG(closed_at-created_at) a, COUNT(*) n FROM reports WHERE created_at>=? AND status='closed'", since),
    P("SELECT AVG(COALESCE(referred_at, closed_at)-created_at) a FROM reports WHERE created_at>=? AND (referred_at IS NOT NULL OR closed_at IS NOT NULL)", since),
    P("SELECT priority p, COUNT(*) c FROM reports WHERE status!='closed' GROUP BY priority"),
    P("SELECT MIN(created_at) t FROM reports WHERE status!='closed'")
  ]);
  const rows = i => res[i].results;
  return J({
    status: rows(0), categories: rows(1), zones: rows(2), entities: rows(3),
    trend: rows(4), hours: rows(5),
    avg_close_ms: rows(6)[0].a, closed_n: rows(6)[0].n,
    avg_response_ms: rows(7)[0].a,
    open_priority: rows(8), oldest_open: rows(9)[0].t
  });
}

async function listEntities(env) {
  const { results } = await env.DB.prepare('SELECT * FROM entities ORDER BY sort, name').all();
  return J({ items: results });
}
async function saveEntities(req, env) {
  const b = await body(req);
  const items = Array.isArray(b.items) ? b.items.slice(0, 100) : [];
  if (!items.length) return J({ error: 'لا توجد جهات للحفظ' }, 400);
  const stmts = items.map((e, i) => env.DB.prepare(
    `INSERT INTO entities (id,name,phone,active,sort) VALUES (?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, phone=excluded.phone, active=excluded.active, sort=excluded.sort`
  ).bind(s(e.id, 40) || 'e' + Date.now() + i, s(e.name, 80) || 'جهة', s(e.phone, 20).replace(/[^\d+]/g, ''), e.active ? 1 : 0, i));
  await env.DB.batch(stmts);
  return listEntities(env);
}

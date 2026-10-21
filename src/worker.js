// Bnder Notice — Cloudflare Worker (API + static assets + email + daily digest)
const DAY = 86400000, HOUR = 3600000, KSA = 3 * HOUR;
const STATUSES = ['new', 'review', 'referred', 'closed'];
const PRIORITIES = ['normal', 'urgent', 'critical'];
const OPS_NAME = 'الإدارة العامة للعمليات بالشؤون الدينية';
const PRIO_AR = { normal: 'عادي', urgent: 'عاجل', critical: 'حرج' };
const STATUS_AR = { new: 'جديد', review: 'قيد المراجعة', referred: 'محال', closed: 'مغلق' };

// ---------- الخيارات الافتراضية (تُعدَّل من لوحة التحكم ← الإعدادات) ----------
const DEFAULT_OPTIONS = {
  zones: ['صحن المطاف', 'المسعى', 'التوسعة السعودية الأولى', 'التوسعة السعودية الثانية', 'التوسعة السعودية الثالثة',
    'الساحة الشمالية', 'الساحة الجنوبية', 'الساحة الشرقية', 'الساحة الغربية', 'الجسور والممرات', 'السلالم والمصاعد', 'دورات المياه'],
  floors: ['القبو', 'الدور الأرضي', 'الدور الأول', 'الدور الثاني', 'السطح'],
  reporters: [],
  name_mode: 'optional',                 // off | optional | required
  methods: ['تمت المعالجة ميدانياً', 'أُحيل وعالجته الجهة المختصة', 'لا يستدعي إجراء', 'بلاغ مكرر'],
  categories: [
    { id: 'security', label: 'ملاحظة أمنية', entity: 'security', icon: 'shield', quick: ['اشتباه بسلوك مخالف', 'افتراش في الممرات', 'باعة جائلون', 'تجمّع يعيق الحركة', 'تصوير مخالف'] },
    { id: 'crowd', label: 'كثافة وحشود', entity: 'crowd', icon: 'crowd', quick: ['ازدحام شديد', 'تكدّس عند الباب', 'مسار مغلق يحتاج فتح', 'حركة عكسية في المسار', 'احتمال تدافع'] },
    { id: 'cleaning', label: 'نظافة', entity: 'cleaning', icon: 'spark', quick: ['انسكاب سوائل على الأرض', 'تراكم نفايات', 'دورات المياه تحتاج تنظيف', 'روائح غير مستحبة', 'سجاد متّسخ'] },
    { id: 'maintenance', label: 'صيانة وأعطال', entity: 'maintenance', icon: 'wrench', quick: ['سلم كهربائي متوقف', 'إنارة معطلة', 'تسرب مياه', 'رخام أو بلاط متضرر', 'باب لا يعمل', 'مصعد متوقف'] },
    { id: 'hvac', label: 'تكييف', entity: 'hvac', icon: 'snow', quick: ['ضعف تبريد', 'تسرب من فتحات التكييف', 'مراوح الرذاذ متوقفة', 'حرارة مرتفعة في المكان'] },
    { id: 'safety', label: 'سلامة', entity: 'safety', icon: 'flame', quick: ['مخرج طوارئ مغلق', 'طفاية حريق مفقودة', 'أسلاك مكشوفة', 'رائحة دخان', 'عائق في ممر الطوارئ'] },
    { id: 'medical', label: 'حالة صحية', entity: 'medical', icon: 'plus', quick: ['حالة إغماء', 'إصابة سقوط', 'إجهاد حراري', 'كبير سن متعب'] },
    { id: 'zamzam', label: 'سقيا زمزم', entity: 'zamzam', icon: 'drop', quick: ['حافظة زمزم فارغة', 'نقص أكواب', 'تسرب من الحافظة', 'حافظة تحتاج تنظيف'] },
    { id: 'sound', label: 'صوتيات', entity: 'sound', icon: 'sound', quick: ['انقطاع الصوت', 'تشويش أو صدى', 'ارتفاع الصوت بشكل مزعج', 'سماعة معطلة'] },
    { id: 'visitors', label: 'خدمة القاصدين', entity: 'visitors', icon: 'help', quick: ['طفل تائه', 'كبير سن يحتاج مساعدة', 'مفقودات', 'عربة معطلة', 'زائر يحتاج إرشاد'] }
  ]
};
const DEFAULT_SETTINGS = {
  sla: { normal: 72, urgent: 24, critical: 6 },            // مهلة المعالجة بالساعات
  mail_to: '', mail_from: '', site_url: '',
  notify: {
    new: { on: 1, to: '' }, refer: { on: 1, to: '' }, close: { on: 1, to: '' },
    other: { on: 0, to: '' }, digest: { on: 1, to: '' }
  }
};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try { return await route(req, env, ctx, url); }
    catch (e) { return J({ error: 'تعذّر تنفيذ الطلب، حاول مرة أخرى', detail: String(e && e.message || e) }, 500); }
  },
  // ملخص يومي بالبلاغات المتأخرة (7 صباحاً بتوقيت مكة)
  async scheduled(event, env, ctx) { ctx.waitUntil(sendDigest(env)); }
};

async function route(req, env, ctx, url) {
  const p = url.pathname.replace(/\/+$/, ''), m = req.method;
  let mm;
  if (p === '/api/login' && m === 'POST') return login(req, env, url);
  if (p === '/api/options' && m === 'GET') return publicOptions(env);
  if (p === '/api/stats' && m === 'GET') return publicStats(env);
  if (p === '/api/reports' && m === 'POST') return createReport(req, env, ctx, url);
  if ((mm = p.match(/^\/api\/p\/(\d+)$/)) && m === 'GET') return photo(env, +mm[1], url.searchParams.get('s'));

  if (!(await checkAuth(req, env))) return J({ error: 'انتهت الجلسة، سجّل الدخول من جديد' }, 401);
  if (p === '/api/reports' && m === 'GET') return listReports(env, url);
  if ((mm = p.match(/^\/api\/reports\/(\d+)$/)) && m === 'GET') return getReport(env, +mm[1], url);
  if ((mm = p.match(/^\/api\/reports\/(\d+)\/action$/)) && m === 'POST') return act(req, env, ctx, url, +mm[1]);
  if (p === '/api/dashboard' && m === 'GET') return dashboard(env, url);
  if (p === '/api/log' && m === 'GET') return activityLog(env, url);
  if (p === '/api/entities' && m === 'GET') return listEntities(env);
  if (p === '/api/entities' && m === 'PUT') return saveEntities(req, env);
  if (p === '/api/settings' && m === 'GET') return J({ options: await getConf(env, 'options'), settings: await getConf(env, 'settings'), email_ready: !!env.EMAIL });
  if (p === '/api/settings' && m === 'PUT') return saveSettings(req, env, url);
  if (p === '/api/settings/test-email' && m === 'POST') return testEmail(env);
  return J({ error: 'المسار غير موجود' }, 404);
}

// ================= أدوات =================
const J = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});
async function body(req) { try { return await req.json(); } catch { return {}; } }
const s = (v, n = 300) => (v == null ? '' : String(v)).trim().slice(0, n);
const num = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = t => new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(t));
const emails = v => String(v || '').split(/[,;\s]+/).map(x => x.trim()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 20);
const slaMs = (sla, p) => (+sla[p] || +sla.normal || 72) * HOUR;
const slaSql = sla => `(CASE priority WHEN 'critical' THEN ${slaMs(sla, 'critical')} WHEN 'urgent' THEN ${slaMs(sla, 'urgent')} ELSE ${slaMs(sla, 'normal')} END)`;

async function hmac(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const secretOf = env => (env.SESSION_SECRET || 'bnder') + '|' + (env.ADMIN_PASSWORD || '');
const photoSig = (env, id) => hmac(secretOf(env), 'photo:' + id);

async function getConf(env, key) {
  const row = await env.DB.prepare('SELECT value FROM config WHERE key=?').bind(key).first().catch(() => null);
  let v = null; try { v = row && JSON.parse(row.value); } catch {}
  const d = JSON.parse(JSON.stringify(key === 'options' ? DEFAULT_OPTIONS : DEFAULT_SETTINGS));
  if (!v) return d;
  const out = { ...d, ...v };
  if (key === 'settings') { out.sla = { ...d.sla, ...(v.sla || {}) }; out.notify = { ...d.notify }; for (const k in d.notify) out.notify[k] = { ...d.notify[k], ...((v.notify || {})[k] || {}) }; }
  return out;
}
const putConf = (env, key, val) => env.DB.prepare('INSERT INTO config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, JSON.stringify(val)).run();

// ================= الدخول =================
async function login(req, env, url) {
  if (!env.ADMIN_PASSWORD) return J({ error: 'لم تُضبط كلمة مرور اللوحة (ADMIN_PASSWORD) في إعدادات Cloudflare' }, 500);
  const b = await body(req);
  if (s(b.password, 200) !== env.ADMIN_PASSWORD) return J({ error: 'كلمة المرور غير صحيحة' }, 401);
  const st = await getConf(env, 'settings');
  if (st.site_url !== url.origin) { st.site_url = url.origin; await putConf(env, 'settings', st); }
  const exp = Date.now() + 12 * HOUR;
  return J({ token: exp + '.' + await hmac(secretOf(env), 'adm:' + exp), exp });
}
async function checkAuth(req, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const t = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const [exp, sig] = t.split('.');
  if (!exp || !sig || +exp < Date.now()) return false;
  return sig === await hmac(secretOf(env), 'adm:' + exp);
}

// ================= عام =================
async function publicOptions(env) {
  const o = await getConf(env, 'options');
  const { results } = await env.DB.prepare('SELECT id,name FROM entities').all();
  const names = Object.fromEntries(results.map(e => [e.id, e.name]));
  return J({ zones: o.zones, floors: o.floors, reporters: o.reporters, name_mode: o.name_mode,
    categories: o.categories.map(c => ({ ...c, entity_name: names[c.entity] || '' })) });
}

async function createReport(req, env, ctx, url) {
  const b = await body(req);
  if (env.REPORT_KEY && s(b.key, 100) !== env.REPORT_KEY) return J({ error: 'رابط الإبلاغ غير صالح، اطلب الرابط الصحيح من المشرف' }, 403);
  const o = await getConf(env, 'options');
  const cat = o.categories.find(c => c.id === s(b.category, 40));
  const r = {
    zone: s(b.zone, 80), floor: s(b.floor, 40), gate: s(b.gate, 40), spot: s(b.spot, 200),
    lat: num(b.lat), lng: num(b.lng), acc: num(b.acc),
    priority: PRIORITIES.includes(b.priority) ? b.priority : 'normal',
    details: s(b.details, 1500), reporter_name: s(b.reporter_name, 80)
  };
  if (!r.zone || !cat) return J({ error: 'حدّد المنطقة ونوع الملاحظة قبل الإرسال' }, 400);
  const photo = typeof b.photo === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(b.photo) ? b.photo : '';
  if (photo.length > 1800000) return J({ error: 'حجم الصورة كبير، التقطها من جديد' }, 413);

  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO reports (created_at,updated_at,mosque,zone,floor,gate,spot,lat,lng,acc,category,category_label,entity_id,priority,details,reporter_name,has_photo,status)
     VALUES (?,?,'haram',?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new') RETURNING id`
  ).bind(now, now, r.zone, r.floor, r.gate, r.spot, r.lat, r.lng, r.acc, cat.id, cat.label, cat.entity, r.priority, r.details, r.reporter_name, photo ? 1 : 0).first();
  const id = row.id, ref = 'BN-' + String(id).padStart(5, '0');
  const stmts = [
    env.DB.prepare('UPDATE reports SET ref=? WHERE id=?').bind(ref, id),
    env.DB.prepare('INSERT INTO events (report_id,at,action,note,actor) VALUES (?,?,?,?,?)').bind(id, now, 'created', '', r.reporter_name || 'مُبلّغ ميداني')
  ];
  if (photo) stmts.push(env.DB.prepare('INSERT INTO photos (report_id,data) VALUES (?,?)').bind(id, photo));
  await env.DB.batch(stmts);
  ctx.waitUntil(notify(env, 'new', id, url.origin).catch(() => {}));
  return J({ ok: true, id, ref, created_at: now });
}

async function publicStats(env) {
  const now = Date.now(), start = Math.floor((now + KSA) / DAY) * DAY - KSA;
  const [a, b, c] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) c FROM reports WHERE created_at>=?').bind(start),
    env.DB.prepare("SELECT COUNT(*) c FROM reports WHERE status='closed' AND closed_at>=?").bind(start),
    env.DB.prepare("SELECT AVG(closed_at-created_at) a FROM reports WHERE status='closed' AND closed_at>=?").bind(now - 30 * DAY)
  ]);
  return J({ today: a.results[0].c, closed_today: b.results[0].c, avg_close_ms: c.results[0].a ? Math.round(c.results[0].a) : null });
}

async function photo(env, id, sig) {
  if (!sig || sig !== await photoSig(env, id)) return new Response('رابط الصورة غير صالح', { status: 403 });
  const row = await env.DB.prepare('SELECT data FROM photos WHERE report_id=?').bind(id).first();
  if (!row) return new Response('لا توجد صورة', { status: 404 });
  const mt = row.data.match(/^data:(image\/[a-z]+);base64,(.*)$/);
  if (!mt) return new Response('صيغة غير معروفة', { status: 415 });
  const bin = atob(mt[2]), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: { 'content-type': mt[1], 'cache-control': 'private, max-age=86400' } });
}

// ================= البلاغات =================
function rangeStart(range) {
  const now = Date.now();
  if (range === 'today') return Math.floor((now + KSA) / DAY) * DAY - KSA;
  if (range === '7') return now - 7 * DAY;
  if (range === '30') return now - 30 * DAY;
  if (range === '90') return now - 90 * DAY;
  return 0;
}

async function listReports(env, url) {
  const q = url.searchParams, where = [], binds = [];
  const st = q.get('status');
  const sla = (await getConf(env, 'settings')).sla;
  if (st === 'open') where.push("status!='closed'");
  else if (st === 'overdue') { where.push(`status!='closed' AND (? - created_at) > ${slaSql(sla)}`); binds.push(Date.now()); }
  else if (STATUSES.includes(st)) { where.push('status=?'); binds.push(st); }
  for (const f of ['entity_id', 'priority', 'category', 'zone']) if (q.get(f)) { where.push(f + '=?'); binds.push(q.get(f)); }
  const since = rangeStart(q.get('range'));
  if (since) { where.push('created_at>=?'); binds.push(since); }
  const term = s(q.get('q'), 60);
  if (term) {
    where.push('(ref LIKE ? OR details LIKE ? OR zone LIKE ? OR spot LIKE ? OR gate LIKE ? OR category_label LIKE ? OR reporter_name LIKE ? OR closure_note LIKE ?)');
    for (let i = 0; i < 8; i++) binds.push('%' + term + '%');
  }
  const full = q.get('full') === '1';
  const cols = full ? '*' : 'id,ref,created_at,updated_at,zone,floor,gate,spot,category,category_label,entity_id,priority,details,reporter_name,has_photo,status,closed_at';
  const sql = `SELECT ${cols} FROM reports ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id ${q.get('order') === 'asc' ? 'ASC' : 'DESC'} LIMIT ${full ? 20000 : 500}`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return J({ items: results, sla });
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
  return J({ report, events: ev.results, photo: p ? p.data : null,
    photo_link: p ? `${url.origin}/api/p/${id}?s=${await photoSig(env, id)}` : null,
    sla: (await getConf(env, 'settings')).sla });
}

async function act(req, env, ctx, url, id) {
  const b = await body(req);
  const r = await env.DB.prepare('SELECT id,status,entity_id FROM reports WHERE id=?').bind(id).first();
  if (!r) return J({ error: 'البلاغ غير موجود' }, 404);
  const now = Date.now(), note = s(b.note, 1000), method = s(b.method, 120), actor = s(b.actor, 60) || 'المشرف';
  let upd, evNote = note;
  switch (b.action) {
    case 'review': upd = env.DB.prepare("UPDATE reports SET status='review', updated_at=? WHERE id=?").bind(now, id); break;
    case 'refer': {
      const ent = s(b.entity_id, 40) || r.entity_id;
      upd = env.DB.prepare("UPDATE reports SET status='referred', entity_id=?, referred_at=?, updated_at=? WHERE id=?").bind(ent, now, now, id); break;
    }
    case 'close':
      if (!method && !note) return J({ error: 'حدّد طريقة المعالجة قبل الإقفال' }, 400);
      evNote = [method, note].filter(Boolean).join(' — ');
      upd = env.DB.prepare("UPDATE reports SET status='closed', closed_at=?, closure_method=?, closure_note=?, updated_at=? WHERE id=?").bind(now, method, note, now, id); break;
    case 'reopen': upd = env.DB.prepare("UPDATE reports SET status='review', closed_at=NULL, updated_at=? WHERE id=?").bind(now, id); break;
    case 'note':
      if (!note) return J({ error: 'اكتب الملاحظة أولاً' }, 400);
      upd = env.DB.prepare('UPDATE reports SET updated_at=? WHERE id=?').bind(now, id); break;
    default: return J({ error: 'إجراء غير معروف' }, 400);
  }
  await env.DB.batch([upd, env.DB.prepare('INSERT INTO events (report_id,at,action,note,actor) VALUES (?,?,?,?,?)').bind(id, now, b.action, evNote, actor)]);
  const type = b.action === 'refer' ? 'refer' : b.action === 'close' ? 'close' : b.action === 'review' ? null : 'other';
  if (type) ctx.waitUntil(notify(env, type, id, url.origin, { actor, note: evNote, action: b.action }).catch(() => {}));
  return J({ ok: true });
}

// ================= المؤشرات =================
async function dashboard(env, url) {
  const since = rangeStart(url.searchParams.get('range'));
  const now = Date.now(), st = await getConf(env, 'settings');
  const P = (sql, ...a) => env.DB.prepare(sql).bind(...a);
  const res = await env.DB.batch([
    P('SELECT status, COUNT(*) c FROM reports WHERE created_at>=? GROUP BY status', since),
    P('SELECT category_label l, COUNT(*) c FROM reports WHERE created_at>=? GROUP BY category_label ORDER BY c DESC LIMIT 10', since),
    P('SELECT zone l, COUNT(*) c FROM reports WHERE created_at>=? GROUP BY zone ORDER BY c DESC LIMIT 10', since),
    P("SELECT entity_id e, COUNT(*) c, SUM(status='closed') d FROM reports WHERE created_at>=? GROUP BY entity_id ORDER BY c DESC", since),
    P("SELECT strftime('%Y-%m-%d', created_at/1000 + 10800, 'unixepoch') d, COUNT(*) c, SUM(status='closed') x FROM reports WHERE created_at>=? GROUP BY d ORDER BY d", now - 14 * DAY),
    P("SELECT CAST(strftime('%H', created_at/1000 + 10800, 'unixepoch') AS INTEGER) h, COUNT(*) c FROM reports WHERE created_at>=? GROUP BY h", since),
    P("SELECT AVG(closed_at-created_at) a, COUNT(*) n FROM reports WHERE created_at>=? AND status='closed'", since),
    P("SELECT AVG(COALESCE(referred_at, closed_at)-created_at) a FROM reports WHERE created_at>=? AND (referred_at IS NOT NULL OR closed_at IS NOT NULL)", since),
    P("SELECT id,ref,created_at,priority,category_label,zone,status,entity_id FROM reports WHERE status!='closed' ORDER BY created_at ASC"),
    P("SELECT COALESCE(NULLIF(closure_method,''),'غير محدد') l, COUNT(*) c FROM reports WHERE status='closed' AND created_at>=? GROUP BY l ORDER BY c DESC", since),
    P("SELECT e.at,e.action,e.note,e.actor,r.id,r.ref,r.category_label FROM events e JOIN reports r ON r.id=e.report_id ORDER BY e.at DESC LIMIT 8"),
    P(`SELECT COUNT(*) n FROM reports WHERE status='closed' AND created_at>=? AND (closed_at-created_at) <= ${slaSql(st.sla)}`, since)
  ]);
  const rows = i => res[i].results;
  const open = rows(8);
  const aging = [0, 0, 0, 0]; // أقل من يوم، 1-3، 3-7، أكثر من 7
  const overdue = [];
  for (const r of open) {
    const age = now - r.created_at, d = age / DAY;
    aging[d < 1 ? 0 : d < 3 ? 1 : d < 7 ? 2 : 3]++;
    const late = age - slaMs(st.sla, r.priority);
    if (late > 0) overdue.push({ ...r, late_ms: late });
  }
  overdue.sort((a, b) => b.late_ms - a.late_ms);
  return J({
    status: rows(0), categories: rows(1), zones: rows(2), entities: rows(3), trend: rows(4), hours: rows(5),
    avg_close_ms: rows(6)[0].a, closed_n: rows(6)[0].n, avg_response_ms: rows(7)[0].a,
    within_sla: rows(11)[0].n, open_n: open.length, aging, overdue_n: overdue.length, overdue: overdue.slice(0, 10),
    open_priority: PRIORITIES.map(p => ({ p, c: open.filter(r => r.priority === p).length })),
    methods: rows(9), recent: rows(10), sla: st.sla
  });
}

async function activityLog(env, url) {
  const q = url.searchParams, where = ['e.at>=?'], binds = [rangeStart(q.get('range'))];
  if (q.get('action')) { where.push('e.action=?'); binds.push(q.get('action')); }
  const term = s(q.get('q'), 60);
  if (term) { where.push('(r.ref LIKE ? OR e.actor LIKE ? OR e.note LIKE ? OR r.category_label LIKE ?)'); for (let i = 0; i < 4; i++) binds.push('%' + term + '%'); }
  const lim = q.get('full') === '1' ? 50000 : 400;
  const { results } = await env.DB.prepare(
    `SELECT e.at,e.action,e.note,e.actor,r.id,r.ref,r.category_label,r.zone,r.status FROM events e JOIN reports r ON r.id=e.report_id
     WHERE ${where.join(' AND ')} ORDER BY e.at DESC LIMIT ${lim}`).bind(...binds).all();
  return J({ items: results });
}

// ================= الجهات والإعدادات =================
async function listEntities(env) {
  const { results } = await env.DB.prepare('SELECT * FROM entities ORDER BY sort, name').all();
  return J({ items: results });
}
async function saveEntities(req, env) {
  const b = await body(req);
  const items = Array.isArray(b.items) ? b.items.slice(0, 100) : [];
  if (!items.length) return J({ error: 'لا توجد جهات للحفظ' }, 400);
  await env.DB.batch(items.map((e, i) => env.DB.prepare(
    `INSERT INTO entities (id,name,phone,active,sort) VALUES (?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, phone=excluded.phone, active=excluded.active, sort=excluded.sort`
  ).bind(s(e.id, 40) || 'e' + Date.now() + i, s(e.name, 80) || 'جهة', s(e.phone, 20).replace(/[^\d+]/g, ''), e.active ? 1 : 0, i)));
  return listEntities(env);
}

const cleanList = (a, n = 200) => [...new Set((Array.isArray(a) ? a : []).map(x => s(x, 120)).filter(Boolean))].slice(0, n);
async function saveSettings(req, env, url) {
  const b = await body(req);
  if (b.options) {
    const o = b.options;
    const cats = (Array.isArray(o.categories) ? o.categories : []).slice(0, 60).map((c, i) => ({
      id: s(c.id, 40) || 'c' + Date.now() + i, label: s(c.label, 80), entity: s(c.entity, 40), icon: s(c.icon, 20) || 'dot', quick: cleanList(c.quick, 30)
    })).filter(c => c.label);
    const zones = cleanList(o.zones);
    if (!zones.length || !cats.length) return J({ error: 'يجب أن تبقى منطقة واحدة ونوع ملاحظة واحد على الأقل' }, 400);
    await putConf(env, 'options', { name_mode: ['off', 'optional', 'required'].includes(o.name_mode) ? o.name_mode : 'optional', zones, floors: cleanList(o.floors), reporters: cleanList(o.reporters, 500), methods: cleanList(o.methods, 40), categories: cats });
  }
  if (b.settings) {
    const cur = await getConf(env, 'settings'), v = b.settings;
    const sla = {}; for (const p of PRIORITIES) sla[p] = Math.max(1, Math.min(24 * 90, Math.round(+((v.sla || {})[p]) || cur.sla[p])));
    const notify = {}; for (const k in DEFAULT_SETTINGS.notify) { const n = (v.notify || {})[k]; notify[k] = n ? { on: n.on ? 1 : 0, to: emails(n.to).join(', ') } : cur.notify[k]; }
    await putConf(env, 'settings', { ...cur, sla, notify, mail_to: v.mail_to !== undefined ? emails(v.mail_to).join(', ') : cur.mail_to, mail_from: v.mail_from !== undefined ? s(v.mail_from, 120) : cur.mail_from, site_url: url.origin });
  }
  return J({ ok: true, options: await getConf(env, 'options'), settings: await getConf(env, 'settings'), email_ready: !!env.EMAIL });
}

// ================= البريد الإلكتروني =================
async function sendMail(env, st, to, subject, html, text) {
  if (!env.EMAIL) throw new Error('خدمة البريد غير مفعّلة بعد في Cloudflare (ربط EMAIL)');
  const from = st.mail_from || env.MAIL_FROM;
  if (!from) throw new Error('حدّد عنوان المرسل في إعدادات الإشعارات');
  if (!to.length) throw new Error('لا يوجد بريد مستلم');
  return env.EMAIL.send({ from: { email: from, name: OPS_NAME }, to, subject, html, text });
}
function mailHtml(title, rows, link, foot = '') {
  return `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;background:#F1F4F3;padding:24px">
  <div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #D9E1DE">
  <div style="background:#0B3D32;color:#fff;padding:18px 22px"><div style="color:#C9AE7A;font-size:12px">${OPS_NAME} — البلاغات الميدانية</div>
  <div style="font-size:19px;font-weight:bold;margin-top:4px">${esc(title)}</div></div>
  <table style="width:100%;border-collapse:collapse;font-size:14px">${rows.filter(r => r[1]).map(([k, v]) =>
    `<tr><td style="padding:9px 22px;color:#5C6C66;width:120px;border-bottom:1px solid #EEF1F0">${esc(k)}</td><td style="padding:9px 22px;border-bottom:1px solid #EEF1F0">${esc(v)}</td></tr>`).join('')}</table>
  ${foot}<div style="padding:16px 22px 0;color:#5C6C66;font-size:13px">${OPS_NAME}</div>${link ? `<div style="padding:14px 22px 18px"><a href="${esc(link)}" style="background:#0F4A3D;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">فتح في لوحة المتابعة</a></div>` : ''}
  </div></div>`;
}
async function notify(env, type, id, origin, extra = {}) {
  const st = await getConf(env, 'settings'), n = st.notify[type];
  if (!n || !n.on) return;
  const to = emails(n.to || st.mail_to);
  if (!to.length || !env.EMAIL) return;
  const r = await env.DB.prepare('SELECT r.*, e.name ename FROM reports r LEFT JOIN entities e ON e.id=r.entity_id WHERE r.id=?').bind(id).first();
  if (!r) return;
  const loc = [r.zone, r.floor, r.gate ? 'قرب باب ' + r.gate : ''].filter(Boolean).join('، ');
  const titles = { new: `بلاغ جديد ${r.ref}: ${r.category_label}`, refer: `إحالة ${r.ref} إلى ${r.ename || ''}`, close: `إقفال ${r.ref}`, other: `تحديث ${r.ref}` };
  const subj = (r.priority !== 'normal' ? `[${PRIO_AR[r.priority]}] ` : '') + titles[type];
  const rows = [['رقم البلاغ', r.ref], ['النوع', r.category_label], ['الأولوية', PRIO_AR[r.priority]], ['الحالة', STATUS_AR[r.status]],
    ['الموقع', loc], ['وصف المكان', r.spot], ['التفاصيل', r.details], ['الجهة', r.ename], ['المُبلّغ', r.reporter_name], ['وقت الرصد', fmt(r.created_at)],
    ['الإجراء', extra.note], ['بواسطة', extra.actor]];
  const link = `${origin || st.site_url}/admin#r${id}`;
  await sendMail(env, st, to, subj, mailHtml(titles[type], rows, link), rows.filter(x => x[1]).map(x => x.join(': ')).join('\n') + '\n' + link + '\n\n' + OPS_NAME);
}
async function sendDigest(env) {
  const st = await getConf(env, 'settings'), n = st.notify.digest;
  const to = emails(n.to || st.mail_to);
  if (!n.on || !to.length || !env.EMAIL) return;
  const now = Date.now();
  const { results } = await env.DB.prepare(`SELECT id,ref,created_at,priority,category_label,zone FROM reports WHERE status!='closed' AND (? - created_at) > ${slaSql(st.sla)} ORDER BY created_at ASC LIMIT 50`).bind(now).all();
  if (!results.length) return;
  const days = r => Math.max(1, Math.round((now - r.created_at - slaMs(st.sla, r.priority)) / DAY));
  const foot = `<table style="width:100%;border-collapse:collapse;font-size:13px">${results.map(r =>
    `<tr><td style="padding:8px 22px;border-bottom:1px solid #EEF1F0">${esc(r.ref)}</td><td style="padding:8px;border-bottom:1px solid #EEF1F0">${esc(r.category_label)} — ${esc(r.zone)}</td><td style="padding:8px 22px;border-bottom:1px solid #EEF1F0;color:#B3261E;white-space:nowrap">متأخر ${days(r)} يوم</td></tr>`).join('')}</table>`;
  await sendMail(env, st, to, `ملخص البلاغات المتأخرة: ${results.length}`, mailHtml(`${results.length} بلاغ تجاوز مهلة المعالجة`, [], `${st.site_url}/admin`, foot),
    results.map(r => `${r.ref} | ${r.category_label} | ${r.zone} | متأخر ${days(r)} يوم`).join('\n') + '\n\n' + OPS_NAME);
}
async function testEmail(env) {
  const st = await getConf(env, 'settings');
  try {
    await sendMail(env, st, emails(st.mail_to), 'رسالة تجربة من نظام البلاغات الميدانية', mailHtml('تم ربط الإشعارات بنجاح', [['الوقت', fmt(Date.now())]], `${st.site_url}/admin`), 'تم ربط الإشعارات بنجاح\n\n' + OPS_NAME);
    return J({ ok: true });
  } catch (e) { return J({ error: e.message || 'تعذّر الإرسال' }, 400); }
}

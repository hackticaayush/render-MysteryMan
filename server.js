// ============================================================
//  STAR TREASURE — Render Web Service (Node.js + Express)
//  Storage   : In-memory (resets on restart)
//  Cron      : setInterval every 60s inside the app
// ============================================================

const express = require('express');
const fetch   = require('node-fetch');
const app     = express();
const PORT    = process.env.PORT || 3000;

const API_TOKEN = '94le54aFnKy5CrbNzo7s903FOWniysVT';
const PROMO_ID  = '2711';
const BASE_URL  = 'https://m.starmakerstudios.com';
const PASSWORD  = 'in123';

const COMMON_HEADERS = {
  'User-Agent'        : 'sm/9.9.4/Android/13/google play/d48399ffafa2d343/wifi/en-IN/SM-M325F/10977524107285207///India',
  'Accept'            : 'application/json, text/plain, */*',
  'sec-ch-ua-platform': '"Android"',
  'sec-ch-ua'         : '"Not:A-Brand";v="99", "Android WebView";v="145", "Chromium";v="145"',
  'token'             : API_TOKEN,
  'sec-ch-ua-mobile'  : '?1',
  'x-requested-with'  : 'com.starmakerinteractive.starmaker',
  'sec-fetch-site'    : 'same-origin',
  'sec-fetch-mode'    : 'cors',
  'sec-fetch-dest'    : 'empty',
  'referer'           : `https://m.starmakerstudios.com/a-vue3/spa-rhapsody-music/index?promotion_id=${PROMO_ID}&showBar=0&showNavigation=false&sp=game_center&game_id=13`,
  'accept-language'   : 'en-IN,en-US;q=0.9,en;q=0.8',
  'priority'          : 'u=1, i',
  'Cookie'            : 'PHPSESSID=pd6mapbqfhbk3e7argj51uh1ts; X-Rce-Type-11=yidun; _gcl_au=1.1.1850565661.1776934232; _ga=GA1.1.459020718.1776934232; X-Rce-Token-11=UrhVBI9Kv4_vSJUOu00CqGXMG44vdz88qh7RDg==; oauth_token=94le54aFnKy5CrbNzo7s903FOWniysVT; _ga_Y5QLWEHNZ4=GS2.1.s1776966932$o4$g1$t1776966963$j29$l0$h0',
};

// ── In-memory store ───────────────────────────────────────────
const store = {
  todayUsers   : [],
  todayUpdated : null,
  todayDayKey  : null,
  debugToday   : [],
  cronRunning  : false,
};

// ── Logger ────────────────────────────────────────────────────
const LOG = {
  info : (...a) => console.log ('[INFO]',  ...a),
  warn : (...a) => console.warn('[WARN]',  ...a),
  error: (...a) => console.error('[ERROR]', ...a),
  step : (fn, msg, ...a) => console.log(`[STEP][${fn}]`, msg, ...a),
};

// ── India day key: boundary at 05:30 IST ─────────────────────
function getIndiaDateKey(tsMs) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const DAY_SHIFT_MS  = 5.5 * 60 * 60 * 1000;
  const adjusted      = new Date(tsMs + IST_OFFSET_MS - DAY_SHIFT_MS);
  const y = adjusted.getUTCFullYear();
  const m = String(adjusted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(adjusted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ── API: fetch one page of activity-user-list ─────────────────
async function fetchActivityPage(page) {
  const ts  = Date.now();
  const url = `${BASE_URL}/go-v1/ssc/${PROMO_ID}/activity-user-list?page=${page}&_sx_ts=${ts}`;
  LOG.step('fetchActivityPage', `page=${page}`);

  const res = await fetch(url, { headers: COMMON_HEADERS });
  const rawText = await res.text();

  if (!res.ok) throw new Error(`HTTP ${res.status} on page ${page}`);

  let json;
  try { json = JSON.parse(rawText); }
  catch (e) { throw new Error(`JSON parse failed page ${page}: ${e.message}`); }

  return { json, rawBody: rawText.slice(0, 2000) };
}

// ── Cron: refresh today top-100 ───────────────────────────────
async function cronToday() {
  if (store.cronRunning) {
    LOG.warn('[cronToday] Already running, skipping.');
    return;
  }
  store.cronRunning = true;
  LOG.info('════ [cronToday] START ════');
  const startTime = Date.now();
  const debugLog  = [];

  try {
    // Day reset check
    const todayKey = getIndiaDateKey(Date.now());
    if (store.todayDayKey !== null && store.todayDayKey !== todayKey) {
      LOG.info(`[cronToday] Day changed ${store.todayDayKey} → ${todayKey}. Resetting.`);
      store.todayUsers   = [];
      store.todayUpdated = null;
      debugLog.push({ type: 'warn', msg: `Day reset: ${store.todayDayKey} → ${todayKey}. Cleared all data.`, ts: Date.now() });
    }
    store.todayDayKey = todayKey;

    const seen    = new Map();
    let   page    = 1;
    let   hasMore = true;

    while (hasMore && seen.size < 100) {
      let result;
      try {
        result = await fetchActivityPage(page);
      } catch (e) {
        LOG.error(`[cronToday] page=${page} failed:`, e.message);
        debugLog.push({ type: 'error', msg: `Page ${page} fetch failed: ${e.message}`, ts: Date.now() });
        break;
      }

      const { json: data, rawBody } = result;
      const list = data.play_user_list || [];

      debugLog.push({
        type   : list.length > 0 ? 'ok' : 'warn',
        msg    : `page=${page} → ${list.length} users, has_more=${data.has_more}`,
        body   : rawBody,
        ts     : Date.now(),
      });

      LOG.info(`[cronToday] page=${page} → ${list.length} users, has_more=${data.has_more}`);

      if (list.length === 0) break;

      for (const u of list) {
        if (!u.id || seen.has(u.id)) continue;
        seen.set(u.id, {
          id           : u.id,
          name         : u.stage_name || u.name || 'Unknown',
          profile_image: u.profile_image || '',
          reward_gold  : u.reward_gold  || 0,
        });
      }

      hasMore = data.has_more && list.length > 0;
      page++;
      if (page > 10) { LOG.warn('[cronToday] Safety cap page>10'); break; }
    }

    // Merge with existing in-memory users
    const merged = new Map(store.todayUsers.map(u => [u.id, u]));
    for (const [id, u] of seen) merged.set(id, u);
    store.todayUsers   = [...merged.values()]
      .sort((a, b) => b.reward_gold - a.reward_gold)
      .slice(0, 100);
    store.todayUpdated = Date.now();
    store.debugToday   = debugLog;

    LOG.info(`════ [cronToday] DONE — ${store.todayUsers.length} users in ${Date.now() - startTime}ms ════`);
  } catch (e) {
    LOG.error('[cronToday] UNHANDLED:', e.message);
    debugLog.push({ type: 'error', msg: e.message, ts: Date.now() });
    store.debugToday = debugLog;
  } finally {
    store.cronRunning = false;
  }
}

// ── Start interval ────────────────────────────────────────────
cronToday(); // run immediately on startup
setInterval(cronToday, 60 * 1000); // then every 60s

// ── HTML helpers ──────────────────────────────────────────────
function formatGold(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '')     + 'K';
  return String(n);
}

function timeAgo(ts) {
  if (!ts) return 'never';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderUserCard(u, index) {
  const rank      = index + 1;
  const rankCls   = rank === 1 ? 'top1' : rank === 2 ? 'top2' : rank === 3 ? 'top3' : '';
  const rankTxt   = rank <= 3 ? ['🥇','🥈','🥉'][rank - 1] : rank;
  const avatar    = u.profile_image
    ? `<img src="${u.profile_image}" alt="" loading="lazy" onerror="this.style.display='none';this.parentNode.textContent='🎭'">`
    : '🎭';
  const bonus = u.reward_gold
    ? `<div class="bonus-amount">${formatGold(u.reward_gold)}</div><span class="bonus-tag">gold</span>`
    : `<div class="bonus-amount zero">—</div><span class="bonus-tag">unknown</span>`;

  return `<div class="user-card" data-sid="${u.id}">
    <div class="rank ${rankCls}">${rankTxt}</div>
    <div class="avatar av-today">${avatar}</div>
    <div class="user-info">
      <div class="username">${esc(u.name)}</div>
      <div class="sid-row"><span class="sid-text">${u.id}</span><span class="copy-hint">📋</span></div>
    </div>
    <div class="bonus-col">${bonus}</div>
  </div>`;
}

function renderDebugLogs(entries) {
  if (!entries || entries.length === 0) {
    return `<div class="debug-section">
      <div class="debug-section-title">⭐ cronToday — activity-user-list</div>
      <div class="debug-entry warn"><div class="debug-msg">No data yet — waiting for first cron run.</div></div>
    </div>`;
  }
  return `<div class="debug-section">
    <div class="debug-section-title">⭐ cronToday — activity-user-list</div>
    ${entries.map(e => `
      <div class="debug-entry ${e.type || ''}">
        <div class="debug-msg">${esc(e.msg || '')}</div>
        ${e.body ? `<details class="debug-body-wrap">
          <summary>📄 Raw API Response Body</summary>
          <pre class="debug-body">${esc(e.body)}</pre>
        </details>` : ''}
      </div>`).join('')}
  </div>`;
}

function renderHTML() {
  const { todayUsers, todayUpdated, debugToday } = store;
  const todayCards = todayUsers.map((u, i) => renderUserCard(u, i)).join('');
  const todayCount = todayUsers.length;
  const debugHtml  = renderDebugLogs(debugToday);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"/>
  <title>Star Treasure</title>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;900&family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet"/>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg:#07060f;--surface:#100e1c;--card:#161228;--border:rgba(220,180,60,0.13);
      --gold:#f0c040;--gold2:#ffaa00;--purple:#c09fff;--text:#ede0c8;--muted:#5a506a;
      --shine:rgba(240,192,64,0.06);--green:#69d47e;--red:#ff6b6b;--yellow:#ffc107;
    }
    html,body{height:100%;overflow-x:hidden}
    body{font-family:'Nunito',sans-serif;background:var(--bg);color:var(--text);max-width:430px;margin:0 auto;min-height:100vh;position:relative;}

    /* Password overlay */
    #pw-overlay{position:fixed;inset:0;z-index:9999;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px;}
    #pw-overlay.hidden{display:none}
    .pw-crown{font-size:2.8rem;margin-bottom:12px;filter:drop-shadow(0 0 18px rgba(240,192,64,.9));animation:float 3s ease-in-out infinite}
    .pw-title{font-family:'Cinzel',serif;font-size:1.5rem;font-weight:900;background:linear-gradient(135deg,#ffe680 0%,#f5a020 45%,#ffe680 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:6px;}
    .pw-sub{font-size:.78rem;color:var(--muted);margin-bottom:28px;letter-spacing:.04em}
    .pw-box{width:100%;max-width:280px;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:12px;}
    .pw-input{width:100%;padding:12px 16px;background:var(--card);border:1px solid var(--border);border-radius:12px;color:var(--text);font-family:'Nunito',sans-serif;font-size:.95rem;outline:none;transition:border-color .2s;}
    .pw-input:focus{border-color:rgba(240,192,64,.5)}
    .pw-input.shake{animation:shake .35s ease}
    @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}
    .pw-btn{width:100%;padding:12px;border:none;border-radius:12px;background:linear-gradient(135deg,#f0c040,#ff9d00);color:#1a0f00;font-family:'Cinzel',serif;font-size:.85rem;font-weight:700;letter-spacing:.1em;cursor:pointer;transition:opacity .2s,transform .15s;}
    .pw-btn:active{transform:scale(.97)}
    .pw-err{font-size:.72rem;color:var(--red);text-align:center;min-height:16px;transition:opacity .2s}
    .pw-err.hidden{opacity:0}

    /* Stars */
    #stars{position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden}
    #stars span{position:absolute;border-radius:50%;background:#fff;animation:twinkle var(--d) ease-in-out infinite alternate;opacity:0;animation-delay:var(--dl);}
    @keyframes twinkle{from{opacity:0;transform:scale(.5)}to{opacity:var(--o);transform:scale(1)}}
    body::before{content:'';position:fixed;top:-120px;left:50%;transform:translateX(-50%);width:360px;height:360px;background:radial-gradient(circle,rgba(240,192,64,.09) 0%,transparent 70%);pointer-events:none;z-index:0;}

    header{position:relative;z-index:2;padding:36px 20px 16px;text-align:center}
    .crown{display:block;font-size:2rem;margin-bottom:4px;filter:drop-shadow(0 0 14px rgba(240,192,64,.9));animation:float 3s ease-in-out infinite}
    @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
    header h1{font-family:'Cinzel',serif;font-size:1.95rem;font-weight:900;letter-spacing:.07em;background:linear-gradient(135deg,#ffe680 0%,#f5a020 45%,#ffe680 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;filter:drop-shadow(0 2px 14px rgba(245,160,32,.45));}
    .tagline{margin-top:6px;font-size:.82rem;letter-spacing:.03em;color:var(--muted)}

    .tabs{position:sticky;top:0;z-index:10;display:flex;margin:0 14px;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:4px;gap:4px;backdrop-filter:blur(16px);}
    .tab-btn{flex:1;padding:10px 4px;border:none;border-radius:12px;background:transparent;color:var(--muted);font-family:'Nunito',sans-serif;font-size:.8rem;font-weight:700;cursor:pointer;transition:all .22s;white-space:nowrap;-webkit-tap-highlight-color:transparent;}
    .tab-btn.active{background:linear-gradient(135deg,#f0c040,#ff9d00);color:#1a0f00;box-shadow:0 2px 16px rgba(240,192,64,.35);}

    .panel{display:none;padding:14px 14px 100px;position:relative;z-index:1}
    .panel.active{display:block}

    .refresh-bar{display:flex;align-items:center;justify-content:space-between;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:9px 14px;margin-bottom:14px;}
    .refresh-left{display:flex;flex-direction:column;gap:2px}
    .refresh-label{font-size:.65rem;letter-spacing:.12em;color:var(--muted);text-transform:uppercase}
    .refresh-time{font-size:.8rem;font-weight:700;color:var(--text)}
    .countdown-wrap{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
    .countdown-label{font-size:.65rem;letter-spacing:.1em;color:var(--muted);text-transform:uppercase}
    .countdown{font-family:'Cinzel',serif;font-size:1rem;font-weight:700;color:var(--gold);text-shadow:0 0 10px rgba(240,192,64,.4)}

    .section-label{display:flex;align-items:center;gap:8px;margin-bottom:12px}
    .pip{width:7px;height:7px;border-radius:50%;flex-shrink:0}
    .pip-today{background:var(--gold);box-shadow:0 0 6px var(--gold);animation:pp 2s infinite}
    .pip-debug{background:var(--purple);box-shadow:0 0 6px var(--purple);animation:pp 2s infinite}
    @keyframes pp{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(1.6)}}
    .section-label>span:not(.pip){font-family:'Cinzel',serif;font-size:.7rem;letter-spacing:.14em;color:var(--muted);text-transform:uppercase;}
    .count-badge{margin-left:auto;font-size:.64rem;font-weight:700;padding:2px 10px;border-radius:20px;}
    .badge-today{background:rgba(240,192,64,.10);color:var(--gold);border:1px solid rgba(240,192,64,.25)}
    .badge-debug{background:rgba(192,159,255,.10);color:var(--purple);border:1px solid rgba(192,159,255,.25)}

    .user-card{display:flex;align-items:center;gap:12px;padding:12px 13px;background:var(--card);border:1px solid var(--border);border-radius:16px;margin-bottom:9px;cursor:pointer;position:relative;overflow:hidden;transition:transform .14s,box-shadow .14s;-webkit-tap-highlight-color:transparent;user-select:none;}
    .user-card::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,var(--shine) 0%,transparent 55%);pointer-events:none;}
    .user-card:active{transform:scale(.974);box-shadow:0 0 0 2px var(--gold)}
    .rank{width:22px;text-align:center;flex-shrink:0;font-family:'Cinzel',serif;font-size:.72rem;font-weight:700;color:var(--muted);}
    .rank.top1{color:#ffd700;text-shadow:0 0 8px rgba(255,215,0,.6)}
    .rank.top2{color:#c0c0c0;text-shadow:0 0 8px rgba(192,192,192,.4)}
    .rank.top3{color:#cd7f32;text-shadow:0 0 8px rgba(205,127,50,.4)}
    .avatar{width:46px;height:46px;border-radius:50%;flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:1.3rem;background:var(--surface);}
    .avatar img{width:100%;height:100%;object-fit:cover;border-radius:50%}
    .av-today{border:2px solid rgba(240,192,64,.45)}
    .user-info{flex:1;min-width:0}
    .username{font-size:.93rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .sid-row{display:flex;align-items:center;gap:5px;margin-top:3px}
    .sid-text{font-size:.67rem;color:var(--muted);font-family:monospace;letter-spacing:.04em}
    .copy-hint{font-size:.6rem;color:var(--muted);opacity:.45}
    .bonus-col{text-align:right;flex-shrink:0}
    .bonus-amount{font-family:'Cinzel',serif;font-size:1rem;font-weight:700;color:var(--gold);text-shadow:0 0 10px rgba(240,192,64,.4);}
    .bonus-amount.zero{color:var(--muted);text-shadow:none;font-size:.75rem}
    .bonus-tag{font-size:.6rem;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;display:block;margin-top:1px}
    .ripple{position:absolute;border-radius:50%;background:rgba(240,192,64,.2);transform:scale(0);animation:rip .55s linear forwards;pointer-events:none;}
    @keyframes rip{to{transform:scale(4);opacity:0}}
    .empty-state{text-align:center;padding:48px 20px;font-size:.82rem;color:var(--muted);line-height:1.8;}
    .empty-state .e-icon{font-size:2.2rem;display:block;margin-bottom:12px;opacity:.5}
    .toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(18px);background:linear-gradient(135deg,#1e1630,#120f20);border:1px solid rgba(240,192,64,.4);color:var(--gold);padding:11px 26px;border-radius:30px;font-size:.78rem;font-weight:700;letter-spacing:.07em;box-shadow:0 8px 30px rgba(0,0,0,.55),0 0 22px rgba(240,192,64,.14);opacity:0;transition:all .28s cubic-bezier(.34,1.56,.64,1);z-index:999;pointer-events:none;white-space:nowrap;}
    .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

    /* Debug panel */
    .trigger-row{display:flex;gap:8px;margin-bottom:14px;}
    .trigger-btn{flex:1;padding:10px 8px;border-radius:12px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-family:'Nunito',sans-serif;font-size:.75rem;font-weight:700;cursor:pointer;transition:all .2s;-webkit-tap-highlight-color:transparent;}
    .trigger-btn:hover{border-color:var(--gold);color:var(--gold);}
    .trigger-btn:active{transform:scale(.96);}
    .trigger-btn.running{opacity:.6;pointer-events:none;}
    .trigger-status{padding:10px 14px;border-radius:12px;margin-bottom:12px;font-size:.75rem;font-weight:700;font-family:monospace;background:var(--surface);border:1px solid var(--border);color:var(--muted);display:none;}
    .trigger-status.show{display:block;}
    .trigger-status.ok{color:var(--green);border-color:rgba(105,212,126,.3);}
    .trigger-status.err{color:var(--red);border-color:rgba(255,107,107,.3);}
    .debug-section{margin-bottom:18px;}
    .debug-section-title{font-family:'Cinzel',serif;font-size:.65rem;letter-spacing:.14em;color:var(--purple);text-transform:uppercase;margin-bottom:8px;padding:6px 10px;background:rgba(192,159,255,.06);border:1px solid rgba(192,159,255,.15);border-radius:8px;}
    .debug-entry{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:7px;}
    .debug-entry.ok{border-color:rgba(105,212,126,.25);}
    .debug-entry.warn{border-color:rgba(255,193,7,.25);}
    .debug-entry.error{border-color:rgba(255,107,107,.3);}
    .debug-msg{font-size:.72rem;font-weight:700;margin-bottom:6px;}
    .debug-entry.ok .debug-msg{color:var(--green);}
    .debug-entry.warn .debug-msg{color:var(--yellow);}
    .debug-entry.error .debug-msg{color:var(--red);}
    .debug-body-wrap{margin-top:6px;}
    .debug-body-wrap summary{font-size:.65rem;color:var(--muted);cursor:pointer;padding:4px 6px;border-radius:6px;background:rgba(255,255,255,.04);list-style:none;display:flex;align-items:center;gap:5px;}
    .debug-body-wrap summary::-webkit-details-marker{display:none;}
    .debug-body-wrap[open] summary{color:var(--text);}
    .debug-body{margin-top:8px;padding:10px;border-radius:8px;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.06);font-size:.62rem;color:#aaa;font-family:monospace;white-space:pre-wrap;word-break:break-all;max-height:280px;overflow-y:auto;line-height:1.5;}
    .status-row{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;}
    .status-chip{padding:5px 12px;border-radius:20px;font-size:.65rem;font-weight:700;border:1px solid var(--border);background:var(--surface);}
    .status-chip.ok{color:var(--green);border-color:rgba(105,212,126,.3);background:rgba(105,212,126,.07);}
    .status-chip.warn{color:var(--yellow);border-color:rgba(255,193,7,.3);background:rgba(255,193,7,.07);}
    .status-chip.err{color:var(--red);border-color:rgba(255,107,107,.3);background:rgba(255,107,107,.07);}
  </style>
</head>
<body>
<div id="stars"></div>

<!-- Password overlay -->
<div id="pw-overlay">
  <span class="pw-crown">👑</span>
  <div class="pw-title">Star Treasure</div>
  <div class="pw-sub">Enter password to continue</div>
  <div class="pw-box">
    <input class="pw-input" id="pw-input" type="password" placeholder="Password" autocomplete="off"/>
    <button class="pw-btn" onclick="checkPassword()">ENTER</button>
    <div class="pw-err hidden" id="pw-err">Wrong password. Try again.</div>
  </div>
</div>

<header>
  <span class="crown">👑</span>
  <h1>Star Treasure</h1>
  <p class="tagline">Revealing Mystery Mans 🎭</p>
</header>

<div class="tabs">
  <button class="tab-btn active" onclick="switchTab('today',this)">⭐ Today</button>
  <button class="tab-btn" id="debug-tab-btn" style="display:none" onclick="switchTab('debug',this)">🛠 Debug</button>
</div>

<!-- TODAY -->
<div class="panel active" id="panel-today">
  <div style="height:14px"></div>
  <div class="refresh-bar">
    <div class="refresh-left">
      <span class="refresh-label">Last updated</span>
      <span class="refresh-time">${timeAgo(todayUpdated)}</span>
    </div>
    <div class="countdown-wrap">
      <span class="countdown-label">Next refresh</span>
      <span class="countdown" id="today-countdown">1:00</span>
    </div>
  </div>
  <div class="section-label">
    <span class="pip pip-today"></span>
    <span>Today's Top Players</span>
    <span class="count-badge badge-today">${todayCount} Players</span>
  </div>
  <div id="today-list">
    ${todayCards || `<div class="empty-state"><span class="e-icon">⏳</span>Fetching players...<br>Check back in a moment.</div>`}
  </div>
</div>

<!-- DEBUG (shown only via ?debug=1) -->
<div class="panel" id="panel-debug">
  <div style="height:14px"></div>
  <div class="status-row">
    <span class="status-chip ${todayCount > 0 ? 'ok' : 'err'}">⭐ Today: ${todayCount} users</span>
    <span class="status-chip ${todayUpdated ? 'ok' : 'err'}">📅 Updated: ${timeAgo(todayUpdated)}</span>
  </div>
  <div class="section-label" style="margin-bottom:10px">
    <span class="pip pip-debug"></span>
    <span>Manual Triggers</span>
  </div>
  <div class="trigger-row">
    <button class="trigger-btn" onclick="triggerFetch(this)">▶ Run cronToday Now</button>
  </div>
  <div class="trigger-status" id="trigger-status"></div>
  <div class="section-label" style="margin-bottom:10px">
    <span class="pip pip-debug"></span>
    <span>Last API Responses</span>
    <span class="count-badge badge-debug">In-Memory</span>
  </div>
  <div id="debug-api-logs">${debugHtml}</div>
</div>

<div class="toast" id="toast">✓ Copied!</div>

<script>
  // Starfield
  const sf = document.getElementById('stars');
  for(let i=0;i<90;i++){
    const s=document.createElement('span');
    const sz=Math.random()*2+.8;
    s.style.cssText='width:'+sz+'px;height:'+sz+'px;left:'+(Math.random()*100)+'%;top:'+(Math.random()*100)+'%;--d:'+(2+Math.random()*4)+'s;--o:'+(0.25+Math.random()*.6)+';--dl:'+(Math.random()*6)+'s';
    sf.appendChild(s);
  }

  // Password gate
  const SESSION_KEY = 'st_auth';
  function checkPassword(){
    const val = document.getElementById('pw-input').value;
    if(val === '${PASSWORD}'){
      sessionStorage.setItem(SESSION_KEY,'1');
      document.getElementById('pw-overlay').classList.add('hidden');
    } else {
      const inp = document.getElementById('pw-input');
      document.getElementById('pw-err').classList.remove('hidden');
      inp.classList.add('shake');
      setTimeout(()=>inp.classList.remove('shake'),400);
      inp.value='';
    }
  }
  if(sessionStorage.getItem(SESSION_KEY)==='1') document.getElementById('pw-overlay').classList.add('hidden');
  document.getElementById('pw-input').addEventListener('keydown',e=>{ if(e.key==='Enter') checkPassword(); });

  // Debug tab visibility
  if(new URLSearchParams(location.search).get('debug')==='1')
    document.getElementById('debug-tab-btn').style.display='';

  // Tab switching
  function switchTab(name,btn){
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.getElementById('panel-'+name).classList.add('active');
    btn.classList.add('active');
  }

  // Toast
  let tt;
  function showToast(msg){
    const t=document.getElementById('toast');
    t.textContent=msg; t.classList.add('show');
    clearTimeout(tt); tt=setTimeout(()=>t.classList.remove('show'),2300);
  }

  // Copy SID on card click
  function copySid(sid,card,e){
    const r=document.createElement('span'); r.className='ripple';
    const rect=card.getBoundingClientRect();
    const cx=(e.clientX||rect.left+rect.width/2)-rect.left;
    const cy=(e.clientY||rect.top+rect.height/2)-rect.top;
    const sz=Math.max(rect.width,rect.height);
    r.style.cssText='width:'+sz+'px;height:'+sz+'px;left:'+(cx-sz/2)+'px;top:'+(cy-sz/2)+'px';
    card.appendChild(r); setTimeout(()=>r.remove(),600);
    navigator.clipboard.writeText(sid)
      .then(()=>showToast('✓ '+sid+' copied!'))
      .catch(()=>{
        const ta=document.createElement('textarea');
        ta.value=sid; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        showToast('✓ '+sid+' copied!');
      });
  }
  document.querySelectorAll('.user-card').forEach(card=>{
    const sid=card.dataset.sid;
    card.addEventListener('click',(e)=>copySid(sid,card,e));
    let pt;
    card.addEventListener('touchstart',(e)=>{pt=setTimeout(()=>copySid(sid,card,e.touches[0]),500)},{passive:true});
    card.addEventListener('touchend',()=>clearTimeout(pt));
    card.addEventListener('touchmove',()=>clearTimeout(pt));
  });

  // Countdown timer — page auto-reloads every 60s to pick up fresh data
  const updatedTs = ${todayUpdated || 0};
  function updateCountdown(){
    const el=document.getElementById('today-countdown');
    if(!el) return;
    const elapsed=Math.floor((Date.now()-updatedTs)/1000);
    const remaining=Math.max(0,60-elapsed);
    const m=Math.floor(remaining/60);
    const s=remaining%60;
    el.textContent=m+':'+(s<10?'0':'')+s;
    if(remaining===0){ el.textContent='Updating...'; setTimeout(()=>location.reload(),4000); }
  }
  if(updatedTs>0){ updateCountdown(); setInterval(updateCountdown,1000); }
  else { setTimeout(()=>location.reload(),15000); } // retry if no data yet

  // Manual trigger
  async function triggerFetch(btn){
    const statusEl=document.getElementById('trigger-status');
    btn.classList.add('running'); btn.textContent='⏳ Running...';
    statusEl.className='trigger-status show';
    statusEl.textContent='Running cron...';
    try {
      const res=await fetch('/trigger-today');
      const text=await res.text();
      if(res.ok){
        statusEl.className='trigger-status show ok';
        statusEl.textContent='✅ '+text+' — Reloading in 3s...';
        setTimeout(()=>location.reload(),3000);
      } else {
        statusEl.className='trigger-status show err';
        statusEl.textContent='❌ HTTP '+res.status+': '+text;
      }
    } catch(e){
      statusEl.className='trigger-status show err';
      statusEl.textContent='❌ Network error: '+e.message;
    }
    btn.classList.remove('running'); btn.textContent='▶ Run cronToday Now';
  }
</script>
</body>
</html>`;
}

// ── Express routes ────────────────────────────────────────────

// Main page
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(renderHTML());
});

// Manual trigger (for debug panel)
app.get('/trigger-today', async (req, res) => {
  await cronToday();
  res.send(`cronToday ran. ${store.todayUsers.length} users in memory.`);
});

// Raw state dump for debugging
app.get('/debug-kv', (req, res) => {
  res.json({
    todayUsers_count: store.todayUsers.length,
    todayUpdated    : store.todayUpdated,
    todayDayKey     : store.todayDayKey,
    cronRunning     : store.cronRunning,
    debugToday      : store.debugToday,
    todayUsers      : store.todayUsers,
  });
});

// Health check (keeps Render free tier alive if you ping it)
app.get('/health', (req, res) => res.send('OK'));

app.listen(PORT, () => {
  LOG.info(`Star Treasure running on port ${PORT}`);
});

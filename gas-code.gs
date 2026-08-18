// ================================================================
// cochi analytics — GAS v2 追加分（実際にデプロイ済みの内容）
//
// 【重要】本番の Apps Script プロジェクト "cochi-analytics" は
//   スプレッドシートではなく PropertiesService に集計を持つ実装です。
//   （直近 MAX_SESSIONS = 200 セッションのみ保持）
//   そのため v2 も PropertiesService に日次バケットを積む方式にしました。
//   追加の OAuth スコープは不要です。
//
// 既存コード（doPost / doGet(action=data) / aggregate ほか）は
//   一切変更していません。以下の2行を挿入し、末尾に v2 関数群を追加しただけです。
//
//   1) doPost 内、`const data = JSON.parse(e.postData.contents);` の直後:
//        try { v2Record(data); } catch (v2e) {}
//
//   2) doGet の先頭:
//        if ((e.parameter.action || "") === "v2") {
//          try { return jsonResponse(v2Api()); }
//          catch (err) { return jsonResponse({ error: err.message }); }
//        }
//
// デプロイ手順（URLを変えないこと）:
//   デプロイ → デプロイを管理 → 鉛筆(編集) → バージョン「新バージョン」→ デプロイ
//   ※「新しいデプロイ」は別URLになるので使わないこと
//
// 旧リポジトリ版（スプレッドシート前提・未使用）: gas-code.v1.backup.gs
// ================================================================


// ================================================================
// v2: 日次バケット集計（追加スコープ不要 / PropertiesService のみ）
// dashboard2.html はこの ?action=v2 を読みます。
//
// bucket 直下 = サイト全体の数値
// bucket.pp.index / bucket.pp.recruit = ページ別の同じ数値
//   → ダッシュボード上部の「全体 / 集客サイト / 求人LP」切替に使います
// ================================================================
const V2_TZ      = "Asia/Tokyo";
const V2_PREFIX  = "d2_";
const V2_KEEP    = 400;   // 保持日数
const V2_MAXSEEN = 2500;  // 1日あたりの重複判定キー上限

function v2NewBucket() {
  return { pv:0, eng:0, u:0, nu:0, s:0, seen:{}, cta:{}, hr:{}, ctahr:{},
           pg:{}, lp:{}, ev:{}, src:{}, dev:{}, ex:{}, fn:{1:0,2:0,3:0}, sc:{},
           pp:{}, trunc:0 };
}

// ページ別の内訳（全体と同じ形。src/dev/ev はサイト全体でのみ持ちます）
function v2NewPage() {
  return { pv:0, eng:0, u:0, nu:0, s:0, cta:{}, hr:{}, ctahr:{},
           ex:{}, fn:{1:0,2:0,3:0}, sc:{}, lp:0 };
}

function v2Page(b, path) {
  if (!b.pg[path]) b.pg[path] = { pv:0, s:0, line:0, cta:0, eng:0 };
  return b.pg[path];
}

// doPost から呼ばれる。失敗しても既存処理に影響しないよう呼び出し側で握りつぶす。
function v2Record(data) {
  const now  = new Date();
  const date = Utilities.formatDate(now, V2_TZ, "yyyy-MM-dd");
  const hour = Number(Utilities.formatDate(now, V2_TZ, "H"));
  const lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (e) { return; }
  try {
    const props = PropertiesService.getScriptProperties();
    const key   = V2_PREFIX + date;
    const b     = JSON.parse(props.getProperty(key) || "null") || v2NewBucket();
    if (!b.lp) b.lp = {};   // 既存バケットとの互換
    if (!b.ev) b.ev = {};
    if (!b.pp) b.pp = {};

    const sid  = data.sid || "";
    const uid  = data.uid || sid;
    const ev   = data.event || "";
    const path = data.path || (data.page === "recruit" ? "/recruit.html" : "/");
    const pkey = (data.page === "recruit") ? "recruit" : "index";
    if (!b.pp[pkey]) b.pp[pkey] = v2NewPage();
    const P = b.pp[pkey];

    const mark = function (k) {
      if (b.seen[k]) return false;
      if (Object.keys(b.seen).length >= V2_MAXSEEN) { b.trunc = 1; return false; }
      b.seen[k] = 1; return true;
    };

    // 全イベントの発生数（イベント一覧用・サイト全体）
    if (ev) b.ev[ev] = (b.ev[ev] || 0) + 1;

    if (ev === "page_view") {
      b.pv++; P.pv++;
      b.hr[hour] = (b.hr[hour] || 0) + 1;
      P.hr[hour] = (P.hr[hour] || 0) + 1;

      if (uid && mark("u|" + uid))                { b.u++; if (data.is_new == 1) b.nu++; }
      if (uid && mark("pu|" + pkey + "|" + uid))  { P.u++; if (data.is_new == 1) P.nu++; }

      if (sid && mark("s|" + sid)) {
        b.s++;
        if (data.src)    b.src[data.src]    = (b.src[data.src] || 0) + 1;
        if (data.device) b.dev[data.device] = (b.dev[data.device] || 0) + 1;
        b.lp[path] = (b.lp[path] || 0) + 1;   // 入口ページ
      }
      if (sid && mark("ps|" + pkey + "|" + sid)) { P.s++; P.lp++; }

      const p = v2Page(b, path);
      p.pv++;
      if (sid && mark("p|" + sid + "|" + path)) p.s++;
    }

    if (ev === "cta_click" || ev === "form_submit") {
      const t = data.cta_type || "other";
      b.cta[t] = (b.cta[t] || 0) + 1;
      P.cta[t] = (P.cta[t] || 0) + 1;
      const p = v2Page(b, path);
      p.cta++;
      if (t === "line") {
        p.line++;
        b.ctahr[hour] = (b.ctahr[hour] || 0) + 1;
        P.ctahr[hour] = (P.ctahr[hour] || 0) + 1;
      }
    }

    if (ev === "section_exit") {
      const sec = data.last_section || data.section_name;
      if (sec) { b.ex[sec] = (b.ex[sec] || 0) + 1; P.ex[sec] = (P.ex[sec] || 0) + 1; }
    }

    if (ev === "section_exit" || ev === "engagement_ping") {
      const d = Number(data.engaged_delta || 0);
      if (d > 0 && d < 3600) { b.eng += d; P.eng += d; v2Page(b, path).eng += d; }
    }

    if (ev === "insight_category_reached") {
      const lv = parseInt(data.category_level, 10) || 0;
      for (var i = 1; i <= lv; i++) {
        if (sid && mark("f"  + i + "|" + sid))               b.fn[i]++;
        if (sid && mark("pf" + i + "|" + pkey + "|" + sid))  P.fn[i]++;
      }
    }

    if (ev === "scroll_depth" && data.depth_percent) {
      b.sc[data.depth_percent] = (b.sc[data.depth_percent] || 0) + 1;
      P.sc[data.depth_percent] = (P.sc[data.depth_percent] || 0) + 1;
    }

    props.setProperty(key, JSON.stringify(b));
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// dashboard2.html 用 API
function v2Api() {
  const all   = PropertiesService.getScriptProperties().getProperties();
  const dates = Object.keys(all)
    .filter(function (k) { return k.indexOf(V2_PREFIX) === 0; })
    .map(function (k) { return k.slice(V2_PREFIX.length); })
    .sort();

  const daily = dates.map(function (d) {
    const b = JSON.parse(all[V2_PREFIX + d]);
    return { d:d, u:b.u, nu:b.nu, s:b.s, pv:b.pv, eng:Math.round(b.eng),
             cta:b.cta, hr:b.hr, ctahr:b.ctahr, pg:b.pg, lp:b.lp || {}, ev:b.ev || {},
             src:b.src, dev:b.dev, ex:b.ex, fn:b.fn, sc:b.sc, pp:b.pp || {} };
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    timezone: V2_TZ,
    daily: daily,
    firstDate: dates[0] || null,
    lastDate:  dates[dates.length - 1] || null,
    totalRows: daily.reduce(function (a, x) { return a + x.pv; }, 0),
    exact: {}
  };
}

// 古い日付を削除（トリガーで月1回など。手動実行でも可）
function v2Prune() {
  const props = PropertiesService.getScriptProperties();
  const dates = Object.keys(props.getProperties())
    .filter(function (k) { return k.indexOf(V2_PREFIX) === 0; })
    .sort();
  if (dates.length > V2_KEEP) {
    dates.slice(0, dates.length - V2_KEEP).forEach(function (k) { props.deleteProperty(k); });
  }
}

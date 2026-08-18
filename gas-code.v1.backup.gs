// ================================================================
// cochi Hair&Spa - Analytics Backend
// Google Apps Script に貼り付けて使用してください
// ================================================================

const SHEET_NAME = 'events';

// イベント受信（analytics.js からのデータ保存）
function doPost(e) {
  try {
    const data   = JSON.parse(e.postData.contents);
    const sheet  = getSheet();
    const date   = new Date();

    sheet.appendRow([
      date.toISOString(),          // A: タイムスタンプ
      data.sid       || '',        // B: セッションID
      data.page      || '',        // C: ページ（index / recruit）
      data.event     || '',        // D: イベント名
      data.section_name       || data.last_section || '',   // E: セクション名
      data.category_level     || '',  // F: インサイトレベル（1/2/3）
      data.cta_type           || '',  // G: CTAタイプ
      data.scroll_percent     || '',  // H: スクロール率
    ]);

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ダッシュボード用データ取得
function doGet(e) {
  if ((e.parameter.action || '') !== 'data') {
    return ContentService.createTextOutput('cochi analytics API');
  }

  try {
    const rows   = getSheet().getDataRange().getValues();
    const events = rows.slice(1).filter(r => r[0]); // ヘッダー除外

    const result = aggregate(events);
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ================================================================
// 集計ロジック
// ================================================================
function aggregate(events) {
  const dailySessions  = {};  // date → Set<sid>
  const pageSessions   = {};  // page → Set<sid>
  const sectionExits   = {};  // sectionName → count
  const insightBySid   = {};  // sid → maxLevel
  const ctaCounts      = {};  // ctaType → count
  const allSids        = new Set();
  const sevenDaysAgo   = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  events.forEach(([ts, sid, page, event, section, insightLevel, ctaType]) => {
    if (!sid) return;
    const date = new Date(ts);
    const dateStr = date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });

    // 訪問者（page_view のみカウント）
    if (event === 'page_view') {
      allSids.add(sid);
      if (!dailySessions[dateStr]) dailySessions[dateStr] = new Set();
      dailySessions[dateStr].add(sid);
      if (!pageSessions[page]) pageSessions[page] = new Set();
      pageSessions[page].add(sid);
    }

    // セクション離脱
    if (event === 'section_exit' && section) {
      sectionExits[section] = (sectionExits[section] || 0) + 1;
    }

    // インサイトレベル（セッションごとの最高値）
    if (event === 'insight_category_reached' && insightLevel) {
      const lv = parseInt(insightLevel) || 0;
      insightBySid[sid] = Math.max(insightBySid[sid] || 0, lv);
    }

    // CTAクリック
    if (event === 'cta_click' && ctaType) {
      ctaCounts[ctaType] = (ctaCounts[ctaType] || 0) + 1;
    }
  });

  // ── 直近7日 ──
  const last7 = Object.entries(dailySessions)
    .filter(([d]) => {
      const parts = d.split('/');
      const dt = new Date(new Date().getFullYear(), parseInt(parts[0]) - 1, parseInt(parts[1]));
      return dt >= sevenDaysAgo;
    })
    .reduce((acc, [, set]) => { set.forEach(s => acc.add(s)); return acc; }, new Set()).size;

  // ── 日別データ（直近30日） ──
  const dailyData = Object.entries(dailySessions)
    .map(([date, set]) => ({ date, count: set.size }))
    .slice(-30);

  // ── セクション離脱ランキング ──
  const sectionExitArr = Object.entries(sectionExits)
    .map(([section, count]) => ({ section, count }))
    .sort((a, b) => b.count - a.count);

  // ── インサイトファネル（セッション単位） ──
  const total       = allSids.size || 1;
  const lvCounts    = { 1: 0, 2: 0, 3: 0 };
  Object.values(insightBySid).forEach(lv => {
    if (lv >= 1) lvCounts[1]++;
    if (lv >= 2) lvCounts[2]++;
    if (lv >= 3) lvCounts[3]++;
  });
  const insightFunnel = [
    { label: '認知アクション',       count: lvCounts[1], pct: Math.round(lvCounts[1] / total * 100) },
    { label: '興味・関心アクション', count: lvCounts[2], pct: Math.round(lvCounts[2] / total * 100) },
    { label: '検討アクション',       count: lvCounts[3], pct: Math.round(lvCounts[3] / total * 100) },
  ];

  // ── ページ別 ──
  const pageData = Object.entries(pageSessions)
    .map(([page, set]) => ({ page, count: set.size }));

  // ── CTAクリック ──
  const ctaData = Object.entries(ctaCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalVisitors: allSids.size,
    last7days:     last7,
    dailyData,
    sectionExits:  sectionExitArr,
    insightFunnel,
    pageData,
    ctaData,
  };
}

// ================================================================
// ユーティリティ
// ================================================================
function getSheet() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['timestamp','session_id','page','event','section','insight_level','cta_type','scroll_pct']);
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

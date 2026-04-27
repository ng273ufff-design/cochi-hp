// cochi Hair&Spa - Analytics Tracker

(function () {
  'use strict';

  // ================================================================
  // CONFIG
  // ================================================================
  // Google Apps Script の URL を設定してください（setup 後に入力）
  const SHEETS_ENDPOINT = '';  // ← 後で設定

  // ================================================================
  // セクション定義
  // ================================================================
  const INDEX_SECTIONS = {
    '.hero':              ['ヒーロー',         1],
    '#concept':           ['コンセプト',       1],
    '#staff':             ['スタッフ',         2],
    '#strengths':         ['選ばれる理由',     2],
    '#menu':              ['メニュー',         2],
    '#headspa-article':   ['ヘッドスパ',       2],
    '#products':          ['取り扱い商品',     2],
    '#bottom-treatment':  ['ボトムケア',       2],
    '#pricing':           ['初回特典',         3],
    '#faq':               ['よくある質問',     3],
    '#voice':             ['お客様の声',       3],
    '#access':            ['アクセス',         3],
    '#reserve':           ['予約CTA',          3],
  };

  const RECRUIT_SECTIONS = {
    '.hero':        ['ヒーロー',               1],
    '.newopen':     ['新店オープン情報',       1],
    '.salon-photo': ['サロン紹介',             1],
    '.appeal':      ['なぜcochi',              2],
    '.split':       ['働き方・シフト',         2],
    '.gallery':     ['ギャラリー',             2],
    '.salary':      ['給与',                   3],
    '.benefits':    ['福利厚生',               3],
    '.interview':   ['スタッフインタビュー',   3],
    '.voice':       ['口コミ',                 3],
    '#contact':     ['お問い合わせ',           3],
    '.access':      ['アクセス',               3],
  };

  const INSIGHT_LABELS = { 1: '認知アクション', 2: '興味・関心アクション', 3: '検討アクション' };

  // ================================================================
  // State
  // ================================================================
  const isRecruit = window.location.pathname.includes('recruit');
  const SECTIONS  = isRecruit ? RECRUIT_SECTIONS : INDEX_SECTIONS;
  const pageName  = isRecruit ? 'recruit' : 'index';

  // セッションID（タブを閉じるまで同一）
  const SESSION_ID = sessionStorage.getItem('cochi_sid') || (() => {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem('cochi_sid', id);
    return id;
  })();

  let lastVisibleSection = null;
  let sessionInsightLevel = 0;
  const scrollMilestones = new Set();
  const viewedSections   = new Set();

  // ================================================================
  // Sheets への送信（fire-and-forget）
  // ================================================================
  function sendToSheets(eventName, params) {
    if (!SHEETS_ENDPOINT) return;
    try {
      fetch(SHEETS_ENDPOINT, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ event: eventName, sid: SESSION_ID, page: pageName, ts: Date.now(), ...params }),
      }).catch(() => {});
    } catch (_) {}
  }

  // ================================================================
  // GA4 イベント送信
  // ================================================================
  function sendEvent(name, params) {
    if (typeof window.gtag === 'function') {
      window.gtag('event', name, { page_label: pageName, ...params });
    }
    sendToSheets(name, params);
  }

  // ================================================================
  // インサイトカテゴリ更新
  // ================================================================
  function updateInsightLevel(level) {
    if (level > sessionInsightLevel) {
      sessionInsightLevel = level;
      sendEvent('insight_category_reached', {
        category: INSIGHT_LABELS[level],
        category_level: level,
      });
    }
  }

  // ================================================================
  // セクション表示監視
  // ================================================================
  function initSectionTracking() {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target;
            const sectionKey = el.dataset.cochiSection;
            const [sectionName, insightLevel] = SECTIONS[sectionKey] || [];
            if (!sectionName) return;
            lastVisibleSection = sectionName;
            if (!viewedSections.has(sectionKey)) {
              viewedSections.add(sectionKey);
              sendEvent('section_view', { section_name: sectionName, insight_level: INSIGHT_LABELS[insightLevel] });
              updateInsightLevel(insightLevel);
            }
          }
        });
      },
      { threshold: 0.3, rootMargin: '-5% 0px -5% 0px' }
    );
    Object.keys(SECTIONS).forEach((selector) => {
      const el = document.querySelector(selector);
      if (el) { el.dataset.cochiSection = selector; observer.observe(el); }
    });
  }

  // ================================================================
  // 離脱セクション追跡
  // ================================================================
  function initExitTracking() {
    const scrollPct = () =>
      Math.round((window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight)) * 100);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        sendEvent('section_exit', {
          last_section:          lastVisibleSection || '（トップ付近）',
          scroll_percent:        scrollPct(),
          insight_level_reached: INSIGHT_LABELS[sessionInsightLevel] || '（未計測）',
        });
      }
    });
  }

  // ================================================================
  // スクロール深度
  // ================================================================
  function initScrollTracking() {
    const onScroll = throttle(() => {
      const pct = Math.round((window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight)) * 100);
      [25, 50, 75, 90].forEach((m) => {
        if (pct >= m && !scrollMilestones.has(m)) {
          scrollMilestones.add(m);
          sendEvent('scroll_depth', { depth_percent: m });
        }
      });
    }, 300);
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ================================================================
  // CTAクリック追跡
  // ================================================================
  function initCTATracking() {
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a, button');
      if (!link) return;
      const href = (link.href || '').toLowerCase();
      const text = link.textContent.trim();
      if (href.includes('line.me') || href.includes('lin.ee') || text.includes('LINE')) {
        sendEvent('cta_click', { cta_type: 'line', cta_text: text.substring(0, 50), from_section: lastVisibleSection || '不明' });
        updateInsightLevel(3);
      } else if (text.includes('応募') || text.includes('見学') || href.includes('recruit')) {
        sendEvent('cta_click', { cta_type: 'recruit', cta_text: text.substring(0, 50), from_section: lastVisibleSection || '不明' });
        updateInsightLevel(3);
      } else if (href.includes('instagram')) {
        sendEvent('cta_click', { cta_type: 'instagram', from_section: lastVisibleSection || '不明' });
        updateInsightLevel(2);
      }
    });
  }

  // ================================================================
  // ユーティリティ
  // ================================================================
  function throttle(fn, delay) {
    let last = 0;
    return function (...args) { const now = Date.now(); if (now - last >= delay) { last = now; fn.apply(this, args); } };
  }

  // ================================================================
  // 初期化
  // ================================================================
  function init() {
    sendEvent('page_view', {});   // 訪問カウント
    initSectionTracking();
    initScrollTracking();
    initExitTracking();
    initCTATracking();
    updateInsightLevel(1);        // 認知アクション
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
  else { init(); }
})();

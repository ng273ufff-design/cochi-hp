// cochi Hair&Spa - Analytics Tracker v2
// v1 との互換性を維持したまま、以下を追加取得します。
//   時刻 / 曜日 / 流入元 / デバイス / 新規・リピート / ページパス /
//   エンゲージメント時間 / 電話・メール・フォーム送信
// v1 のバックアップ: analytics.v1.backup.js

(function () {
  'use strict';

  // ================================================================
  // CONFIG
  // ================================================================
  const SHEETS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyEHajt85Ke0DBk9SED20zOBQ2QMG6_g2W8HhheyvWXBsF81fEMbHiCgu1wDJvfRXao/exec';
  const TRACKER_VERSION = 2;

  // ================================================================
  // セクション定義（v1 と同一）
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
  const pagePath  = normalizePath(window.location.pathname);

  // セッションID（タブを閉じるまで同一）
  const SESSION_ID = sessionStorage.getItem('cochi_sid') || (() => {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem('cochi_sid', id);
    return id;
  })();

  // 新規 / リピート判定（訪問者ID を localStorage に保持）
  const VISITOR = (() => {
    let uid = null, isNew = 1;
    try {
      uid = localStorage.getItem('cochi_uid');
      if (uid) {
        isNew = 0;
      } else {
        uid = 'u' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem('cochi_uid', uid);
        localStorage.setItem('cochi_first_seen', new Date().toISOString());
      }
    } catch (_) {
      uid = 'u_nostorage';
    }
    return { uid, isNew };
  })();

  // 流入元（セッション内で最初の1回だけ判定し固定＝ファーストタッチ）
  const SOURCE = (() => {
    try {
      const cached = sessionStorage.getItem('cochi_src');
      if (cached) return JSON.parse(cached);
    } catch (_) {}
    const s = classifySource();
    try { sessionStorage.setItem('cochi_src', JSON.stringify(s)); } catch (_) {}
    return s;
  })();

  const DEVICE = classifyDevice();

  let lastVisibleSection  = null;
  let sessionInsightLevel = 0;
  const scrollMilestones  = new Set();
  const viewedSections    = new Set();
  let maxScrollPct        = 0;

  // エンゲージメント時間（画面が見えていて操作可能な秒数の積算）
  let engagedMs   = 0;
  let engagedFrom = document.visibilityState === 'visible' ? Date.now() : 0;
  let engagedSent = 0;

  // ================================================================
  // 流入元・デバイス判定
  // ================================================================
  function classifySource() {
    const p = new URLSearchParams(window.location.search);
    const utmSource   = (p.get('utm_source')   || '').toLowerCase();
    const utmMedium   = (p.get('utm_medium')   || '').toLowerCase();
    const utmCampaign = (p.get('utm_campaign') || '').toLowerCase();
    const hasAdClick  = !!(p.get('gclid') || p.get('yclid') || p.get('fbclid') && utmMedium);

    const ref = document.referrer || '';
    let host = '';
    try { host = ref ? new URL(ref).hostname.replace(/^www\./, '') : ''; } catch (_) {}
    const selfHost = window.location.hostname.replace(/^www\./, '');

    const SOCIAL = /instagram|facebook|line\.me|lin\.ee|t\.co|twitter|x\.com|tiktok|youtube|threads|pinterest/;
    const SEARCH = /google|yahoo|bing|duckduckgo|baidu|ecosia/;

    let group;
    if (hasAdClick || /cpc|ppc|paid|display/.test(utmMedium))      group = 'ad';
    else if (utmSource && SOCIAL.test(utmSource))                   group = 'social';
    else if (utmSource)                                            group = 'campaign';
    else if (!host)                                                group = 'direct';
    else if (host === selfHost)                                    group = 'internal';
    else if (SEARCH.test(host))                                    group = 'organic';
    else if (SOCIAL.test(host))                                    group = 'social';
    else                                                           group = 'referral';

    return { src: group, ref_host: host, utm_source: utmSource, utm_medium: utmMedium, utm_campaign: utmCampaign };
  }

  function classifyDevice() {
    const ua = navigator.userAgent;
    const w  = window.innerWidth || document.documentElement.clientWidth || 0;
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
    if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua) || w < 768) return 'mobile';
    return 'desktop';
  }

  function normalizePath(path) {
    if (!path || path === '/') return '/';
    return path.replace(/index\.html$/, '').replace(/\/+$/, '') || '/';
  }

  // ================================================================
  // 送信
  // ================================================================
  function basePayload() {
    const now = new Date();
    return {
      v:        TRACKER_VERSION,
      sid:      SESSION_ID,
      uid:      VISITOR.uid,
      is_new:   VISITOR.isNew,
      page:     pageName,
      path:     pagePath,
      ts:       now.getTime(),
      tz_off:   now.getTimezoneOffset(),
      device:   DEVICE,
      src:      SOURCE.src,
      ref_host: SOURCE.ref_host,
      utm_source:   SOURCE.utm_source,
      utm_medium:   SOURCE.utm_medium,
      utm_campaign: SOURCE.utm_campaign,
    };
  }

  function sendToSheets(eventName, params, useBeacon) {
    if (!SHEETS_ENDPOINT) return;
    const body = JSON.stringify(Object.assign({ event: eventName }, basePayload(), params));
    try {
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(SHEETS_ENDPOINT, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
        return;
      }
      fetch(SHEETS_ENDPOINT, {
        method: 'POST',
        mode: 'no-cors',
        keepalive: !!useBeacon,
        headers: { 'Content-Type': 'text/plain' },
        body: body,
      }).catch(() => {});
    } catch (_) {}
  }

  function sendEvent(name, params, useBeacon) {
    params = params || {};
    if (typeof window.gtag === 'function') {
      window.gtag('event', name, Object.assign({
        page_label:  pageName,
        page_path:   pagePath,
        device_type: DEVICE,
        source_group: SOURCE.src,
        visitor_type: VISITOR.isNew ? 'new' : 'returning',
      }, params));
    }
    sendToSheets(name, params, useBeacon);
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
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target;
            const sectionKey = el.dataset.cochiSection;
            const pair = SECTIONS[sectionKey] || [];
            const sectionName = pair[0], insightLevel = pair[1];
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
  // 離脱セクション追跡 + エンゲージメント時間
  // ================================================================
  function currentEngagedSec() {
    let ms = engagedMs;
    if (engagedFrom) ms += Date.now() - engagedFrom;
    return Math.round(ms / 1000);
  }

  function flush(useBeacon) {
    const eng = currentEngagedSec();
    sendEvent('section_exit', {
      last_section:          lastVisibleSection || '（トップ付近）',
      scroll_percent:        maxScrollPct,
      insight_level_reached: INSIGHT_LABELS[sessionInsightLevel] || '（未計測）',
      engaged_sec:           eng,
      engaged_delta:         Math.max(0, eng - engagedSent),
    }, useBeacon);
    engagedSent = eng;
  }

  function initExitTracking() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (engagedFrom) { engagedMs += Date.now() - engagedFrom; engagedFrom = 0; }
        flush(true);
      } else {
        engagedFrom = Date.now();
      }
    });
    window.addEventListener('pagehide', () => {
      if (engagedFrom) { engagedMs += Date.now() - engagedFrom; engagedFrom = 0; }
      flush(true);
    });
  }

  // ================================================================
  // スクロール深度
  // ================================================================
  function initScrollTracking() {
    const onScroll = throttle(() => {
      const pct = Math.round((window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight)) * 100);
      if (pct > maxScrollPct) maxScrollPct = Math.min(100, pct);
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
  // GA4 側には従来の cta_click に加えて、コンバージョン設定しやすい
  // 専用イベント名（line_reservation_click / phone_click / …）も送ります。
  const CTA_EVENT_NAME = {
    line:      'line_reservation_click',
    phone:     'phone_click',
    mail:      'mail_click',
    recruit:   'recruit_entry',
    instagram: 'instagram_click',
    map:       'map_click',
  };

  function trackCTA(type, text, level) {
    const params = {
      cta_type:     type,
      cta_text:     (text || '').substring(0, 50),
      from_section: lastVisibleSection || '不明',
    };
    sendEvent('cta_click', params);                       // 旧ダッシュボード互換
    const named = CTA_EVENT_NAME[type];
    if (named && typeof window.gtag === 'function') {     // GA4 用の専用イベント
      window.gtag('event', named, Object.assign({
        page_label: pageName, page_path: pagePath, device_type: DEVICE, source_group: SOURCE.src,
      }, params));
    }
    updateInsightLevel(level);
  }

  function initCTATracking() {
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a, button');
      if (!link) return;
      const href = (link.getAttribute('href') || link.href || '').toLowerCase();
      const text = (link.textContent || '').trim();

      if (href.includes('line.me') || href.includes('lin.ee') || text.includes('LINE')) {
        trackCTA('line', text, 3);
      } else if (href.startsWith('tel:')) {
        trackCTA('phone', text || href.replace('tel:', ''), 3);
      } else if (href.startsWith('mailto:')) {
        trackCTA('mail', text, 3);
      } else if (text.includes('応募') || text.includes('見学') || href.includes('recruit')) {
        trackCTA('recruit', text, 3);
      } else if (href.includes('instagram')) {
        trackCTA('instagram', text, 2);
      } else if (href.includes('google.com/maps') || href.includes('goo.gl/maps') || href.includes('maps.app')) {
        trackCTA('map', text, 2);
      }
    });

    // フォーム送信
    document.addEventListener('submit', (e) => {
      const form = e.target;
      if (!form || form.tagName !== 'FORM') return;
      const type = isRecruit ? 'recruit_form' : 'contact_form';
      sendEvent('form_submit', { cta_type: type, from_section: lastVisibleSection || '不明' });
      if (typeof window.gtag === 'function') {
        window.gtag('event', isRecruit ? 'recruit_entry' : 'contact_submit', {
          page_label: pageName, page_path: pagePath, device_type: DEVICE, source_group: SOURCE.src,
        });
      }
      updateInsightLevel(3);
    }, true);
  }

  // ================================================================
  // ユーティリティ
  // ================================================================
  function throttle(fn, delay) {
    let last = 0;
    return function () {
      const now = Date.now();
      if (now - last >= delay) { last = now; fn.apply(this, arguments); }
    };
  }

  // ================================================================
  // 初期化
  // ================================================================
  function init() {
    sendEvent('page_view', { title: (document.title || '').substring(0, 80) });
    initSectionTracking();
    initScrollTracking();
    initExitTracking();
    initCTATracking();
    updateInsightLevel(1);        // 認知アクション

    // 長時間滞在でも計測が残るよう、60秒ごとにエンゲージメントを中間送信
    setInterval(() => {
      const eng = currentEngagedSec();
      if (eng - engagedSent >= 60) {
        sendEvent('engagement_ping', { engaged_sec: eng, engaged_delta: eng - engagedSent });
        engagedSent = eng;
      }
    }, 60000);
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
  else { init(); }
})();

// cochi Hair&Spa - Analytics Tracker
// Tracks: visitors, section exits, insight category funnel
// GA4 Measurement ID を下記に設定してください

(function () {
  'use strict';

  // ================================================================
  // セクション定義
  // ================================================================

  // index.html のセクション → インサイトカテゴリマッピング
  const INDEX_SECTIONS = {
    // セレクタ: [日本語名, インサイトレベル(1=認知/2=興味/3=検討)]
    '.hero':              ['ヒーロー',       1],
    '#concept':           ['コンセプト',     1],
    '#staff':             ['スタッフ',       2],
    '#strengths':         ['選ばれる理由',   2],
    '#menu':              ['メニュー',       2],
    '#headspa-article':   ['ヘッドスパ',     2],
    '#products':          ['取り扱い商品',   2],
    '#bottom-treatment':  ['ボトムケア',     2],
    '#pricing':           ['初回特典',       3],
    '#faq':               ['よくある質問',   3],
    '#voice':             ['お客様の声',     3],
    '#access':            ['アクセス',       3],
    '#reserve':           ['予約CTA',        3],
  };

  // recruit.html のセクション → インサイトカテゴリマッピング
  const RECRUIT_SECTIONS = {
    '.hero':        ['ヒーロー',           1],
    '.newopen':     ['新店オープン情報',   1],
    '.salon-photo': ['サロン紹介',         1],
    '.appeal':      ['なぜcochi',          2],
    '.split':       ['働き方・シフト',     2],
    '.gallery':     ['ギャラリー',         2],
    '.salary':      ['給与',               3],
    '.benefits':    ['福利厚生',           3],
    '.interview':   ['スタッフインタビュー', 3],
    '.voice':       ['口コミ',             3],
    '#contact':     ['お問い合わせ',       3],
    '.access':      ['アクセス',           3],
  };

  const INSIGHT_LABELS = {
    1: '認知アクション',
    2: '興味・関心アクション',
    3: '検討アクション',
  };

  // ================================================================
  // State
  // ================================================================
  const isRecruit = window.location.pathname.includes('recruit');
  const SECTIONS = isRecruit ? RECRUIT_SECTIONS : INDEX_SECTIONS;
  const pageName = isRecruit ? 'recruit' : 'index';

  let lastVisibleSection = null;
  let sessionInsightLevel = 0;
  const scrollMilestones = new Set();
  const viewedSections = new Set();

  // ================================================================
  // GA4 イベント送信
  // ================================================================
  function sendEvent(name, params) {
    if (typeof window.gtag === 'function') {
      window.gtag('event', name, { page_label: pageName, ...params });
    }
  }

  // ================================================================
  // インサイトカテゴリ更新（常に最高レベルを記録）
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
  // セクション表示監視（IntersectionObserver）
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

            // 初回閲覧時のみ「section_view」イベント
            if (!viewedSections.has(sectionKey)) {
              viewedSections.add(sectionKey);
              sendEvent('section_view', {
                section_name: sectionName,
                insight_level: INSIGHT_LABELS[insightLevel],
              });
              updateInsightLevel(insightLevel);
            }
          }
        });
      },
      { threshold: 0.3, rootMargin: '-5% 0px -5% 0px' }
    );

    // 各セクションに data 属性を付けて監視
    Object.keys(SECTIONS).forEach((selector) => {
      const el = document.querySelector(selector);
      if (el) {
        el.dataset.cochiSection = selector;
        observer.observe(el);
      }
    });
  }

  // ================================================================
  // 離脱セクション追跡（ページを離れた時にどこにいたか）
  // ================================================================
  function initExitTracking() {
    const scrollPct = () =>
      Math.round(
        (window.scrollY /
          Math.max(1, document.documentElement.scrollHeight - window.innerHeight)) *
          100
      );

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        sendEvent('section_exit', {
          last_section: lastVisibleSection || '（トップ付近）',
          scroll_percent: scrollPct(),
          insight_level_reached: INSIGHT_LABELS[sessionInsightLevel] || '（未計測）',
        });
      }
    });
  }

  // ================================================================
  // スクロール深度（25 / 50 / 75 / 90%）
  // ================================================================
  function initScrollTracking() {
    const onScroll = throttle(() => {
      const pct = Math.round(
        (window.scrollY /
          Math.max(1, document.documentElement.scrollHeight - window.innerHeight)) *
          100
      );
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
  // CTAクリック追跡（LINE予約・応募・見学）
  // ================================================================
  function initCTATracking() {
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a, button');
      if (!link) return;

      const href = (link.href || '').toLowerCase();
      const text = link.textContent.trim();

      if (href.includes('line.me') || href.includes('lin.ee') || text.includes('LINE')) {
        sendEvent('cta_click', {
          cta_type: 'line',
          cta_text: text.substring(0, 50),
          from_section: lastVisibleSection || '不明',
        });
        updateInsightLevel(3);
      } else if (text.includes('応募') || text.includes('見学') || href.includes('recruit')) {
        sendEvent('cta_click', {
          cta_type: 'recruit',
          cta_text: text.substring(0, 50),
          from_section: lastVisibleSection || '不明',
        });
        updateInsightLevel(3);
      } else if (href.includes('instagram')) {
        sendEvent('cta_click', {
          cta_type: 'instagram',
          from_section: lastVisibleSection || '不明',
        });
        updateInsightLevel(2);
      }
    });
  }

  // ================================================================
  // FAQ開閉追跡
  // ================================================================
  function initFAQTracking() {
    const faqSection = document.querySelector('#faq');
    if (!faqSection) return;
    faqSection.addEventListener('click', throttle(() => {
      sendEvent('faq_interaction', { from_section: 'よくある質問' });
      updateInsightLevel(2);
    }, 1000));
  }

  // ================================================================
  // ユーティリティ
  // ================================================================
  function throttle(fn, delay) {
    let last = 0;
    return function (...args) {
      const now = Date.now();
      if (now - last >= delay) {
        last = now;
        fn.apply(this, args);
      }
    };
  }

  // ================================================================
  // 初期化
  // ================================================================
  function init() {
    initSectionTracking();
    initScrollTracking();
    initExitTracking();
    initCTATracking();
    initFAQTracking();
    // ページ到達＝認知アクション
    updateInsightLevel(1);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

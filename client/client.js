window.__ModuleLoader__.load({
  id: 'dsh-mentor',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useLayoutEffect, useRef, useCallback } = React

    const API = '/dsh-mentor/api'
    const PANEL_ID = 'dsh-mentor'
    const TITLE = '大肥鱼'
    const CLIENT_VERSION = 29

    /** 本窗口不渲染表情包；宿主全局提示词里那套 [表情: …] 标记到这里会变成噪音，直接剥掉。 */
    const cleanText = (value) => String(value ?? '').replace(/\[表情[:：][^\]]*\]/g, '').replace(/\n{3,}/g, '\n\n').trim()

    const MODE_META = {
      chat: { label: '闲聊', color: '#9aa4b2', hint: '陪聊，不塞知识' },
      teach: { label: '讲解', color: '#6ea8fe', hint: '把概念讲透' },
      quiz: { label: '测验', color: '#f0a35e', hint: '出题查掌握' },
      plan: { label: '计划', color: '#8f7bf0', hint: '排学习路线' },
      code: { label: '代码', color: '#4fc08d', hint: '排错与实现' },
      operate: { label: '干活', color: '#e2678a', hint: '接管浏览器 / 桌面' },
    }

    /** 空会话的引子。故意不带模式标签——点一下只填输入框，模式由后端自己判。 */
    const SUGGESTIONS = [
      '你今天吃了多少碗白饭？',
      '随便扯两句，不聊正事',
      '帮我把这条视频发到抖音',
      '我刚碰到一个报错，你看下',
    ]

    /* ------------------------------------------------------------------ 样式 */

    /* ══════════════════════════════════════════════════════════════════════
       大肥鱼 · QQ 皮肤
       一层到底：所有颜色/圆角/阴影都走 token，别再往下叠 override。
       结构：标题栏 → 图标栏 56 → 会话列表 240 → 聊天头/消息/输入区
       ══════════════════════════════════════════════════════════════════════ */

    const CSS = `
.dm-shell,.dm-panel{
  --dm-bg:#f2f3f5;          /* 窗口底 */
  --dm-act:#ebedf0;         /* 左侧图标栏 */
  --dm-rail:#f5f6f8;        /* 会话列表 */
  --dm-surface:#ffffff;     /* 聊天区 */
  --dm-chatbg:#f4f6f8;       /* 消息区底色，让白气泡浮起来 */
  --dm-head:#f7f8fa;        /* 标题栏 / 抽屉底栏 */
  --dm-line:#e6e8ec;        /* 分隔线 */
  --dm-line-2:#dcdfe4;
  --dm-text:#16191d;
  --dm-muted:#8b929c;
  --dm-faint:#aab0b9;
  --dm-hover:#e9ebef;
  --dm-active:#e3f1ff;
  --dm-brand:#0099ff;
  --dm-brand-d:#0084df;
  --dm-brand-l:#e8f4ff;
  --dm-mint:#9ee7c8;
  --dm-sky:#7aa2ff;
  --dm-danger:#f54a45;
  --dm-ok:#2fbf71;
  --dm-warn:#e8890c;
  --dm-other:#ffffff;       /* 对方气泡 */
  --dm-code:#f6f7f9;
  --dm-shadow:0 8px 26px rgba(17,24,39,.10);
  color:var(--dm-text);
  font-family:"PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;
}
/* 深色（QQ NT 暗色）——只换 token，其余规则不动 */
@media (prefers-color-scheme: dark){
  .dm-shell,.dm-panel{
    --dm-bg:#111317; --dm-act:#171a1f; --dm-rail:#1a1d23; --dm-surface:#1f2228;
    --dm-head:#191c21; --dm-line:#2a2e36; --dm-line-2:#333842;
    --dm-chatbg:#1b1e24;
    --dm-text:#e7eaef; --dm-muted:#a0a9b8; --dm-faint:#6d747e;
    --dm-hover:#262b33; --dm-active:#16324a;
    --dm-brand:#12a8ff; --dm-brand-d:#0b93e0; --dm-brand-l:#12293b;
    --dm-other:#2a2e36; --dm-code:#15181d;
    --dm-shadow:0 8px 26px rgba(0,0,0,.45);
  }
}

/* ── 外框 ─────────────────────────────────────────────────────────────── */
.dm-page{height:100%;width:100%;box-sizing:border-box;padding:12px;display:flex;min-height:0}
.dm-panel{width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;position:relative;
  background:var(--dm-surface);border:1px solid var(--dm-line-2);border-radius:10px;
  box-shadow:var(--dm-shadow)}
.dm-backdrop{position:fixed;inset:0;z-index:2147000000;display:flex;align-items:center;justify-content:center;
  background:rgba(17,24,39,.42);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
.dm-backdrop .dm-panel{width:min(1140px,94vw);height:min(820px,90vh);box-shadow:0 30px 80px rgba(0,0,0,.38)}
.dm-win{user-select:none}
/* 只有「窗口壳」禁选；消息正文、设置内容、输入框必须能选中复制 */
.dm-win .dm-scroll,.dm-win .dm-dbody,.dm-win .dm-input,
.dm-win input,.dm-win textarea,.dm-win .dm-bubble{user-select:text;-webkit-user-select:text}
.dm-spacer{flex:1}
.dm-muted{color:var(--dm-muted);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ── 标题栏（QQ 的窗口头） ─────────────────────────────────────────────── */
.dm-titlebar{height:44px;flex-shrink:0;display:flex;align-items:center;gap:9px;padding:0 8px 0 10px;
  background:var(--dm-head);border-bottom:1px solid var(--dm-line);min-width:0}
.dm-brand{display:flex;align-items:center;gap:8px;min-width:0}
.dm-logo-wrap{display:flex;flex-shrink:0}
.dm-logo{width:26px;height:26px;border-radius:50%;flex-shrink:0;object-fit:cover;
  display:grid;place-items:center;font-size:12px;font-weight:700;color:#06301f;
  background:linear-gradient(140deg,#9ee7c8,#7aa2ff);box-shadow:0 0 0 1px rgba(0,0,0,.06)}
.dm-name{font-size:13.5px;font-weight:600;line-height:1.15;white-space:nowrap;letter-spacing:.01em}
.dm-sub{font-size:10.5px;color:var(--dm-muted);line-height:1.2;white-space:nowrap}
.dm-titlebar .dm-btn{height:26px;font-size:12px;padding:0 10px;border-radius:6px}
.dm-wdots{display:flex;gap:6px;padding:0 4px 0 6px}
.dm-wdots i{width:9px;height:9px;border-radius:50%;background:#c9cdd4;display:block}
.dm-wdots i:first-child{background:#f5b0ac}
.dm-wdots i:last-child{background:#b6e5c6}

/* ── 按钮 ─────────────────────────────────────────────────────────────── */
.dm-btn{height:27px;padding:0 11px;border-radius:6px;border:1px solid var(--dm-line-2);
  background:var(--dm-surface);color:var(--dm-text);font:inherit;font-size:12px;cursor:pointer;
  display:inline-flex;align-items:center;gap:5px;white-space:nowrap;transition:background .12s,border-color .12s}
.dm-btn:hover{background:var(--dm-hover);border-color:var(--dm-faint)}
.dm-btn:disabled{opacity:.45;cursor:not-allowed}
.dm-btn.dm-ghost{background:transparent;border-color:transparent;color:var(--dm-muted)}
.dm-btn.dm-ghost:hover{background:var(--dm-hover);color:var(--dm-text)}
.dm-btn.dm-primary{background:var(--dm-brand);border-color:transparent;color:#fff;font-weight:600}
.dm-btn.dm-primary:hover{background:var(--dm-brand-d)}
.dm-btn.dm-icon{width:27px;padding:0;justify-content:center}
.dm-auto{height:24px;padding:0 9px;border-radius:12px;border:1px solid var(--dm-line-2);
  background:transparent;color:var(--dm-muted);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
.dm-auto:hover{background:var(--dm-hover)}
.dm-auto.on{background:var(--dm-brand-l);border-color:var(--dm-brand);color:var(--dm-brand-d)}

/* ── 通用小件 ─────────────────────────────────────────────────────────── */
.dm-chip{display:inline-flex;align-items:center;gap:5px;height:21px;padding:0 8px;border-radius:11px;
  font-size:11px;background:var(--dm-hover);white-space:nowrap;flex-shrink:0}
.dm-dot{width:5px;height:5px;border-radius:50%;background:currentColor;flex-shrink:0}
.dm-sep{width:1px;height:10px;background:var(--dm-line-2);flex-shrink:0}
.dm-panicon{width:20px;height:20px;border-radius:6px;display:grid;place-items:center;font-size:11px;
  font-weight:700;color:#06301f;background:linear-gradient(140deg,#9ee7c8,#7aa2ff);flex-shrink:0}
.dm-ping{width:6px;height:6px;border-radius:50%;background:var(--dm-ok);flex-shrink:0}

/* ── 主体三栏 ─────────────────────────────────────────────────────────── */
.dm-body{flex:1;display:flex;min-height:0;background:var(--dm-surface)}

/* 1) 图标栏 */
.dm-activity{width:56px;flex-shrink:0;background:var(--dm-act);border-right:1px solid var(--dm-line);
  display:flex;flex-direction:column;align-items:center;gap:3px;padding:9px 0}
.dm-act{width:38px;height:38px;display:grid;place-items:center;border:none;background:transparent;
  color:var(--dm-muted);cursor:pointer;border-radius:9px;position:relative;transition:background .12s,color .12s}
.dm-act:hover{background:var(--dm-hover);color:var(--dm-text)}
.dm-act.dm-act-on{background:var(--dm-surface);color:var(--dm-brand);box-shadow:0 1px 3px rgba(17,24,39,.10)}
.dm-act-dot{position:absolute;right:9px;top:9px;width:6px;height:6px;border-radius:50%;
  background:var(--dm-ok);box-shadow:0 0 0 2px var(--dm-act)}
.dm-act-face{margin-top:auto;width:30px;height:30px;border-radius:50%;object-fit:cover;
  background:linear-gradient(140deg,#9ee7c8,#7aa2ff);display:grid;place-items:center;
  font-size:11px;font-weight:700;color:#06301f}

/* 2) 会话列表 */
.dm-rail{width:240px;flex-shrink:0;border-right:1px solid var(--dm-line);display:flex;
  flex-direction:column;min-height:0;background:var(--dm-rail)}
.dm-rail-head{display:flex;align-items:center;justify-content:space-between;
  padding:11px 12px 7px;font-size:11px;color:var(--dm-muted);letter-spacing:.04em}
.dm-rail-count{font-size:10.5px;color:var(--dm-faint);background:var(--dm-hover);
  padding:1px 6px;border-radius:8px}
.dm-rail-search-wrap{padding:0 10px 8px}
.dm-rail-search{width:100%;box-sizing:border-box;height:28px;padding:0 9px;font:inherit;font-size:12px;
  border-radius:7px;border:1px solid var(--dm-line-2);background:var(--dm-surface);color:var(--dm-text);outline:none}
.dm-rail-search::placeholder{color:var(--dm-faint)}
.dm-rail-search:focus{border-color:var(--dm-brand);box-shadow:0 0 0 2px rgba(0,153,255,.12)}
.dm-rail-list{flex:1;overflow-y:auto;padding:0 6px 8px}
.dm-rail-list::-webkit-scrollbar{width:6px}
.dm-rail-list::-webkit-scrollbar-thumb{background:rgba(17,24,39,.14);border-radius:3px}
.dm-rail-empty{padding:26px 10px;text-align:center;font-size:11.5px;color:var(--dm-faint)}
.dm-rail-item{position:relative;display:flex;gap:9px;align-items:center;
  padding:8px 9px;border-radius:8px;margin-bottom:1px;cursor:pointer;transition:background .1s}
.dm-rail-item:hover{background:var(--dm-hover)}
.dm-rail-item.dm-on{background:var(--dm-active)}
.dm-rail-ava{width:32px;height:32px;border-radius:50%;flex-shrink:0;display:grid;place-items:center;
  font-size:11px;font-weight:700;color:#fff;background:var(--dm-brand);
  box-shadow:0 0 0 1px rgba(0,0,0,.04)}
.dm-rail-main{flex:1;min-width:0}
.dm-rail-title-row{display:flex;align-items:center;gap:5px;min-width:0}
.dm-rail-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0}
.dm-rail-title{font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;flex:1;min-width:0}
.dm-rail-sub{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--dm-muted);margin-top:2px}
.dm-rail-sub span:last-child{color:var(--dm-faint)}
.dm-unread{min-width:17px;height:17px;padding:0 5px;border-radius:9px;background:var(--dm-danger);color:#fff;
  font-size:10px;font-weight:600;display:grid;place-items:center;flex-shrink:0;letter-spacing:0}
.dm-rail-time{font-size:10px;color:var(--dm-faint);flex-shrink:0}
.dm-rail-acts{position:absolute;right:6px;bottom:6px;display:none;gap:3px}
.dm-rail-item:hover .dm-rail-acts{display:flex}
.dm-mini{width:19px;height:19px;border-radius:5px;border:none;background:var(--dm-surface);
  color:var(--dm-muted);font:inherit;font-size:10.5px;cursor:pointer;display:grid;place-items:center;
  box-shadow:0 1px 2px rgba(17,24,39,.14)}
.dm-mini:hover{color:var(--dm-text);background:var(--dm-hover)}
.dm-mini.dm-danger:hover{background:var(--dm-danger);color:#fff}
.dm-rename{width:100%;font:inherit;font-size:12.5px;padding:2px 5px;border-radius:5px;color:var(--dm-text);
  border:1px solid var(--dm-brand);background:var(--dm-surface);outline:none}
.dm-rail-new{margin:0 10px 10px;height:30px;border-radius:7px;border:1px dashed var(--dm-line-2);
  background:transparent;color:var(--dm-muted);font:inherit;font-size:12px;cursor:pointer;flex-shrink:0}
.dm-rail-new:hover{border-color:var(--dm-brand);color:var(--dm-brand);background:var(--dm-brand-l)}

/* 3) 聊天区 */
.dm-main{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--dm-surface)}
.dm-chathead{height:54px;flex-shrink:0;display:flex;align-items:center;gap:9px;padding:0 14px;
  border-bottom:1px solid var(--dm-line);background:var(--dm-surface)}
.dm-chathead-main{min-width:0;display:flex;flex-direction:column;gap:1px}
.dm-chathead-title{font-size:14.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dm-chathead-sub{font-size:10.5px;color:var(--dm-muted);display:flex;align-items:center;gap:6px;
  white-space:nowrap;overflow:hidden}

.dm-scroll{flex:1;overflow-y:auto;padding:16px 18px 6px;display:flex;flex-direction:column;gap:13px;
  scrollbar-width:thin;background:var(--dm-chatbg)}
.dm-scroll::-webkit-scrollbar{width:7px}
.dm-scroll-content{display:flex;flex-direction:column;gap:13px;flex:1 0 auto;min-height:0;overflow-anchor:none}
.dm-scroll::-webkit-scrollbar-thumb{background:rgba(17,24,39,.12);border-radius:4px}
.dm-scroll::-webkit-scrollbar-thumb:hover{background:rgba(17,24,39,.2)}

.dm-timediv{align-self:center;font-size:10.5px;color:var(--dm-faint);padding:2px 0 4px}

/* 消息行 */
.dm-row{display:flex;flex-direction:row;gap:9px;align-items:flex-start;max-width:100%}
.dm-row.dm-user{flex-direction:row-reverse}
.dm-avatar{width:32px;height:32px;border-radius:50%;flex-shrink:0;object-fit:cover;
  background:linear-gradient(140deg,#9ee7c8,#7aa2ff);display:grid;place-items:center;
  font-size:11px;font-weight:700;color:#06301f;margin-top:2px}
.dm-col{display:flex;flex-direction:column;gap:3px;min-width:0;max-width:min(78%,76ch);align-items:flex-start}
.dm-user .dm-col{align-items:flex-end}
.dm-who{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--dm-faint);min-height:14px}
.dm-time{font-size:10px;color:var(--dm-faint)}
.dm-copy{border:none;background:transparent;color:var(--dm-faint);font:inherit;font-size:10px;
  cursor:pointer;opacity:0;padding:1px 5px;border-radius:4px;transition:opacity .12s}
.dm-row:hover .dm-copy{opacity:1}
.dm-copy:hover{background:var(--dm-hover);color:var(--dm-text)}

.dm-bubble{position:relative;font-size:13.5px;line-height:1.75;padding:9px 13px;border-radius:9px;
  background:var(--dm-other);border:1px solid transparent;word-break:break-word;
  box-shadow:0 1px 3px rgba(17,24,39,.07)}
/* 气泡尖角：CSS 三角，确定性比旋转方块强 */
.dm-mentor .dm-bubble::before{content:'';position:absolute;left:-5px;top:10px;width:0;height:0;
  border-top:5px solid transparent;border-bottom:5px solid transparent;border-right:6px solid var(--dm-other)}
.dm-user .dm-bubble{background:var(--dm-brand);border-color:transparent;color:#fff;
  box-shadow:0 1px 3px rgba(0,153,255,.32)}
.dm-user .dm-bubble::before{content:'';position:absolute;right:-5px;top:10px;width:0;height:0;
  border-top:5px solid transparent;border-bottom:5px solid transparent;border-left:6px solid var(--dm-brand)}
.dm-user .dm-bubble code{background:rgba(255,255,255,.2);color:#fff}
.dm-user .dm-bubble pre{background:rgba(0,0,0,.28);border-color:rgba(255,255,255,.2)}
.dm-user .dm-bubble pre code{color:#f2f6ff;background:none}
.dm-bubble p{margin:0 0 8px}
.dm-bubble p:last-child{margin-bottom:0}
.dm-bubble ul,.dm-bubble ol{margin:5px 0 8px;padding-left:19px}
.dm-bubble li{margin:2px 0}
.dm-bubble h3{font-size:13.5px;margin:8px 0 5px;font-weight:650}
.dm-bubble strong{font-weight:650}
.dm-bubble a{color:var(--dm-brand);text-decoration:none;border-bottom:1px solid rgba(0,153,255,.35)}
.dm-bubble code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;
  background:var(--dm-code);border:1px solid var(--dm-line);border-radius:4px;padding:1px 4px}
.dm-bubble pre{margin:8px 0;padding:0;border-radius:7px;overflow:hidden;background:var(--dm-code);
  border:1px solid var(--dm-line)}
.dm-bubble pre code{display:block;background:none;border:none;padding:9px 11px;overflow-x:auto;
  font-size:12px;line-height:1.6;border-radius:0}
.dm-code{margin:8px 0;border-radius:7px;overflow:hidden;border:1px solid var(--dm-line);background:var(--dm-code)}
.dm-code-bar{display:flex;align-items:center;gap:6px;padding:4px 8px;background:rgba(17,24,39,.04);
  border-bottom:1px solid var(--dm-line);font-size:10.5px;color:var(--dm-muted)}
.dm-code-lang{flex:1;letter-spacing:.03em}
.dm-code-copy{border:none;background:transparent;font:inherit;font-size:10.5px;color:var(--dm-muted);
  cursor:pointer;padding:1px 5px;border-radius:4px}
.dm-code-copy:hover{background:var(--dm-hover);color:var(--dm-text)}
.dm-code pre{margin:0;border:none;background:none}
.dm-caret{display:inline-block;width:6px;height:13px;background:var(--dm-brand);vertical-align:-2px;
  margin-left:2px;border-radius:1px;animation:dm-blink 1s steps(2) infinite}
@keyframes dm-blink{0%,50%{opacity:1}51%,100%{opacity:0}}
.dm-tool{font-size:10.5px;color:var(--dm-warn);display:flex;align-items:center;gap:5px}
.dm-err{border-color:rgba(245,74,69,.55)!important;background:rgba(245,74,69,.07)!important;color:var(--dm-danger)}
.dm-shots{display:flex;gap:7px;flex-wrap:wrap;margin-top:7px}
.dm-shot{max-width:240px;max-height:160px;border-radius:6px;border:1px solid var(--dm-line);
  cursor:zoom-in;object-fit:cover;background:rgba(0,0,0,.04)}

/* 窗口内看图（取代 window.open 跳浏览器） */
.dm-lightbox{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;
  background:rgba(0,0,0,.72);backdrop-filter:blur(2px);padding:24px}
.dm-lightbox-img{max-width:92vw;max-height:88vh;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.5);
  background:#fff;object-fit:contain}
.dm-lightbox-close{position:absolute;top:16px;right:18px;width:36px;height:36px;border:none;border-radius:50%;
  background:rgba(255,255,255,.16);color:#fff;font-size:22px;line-height:1;cursor:pointer}
.dm-lightbox-close:hover{background:rgba(255,255,255,.3)}

/* 空状态 */
.dm-empty{margin:auto;text-align:center;color:var(--dm-muted);font-size:12.5px;max-width:560px;width:100%}
.dm-hero{width:64px;height:64px;border-radius:50%;object-fit:cover;margin-bottom:12px;
  background:linear-gradient(140deg,#9ee7c8,#7aa2ff);display:inline-grid;place-items:center;
  font-size:22px;font-weight:700;color:#06301f;box-shadow:0 6px 20px rgba(122,162,255,.3)}
.dm-empty h2{font-size:15px;font-weight:650;color:var(--dm-text);margin:0 0 6px}
.dm-empty p{margin:0 0 16px;line-height:1.7;font-size:12px}
.dm-cards-label{font-size:10.5px;color:var(--dm-faint);letter-spacing:.05em;margin-bottom:7px}
.dm-cards{display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:left}
.dm-card{--dm-card-accent:var(--dm-brand);
  border:1px solid var(--dm-line);background:var(--dm-surface);border-radius:8px;padding:9px 11px;
  cursor:pointer;transition:border-color .12s,box-shadow .12s,transform .12s;border-left:3px solid var(--dm-card-accent)}
.dm-card:hover{border-color:var(--dm-card-accent);box-shadow:0 4px 14px rgba(17,24,39,.08);transform:translateY(-1px)}
.dm-card-text{font-size:12px;line-height:1.55;color:var(--dm-text)}
.dm-empty-hint{margin-top:14px;font-size:11px;color:var(--dm-faint)}

/* 输入区 */
.dm-composer{flex-shrink:0;padding:8px 14px 10px;border-top:1px solid var(--dm-line);
  background:var(--dm-surface)}
.dm-inputwrap{border:1px solid var(--dm-line-2);border-radius:9px;background:var(--dm-surface);
  transition:border-color .12s,box-shadow .12s;overflow:hidden}
.dm-inputwrap:focus-within{border-color:var(--dm-brand);box-shadow:0 0 0 2px rgba(0,153,255,.1)}
.dm-input{width:100%;box-sizing:border-box;display:block;min-height:42px;max-height:168px;resize:none;
  padding:9px 11px 2px;border:none;background:transparent;color:var(--dm-text);font:inherit;
  font-size:13.5px;line-height:1.6;outline:none}
.dm-input::placeholder{color:var(--dm-faint)}
.dm-toolbar{display:flex;align-items:center;gap:1px;padding:2px 6px 4px}
.dm-tool-btn{width:26px;height:24px;display:grid;place-items:center;border:none;background:transparent;
  color:var(--dm-muted);cursor:pointer;border-radius:5px}
.dm-tool-btn:hover{background:var(--dm-hover);color:var(--dm-brand)}
.dm-tool-hint{margin-left:6px;font-size:10.5px;color:var(--dm-faint)}
.dm-inputfoot{display:flex;align-items:center;gap:8px;padding:0 8px 7px 10px}
.dm-input-hint{font-size:10.5px;color:var(--dm-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dm-send{height:28px;padding:0 18px;border-radius:6px;border:none;cursor:pointer;font:inherit;
  font-size:12.5px;font-weight:600;color:#fff;background:var(--dm-brand);transition:background .12s}
.dm-send:hover{background:var(--dm-brand-d)}
.dm-send:disabled{background:var(--dm-line-2);color:var(--dm-faint);cursor:not-allowed}
.dm-send.dm-send-stop{background:var(--dm-danger)}
.dm-send.dm-send-stop:hover{background:#e03a35}

/* ── 抽屉（右侧设置面板） ─────────────────────────────────────────────── */
.dm-drawer-mask{position:absolute;inset:0;z-index:8;background:rgba(17,24,39,.18);
  animation:dm-fade .14s ease-out}
.dm-drawer{position:absolute;top:0;right:0;bottom:0;z-index:9;width:min(470px,92%);
  display:flex;flex-direction:column;background:var(--dm-surface);border-left:1px solid var(--dm-line-2);
  box-shadow:-18px 0 44px rgba(17,24,39,.16);animation:dm-slide .18s cubic-bezier(.22,.61,.36,1)}
@keyframes dm-slide{from{transform:translateX(18px);opacity:.4}to{transform:none;opacity:1}}
@keyframes dm-fade{from{opacity:0}to{opacity:1}}
.dm-drawer-head{height:46px;flex-shrink:0;display:flex;align-items:center;gap:8px;padding:0 10px 0 14px;
  border-bottom:1px solid var(--dm-line)}
.dm-drawer-title{font-size:13.5px;font-weight:600;flex:1;min-width:0;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.dm-drawer-x{width:26px;height:26px;border:none;background:transparent;color:var(--dm-muted);
  font-size:16px;line-height:1;cursor:pointer;border-radius:6px}
.dm-drawer-x:hover{background:var(--dm-hover);color:var(--dm-text)}
.dm-drawer-tabs{flex-shrink:0;display:flex;gap:2px;padding:0 10px;border-bottom:1px solid var(--dm-line);
  overflow-x:auto;scrollbar-width:none}
.dm-drawer-tabs::-webkit-scrollbar{display:none}
.dm-drawer-tab{height:33px;padding:0 10px;border:none;background:transparent;color:var(--dm-muted);
  font:inherit;font-size:12px;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
.dm-drawer-tab:hover{color:var(--dm-text)}
.dm-drawer-tab.on{color:var(--dm-brand-d);border-bottom-color:var(--dm-brand);font-weight:600}
.dm-dbody{flex:1;overflow-y:auto;padding:12px 14px 16px;min-height:0}
.dm-dbody::-webkit-scrollbar{width:6px}
.dm-dbody::-webkit-scrollbar-thumb{background:rgba(17,24,39,.14);border-radius:3px}
.dm-dfoot{flex-shrink:0;display:flex;align-items:center;gap:8px;padding:9px 14px;
  border-top:1px solid var(--dm-line);background:var(--dm-head)}
.dm-dfoot .dm-muted{white-space:normal;font-size:10.5px;line-height:1.5}

/* ── 六维人格编辑器 ───────────────────────────────────────────────────── */
.dm-presets{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px}
.dm-preset{padding:6px 10px;border-radius:7px;border:1px solid var(--dm-line-2);background:var(--dm-surface);
  color:var(--dm-text);font:inherit;font-size:12px;cursor:pointer;text-align:left}
.dm-preset:hover{border-color:var(--dm-brand);background:var(--dm-brand-l)}
.dm-preset.dm-preset-on{border-color:var(--dm-brand);background:var(--dm-brand-l);color:var(--dm-brand-d)}
.dm-preset-hint{display:block;font-size:10px;color:var(--dm-muted);margin-top:1px}
.dm-importexp{display:flex;gap:8px;margin-top:4px}
.dm-importbox{border:1px solid var(--dm-line-2);border-radius:8px;padding:10px;margin-top:8px;background:var(--dm-hover)}
.dm-importbox textarea{margin:6px 0}
.dm-import-row{display:flex;gap:8px;align-items:center}
.dm-sec{font-size:10.5px;color:var(--dm-faint);letter-spacing:.06em;margin:14px 0 7px}
.dm-sec:first-child{margin-top:2px}
/* 设置行：左标签 + 右控件（QQ 设置面板的做法，一屏能看更多字段） */
.dm-field{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--dm-line)}
.dm-field > label:not(.dm-check){width:84px;flex-shrink:0;padding-top:7px;font-size:11.5px;
  color:var(--dm-muted);line-height:1.35;margin:0;display:block}
.dm-field label b{font-weight:600;color:var(--dm-text);font-size:11.5px}
.dm-field-hint{display:block;font-size:10px;color:var(--dm-faint);margin:2px 0 0 0;line-height:1.4}
.dm-field > .dm-chips,.dm-field > .dm-range,.dm-field > .dm-check,
.dm-field > input,.dm-field > textarea,.dm-field > select{flex:1;min-width:0}
.dm-field > input,.dm-field > textarea,.dm-field > select{width:auto}
.dm-field > .dm-check{margin:4px 0 0}
.dm-input-sm{width:100%;box-sizing:border-box;font:inherit;font-size:12px;padding:6px 8px;border-radius:6px;
  border:1px solid var(--dm-line-2);background:var(--dm-surface);color:var(--dm-text);outline:none;
  line-height:1.55;font-family:inherit}
.dm-input-sm:focus{border-color:var(--dm-brand);box-shadow:0 0 0 2px rgba(0,153,255,.1)}
textarea.dm-input-sm{resize:vertical;min-height:52px}
.dm-sched-form{display:flex;flex-direction:column;gap:7px}
.dm-sched-row{display:flex;align-items:center;gap:8px;margin:5px 0}
.dm-sched-info{flex:1;min-width:0}
.dm-sched-info b{font-weight:600}
.dm-sched-meta{display:block;font-size:11px;color:var(--dm-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dm-btn-xs{height:22px;padding:0 9px;border-radius:5px;border:1px solid var(--dm-line-2);
  background:var(--dm-surface);color:var(--dm-muted);font:inherit;font-size:11px;cursor:pointer}
.dm-btn-xs:hover{color:var(--dm-text);border-color:var(--dm-line)}
.dm-chips{display:flex;flex-wrap:wrap;gap:4px}
.dm-chipbtn{height:23px;padding:0 9px;border-radius:11px;border:1px solid var(--dm-line-2);
  background:var(--dm-surface);color:var(--dm-muted);font:inherit;font-size:11px;cursor:pointer}
.dm-chipbtn:hover{border-color:var(--dm-brand);color:var(--dm-brand-d)}
.dm-chipbtn.on{background:var(--dm-brand-l);border-color:var(--dm-brand);color:var(--dm-brand-d);font-weight:600}
.dm-range{display:flex;align-items:center;gap:9px}
.dm-range input[type=range]{flex:1;accent-color:var(--dm-brand)}
.dm-range b{font-size:12px;min-width:30px;text-align:right;font-weight:600}
.dm-check{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--dm-text);margin:6px 0}
.dm-check input{accent-color:var(--dm-brand)}
.dm-save{width:100%;margin-top:4px}
.dm-preview{margin-top:10px;padding:9px 10px;border-radius:7px;background:var(--dm-code);
  border:1px solid var(--dm-line);font-size:10.5px;line-height:1.6;color:var(--dm-muted);
  white-space:pre-wrap;max-height:150px;overflow:auto;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}

/* ── 日记 ─────────────────────────────────────────────────────────────── */
.dm-day{margin-bottom:16px}
.dm-day-head{display:flex;align-items:center;gap:7px;margin-bottom:7px}
.dm-day-date{font-size:12.5px;font-weight:600}
.dm-day-n{font-size:10px;color:var(--dm-faint)}
.dm-day-line{flex:1;height:1px;background:var(--dm-line)}
.dm-note{--dm-note-accent:var(--dm-brand);position:relative;padding:9px 11px 9px 12px;border-radius:8px;background:var(--dm-surface);
  border:1px solid var(--dm-line);margin-bottom:7px;box-shadow:0 1px 2px rgba(17,24,39,.04)}
.dm-note::before{content:'';position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:0 2px 2px 0;
  background:var(--dm-note-accent,var(--dm-brand))}
.dm-note-head{display:flex;align-items:center;gap:6px;margin-bottom:3px}
.dm-note-time{font-size:10px;color:var(--dm-faint);font-variant-numeric:tabular-nums}
.dm-note-title{font-size:12.5px;font-weight:600;flex:1;min-width:0;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.dm-note-body{font-size:12px;line-height:1.65;color:var(--dm-text);white-space:pre-wrap;
  word-break:break-word}
.dm-note-meta{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:5px}
.dm-star{font-size:10px;color:var(--dm-warn);letter-spacing:-.5px}
.dm-tag{font-size:10px;color:var(--dm-muted);background:var(--dm-hover);padding:1px 6px;border-radius:8px}
.dm-note-mood{font-size:10px;color:var(--dm-brand-d)}
.dm-empty-block{padding:26px 12px;text-align:center;color:var(--dm-faint);font-size:11.5px;line-height:1.8}

/* ── 文件收发 ─────────────────────────────────────────────────────────── */
/* 横条贴在聊天区和输入区之间：她一交付文件，不用翻抽屉就能看见。 */
.dm-filestrip{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 18px 0;
  font-size:11.5px;color:var(--dm-muted)}
.dm-filestrip-label{flex-shrink:0}
.dm-filechip{display:inline-flex;align-items:center;gap:5px;max-width:220px;height:24px;padding:0 8px;
  border-radius:12px;border:1px solid var(--dm-line-2);background:var(--dm-surface);color:var(--dm-text);
  font:inherit;font-size:11.5px;cursor:pointer;text-decoration:none}
.dm-filechip:hover{border-color:var(--dm-brand);color:var(--dm-brand-d);background:var(--dm-brand-l)}
.dm-filechip-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dm-filechip-size{color:var(--dm-faint);font-size:10px;flex-shrink:0;font-variant-numeric:tabular-nums}
.dm-file-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--dm-line)}
.dm-file-row .dm-file-main{flex:1;min-width:0}
.dm-file-name{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dm-file-sub{font-size:10.5px;color:var(--dm-faint);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ── 记忆库 ───────────────────────────────────────────────────────────── */
.dm-mem-item{display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-bottom:1px solid var(--dm-line)}
.dm-mem-item:last-child{border-bottom:none}
.dm-mem-kind{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--dm-brand-l);
  color:var(--dm-brand-d);white-space:nowrap;flex-shrink:0;margin-top:2px}
.dm-mem-text{flex:1;font-size:12px;line-height:1.6;word-break:break-word;min-width:0}
.dm-mem-text .dm-muted{display:block;font-size:10px;margin-top:2px;white-space:normal}
.dm-mem-add{margin-top:10px;padding-top:10px;border-top:1px dashed var(--dm-line-2)}
.dm-stat{display:flex;justify-content:space-between;align-items:center;padding:5px 0;
  border-bottom:1px solid var(--dm-line);font-size:12px}
.dm-stat b{font-weight:600}
.dm-token-row{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:11.5px}
.dm-token-date{flex:0 0 38px;color:var(--dm-muted);font-variant-numeric:tabular-nums}
.dm-token-barwrap{flex:1;height:12px;background:var(--dm-hover);border-radius:6px;overflow:hidden}
.dm-token-bar{height:100%;min-width:3px;background:linear-gradient(90deg,var(--dm-brand),var(--dm-brand-d));border-radius:6px}
.dm-token-val{flex:0 0 44px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.dm-token-turns{flex:0 0 32px;color:var(--dm-muted);text-align:right}
.dm-trail{padding:5px 0;border-bottom:1px solid var(--dm-line);color:var(--dm-text);font-size:11.5px;
  line-height:1.5}
.dm-journal-day{margin-bottom:12px}
.dm-journal-day b{display:block;font-size:11.5px;margin-bottom:4px}
.dm-journal-line{font-size:11.5px;line-height:1.7;color:var(--dm-muted);padding-left:9px;
  border-left:2px solid var(--dm-line-2);margin-bottom:3px;white-space:normal}

/* ── QQ 桥 ────────────────────────────────────────────────────────────── */
.dm-qq-state{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--dm-text)}
/* 连不上时的「下一步怎么做」：给一行可直接照做的建议，别只报错。 */
.dm-qq-hint{font-size:10.5px;line-height:1.55;color:var(--dm-warn);background:rgba(232,137,12,.11);
  border-left:2px solid var(--dm-warn);border-radius:0 4px 4px 0;padding:5px 8px;margin:0 0 8px}
.dm-qq-meta{font-size:10.5px;color:var(--dm-faint)}
.dm-qq-dot{width:7px;height:7px;border-radius:50%;background:var(--dm-faint)}
.dm-qq-dot.on{background:var(--dm-ok);box-shadow:0 0 0 3px rgba(47,191,113,.16)}
.dm-qq-dot.err{background:var(--dm-danger);box-shadow:0 0 0 3px rgba(245,74,69,.14)}
.dm-qq-row{display:flex;gap:8px;align-items:center;margin-bottom:7px}
.dm-qq-row label{font-size:11px;color:var(--dm-muted);width:78px;flex-shrink:0}
/* 数字框别跟着 flex 撑满：频率只需要两位小数，撑满反而把说明挤到换行 */
.dm-qq-num{flex:0 0 76px;width:76px;text-align:center}
.dm-qq-row .dm-qq-meta{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dm-qq-log{margin-top:10px;border-top:1px solid var(--dm-line);padding-top:7px;max-height:200px;overflow:auto}
.dm-qq-line{font-size:11px;line-height:1.65;color:var(--dm-muted);white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis}
.dm-qq-line b{font-weight:600;color:var(--dm-brand-d)}

/* ── 右键菜单 / 拖放 ──────────────────────────────────────────────────── */
.dm-menu{position:fixed;z-index:2147000001;min-width:150px;padding:4px;border-radius:8px;
  background:var(--dm-surface);border:1px solid var(--dm-line-2);box-shadow:0 10px 34px rgba(17,24,39,.18);
  animation:dm-fade .1s ease-out}
.dm-menu-item{display:block;width:100%;text-align:left;padding:6px 10px;border:none;border-radius:5px;
  background:transparent;color:var(--dm-text);font:inherit;font-size:12px;cursor:pointer}
.dm-menu-item:hover{background:var(--dm-hover)}
.dm-menu-danger{color:var(--dm-danger)}
.dm-menu-danger:hover{background:rgba(245,74,69,.1)}
.dm-drop{position:absolute;inset:0;z-index:20;display:grid;place-items:center;border-radius:10px;
  background:rgba(0,153,255,.08);border:2px dashed var(--dm-brand);color:var(--dm-brand-d);
  font-size:13px;font-weight:600;pointer-events:none}

.dm-avatar-me{background:linear-gradient(140deg,#c9d2dd,#9aa4b2);color:#fff;font-size:11px}

/* ── 窄屏 ─────────────────────────────────────────────────────────────── */
@media (max-width: 900px){
  .dm-rail{width:190px}
  .dm-cards{grid-template-columns:1fr}
  .dm-activity{width:48px}
  .dm-name{font-size:13px}
}
@media (max-width: 680px){
  .dm-rail{display:none}
  .dm-col{max-width:88%}
  .dm-drawer{width:100%}
}

/* ── 首次初始化向导 ─────────────────────────────────────────────────── */
.dm-setup{position:absolute;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(160deg,rgba(22,28,45,.86),rgba(30,40,66,.92));backdrop-filter:blur(3px);padding:24px;overflow:auto}
.dm-setup-card{width:min(680px,96%);max-height:92%;overflow:auto;background:var(--dm-surface);color:var(--dm-text);
  border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.45);padding:28px 30px 26px;display:flex;flex-direction:column;gap:16px}
.dm-setup-logo{display:flex;align-items:center;gap:12px;margin-bottom:2px}
.dm-setup-logo .dm-logo{width:42px;height:42px;border-radius:12px}
.dm-setup-title{font-size:21px;font-weight:700}
.dm-setup-sub{font-size:12.5px;color:var(--dm-muted)}
.dm-setup-h{font-size:15px;font-weight:600;margin-top:4px}
.dm-setup-p{font-size:13px;line-height:1.7;color:var(--dm-text)}
.dm-setup-ul{margin:0;padding-left:18px;font-size:13px;line-height:1.8;color:var(--dm-text)}
.dm-setup-ul li{margin:2px 0}
.dm-setup-opts{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.dm-setup-opt{border:1.5px solid var(--dm-line);border-radius:13px;padding:16px 15px;cursor:pointer;background:var(--dm-rail);
  transition:border-color .15s,transform .1s,box-shadow .15s;display:flex;flex-direction:column;gap:8px}
.dm-setup-opt:hover{border-color:var(--dm-brand);transform:translateY(-2px);box-shadow:0 8px 22px rgba(0,0,0,.12)}
.dm-setup-opt.recommended{border-color:var(--dm-brand)}
.dm-setup-opt-tag{font-size:11px;font-weight:700;color:#fff;background:var(--dm-brand);border-radius:6px;padding:2px 8px;align-self:flex-start}
.dm-setup-opt-name{font-size:15px;font-weight:700}
.dm-setup-opt-desc{font-size:12.5px;line-height:1.65;color:var(--dm-muted)}
.dm-setup-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:4px}
.dm-setup-skip{font-size:12.5px;color:var(--dm-muted);background:transparent;border:none;cursor:pointer;text-decoration:underline}
.dm-setup-next{margin-top:6px;align-self:flex-start;font-size:14px;font-weight:600;padding:10px 22px;border-radius:10px;
  border:none;background:var(--dm-brand);color:#fff;cursor:pointer}
.dm-setup-next:hover{filter:brightness(1.05)}
.dm-setup-steps{display:flex;gap:8px;justify-content:center;margin-top:2px}
.dm-setup-dot{width:8px;height:8px;border-radius:50%;background:var(--dm-line)}
.dm-setup-dot.on{background:var(--dm-brand)}
.dm-setup-src{display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--dm-muted);
  background:var(--dm-rail);border:1px solid var(--dm-line);border-radius:9px;padding:6px 8px}
.dm-setup-src button{border:none;background:transparent;color:var(--dm-muted);cursor:pointer;padding:4px 10px;border-radius:7px;font-size:12.5px}
.dm-setup-src button.on{background:var(--dm-brand);color:#fff;font-weight:600}
.dm-setup-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}

/* 性格面板里「自由卡」卡片：大肥鱼从聊天/学习/网上冲浪自己长出来的性格 */
.dm-growth{background:linear-gradient(180deg,var(--dm-rail),rgba(255,255,255,.02));
  border:1.5px solid var(--dm-line);border-radius:13px;padding:14px 15px;margin:8px 0 2px}
.dm-growth-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
.dm-growth-title{font-size:13px;font-weight:700;color:var(--dm-text)}
.dm-growth-badge{font-size:10.5px;color:var(--dm-muted);background:var(--dm-line);border-radius:6px;padding:2px 8px;white-space:nowrap}
.dm-growth-empty{font-size:12.5px;line-height:1.65;color:var(--dm-muted)}
.dm-growth-row{margin:7px 0}
.dm-growth-k{font-size:10.5px;letter-spacing:.06em;color:var(--dm-faint);margin-bottom:2px}
.dm-growth-v{font-size:13px;line-height:1.7;color:var(--dm-text);white-space:normal;word-break:break-word}
.dm-growth-foot{display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap}
.dm-growth-grow{font-size:12.5px;border:none;background:var(--dm-brand);color:#fff;cursor:pointer;
  padding:6px 14px;border-radius:8px;font-weight:600}
.dm-growth-grow:disabled{opacity:.55;cursor:default}
.dm-growth-note{font-size:11.5px;color:var(--dm-muted)}
.dm-growth-log{margin-top:8px;font-size:11px;color:var(--dm-faint);line-height:1.6}
.dm-growth-log i{font-style:normal;display:block}

@media (max-width:680px){
  .dm-setup-opts{grid-template-columns:1fr}
}
`


    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.getElementById('dm-style')) return
      const el = document.createElement('style')
      el.id = 'dm-style'
      el.textContent = CSS
      document.head.appendChild(el)
    }

    /* ------------------------------------------------------------------ 网络 */

    /** 让宿主知道前端到底跑起来没有：远程调试时这一条比截图有用。 */
    function beat(payload) {
      try {
        fetch(`${API}/hello`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ v: CLIENT_VERSION, at: Date.now(), ...payload }),
        }).catch(() => {})
      } catch {
        // 宿主没起来就算了，不影响界面。
      }
    }

    /** 只上报跟本插件有关的异常，别把整个应用的报错都收进来。 */
    function hookErrors() {
      if (typeof window === 'undefined' || window.__dmErrorHooked) return
      window.__dmErrorHooked = true
      const related = (text) => /dsh-mentor|Mentor|dm-/.test(String(text || ''))
      window.addEventListener('error', (event) => {
        const message = String(event?.message || '')
        const file = String(event?.filename || '')
        if (!related(message) && !related(file)) return
        beat({ event: 'client-error', message, file, line: event?.lineno })
      })
      window.addEventListener('unhandledrejection', (event) => {
        const message = String(event?.reason?.stack || event?.reason?.message || event?.reason || '')
        if (!related(message)) return
        beat({ event: 'client-error', message: message.slice(0, 800) })
      })
    }

    async function apiJson(path, init) {
      const res = await fetch(path, init)
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`)
      return body
    }

    async function streamTurn(sessionId, text, onEvent, signal) {
      const res = await fetch(`${API}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, text }),
        signal,
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let cut
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, cut)
          buffer = buffer.slice(cut + 2)
          let event = 'message'
          let data = ''
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) data += line.slice(5).trim()
          }
          if (!data) continue
          try {
            onEvent(event, JSON.parse(data))
          } catch {
            // 半个帧丢掉，等后续。
          }
        }
      }
    }

    /* ------------------------------------------------------------- Markdown */

    function inline(text) {
      const nodes = []
      const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g
      let last = 0
      let match
      let key = 0
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index))
        const token = match[0]
        if (token.startsWith('**')) nodes.push(h('strong', { key: `b${key++}` }, token.slice(2, -2)))
        else nodes.push(h('code', { key: `c${key++}` }, token.slice(1, -1)))
        last = match.index + token.length
      }
      if (last < text.length) nodes.push(text.slice(last))
      return nodes
    }

    /** 时间戳：只给时:分，够用又不抢戏。 */
    function fmtTime(at) {
      if (!at) return ''
      const date = new Date(at)
      if (Number.isNaN(date.getTime())) return ''
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    }

    /** token 数压成紧凑写法：1234 → 1.2k，不足千原样。 */
    function fmtTokens(n) {
      const v = Number(n) || 0
      if (v >= 1000) return `${(v / 1000).toFixed(1)}k`
      return String(v)
    }

    /** 白饭：大肥鱼把 token 叫白饭，1 碗 ≈ 1000 token。把 token 数压成「几碗」。 */
    function fmtBowls(n) {
      const v = Number(n) || 0
      if (v <= 0) return '0'
      return `${(v / 1000).toFixed(1)} 碗`
    }

    function CodeBlock(props) {
      const [copied, setCopied] = useState(false)
      const copy = () => {
        const text = String(props.text || '')
        const done = () => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }
        try {
          navigator.clipboard.writeText(text).then(done, done)
        } catch {
          done()
        }
      }
      return h(
        'div',
        { className: 'dm-code' },
        h(
          'div',
          { className: 'dm-code-bar' },
          h('span', { className: 'dm-code-lang' }, props.lang || 'code'),
          h('button', { className: 'dm-code-copy', onClick: copy }, copied ? '已复制' : '复制'),
        ),
        h('pre', null, h('code', null, props.text)),
      )
    }

    function renderMarkdown(source) {
      const lines = String(source || '').split('\n')
      const blocks = []
      let list = null
      let fence = null
      let fenceLang = ''
      let key = 0

      const flushList = () => {
        if (!list) return
        blocks.push(
          h(list.ordered ? 'ol' : 'ul', { key: `l${key++}` }, list.items.map((item, i) => h('li', { key: i }, inline(item)))),
        )
        list = null
      }

      for (const raw of lines) {
        if (fence !== null) {
          if (raw.trim().startsWith('```')) {
            blocks.push(h(CodeBlock, { key: `p${key++}`, lang: fenceLang, text: fence.join('\n') }))
            fence = null
            fenceLang = ''
          } else {
            fence.push(raw)
          }
          continue
        }
        if (raw.trim().startsWith('```')) {
          flushList()
          fence = []
          fenceLang = raw.trim().slice(3).trim()
          continue
        }
        if (!raw.trim()) {
          flushList()
          continue
        }
        const heading = /^(#{1,4})\s+(.*)$/.exec(raw)
        if (heading) {
          flushList()
          blocks.push(h('h3', { key: `h${key++}` }, inline(heading[2])))
          continue
        }
        const bullet = /^\s*[-*•]\s+(.*)$/.exec(raw)
        const numbered = /^\s*(\d+)[.、)]\s+(.*)$/.exec(raw)
        if (bullet || numbered) {
          const ordered = Boolean(numbered)
          if (!list || list.ordered !== ordered) {
            flushList()
            list = { ordered, items: [] }
          }
          list.items.push(bullet ? bullet[1] : numbered[2])
          continue
        }
        flushList()
        blocks.push(h('p', { key: `p${key++}` }, inline(raw)))
      }
      if (fence !== null) blocks.push(h(CodeBlock, { key: `p${key++}`, lang: fenceLang, text: fence.join('\n') }))
      flushList()
      if (!blocks.length) return h('p', null, '')
      return blocks
    }

    /* ------------------------------------------------------------ 本地已读 */

    const SEEN_KEY = 'dsh-mentor.seen'
    function readSeen() {
      try {
        return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}
      } catch {
        return {}
      }
    }
    function writeSeen(map) {
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(map))
      } catch {
        // 隐私模式下写不进去，红点会一直在，不影响用。
      }
    }

    /* --------------------------------------------------------------- 状态 */

    function useMentor() {
      const [sessions, setSessions] = useState([])
      const [activeId, setActiveId] = useState('')
      const [messages, setMessages] = useState([])
      const [draft, setDraft] = useState('')
      const [busy, setBusy] = useState(false)
      const [health, setHealth] = useState(null)
      const [profile, setProfile] = useState(null)
      const [persona, setPersonaState] = useState(null)
      // null = 还不知道（没请求回来），不要用 done:false 冒充「新人」——那会导致每次打开先闪一下向导。
      const [setup, setSetupState] = useState(() => null)
      const [presets, setPresets] = useState([])
      const [mood, setMoodState] = useState(null)
      const [seen, setSeen] = useState(() => readSeen())
      const [memory, setMemoryEntries] = useState([])
      const [memoryStats, setMemoryStats] = useState(null)
      const [journal, setJournal] = useState([])
      const [diary, setDiary] = useState([])
      const [diaryStats, setDiaryStats] = useState(null)
      const [autopilot, setAutopilotState] = useState(false)
      const [reflecting, setReflecting] = useState(false)
      const [qq, setQQ] = useState(null)
      // 收件箱（你给她的）和发件箱（她交给你的）：列表只在打开会话/上传后刷新。
      const [files, setFiles] = useState({ inbox: [], outbox: [] })
      // 大肥鱼自己的每日 token 消耗（只算本插件，不碰主对话）。
      const [tokenStats, setTokenStats] = useState(null)

      const markSeen = useCallback((id, count) => {
        setSeen((prev) => {
          if (prev[id] === count) return prev
          const next = { ...prev, [id]: count }
          writeSeen(next)
          return next
        })
      }, [])
      const [notice, setNotice] = useState('')
      const [activity, setActivity] = useState(null)
      const [scrollRequest, setScrollRequest] = useState(0)
      const sessionRequestRef = useRef(0)
      const abortRef = useRef(null)
      const activeRef = useRef('')
      const busyRef = useRef(false)
      const shownCountRef = useRef(0)
      activeRef.current = activeId
      busyRef.current = busy
      shownCountRef.current = messages.length

      const loadSessions = useCallback(async () => {
        try {
          const body = await apiJson(`${API}/sessions`)
          setSessions(body.sessions || [])
          return body.sessions || []
        } catch (error) {
          setNotice(`连不上宿主：${error.message}`)
          return []
        }
      }, [])

      const openSession = useCallback(async (id, { followLatest = true } = {}) => {
        if (!id) return
        const request = ++sessionRequestRef.current
        activeRef.current = id
        setActiveId(id)
        try {
          const body = await apiJson(`${API}/sessions/${encodeURIComponent(id)}`)
          if (request !== sessionRequestRef.current || activeRef.current !== id) return
          setMessages((body.session?.messages || []).map((row) => ({ ...row, streaming: false })))
          if (followLatest) setScrollRequest((n) => n + 1)
          markSeen(id, (body.session?.messages || []).length)
        } catch (error) {
          setNotice(`打开会话失败：${error.message}`)
        }
      }, [markSeen])

      /**
       * QQ 那边来的消息由桥直接写进 store（`external: qq:<会话号>` 那个会话），
       * 但这个面板以前只在挂载时拉一次列表，所以两边看着像「不同步」。
       * 这里只补读方向：拉一次轻量的会话列表，活跃会话条数变了就重载正文。
       * 不做反向发送——在面板里说话不等于授权她替用户往 QQ 上发消息。
       */
      const refreshSessions = useCallback(async () => {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
        if (busyRef.current) return // 正在流式回话，别把半截气泡冲掉
        const rows = await loadSessions()
        const id = activeRef.current
        if (!id || !rows.length) return
        const mine = rows.find((row) => row.id === id)
        if (!mine || mine.count === shownCountRef.current) return
        await openSession(id, { followLatest: false })
      }, [loadSessions, openSession])

      const removeMessage = useCallback(async (messageId) => {
        if (!messageId) return
        const sessionId = activeRef.current
        try {
          await apiJson(`${API}/delete-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, messageId }),
          })
          setMessages((rows) => rows.filter((row) => row.id !== messageId))
        } catch (error) {
          setNotice(`删除失败：${error.message}`)
        }
      }, [])

      const createSession = useCallback(async () => {
        try {
          const body = await apiJson(`${API}/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          })
          const session = body.session
          setSessions((rows) => [{ id: session.id, title: session.title, mode: 'chat', count: session.messages.length }, ...rows])
          setActiveId(session.id)
          setMessages(session.messages || [])
          return session.id
        } catch (error) {
          setNotice(`新建失败：${error.message}`)
          return ''
        }
      }, [])

      const removeSession = useCallback(
        async (id) => {
          try {
            await apiJson(`${API}/sessions?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
            const rows = await loadSessions()
            if (id === activeRef.current) {
              const next = rows[0]?.id || ''
              if (next) await openSession(next)
              else {
                setActiveId('')
                setMessages([])
              }
            }
          } catch (error) {
            setNotice(`删除失败：${error.message}`)
          }
        },
        [loadSessions, openSession],
      )

      const renameSession = useCallback(
        async (id, title) => {
          try {
            await apiJson(`${API}/rename`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: id, title }),
            })
            await loadSessions()
          } catch (error) {
            setNotice(`改名失败：${error.message}`)
          }
        },
        [loadSessions],
      )

      const loadPersona = useCallback(async () => {
        try {
          const body = await apiJson(`${API}/persona`)
          setPersonaState(body.persona)
          setPresets(body.presets || [])
        } catch {
          // 性格拿不到不影响聊天，界面会自动隐藏这块。
        }
      }, [])

      const loadSetup = useCallback(async () => {
        try {
          const body = await apiJson(`${API}/setup`)
          setSetupState(body.setup || { done: false, mode: 'unset' })
        } catch {
          // 拉不到不代表没初始化过：保持「未知」，几秒后重试，别把老用户当新人推向导。
          setTimeout(() => { loadSetup() }, 4000)
        }
      }, [])

      /** 完成首次初始化：定初始性格（只这一次），之后锁定，走「自由卡」。 */
      const saveSetup = useCallback(async (mode) => {
        try {
          const body = await apiJson(`${API}/setup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode }),
          })
          setSetupState(body.setup || { done: true, mode })
          return body.setup
        } catch (error) {
          // 失败也先本地标记，别卡住界面；下次进会再读真值。
          setSetupState({ done: true, mode })
          return { done: true, mode }
        }
      }, [])

      const savePersona = useCallback(async (payload) => {
        try {
          const body = await apiJson(`${API}/persona`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          setPersonaState(body.persona)
          return body.persona
        } catch (error) {
          setNotice(`性格保存失败：${error.message}`)
          return null
        }
      }, [])

      const loadMemory = useCallback(async (q = '') => {
        try {
          const body = await apiJson(`${API}/memory${q ? `?q=${encodeURIComponent(q)}` : ''}`)
          setMemoryEntries(body.entries || [])
          setMemoryStats(body.stats || null)
        } catch {
          // 记忆读不到就空着，不挡聊天。
        }
      }, [])

      const remember = useCallback(
        async (text, kind = 'fact') => {
          try {
            const body = await apiJson(`${API}/memory`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text, kind }),
            })
            if (body.ok) await loadMemory()
          } catch (error) {
            setNotice(`记忆保存失败：${error.message}`)
          }
        },
        [loadMemory],
      )

      const forget = useCallback(
        async (id) => {
          try {
            await apiJson(`${API}/memory?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
            await loadMemory()
          } catch (error) {
            setNotice(`删除记忆失败：${error.message}`)
          }
        },
        [loadMemory],
      )

      // 把同一件事记了好几遍的条目合并成一条（保留最新的那条，其余标为已被取代）。
      const dedupeMemories = useCallback(async () => {
        try {
          const body = await apiJson(`${API}/memory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'dedupe' }),
          })
          setNotice(body.ok ? `合并了 ${body.merged || 0} 条重复记忆` : '合并失败')
          await loadMemory()
        } catch (error) {
          setNotice(`合并记忆失败：${error.message}`)
        }
      }, [loadMemory])

      const loadJournal = useCallback(async (days = 3) => {
        try {
          const body = await apiJson(`${API}/journal?days=${days}`)
          setJournal(body.days || [])
        } catch {
          setJournal([])
        }
      }, [])

      const loadDiary = useCallback(async (days = 30) => {
        try {
          const body = await apiJson(`${API}/diary?days=${days}`)
          setDiary(body.days || [])
          setDiaryStats(body.stats || null)
        } catch {
          setDiary([])
        }
      }, [])

      const loadFiles = useCallback(async () => {
        try {
          const body = await apiJson(`${API}/files`)
          setFiles({ inbox: body.inbox || [], outbox: body.outbox || [] })
        } catch {
          // 列表拉不到不影响聊天，静默降级
        }
      }, [])

      // 上传：读成 base64 再 POST。桌面端拖进来的 File 有 path，但那只能本机用；
      // 收一份副本进 inbox，原文件改名/移动/删掉都不影响她读。
      const uploadFile = useCallback(
        async (file) => {
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => {
              const text = String(reader.result || '')
              const comma = text.indexOf(',')
              resolve(comma >= 0 ? text.slice(comma + 1) : '')
            }
            reader.onerror = () => reject(reader.error || new Error('读不出这个文件'))
            reader.readAsDataURL(file)
          })
          if (!base64) throw new Error('空文件')
          const body = await apiJson(`${API}/files`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: file.name, data: base64 }),
          })
          await loadFiles()
          return body.file
        },
        [loadFiles],
      )

      /**
       * 把箱子里的一份文件推到 QQ：手机上就能收到。
       * 失败时后端会给具体原因（没连上 / 没有会话 / 文件不在了），直接转述。
       */
      const pushToQQ = useCallback(async (name, box) => {
        try {
          const body = await apiJson(`${API}/files/to-qq`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, box }),
          })
          if (!body.ok) {
            setNotice(`没发到 QQ：${body.error || '未知原因'}`)
            return false
          }
          setNotice(`已发到 QQ：${name}`)
          return true
        } catch (error) {
          setNotice(`没发到 QQ：${error.message}`)
          return false
        }
      }, [])

      // 让她现在写一篇：走后台一次性 agent，不进聊天记录。写不写由她判断，所以可能回「没什么值得写的」。
      const reflectDiary = useCallback(async () => {
        setReflecting(true)
        try {
          const body = await apiJson(`${API}/diary/reflect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          setNotice(body?.ok ? body.text || '写好了' : `没写成：${body?.error || '未知原因'}`)
          await loadDiary(30)
        } catch (error) {
          setNotice(`没写成：${error.message}`)
        } finally {
          setReflecting(false)
        }
      }, [loadDiary])

      const consolidate = useCallback(async () => {
        try {
          const body = await apiJson(`${API}/memory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'consolidate' }),
          })
          await loadMemory()
          await loadDiary(30)
          setNotice(body.reflection ? `整合出一条：${body.reflection.text}` : '暂时没什么可整合的')
        } catch (error) {
          setNotice(`反思失败：${error.message}`)
        }
      }, [loadMemory, loadDiary])

      const fadeMemory = useCallback(async () => {
        try {
          const body = await apiJson(`${API}/memory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'fade' }),
          })
          await loadMemory()
          setNotice(`按遗忘曲线淡化了 ${body.faded ?? 0} 条`)
        } catch (error) {
          setNotice(`淡化失败：${error.message}`)
        }
      }, [loadMemory])

      const toggleAutopilot = useCallback(async () => {
        const next = !autopilot
        setAutopilotState(next)
        try {
          const body = await apiJson(`${API}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ autopilot: next }),
          })
          setAutopilotState(Boolean(body.settings?.autopilot))
        } catch (error) {
          setAutopilotState(!next)
          setNotice(`切换全自动失败：${error.message}`)
        }
      }, [autopilot])

      const loadQQ = useCallback(async () => {
        try {
          const body = await apiJson(`${API}/qq`)
          setQQ({
            status: body.status || {},
            recent: body.recent || [],
            config: body.config || {},
            instances: body.instances || null,
            stickers: body.stickers || null,
            shout: body.shout || null,
            shoutStatus: body.shoutStatus || null,
            perception: body.perception || null,
            social: body.social || null,
          })
        } catch {
          // 宿主没起来就不显示 QQ 面板内容。
        }
      }, [])

      const loadTokens = useCallback(async () => {
        try {
          const body = await apiJson(`${API}/tokens`)
          setTokenStats(body.stats || null)
        } catch {
          // 用量拿不到就不显示，不影响聊天。
        }
      }, [])

      const saveQQ = useCallback(async (config) => {
        try {
          const body = await apiJson(`${API}/qq`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config }),
          })
          setQQ((prev) => ({ ...(prev || {}), status: body.status || {}, config: body.config || {} }))
        } catch (error) {
          setNotice(`QQ 设置保存失败：${error.message}`)
        }
      }, [])

      const saveShout = useCallback(async (shout) => {
        try {
          const body = await apiJson(`${API}/qq/shout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'config', shout }),
          })
          setQQ((prev) => ({ ...(prev || {}), shout: body.shout || shout, shoutStatus: { ...(prev?.shoutStatus || {}), enabled: body.shout?.enabled } }))
          await loadQQ()
        } catch (error) {
          setNotice(`说说设置保存失败：${error.message}`)
        }
      }, [loadQQ])

      const shoutNow = useCallback(async () => {
        try {
          const body = await apiJson(`${API}/qq/shout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'now' }) })
          if (body.ok) setNotice(body.skipped ? body.text : body.draft ? `空间草稿已写好：${body.text}` : `已发一条说说：${body.text}`)
          else setNotice(`没发出去：${body.error || '未知原因'}`)
          await loadQQ()
        } catch (error) {
          setNotice(`发说说失败：${error.message}`)
        }
      }, [loadQQ])

      const testQQ = useCallback(async () => {
        try {
          const body = await apiJson(`${API}/qq/test`, { method: 'POST' })
          setQQ((prev) => ({ status: body.status || {}, recent: body.recent || prev?.recent || [], config: prev?.config || {} }))
        } catch (error) {
          setNotice(`QQ 连接测试失败：${error.message}`)
        }
      }, [])

      const launchQQ = useCallback(async () => {
        try {
          const body = await apiJson(`${API}/qq/launch`, { method: 'POST' })
          setNotice(`网关启动中${body.uin ? `（${body.uin}）` : ''}，8 秒后自动重连`)
          setTimeout(() => loadQQ(), 9000)
        } catch (error) {
          setNotice(`启动网关失败：${error.message}`)
        }
      }, [loadQQ])

      useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const body = await apiJson(`${API}/health`)
            if (alive) {
              setHealth(body)
              setAutopilotState(Boolean(body.autopilot))
            }
          } catch (error) {
            if (alive) setNotice(`宿主未就绪：${error.message}`)
          }
          await loadPersona()
          await loadDiary(30)
          await loadMemory('')
          await loadTokens()
          try {
            const state = await apiJson(`${API}/mood`)
            if (alive) setMoodState(state.mood)
          } catch {
            // 情绪拿不到就少显示一个角标，不影响对话。
          }
          const rows = await loadSessions()
          if (alive && rows.length) await openSession(rows[0].id)
          if (alive) await loadSetup()
        })()
        return () => {
          alive = false
          if (abortRef.current) abortRef.current.abort()
        }
      }, [loadSessions, openSession, loadPersona, loadSetup])

      // 5 秒探一次会话列表：QQ 侧的往来靠这个出现在面板里。只拉列表，条数没变就不碰正文。
      useEffect(() => {
        const timer = setInterval(() => {
          refreshSessions().catch(() => {})
        }, 5000)
        return () => clearInterval(timer)
      }, [refreshSessions])

      const refreshProfile = useCallback(async () => {
        try {
          const body = await apiJson(`${API}/profile`)
          setProfile(body.profile)
        } catch {
          setProfile({ total: 0, byMode: {}, recent: [], streak: 0 })
        }
      }, [])

      const patchLast = useCallback((patch) => {
        setMessages((rows) => {
          if (!rows.length) return rows
          const next = rows.slice()
          next[next.length - 1] = { ...next[next.length - 1], ...patch }
          return next
        })
      }, [])

      const send = useCallback(
        async (overrideText) => {
          const text = String(overrideText ?? draft).trim()
          if (!text || busyRef.current) return
          let sessionId = activeRef.current
          if (!sessionId) {
            sessionId = await createSession()
            if (!sessionId) return
            activeRef.current = sessionId
          }
          setDraft('')
          setBusy(true)
          setNotice('')
          setActivity({ tool: '', since: Date.now() })
          setMessages((rows) => [
            ...rows,
            { role: 'user', text, at: Date.now() },
            { role: 'mentor', text: '', at: Date.now(), streaming: true, mode: null, tool: '' },
          ])
          const controller = new AbortController()
          abortRef.current = controller
          let acc = ''
          try {
            await streamTurn(
              sessionId,
              text,
              (event, payload) => {
                if (event === 'route') {
                  patchLast({ mode: payload.mode })
                  if (payload.mood) setMoodState(payload.mood)
                } else if (event === 'delta') {
                  acc += payload.text
                  patchLast({ text: acc })
                } else if (event === 'tool') {
                  setActivity({ tool: payload.name, since: Date.now() })
                  patchLast({ tool: payload.name })
                } else if (event === 'done') {
                  if (payload.text) acc = payload.text
                  patchLast({ text: acc, streaming: false, tool: '' })
                  if (payload.mood) setMoodState(payload.mood)
                } else if (event === 'error') {
                  patchLast({ text: `${acc ? `${acc}\n\n` : ''}⚠️ ${payload.message}`, streaming: false, tool: '', error: true })
                }
              },
              controller.signal,
            )
          } catch (error) {
            if (error?.name !== 'AbortError') {
              patchLast({ text: `${acc ? `${acc}\n\n` : ''}⚠️ ${error.message}`, streaming: false, tool: '', error: true })
            } else {
              patchLast({ streaming: false, tool: '' })
            }
          } finally {
            abortRef.current = null
            setBusy(false)
            setActivity(null)
            const rows = await loadSessions()
            const mine = rows.find((row) => row.id === sessionId)
            if (mine) markSeen(sessionId, mine.count)
            refreshProfile()
          }
        },
        [draft, createSession, patchLast, loadSessions, refreshProfile, markSeen],
      )

      const stop = useCallback(async () => {
        try {
          abortRef.current?.abort()
          await apiJson(`${API}/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: activeRef.current }),
          })
        } catch {
          // 停不下来只能等它自己结束。
        }
      }, [])

      return {
        sessions, activeId, messages, draft, busy, health, profile, persona, presets, mood, seen,
        memory, memoryStats, journal, diary, diaryStats, notice, activity, setup,
        scrollRequest, busyRef, activeRef,
        setDraft, setProfile, setNotice,
        loadSessions, openSession, createSession, removeSession, renameSession, refreshProfile, send, stop,
        loadPersona, savePersona, loadSetup, saveSetup, removeMessage, markSeen, loadMemory, remember, forget, dedupeMemories, loadJournal,
        loadDiary, reflectDiary, reflecting, consolidate, fadeMemory,
        files, loadFiles, uploadFile, pushToQQ,
        autopilot, toggleAutopilot,
        qq, loadQQ, saveQQ, testQQ, launchQQ, saveShout, shoutNow,
        tokenStats, loadTokens,
      }
    }

    /* --------------------------------------------------------------- 组件 */

    /* --------------------------------------------------------------- 头像 */

    const AVATAR_SRC = `${API}/assets/whale-girl.webp`

    /** 鲸鱼娘头像；图挂了就退回一个「鱼」字，不至于开天窗。 */
    function Avatar(props) {
      const [failed, setFailed] = useState(false)
      if (failed) return h('span', { className: props.className, style: props.style, title: props.title }, '鱼')
      return h('img', {
        className: props.className,
        style: props.style,
        src: AVATAR_SRC,
        alt: '鲸鱼娘',
        title: props.title,
        draggable: false,
        onError: () => setFailed(true),
      })
    }

    function ModeChip(props) {
      const meta = MODE_META[props.mode] || MODE_META.chat
      return h(
        'span',
        { className: 'dm-chip', style: { color: meta.color }, title: props.title || meta.hint },
        h('span', { className: 'dm-dot' }),
        meta.label,
        props.confidence !== undefined && props.confidence !== null && props.confidence < 1
          ? h('span', { className: 'dm-muted', style: { fontSize: '10.5px' } }, `${Math.round(props.confidence * 100)}%`)
          : null,
      )
    }

    function CopyButton(props) {
      const [done, setDone] = useState(false)
      const copy = () => {
        const text = String(props.text || '')
        const ok = () => {
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        }
        try {
          navigator.clipboard.writeText(text).then(ok, ok)
        } catch {
          ok()
        }
      }
      return h('button', { className: 'dm-copy', onClick: copy }, done ? '已复制' : '复制')
    }

    function Bubble(props) {
      const row = props.row
      const isUser = row.role === 'user'
      const accent = (MODE_META[row.mode] || MODE_META.chat).color
      const shown = cleanText(row.text)
      // 干活时工具会留下截图，正文里出现文件名就顺手渲染出来，不用用户自己拼地址。
      const shots = isUser ? [] : Array.from(new Set(shown.match(/shot-\d+\.png/g) || [])).slice(0, 3)
      return h(
        'div',
        {
          className: `dm-row ${isUser ? 'dm-user' : 'dm-mentor'}`,
          onContextMenu: (event) => {
            if (!props.onMenu) return
            event.preventDefault()
            props.onMenu(event, row)
          },
        },
        isUser ? null : h(Avatar, { className: 'dm-avatar', title: TITLE }),
        h(
          'div',
          { className: 'dm-col' },
          h(
            'div',
            { className: 'dm-who' },
            isUser ? '你' : TITLE,
            !isUser && row.mode ? h(ModeChip, { mode: row.mode }) : null,
            row.at ? h('span', { className: 'dm-time' }, fmtTime(row.at)) : null,
            !isUser && !row.streaming ? h(CopyButton, { text: shown }) : null,
          ),
          h(
            'div',
            {
              className: `dm-bubble${row.error ? ' dm-err' : ''}`,
              style: isUser ? undefined : { '--dm-accent': accent },
            },
            renderMarkdown(shown),
            row.streaming ? h('span', { className: 'dm-caret' }) : null,
            shots.length
              ? h(
                  'div',
                  { className: 'dm-shots' },
                  shots.map((name) =>
                    h('img', {
                      key: name,
                      className: 'dm-shot',
                      src: `${API}/shot?name=${encodeURIComponent(name)}`,
                      alt: name,
                      title: '点开看大图（在窗口内，不跳浏览器）',
                      onClick: () => props.onShot && props.onShot(`${API}/shot?name=${encodeURIComponent(name)}`),
                    }),
                  ),
                )
              : null,
          ),
          row.tool ? h('div', { className: 'dm-tool' }, '⚙ 正在用工具：', row.tool) : null,
        ),
      )
    }

    /** 窗口内看图：取代原来 window.open 跳浏览器新标签页的做法。 */
    function Lightbox(props) {
      const { url, onClose } = props
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])
      return h(
        'div',
        {
          className: 'dm-lightbox',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
        },
        h('img', { className: 'dm-lightbox-img', src: url, alt: '截图大图', draggable: false }),
        h('button', { className: 'dm-lightbox-close', onClick: onClose, title: '关闭 (Esc)' }, '×'),
      )
    }

    const splitList = (value) =>
      String(value || '')
        .split(/[,，、\n]/)
        .map((row) => row.trim())
        .filter(Boolean)

    const toDraft = (card) => ({
      ...card,
      traits: Array.isArray(card?.traits) ? card.traits.join('、') : String(card?.traits || ''),
      catchphrases: Array.isArray(card?.catchphrases) ? card.catchphrases.join('、') : String(card?.catchphrases || ''),
      taboos: Array.isArray(card?.taboos) ? card.taboos.join('、') : String(card?.taboos || ''),
    })

    /* ------------------------------------------------------- 右侧抽屉（QQ 设置面板） */

    function Drawer(props) {
      const { title, tabs, tab, onTab, onClose, foot, children } = props
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])
      return h(
        React.Fragment,
        null,
        h('div', { className: 'dm-drawer-mask', onMouseDown: onClose }),
        h(
          'div',
          { className: 'dm-drawer', onMouseDown: (event) => event.stopPropagation() },
          h(
            'div',
            { className: 'dm-drawer-head' },
            h('div', { className: 'dm-drawer-title' }, typeof title === 'function' ? title() : title),
            h('button', { className: 'dm-drawer-x', onClick: onClose, title: '关闭（Esc）' }, '×'),
          ),
          tabs && tabs.length
            ? h(
                'div',
                { className: 'dm-drawer-tabs' },
                tabs.map((row) =>
                  h(
                    'button',
                    {
                      key: row.id,
                      className: `dm-drawer-tab${tab === row.id ? ' on' : ''}`,
                      onClick: () => onTab(row.id),
                    },
                    row.label,
                  ),
                ),
              )
            : null,
          h('div', { className: 'dm-dbody' }, children),
          foot || null,
        ),
      )
    }

    /* ------------------------------------------------------------ 六维人格 schema */

    /** 41 个字段的元信息：label 给人看，type 决定控件，options 只给枚举用。 */
    const PERSONA_SCHEMA = {
      identity: {
        label: '身份',
        icon: 'user',
        fields: [
          { key: 'name', label: '名字', type: 'text', ph: '大肥鱼' },
          { key: 'selfCall', label: '自称', type: 'text', ph: '我' },
          { key: 'title', label: '身份 / 头衔', type: 'text', ph: '私人助理' },
          { key: 'addressUser', label: '怎么称呼你', type: 'text', ph: '你' },
          { key: 'oneLiner', label: '一句话定位', type: 'area', ph: '例：干活时话不多，但会把事办完' },
        ],
      },
      voice: {
        label: '语气',
        icon: 'voice',
        fields: [
          { key: 'tone', label: '语气', type: 'chips', options: ['自然', '温柔', '干练', '俏皮', '冷静', '犀利'] },
          { key: 'length', label: '篇幅', type: 'chips', options: ['简短', '适中', '详细'] },
          { key: 'warmth', label: '温度', type: 'chips', options: ['冷', '中', '暖'] },
          { key: 'formality', label: '正式度', type: 'chips', options: ['偏口语', '中性', '偏书面'] },
          { key: 'directness', label: '直接度', type: 'chips', options: ['婉转', '直接', '很直接'] },
          { key: 'humor', label: '幽默', type: 'chips', options: ['无', '偶尔', '经常'] },
          { key: 'emoji', label: '表情符号', type: 'chips', options: ['不用', '少', '适量', '多'] },
          { key: 'metaphor', label: '比喻', type: 'chips', options: ['少', '适量', '多'] },
          { key: 'punctuation', label: '标点', type: 'chips', options: ['克制', '正常', '爱用感叹号'] },
          { key: 'language', label: '语言', type: 'chips', options: ['中文', '中英混', '英文'] },
          { key: 'signature', label: '口头签名', type: 'text', ph: '可留空' },
          { key: 'catchphrases', label: '口头禅', type: 'list', ph: '顿号分隔，如：别急、先看现状' },
          { key: 'banned', label: '不说的词', type: 'list', ph: '顿号分隔' },
        ],
      },
      working: {
        label: '干活',
        icon: 'gear',
        fields: [
          { key: 'planBeforeAct', label: '动手前', type: 'chips', options: ['先看现状再动手', '先给方案再动手', '边做边说'] },
          { key: 'answerStructure', label: '回答结构', type: 'chips', options: ['先结论后细节', '先背景后结论', '按步骤列'] },
          { key: 'exploreVsImplement', label: '探索 ↔ 实现', type: 'chips', options: ['偏探索', '平衡', '偏实现'] },
          { key: 'verification', label: '验证', type: 'chips', options: ['关键步骤给验证方法', '给命令自己跑', '口头说明即可'] },
          { key: 'comments', label: '注释', type: 'chips', options: ['只在必要处注释', '多注释', '几乎不注释'] },
          { key: 'delivery', label: '交付', type: 'chips', options: ['可复制的成品', '思路 + 片段', '最小示例'] },
          { key: 'proactiveness', label: '主动性', type: 'chips', options: ['少', '适中', '积极'] },
          { key: 'riskAppetite', label: '风险偏好', type: 'chips', options: ['保守', '平衡', '激进'] },
          { key: 'customHabits', label: '额外习惯', type: 'list' },
        ],
      },
      feedback: {
        label: '反馈',
        icon: 'chat',
        fields: [
          { key: 'uncertainty', label: '不确定时', type: 'chips', options: ['直说并给验证办法', '先猜再标注', '反问澄清'] },
          { key: 'criticism', label: '指出问题', type: 'chips', options: ['直接说，只评事', '委婉提示', '先肯定再指出'] },
          { key: 'granularity', label: '细节颗粒度', type: 'chips', options: ['按需给细节', '给到能照做', '只给要点'] },
          { key: 'praiseFrequency', label: '肯定', type: 'chips', options: ['少而具体', '不刻意', '经常鼓励'] },
          { key: 'followUp', label: '收尾', type: 'chips', options: ['给一个具体下一步', '问要不要继续', '不追加'] },
          { key: 'progressReporting', label: '过程汇报', type: 'chips', options: ['关键节点报一句', '每步都报', '做完再说'] },
          { key: 'onOwnMistake', label: '自己犯错时', type: 'chips', options: ['承认并修正', '先给影响面', '简短带过'] },
          { key: 'customRules', label: '额外规则', type: 'list' },
        ],
      },
      boundaries: {
        label: '边界',
        icon: 'shield',
        fields: [
          { key: 'always', label: '必须做到', type: 'list', ph: '顿号分隔，每条一句' },
          { key: 'never', label: '绝不做', type: 'list', ph: '顿号分隔，每条一句' },
          { key: 'extra', label: '其它约定', type: 'list' },
        ],
      },
      runtime: {
        label: '运行',
        icon: 'sliders',
        fields: [
          { key: 'temperature', label: 'temperature', type: 'range', min: 0, max: 2, step: 0.1, hint: '越低越稳，越高越发散' },
          {
            key: 'focusLevel',
            label: '风格约束强度',
            type: 'chips',
            options: [
              ['strict', '严格'],
              ['balanced', '平衡'],
              ['loose', '宽松'],
            ],
          },
          { key: 'reinforceOpening', label: '开场也强调人格', type: 'bool' },
        ],
      },
    }
    const DIM_IDS = Object.keys(PERSONA_SCHEMA)

    const chipValue = (option) => (Array.isArray(option) ? option[0] : option)
    const chipLabel = (option) => (Array.isArray(option) ? option[1] : option)

    function DimField(props) {
      const { field, value, onChange } = props
      const set = (next) => onChange(field.key, next)
      const body = (() => {
        if (field.type === 'chips') {
          return h(
            'div',
            { className: 'dm-chips' },
            (field.options || []).map((option) => {
              const id = chipValue(option)
              return h(
                'button',
                {
                  key: id,
                  type: 'button',
                  className: `dm-chipbtn${String(value) === String(id) ? ' on' : ''}`,
                  onClick: () => set(id),
                },
                chipLabel(option),
              )
            }),
          )
        }
        if (field.type === 'range') {
          const num = Number(value) || 0
          return h(
            'div',
            { className: 'dm-range' },
            h('input', {
              type: 'range',
              min: field.min,
              max: field.max,
              step: field.step,
              value: num,
              onChange: (event) => set(Number(event.target.value)),
            }),
            h('b', null, num.toFixed(1)),
          )
        }
        if (field.type === 'bool') {
          return h(
            'label',
            { className: 'dm-check' },
            h('input', { type: 'checkbox', checked: Boolean(value), onChange: (event) => set(event.target.checked) }),
            '开启',
          )
        }
        if (field.type === 'area') {
          return h('textarea', {
            className: 'dm-input-sm',
            rows: 2,
            placeholder: field.ph || '',
            value: value ?? '',
            onChange: (event) => set(event.target.value),
          })
        }
        const isList = field.type === 'list'
        return h('input', {
          className: 'dm-input-sm',
          placeholder: field.ph || (isList ? '顿号分隔' : ''),
          value: isList && Array.isArray(value) ? value.join('、') : (value ?? ''),
          onChange: (event) => set(isList ? splitList(event.target.value) : event.target.value),
        })
      })()
      return h(
        'div',
        { className: 'dm-field' },
        h('label', null, h('b', null, field.label), field.hint ? h('span', { className: 'dm-field-hint' }, field.hint) : null),
        body,
      )
    }

    function PersonaDrawer(props) {
      const { persona, presets, onSave, onClose, startTab, setup, onSetup } = props
      const [tab, setTab] = useState(startTab || 'preset')
      const [draft, setDraft] = useState(() => toDraft(persona || {}))
      const [dims, setDims] = useState(() => JSON.parse(JSON.stringify(persona?.dims || {})))
      const [saving, setSaving] = useState(false)
      const [saved, setSaved] = useState('')

      useEffect(() => {
        setDraft(toDraft(persona || {}))
        setDims(JSON.parse(JSON.stringify(persona?.dims || {})))
      }, [persona])

      const field = (key) => (event) => setDraft((row) => ({ ...row, [key]: event.target.value }))
      const setDim = (dim, key, value) =>
        setDims((prev) => ({ ...prev, [dim]: { ...(prev[dim] || {}), [key]: value } }))

      // 导入/导出人设：整份 JSON 流转，store 会过 sanitizePersona 收敛成合法卡。
      const [importOpen, setImportOpen] = useState(false)
      const [importText, setImportText] = useState('')
      const [importError, setImportError] = useState('')
      const importFileRef = useRef(null)
      const onPickFile = (event) => {
        const file = event.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
          setImportText(String(reader.result || ''))
          setImportError('')
        }
        reader.readAsText(file)
        event.target.value = ''
      }
      const doImport = async () => {
        let parsed
        try {
          parsed = JSON.parse(importText)
        } catch {
          setImportError('不是合法 JSON，检查一下括号和引号')
          return
        }
        if (!parsed || typeof parsed !== 'object') {
          setImportError('要一个 JSON 对象（整份人设或只给几个字段都行）')
          return
        }
        const next = await onSave({ import: parsed })
        if (next) {
          setImportError('')
          setImportOpen(false)
          setImportText('')
          setSaved('人设已导入，下一条消息生效')
        } else {
          setImportError('导入失败，服务端没认')
        }
      }
      const exportPersona = () => {
        // 直接让浏览器下载，不绕前端、不耗 token。
        const a = document.createElement('a')
        a.href = `${API}/persona/export`
        a.download = `mentor-persona-${new Date().toISOString().slice(0, 10)}.json`
        document.body.appendChild(a)
        a.click()
        a.remove()
      }

      const commit = async () => {
        setSaving(true)
        setSaved('')
        // 一次把扁平卡和六维都交上去：patch 分支会合并，dims 整份覆盖推导值，互不打架。
        const next = await onSave({
          patch: {
            name: draft.name,
            selfCall: draft.selfCall,
            traits: splitList(draft.traits),
            style: draft.style,
            catchphrases: splitList(draft.catchphrases),
            taboos: splitList(draft.taboos),
            relationship: draft.relationship,
            mood: draft.mood,
            dims,
          },
        })
        setSaving(false)
        if (next) {
          setSaved('已保存，下一条消息生效')
          setTimeout(() => setSaved(''), 2600)
        }
      }

      const usePreset = async (id) => {
        setSaving(true)
        const next = await onSave({ preset: id })
        setSaving(false)
        if (next) setSaved('预设已套用（六维跟着重置）')
      }

      const tabs = [{ id: 'preset', label: '预设' }].concat(
        DIM_IDS.map((id) => ({ id, label: PERSONA_SCHEMA[id].label })),
      )

      const body = (() => {
        if (tab === 'preset') {
          return h(
            React.Fragment,
            null,
            h('div', { className: 'dm-sec' }, '性格预设'),
            h(
              'div',
              { className: 'dm-presets' },
              (presets || []).map((preset) =>
                h(
                  'button',
                  {
                    key: preset.id,
                    className: `dm-preset${persona?.preset === preset.id ? ' dm-preset-on' : ''}`,
                    onClick: () => usePreset(preset.id),
                    disabled: saving,
                  },
                  preset.label,
                  h('span', { className: 'dm-preset-hint' }, preset.hint),
                ),
              ),
            ),
            h('div', { className: 'dm-sec' }, '基础卡（决定「像谁」，六维决定「具体怎么说」）'),
            h('div', { className: 'dm-field' }, h('label', null, '名字'), h('input', { className: 'dm-input-sm', value: draft.name || '', onChange: field('name') })),
            h('div', { className: 'dm-field' }, h('label', null, '自称'), h('input', { className: 'dm-input-sm', value: draft.selfCall || '', onChange: field('selfCall') })),
            h('div', { className: 'dm-field' }, h('label', null, '和你的关系'), h('input', { className: 'dm-input-sm', value: draft.relationship || '', onChange: field('relationship') })),
            h('div', { className: 'dm-field' }, h('label', null, '性格标签'), h('input', { className: 'dm-input-sm', value: draft.traits || '', onChange: field('traits'), placeholder: '顿号分隔' })),
            h('div', { className: 'dm-field' }, h('label', null, '说话方式'), h('textarea', { className: 'dm-input-sm', rows: 3, value: draft.style || '', onChange: field('style') })),
            h('div', { className: 'dm-field' }, h('label', null, '口头禅'), h('input', { className: 'dm-input-sm', value: draft.catchphrases || '', onChange: field('catchphrases'), placeholder: '顿号分隔' })),
            h('div', { className: 'dm-field' }, h('label', null, '不要做'), h('input', { className: 'dm-input-sm', value: draft.taboos || '', onChange: field('taboos'), placeholder: '顿号分隔' })),
            h('div', { className: 'dm-field' }, h('label', null, '此刻状态'), h('input', { className: 'dm-input-sm', value: draft.mood || '', onChange: field('mood') })),
            h('div', { className: 'dm-muted', style: { whiteSpace: 'normal', lineHeight: 1.7, marginTop: '6px' } },
              '性格只改说话方式；「发布前停手、登录不代填」这些红线在提示词里固定，不跟着变。'),
            h('div', { className: 'dm-sec' }, '人设文件'),
            h('div', { className: 'dm-importexp' },
              h('button', { className: 'dm-btn', onClick: () => { setImportOpen((v) => !v); setImportError('') } }, importOpen ? '收起导入' : '导入人设'),
              h('button', { className: 'dm-btn dm-ghost', onClick: exportPersona }, '导出人设'),
            ),
            importOpen
              ? h('div', { className: 'dm-importbox' },
                  h('div', { className: 'dm-muted' }, '把之前导出的人设 JSON 粘进来，或选一个 .json 文件。整份给、只给几个字段（增量合并）都行。'),
                  h('textarea', { className: 'dm-input-sm', rows: 6, value: importText, onChange: (event) => setImportText(event.target.value), placeholder: '{ "name": "大肥鱼", "preset": "rice", "dims": { ... } }' }),
                  h('div', { className: 'dm-import-row' },
                    h('input', { type: 'file', accept: '.json,application/json', ref: importFileRef, style: { display: 'none' }, onChange: onPickFile }),
                    h('button', { className: 'dm-btn dm-ghost', onClick: () => importFileRef.current?.click() }, '选文件'),
                    h('button', { className: 'dm-btn dm-primary', onClick: doImport, disabled: !importText.trim() }, '确认导入'),
                  ),
                  importError ? h('div', { className: 'dm-qq-hint' }, importError) : null,
                )
              : null,
          )
        }
        const schema = PERSONA_SCHEMA[tab]
        const bag = dims[tab] || {}
        const count = schema.fields.length
        return h(
          React.Fragment,
          null,
          h('div', { className: 'dm-sec' }, `${schema.label} · ${count} 个字段`),
          schema.fields.map((row) => h(DimField, { key: row.key, field: row, value: bag[row.key], onChange: (key, value) => setDim(tab, key, value) })),
          h('div', { className: 'dm-muted', style: { whiteSpace: 'normal', lineHeight: 1.7, marginTop: '4px' } },
            '这些字段会拼进每次对话的系统提示词；留空就沿用默认推导值。'),
        )
      })()

      // 人格只在首次初始化时能设；之后锁定，真正说话的样子完全由「自由卡」长出来。
      const locked = Boolean(setup && setup.done)
      // 锁定后展示的只读「初始设定」块：只显示你最初给的底子，不能再改。
      const seedBlock = locked
        ? h(
            React.Fragment,
            null,
            h('div', { className: 'dm-sec' }, '初始设定（仅首次设置时可改）'),
            h(
              'div',
              { className: 'dm-growth' },
              h('div', { className: 'dm-growth-row' }, h('div', { className: 'dm-growth-k' }, '名字'), h('div', { className: 'dm-growth-v' }, draft.name || '大肥鱼')),
              draft.relationship ? h('div', { className: 'dm-growth-row' }, h('div', { className: 'dm-growth-k' }, '关系'), h('div', { className: 'dm-growth-v' }, draft.relationship)) : null,
              draft.traits ? h('div', { className: 'dm-growth-row' }, h('div', { className: 'dm-growth-k' }, '初始性格标签'), h('div', { className: 'dm-growth-v' }, draft.traits)) : null,
              h('div', { className: 'dm-growth-note' }, '这是你最初给的底子，之后不再改动；真正说话的样子由下面的「自由卡」长出来。'),
            ),
          )
        : null

      // 「自由卡」：大肥鱼从聊天 / 学习 / 网上冲浪里自己长出来的性格，和初始设定并排显示。
      const [growth, setGrowth] = useState(null)
      const [growing, setGrowing] = useState(false)
      const loadGrowth = useCallback(async () => {
        try {
          const b = await apiJson(`${API}/persona/grow`)
          setGrowth(b)
        } catch {
          // 拿不到不影响编辑卡。
        }
      }, [])
      useEffect(() => { loadGrowth() }, [loadGrowth])
      const growNow = async () => {
        setGrowing(true)
        try {
          const b = await apiJson(`${API}/persona/grow`, { method: 'POST' })
          setGrowth(b.status || b)
        } catch {
          // 生长失败（比如没 agent）时保持原样。
        } finally {
          setGrowing(false)
        }
      }
      const gSelf = growth?.self || {}
      const gGrown = Boolean(growth?.grown)
      const growthCard = h(
        React.Fragment,
        null,
        h('div', { className: 'dm-sec' }, '自由卡（它自己从聊天、学习、网上冲浪里长出来的）'),
        h(
          'div',
          { className: 'dm-growth' },
          h(
            'div',
            { className: 'dm-growth-head' },
            h('div', { className: 'dm-growth-title' }, gGrown ? '它是这样的' : '还没长出来'),
            h('div', { className: 'dm-growth-badge' }, growth?.updatedAt ? `更新于 ${new Date(growth.updatedAt).toLocaleDateString()}` : '种子态'),
          ),
          gGrown
            ? h(
              React.Fragment,
              null,
              gSelf.identity ? h('div', { className: 'dm-growth-row' }, h('div', { className: 'dm-growth-k' }, '眼里的自己'), h('div', { className: 'dm-growth-v' }, gSelf.identity)) : null,
              gSelf.voice ? h('div', { className: 'dm-growth-row' }, h('div', { className: 'dm-growth-k' }, '说话 / 干活的真实样子'), h('div', { className: 'dm-growth-v' }, gSelf.voice)) : null,
              gSelf.understandingOfUser ? h('div', { className: 'dm-growth-row' }, h('div', { className: 'dm-growth-k' }, '对你的了解'), h('div', { className: 'dm-growth-v' }, gSelf.understandingOfUser)) : null,
            )
            : h('div', { className: 'dm-growth-empty' }, '它还在最初的样子。多用一阵（或点下面按钮），会从你们的聊天、一起学习、网上冲浪里自己长出更真实的性格。'),
          h(
            'div',
            { className: 'dm-growth-foot' },
            h('button', { className: 'dm-growth-grow', onClick: growNow, disabled: growing }, growing ? '生长中…' : (gGrown ? '重新生长一次' : '现在就长一次')),
            h('div', { className: 'dm-growth-note' }, '这段是它自己长出来的「自由卡」，会压过上面的初始设定'),
          ),
          (growth?.growthLog && growth.growthLog.length)
            ? h('div', { className: 'dm-growth-log' }, growth.growthLog.slice(0, 4).map((e) => h('i', { key: e.at }, `· ${new Date(e.at).toLocaleDateString()} ${e.note || ''}`)))
            : null,
        ),
      )

      return h(
        Drawer,
        {
          title: () => `性格 · ${draft.name || '大肥鱼'}`,
          tabs: locked ? [] : tabs,
          tab,
          onTab: setTab,
          onClose,
          foot: locked
            ? null
            : h(
                'div',
                { className: 'dm-dfoot' },
                h('button', { className: 'dm-btn dm-primary', onClick: commit, disabled: saving, style: { padding: '0 18px' } },
                  saving ? '保存中…' : '保存'),
                h('div', { className: 'dm-muted' }, saved || '保存后下一条消息生效'),
              ),
        },
        seedBlock,
        growthCard,
        locked ? null : body,
      )
    }

    /* ------------------------------------------------------------------ QQ 桥 */

    function ComponentsPanel({ onClose }) {
      const [data, setData] = useState(null)
      const [selected, setSelected] = useState(null)
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState('')
      useEffect(() => {
        let active = true, loading = false
        const load = async () => {
          if (loading) return
          loading = true
          try {
            const result = await apiJson(`${API}/components`)
            if (active) { setData(result); setSelected((old) => old || result.selected || result.components.filter((c) => c.recommended).map((c) => c.id)) }
          } catch (error) { if (active) setNotice(error.message) }
          finally { loading = false }
        }
        void load(); const timer = setInterval(() => { if (!document.hidden) void load() }, 3000)
        return () => { active = false; clearInterval(timer) }
      }, [])
      const prepare = async () => {
        setBusy(true); setNotice('')
        try {
          const result = await apiJson(`${API}/components`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selected }) })
          if (!result.ok) throw new Error(result.error || '工具准备未能开始')
          setData((old) => ({ ...old, job: result.job }))
        } catch (error) { setNotice(error.message) }
        finally { setBusy(false) }
      }
      const running = data?.job?.running
      // 关掉即记住：下次打开不再自动弹「工具准备」。
      const dismissThenClose = () => {
        void apiJson(`${API}/components`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dismissed: true }) }).catch(() => {})
        onClose()
      }
      return h(Drawer, { title: '工具准备', onClose: dismissThenClose },
        h('p', { className: 'dm-muted', style: { whiteSpace: 'normal', lineHeight: 1.7 } }, '勾选你想用的功能，再统一准备。没有勾选的模型不会下载。所有聊天图片和语音都在自己的电脑处理。'),
        !data ? h('p', { role: 'status' }, '正在检查本机工具…') : data.components.map((c) => h('div', { key: c.id, style: { padding: '12px 0', borderBottom: '1px solid var(--dm-line)' } },
          h('label', { className: 'dm-check' }, h('input', { type: 'checkbox', checked: (selected || []).includes(c.id), disabled: busy || running, onChange: (e) => setSelected((old) => e.target.checked ? [...old, c.id] : old.filter((id) => id !== c.id)) }), `${c.name}${c.ready ? ' · 已就绪' : ''}`),
          h('div', { style: { lineHeight: 1.7 } }, c.tool),
          h('div', { className: 'dm-muted', style: { whiteSpace: 'normal', lineHeight: 1.7 } }, c.size, '；', c.detail),
          h('a', { href: c.source, target: '_blank', rel: 'noreferrer', style: { color: 'var(--dm-brand)' } }, '工具官网'))),
        h('button', { className: 'dm-btn dm-primary', disabled: busy || running || !selected?.length, style: { marginTop: '14px' }, onClick: prepare }, running ? '正在准备所选工具…' : '一键准备所选工具'),
        data?.job ? h('div', { role: 'status', 'aria-live': 'polite', style: { marginTop: '12px', lineHeight: 1.7 } },
          running ? `正在准备：${data.components.find((c) => c.id === data.job.current)?.name || '组件'}。首次下载可能需要几分钟，请保持 DSH 打开。` : data.job.errors?.length ? '部分工具未完成，可以重新尝试；已完成的工具可继续使用。' : '所选工具已准备完成。请到 QQ 面板扫码、到平台登录中登录你要用的网站。',
          data.job.errors?.map((e) => h('p', { key: e.id, className: 'dm-qq-hint', style: { whiteSpace: 'normal' } }, `${data.components.find((c) => c.id === e.id)?.name || e.id}：${e.error}`))) : null,
        notice ? h('p', { role: 'alert', className: 'dm-qq-hint' }, notice) : null,
        h('div', { className: 'dm-sec', style: { marginTop: '20px' } }, '生图、视频和网页剪辑'),
        h('p', { className: 'dm-muted', style: { whiteSpace: 'normal', lineHeight: 1.7 } }, '下面的网站无需全部开通。选择自己喜欢的平台，在「平台登录」完成登录，再让大肥鱼使用；账号额度和费用以各网站显示为准。'),
        (data?.websites || []).map((site) => h('div', { key: site.id, style: { padding: '10px 0', borderBottom: '1px solid var(--dm-line)', lineHeight: 1.7 } }, h('a', { href: site.url, target: '_blank', rel: 'noreferrer', style: { color: 'var(--dm-brand)' } }, site.name), h('div', null, site.capabilities), h('div', { className: 'dm-muted', style: { whiteSpace: 'normal' } }, site.note))),
      )
    }

    function QQPanel(props) {
      const { state, onClose } = props
      const config = state.qq?.config || {}
      const [draft, setDraft] = useState(config)
      const cfgKey = JSON.stringify(config)
      const shout = state.qq?.shout || { enabled: false, mode: 'qzone', targetId: '', minMin: 90, maxMin: 300, quiet: [0, 7] }
      const [shoutDraft, setShoutDraft] = useState(() => ({ ...shout }))
      const [actionBusy, setActionBusy] = useState('')
      const [localNotice, setLocalNotice] = useState('')
      const [qzone, setQzone] = useState(null)
      const [qqLogin, setQQLogin] = useState(null)
      const [loginBusy, setLoginBusy] = useState(false)
      const [sample, setSample] = useState('')
      const [autonomy, setAutonomy] = useState(null)
      const request = async (route, body) => {
        setActionBusy(body.action || route); setLocalNotice('')
        try {
          const result = await apiJson(`${API}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          if (route === 'social' && result.needsLogin) setQzone(result)
          if (!result.ok) throw new Error(result.error || '这次没有完成')
          if (route === 'social' && ['login', 'check'].includes(body.action)) { setQzone(result); setLocalNotice(result.logged ? '大肥鱼的空间已登录' : result.accountMismatch ? '当前是另一QQ账号，请切换为大肥鱼的账号' : '请用大肥鱼的QQ扫描空间二维码，并在手机确认；会自动检查登录') }
          else if (result.url && route === 'perception') setSample(result.url)
          else setLocalNotice(result.text || '已保存')
          await state.loadQQ()
          return result
        } catch (error) { setLocalNotice(error.message) }
        finally { setActionBusy('') }
      }
      const scanLogin = async (action = 'start') => {
        setLoginBusy(true)
        try {
          const result = await apiJson(`${API}/qq/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
          setQQLogin(result)
          if (result.logged) await state.loadQQ()
        } catch (error) { setQQLogin({ ok: false, error: error.message }) }
        finally { setLoginBusy(false) }
      }
      useEffect(() => {
        if (!qqLogin || qqLogin.logged || qqLogin.accountMismatch || qqLogin.needsSetup) return
        let active = true, busy = false
        const timer = setInterval(async () => {
          if (busy || document.hidden) return
          busy = true
          try {
            const result = await apiJson(`${API}/qq/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status' }) })
            if (active) { setQQLogin(result); if (result.logged) await state.loadQQ() }
          } catch { /* Keep the current QR while the background process starts. */ }
          finally { busy = false }
        }, 3000)
        return () => { active = false; clearInterval(timer) }
      }, [Boolean(qqLogin), Boolean(qqLogin?.logged), Boolean(qqLogin?.accountMismatch), Boolean(qqLogin?.needsSetup)])
      useEffect(() => {
        if (!qzone?.needsLogin || qzone.logged || qzone.accountMismatch) return
        let active = true, busy = false
        const timer = setInterval(async () => {
          if (busy || document.hidden) return
          busy = true
          try {
            const result = await apiJson(`${API}/social`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check' }) })
            if (active && result.logged) {
              setQzone(result); setLocalNotice('大肥鱼的空间已登录，可以发表保留的草稿了')
              await state.loadQQ()
            }
          } catch { /* Keep the QR visible while the user completes login. */ }
          finally { busy = false }
        }, 3000)
        return () => { active = false; clearInterval(timer) }
      }, [Boolean(qzone?.needsLogin), Boolean(qzone?.logged), Boolean(qzone?.accountMismatch)])
      const shoutKey = JSON.stringify(shout)
      useEffect(() => {
        state.loadQQ()
        apiJson(`${API}/autonomy`).then(setAutonomy).catch(() => {})
        const timer = setInterval(() => { if (!document.hidden) state.loadQQ() }, 10000)
        return () => clearInterval(timer)
      }, [])
      useEffect(() => {
        setDraft(config)
      }, [cfgKey])
      useEffect(() => {
        setShoutDraft({ ...shout })
      }, [shoutKey])

      const status = state.qq?.status || {}
      const stateClass = status.status === 'connected' ? 'on' : status.status === 'error' ? 'err' : ''
      const stateText =
        status.status === 'connected'
          ? `已连接${status.selfId ? ` · ${status.selfId}` : ''}`
          : status.status === 'connecting'
            ? '连接中…'
            : status.status === 'error'
              ? `未连上：${status.lastError || '网关没开'}`
              : '未启用'
      // 多实例是「发一条她回四条」的老病根，摆在明面上，别让它悄悄回来。
      const shareText =
        Number(status.handlers || 1) > 1
          ? `（${status.handlers} 个实例共用这一条连接）`
          : Number(status.owners || 1) > 1
            ? '（单连接）'
            : ''
      // 连不上时给出能直接照做的下一步，而不是只甩一句「连接断开」。
      const hintText = status.status === 'error' ? String(status.hint || '') : ''
      const bootInfo = state.qq?.instances
      const bootText = bootInfo?.count
        ? `本轮宿主装配 ${bootInfo.count} 次${bootInfo.duplicated ? '（加载器在重复装配，连接已合并）' : ''}`
        : ''

      const field = (key) => (event) => setDraft((row) => ({ ...row, [key]: event.target.value }))
      const toggle = (key) => (event) => setDraft((row) => ({ ...row, [key]: event.target.checked }))

      return h(
        Drawer,
        { title: 'QQ 桥', onClose },
        h('div', { className: 'dm-qq-state', style: { marginBottom: hintText || bootText ? '4px' : '10px' } },
          h('span', { className: `dm-qq-dot ${stateClass}` }), stateText,
          shareText ? h('span', { className: 'dm-qq-meta' }, shareText) : null),
        hintText ? h('div', { className: 'dm-qq-hint' }, `→ ${hintText}`) : null,
        bootText ? h('div', { className: 'dm-qq-meta', style: { marginBottom: '10px' } }, bootText) : null,
        h('div', { className: 'dm-sec' }, 'QQ 登录'),
        h('div', { className: 'dm-muted', style: { whiteSpace: 'normal', lineHeight: 1.7 } }, '第一次用手机 QQ 扫码并确认；之后打开 DSH 自动连接。QQ 在后台运行。'),
        h('button', { className: 'dm-btn dm-primary', disabled: loginBusy, style: { margin: '10px 0' }, onClick: () => scanLogin('start') }, loginBusy ? '正在准备登录…' : status.status === 'connected' ? '检查 QQ 登录' : '扫码登录 QQ'),
        qqLogin ? h('div', { role: 'status', 'aria-live': 'polite' },
          h('div', { className: qqLogin.error ? 'dm-qq-hint' : 'dm-muted', style: { whiteSpace: 'normal', lineHeight: 1.7 } }, qqLogin.error || qqLogin.text || 'QQ 正在启动，请稍候…'),
          qqLogin.qr ? h('img', { src: qqLogin.qr, alt: '请用手机QQ扫描此二维码登录', width: 240, height: 240, style: { display: 'block', maxWidth: '100%', height: 'auto', margin: '10px 0', borderRadius: '8px' } }) : null,
          qqLogin.qr ? h('button', { className: 'dm-btn', disabled: loginBusy, onClick: () => scanLogin('refresh') }, '刷新二维码') : null) : null,
        h('details', { style: { margin: '10px 0' } },
          h('summary', { style: { cursor: 'pointer' } }, '高级连接设置'),
          h('div', { className: 'dm-qq-row' }, h('label', null, '网关地址'), h('input', { className: 'dm-input-sm', value: draft.url || '', onChange: field('url'), placeholder: 'ws://127.0.0.1:3010' })),
          h('div', { className: 'dm-qq-row' }, h('label', null, '连接令牌'), h('input', { className: 'dm-input-sm', type: 'password', value: draft.token || '', onChange: field('token'), autoComplete: 'off' })),
          h('div', { className: 'dm-qq-row' }, h('label', null, '她的 QQ 号'), h('input', { className: 'dm-input-sm', value: draft.selfId || '', onChange: field('selfId'), placeholder: '扫码后自动读取' }))),
        h('div', { className: 'dm-qq-row' }, h('label', null, '主号 QQ'), h('input', { className: 'dm-input-sm', value: draft.ownerId || '', onChange: field('ownerId'), placeholder: '只回这个号，填你的主号' })),
        h('div', { className: 'dm-sec' }, '行为（安全相关，默认最保守）'),
        h('label', { className: 'dm-check' }, h('input', { type: 'checkbox', checked: draft.ownerOnly !== false, onChange: toggle('ownerOnly') }), '只回主人（别人私聊、@ 都不理）'),
        h('label', { className: 'dm-check' }, h('input', { type: 'checkbox', checked: Boolean(draft.enabled), onChange: toggle('enabled') }), '启用 QQ 桥'),
        h('label', { className: 'dm-check', title: '打开DSH即连接，网关未启动时自动启动；掉线后自动重试。首次或登录失效时仍需本人扫码。' },
          h('input', { type: 'checkbox', checked: Boolean(draft.autoLaunchNapcat), onChange: toggle('autoLaunchNapcat') }),
          '打开 DSH 自动连接 QQ'),
        h('div', { className: 'dm-muted', style: { marginTop: '2px', whiteSpace: 'normal', lineHeight: 1.7 } },
          '平时自动连接和恢复，无需手动唤醒；首次或登录失效时，请用大肥鱼的 QQ 扫码。'),
        h('label', { className: 'dm-check' }, h('input', { type: 'checkbox', checked: draft.privateReply !== false, onChange: toggle('privateReply') }), '私聊都回'),
        h('label', { className: 'dm-check' }, h('input', { type: 'checkbox', checked: draft.groupAtOnly !== false, onChange: toggle('groupAtOnly') }), '群里只回 @ 我 / 叫我名字'),
        h('label', { className: 'dm-check' }, h('input', { type: 'checkbox', checked: draft.humanize !== false, onChange: toggle('humanize') }), '拟人化：分条 + 停顿'),
        h('label', { className: 'dm-check', title: '回复后按概率补一张大肥鱼表情包（同会话 90 秒最多一张）' },
          h('input', {
            type: 'checkbox',
            checked: Number(draft.stickerChance || 0) > 0,
            onChange: (event) => setDraft((row) => ({ ...row, stickerChance: event.target.checked ? 0.45 : 0 })),
          }),
          `会发表情包${state.qq?.stickers?.total ? `（图库 ${state.qq.stickers.total} 张）` : ''}`),
        Number(draft.stickerChance || 0) > 0
          ? h('div', { className: 'dm-qq-row' },
              h('label', null, '发的频率'),
              h('input', {
                className: 'dm-input-sm dm-qq-num',
                type: 'number',
                min: 0,
                max: 1,
                step: 0.05,
                value: Number(draft.stickerChance || 0),
                onChange: field('stickerChance'),
              }),
              h('span', { className: 'dm-qq-meta' }, `约 ${Math.round(Number(draft.stickerChance || 0) * 100)}% 的回复带一张`))
          : null,
        h('div', { className: 'dm-sec' }, 'QQ 语音'),
        h('div', { className: 'dm-muted', style: { whiteSpace: 'normal', lineHeight: 1.7 } },
          `当前电脑本地处理 · 听语音${state.qq?.perception?.asr ? '已就绪' : '待就绪'} · 说话${state.qq?.perception?.tts ? '已就绪' : '待就绪'} · 看图片${state.qq?.perception?.vision ? '已就绪' : '待就绪'}`),
        h('label', { className: 'dm-check' }, h('input', {
          type: 'checkbox', checked: state.qq?.perception?.voiceEnabled !== false, disabled: Boolean(actionBusy),
          onChange: (e) => request('perception', { voiceEnabled: e.target.checked }),
        }), '让她自己决定回文字还是语音'),
        h('div', { className: 'dm-muted', style: { whiteSpace: 'normal' } },
          `常用声音：${state.qq?.perception?.voices?.find((v) => v.id === state.qq?.perception?.voice)?.label || '她还没选，可以在 QQ 里让她选一个喜欢的声音'}`),
        h('button', { className: 'dm-btn', disabled: Boolean(actionBusy) || !state.qq?.perception?.tts, onClick: () => request('perception', { action: 'sample' }) }, actionBusy === 'sample' ? '正在准备声音…' : '试听当前声音'),
        sample ? h('audio', { controls: true, src: sample, style: { display: 'block', width: '100%', marginTop: '8px' } }) : null,
        h('div', { className: 'dm-sec' }, '空间说说与碎碎念'),
        h('div', { className: 'dm-muted', style: { whiteSpace: 'normal', lineHeight: 1.7 } }, 'QQ聊天和QQ空间需要分别登录；空间未登录时会保留草稿，不会发表。'),
        h('label', { className: 'dm-check', title: '开着后，大肥鱼会时不时自己写一条碎碎念发到下面选的 QQ 会话' },
          h('input', { type: 'checkbox', checked: Boolean(shoutDraft.enabled), onChange: (e) => setShoutDraft((r) => ({ ...r, enabled: e.target.checked })) }),
          '让她时不时写点什么'),
        h('div', { className: 'dm-qq-row' },
          h('label', null, '发到'),
          h('select', { className: 'dm-input-sm', value: shoutDraft.mode || 'private', onChange: (e) => setShoutDraft((r) => ({ ...r, mode: e.target.value })) },
            h('option', { value: 'qzone' }, 'QQ 空间说说'),
            h('option', { value: 'private' }, '私聊发到 QQ 号'),
            h('option', { value: 'group' }, '发到群')),
          shoutDraft.mode === 'qzone' ? null : h('input', { className: 'dm-input-sm', value: shoutDraft.targetId || '', onChange: (e) => setShoutDraft((r) => ({ ...r, targetId: e.target.value })), placeholder: shoutDraft.mode === 'group' ? '接收群号' : 'QQ 号，留空发给主号' })),
        shoutDraft.mode === 'qzone' ? h(React.Fragment, null,
          h('label', { className: 'dm-check' }, h('input', { type: 'checkbox', checked: Boolean(shoutDraft.autoPublish), onChange: (e) => setShoutDraft((r) => ({ ...r, autoPublish: e.target.checked })) }), '允许她自动发表到空间'),
          h('div', { className: 'dm-muted', style: { whiteSpace: 'normal', lineHeight: 1.7 } }, '不开自动发表时只留草稿。发表使用大肥鱼的 QQ，谁能看见由她的空间可见范围决定；每天最多 3 条。'),
          h('label', { className: 'dm-check', title: '别人在她说说下评论时，她会自己挑着回，每天有次数上限' },
            h('input', { type: 'checkbox', checked: (shoutDraft.replyComments || {}).enabled !== false, onChange: (e) => setShoutDraft((r) => ({ ...r, replyComments: { enabled: e.target.checked, maxPerDay: Number((r.replyComments || {}).maxPerDay) || 5 } })) }),
            '自动回复空间评论'),
          h('div', { className: 'dm-qq-row' },
            h('label', null, '每天最多回'),
            h('input', { className: 'dm-input-sm dm-qq-num', type: 'number', min: 0, max: 30, value: Number((shoutDraft.replyComments || {}).maxPerDay ?? 5), onChange: (e) => setShoutDraft((r) => ({ ...r, replyComments: { enabled: (r.replyComments || {}).enabled !== false, maxPerDay: Math.max(0, Math.min(30, Number(e.target.value) || 0)) } })) }),
            h('span', { className: 'dm-qq-meta' }, '条')),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' } },
            h('button', { className: 'dm-btn', disabled: Boolean(actionBusy), onClick: () => request('social', { action: 'reply-now' }) }, actionBusy === 'reply-now' ? '正在看评论…' : '现在回一次')),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' } },
            h('button', { className: 'dm-btn', disabled: Boolean(actionBusy), onClick: () => request('social', { action: 'login' }) }, actionBusy === 'login' ? '正在打开空间…' : (qzone?.needsLogin ? '刷新空间二维码' : '登录大肥鱼的空间')),
            h('button', { className: 'dm-btn', disabled: Boolean(actionBusy), onClick: () => request('social', { action: 'check' }) }, '检查登录'),
            h('button', { className: 'dm-btn', disabled: Boolean(actionBusy), onClick: () => request('social', { action: 'login', visible: true }) }, '在窗口中登录')),
          qzone?.shot ? h('img', { src: `${API}/shot?name=${encodeURIComponent(qzone.shot)}`, alt: '大肥鱼的QQ空间登录页面', style: { width: '100%', maxHeight: '320px', objectFit: 'contain', marginTop: '8px' } }) : null,
        ) : null,
        h('div', { className: 'dm-qq-row' },
          h('label', null, '间隔(分)'),
          h('input', { className: 'dm-input-sm dm-qq-num', type: 'number', min: 5, value: Number(shoutDraft.minMin || 90), onChange: (e) => setShoutDraft((r) => ({ ...r, minMin: Number(e.target.value) })) }),
          h('span', { className: 'dm-qq-meta' }, '~'),
          h('input', { className: 'dm-input-sm dm-qq-num', type: 'number', min: 5, value: Number(shoutDraft.maxMin || 300), onChange: (e) => setShoutDraft((r) => ({ ...r, maxMin: Number(e.target.value) })) }),
          h('span', { className: 'dm-qq-meta' }, '随机取')),
        h('div', { className: 'dm-qq-row' },
          h('label', null, '安静时段'),
          h('input', { className: 'dm-input-sm dm-qq-num', type: 'number', min: 0, max: 23, value: (shoutDraft.quiet || [0, 7])[0], onChange: (e) => setShoutDraft((r) => ({ ...r, quiet: [Number(e.target.value), (r.quiet || [0, 7])[1]] })) }),
          h('span', { className: 'dm-qq-meta' }, '点到'),
          h('input', { className: 'dm-input-sm dm-qq-num', type: 'number', min: 0, max: 23, value: (shoutDraft.quiet || [0, 7])[1], onChange: (e) => setShoutDraft((r) => ({ ...r, quiet: [(r.quiet || [0, 7])[0], Number(e.target.value)] })) }),
          h('span', { className: 'dm-qq-meta' }, '之间不发')),
        h('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } },
          h('button', { className: 'dm-btn dm-primary', onClick: () => state.saveShout({ ...shoutDraft }) }, '保存说说设置'),
          h('button', { className: 'dm-btn', onClick: () => state.shoutNow(), title: '按已保存的设置写一条；未开自动发表时留作草稿' }, '让她写一条')),
        h('div', { className: 'dm-muted', style: { marginTop: '6px', whiteSpace: 'normal', lineHeight: 1.7 } },
          '空间说说由她自己写，只表达她的感受和兴趣，不引用你的私人聊天或行程；私聊碎碎念按选定的 QQ 会话发送。安静时段按北京时间执行。',
          state.qq?.shoutStatus?.nextAt && shoutDraft.enabled ? ` 下一条约 ${Math.max(1, Math.round((state.qq.shoutStatus.nextAt - Date.now()) / 60000))} 分钟后。` : ''),
        (state.qq?.shoutStatus?.recent || []).length
          ? h('div', { className: 'dm-qq-log', style: { marginTop: '6px' } },
              state.qq.shoutStatus.recent.slice(0, 4).map((row, i) =>
                h('div', { className: 'dm-qq-line', key: i, title: row.text },
                  h('b', null, '说说'),
                  ` ${new Date(row.ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}：${row.text}`)))
          : null,
        localNotice ? h('div', { className: 'dm-muted', role: 'status', style: { whiteSpace: 'normal', marginTop: '8px', lineHeight: 1.7 } }, localNotice) : null,
        (state.qq?.social?.posts || []).length ? h(React.Fragment, null,
          h('div', { className: 'dm-sec' }, '她的空间动态'),
          state.qq.social.posts.slice(0, 6).map((post) => h('div', { key: post.id, style: { padding: '10px 0', borderBottom: '1px solid var(--dm-line)' } },
            h('div', { className: 'dm-qq-meta' }, `${({ draft: '草稿', published: '已发表', publishing: '发布中', uncertain: '待核实' })[post.status] || '草稿'} · ${new Date(post.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`),
            h('p', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.7, margin: '6px 0' } }, post.text),
            post.error ? h('div', { className: 'dm-qq-hint', style: { whiteSpace: 'normal', marginBottom: '6px' } }, post.error) : null,
            post.status === 'draft' ? h('button', { className: 'dm-btn dm-btn-xs', disabled: Boolean(actionBusy), onClick: () => request('social', { action: 'publish', id: post.id }) }, '发表到空间') : null,
            post.url ? h('a', { href: post.url, target: '_blank', rel: 'noreferrer', className: 'dm-muted' }, '查看空间') : null,
            post.status === 'uncertain' ? h('div', { className: 'dm-muted' }, '先到空间确认，系统不会自动重复发表。') : null,
            post.status === 'uncertain' ? h('button', { className: 'dm-btn dm-btn-xs', disabled: Boolean(actionBusy), onClick: () => request('social', { action: 'restore-draft', id: post.id, checkedUnpublished: true }) }, '确认未发表，恢复草稿') : null,
          )),
        ) : null,
        h('div', { className: 'dm-sec' }, '她自己的兴趣'),
        h('label', { className: 'dm-check' }, h('input', { type: 'checkbox', checked: autonomy?.config?.enabled !== false, disabled: Boolean(actionBusy), onChange: async (e) => { const result = await request('autonomy', { enabled: e.target.checked }); if (result) setAutonomy(result) } }), '空闲时自己逛逛公开内容'),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '8px' } },
          ...[['shout', '发说说'], ['reply', '回评论'], ['proactive', '主动聊天'], ['browse', '自己逛逛']].map(([kind, label]) =>
            h('label', { key: kind, style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', whiteSpace: 'nowrap' } },
              h('span', { style: { minWidth: '52px' } }, label),
              h('input', {
                type: 'number', min: '1', max: '20', className: 'dm-input', style: { width: '48px' },
                defaultValue: autonomy?.config?.maxPerDayByKind?.[kind] ?? '', disabled: Boolean(actionBusy),
                onBlur: async (e) => {
                  const count = Math.round(Number(e.target.value))
                  if (!Number.isFinite(count) || count < 1) return
                  const result = await request('autonomy', { maxPerDayByKind: { [kind]: count } })
                  if (result) setAutonomy(result)
                },
              }),
              '次/天',
              h('input', {
                type: 'number', min: '1', max: '100', className: 'dm-input', style: { width: '46px' },
                defaultValue: Math.round((autonomy?.config?.chance?.[kind] ?? 0) * 100), disabled: Boolean(actionBusy),
                onBlur: async (e) => {
                  const rate = Math.round(Number(e.target.value))
                  if (!Number.isFinite(rate) || rate < 1) return
                  const result = await request('autonomy', { chance: { [kind]: rate / 100 } })
                  if (result) setAutonomy(result)
                },
              }),
              '%',
            ),
          ),
        ),
        h('div', { className: 'dm-muted', style: { whiteSpace: 'normal', lineHeight: 1.7 } }, '先从 B 站公开内容开始，每天最多两次，夜间休息；她的抖音账号准备好后再接入私信分享。豆包和即梦可在「平台登录」里登录，再直接让她生图或做视频。'),
        h('div', { style: { display: 'flex', gap: '6px', marginTop: '10px' } },
          h('button', { className: 'dm-btn dm-primary', style: { flex: 1 }, onClick: () => state.saveQQ({ ...draft, enabled: true }) }, '保存并连接'),
          h('button', { className: 'dm-btn', onClick: () => state.testQQ() }, '测试'),

        ),
        h('div', { className: 'dm-muted', style: { marginTop: '10px', whiteSpace: 'normal', lineHeight: 1.7 } },
          '扫码完成后会自动配置本机连接；聊天账号与大肥鱼账号请分开使用。默认只回复你的主号，每分钟最多 12 条。'),
        (state.qq?.recent || []).length
          ? h(React.Fragment, null,
              h('div', { className: 'dm-sec' }, '最近消息'),
              h('div', { className: 'dm-qq-log' },
                state.qq.recent.slice(0, 12).map((row, i) =>
                  h('div', { className: 'dm-qq-line', key: i, title: row.text },
                    h('b', null, row.dir === 'in' ? '收' : '发'),
                    ` ${row.scene === 'group' ? '群' : '私'} · ${row.name || ''}：${row.text}`,
                  ),
                ),
              ),
            )
          : null,
      )
    }

    /* ---------------------------------------------------------------- 平台登录（Cookie 导入） */

    function LoginPanel(props) {
      const { onClose } = props
      const [rows, setRows] = useState([])
      const [drafts, setDrafts] = useState({})
      const [busy, setBusy] = useState('')
      const [notice, setNotice] = useState('')

      const reload = useCallback(async () => {
        try {
          const body = await apiJson(`${API}/logins`)
          const meta = body.platforms || []
          const stat = body.status || []
          setRows(meta.map((m) => ({ ...m, ...(stat.find((s) => s.id === m.id) || {}) })))
        } catch {
          setNotice('登录态没加载出来（宿主可能还没起来）。')
        }
      }, [])

      useEffect(() => { reload() }, [reload])

      const openCreativeLogin = async (id) => {
        setBusy(id)
        try {
          const result = await apiJson(`${API}/login/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: id }) })
          setNotice(result.text || result.error || '登录窗口已打开')
        } catch (error) { setNotice(error.message) }
        finally { setBusy('') }
      }
      const refreshCreativeLogin = async () => {
        try { await apiJson(`${API}/login/refresh`, { method: 'POST' }); await reload(); setNotice('登录档案已同步；实际登录状态以平台页面为准。') }
        catch (error) { setNotice(error.message) }
      }

      const save = async (id) => {
        setBusy(id)
        setNotice('')
        try {
          await apiJson(`${API}/logins`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform: id, cookie: drafts[id] || '' }),
          })
          setNotice('已保存（只存本机）。')
          await reload()
        } catch (error) {
          setNotice(`保存失败：${error.message}`)
        } finally {
          setBusy('')
        }
      }

      const clear = async (id) => {
        setBusy(id)
        try {
          await apiJson(`${API}/logins`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: id, action: 'clear' }) })
          setDrafts((d) => ({ ...d, [id]: '' }))
          await reload()
        } catch (error) {
          setNotice(`清除失败：${error.message}`)
        } finally {
          setBusy('')
        }
      }

      // ---- 扫码登录：B站走服务端（二维码 SVG）；抖音/小红书走真浏览器（二维码 PNG dataURL）----
      const [qr, setQr] = useState(null) // { platform, svg?, img?, status }
      const qrTimer = useRef(null)
      const stopQr = useCallback(() => {
        if (qrTimer.current) {
          clearInterval(qrTimer.current)
          qrTimer.current = null
        }
        apiJson(`${API}/login/qr`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cancel' }),
        }).catch(() => {})
        setQr(null)
      }, [])
      useEffect(() => () => {
        if (qrTimer.current) clearInterval(qrTimer.current)
      }, [])

      const startQr = async (platform) => {
        setNotice('')
        try {
          const r = await apiJson(`${API}/login/qr`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'start', platform }),
          })
          if (!r.ok) {
            setNotice(r.error || '二维码生成失败')
            return
          }
          if (r.state === 'already') {
            setNotice('已经是登录态，Cookie 已刷新保存。')
            await reload()
            return
          }
          setQr({ platform, svg: r.svg || null, img: r.qr || null, status: '等待扫码', done: false })
          qrTimer.current = setInterval(async () => {
            try {
              const p = await apiJson(`${API}/login/qr`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'poll', platform }),
              })
              // 服务端方案（B站）：status=success/expired；浏览器方案（抖音/小红书）：state=done/timeout。
              if (p.status === 'success' || p.state === 'done') {
                stopQr()
                setNotice('登录成功，Cookie 已保存（只存本机）。')
                await reload()
                return
              }
              if (p.status === 'expired' || p.state === 'timeout') {
                stopQr()
                setNotice('二维码过期/超时了，重新点「扫码登录」。')
                return
              }
              if (p.state === 'waiting' || p.status) {
                setQr((q) => (q ? { ...q, status: p.message || (p.state === 'waiting' ? '等待扫码…' : q.status) } : q))
              }
            } catch {
              // 网络抖动就等下一轮。
            }
          }, 2000)
        } catch (error) {
          setNotice(`扫码登录启动失败：${error.message}`)
        }
      }

      return h(
        Drawer,
        { title: '平台登录', onClose },
        h('div', { className: 'dm-muted', style: { whiteSpace: 'normal', lineHeight: 1.7, marginBottom: '8px' } },
          'QQ 请在「QQ 桥」面板直接扫码登录，二维码会显示在插件内。',
          'B站/抖音/小红书都支持真扫码登录（二维码自动生成，登录态只存本机）。抖音/小红书会用本机 Chrome 开一个隐藏窗口走官方登录流程——风控严的时候可能拿不到码，重试一次或直接粘 Cookie 也行。'),
        notice ? h('div', { className: 'dm-muted', style: { margin: '4px 0' } }, notice) : null,
        qr
          ? h('div', { style: { marginTop: '10px', textAlign: 'center' } },
              h('div', { className: 'dm-sec' }, `${qr.platform === 'bilibili' ? 'B站' : qr.platform === 'douyin' ? '抖音' : '小红书'}扫码登录`),
              qr.svg
                ? h('div', {
                    style: { display: 'inline-block', border: '1px solid var(--dm-line)', borderRadius: '8px', padding: '6px', background: '#fff' },
                    dangerouslySetInnerHTML: { __html: qr.svg },
                  })
                : h('img', { src: qr.img, alt: '扫码登录二维码', style: { width: '180px', height: '180px', border: '1px solid var(--dm-line)', borderRadius: '8px', background: '#fff' } }),
              h('div', { className: 'dm-muted', style: { marginTop: '6px' } }, `${qr.status}（用对应 App 扫，有效期约 3 分钟）`),
              h('button', { className: 'dm-btn', style: { marginTop: '6px' }, onClick: stopQr }, '取消'),
            )
          : null,
        rows.map((p) =>
          h('div', { key: p.id, style: { marginTop: '12px' } },
            h('div', { className: 'dm-sec' }, `${p.label} · ${p.browserLogin ? (p.logged ? '档案已保存' : '尚未登录') : p.logged ? (p.hasKey ? '已保存登录信息' : '已导入（缺关键字段）') : '未导入'}`),
            h('div', { className: 'dm-muted', style: { whiteSpace: 'normal', lineHeight: 1.6 } }, p.hint),
            p.browserLogin ? null : h('textarea', {
              className: 'dm-input-sm',
              style: { marginTop: '6px' },
              value: drafts[p.id] || '',
              onChange: (e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value })),
              placeholder: `粘贴 ${p.label} 的 Cookie${p.field ? `（关键字段 ${p.field}）` : ''}`,
            }),
            h('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } },
              p.browserLogin ? null : h('button', { className: 'dm-btn dm-primary', disabled: busy === p.id, onClick: () => save(p.id) }, '保存'),
              h('button', {
                className: 'dm-btn',
                disabled: Boolean(qr) || Boolean(busy),
                onClick: () => p.browserLogin ? openCreativeLogin(p.id) : startQr(p.id),
                title: '弹出二维码，用 App 扫一下，Cookie 自动保存',
              }, p.browserLogin ? '打开登录窗口' : qr && qr.platform === p.id ? '等待扫码…' : '扫码登录'),
              p.browserLogin ? h('button', { className: 'dm-btn', disabled: Boolean(busy), onClick: refreshCreativeLogin }, '我已登录，刷新') : null,
              h('button', { className: 'dm-btn', disabled: busy === p.id || !p.logged, onClick: () => clear(p.id) }, '清除')),
          ),
        ),
      )
    }

    /* ---------------------------------------------------------------- 记忆 / 日记 */

    const KIND_META = {
      fact: { label: '事实', color: '#0099ff' },
      preference: { label: '偏好', color: '#7a5af8' },
      task: { label: '任务', color: '#e8890c' },
      lesson: { label: '教训', color: '#f54a45' },
      episode: { label: '经历', color: '#2fbf71' },
      reflection: { label: '自省', color: '#d6409f' },
    }

    const starText = (weight) => {
      const n = Math.max(1, Math.min(5, Number(weight) || 3))
      return '★'.repeat(n) + '☆'.repeat(5 - n)
    }

    function DiaryTab(props) {
      const { state } = props
      const days = state.diary || []
      const stats = state.diaryStats || {}
      const wroteToday = Number(stats.today || 0) > 0

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' } },
          h('div', { className: 'dm-muted', style: { flex: 1 } },
            `共 ${stats.total ?? 0} 篇 · 今天 ${stats.today ?? 0} 篇`),
          h('button', { className: 'dm-btn', title: '把零散记忆压成一句长期观察，并写进日记', onClick: () => state.consolidate() }, '反思整合'),
          h('button', { className: 'dm-btn', title: '按遗忘曲线淡化旧记忆（不删除）', onClick: () => state.fadeMemory() }, '淡化'),
          h('button', {
            className: 'dm-btn dm-primary',
            disabled: state.reflecting,
            title: '让她回顾最近的聊天，自己决定写什么',
            onClick: () => state.reflectDiary(),
          }, state.reflecting ? '她在写…' : '让她写一篇'),
        ),
        h('div', { className: 'dm-muted', style: { marginBottom: '10px', fontSize: '11px' } },
          wroteToday ? '今天她已经写过了。这本子归她，你不用管格式。' : '你正常聊天就行——她觉得值得记的会自己写。'),
        days.length === 0
          ? h('div', { className: 'dm-empty-block' },
              '她还没写过日记。', h('br'), '聊过之后她会自己落笔；想现在就有一篇，上面点「让她写一篇」。')
          : days.map((day) =>
              h(
                'div',
                { className: 'dm-day', key: day.day },
                h('div', { className: 'dm-day-head' },
                  h('span', { className: 'dm-day-date' }, day.day),
                  h('span', { className: 'dm-day-n' }, `${day.entries.length} 篇`),
                  h('span', { className: 'dm-day-line' }),
                ),
                day.entries.map((row) =>
                  h(
                    'div',
                    { className: 'dm-note', key: row.id, style: { '--dm-note-accent': (row.weight || 3) >= 4 ? '#0099ff' : '#c9cdd4' } },
                    h('div', { className: 'dm-note-head' },
                      h('span', { className: 'dm-note-time' }, row.time),
                      h('span', { className: 'dm-note-title' }, row.title),
                    ),
                    h('div', { className: 'dm-note-body' }, row.body),
                    h('div', { className: 'dm-note-meta' },
                      h('span', { className: 'dm-star', title: `重要度 ${row.weight}/5` }, starText(row.weight)),
                      row.mood ? h('span', { className: 'dm-note-mood' }, `· ${row.mood}`) : null,
                      (row.tags || []).map((tag) => h('span', { className: 'dm-tag', key: tag }, tag)),
                      // 她自己顺手写的不用标；「事后补的」标一下，好区分质量。
                      row.source === 'user' ? h('span', { className: 'dm-tag' }, '我写的') : null,
                      row.source === 'auto' ? h('span', { className: 'dm-tag' }, '事后补的') : null,
                      row.source === 'memory' ? h('span', { className: 'dm-tag' }, '顺带记的') : null,
                    ),
                  ),
                ),
              ),
            ),
      )
    }

    function MemoryListTab(props) {
      const { state } = props
      const [q, setQ] = useState('')
      const [text, setText] = useState('')
      const [kind, setKind] = useState('fact')

      const rows = (state.memory || []).filter((row) =>
        q ? `${row.text} ${(row.tags || []).join(' ')}`.includes(q) : true,
      )
      const stats = state.memoryStats || {}

      return h(
        React.Fragment,
        null,
        h('div', { className: 'dm-muted', style: { marginBottom: '8px' } },
          `共 ${stats.total ?? 0} 条 · 重要 ${stats.important ?? 0} 条 · 已淡化 ${stats.faded ?? 0} 条`),
        h('button', {
          className: 'dm-mini',
          style: { marginBottom: '8px' },
          title: '把同一件事重复记下的条目合并成一条',
          onClick: () => state.dedupeMemories(),
        }, '合并重复'),
        h('input', {
          className: 'dm-input-sm',
          placeholder: '搜记忆…',
          value: q,
          onChange: (event) => {
            setQ(event.target.value)
            state.loadMemory(event.target.value)
          },
        }),
        h(
          'div',
          { style: { marginTop: '6px' } },
          rows.length === 0
            ? h('div', { className: 'dm-empty-block' }, '没有匹配的记忆。')
            : rows.map((row) =>
                h(
                  'div',
                  { className: 'dm-mem-item', key: row.id },
                  h('span', { className: 'dm-mem-kind', style: { color: (KIND_META[row.kind] || KIND_META.fact).color, background: 'transparent', border: `1px solid ${(KIND_META[row.kind] || KIND_META.fact).color}33` } },
                    (KIND_META[row.kind] || KIND_META.fact).label),
                  h('div', { className: 'dm-mem-text' },
                    row.text,
                    h('span', { className: 'dm-muted' },
                      `${starText(row.weight)}  ·  想起来 ${row.recalls || 0} 次`
                      + (row.faded ? '  ·  已淡化' : '')
                      + (row.emotion ? `  ·  ${row.emotion}` : '')),
                  ),
                  h('button', { className: 'dm-mini dm-danger', title: '删掉这条', onClick: () => state.forget(row.id) }, '删'),
                ),
              ),
        ),
        h(
          'div',
          { className: 'dm-mem-add' },
          h('div', { className: 'dm-sec', style: { marginTop: 0 } }, '手动记住一条'),
          h('input', {
            className: 'dm-input-sm',
            placeholder: '比如「我的抖音号是小鱼干」',
            value: text,
            onChange: (event) => setText(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && text.trim()) {
                state.remember(text.trim(), kind)
                setText('')
              }
            },
          }),
          h('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } },
            h('select', { className: 'dm-input-sm', style: { width: '104px' }, value: kind, onChange: (event) => setKind(event.target.value) },
              Object.keys(KIND_META).map((id) => h('option', { key: id, value: id }, KIND_META[id].label))),
            h('button', {
              className: 'dm-btn dm-primary',
              style: { flex: 1 },
              onClick: () => {
                if (!text.trim()) return
                state.remember(text.trim(), kind)
                setText('')
              },
            }, '记住'),
          ),
          h('div', { className: 'dm-muted', style: { marginTop: '7px', whiteSpace: 'normal', lineHeight: 1.7 } },
            '记忆跨会话保留，每轮按「相关度 × 重要度 × 遗忘曲线 × 被想起次数」挑几条带进提示词。'),
        ),
      )
    }

    function TodayTab(props) {
      const { state } = props
      const rows = state.journal || []
      useEffect(() => {
        state.loadJournal(7)
      }, [])
      if (!rows.length) {
        return h('div', { className: 'dm-empty-block' }, '还没有记录。聊过或干过活之后，这里会出现每天的时间线。')
      }
      return h(
        React.Fragment,
        null,
        h('div', { className: 'dm-muted', style: { marginBottom: '8px' } }, '最近 7 天的对话与操作（流水账，不是日记）'),
        rows.map((day) =>
          h(
            'div',
            { className: 'dm-journal-day', key: day.day },
            h('b', null, day.day),
            day.lines.slice(0, 20).map((line, i) => h('div', { className: 'dm-journal-line', key: i }, line)),
            day.lines.length === 0 ? h('div', { className: 'dm-muted' }, '（空）') : null,
          ),
        ),
      )
    }

    /** 文件大小写成人类能读的样子。 */
    function humanSize(bytes) {
      const n = Number(bytes) || 0
      if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`
      if (n >= 1024) return `${Math.max(1, Math.round(n / 1024))}KB`
      return `${n}B`
    }

    const FILE_DOWNLOAD = `${API}/files/download?name=`

    /**
     * 聊天区底部的横条：她交付的文件，点一下就下载。
     *
     * 为什么不做成气泡：气泡是「说过的话」，文件是「现在还在的东西」——
     * 新交一份旧的就该能继续下，所以它跟着发件箱走，不跟着消息走。
     */
    function FileStrip(props) {
      const { state, onMore } = props
      const rows = state.files?.outbox || []
      if (!rows.length) return null
      return h(
        'div',
        { className: 'dm-filestrip' },
        h('span', { className: 'dm-filestrip-label' }, '她给你的文件：'),
        rows.slice(0, 3).map((row) =>
          h(
            'a',
            {
              key: row.name,
              className: 'dm-filechip',
              href: `${FILE_DOWNLOAD}${encodeURIComponent(row.name)}`,
              download: row.name,
              title: `下载 ${row.name}`,
            },
            h(Icon, { name: 'clip' }),
            h('span', { className: 'dm-filechip-name' }, row.name),
            h('span', { className: 'dm-filechip-size' }, humanSize(row.size)),
          ),
        ),
        rows.length > 3 ? h('button', { className: 'dm-btn dm-ghost', onClick: onMore }, `全部 ${rows.length} 个`) : null,
      )
    }

    /** 文件页签：上面是她交给你的（能下），下面是你给她的（已收）。 */
    function FilesTab(props) {
      const { state, onPick } = props
      const inbox = state.files?.inbox || []
      const outbox = state.files?.outbox || []
      const line = (item, downloadable) => {
        const box = downloadable ? 'outbox' : 'inbox'
        return h(
          'div',
          { className: 'dm-file-row', key: `${box}-${item.name}` },
          h(Icon, { name: 'clip' }),
          h(
            'div',
            { className: 'dm-file-main' },
            h('div', { className: 'dm-file-name' }, item.name),
            h('div', { className: 'dm-file-sub' }, `${humanSize(item.size)} · ${item.at ? fmtTime(item.at) : '时间未知'}`),
          ),
          h(
            'button',
            {
              className: 'dm-btn',
              title: '发一份到 QQ，手机那边直接收到',
              disabled: item.pushing || state.qq?.status?.status !== 'connected',
              onClick: async () => {
                item.pushing = true
                await state.pushToQQ(item.name, box)
                item.pushing = false
              },
            },
            '发到 QQ',
          ),
          downloadable
            ? h('a', { className: 'dm-btn dm-primary', href: `${FILE_DOWNLOAD}${encodeURIComponent(item.name)}`, download: item.name }, '下载')
            : h('span', { className: 'dm-tag' }, '已收进'),
        )
      }
      return h(
        React.Fragment,
        null,
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' } },
          h('div', { className: 'dm-muted', style: { flex: 1 } }, `发件箱 ${outbox.length} 个 · 收件箱 ${inbox.length} 个`),
          h('button', { className: 'dm-btn', onClick: () => state.loadFiles() }, '刷新'),
          h('button', { className: 'dm-btn dm-primary', onClick: onPick }, '发文件给她'),
        ),
        h('div', { className: 'dm-muted', style: { marginBottom: '4px' } }, '她交给你的（点下载存到本地）'),
        outbox.length
          ? outbox.map((row) => line(row, true))
          : h('div', { className: 'dm-empty-block' }, '还没有。她做完东西会主动放进来。'),
        h('div', { className: 'dm-muted', style: { margin: '10px 0 4px' } }, '你给她的（她能直接读）'),
        inbox.length
          ? inbox.map((row) => line(row, false))
          : h('div', { className: 'dm-empty-block' }, '还没有。把文件拖进窗口，或点上面「发文件给她」。'),
      )
    }

    function MemoryDrawer(props) {
      const { state, onClose, startTab, onPick } = props
      const [tab, setTab] = useState(startTab || 'diary')
      useEffect(() => {
        state.loadDiary(30)
        state.loadMemory('')
        state.loadFiles()
        // 日记是她自己在后台写的，抽屉开着的时候也得能看见新落的那几笔。
        const timer = setInterval(() => state.loadDiary(30), 20000)
        return () => clearInterval(timer)
      }, [])
      const tabs = [
        { id: 'diary', label: '日记' },
        { id: 'mem', label: '记忆库' },
        { id: 'today', label: '时间线' },
        { id: 'files', label: '文件' },
      ]
      return h(
        Drawer,
        {
          title: () => `记忆 · ${(state.memoryStats?.total ?? 0)} 条 / ${(state.diaryStats?.total ?? 0)} 篇日记`,
          tabs,
          tab,
          onTab: setTab,
          onClose,
        },
        tab === 'diary'
          ? h(DiaryTab, { state })
          : tab === 'mem'
            ? h(MemoryListTab, { state })
            : tab === 'files'
              ? h(FilesTab, { state, onPick: props.onPick })
              : h(TodayTab, { state }),
      )
    }

    function Footprint(props) {
      const profile = props.profile
      if (!profile) return h('div', { className: 'dm-empty-block' }, '加载中…')
      const modes = Object.entries(profile.byMode || {}).sort((a, b) => b[1] - a[1])
      return h(
        React.Fragment,
        null,
        h('div', { style: { display: 'flex', gap: '7px', marginBottom: '10px' } },
          h('div', { className: 'dm-stat', style: { flex: 1, flexDirection: 'column', alignItems: 'flex-start', border: '1px solid var(--dm-line)', borderRadius: '8px', padding: '8px 10px' } },
            h('span', { className: 'dm-muted' }, '连续天数'), h('b', { style: { fontSize: '18px' } }, `${profile.streak || 0}`)),
          h('div', { className: 'dm-stat', style: { flex: 1, flexDirection: 'column', alignItems: 'flex-start', border: '1px solid var(--dm-line)', borderRadius: '8px', padding: '8px 10px' } },
            h('span', { className: 'dm-muted' }, '累计提问'), h('b', { style: { fontSize: '18px' } }, `${profile.total || 0}`)),
        ),
        modes.length ? h('div', { className: 'dm-sec' }, '模式分布') : null,
        modes.map(([mode, count]) =>
          h(
            'div',
            { className: 'dm-stat', key: mode },
            h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
              h('span', { className: 'dm-dot', style: { color: (MODE_META[mode] || MODE_META.chat).color, background: (MODE_META[mode] || MODE_META.chat).color } }),
              ({ diary: '写日记', growth: '性格整理', reflection: '后台整理' }[mode] || (MODE_META[mode] || MODE_META.chat).label)),
            h('b', null, String(count)),
          ),
        ),
        (profile.recent || []).length ? h('div', { className: 'dm-sec' }, '最近') : null,
        (profile.recent || [])
          .slice(-12)
          .reverse()
          .map((row, i) =>
            h(
              'div',
              { className: 'dm-trail', key: i },
              h('span', { style: { color: (MODE_META[row.mode] || MODE_META.chat).color } },
                `[${(MODE_META[row.mode] || MODE_META.chat).label}] `),
              String(row.text || '').slice(0, 70),
            ),
          ),
      )
    }

    /** 用量抽屉：只算大肥鱼自己的每日 token（本地估算，不耗 token）。 */
    function TokenDrawer(props) {
      const { stats, onClose } = props
      const empty = !stats || !stats.series || stats.series.filter((x) => x.turns > 0).length === 0
      const series = (stats?.series || [])
        .slice()
        .reverse()
        .filter((x) => x.turns > 0)
        .slice(0, 14)
      const max = Math.max(1, ...series.map((x) => x.prompt + x.completion))
      const today = stats?.todayStat || { prompt: 0, completion: 0, turns: 0 }
      const todayTotal = (today.prompt || 0) + (today.completion || 0)
      const byMode = Object.entries(today.byMode || {}).sort((a, b) => b[1].prompt + b[1].completion - (a[1].prompt + a[1].completion))
      return h(
        Drawer,
        { title: () => '今天吃了几碗白饭（大肥鱼自己）', onClose },
        h('div', { style: { display: 'flex', gap: '7px', marginBottom: '10px' } },
          h('div', { className: 'dm-stat', style: { flex: 1, flexDirection: 'column', alignItems: 'flex-start', border: '1px solid var(--dm-line)', borderRadius: '8px', padding: '8px 10px' } },
            h('span', { className: 'dm-muted' }, '今天'), h('b', { style: { fontSize: '18px' } }, fmtBowls(todayTotal)), h('span', { className: 'dm-muted' }, '（提示 ' + (today.prompt || 0) + ' + 生成 ' + (today.completion || 0) + '，' + (stats?.source === 'host' ? '宿主回传' : stats?.source === 'mixed' ? '含历史估算' : '本地估算') + '）')),
          h('div', { className: 'dm-stat', style: { flex: 1, flexDirection: 'column', alignItems: 'flex-start', border: '1px solid var(--dm-line)', borderRadius: '8px', padding: '8px 10px' } },
            h('span', { className: 'dm-muted' }, '今天轮数'), h('b', { style: { fontSize: '18px' } }, `${today.turns || 0}`)),
        ),
        h('div', { className: 'dm-muted', style: { whiteSpace: 'normal', lineHeight: 1.6, marginBottom: '8px' } },
          '白饭就是 token——大肥鱼每聊一句、想一件事、干一次活都要吃几口。这里只算它自己（大肥鱼）吃的，不算主对话。优先记录宿主回传的输入、输出及重试用量；缺少回传时估算。历史估算会单独保留，不能当成金额账单。1 碗≈1000 token。'),
        today.bySource && Object.keys(today.bySource).length > 1
          ? h('div', { className: 'dm-muted', style: { lineHeight: 1.6, marginBottom: '8px' } }, Object.entries(today.bySource).map(([source, value]) => h('div', { key: source }, `${source === 'host' ? '宿主回传' : source === 'estimate' ? '本地估算' : '历史混合'}：${(value.prompt || 0) + (value.completion || 0)} token`)))
          : null,
        today.cacheRead ? h('div', { className: 'dm-muted', style: { marginBottom: '8px' } }, `其中缓存命中输入 ${today.cacheRead} token，已包含在提示用量中。`) : null,
        empty
          ? h('div', { className: 'dm-empty-block' }, '还没有对话记录，聊几句再来。')
          : h(
              React.Fragment,
              null,
              h('div', { className: 'dm-sec' }, '近 14 天'),
              series.map((x) => {
                const total = x.prompt + x.completion
                return h(
                  'div',
                  { className: 'dm-token-row', key: x.date },
                  h('span', { className: 'dm-token-date' }, x.date.slice(5)),
                  h('div', { className: 'dm-token-barwrap' },
                    h('div', { className: 'dm-token-bar', style: { width: `${Math.max(3, Math.round((total / max) * 100))}%` } }),
                  ),
                  h('span', { className: 'dm-token-val' }, fmtBowls(total)),
                  h('span', { className: 'dm-token-turns' }, `${x.turns}轮`),
                )
              }),
              byMode.length ? h('div', { className: 'dm-sec' }, '今天都干啥了（白饭分布）') : null,
              byMode.map(([mode, m]) =>
                h(
                  'div',
                  { className: 'dm-stat', key: mode },
                  h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
                    h('span', { className: 'dm-dot', style: { color: (MODE_META[mode] || MODE_META.chat).color, background: (MODE_META[mode] || MODE_META.chat).color } }),
                    ({ diary: '写日记', growth: '性格整理', reflection: '后台整理' }[mode] || (MODE_META[mode] || MODE_META.chat).label)),
                  h('b', null, fmtTokens((m.prompt || 0) + (m.completion || 0))),
                ),
              ),
            ),
      )
    }

    function RailItem(props) {
      const { row, active, onOpen, onRename, onRemove, busy, unread } = props
      const [editing, setEditing] = useState(false)
      const [title, setTitle] = useState(row.title)
      const [confirming, setConfirming] = useState(false)
      useEffect(() => {
        setTitle(row.title)
      }, [row.title])

      const commit = () => {
        setEditing(false)
        const next = title.trim()
        if (next && next !== row.title) onRename(next)
      }

      const meta = MODE_META[row.mode] || MODE_META.chat
      return h(
        'div',
        {
          className: `dm-rail-item${active ? ' dm-on' : ''}`,
          onClick: () => {
            if (!editing && !confirming) onOpen()
          },
        },
        h('span', { className: 'dm-rail-ava', style: { background: `linear-gradient(140deg,${meta.color},${meta.color}bb)` } },
          String(row.title || '会').slice(0, 1)),
        h(
          'div',
          { className: 'dm-rail-main' },
          editing
            ? h('input', {
                className: 'dm-rename',
                autoFocus: true,
                value: title,
                onChange: (event) => setTitle(event.target.value),
                onBlur: commit,
                onKeyDown: (event) => {
                  if (event.key === 'Enter') commit()
                  if (event.key === 'Escape') {
                    setTitle(row.title)
                    setEditing(false)
                  }
                },
                onClick: (event) => event.stopPropagation(),
              })
            : h(
                'div',
                { className: 'dm-rail-title-row' },
                h('div', { className: 'dm-rail-title' }, row.title),
                unread > 0 ? h('span', { className: 'dm-unread', title: `${unread} 条新消息` }, unread > 99 ? '99+' : String(unread)) : null,
              ),
          h(
            'div',
            { className: 'dm-rail-sub' },
            h('span', { style: { color: meta.color } }, meta.label),
            h('span', null, `${row.count} 条`),
          ),
        ),
        h(
          'div',
          { className: 'dm-rail-acts' },
          h('button', {
            className: 'dm-mini',
            title: '改名',
            onClick: (event) => {
              event.stopPropagation()
              setEditing(true)
            },
          }, '改'),
          h('button', {
            className: 'dm-mini dm-danger',
            title: confirming ? '再点一次删除' : '删除',
            disabled: busy && active,
            onClick: (event) => {
              event.stopPropagation()
              if (!confirming) {
                setConfirming(true)
                setTimeout(() => setConfirming(false), 2600)
                return
              }
              onRemove()
            },
          }, confirming ? '删?' : '删'),
        ),
      )
    }

    /** 16px 线性图标：不依赖字体和 emoji，跨机器一致。 */
    function Icon(props) {
      const common = {
        viewBox: '0 0 16 16',
        width: 16,
        height: 16,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.35,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }
      const paths = {
        chats: ['M2.5 4.5h11v7h-6l-3 2.5v-2.5h-2z'],
        clock: ['M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 0 0 0-11z', 'M8 5v3.2l2 1.2'],
        pen: ['M3 13l1-3 6.5-6.5 2 2L6 12l-3 1z'],
        gear: ['M8 6.2a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 0 0 0-3.6z', 'M8 2.5v1.2M8 12.3v1.2M2.5 8h1.2M12.3 8h1.2'],
        clip: ['M10.5 4.5l-4.8 4.8a1.8 1.8 0 0 0 2.5 2.5l4.8-4.8a3.2 3.2 0 0 0-4.5-4.5L3.7 7.3a4.4 4.4 0 0 0 6.2 6.2l3.3-3.3'],
        image: ['M2.5 3.5h11v9h-11z', 'M2.5 10l3-3 2.5 2.5 2-2 3.5 3.5', 'M10.5 6.2a.8.8 0 1 0 0-1.6a.8.8 0 0 0 0 1.6z'],
        code: ['M5.5 4.5L2.5 8l3 3.5', 'M10.5 4.5L13.5 8l-3 3.5'],
        book: ['M3 2.5h6.5A1.5 1.5 0 0 1 11 4v9H4.5A1.5 1.5 0 0 1 3 11.5z', 'M4.5 2.5v10'],
        plug: ['M6 2v4M10 2v4', 'M4 6h8v3a4 4 0 0 1-8 0z', 'M8 13v1.5'],
        user: ['M8 2.8a2.4 2.4 0 1 1 0 4.8a2.4 2.4 0 0 1 0-4.8z', 'M3.2 13.2a4.8 4.8 0 0 1 9.6 0'],
        voice: ['M3 7.5h1.4l2-3.5 2.2 7 1.8-3.5H13'],
        chat: ['M2.5 3.5h11v7.5h-11z', 'M5 13.2h5'],
        shield: ['M8 2.2l4.8 1.6v4.1c0 2.6-1.9 4.6-4.8 5.7-2.9-1.1-4.8-3.1-4.8-5.7V3.8z'],
        sliders: ['M3 5h7M12 5h1M3 11h3M8 11h5', 'M10 3.6v2.8M6 9.6v2.8'],
        diary: ['M3 2.5h7.5A1.5 1.5 0 0 1 12 4v9H4.5A1.5 1.5 0 0 1 3 11.5z', 'M5.5 6h4M5.5 8.5h4M5.5 11h2.5'],
        search: ['M7.3 3a4.3 4.3 0 1 0 0 8.6a4.3 4.3 0 0 0 0-8.6z', 'M10.6 10.6L13 13'],
        plus: ['M8 3.5v9M3.5 8h9'],
        rice: ['M2.5 6.5h11v1.6a5.5 5.5 0 0 1-11 0z', 'M2.5 6.5h11', 'M5.5 11.4a2.6 2.6 0 0 0 5 0'],
      }
      return h('svg', common, (paths[props.name] || []).map((d, i) => h('path', { key: i, d })))
    }

    function ActivityRail(props) {
      const { state, panel, onOpen } = props
      const qqOn = state.qq?.status?.status === 'connected'
      const items = [
        { id: 'chat', icon: 'chats', title: '会话', fixed: true },
        { id: 'memory', icon: 'diary', title: '记忆 / 日记' },
        { id: 'persona', icon: 'user', title: '性格（六维人格）' },
        { id: 'login', icon: 'shield', title: '平台登录（B站/抖音/小红书 Cookie）' },
        { id: 'components', icon: 'sliders', title: '工具准备：选择并一键安装' },
        { id: 'qq', icon: 'plug', title: qqOn ? 'QQ 已连接' : 'QQ 未连接', dot: qqOn },
        { id: 'tokens', icon: 'rice', title: '今天吃了几碗白饭' },
        { id: 'footprint', icon: 'clock', title: '足迹' },
      ]
      return h(
        'div',
        { className: 'dm-activity' },
        items.map((item) =>
          h(
            'button',
            {
              key: item.id,
              className: `dm-act${item.fixed || panel === item.id ? ' dm-act-on' : ''}`,
              title: item.title,
              onClick: () => (item.fixed ? null : onOpen(panel === item.id ? '' : item.id)),
            },
            h(Icon, { name: item.icon }),
            item.dot ? h('span', { className: 'dm-act-dot', title: 'QQ 在线' }) : null,
          ),
        ),
        h('div', { className: 'dm-spacer' }),
        h(Avatar, {
          className: 'dm-act-face',
          title: `${state.mood?.label || ''} · 精力 ${state.mood?.energy ?? '-'}`,
        }),
      )
    }

    function Toolbar(props) {
      const { onHint, onPick, busy } = props
      const items = [
        { icon: 'clip', title: '发文件给她：收进她的收件箱（也可直接拖进窗口）', pick: true },
        { icon: 'image', title: '发图片给她：同上，图片也能发', pick: true },
        { icon: 'code', title: '代码块：用 ``` 包住即可' },
      ]
      return h(
        'div',
        { className: 'dm-toolbar' },
        items.map((item) =>
          h(
            'button',
            {
              key: item.icon,
              className: 'dm-tool-btn',
              title: item.title,
              disabled: item.pick ? busy : false,
              onClick: () => (item.pick ? onPick() : onHint(item.title)),
            },
            h(Icon, { name: item.icon }),
          ),
        ),
        h('div', { className: 'dm-spacer' }),
        h('span', { className: 'dm-tool-hint' }, 'Enter 发送 · Shift+Enter 换行'),
      )
    }


    // Own the scroll lifecycle with the DOM: opening an overlay can mount it without changing messages.
    function MessageViewport({ sessionId, jump, children }) {
      const viewport = useRef(null), content = useRef(null), following = useRef(true), visible = useRef(false)
      const stick = () => {
        const el = viewport.current
        if (el?.clientHeight && following.current) el.scrollTop = el.scrollHeight
      }
      useLayoutEffect(() => { following.current = true; stick() }, [sessionId, jump])
      useLayoutEffect(stick)
      useEffect(() => {
        const el = viewport.current
        const resize = () => {
          const shown = el.clientHeight > 0
          if (shown && !visible.current) following.current = true
          visible.current = shown
          stick()
        }
        const show = () => { if (!document.hidden) { following.current = true; resize() } }
        const observer = new ResizeObserver(resize)
        observer.observe(el); observer.observe(content.current)
        document.addEventListener('visibilitychange', show)
        resize()
        return () => { observer.disconnect(); document.removeEventListener('visibilitychange', show) }
      }, [])
      return h('div', { className: 'dm-scroll', ref: viewport, onScroll: () => {
        const el = viewport.current
        if (el.clientHeight) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
      } }, h('div', { className: 'dm-scroll-content', ref: content }, children))
    }

    function Stage(props) {
      const { state, variant } = props
      const [panel, setPanel] = useState('')
      useEffect(() => {
        let active = true
        apiJson(`${API}/components`).then((result) => {
          if (active && !result.dismissed && !Array.isArray(result.selected)) setPanel((old) => old || 'components')
        }).catch(() => {})
        return () => { active = false }
      }, [])
      // 记忆抽屉默认从日记进；从「她给你的文件」横条点进去时，直接落在文件页签。
      const [memTab, setMemTab] = useState('diary')
      const [query, setQuery] = useState('')
      const [menu, setMenu] = useState(null)
      const [dragging, setDragging] = useState(false)
      const [uploading, setUploading] = useState(false)
      const fileRef = useRef(null)
      const [lightbox, setLightbox] = useState(null)
      const [, tick] = useState(0)
      const hasMessages = state.messages.length > 0

      useEffect(() => {
        if (!menu) return undefined
        const close = () => setMenu(null)
        window.addEventListener('mousedown', close)
        window.addEventListener('keydown', close)
        return () => {
          window.removeEventListener('mousedown', close)
          window.removeEventListener('keydown', close)
        }
      }, [menu])

      useEffect(() => {
        if (!state.busy) return
        const timer = setInterval(() => tick((n) => n + 1), 1000)
        return () => clearInterval(timer)
      }, [state.busy])

      // 她什么时候交付文件我们不知道（工具调用发生在流式过程中），
      // 所以隔一会儿看一眼发件箱。首次进入立刻拉一次。
      useEffect(() => {
        state.loadFiles()
        const timer = setInterval(() => state.loadFiles(), 12000)
        return () => clearInterval(timer)
      }, [])

      const openPanel = (id, tab) => {
        if (tab) setMemTab(tab)
        setPanel(id)
        if (id === 'footprint' && !state.profile) state.refreshProfile()
      }

      const onKeyDown = (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) {
          event.preventDefault()
          state.send()
        }
      }

      const elapsed = state.activity ? Math.max(1, Math.round((Date.now() - state.activity.since) / 1000)) : 0
      const busyText = state.busy
        ? `${state.activity?.tool ? `运行 ${state.activity.tool}` : '思考中'} · ${elapsed}s`
        : state.notice || (hasMessages ? `${state.messages.length} 条消息` : '就绪')
      const activeSession = state.sessions.find((row) => row.id === state.activeId)
      const activeTitle = activeSession?.title || '新的会话'

      const keyword = query.trim().toLowerCase()
      const shownSessions = keyword
        ? state.sessions.filter(
            (row) =>
              String(row.title || '').toLowerCase().includes(keyword) ||
              String(MODE_META[row.mode]?.label || '').includes(keyword),
          )
        : state.sessions

      /**
       * 收文件：上传一份副本进她的收件箱，再把这个路径放进草稿。
       *
       * 为什么不能只用 file.path：那是本机路径，原文件一改名、移动、删掉就断，
       * 而且她得靠猜去读。收副本进 inbox，路径就是稳定的。
       */
      const takeFiles = async (list) => {
        const rows = Array.from(list || [])
        if (!rows.length) return
        setUploading(true)
        state.setNotice(rows.length === 1 ? `正在收「${rows[0].name}」…` : `正在收 ${rows.length} 个文件…`)
        const done = []
        for (const file of rows) {
          try {
            const row = await state.uploadFile(file)
            if (row) done.push(row)
          } catch (error) {
            state.setNotice(`「${file.name}」没传上去：${error.message}`)
          }
        }
        setUploading(false)
        if (!done.length) return
        const text = done.map((row) => `[[文件]] ${row.path}`).join('\n')
        state.setDraft(`${state.draft ? `${state.draft}\n` : ''}${text}`)
        state.setNotice(
          done.length === 1
            ? `收到「${done[0].name}」，在输入框里加一句话她就去读`
            : `收到 ${done.length} 个文件，在输入框里加一句话她就去读`,
        )
      }

      const dropFiles = (event) => {
        event.preventDefault()
        setDragging(false)
        takeFiles(event.dataTransfer?.files)
      }

      const close = () => setPanel('')

      return h(
        'div',
        {
          className: 'dm-panel dm-win',
          onDragOver: (event) => {
            event.preventDefault()
            if (!dragging) setDragging(true)
          },
          onDragLeave: (event) => {
            if (event.target === event.currentTarget) setDragging(false)
          },
          onDrop: dropFiles,
        },
        /* 标题栏 */
        h(
          'div',
          { className: 'dm-titlebar' },
          h('span', { className: 'dm-logo-wrap' }, h(Avatar, { className: 'dm-logo' })),
          h('div', { style: { minWidth: 0 } },
            h('div', { className: 'dm-name' }, TITLE),
            h('div', { className: 'dm-sub' }, '陪你闲聊的大肥鱼 · 自由、随性'),
          ),
          h('div', { className: 'dm-spacer' }),
          // 顶栏只留「全自动」这一个开关。性格/记忆/QQ/足迹各有别处入口（活动栏 + 会话列表
          // 底部），再挂一排按钮就是纯重复；模式由后端判，前端没有开关位。
          h('button', {
            className: `dm-auto${state.autopilot ? ' on' : ''}`,
            title: '全自动：不再逐步问确认。额度和日志照旧，发布前仍会念一遍内容。',
            onClick: state.toggleAutopilot,
          }, state.autopilot ? '全自动' : '逐步确认'),
          variant === 'overlay'
            ? h('button', { className: 'dm-btn dm-ghost', onClick: () => { if (state.busyRef.current) state.stop(); props.onClose() } }, '关闭')
            : null,
          h('div', { className: 'dm-wdots' }, h('i', null), h('i', null), h('i', null)),
        ),
        h(
          'div',
          { className: 'dm-body' },
          h(ActivityRail, { state, panel, onOpen: openPanel }),
          /* 会话列表 */
          h(
            'div',
            { className: 'dm-rail' },
            h('div', { className: 'dm-rail-head' },
              h('span', null, '会话'),
              h('span', { className: 'dm-rail-count' }, `${state.sessions.length}`),
            ),
            h('div', { className: 'dm-rail-search-wrap' },
              h('input', {
                className: 'dm-rail-search',
                placeholder: '搜索会话…',
                value: query,
                onChange: (event) => setQuery(event.target.value),
              }),
            ),
            h(
              'div',
              { className: 'dm-rail-list' },
              shownSessions.length === 0
                ? h('div', { className: 'dm-rail-empty' }, keyword ? '没有匹配的会话' : '还没有会话')
                : shownSessions.map((row) =>
                    h(RailItem, {
                      key: row.id,
                      row,
                      active: row.id === state.activeId,
                      busy: state.busy,
                      unread: row.id === state.activeId ? 0 : Math.max(0, (row.count || 0) - (state.seen?.[row.id] || 0)),
                      onOpen: () => {
                        if (!state.busyRef.current || row.id === state.activeRef.current) {
                          state.openSession(row.id)
                          setPanel('')
                        }
                      },
                      onRename: (title) => state.renameSession(row.id, title),
                      onRemove: () => state.removeSession(row.id),
                    }),
                  ),
            ),
            h('button', { className: 'dm-rail-new', onClick: () => state.createSession(), disabled: state.busy }, '+ 新建会话'),
          ),
          h(
            'div',
            { className: 'dm-main' },
            /* 聊天头：QQ 的会话标题 */
            h(
              'div',
              { className: 'dm-chathead' },
              h('div', { className: 'dm-chathead-main' },
                h('div', { className: 'dm-chathead-title' }, activeTitle),
                h('div', { className: 'dm-chathead-sub' },
                  h(Icon, { name: 'chat' }),
                  state.busy ? '正在输入…' : '在线，边摸鱼边等你',
                  h('span', { className: 'dm-sep' }),
                  h('span', null, busyText),
                ),
              ),
            ),
            h(
              MessageViewport,
              { sessionId: state.activeId, jump: state.scrollRequest },
              hasMessages
                ? state.messages.map((row, index) => {
                    const prev = state.messages[index - 1]
                    const gap = row.at && prev?.at ? row.at - prev.at : 0
                    return h(
                      React.Fragment,
                      { key: row.id || index },
                      gap > 5 * 60 * 1000 ? h('div', { className: 'dm-timediv' }, fmtTime(row.at)) : null,
                      h(Bubble, {
                        row,
                        onMenu: (event, target) => setMenu({ x: event.clientX, y: event.clientY, row: target }),
                        onShot: (url) => setLightbox(url),
                      }),
                    )
                  })
                : h(
                    'div',
                    { className: 'dm-empty' },
                    h(Avatar, { className: 'dm-hero' }),
                    h('h2', null, '在的，随便说点什么'),
                    h('p', null, '不用挑格式，也不用先选模式——是闲聊还是要干活，我自己在本鲸底下判断。'),
                    h('div', { className: 'dm-cards-label' }, '试试这些'),
                    h(
                      'div',
                      { className: 'dm-cards' },
                      SUGGESTIONS.map((text) =>
                        h(
                          'div',
                          {
                            key: text,
                            className: 'dm-card',
                            onClick: () => state.setDraft(text),
                          },
                          h('div', { className: 'dm-card-text' }, text),
                        ),
                      ),
                    ),
                    h('div', { className: 'dm-empty-hint' }, '也可以直接贴一段报错、一个链接，或者一句「帮我发条小红书」'),
                  ),
            ),
            h(FileStrip, { state, onMore: () => openPanel('memory', 'files') }),
            /* 输入区 */
            h(
              'div',
              { className: 'dm-composer' },
              h(
                'div',
                { className: 'dm-inputwrap' },
                h('input', {
                  ref: fileRef,
                  type: 'file',
                  multiple: true,
                  style: { display: 'none' },
                  onChange: (event) => {
                    takeFiles(event.target.files)
                    event.target.value = ''
                  },
                }),
                h('textarea', {
                  className: 'dm-input',
                  placeholder: '想到什么说什么——扯两句、让我去办事、或者问本鲸吃了几个白饭',
                  value: state.draft,
                  rows: 2,
                  onChange: (event) => state.setDraft(event.target.value),
                  onKeyDown,
                }),
                h(Toolbar, {
                  busy: uploading,
                  onHint: (text) => state.setNotice(text),
                  onPick: () => fileRef.current?.click(),
                }),
                h(
                  'div',
                  { className: 'dm-inputfoot' },
                  h('span', { className: 'dm-input-hint' }, busyText),
                  h('div', { className: 'dm-spacer' }),
                  state.busy
                    ? h('button', { className: 'dm-send dm-send-stop', onClick: state.stop }, '停止')
                    : h('button', { className: 'dm-send', onClick: () => state.send(), disabled: !state.draft.trim() }, '发送'),
                ),
              ),
            ),
          ),
        ),
        dragging ? h('div', { className: 'dm-drop' }, '松手，文件会收进她的收件箱') : null,
        menu
          ? h(
              'div',
              {
                className: 'dm-menu',
                style: {
                  left: Math.min(menu.x, (window.innerWidth || 1200) - 170),
                  top: Math.min(menu.y, (window.innerHeight || 800) - 130),
                },
                onMouseDown: (event) => event.stopPropagation(),
              },
              h('button', {
                className: 'dm-menu-item',
                onMouseDown: () => {
                  try {
                    navigator.clipboard.writeText(cleanText(menu.row.text))
                  } catch {
                    // 剪贴板被拒就算了
                  }
                  setMenu(null)
                },
              }, '复制'),
              h('button', {
                className: 'dm-menu-item',
                onMouseDown: () => {
                  const quoted = cleanText(menu.row.text)
                    .slice(0, 300)
                    .split('\n')
                    .map((line) => `> ${line}`)
                    .join('\n')
                  state.setDraft(`${quoted}\n\n${state.draft}`)
                  setMenu(null)
                },
              }, '引用到输入框'),
              h('button', {
                className: 'dm-menu-item',
                onMouseDown: () => {
                  state.setDraft(cleanText(menu.row.text))
                  setMenu(null)
                },
              }, '取回这句重发'),
              h('button', {
                className: 'dm-menu-item dm-menu-danger',
                onMouseDown: () => {
                  state.removeMessage(menu.row.id)
                  setMenu(null)
                },
              }, '删除这条'),
            )
          : null,
        panel === 'persona' ? h(PersonaDrawer, { persona: state.persona, presets: state.presets, onSave: state.savePersona, onClose: close, setup: state.setup, onSetup: state.saveSetup }) : null,
        panel === 'login' ? h(LoginPanel, { onClose: close }) : null,
        panel === 'memory' ? h(MemoryDrawer, { state, onClose: close, startTab: memTab, onPick: () => fileRef.current?.click() }) : null,
        panel === 'components' ? h(ComponentsPanel, { onClose: close }) : null,
        panel === 'qq' ? h(QQPanel, { state, onClose: close }) : null,
        panel === 'footprint' ? h(Drawer, { title: '足迹', onClose: close }, h(Footprint, { profile: state.profile })) : null,
        panel === 'tokens' ? h(TokenDrawer, { stats: state.tokenStats, onClose: close }) : null,
        lightbox ? h(Lightbox, { url: lightbox, onClose: () => setLightbox(null) }) : null,
        // 首次初始化向导：没跑过就盖在最上层。先给大肥鱼定个初始性格（只这一次），选完即锁定；
        // 之后它从聊天 / 学习 / 网上冲浪长成「自由卡」，不能再改。
        // saveSetup 会更新 state.setup，触发重渲染自动收起向导。
        // 首次初始化向导：只有后端明确说 done===false 才弹；未知（null/加载中）不弹。
        state.setup && state.setup.done === false
          ? h(SetupWizard, {
              state,
              onPick: async (choice) => {
                if (choice && choice.preset) await state.savePersona({ preset: choice.preset })
                await state.saveSetup('growth')
              },
            })
          : null,
      )
    }

    /* ------------------------------------------------- 首次初始化向导 */
    function SetupWizard(props) {
      const { state, onPick } = props
      const [screen, setScreen] = useState(0)
      const [busy, setBusy] = useState(false)
      const choose = async (choice) => {
        setBusy(true)
        try {
          await onPick(choice)
        } finally {
          setBusy(false)
        }
      }
      if (screen === 0) {
        return h(
          'div',
          { className: 'dm-setup' },
          h(
            'div',
            { className: 'dm-setup-card' },
            h(
              'div',
              { className: 'dm-setup-logo' },
              h(Avatar, { className: 'dm-logo' }),
              h(
                'div',
                null,
                h('div', { className: 'dm-setup-title' }, '大肥鱼 · 初次启动'),
                h('div', { className: 'dm-setup-sub' }, '一条陪你闲聊、随性自在的私人鱼'),
              ),
            ),
            h('div', { className: 'dm-setup-p' }, '大肥鱼能陪你做这些，先用两分钟过一遍：'),
            h(
              'ul',
              { className: 'dm-setup-ul' },
              h('li', null, '闲聊陪聊：像熟人一样自然回话，不塞知识点、不布置作业'),
              h('li', null, '记忆 & 日记：记住你说过的事，也会自己写日记复盘'),
              h('li', null, '天气 / 文件：本地数据随问随答，文档能收能发'),
              h('li', null, 'QQ 说说：它按心情时不时自己发一条碎碎念'),
              h('li', null, '平台接管 & 扫码登录：抖音 / B站 / 小红书内容能抓、能扫码进'),
            ),
            h(
              'div',
              { className: 'dm-setup-foot' },
              h(
                'button',
                { className: 'dm-setup-next', onClick: () => setScreen(1) },
                '开始设置',
              ),
              h('div', { className: 'dm-setup-steps' }, h('i', { className: 'dm-setup-dot on' }), h('i', { className: 'dm-setup-dot' })),
            ),
          ),
        )
      }
      const presets = (state.presets || []).filter((p) => p.id !== 'custom')
      return h(
        'div',
        { className: 'dm-setup' },
        h(
          'div',
          { className: 'dm-setup-card' },
          h('div', { className: 'dm-setup-h' }, '大肥鱼一开始是什么样？'),
          h(
            'div',
            { className: 'dm-setup-p' },
            '只这一次能定它的初始性格——之后它会从你们的聊天、一起学习、网上冲浪里自己长成一张「自由卡」，那时就不能再改了。先把底子定个调子，或者先不定，让它自己长。',
          ),
          h(
            'div',
            { className: 'dm-setup-opts' },
            ...presets.map((p) =>
              h(
                'div',
                { key: p.id, className: 'dm-setup-opt', onClick: () => choose({ preset: p.id }) },
                h('div', { className: 'dm-setup-opt-name' }, p.label),
                h('div', { className: 'dm-setup-opt-desc' }, p.hint),
              ),
            ),
            h(
              'div',
              { key: 'skip', className: 'dm-setup-opt', onClick: () => choose({ preset: null }) },
              h('div', { className: 'dm-setup-opt-name' }, '先不定，让它自己长'),
              h('div', { className: 'dm-setup-opt-desc' }, '完全从零开始，初始就是出厂默认，全交给「自由卡」长出来。'),
            ),
          ),
          h(
            'div',
            { className: 'dm-setup-foot' },
            h('button', { className: 'dm-setup-skip', onClick: () => choose({ preset: null }), disabled: busy }, '跳过，直接进'),
            h('div', { className: 'dm-setup-steps' }, h('i', { className: 'dm-setup-dot' }), h('i', { className: 'dm-setup-dot on' })),
          ),
        ),
      )
    }

    function MentorPage() {
      const state = useMentor()
      useEffect(() => {
        beat({ event: 'page-mount' })
      }, [])
      return h('div', { className: 'dm-page dm-shell' }, h(Stage, { state, variant: 'page' }))
    }

    function MentorOverlay() {
      const [open, setOpen] = useState(false)
      const state = useMentor()
      const openRef = useRef(false)
      openRef.current = open

      useEffect(() => {
        const onKey = (event) => {
          if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'M' || event.key === 'm')) {
            event.preventDefault()
            setOpen((v) => !v)
            beat({ event: 'hotkey' })
          } else if (event.key === 'Escape' && openRef.current) {
            setOpen(false)
          }
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
      }, [])

      if (!open) return null
      return h(
        'div',
        {
          className: 'dm-backdrop dm-shell',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) setOpen(false)
          },
        },
        h(
          'div',
          { onMouseDown: (event) => event.stopPropagation(), style: { width: '100%', height: '100%', display: 'flex' } },
          h(Stage, { state, variant: 'overlay', onClose: () => setOpen(false) }),
        ),
      )
    }

    function PanelIcon() {
      return h(Avatar, { className: 'dm-panicon', title: TITLE })
    }

    /* ------------------------------------------------------------------ 注册 */

    function apply(ctx) {
      try {
        ensureStyle()
        hookErrors()
        beat({ event: 'apply', slots: typeof ctx.slots?.register })
        // 左侧栏页面：和「自动化任务」等页面按钮并排。
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, MentorPage))
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: TITLE }, PanelIcon),
        )
        // 同一个界面的浮窗版，留给 Ctrl+Shift+M。
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'dsh-mentor-float', label: TITLE }, MentorOverlay),
        )
        beat({ event: 'registered', v: CLIENT_VERSION, main: true, panellist: true, overlay: true })
      } catch (error) {
        beat({ event: 'apply-error', message: String(error?.message || error) })
        throw error
      }
    }

    exports.name = 'dsh-mentor'
    exports.inject = ['slots']
    exports.apply = apply
    // 设计预览用：tools/preview.mjs 拿它把窗口渲染成静态页再截图，不用开 GUI。
    exports.__design = { Stage, Bubble, MentorPage, MessageViewport, TokenDrawer, MODE_META, CSS, Drawer, PersonaDrawer, MemoryDrawer, QQPanel, ComponentsPanel, LoginPanel, Footprint, FileStrip, FilesTab, PERSONA_SCHEMA, DIM_IDS }
    return module.exports
  },
})

/* ================= ПУБЛИКАЦИИ: HTML-заготовки (пресс-релизы, газеты, статьи, эфиры, анонсы…) =================
   Хранятся в проекте аккаунта (project.docs). Показываются в песочнице-iframe (скрипты внутри не выполняются),
   правятся прямо «глазами»: текст, картинки, стили выбранного элемента, поля шаблона, блоки, код. */
const Docs = (() => {
  const KINDS = { press:'Пресс-релиз', paper:'Газета', article:'Статья', live:'Эфир', announce:'Анонс', other:'Другое' };
  const BGS = { grey:'#e4e8ef', white:'#ffffff', dark:'#16181d' };
  const U = {                                       // небольшие помощники (общие функции приложения берём из глобальной области)
    esc: s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c])),
  };
  let list = [], cur = null, mode = 'visual', pageBg = 'grey', pageW = 'auto', filter = 'all', ready = false;
  let ifr = null, idoc = null, selEl = null, hist = [], hpos = -1, histT = null, rendering = false, uiTab = 'fields';
  const $d = id => document.getElementById(id);

  /* ---------- санитайзер и разбор вставленного HTML ---------- */
  function sanitizeTree(root) {
    root.querySelectorAll('script,iframe,frame,frameset,object,embed,applet,base,meta,link,noscript,form,input,button,textarea,select').forEach(n => n.remove());
    root.querySelectorAll('*').forEach(el => {
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase(), v = a.value.trim().toLowerCase().replace(/[\s\u0000-\u001f]+/g, '');
        if (n.startsWith('on') || n === 'srcdoc' || n === 'contenteditable') el.removeAttribute(a.name);
        else if (/^(href|src|xlink:href|action|formaction|poster|background)$/.test(n) && /^(javascript|vbscript):/.test(v)) el.removeAttribute(a.name);
        else if (/^data:(?!image\/(png|jpe?g|gif|webp|bmp|avif))/.test(v) && /^(href|src)$/.test(n)) el.removeAttribute(a.name);
        else if (n === 'style' && /(expression\(|javascript:|behavior:|-moz-binding)/i.test(a.value)) el.removeAttribute(a.name);
      }
    });
    return root;
  }
  function parseSource(src) {
    const d = new DOMParser().parseFromString(src, 'text/html');
    const styles = [...d.head.querySelectorAll('style')].map(s => s.outerHTML).join('\n');
    const wrap = d.createElement('div');
    wrap.innerHTML = d.body.innerHTML;
    sanitizeTree(wrap);
    const html = ((styles ? sanitizeStyleBlocks(styles) + '\n' : '') + wrap.innerHTML).trim();
    return html;
  }
  const sanitizeStyleBlocks = css => css.replace(/@import[^;]*;?/gi, '').replace(/expression\([^)]*\)/gi, '').replace(/javascript:/gi, '');
  function guessMeta(src) {
    const m = src.match(/<!--([\s\S]*?)-->/);
    const head = (m ? m[1] : '').replace(/[=\-]{3,}/g, ' ');
    const blob = (head + ' ' + src.slice(0, 6000)).toLowerCase();
    let kind = 'other';
    if (/пресс[- ]?релиз|press release|newsroom/.test(blob)) kind = 'press';
    else if (/газет|broadsheet|folio|newspaper|вестник/.test(blob)) kind = 'paper';
    else if (/эфир|broadcast|\blive\b|радио|телеэфир/.test(blob)) kind = 'live';
    else if (/анонс|announce/.test(blob)) kind = 'announce';
    else if (/стать[яи]|article|репортаж/.test(blob)) kind = 'article';
    let title = '';
    const h = src.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (m) { const line = head.split('\n').map(s => s.trim()).find(s => /template|шаблон|release|broadsheet/i.test(s)); if (line) title = line.replace(/\s+/g, ' ').slice(0, 80); }
    if (!title && h) title = h[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    return { kind, title: title || 'Новая публикация' };
  }

  /* ---------- служебное: документ iframe ---------- */
  const PH_RE = /[A-ZА-ЯЁ][A-ZА-ЯЁ0-9]*(?:_[A-ZА-ЯЁ0-9]+)+/g;
  function frameCss() {
    const bg = BGS[pageBg], fg = pageBg === 'dark' ? '#e8ebf3' : '#1a1f2c';
    return `html{background:${bg}}body{margin:0;padding:${pageW === 'auto' ? '12px' : '12px'};background:${bg};color:${fg};${pageW === 'auto' ? '' : `width:${pageW}px;margin:0 auto;`}word-wrap:break-word}
      img{max-width:100%}
      [data-ce-sel]{outline:2px solid #5b8cff!important;outline-offset:2px!important;cursor:default}
      [data-ce-sel]::selection,[data-ce-sel] *::selection{background:rgba(91,140,255,.35)}
      ::highlight(ce-ph){background:#ffe36b;color:#222}
      body[data-ce-mode="view"]{cursor:auto}
      img.ce-drop{outline:3px dashed #5b8cff}
      img[src]:not([src^="/"]):not([src^="http"]):not([src^="data:"]):not([src^="blob:"]){display:block;min-height:120px;min-width:160px;background:repeating-linear-gradient(45deg,#cfd6e2 0 10px,#dde3ec 10px 20px);outline:2px dashed #8896ad;outline-offset:-2px;color:#51607a;font:13px system-ui,sans-serif;text-align:center}`;
  }
  function buildFrame(editable) {
    return `<!doctype html><html><head><meta charset="utf-8"><style id="ce-frame">${frameCss()}</style></head><body${editable ? ' contenteditable="true" spellcheck="false"' : ''} data-ce-mode="${editable ? 'edit' : 'view'}">${cur.html}</body></html>`;
  }
  function serialize() {
    if (!idoc || !idoc.body) return cur ? cur.html : '';
    const c = idoc.body.cloneNode(true);
    c.querySelectorAll('[data-ce-sel]').forEach(e => e.removeAttribute('data-ce-sel'));
    c.querySelectorAll('[contenteditable]').forEach(e => e.removeAttribute('contenteditable'));
    c.querySelectorAll('[class=""]').forEach(e => e.removeAttribute('class'));
    return c.innerHTML.trim();
  }
  const imgIdOf = url => { const m = /\/api\/images\/([A-Za-z0-9_-]{8,64})/.exec(url || ''); return m ? m[1] : null; };
  const usedImageIds = () => { const s = new Set(); for (const d of list) for (const m of d.html.matchAll(/\/api\/images\/([A-Za-z0-9_-]{8,64})/g)) s.add(m[1]); return s; };

  /* ---------- сохранение ---------- */
  function touch() { if (!cur) return; cur.html = serialize(); cur.t = Date.now(); renderList(); renderFields(); if (save) save(); }
  function commitCode(html) { cur.html = html; cur.t = Date.now(); if (save) save(); }

  /* ---------- история правок (собственная: браузерная не видит программные изменения) ---------- */
  function pushHist(force) {
    if (!idoc || rendering) return;
    const s = serialize(); if (hist[hpos] === s && !force) return;
    hist = hist.slice(0, hpos + 1); hist.push(s); if (hist.length > 120) hist.shift(); hpos = hist.length - 1; updUndo();
  }
  function snap() { clearTimeout(histT); pushHist(); touch(); }
  function typed() { clearTimeout(histT); histT = setTimeout(snap, 450); }
  function restore(i) {
    if (i < 0 || i >= hist.length) return; hpos = i; rendering = true;
    idoc.body.innerHTML = hist[i]; selEl = null; rendering = false; bindImages(); touch(); updUndo(); renderProps(); hilitePh();
  }
  function updUndo() { $d('dcUndo').disabled = hpos <= 0; $d('dcRedo').disabled = hpos >= hist.length - 1; }

  /* ---------- список слева ---------- */
  function fmtDate(t) { try { return new Date(t).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); } catch { return ''; } }
  function renderList() {
    const box = $d('dcList'); const q = ($d('dcSearch').value || '').trim().toLowerCase();
    const items = list.filter(d => (filter === 'all' || d.kind === filter) && (!q || d.title.toLowerCase().includes(q)));
    box.innerHTML = '';
    for (const d of items) {
      const el = document.createElement('div'); el.className = 'dcard' + (cur && d.id === cur.id ? ' active' : '');
      el.innerHTML = `<div class="dk">${U.esc(KINDS[d.kind] || 'Другое')}</div><div class="dt ellipsis">${U.esc(d.title)}</div><div class="dm muted">${fmtDate(d.t)}</div>`;
      el.onclick = () => open(d.id);
      const x = document.createElement('div'); x.className = 'dacts';
      const mk = (t, title, fn, cls) => { const b = document.createElement('button'); b.className = 'sm' + (cls ? ' ' + cls : ''); b.textContent = t; b.title = title; b.onclick = e => { e.stopPropagation(); fn(); }; x.appendChild(b); };
      mk('⧉', 'Дублировать', () => dup(d)); mk('✕', 'Удалить', () => del(d), 'x');
      el.appendChild(x); box.appendChild(el);
    }
    if (!items.length) box.innerHTML = `<div class="hint" style="padding:14px">${list.length ? 'Ничего не найдено.' : 'Здесь пока пусто. Нажмите «Вставить HTML» и вставьте свою заготовку — пресс-релиз, газету, статью, анонс…'}</div>`;
    const cnt = { all: list.length }; for (const k in KINDS) cnt[k] = list.filter(d => d.kind === k).length;
    document.querySelectorAll('#dcKinds [data-k]').forEach(b => { b.classList.toggle('active', b.dataset.k === filter); b.querySelector('i').textContent = cnt[b.dataset.k] || 0; });
  }
  function newId() { return (uid ? uid() : Date.now().toString(36) + Math.random().toString(36).slice(2)); }
  function dup(d) { const n = { ...d, id: newId(), title: d.title + ' (копия)', t: Date.now() }; list.unshift(n); renderList(); open(n.id); if (save) save(true); }
  function del(d) {
    if (!confirm(`Удалить публикацию «${d.title}»?`)) return;
    list = list.filter(x => x !== d); if (cur === d) { cur = null; showCur(); } renderList(); if (save) save(true);
  }

  /* ---------- открыть публикацию ---------- */
  function open(id) {
    if (cur && idoc && mode === 'visual') cur.html = serialize();
    cur = list.find(d => d.id === id) || null; selEl = null; showCur(); renderList();
    try { localStorage.setItem('ceDoc', cur ? cur.id : ''); } catch {}
  }
  function showCur() {
    const has = !!cur;
    $d('dcEmpty').style.display = has ? 'none' : 'flex';
    $d('dcWork').style.display = has ? 'grid' : 'none';
    $d('dcRight').style.visibility = has ? 'visible' : 'hidden';
    if (!has) { idoc = null; return; }
    $d('dcTitle').value = cur.title; $d('dcKind').value = cur.kind;
    setMode(mode === 'code' ? 'code' : 'visual', true);
  }
  function setMode(m, force) {
    if (!cur) return;
    if (mode === 'code' && m !== 'code' && !force) { /* код → применить */ cur.html = parseSource($d('dcCode').value); }
    if (mode === 'visual' && m === 'code' && idoc && !force) cur.html = serialize();
    mode = m;
    document.querySelectorAll('#dcModes [data-m]').forEach(b => b.classList.toggle('active', b.dataset.m === m));
    $d('dcFrameBox').style.display = m === 'code' ? 'none' : 'block';
    $d('dcCodeBox').style.display = m === 'code' ? 'flex' : 'none';
    $d('dcFmt').style.visibility = m === 'visual' ? 'visible' : 'hidden';
    if (m === 'code') { $d('dcCode').value = cur.html; idoc = null; }
    else loadFrame(m === 'visual');
    renderFields(); renderProps();
  }
  function loadFrame(editable) {
    // новый iframe на каждый показ: так нет «хвостов» от прошлых слушателей и документов
    const box = $d('dcFrameBox'); box.innerHTML = '';
    ifr = document.createElement('iframe'); ifr.setAttribute('sandbox', 'allow-same-origin'); ifr.title = 'Публикация';
    ifr.style.cssText = 'width:100%;height:100%;border:0;display:block;background:transparent';
    rendering = true; ifr.srcdoc = buildFrame(editable);
    ifr.onload = () => {
      idoc = ifr.contentDocument; rendering = false; hist = []; hpos = -1; selEl = null;
      if (editable) wireEditor(); else wireView();
      pushHist(true); bindImages(); hilitePh(); renderFields(); renderProps();
    };
    box.appendChild(ifr);
  }
  function wireView() { idoc.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a'); if (a) e.preventDefault(); }); }

  /* ---------- «глазами»: редактирование внутри iframe ---------- */
  function wireEditor() {
    idoc.addEventListener('input', typed);
    idoc.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('a'); if (a) e.preventDefault();
      pick(e.target === idoc.body || e.target === idoc.documentElement ? null : e.target);
    });
    idoc.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); clearTimeout(histT); pushHist(); restore(e.shiftKey ? hpos + 1 : hpos - 1); }
      else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); restore(hpos + 1); }
      else if (e.key === 'Escape') pick(null);
      else if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(k)) { setTimeout(snap, 0); }
    });
    idoc.addEventListener('paste', async e => {
      const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
      e.preventDefault();
      if (files.length) { await insertImages(files); return; }
      const t = e.clipboardData?.getData('text/plain') || '';
      if (t) idoc.execCommand('insertText', false, t);            // чистая вставка: без «мусорных» стилей чужих сайтов
    });
    idoc.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); const im = e.target.closest && e.target.closest('img'); idoc.querySelectorAll('.ce-drop').forEach(x => x !== im && x.classList.remove('ce-drop')); if (im) im.classList.add('ce-drop'); } });
    idoc.addEventListener('drop', async e => {
      const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/')); if (!files.length) return;
      e.preventDefault(); e.stopPropagation();
      const im = e.target.closest && e.target.closest('img'); idoc.querySelectorAll('.ce-drop').forEach(x => x.classList.remove('ce-drop'));
      if (im) { await replaceImage(im, files[0]); } else { const r = idoc.caretRangeFromPoint?.(e.clientX, e.clientY); if (r) { const s = idoc.getSelection(); s.removeAllRanges(); s.addRange(r); } await insertImages(files); }
    });
    idoc.addEventListener('dragleave', () => idoc.querySelectorAll('.ce-drop').forEach(x => x.classList.remove('ce-drop')));
    idoc.addEventListener('selectionchange', () => { if (document.activeElement === ifr) updFmtState(); });
  }
  function pick(el) {
    if (selEl && selEl.removeAttribute) selEl.removeAttribute('data-ce-sel');
    selEl = el && el.nodeType === 1 ? el : null;
    if (selEl) selEl.setAttribute('data-ce-sel', '');
    if (selEl && uiTab === 'fields') setTab('el', true);
    renderProps();
  }

  /* ---------- панель форматирования ---------- */
  const exec = (cmd, val, css) => { if (mode !== 'visual' || !idoc) return; ifr.contentWindow.focus(); idoc.execCommand('styleWithCSS', false, !!css); idoc.execCommand(cmd, false, val); snap(); updFmtState(); };
  function updFmtState() {
    if (!idoc) return;
    for (const [id, c] of [['dcB', 'bold'], ['dcI', 'italic'], ['dcU', 'underline'], ['dcS', 'strikeThrough']]) { try { $d(id).classList.toggle('on', idoc.queryCommandState(c)); } catch {} }
  }
  function wireFmt() {
    const bind = (id, fn) => { const b = $d(id); b.onmousedown = e => e.preventDefault(); b.onclick = fn; };      // mousedown не крадёт выделение у iframe
    bind('dcB', () => exec('bold')); bind('dcI', () => exec('italic')); bind('dcU', () => exec('underline')); bind('dcS', () => exec('strikeThrough'));
    bind('dcAL', () => exec('justifyLeft')); bind('dcAC', () => exec('justifyCenter')); bind('dcAR', () => exec('justifyRight')); bind('dcAJ', () => exec('justifyFull'));
    bind('dcUL', () => exec('insertUnorderedList')); bind('dcOL', () => exec('insertOrderedList'));
    bind('dcClr', () => { exec('removeFormat'); });
    bind('dcLink', () => {
      const sel = idoc?.getSelection(); const a = sel && sel.anchorNode && (sel.anchorNode.parentElement || sel.anchorNode).closest?.('a');
      const url = prompt('Адрес ссылки (пусто — убрать ссылку):', a ? a.getAttribute('href') : 'https://');
      if (url === null) return;
      if (!url.trim()) exec('unlink'); else exec('createLink', /^(https?:|mailto:|#|\/)/i.test(url.trim()) ? url.trim() : 'https://' + url.trim());
    });
    $d('dcFg').oninput = e => exec('foreColor', e.target.value, true);
    $d('dcHl').oninput = e => exec('hiliteColor', e.target.value, true);
    $d('dcSize').onchange = e => { if (!e.target.value) return; ifr.contentWindow.focus(); idoc.execCommand('styleWithCSS', false, true); idoc.execCommand('fontSize', false, '7'); idoc.querySelectorAll('font[size="7"]').forEach(f => { f.removeAttribute('size'); f.style.fontSize = e.target.value + 'px'; }); idoc.querySelectorAll('span[style*="xxx-large"]').forEach(f => { f.style.fontSize = e.target.value + 'px'; }); e.target.value = ''; snap(); };
    $d('dcUndo').onclick = () => { clearTimeout(histT); pushHist(); restore(hpos - 1); };
    $d('dcRedo').onclick = () => restore(hpos + 1);
  }

  /* ---------- картинки ---------- */
  async function uploadFile(file) {
    if (!/^image\//.test(file.type)) throw new Error('Это не изображение');
    const id = await putImage(file); return '/api/images/' + id;
  }
  function imgDefaults(img) { img.style.maxWidth = '100%'; img.style.height = 'auto'; img.style.display = 'block'; }
  async function insertImages(files) {
    for (const f of files) {
      try {
        const url = await uploadFile(f);
        const sel = idoc.getSelection(); const html = `<img src="${url}" alt="" style="max-width:100%;height:auto;display:block;margin:8px 0">`;
        if (sel && sel.rangeCount && idoc.body.contains(sel.anchorNode)) idoc.execCommand('insertHTML', false, html);
        else idoc.body.insertAdjacentHTML('beforeend', html);
      } catch (e) { alert('Не удалось добавить изображение: ' + e.message); }
    }
    bindImages(); snap();
  }
  async function replaceImage(img, file) {
    try { img.setAttribute('src', await uploadFile(file)); img.removeAttribute('srcset'); snap(); renderProps(); } catch (e) { alert('Не удалось заменить изображение: ' + e.message); }
  }
  function bindImages() {
    if (!idoc) return;
    idoc.querySelectorAll('img').forEach(im => { im.draggable = false; });
  }
  function pickFile(cb) { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = () => i.files[0] && cb(i.files[0]); i.click(); }

  /* ---------- поля шаблона (заглушки ВИДА_ТАКОГО) ---------- */
  function findPlaceholders(root) {
    const out = new Map();                                    // токен -> { text:n, attrs:Set(имя) }
    const add = (t, kind) => { for (const m of t.matchAll(PH_RE)) { const o = out.get(m[0]) || { n:0, attrs:new Set(), img:false }; o.n++; if (kind) o.attrs.add(kind); out.set(m[0], o); } };
    const w = (root.ownerDocument || root).createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n; while ((n = w.nextNode())) {
      if (n.nodeType === 3) { if (!n.parentElement || !/^(STYLE|SCRIPT)$/.test(n.parentElement.tagName)) add(n.nodeValue, ''); }
      else for (const a of ['src', 'href', 'alt', 'title']) { const v = n.getAttribute(a); if (v) add(v, a); }
    }
    return out;
  }
  function currentRoot() {
    if (idoc && mode === 'visual') return idoc.body;
    const d = document.implementation.createHTMLDocument(''); d.body.innerHTML = cur ? cur.html : ''; return d.body;
  }
  function prettyToken(t) { return t.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase()); }
  function renderFields() {
    const box = $d('dcFieldList'); if (!box) return; box.innerHTML = '';
    if (!cur) return;
    const root = currentRoot(), map = findPlaceholders(root);
    $d('dcFieldCount').textContent = map.size ? map.size : '';
    if (!map.size) { box.innerHTML = '<div class="hint">Заглушек вида <code>ДАТА_ПУБЛИКАЦИИ</code> или <code>URL_СКРИНШОТА</code> в тексте нет — шаблон уже заполнен.</div>'; return; }
    const isImg = (tok, o) => o.attrs.has('src') || /^URL_|СКРИНШОТ|ФОТО|IMG|IMAGE/.test(tok);
    for (const [tok, o] of map) {
      const row = document.createElement('div'); row.className = 'fld';
      const img = o.attrs.has('src');
      row.innerHTML = `<label title="${U.esc(tok)}">${U.esc(prettyToken(tok))} <span class="muted">· ${o.n}×</span></label><div class="frow"><input type="text" placeholder="${img ? 'Ссылка на картинку…' : 'Текст вместо «' + U.esc(tok) + '»'}"><button class="sm" data-a="ok" title="Подставить (Enter)">OK</button>${img ? '<button class="sm" data-a="up" title="Загрузить файл с компьютера">⬆</button>' : ''}<button class="sm" data-a="go" title="Показать в документе">◎</button></div>`;
      const inp = row.querySelector('input');
      const apply = () => { if (inp.value.trim() === '') return; replaceToken(tok, inp.value); };
      inp.onkeydown = e => { if (e.key === 'Enter') apply(); };
      row.querySelector('[data-a=ok]').onclick = apply;
      const up = row.querySelector('[data-a=up]'); if (up) up.onclick = () => pickFile(async f => { try { replaceToken(tok, await uploadFile(f)); } catch (e) { alert(e.message); } });
      row.querySelector('[data-a=go]').onclick = () => goToken(tok);
      box.appendChild(row);
    }
  }
  function replaceToken(tok, val) {
    if (!idoc || mode !== 'visual') { cur.html = cur.html.split(tok).join(val.replace(/[&<>]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[c]))); renderFields(); commitCode(cur.html); return; }
    const w = idoc.createTreeWalker(idoc.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT); let n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) { if (n.nodeValue.includes(tok) && !/^(STYLE|SCRIPT)$/.test(n.parentElement.tagName)) n.nodeValue = n.nodeValue.split(tok).join(val); }
      else for (const a of ['src', 'href', 'alt', 'title']) { const v = n.getAttribute(a); if (v && v.includes(tok)) n.setAttribute(a, v.split(tok).join(val)); }
    }
    snap(); hilitePh(); renderFields();
  }
  function goToken(tok) {
    if (!idoc) return;
    const w = idoc.createTreeWalker(idoc.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT); let n;
    while ((n = w.nextNode())) {
      const el = n.nodeType === 3 ? ((n.nodeValue.includes(tok)) ? n.parentElement : null) : (['src', 'href', 'alt', 'title'].some(a => (n.getAttribute(a) || '').includes(tok)) ? n : null);
      if (el) { el.scrollIntoView({ block:'center', behavior:'smooth' }); pick(el); return; }
    }
  }
  function hilitePh() {                                      // подсветка заглушек: через CSS Custom Highlight API, документ не трогаем
    try {
      const win = ifr && ifr.contentWindow; if (!win || !win.CSS || !win.CSS.highlights || !win.Highlight || !idoc) return;
      const ranges = [], w = idoc.createTreeWalker(idoc.body, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) { for (const m of n.nodeValue.matchAll(PH_RE)) { const r = idoc.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length); ranges.push(r); } }
      win.CSS.highlights.set('ce-ph', new win.Highlight(...ranges));
    } catch {}
  }

  /* ---------- свойства выбранного элемента ---------- */
  const PX = v => { const n = parseFloat(v); return isNaN(n) ? '' : Math.round(n * 10) / 10; };
  function rgb2hex(c) {
    const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/.exec(c || ''); if (!m || (m[4] !== undefined && +m[4] === 0)) return '';
    return '#' + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join('');
  }
  const STYLE_FIELDS = [   // [id поля, css-свойство, тип]
    ['color', 'color', 'color', 'Цвет текста'], ['bg', 'background-color', 'color', 'Фон'],
    ['fs', 'font-size', 'px', 'Размер, px'], ['lh', 'line-height', 'num', 'Интервал'],
    ['ls', 'letter-spacing', 'px', 'Разрядка, px'], ['pad', 'padding', 'px', 'Отступ внутри, px'],
    ['mar', 'margin', 'px', 'Отступ снаружи, px'], ['rad', 'border-radius', 'px', 'Скругление, px'],
    ['bw', 'border-width', 'px', 'Рамка, px'], ['bc', 'border-color', 'color', 'Цвет рамки'],
    ['wid', 'width', 'any', 'Ширина'], ['mw', 'max-width', 'any', 'Макс. ширина'], ['op', 'opacity', 'num', 'Прозрачность 0–1'],
  ];
  function pathOf(el) { const out = []; for (let n = el; n && n !== idoc.body && n.nodeType === 1; n = n.parentElement) out.unshift(n); return out; }
  function renderProps() {
    const box = $d('dcElBox'); if (!box) return; box.innerHTML = '';
    if (mode !== 'visual' || !idoc) { box.innerHTML = '<div class="hint">Переключитесь на «Визуально» — там можно кликать по элементам и менять их.</div>'; return; }
    if (!selEl || !idoc.body.contains(selEl)) { selEl = null; box.innerHTML = '<div class="hint">Кликните по любому элементу в документе: тексту, картинке, блоку, ячейке. Здесь появятся его настройки. Текст правится прямо в документе.</div>' + blocksHtml(); wireBlocks(box); return; }
    const el = selEl, cs = idoc.defaultView.getComputedStyle(el), tag = el.tagName.toLowerCase();
    const crumbs = pathOf(el).map((n, i, a) => `<a href="#" data-i="${i}" class="${n === el ? 'cur' : ''}">${n.tagName.toLowerCase()}</a>`).join('<span>›</span>');
    let h = `<div class="crumbs">${crumbs}</div>`;
    h += '<div class="bar" style="margin:6px 0 10px"><button class="sm" id="peUp" title="Выбрать родителя">↑ Родитель</button><button class="sm" id="peDup" title="Дублировать">⧉</button><button class="sm" id="peMU" title="Выше">▲</button><button class="sm" id="peMD" title="Ниже">▼</button><button class="sm x" id="peDel" title="Удалить элемент">Удалить</button></div>';
    if (tag === 'img') {
      h += `<div class="field"><label>Адрес картинки</label><div class="frow"><input type="text" id="peSrc" value="${U.esc(el.getAttribute('src') || '')}"><button class="sm" id="peUpl" title="Загрузить файл">⬆</button></div><div class="hint" id="peSrcHint"></div></div>
            <div class="field"><label>Описание (alt)</label><input type="text" id="peAlt" value="${U.esc(el.getAttribute('alt') || '')}"></div>
            <div class="grid" style="grid-template-columns:1fr 1fr"><div><label>Ширина</label><input type="text" id="peW" value="${U.esc(el.style.width || el.getAttribute('width') || '')}" placeholder="auto / 50% / 300px"></div><div><label>Высота</label><input type="text" id="peH" value="${U.esc(el.style.height || el.getAttribute('height') || '')}" placeholder="auto"></div></div>
            <div class="field"><label>Вписывание</label><select id="peFit"><option value="">как есть</option><option>cover</option><option>contain</option><option>fill</option></select></div>`;
    }
    if (tag === 'a') h += `<div class="field"><label>Ссылка</label><input type="text" id="peHref" value="${U.esc(el.getAttribute('href') || '')}"></div>`;
    if (!el.children.length && tag !== 'img' && tag !== 'br' && tag !== 'hr') h += `<div class="field"><label>Текст элемента</label><textarea id="peTxt" rows="3">${U.esc(el.textContent)}</textarea></div>`;
    h += '<div class="pseg" id="peAlign"><button data-v="left">⇤</button><button data-v="center">↔</button><button data-v="right">⇥</button><button data-v="justify">☰</button></div>';
    h += '<div class="pseg" id="peWt"><button data-k="font-weight" data-v="700"><b>B</b></button><button data-k="font-style" data-v="italic"><i>I</i></button><button data-k="text-decoration" data-v="underline"><u>U</u></button><button data-k="text-transform" data-v="uppercase">Aa↑</button></div>';
    h += '<div class="pgrid">';
    for (const [id, prop, type, label] of STYLE_FIELDS) {
      let v = el.style.getPropertyValue(prop) || '';
      if (type === 'color') { const hex = rgb2hex(v || cs.getPropertyValue(prop)); h += `<div><label>${label}</label><div class="frow"><input type="color" data-p="${prop}" value="${hex || '#000000'}"><button class="sm" data-clr="${prop}" title="Сбросить">✕</button></div></div>`; }
      else h += `<div><label>${label}</label><input type="text" data-p="${prop}" data-t="${type}" value="${U.esc(v)}" placeholder="${U.esc(type === 'px' ? PX(cs.getPropertyValue(prop)) : cs.getPropertyValue(prop))}"></div>`;
    }
    h += '</div>';
    h += `<div class="field"><label>Стиль целиком (style)</label><textarea id="peStyle" rows="4" style="font-family:ui-monospace,monospace;font-size:11.5px">${U.esc((el.getAttribute('style') || '').replace(/;\s*/g, ';\n').trim())}</textarea></div>`;
    box.innerHTML = h + blocksHtml();
    box.querySelectorAll('.crumbs a').forEach(a => a.onclick = e => { e.preventDefault(); pick(pathOf(el)[+a.dataset.i]); });
    $d('peUp').onclick = () => el.parentElement && el.parentElement !== idoc.body && pick(el.parentElement);
    $d('peDup').onclick = () => { const c = el.cloneNode(true); c.removeAttribute('data-ce-sel'); el.after(c); snap(); pick(c); };
    $d('peMU').onclick = () => { const p = el.previousElementSibling; if (p) { p.before(el); snap(); renderProps(); } };
    $d('peMD').onclick = () => { const n = el.nextElementSibling; if (n) { n.after(el); snap(); renderProps(); } };
    $d('peDel').onclick = () => { const p = el.parentElement; el.remove(); selEl = null; snap(); renderProps(); };
    const apply = (prop, val) => { if (val === '' || val == null) el.style.removeProperty(prop); else el.style.setProperty(prop, val); typed(); };
    box.querySelectorAll('input[data-p]').forEach(i => {
      i.oninput = () => {
        let v = i.value.trim();
        if (i.type === 'text' && i.dataset.t === 'px' && /^-?[\d.]+$/.test(v)) v += 'px';
        apply(i.dataset.p, v);
      };
      if (i.type === 'color') i.onchange = () => { snap(); renderProps(); };
    });
    box.querySelectorAll('[data-clr]').forEach(b => b.onclick = () => { apply(b.dataset.clr, ''); snap(); renderProps(); });
    $d('peAlign').querySelectorAll('button').forEach(b => b.onclick = () => { apply('text-align', b.dataset.v); snap(); });
    $d('peWt').querySelectorAll('button').forEach(b => b.onclick = () => { const k = b.dataset.k, on = (el.style.getPropertyValue(k) || '') === b.dataset.v; apply(k, on ? '' : b.dataset.v); snap(); });
    $d('peStyle').onchange = e => { const v = e.target.value.replace(/\n/g, ' ').trim(); if (/(expression\(|javascript:|behavior:)/i.test(v)) return; if (v) el.setAttribute('style', v); else el.removeAttribute('style'); snap(); renderProps(); };
    if ($d('peTxt')) $d('peTxt').oninput = e => { el.textContent = e.target.value; typed(); };
    if ($d('peHref')) $d('peHref').onchange = e => { const v = e.target.value.trim(); if (/^(javascript|vbscript|data):/i.test(v)) return; el.setAttribute('href', v); snap(); };
    if (tag === 'img') {
      const hint = () => { const s = el.getAttribute('src') || ''; $d('peSrcHint').textContent = imgIdOf(s) ? 'Картинка хранится в вашем аккаунте и видна только вам. Для форума загрузите её на хостинг и вставьте здесь внешнюю ссылку.' : (/^URL_|^[A-ZА-Я_]+$/.test(s) ? 'Это заглушка — вставьте ссылку или загрузите файл.' : ''); };
      hint();
      $d('peSrc').onchange = e => { const v = e.target.value.trim(); if (/^(javascript|vbscript):/i.test(v)) return; el.setAttribute('src', v); el.removeAttribute('srcset'); snap(); hint(); renderFields(); };
      $d('peAlt').onchange = e => { el.setAttribute('alt', e.target.value); snap(); };
      $d('peUpl').onclick = () => pickFile(f => replaceImage(el, f));
      const dim = (id, p) => { $d(id).onchange = e => { let v = e.target.value.trim(); if (/^[\d.]+$/.test(v)) v += 'px'; el.removeAttribute(p); apply(p, v); snap(); }; };
      dim('peW', 'width'); dim('peH', 'height');
      $d('peFit').value = el.style.objectFit || ''; $d('peFit').onchange = e => { apply('object-fit', e.target.value); snap(); };
    }
    wireBlocks(box);
  }

  /* ---------- вставка готовых блоков ---------- */
  const BLOCKS = [
    ['Абзац', '<p style="margin:0 0 12px 0;line-height:1.6">Новый абзац текста.</p>'],
    ['Заголовок', '<h2 style="margin:18px 0 10px 0;font-size:22px;line-height:1.3">Заголовок раздела</h2>'],
    ['Картинка', '<img src="URL_КАРТИНКИ" alt="" style="max-width:100%;height:auto;display:block;margin:12px 0">'],
    ['Цитата', '<blockquote style="margin:16px 0;padding:12px 18px;border-left:3px solid #2563eb;background:rgba(127,127,127,.12);font-style:italic">«Текст цитаты.»<div style="font-style:normal;font-size:12px;font-weight:bold;margin-top:6px">— Автор цитаты</div></blockquote>'],
    ['Список', '<ul style="margin:0 0 12px 0;padding-left:20px"><li>Первый пункт</li><li>Второй пункт</li><li>Третий пункт</li></ul>'],
    ['Врезка', '<div style="margin:14px 0;padding:14px 18px;border:1px solid #c9bfae;background:rgba(127,127,127,.1);border-radius:6px"><b>Важно:</b> текст врезки.</div>'],
    ['Разделитель', '<hr style="border:0;border-top:1px solid #999;margin:18px 0">'],
    ['Две колонки', '<table style="width:100%;border-collapse:collapse;table-layout:fixed;border:none"><tr><td style="width:50%;vertical-align:top;padding:0 12px 0 0;border:none">Левая колонка</td><td style="width:50%;vertical-align:top;padding:0 0 0 12px;border:none">Правая колонка</td></tr></table>'],
  ];
  function blocksHtml() { return `<div class="sep"></div><div class="hint" style="margin-bottom:6px">Добавить блок ${selEl ? 'после выбранного элемента' : 'в конец документа'}:</div><div class="addgrid" id="dcBlocks">${BLOCKS.map((b, i) => `<button data-b="${i}">${b[0]}</button>`).join('')}</div>`; }
  function wireBlocks(box) {
    box.querySelectorAll('#dcBlocks [data-b]').forEach(b => b.onclick = () => {
      if (mode !== 'visual' || !idoc) return;
      const t = idoc.createElement('template'); t.innerHTML = BLOCKS[+b.dataset.b][1]; const n = t.content.firstElementChild;
      // блок «в поток» вставляем после выбранного; у корневой обёртки — внутрь неё, чтобы не вылезти за рамку шаблона
      if (selEl && selEl !== idoc.body) selEl.after(n); else (idoc.body.children.length === 1 ? idoc.body.firstElementChild : idoc.body).appendChild(n);
      snap(); pick(n); n.scrollIntoView({ block:'nearest' }); renderFields();
    });
  }
  function setTab(t, silent) {
    uiTab = t;
    document.querySelectorAll('#dcRTabs [data-t]').forEach(b => b.classList.toggle('active', b.dataset.t === t));
    $d('dcFieldsPane').style.display = t === 'fields' ? 'block' : 'none'; $d('dcElPane').style.display = t === 'el' ? 'block' : 'none';
    if (!silent && t === 'fields') renderFields();
  }

  /* ---------- вставка HTML: окно ---------- */
  function openImport(initial) {
    $d('dcImpSrc').value = initial || ''; const g = guessMeta(initial || ''); $d('dcImpKind').value = g.kind; $d('dcImpTitle').value = initial ? g.title : '';
    $d('dcImpModal').style.display = 'flex'; updImpPreview(); setTimeout(() => $d('dcImpSrc').focus(), 30);
  }
  function updImpPreview() {
    const src = $d('dcImpSrc').value.trim(), f = $d('dcImpPrev');
    $d('dcImpOk').disabled = !src;
    if (!src) { f.srcdoc = '<body style="margin:0;font:14px system-ui;color:#888;display:grid;place-items:center;height:100vh;background:transparent">Вставьте код слева — здесь появится результат</body>'; return; }
    f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:12px;background:${BGS.grey}}</style></head><body>${parseSource(src)}</body></html>`;
  }
  function createFromImport() {
    const src = $d('dcImpSrc').value.trim(); if (!src) return;
    const g = guessMeta(src), d = { id: newId(), kind: $d('dcImpKind').value || g.kind, title: ($d('dcImpTitle').value || g.title).trim().slice(0, 120), html: parseSource(src), t: Date.now() };
    list.unshift(d); $d('dcImpModal').style.display = 'none'; filter = 'all'; open(d.id); if (save) save(true);
  }
  function newBlank() {
    const d = { id: newId(), kind: 'article', title: 'Новая статья', t: Date.now(),
      html: '<div style="max-width:760px;margin:24px auto;background:#fff;color:#1a1f2c;padding:32px 36px;border:1px solid #e2e8f0;border-radius:8px;font-family:Georgia,\'Times New Roman\',serif;line-height:1.6"><h1 style="margin:0 0 12px 0;font-size:28px;line-height:1.25">Заголовок публикации</h1><p style="margin:0 0 18px 0;color:#64748b;font-style:italic">Краткий лид — одно-два предложения о главном.</p><p style="margin:0 0 14px 0">Основной текст. Кликните сюда и печатайте; блоки (картинка, цитата, список…) добавляются справа.</p></div>' };
    list.unshift(d); filter = 'all'; open(d.id); if (save) save(true);
  }

  /* ---------- экспорт ---------- */
  async function toDataURI(url) {
    const r = await fetch(url, { credentials: 'same-origin' }); if (!r.ok) throw new Error('img ' + r.status);
    const b = await r.blob(); return await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
  }
  async function inlineImages(html) {
    const ids = [...new Set([...html.matchAll(/\/api\/images\/([A-Za-z0-9_-]{8,64})/g)].map(m => m[1]))];
    for (const id of ids) { try { html = html.split('/api/images/' + id).join(await toDataURI('/api/images/' + id)); } catch {} }
    return html;
  }
  const currentHtml = () => (mode === 'visual' && idoc ? serialize() : mode === 'code' ? parseSource($d('dcCode').value) : cur.html);
  async function copyCode(embed) {
    let h = currentHtml(); if (embed) h = await inlineImages(h);
    try { await navigator.clipboard.writeText(h); } catch { const t = document.createElement('textarea'); t.value = h; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    const local = !embed && /\/api\/images\//.test(h), ph = findPlaceholders(currentRoot()).size;
    toast('HTML скопирован.' + (local ? ' Внимание: в нём есть картинки из аккаунта — на форуме они не откроются, замените их ссылками с хостинга.' : '') + (ph ? ` Не заполнено заглушек: ${ph}.` : ''));
  }
  async function downloadHtml() {
    const body = await inlineImages(currentHtml());
    const doc = `<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${U.esc(cur.title)}</title></head>\n<body style="margin:0;background:${BGS[pageBg]}">\n${body}\n</body></html>\n`;
    downloadBlob(new Blob([doc], { type:'text/html;charset=utf-8' }), safe(cur.title) + '.html');
  }
  async function downloadPng() {
    if (!idoc || mode !== 'visual') { setMode('visual'); await new Promise(r => setTimeout(r, 400)); }
    toast('Готовлю PNG…');
    const clone = idoc.body.cloneNode(true);
    clone.querySelectorAll('[data-ce-sel]').forEach(e => e.removeAttribute('data-ce-sel')); clone.removeAttribute('contenteditable'); clone.removeAttribute('data-ce-mode');
    const br = idoc.body.getBoundingClientRect(), W = Math.ceil(Math.max(idoc.body.scrollWidth, br.width)), H = Math.ceil(br.height);
    const withInl = await inlineImages(new XMLSerializer().serializeToString(clone));
    const bg = BGS[pageBg];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${W}px;padding:0;margin:0;background:${bg};">${withInl.replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '')}</div></foreignObject></svg>`;
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('браузер не смог отрисовать документ')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    const sc = 2, cv = document.createElement('canvas'); cv.width = W * sc; cv.height = H * sc;
    const cx = cv.getContext('2d'); cx.fillStyle = bg; cx.fillRect(0, 0, cv.width, cv.height); cx.scale(sc, sc); cx.drawImage(img, 0, 0);
    cv.toBlob(b => { if (!b) return toast('Не удалось создать PNG'); downloadBlob(b, safe(cur.title) + '.png'); toast('PNG сохранён. Картинки по внешним ссылкам в него не попадают — загрузите их в редактор (⬆).'); }, 'image/png');
  }

  /* ---------- общий интерфейс ---------- */
  function setAppMode(m) {
    const app = $d('app'); app.dataset.mode = m;
    document.querySelectorAll('#modeSw [data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    try { localStorage.setItem('ceMode', m); } catch {}
    if (m === 'docs') { ensureInit(); renderList(); if (cur) showCur(); }
    else if (cur && idoc && mode === 'visual') cur.html = serialize();
  }
  function ensureInit() { if (ready) return; ready = true; initUI(); }
  function initUI() {
    const kb = $d('dcKinds'); kb.innerHTML = `<button data-k="all">Все <i></i></button>` + Object.entries(KINDS).map(([k, v]) => `<button data-k="${k}">${v} <i></i></button>`).join('');
    kb.querySelectorAll('button').forEach(b => b.onclick = () => { filter = b.dataset.k; renderList(); });
    $d('dcKind').innerHTML = Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    $d('dcImpKind').innerHTML = $d('dcKind').innerHTML;
    $d('dcSearch').oninput = renderList;
    $d('dcNew').onclick = () => openImport(''); $d('dcBlank').onclick = newBlank; $d('dcEmptyImp').onclick = () => openImport('');
    $d('dcEmptyBlank').onclick = newBlank;
    $d('dcTitle').oninput = e => { if (cur) { cur.title = e.target.value; cur.t = Date.now(); renderList(); if (save) save(); } };
    $d('dcKind').onchange = e => { if (cur) { cur.kind = e.target.value; renderList(); if (save) save(); } };
    document.querySelectorAll('#dcModes [data-m]').forEach(b => b.onclick = () => setMode(b.dataset.m));
    $d('dcBg').onchange = e => { pageBg = e.target.value; if (cur && mode !== 'code') { const s = idoc && idoc.getElementById('ce-frame'); if (s) s.textContent = frameCss(); } };
    $d('dcWidth').onchange = e => { pageW = e.target.value; const s = idoc && idoc.getElementById('ce-frame'); if (s) s.textContent = frameCss(); };
    wireFmt();
    document.querySelectorAll('#dcRTabs [data-t]').forEach(b => b.onclick = () => setTab(b.dataset.t));
    $d('dcCode').oninput = () => { if (cur) { clearTimeout(initUI._t); initUI._t = setTimeout(() => { cur.html = parseSource($d('dcCode').value); cur.t = Date.now(); renderFields(); if (save) save(); }, 500); } };
    $d('dcCopy').onclick = () => copyCode(false); $d('dcCopyEmb').onclick = () => copyCode(true);
    $d('dcDlHtml').onclick = () => downloadHtml().catch(e => alert(e.message));
    $d('dcDlPng').onclick = () => downloadPng().catch(e => alert('Не удалось сохранить PNG: ' + e.message));
    // окно вставки
    $d('dcImpSrc').oninput = () => { clearTimeout(initUI._i); initUI._i = setTimeout(() => { const g = guessMeta($d('dcImpSrc').value); if (!$d('dcImpTitle').dataset.touched) { $d('dcImpTitle').value = g.title; $d('dcImpKind').value = g.kind; } updImpPreview(); }, 250); };
    $d('dcImpTitle').oninput = e => { e.target.dataset.touched = '1'; };
    $d('dcImpCancel').onclick = $d('dcImpClose').onclick = () => { $d('dcImpModal').style.display = 'none'; };
    $d('dcImpOk').onclick = createFromImport;
    $d('dcImpFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) { $d('dcImpTitle').dataset.touched = ''; $d('dcImpSrc').value = await f.text(); $d('dcImpSrc').oninput(); } };
    $d('dcImpFileBtn').onclick = () => $d('dcImpFile').click();
    $d('dcImpModal').addEventListener('mousedown', e => { if (e.target === $d('dcImpModal')) $d('dcImpModal').style.display = 'none'; });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') $d('dcImpModal').style.display = 'none';
      if (document.getElementById('app').dataset.mode !== 'docs' || !cur || mode !== 'visual') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) { e.preventDefault(); restore(e.shiftKey ? hpos + 1 : hpos - 1); }
      if ((e.key === 'Delete') && selEl && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) && document.activeElement !== ifr) { selEl.remove(); selEl = null; snap(); renderProps(); }
    });
    document.querySelectorAll('#modeSw [data-mode]').forEach(b => b.onclick = () => setAppMode(b.dataset.mode));
    setTab('fields', true);
  }

  return {
    KINDS,
    load(arr) { list = Array.isArray(arr) ? arr.filter(d => d && typeof d.id === 'string').map(d => ({ id:d.id, kind: KINDS[d.kind] ? d.kind : 'other', title: String(d.title || 'Без названия'), html: String(d.html || ''), t: d.t || Date.now() })) : []; cur = null; },
    serialize() { if (cur && idoc && mode === 'visual') cur.html = serialize(); else if (cur && mode === 'code' && $d('dcCode')) cur.html = parseSource($d('dcCode').value); return list.map(d => ({ id:d.id, kind:d.kind, title:d.title, html:d.html, t:d.t })); },
    inline: inlineImages,
    async uploadEmbedded(html) {
      const seen = new Map();
      for (const m of String(html || '').matchAll(/data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,[A-Za-z0-9+\/=]+/g)) {
        if (seen.has(m[0])) continue;
        try { seen.set(m[0], '/api/images/' + await putImage(dataURLtoBlob(m[0]))); } catch { /* оставляем как есть */ }
      }
      let out = String(html || ''); for (const [k, v] of seen) out = out.split(k).join(v); return out;
    },
    usedImageIds, get count() { return list.length; },
    add(d) { list.unshift({ id: newId(), kind: KINDS[d.kind] ? d.kind : 'other', title: d.title || 'Импортировано', html: d.html || '', t: Date.now() }); },
    start() {
      const m = (() => { try { return localStorage.getItem('ceMode'); } catch { return null; } })();
      ensureInit(); renderList();
      if (m === 'docs') { const last = (() => { try { return localStorage.getItem('ceDoc'); } catch { return null; } })(); if (last && list.some(d => d.id === last)) cur = list.find(d => d.id === last); else if (list[0]) cur = list[0]; setAppMode('docs'); } else { showCur(); setAppMode('shots'); }
    },
    isOpen: () => document.getElementById('app').dataset.mode === 'docs',
  };
})();

(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const socket = io({ transports: ['websocket', 'polling'] });

  const state = {
    room: '',
    files: [],
    texts: [],
    totalSize: 0,
    maxSize: 0,
  };

  // ───────────────────────── 유틸 ─────────────────────────
  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const v = bytes / 1024 ** i;
    return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
  }

  const rtf = new Intl.RelativeTimeFormat('ko', { numeric: 'auto' });
  function timeAgo(ts) {
    const s = Math.round((ts - Date.now()) / 1000);
    if (Math.abs(s) < 45) return '방금';
    const m = Math.round(s / 60);
    if (Math.abs(m) < 60) return rtf.format(m, 'minute');
    const h = Math.round(m / 60);
    if (Math.abs(h) < 24) return rtf.format(h, 'hour');
    return rtf.format(Math.round(h / 24), 'day');
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v; // 정적 아이콘 SVG 전용
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) node.append(c);
    return node;
  }

  function toast(message, type = 'info', ms = 2600) {
    const t = el('div', { class: `toast toast-${type}`, text: message });
    $('#toasts').append(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, ms);
  }

  async function copyText(text, msg = '복사했어요') {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // http 환경 등 clipboard API를 못 쓸 때
      const ta = el('textarea', { style: 'position:fixed;opacity:0' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(msg, 'success');
  }

  const ICONS = {
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  };

  const FILE_KINDS = [
    { kind: 'img', label: 'IMG', re: /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic|heif|ico)$/i },
    { kind: 'vid', label: 'VID', re: /\.(mp4|mov|avi|mkv|webm|m4v|wmv)$/i },
    { kind: 'aud', label: 'AUD', re: /\.(mp3|wav|m4a|flac|aac|ogg)$/i },
    { kind: 'doc', label: 'PDF', re: /\.pdf$/i },
    { kind: 'doc', label: 'DOC', re: /\.(docx?|hwpx?|pages|rtf|odt)$/i },
    { kind: 'sheet', label: 'XLS', re: /\.(xlsx?|csv|numbers|ods)$/i },
    { kind: 'slide', label: 'PPT', re: /\.(pptx?|key|odp)$/i },
    { kind: 'zip', label: 'ZIP', re: /\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/i },
    { kind: 'code', label: 'CODE', re: /\.(js|ts|jsx|tsx|py|java|c|cpp|h|cs|go|rs|rb|php|html|css|json|xml|ya?ml|sh|sql|md|txt)$/i },
  ];
  function fileKind(name) {
    return FILE_KINDS.find(k => k.re.test(name)) || { kind: 'etc', label: (name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase() };
  }
  const PREVIEWABLE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/;

  const fileUrl = (id, inline) =>
    `/api/rooms/${state.room}/files/${encodeURIComponent(id)}${inline ? '?inline=1' : ''}`;

  // ───────────────────────── 연결 상태 ─────────────────────────
  const connBanner = $('#connBanner');
  const connText = $('#connText');
  let connTimer = null;

  function showConnecting() {
    clearTimeout(connTimer);
    // 짧은 끊김은 표시하지 않음
    connTimer = setTimeout(() => {
      connBanner.hidden = false;
      connText.textContent = '서버에 연결하는 중…';
      connTimer = setTimeout(() => {
        connText.textContent = '서버를 깨우는 중이에요. 처음 접속은 최대 1분 정도 걸릴 수 있어요.';
      }, 4000);
    }, 600);
  }
  showConnecting();

  socket.on('connect', () => {
    clearTimeout(connTimer);
    connBanner.hidden = true;
    if (state.room) joinRoom(state.room, { silent: true });
  });
  socket.on('disconnect', showConnecting);

  // ───────────────────────── 입장 화면 ─────────────────────────
  const joinScreen = $('#joinScreen');
  const roomInput = $('#roomInput');
  const joinBtn = $('#joinBtn');

  // 기존 디자인: 1000px 기준 화면을 뷰포트 너비에 맞춰 축소
  function resizeJoin() {
    const baseWidth = 1000;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const scale = Math.min((vw / baseWidth) * 1.3, 1);
    joinScreen.style.transform = `scale(${scale})`;
    joinScreen.style.left = `${(vw - baseWidth * scale) / 2}px`;
  }
  window.addEventListener('resize', resizeJoin);
  resizeJoin();

  const isValidCode = v => /^\d{4}$/.test(v);

  function fillCode(code) {
    roomInput.value = String(code).replace(/\D/g, '').slice(0, 4);
    joinBtn.classList.toggle('show', isValidCode(roomInput.value));
  }

  roomInput.addEventListener('input', () => fillCode(roomInput.value));
  roomInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && isValidCode(roomInput.value)) joinRoom(roomInput.value);
  });
  joinBtn.addEventListener('click', () => {
    if (isValidCode(roomInput.value)) joinRoom(roomInput.value);
  });

  // ───────────────────────── 입장/퇴장 ─────────────────────────
  let joining = false;
  function joinRoom(code, { silent = false } = {}) {
    if (joining) return;
    joining = true;
    if (!socket.connected && !silent) toast('서버 연결을 기다리는 중이에요…');

    socket.emit('join-room', code, res => {
      joining = false;
      if (!res?.ok) return toast(res?.message || '입장에 실패했어요', 'error');
      const isNew = state.room !== code;
      state.room = code;
      if (isNew) {
        state.files = [];
        state.texts = [];
        renderFiles();
        renderTexts();
        $('#uploadList').innerHTML = '';
      }
      $('#roomCode').textContent = code;
      $('#joinScreen').hidden = true;
      $('#roomScreen').hidden = false;
      document.title = `FileDrop · ${code}`;
      if (location.hash !== `#${code}`) history.replaceState(null, '', `#${code}`);
    });
  }

  function leaveRoom() {
    if (!state.room) return;
    socket.emit('leave-room');
    state.room = '';
    state.files = [];
    state.texts = [];
    $('#roomScreen').hidden = true;
    $('#joinScreen').hidden = false;
    document.title = 'FileDrop';
    history.replaceState(null, '', location.pathname);
    fillCode('');
    resizeJoin();
    roomInput.focus();
  }

  $('#leaveBtn').addEventListener('click', leaveRoom);
  $('#homeBtn').addEventListener('click', leaveRoom);
  $('#roomChip').addEventListener('click', () => copyText(state.room, `코드 ${state.room} 복사했어요`));

  // 링크(#1234)로 바로 입장
  const hashCode = location.hash.slice(1);
  if (/^\d{4}$/.test(hashCode)) {
    fillCode(hashCode);
    joinRoom(hashCode, { silent: true });
  }

  // ───────────────────────── 방 상태 수신 ─────────────────────────
  socket.on('room-state', s => {
    state.files = s.files;
    state.texts = s.texts;
    state.totalSize = s.totalSize;
    state.maxSize = s.maxSize;
    $('#usersCount').textContent = s.users;
    renderCapacity();
    renderFiles();
    renderTexts();
  });

  function renderCapacity() {
    const pct = state.maxSize ? Math.min((state.totalSize / state.maxSize) * 100, 100) : 0;
    $('#capUsed').textContent = formatBytes(state.totalSize);
    $('#capMax').textContent = formatBytes(state.maxSize);
    const bar = $('#capBar');
    bar.style.width = `${pct}%`;
    bar.dataset.level = pct >= 95 ? 'danger' : pct >= 80 ? 'warn' : 'ok';
  }

  // ───────────────────────── 파일 목록 ─────────────────────────
  function renderFiles() {
    const list = $('#fileList');
    list.replaceChildren(...state.files.map(fileItem));
    const n = state.files.length;
    $('#filesCount').textContent = n;
    $('#filesCountTab').textContent = n;
    $('#filesEmpty').hidden = n > 0 || $('#uploadList').children.length > 0;
    $('#zipBtn').disabled = n === 0;
  }

  function fileItem(f) {
    const k = fileKind(f.name);
    const canPreview = PREVIEWABLE.test(f.type);
    const thumb = canPreview
      ? el('button', { class: 'thumb thumb-img', type: 'button', title: '미리보기', onclick: () => openPreview(f) },
          el('img', { src: fileUrl(f.id, true), alt: '', loading: 'lazy' }))
      : el('span', { class: 'thumb', text: k.label });

    return el('li', { class: 'item' },
      thumb,
      el('div', { class: 'item-body' },
        el('a', { class: 'item-name', href: fileUrl(f.id), download: f.name, title: f.name, text: f.name }),
        el('div', { class: 'item-meta', text: `${formatBytes(f.size)} · ${timeAgo(f.uploadedAt)}` }),
      ),
      el('div', { class: 'item-actions' },
        el('a', { class: 'icon-btn', href: fileUrl(f.id), download: f.name, title: '다운로드', 'aria-label': '다운로드', html: ICONS.download }),
        el('button', { class: 'icon-btn danger', type: 'button', title: '삭제', 'aria-label': '삭제', html: ICONS.trash, onclick: () => deleteFile(f) }),
      ),
    );
  }

  async function deleteFile(f) {
    try {
      const res = await fetch(fileUrl(f.id), { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast(`'${f.name}' 삭제했어요`);
    } catch {
      toast('삭제에 실패했어요', 'error');
    }
  }

  $('#zipBtn').addEventListener('click', () => {
    if (!state.files.length) return;
    location.href = `/api/rooms/${state.room}/zip`;
  });

  // 이미지 미리보기
  const previewDialog = $('#previewDialog');
  function openPreview(f) {
    $('#previewImg').src = fileUrl(f.id, true);
    $('#previewName').textContent = f.name;
    previewDialog.showModal();
  }
  previewDialog.addEventListener('click', e => { if (e.target === previewDialog) previewDialog.close(); });

  // ───────────────────────── 업로드 ─────────────────────────
  const fileInput = $('#fileInput');
  const dropzone = $('#dropzone');

  function uploadFiles(fileList) {
    const files = [...fileList].filter(f => f && f.size >= 0);
    if (!files.length || !state.room) return;

    const pending = files.reduce((s, f) => s + f.size, 0);
    if (state.maxSize && state.totalSize + pending > state.maxSize) {
      shake();
      return toast(`방 용량(${formatBytes(state.maxSize)})을 넘어서 올릴 수 없어요`, 'error', 3500);
    }
    files.forEach(uploadOne);
  }

  function uploadOne(file) {
    const room = state.room;
    const bar = el('div', { class: 'progress-bar' });
    const meta = el('div', { class: 'item-meta', text: `0% · ${formatBytes(file.size)}` });
    const xhr = new XMLHttpRequest();
    const row = el('li', { class: 'item uploading' },
      el('span', { class: 'thumb', text: fileKind(file.name).label }),
      el('div', { class: 'item-body' },
        el('div', { class: 'item-name', text: file.name }),
        el('div', { class: 'progress' }, bar),
        meta,
      ),
      el('div', { class: 'item-actions' },
        el('button', { class: 'icon-btn', type: 'button', title: '취소', 'aria-label': '업로드 취소', html: ICONS.x, onclick: () => xhr.abort() }),
      ),
    );
    $('#uploadList').prepend(row);
    $('#filesEmpty').hidden = true;

    const done = () => { row.remove(); renderFiles(); };

    xhr.upload.addEventListener('progress', e => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      bar.style.width = `${pct}%`;
      meta.textContent = `${pct}% · ${formatBytes(e.loaded)} / ${formatBytes(e.total)}`;
    });
    xhr.addEventListener('load', () => {
      let json = {};
      try { json = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && json.success) {
        done();
      } else {
        done();
        shake();
        toast(json.message || `'${file.name}' 업로드 실패`, 'error', 3500);
      }
    });
    xhr.addEventListener('error', () => { done(); shake(); toast(`'${file.name}' 업로드 중 네트워크 오류`, 'error'); });
    xhr.addEventListener('abort', () => { done(); toast('업로드를 취소했어요'); });

    const form = new FormData();
    form.append('files', file, file.name);
    xhr.open('POST', `/api/rooms/${room}/files`);
    xhr.send(form);
  }

  function shake() {
    dropzone.classList.remove('error');
    void dropzone.offsetWidth;
    dropzone.classList.add('error');
  }
  dropzone.addEventListener('animationend', () => dropzone.classList.remove('error'));

  fileInput.addEventListener('change', () => {
    uploadFiles(fileInput.files);
    fileInput.value = '';
  });

  // 페이지 어디에 놓아도 업로드
  const overlay = $('#dragOverlay');
  let dragDepth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');

  window.addEventListener('dragenter', e => {
    if (!state.room || !hasFiles(e)) return;
    e.preventDefault();
    if (++dragDepth === 1) overlay.hidden = false;
  });
  window.addEventListener('dragover', e => { if (state.room && hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', e => {
    if (!state.room || !hasFiles(e)) return;
    if (--dragDepth <= 0) { dragDepth = 0; overlay.hidden = true; }
  });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.hidden = true;
    if (state.room) uploadFiles(e.dataTransfer.files);
  });

  // 붙여넣기: 파일/이미지는 업로드, 텍스트는 입력창으로
  window.addEventListener('paste', e => {
    if (!state.room) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      // 클립보드 이미지는 이름이 image.png 하나뿐이라 시간으로 구분
      const named = files.map(f =>
        /^image\.\w+$/.test(f.name)
          ? new File([f], `붙여넣은 이미지 ${new Date().toLocaleString('sv').replace(/[: ]/g, '-')}.${f.name.split('.').pop()}`, { type: f.type })
          : f);
      uploadFiles(named);
      return;
    }
    const target = e.target;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    const text = e.clipboardData?.getData('text');
    if (!typing && text) {
      e.preventDefault();
      switchTab('texts');
      textInput.value = text;
      textInput.dispatchEvent(new Event('input'));
      textInput.focus();
      toast('텍스트를 입력창에 붙여넣었어요. 공유를 누르세요.');
    }
  });

  // ───────────────────────── 텍스트 공유 ─────────────────────────
  const textInput = $('#textInput');
  const textSend = $('#textSend');

  textInput.addEventListener('input', () => {
    textSend.disabled = !textInput.value.trim();
    textInput.style.height = 'auto';
    textInput.style.height = `${Math.min(textInput.scrollHeight, 320)}px`;
  });
  textInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      $('#textForm').requestSubmit();
    }
  });

  $('#textForm').addEventListener('submit', e => {
    e.preventDefault();
    const content = textInput.value;
    if (!content.trim()) return;
    textSend.disabled = true;
    socket.timeout(8000).emit('text-add', content, (err, res) => {
      if (err || !res?.ok) {
        textSend.disabled = false;
        return toast(res?.message || '공유에 실패했어요', 'error');
      }
      textInput.value = '';
      textInput.dispatchEvent(new Event('input'));
    });
  });

  const expandedTexts = new Set();
  const URL_RE =/(https?:\/\/[^\s<>"']+)/g;
  function linkify(text) {
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(URL_RE)) {
      const url = m[0].replace(/[.,!?)\]]+$/, '');
      frag.append(text.slice(last, m.index));
      frag.append(el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: url }));
      last = m.index + url.length;
    }
    frag.append(text.slice(last));
    return frag;
  }

  function renderTexts() {
    const list = $('#textList');
    list.replaceChildren(...state.texts.map(textItem));
    const n = state.texts.length;
    $('#textsCount').textContent = n;
    $('#textsCountTab').textContent = n;
    $('#textsEmpty').hidden = n > 0;
  }

  function textItem(t) {
    const long = t.content.length > 600 || t.content.split('\n').length > 12;
    const isOpen = expandedTexts.has(t.id);
    const body = el('div', { class: `text-body${long && !isOpen ? ' clamped' : ''}` }, linkify(t.content));
    const more = long
      ? el('button', {
          class: 'text-more', type: 'button', text: isOpen ? '접기' : '더 보기',
          onclick: e => {
            const clamped = body.classList.toggle('clamped');
            if (clamped) expandedTexts.delete(t.id); else expandedTexts.add(t.id);
            e.currentTarget.textContent = clamped ? '더 보기' : '접기';
          },
        })
      : null;

    return el('li', { class: 'text-card' },
      body,
      more,
      el('div', { class: 'text-foot' },
        el('span', { class: 'item-meta', text: `${timeAgo(t.createdAt)} · ${t.content.length.toLocaleString()}자` }),
        el('div', { class: 'item-actions' },
          el('button', { class: 'link-btn', type: 'button', text: '복사', onclick: () => copyText(t.content) }),
          el('button', { class: 'icon-btn danger', type: 'button', title: '삭제', 'aria-label': '삭제', html: ICONS.trash, onclick: () => socket.emit('text-delete', t.id) }),
        ),
      ),
    );
  }

  // ───────────────────────── 탭 (모바일) ─────────────────────────
  function switchTab(name) {
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $$('.panel').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
  }
  $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  switchTab('files');

  // ───────────────────────── 공유 모달 ─────────────────────────
  const shareDialog = $('#shareDialog');
  $('#shareBtn').addEventListener('click', () => {
    const link = `${location.origin}${location.pathname}#${state.room}`;
    $('#shareLink').value = link;
    $('#shareCode').textContent = state.room;
    $('#qrImg').src = `/api/qr?text=${encodeURIComponent(link)}`;
    shareDialog.showModal();
  });
  $('#copyLinkBtn').addEventListener('click', () => copyText($('#shareLink').value, '링크를 복사했어요'));
  shareDialog.addEventListener('click', e => { if (e.target === shareDialog) shareDialog.close(); });

  // 상대 시간 갱신
  setInterval(() => { if (state.room) { renderFiles(); renderTexts(); } }, 60_000);
})();

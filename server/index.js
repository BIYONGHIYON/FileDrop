const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const multer = require('multer');
const archiver = require('archiver');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

// ───────────────────────── 설정 ─────────────────────────
const PORT = process.env.PORT || 3000;
const MAX_ROOM_SIZE = Number(process.env.MAX_ROOM_SIZE_MB || 500) * 1024 * 1024; // 방당 최대 용량
const MAX_FILES_PER_ROOM = 200;
const MAX_TEXTS_PER_ROOM = 100;
const MAX_TEXT_LENGTH = 100_000; // 글자 수
const EMPTY_ROOM_TTL = 60 * 1000; // 아무도 없으면 1분 후 삭제
const ROOM_CODE_RE = /^\d{4}$/;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

const uploadBase = path.join(__dirname, 'uploads');
// 서버 재시작 시 메타데이터가 사라지므로 남은 파일도 정리
fs.rmSync(uploadBase, { recursive: true, force: true });
fs.mkdirSync(uploadBase, { recursive: true });

// ───────────────────────── 방 상태 ─────────────────────────
/**
 * rooms: Map<code, {
 *   files: Map<id, {id, name, size, type, uploadedAt}>,
 *   texts: Array<{id, content, createdAt}>,
 *   cleanupTimer: Timeout | null,
 * }>
 */
const rooms = new Map();

function roomDir(code) {
  return path.join(uploadBase, code);
}

function getRoom(code, create = false) {
  if (!ROOM_CODE_RE.test(code || '')) return null;
  let room = rooms.get(code);
  if (!room && create) {
    room = { files: new Map(), texts: [], cleanupTimer: null };
    rooms.set(code, room);
    fs.mkdirSync(roomDir(code), { recursive: true });
  }
  return room || null;
}

function roomSize(room) {
  let total = 0;
  for (const f of room.files.values()) total += f.size;
  return total;
}

function userCount(code) {
  return io.sockets.adapter.rooms.get(code)?.size || 0;
}

function roomState(code) {
  const room = getRoom(code);
  if (!room) return null;
  return {
    files: [...room.files.values()].sort((a, b) => b.uploadedAt - a.uploadedAt),
    texts: [...room.texts].sort((a, b) => b.createdAt - a.createdAt),
    totalSize: roomSize(room),
    maxSize: MAX_ROOM_SIZE,
    users: userCount(code),
  };
}

function broadcast(code) {
  const state = roomState(code);
  if (state) io.to(code).emit('room-state', state);
}

function scheduleCleanup(code) {
  const room = getRoom(code);
  if (!room) return;
  clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => {
    if (userCount(code) > 0) return;
    rooms.delete(code);
    try {
      fs.rmSync(roomDir(code), { recursive: true, force: true });
      console.log(`[${code}] 빈 방 정리 완료`);
    } catch (err) {
      console.error(`[${code}] 디렉토리 삭제 실패:`, err);
    }
  }, EMPTY_ROOM_TTL);
}

// ───────────────────────── 파일명 처리 ─────────────────────────
// busboy는 multipart 파일명을 기본적으로 latin1로 해석하므로 한글 등이 깨진다.
// UTF-8로 다시 해석하고, macOS의 자모 분리(NFD) 이름은 NFC로 합친다.
function decodeFileName(raw) {
  let name = raw || 'file';
  // latin1 범위 문자로만 이뤄졌을 때만 재해석 (이미 올바른 유니코드면 그대로 둔다)
  if (/^[\u0000-ÿ]*$/.test(name)) {
    const reDecoded = Buffer.from(name, 'latin1').toString('utf8');
    if (!reDecoded.includes('�')) name = reDecoded;
  }
  name = name.normalize('NFC');
  name = path.basename(name.replace(/\\/g, '/')); // 경로 제거
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return name.slice(0, 255) || 'file';
}

// ───────────────────────── 업로드 ─────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, roomDir(req.params.room)),
    filename: (req, file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: MAX_ROOM_SIZE, files: 50 },
});

function requireRoom(req, res, next) {
  const room = getRoom(req.params.room);
  if (!room) return res.status(404).json({ success: false, message: '존재하지 않는 방입니다. 다시 입장해 주세요.' });
  req.room = room;
  next();
}

app.use(express.static(path.join(__dirname, '../public')));

app.post('/api/rooms/:room/files', requireRoom, (req, res, next) => {
  // 본문 크기로 미리 용량 초과를 걸러 불필요한 업로드를 막는다
  const incoming = Number(req.headers['content-length'] || 0);
  if (roomSize(req.room) + incoming > MAX_ROOM_SIZE + 64 * 1024) {
    return res.status(413).json({ success: false, message: `방 용량(${formatMB(MAX_ROOM_SIZE)})을 초과합니다.` });
  }
  next();
}, (req, res) => {
  upload.array('files')(req, res, err => {
    const uploaded = req.files || [];
    const cleanup = () => uploaded.forEach(f => fs.rm(f.path, { force: true }, () => {}));

    if (err) {
      cleanup();
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? `방 용량(${formatMB(MAX_ROOM_SIZE)})을 초과합니다.`
        : '업로드에 실패했습니다.';
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, message });
    }
    if (!uploaded.length) return res.status(400).json({ success: false, message: '파일이 없습니다.' });

    const room = getRoom(req.params.room);
    if (!room) { cleanup(); return res.status(404).json({ success: false, message: '방이 닫혔습니다.' }); }

    const addSize = uploaded.reduce((s, f) => s + f.size, 0);
    if (roomSize(room) + addSize > MAX_ROOM_SIZE) {
      cleanup();
      return res.status(413).json({ success: false, message: `방 용량(${formatMB(MAX_ROOM_SIZE)})을 초과합니다.` });
    }
    if (room.files.size + uploaded.length > MAX_FILES_PER_ROOM) {
      cleanup();
      return res.status(400).json({ success: false, message: `방당 최대 ${MAX_FILES_PER_ROOM}개 파일까지 올릴 수 있습니다.` });
    }

    const added = uploaded.map(f => {
      const meta = {
        id: f.filename,
        name: decodeFileName(f.originalname),
        size: f.size,
        type: f.mimetype || 'application/octet-stream',
        uploadedAt: Date.now(),
      };
      room.files.set(meta.id, meta);
      return meta;
    });

    console.log(`[${req.params.room}] 업로드: ${added.map(f => f.name).join(', ')}`);
    broadcast(req.params.room);
    res.json({ success: true, files: added });
  });
});

// 이미지 미리보기만 inline 허용 (SVG/HTML은 스크립트 실행 위험이 있어 제외)
const INLINE_TYPES = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/;

app.get('/api/rooms/:room/files/:id', requireRoom, (req, res) => {
  const meta = req.room.files.get(req.params.id);
  if (!meta) return res.status(404).send('파일을 찾을 수 없습니다.');
  const filePath = path.join(roomDir(req.params.room), meta.id);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.query.inline === '1' && INLINE_TYPES.test(meta.type)) {
    res.type(meta.type);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.sendFile(filePath);
  }
  // res.download는 RFC 5987(filename*=UTF-8'') 형식으로 이름을 보내 한글이 깨지지 않는다
  res.download(filePath, meta.name);
});

app.delete('/api/rooms/:room/files/:id', requireRoom, (req, res) => {
  const meta = req.room.files.get(req.params.id);
  if (!meta) return res.status(404).json({ success: false });
  req.room.files.delete(meta.id);
  fs.rm(path.join(roomDir(req.params.room), meta.id), { force: true }, () => {});
  console.log(`[${req.params.room}] 삭제: ${meta.name}`);
  broadcast(req.params.room);
  res.json({ success: true });
});

// 전체 파일 ZIP 다운로드
app.get('/api/rooms/:room/zip', requireRoom, (req, res) => {
  const files = [...req.room.files.values()];
  if (!files.length) return res.status(404).send('파일이 없습니다.');

  res.attachment(`FileDrop-${req.params.room}.zip`);
  const archive = archiver('zip', { zlib: { level: 1 } });
  archive.on('error', err => { console.error('zip 오류:', err); res.destroy(err); });
  archive.pipe(res);

  const used = new Set();
  for (const f of files) {
    let name = f.name;
    const ext = path.extname(name);
    const base = name.slice(0, name.length - ext.length);
    for (let i = 1; used.has(name.toLowerCase()); i++) name = `${base} (${i})${ext}`;
    used.add(name.toLowerCase());
    archive.file(path.join(roomDir(req.params.room), f.id), { name });
  }
  archive.finalize();
});

// 방 입장용 QR 코드
app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '');
  if (!text || text.length > 300) return res.status(400).send('bad request');
  try {
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.type('image/svg+xml').setHeader('Cache-Control', 'public, max-age=86400');
    res.send(svg);
  } catch {
    res.status(500).send('error');
  }
});

// 헬스 체크 (무중단 모니터링/핑 용도)
app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.size }));

// ───────────────────────── 실시간 ─────────────────────────
io.on('connection', socket => {
  const leaveCurrent = () => {
    const code = socket.data.room;
    if (!code) return;
    socket.leave(code);
    socket.data.room = null;
    broadcast(code);
    if (userCount(code) === 0) scheduleCleanup(code);
  };

  socket.on('join-room', (code, ack) => {
    if (typeof ack !== 'function') ack = () => {};
    if (!ROOM_CODE_RE.test(code || '')) return ack({ ok: false, message: '4자리 숫자 코드를 입력하세요.' });
    if (socket.data.room && socket.data.room !== code) leaveCurrent();

    const room = getRoom(code, true);
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
    socket.join(code);
    socket.data.room = code;
    ack({ ok: true });
    broadcast(code);
  });

  socket.on('leave-room', leaveCurrent);
  socket.on('disconnect', leaveCurrent);

  socket.on('text-add', (content, ack) => {
    if (typeof ack !== 'function') ack = () => {};
    const code = socket.data.room;
    const room = getRoom(code);
    if (!room) return ack({ ok: false, message: '방에 먼저 입장하세요.' });
    if (typeof content !== 'string' || !content.trim()) return ack({ ok: false, message: '내용을 입력하세요.' });
    if (content.length > MAX_TEXT_LENGTH) return ack({ ok: false, message: `텍스트는 최대 ${MAX_TEXT_LENGTH.toLocaleString()}자까지 가능합니다.` });

    room.texts.push({ id: crypto.randomUUID(), content, createdAt: Date.now() });
    if (room.texts.length > MAX_TEXTS_PER_ROOM) room.texts.splice(0, room.texts.length - MAX_TEXTS_PER_ROOM);
    ack({ ok: true });
    broadcast(code);
  });

  socket.on('text-delete', id => {
    const code = socket.data.room;
    const room = getRoom(code);
    if (!room) return;
    const before = room.texts.length;
    room.texts = room.texts.filter(t => t.id !== id);
    if (room.texts.length !== before) broadcast(code);
  });
});

function formatMB(bytes) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)}GB` : `${Math.round(bytes / 1024 ** 2)}MB`;
}

server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});

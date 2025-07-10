const MAX_ROOM_SIZE = 500 * 1024 * 1024; // MB

const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});

const uploadBase = path.join(__dirname, 'uploads');



// 정적 파일 서빙
app.use(express.static(path.join(__dirname, '../public')));

//uploads 폴더가 없으면 생성
if (!fs.existsSync(uploadBase)) fs.mkdirSync(uploadBase);

//방 디렉토리 생성 함수
function getRoomDir(roomCode) {
  if (!roomCode || typeof roomCode !== 'string') {
    console.error('roomCode is invalid:', roomCode);
    return null;
  }

  const safeRoom = roomCode.replace(/[^a-zA-Z0-9_-]/g, '');
  const dir = path.join(uploadBase, safeRoom);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  return dir;
}


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const room = req.params.room;
    if (!room) {
      console.error('업로드 요청에 room 정보 없음');
      return cb(new Error('Room code missing'), null);
    }
    const roomDir = getRoomDir(room);
    if (!roomDir) return cb(new Error('Room directory invalid'), null);
    cb(null, roomDir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '_' + file.originalname;
    cb(null, unique);
  }
});
const upload = multer({ storage });


function getRoomSize(dirPath) {
  return new Promise((resolve, reject) => {
    fs.readdir(dirPath, (err, files) => {
      if (err) return resolve(0); // 폴더 없으면 0으로 처리
      let total = 0;
      let remaining = files.length;

      if (remaining === 0) return resolve(0);

      files.forEach(file => {
        const filePath = path.join(dirPath, file);
        fs.stat(filePath, (err, stats) => {
          if (!err && stats.isFile()) total += stats.size;
          if (--remaining === 0) resolve(total);
        });
      });
    });
  });
}


app.post('/upload/:room', upload.single('file'), async (req, res) => {
  const room = req.params.room;
  const fileName = req.file?.filename;
  const fileSize = req.file?.size;

  if (!fileName || !fileSize) {
    return res.status(400).json({ success: false, message: '파일 정보 없음' });
  }

  const roomDir = getRoomDir(room);
  const currentSize = await getRoomSize(roomDir);

  if (currentSize + fileSize > MAX_ROOM_SIZE) {
    // 업로드된 파일 삭제
    fs.unlinkSync(path.join(roomDir, fileName));
    console.warn(`방 [${room}] 용량 초과로 업로드 거부`);

    return res.status(400).json({
      success: false,
      message: `이 방에는 최대 ${MAX_ROOM_SIZE / (1024 * 1024)}MB까지만 저장할 수 있습니다.`,
    });
  }

  console.log(`[${room}] 업로드됨: ${fileName}`);
  broadcastFileList(room);
  res.json({ success: true });
});



//삭제 라우터
app.delete('/delete/:filename', (req, res) => {
  const filename = req.params.filename;
  const room = req.query.room;
  const filePath = path.join(getRoomDir(room), filename);

  fs.unlink(filePath, err => {
    if (err) {
      console.error(`[${room}] 삭제 실패:`, err);
      return res.status(500).json({ success: false });
    }

    console.log(`[${room}] 삭제됨: ${filename}`);
    broadcastFileList(room);
    res.json({ success: true });
  });
});

//업로드된 파일 static 제공
app.use('/uploads', express.static(uploadBase));

//파일 목록 전송
function sendFileList(socket, room) {
  const dir = getRoomDir(room);
  fs.readdir(dir, async (err, files) => {
    if (err) return;
    const filtered = files.filter(name => !name.startsWith('.'));

    let totalSize = 0;
    await Promise.all(
      filtered.map(name => {
        return new Promise(resolve => {
          const filePath = path.join(dir, name);
          fs.stat(filePath, (err, stat) => {
            if (!err && stat.isFile()) totalSize += stat.size;
            resolve();
          });
        });
      })
    );

    socket.emit('file-list', {
      files: filtered,
      totalSize,
      maxSize: MAX_ROOM_SIZE
    });
  });
}


function broadcastFileList(room) {
  const dir = getRoomDir(room);
  fs.readdir(dir, async (err, files) => {
    if (err) return;
    const filtered = files.filter(name => !name.startsWith('.'));

    // 용량 계산
    let totalSize = 0;
    await Promise.all(
      filtered.map(name => {
        return new Promise(resolve => {
          const filePath = path.join(dir, name);
          fs.stat(filePath, (err, stat) => {
            if (!err && stat.isFile()) totalSize += stat.size;
            resolve();
          });
        });
      })
    );

    io.to(room).emit('file-list', {
      files: filtered,
      totalSize,
      maxSize: MAX_ROOM_SIZE
    });
  });
}


//WebSocket 연결
io.on('connection', socket => {
  console.log('클라이언트 연결됨');

  //방 입장
  socket.on('join-room', room => {
    socket.join(room);
    socket.joinedRoom = room; // 방 정보 기억
    console.log(`방 입장: ${room}`);
    sendFileList(socket, room); // 파일 목록 전송
  });

  //클라이언트 퇴장 처리
  socket.on('disconnect', () => {
    const room = socket.joinedRoom;
    if (!room) return;

    // 잠시 후 방에 아무도 없으면 폴더 삭제
    setTimeout(() => {
      const roomUsers = io.sockets.adapter.rooms.get(room);
      if (!roomUsers || roomUsers.size === 0) {
        console.log(`방 ${room}에 아무도 없으므로 디렉토리 삭제`);

        const dir = getRoomDir(room);
        if (fs.existsSync(dir)) {
          fs.rm(dir, { recursive: true, force: true }, err => {
            if (err) {
              console.error(`디렉토리 삭제 실패 [${room}]:`, err);
            } else {
              console.log(`[${room}] 디렉토리와 파일들 삭제 완료`);
            }
          });
        }
      }
    }, 60000); // 1분 후 검사 및 삭제
  });
});
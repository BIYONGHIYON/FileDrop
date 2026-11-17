# 📁 FileDrop

**간편한 웹 기반 실시간 파일 공유 서비스**  
*A simple real-time web-based file sharing service*

---

## 🚀 소개 (Introduction)

**FileDrop**은 공유 코드를 통해 실시간으로 파일을 업로드하고 다운로드할 수 있는 간편한 웹 앱입니다.  
별도의 인증 없이 누구나 사용할 수 있습니다.  
*FileDrop is a simple real-time file sharing app via a shared code. Anyone can use it without any authentication.*

---

## 🔧 주요 기능 (Features)

- 🔒 **4자리 코드 기반 방 입장** — 링크(`/#1234`)나 QR 코드로도 바로 입장
  *Join rooms with a 4-digit code, a share link, or a QR code*

- 📤 **여러 파일 동시 업로드** — 드래그 앤 드롭(화면 어디든), 파일 선택, 붙여넣기(Ctrl/⌘+V)
  *Multi-file upload via drag & drop, picker, or paste*

- 📊 **파일별 업로드 진행률 & 취소**
  *Per-file upload progress with cancel*

- 📝 **텍스트 공유** — 링크·메모·코드를 실시간 공유, 원클릭 복사, URL 자동 링크
  *Real-time text sharing with one-click copy*

- 🖼 **이미지 썸네일 & 미리보기**, 📦 **전체 파일 ZIP 다운로드**
  *Image thumbnails/preview and download-all as ZIP*

- 🇰🇷 **한글 파일명 지원** — 업로드·다운로드·ZIP 모두 깨지지 않음 (macOS 자모 분리 이름도 정상화)
  *Unicode filenames preserved end-to-end*

- 👥 **접속 기기 수 표시**, 📦 **방별 용량 제한 & 사용량 표시**
  *Connected device count and per-room storage limit*

- 🔄 **자동 재연결** — 서버가 잠들었다 깨어나도 방에 다시 접속
  *Auto-rejoin after reconnect*

---

## 📥 사용 방법 (Usage)

[FileDrop](filedrop-nqub.onrender.com) 사이트로 접속 후 잠시 대기하면 연결됩니다.

## 로컬 사용자
### 1. 설치 (Setup)

```bash
git clone https://github.com/BIYONGHIYON/FileDrop.git
cd FileDrop
cd server
npm install
node index.js
```

### 2. 접속 (Run)

브라우저에서 아래 주소로 접속합니다:

📎 http://localhost:3000

---

## 🛠 기술 스택 (Tech Stack)

- **Frontend**: HTML, CSS, JavaScript  
- **Backend**: Node.js, Express  
- **실시간 통신**: Socket.IO  
- **파일 업로드**: Multer  
- **파일 시스템**: Node.js FS module
- **ZIP / QR**: archiver, qrcode

---

## 💾 저장 용량 설정 (Capacity)

환경 변수 `MAX_ROOM_SIZE_MB`로 방당 최대 용량을 설정할 수 있습니다 (기본 500MB):

```bash
MAX_ROOM_SIZE_MB=1000 node index.js
```

---

## ⚠️ 주의 사항 (Caution)

- 방에 접속한 사용자가 없으면, 업로드된 파일은 **1분 후 자동 삭제**됩니다.
- 서버를 재시작하면 업로드된 파일도 **모두 초기화**됩니다.

---

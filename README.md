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

- 🔒 **4자리 코드 기반 방 생성 및 입장**  
  *Create and join rooms with a 4-digit code*

- 📤 **파일 업로드 & 삭제**  
  *Upload and delete files*

- 📁 **실시간 파일 목록 공유 (WebSocket)**  
  *Real-time file list sharing (via WebSocket)*

- 📦 **방별 저장 용량 제한 및 사용량 표시**  
  *Per-room storage limit and usage display*

- 📊 **업로드 용량 프로그레스바**  
  *Upload progress bar for room storage*

- 🚫 **용량 초과 시 업로드 차단 및 애니메이션 반응**  
  *Prevent upload when exceeding limit, with animation feedback*

---

## 📥 사용 방법 (Usage)

### filedrop-nqub.onrender.com 사이트로 접속 후 잠시 대기하면 연결됩니다.

## 🛠 기술 스택 (Tech Stack)

- **Frontend**: HTML, CSS, JavaScript, Tailwind CSS  
- **Backend**: Node.js, Express  
- **실시간 통신**: Socket.IO  
- **파일 업로드**: Multer  
- **파일 시스템**: Node.js FS module

---

## 💾 저장 용량 설정 (Capacity)

서버 코드의 `MAX_ROOM_SIZE` 변수로 최대 업로드 용량을 설정할 수 있습니다:

```js
const MAX_ROOM_SIZE = 100 * 1024 * 1024; // 100MB
```

---

## ⚠️ 주의 사항 (Caution)

- 방에 접속한 사용자가 없으면, 업로드된 파일은 **1분 후 자동 삭제**됩니다.
- 서버를 재시작하면 업로드된 파일도 **모두 초기화**됩니다.

---

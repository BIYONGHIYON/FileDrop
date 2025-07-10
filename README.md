project:
  name: FileDrop
  description:
    ko: "간편한 웹 기반 실시간 파일 공유 서비스"
    en: "A simple real-time web-based file sharing service"

features:
  - icon: 🔒
    ko: "4자리 코드 기반 방 생성 및 입장"
    en: "Create and join rooms with a 4-digit code"
  - icon: 📤
    ko: "파일 업로드 & 삭제"
    en: "Upload and delete files"
  - icon: 📁
    ko: "실시간 파일 목록 공유 (WebSocket)"
    en: "Real-time file list sharing (via WebSocket)"
  - icon: 📦
    ko: "방별 저장 용량 제한 및 사용량 표시"
    en: "Per-room storage limit and usage display"
  - icon: 📊
    ko: "업로드 용량 프로그레스바"
    en: "Upload progress bar for room storage"
  - icon: 🚫
    ko: "용량 초과 시 업로드 차단 및 애니메이션 반응"
    en: "Prevent upload when exceeding limit, with animation feedback"

usage:
  setup:
    steps:
      - git clone https://github.com/BIYONGHIYON/FileDrop.git
      - cd FileDrop
      - npm install
      - node index.js
  run:
    url: http://localhost:3000

tech_stack:
  frontend: ["HTML", "CSS", "JavaScript", "Tailwind CSS"]
  backend: ["Node.js", "Express"]
  realtime: ["Socket.IO"]
  file_upload: ["Multer"]
  filesystem: ["Node.js FS module"]

capacity:
  note:
    ko: "최대 용량은 서버 코드의 MAX_ROOM_SIZE 변수로 설정됩니다."
    en: "Maximum capacity is set via MAX_ROOM_SIZE in the server code."
  example: |
    const MAX_ROOM_SIZE = 100 * 1024 * 1024; // 100MB

caution:
  - ko: "업로드한 파일은 방에 사람이 없을 경우 1분 뒤 자동 삭제됩니다."
    en: "If no one is in the room, uploaded files are deleted after 1 minute."
  - ko: "서버 재시작 시 모든 업로드 파일도 초기화됩니다."
    en: "All uploaded files are reset on server restart."

intro:
  ko: "FileDrop은 공유 코드를 통해 실시간으로 파일을 업로드하고 다운로드할 수 있는 간편한 웹 앱입니다. 별도의 인증 없이 누구나 사용할 수 있습니다."
  en: "FileDrop is a simple real-time file sharing app via a shared code. Anyone can use it without any authentication."

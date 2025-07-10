document.addEventListener('DOMContentLoaded', () => {
  //h1 클릭 시 방 나가기
  document.getElementById('title').addEventListener('click', () => {
    if (!currentRoom) return;
    socket.emit('leave-room', currentRoom);
    // 초기화
    currentRoom = '';
    fileInput.value = '';
    listEl.innerHTML = '';
    document.getElementById('capacity').textContent = '';
    const bar = document.getElementById('capacityBar');
    if (bar) bar.style.width = '0%';

    // 화면 전환
    document.getElementById('mainScreen').style.display = 'none';
    document.getElementById('joinScreen').style.display = 'block';
  });

  const socket = io();

  let currentRoom = '';

  const fileInput = document.getElementById('file');
  const result = document.getElementById('result');
  const listEl = document.getElementById('fileList');
  const dropArea = document.getElementById('dropArea');
  const joinBtn = document.getElementById('joinBtn');
  const roomInput = document.getElementById('roomInput');
  const uploadForm = document.getElementById('uploadForm');

  roomInput.addEventListener('input', () => {
    const isValid = /^\d{4}$/.test(roomInput.value.trim());
    joinBtn.classList.toggle('show', isValid);
  });


  roomInput.addEventListener('input', () => {
    // 5자리 이상일 경우 자르기
    if (roomInput.value.length > 4) {
      roomInput.value = roomInput.value.slice(0, 4);
    }

    // 유효성 검사 후 버튼 표시
    const isValid = /^\d{4}$/.test(roomInput.value.trim());
    joinBtn.classList.toggle('show', isValid);
  });

  //방 입장
  joinBtn.addEventListener('click', () => {
    const room = roomInput.value.trim();
    if (!room || room.length !== 4) {
      alert('4자리 공유 코드를 입력하세요.');
      return;
    }
    currentRoom = room;
    socket.emit('join-room', room);
    result.textContent = `${room}`;

    //화면 전환
    document.getElementById('joinScreen').style.display = 'none';
    document.getElementById('mainScreen').style.display = 'block';
  });
  roomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const room = roomInput.value.trim();
      const isValid = /^\d{4}$/.test(room);
      if (isValid) {
        joinBtn.click();
      }
    }
  });
  //파일 업로드
  async function uploadFile(file) {
    if (!currentRoom) return alert('방에 먼저 입장하세요.');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('room', currentRoom);

    try {
      const res = await fetch(`/upload/${currentRoom}`, {
        method: 'POST',
        body: formData
      });

      const json = await res.json();
      fileInput.value = '';

      if (!res.ok || !json.success) {
        //업로드 실패: dropArea 흔들리게 하기
        const drop = document.getElementById('dropArea');
        drop.classList.add('drop-error');

        setTimeout(() => {
          drop.classList.remove('drop-error');
        }, 500);

        return; // 실패 시 종료
      }

    } catch (err) {
      console.error('업로드 오류:', err);
    }
  }


  //파일 선택 시 자동 업로드
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      uploadFile(fileInput.files[0]);
    }
  });

  //드래그 앤 드롭 업로드
  if (dropArea) {
    ['dragenter', 'dragover'].forEach(event => {
      dropArea.addEventListener(event, e => {
        e.preventDefault();
        dropArea.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(event => {
      dropArea.addEventListener(event, e => {
        e.preventDefault();
        dropArea.classList.remove('dragover');
      });
    });

    dropArea.addEventListener('drop', e => {
      const files = e.dataTransfer.files;
      if (files.length) {
        uploadFile(files[0]);
      }
    });
  }

  //서버로부터 받은 파일 목록 렌더링
  function renderList(files) {
    listEl.innerHTML = '';
    files
      .filter(name => !name.startsWith('.'))
      .forEach(name => {
        const li = document.createElement('li');

        const link = document.createElement('a');
        link.href = `/uploads/${encodeURIComponent(currentRoom)}/${encodeURIComponent(name)}`;
        link.download = name;
        link.textContent = name;

        const delBtn = document.createElement('button');
        delBtn.textContent = '\u274C';
        delBtn.className = 'delete-btn';
        delBtn.type = 'button';
        delBtn.setAttribute('data-name', name);

        li.appendChild(link);
        li.appendChild(delBtn);
        listEl.appendChild(li);
      });
  }

  //삭제 버튼 클릭 이벤트 위임
  listEl.addEventListener('click', async (e) => {
    const btn = e.target;
    if (btn.classList.contains('delete-btn')) {
      const filename = btn.getAttribute('data-name');
      const res = await fetch(`/delete/${encodeURIComponent(filename)}?room=${encodeURIComponent(currentRoom)}`, {
        method: 'DELETE',
      });

      const json = await res.json();
    }
  });

  //실시간 파일 목록 수신
  socket.on('file-list', ({ files, totalSize, maxSize }) => {
    renderList(files);
    updateCapacityBar(totalSize, maxSize);
    document.getElementById('noticeText').textContent = `Max ${formatBytes(maxSize)} per Room`;
  });

  function updateCapacityBar(used, max) {
    const percent = Math.min((used / max) * 100, 100);
    document.getElementById('capacity').textContent = `${formatBytes(used)}`;

    const bar = document.getElementById('capacityBar');
    if (bar) {
      if (percent >= 95) {
        bar.style.background = 'linear-gradient(to right, #ff1f1f, #ff0000)';
      } else if (percent >= 80) {
        bar.style.background = 'linear-gradient(to right, #ff7a00, #ff4d00)';
      } else {
        bar.style.background = 'linear-gradient(to right, #2eadff, #3654ff)';
      }
      bar.style.width = percent + '%';
    }
  }

  function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
  }

});
// 카드 클릭 시 value 표시 후 자동 복원 (모바일 대응)
document.querySelectorAll('.card').forEach(card => {
  card.addEventListener('click', () => {
    const label = card.querySelector('.label');
    const value = card.querySelector('.value');

    // 이미 전환 중이면 무시
    if (!label || !value || value.classList.contains('visible')) return;

    label.style.opacity = '0';
    value.style.opacity = '1';
    value.classList.add('visible');

    setTimeout(() => {
      label.style.opacity = '1';
      value.style.opacity = '0';
      value.classList.remove('visible');
    }, 2000); // 2초 후 원래대로
  });
});

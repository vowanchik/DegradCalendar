const active = new Set();
window.partyupAudio.onRequest(({ id, action, source }) => {
  const audio = new Audio(source);
  let settled = false;
  const result = (error) => {
    if (settled) return;
    settled = true;
    window.partyupAudio.respond({ id, error });
  };
  const cleanup = () => {
    audio.pause();
    audio.removeAttribute('src');
    active.delete(audio);
  };
  audio.onerror = () => {
    result('Не удалось прочитать звук. Попробуйте WAV или MP3.');
    cleanup();
  };
  audio.onloadedmetadata = async () => {
    if (!Number.isFinite(audio.duration) || audio.duration > 30) {
      result('Длительность звука должна быть до 30 секунд');
      cleanup();
      return;
    }
    if (action === 'validate') {
      result();
      cleanup();
      return;
    }
    try {
      await audio.play();
      result();
    } catch {
      result('Не удалось воспроизвести звук');
      cleanup();
    }
  };
  audio.onended = cleanup;
  active.add(audio);
  setTimeout(() => {
    if (!settled) result('Не удалось прочитать звуковой файл');
    cleanup();
  }, 32000);
});

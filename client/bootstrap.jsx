/* Semua <script type="text/babel"> berbagi scope global. Berkas ini hanya
   menambah utilitas ke window.UI yang dibuat client/components.jsx. */
window.UI = Object.assign({}, window.UI || {});

(function () {
  'use strict';
  const GE = window.GameEngine;
  const CSV_HEADER = GE.CSV_HEADER;
  const CSV_SAMPLE_ROWS = GE.CSV_SAMPLE_ROWS;

  function downloadTemplate() {
    const content = [CSV_HEADER, ...CSV_SAMPLE_ROWS].join('\r\n');
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'template_soal_eduladder.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function formatTime(seconds) {
    const pad = (value) => String(Math.max(0, Math.floor(value))).padStart(2, '0');
    return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
  }

  /* Kompensasi jaringan saat menghitung tampilan: angka dibulatkan ke atas
     sehingga pad ini mencegah soal "berakhir" satu detik terlalu cepat. */
  const COUNTDOWN_SAFETY_PAD_MS = 250;

  /* Sisa detik countdown terhadap deadline server. `limit` (durasi soal)
     menjaga angka tidak pernah melebihi durasi walau jam perangkat meleset;
     offset jam server diambil dari client/net.js. */
  function useCountdown(deadline, limit) {
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
      if (!deadline) return undefined;
      const id = setInterval(() => setNow(Date.now()), 250);
      return () => clearInterval(id);
    }, [deadline]);
    if (!deadline) return null;
    const offset = window.Net && window.Net.getClockOffset ? window.Net.getClockOffset() : 0;
    return GE.remainingSeconds(deadline, limit, offset, COUNTDOWN_SAFETY_PAD_MS, now);
  }

  window.UI = Object.assign({}, window.UI || {}, { downloadTemplate: downloadTemplate, formatTime: formatTime, useCountdown: useCountdown });
})();

if (!React || !window.GameEngine) {
  console.error('[bootstrap] React/GameEngine belum tersedia; periksa urutan script di index.html');
}

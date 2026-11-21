/* Semua <script type="text/babel"> berbagi scope global; berkas ini
   dibungkus IIFE agar binding top-level tidak bentrok antar berkas. */
(function () {
  'use strict';

  /* Warna aksen tiap jenis bantuan (ikut kelas `cls` di engine). */
  const HELP_TONES = {
    throw: { badge: 'bg-orange-100 text-orange-700 ring-orange-200', icon: 'bg-orange-100 text-orange-600' },
    clue: { badge: 'bg-yellow-100 text-yellow-800 ring-yellow-200', icon: 'bg-yellow-100 text-yellow-700' },
    shield: { badge: 'bg-sky-100 text-sky-700 ring-sky-200', icon: 'bg-sky-100 text-sky-600' },
    change: { badge: 'bg-purple-100 text-purple-700 ring-purple-200', icon: 'bg-purple-100 text-purple-600' },
    double: { badge: 'bg-pink-100 text-pink-700 ring-pink-200', icon: 'bg-pink-100 text-pink-600' },
    penawar: { badge: 'bg-emerald-100 text-emerald-700 ring-emerald-200', icon: 'bg-emerald-100 text-emerald-600' },
    eliminate: { badge: 'bg-red-100 text-red-700 ring-red-200', icon: 'bg-red-100 text-red-600' },
  };

  const SECTION_TONES = {
    mulai: 'border-indigo-200 bg-indigo-50/40',
    giliran: 'border-sky-200 bg-sky-50/40',
    jawaban: 'border-emerald-200 bg-emerald-50/40',
    papan: 'border-amber-200 bg-amber-50/40',
    bantuan: 'border-purple-200 bg-purple-50/40',
    senjata: 'border-rose-200 bg-rose-50/40',
    status: 'border-teal-200 bg-teal-50/40',
    selama: 'border-slate-200 bg-slate-50/60',
    selesai: 'border-yellow-200 bg-yellow-50/40',
  };

  const SECTION_ICONS = {
    mulai: 'fa-solid fa-door-open',
    giliran: 'fa-solid fa-arrows-rotate',
    jawaban: 'fa-solid fa-lightbulb',
    papan: 'fa-solid fa-dice-five',
    bantuan: 'fa-solid fa-wand-magic-sparkles',
    senjata: 'fa-solid fa-bomb',
    status: 'fa-solid fa-shield-halved',
    selama: 'fa-solid fa-circle-info',
    selesai: 'fa-solid fa-trophy',
  };

  function chipList(pairs) {
    return pairs.map((pair) => `${pair[0]} → ${pair[1]}`).join(', ');
  }

  /* Bangun isi panduan dari konstanta engine supaya teks tidak basi saat
     bantuan/senjata/papan berubah. Murni: tanpa DOM, tanpa state. */
  function buildGuideSections(options) {
    const GE = window.GameEngine;
    const opts = options || {};
    const quotas = GE.sanitizeHelpQuotas(opts.quotas, GE.DEFAULT_HELPS());
    const allowLateJoin = opts.allowLateJoin !== false;
    const minPlayers = GE.MIN_PLAYERS || 2;
    const minQuestions = GE.MIN_QUESTIONS || 3;

    const startItems = [
      {
        icon: 'fa-solid fa-qrcode',
        label: 'Gabung room',
        text: 'Masukkan kode room atau pindai QR yang ditampilkan admin di lobi.',
      },
      {
        icon: 'fa-solid fa-user-gear',
        label: 'Pilih karakter',
        text: `Ada ${GE.CHARACTERS.length} karakter; boleh sama antar pemain. Yang membedakan di papan adalah warna dan nomor urut.`,
      },
      {
        icon: 'fa-solid fa-play',
        label: 'Admin memulai',
        text: `Butuh minimal ${minPlayers} pemain dan bank soal minimal ${minQuestions} soal (atau sebanyak jumlah pemain bila lebih banyak). Admin menekan Mulai Permainan, lalu ada hitung mundur 5 detik.`,
      },
      {
        icon: 'fa-solid fa-list-ol',
        label: 'Urutan giliran',
        text: 'Giliran pertama milik pemain yang bergabung lebih dulu, lalu berputar sesuai urutan bergabung.',
      },
    ];
    if (allowLateJoin) {
      startItems.push({
        icon: 'fa-solid fa-user-plus',
        label: 'Join saat berjalan',
        text: 'Room ini mengizinkan pemain baru bergabung saat permainan berjalan; ia mulai di kotak 1 dan ikut pada giliran berikutnya.',
      });
    } else {
      startItems.push({
        icon: 'fa-solid fa-eye',
        label: 'Join saat berjalan',
        text: 'Room ini tidak mengizinkan pemain baru masuk saat permainan berjalan; tamu yang datang belakangan menjadi penonton.',
      });
    }

    const helpItems = GE.HELPS.map((help) => {
      const quota = quotas[help.key];
      const tone = HELP_TONES[help.cls] || HELP_TONES.throw;
      return {
        icon: help.icon,
        iconClass: tone.icon,
        label: help.label,
        text: help.desc,
        badge: quota > 0 ? `×${quota}` : 'nonaktif',
        badgeClass: quota > 0 ? tone.badge : 'bg-slate-200 text-slate-500 ring-slate-300',
      };
    });

    const weaponItems = GE.WEAPONS.map((weapon) => ({
      icon: weapon.icon,
      iconClass: 'bg-rose-100 text-rose-600',
      label: weapon.label,
      text: GE.WEAPON_DESCRIPTIONS[weapon.key] || '',
      badge: '',
      dot: weapon.tone,
    }));

    return [
      {
        key: 'mulai',
        title: 'Sebelum mulai',
        icon: SECTION_ICONS.mulai,
        accent: SECTION_TONES.mulai,
        items: startItems,
      },
      {
        key: 'giliran',
        title: 'Alur giliran',
        icon: SECTION_ICONS.giliran,
        accent: SECTION_TONES.giliran,
        items: [
          {
            icon: 'fa-solid fa-eye',
            label: 'Hanya giliranmu',
            text: 'Soal dan panel aksi muncul pada pemain yang sedang mendapat giliran (layar admin/IFP juga menampilkannya). Pemain lain melihat papan dan penanda menunggu giliran.',
          },
          {
            icon: 'fa-solid fa-hand-pointer',
            label: 'Tekan Lanjutkan',
            text: 'Setelah jawaban diberikan atau waktu habis, layar giliran berikutnya tampil. Pemain berikutnya menekan Lanjutkan dan timer soal mulai dari nol.',
          },
          {
            icon: 'fa-solid fa-hourglass-half',
            label: 'Waktu habis = salah',
            text: 'Kalau timer habis sebelum menjawab, jawaban dianggap salah dan giliran berpindah.',
          },
        ],
      },
      {
        key: 'jawaban',
        title: 'Menjawab',
        icon: SECTION_ICONS.jawaban,
        accent: SECTION_TONES.jawaban,
        items: [
          {
            icon: 'fa-solid fa-circle-check',
            label: 'Benar',
            text: 'Kamu maju sesuai nilai reward soal. Double Move menggandakan langkahnya.',
          },
          {
            icon: 'fa-solid fa-circle-xmark',
            label: 'Salah',
            text: 'Kamu mundur sesuai nilai penalty soal, kecuali ditahan Shield, Penawar, atau langkahmu terkunci.',
          },
          {
            icon: 'fa-solid fa-clock',
            label: 'Timer',
            text: 'Hitung mundur mengikuti jam server dan tidak pernah melebihi durasi soal, jadi jam perangkat yang meleset tidak memengaruhi permainan.',
          },
        ],
      },
      {
        key: 'papan',
        title: 'Papan, tangga, dan ular',
        icon: SECTION_ICONS.papan,
        accent: SECTION_TONES.papan,
        items: [
          {
            icon: 'fa-solid fa-stairs',
            label: 'Tangga (naik)',
            text: `Kotak kaki tangga: ${chipList(Object.entries(GE.LADDERS))}. Berhenti di kaki tangga memicu soal bonus; benar naik, salah tetap di kaki tangga.`,
          },
          {
            icon: 'fa-solid fa-staff-snake',
            label: 'Ular (turun)',
            text: `Kotak kepala ular: ${chipList(Object.entries(GE.SNAKES))}. Berhenti di kepala ular memicu soal bonus; benar lolos, salah turun mengikuti ular.`,
          },
          {
            icon: 'fa-solid fa-bomb',
            label: 'Kotak senjata',
            text: `Kotak ${GE.WEAPON_CELLS.join(', ')} memberi senjata saat kamu berhenti di sana. Slot penuh (maksimal ${GE.ARMS_CAPACITY}) membuat senjata baru dilepas.`,
          },
          {
            icon: 'fa-solid fa-flag-checkered',
            label: 'Menang',
            text: `Kemenangan terjadi saat mencapai kotak ${GE.WIN_POSITION}. Bila bank soal habis lebih dulu, permainan ditutup dan peringkat ditentukan dari posisi, lalu sisa bantuan.`,
          },
        ],
      },
      {
        key: 'bantuan',
        title: 'Bantuan (7 jenis)',
        icon: SECTION_ICONS.bantuan,
        accent: SECTION_TONES.bantuan,
        intro: 'Bantuan hanya bisa dipakai pada giliranmu sendiri dan sebelum menjawab. Kuota mengikuti room ini: 0 berarti tidak aktif.',
        items: helpItems,
      },
      {
        key: 'senjata',
        title: 'Senjata & efeknya',
        icon: SECTION_ICONS.senjata,
        accent: SECTION_TONES.senjata,
        intro: `Senjata diambil dari kotak senjata, maksimal ${GE.ARMS_CAPACITY} slot. Satu serangan per giliran: pilih lawan, lalu soal dijeda selama animasi serangan.`,
        items: weaponItems,
        notes: [
          'Shield lawan menyerap satu serangan; serangan itu hangus dan tidak memberi efek lain.',
          'Bom, Magnet, dan Perangkap mengunci langkah maju target selama satu giliran.',
        ],
      },
      {
        key: 'status',
        title: 'Status & efek',
        icon: SECTION_ICONS.status,
        accent: SECTION_TONES.status,
        items: [
          {
            icon: 'fa-solid fa-shield-halved',
            label: 'Shield',
            text: 'Menahan satu serangan senjata, satu hukuman jawaban salah, atau satu gigitan ular. Shield yang belum terpakai hilang saat giliranmu berikutnya dimulai.',
          },
          {
            icon: 'fa-solid fa-prescription-bottle-medical',
            label: 'Penawar',
            text: 'Membatalkan hukuman mundur pada giliran tersebut.',
          },
          {
            icon: 'fa-solid fa-bolt',
            label: 'Double Move',
            text: 'Langkah maju karena jawaban benar menjadi dua kali lipat.',
          },
          {
            icon: 'fa-solid fa-lock',
            label: 'Kunci langkah',
            text: 'Akibat Bom, Magnet, atau Perangkap: kamu tidak bisa maju pada giliran itu.',
          },
          {
            icon: 'fa-solid fa-arrow-right-arrow-left',
            label: 'Kunci soal',
            text: 'Akibat Lempar Soal: bantuanmu terkunci sampai soal berpindah ke pemain berikutnya.',
          },
        ],
      },
      {
        key: 'selama',
        title: 'Selama permainan',
        icon: SECTION_ICONS.selama,
        accent: SECTION_TONES.selama,
        items: [
          {
            icon: 'fa-solid fa-plug-circle-xmark',
            label: 'Terputus',
            text: 'Kalau koneksi terputus, kamu dapat masa tenggang singkat untuk menyambung kembali. Setelah lewat, statusmu menjadi istirahat: giliran dilewati dan soal yang sedang dipegang dialihkan tanpa hukuman.',
          },
          {
            icon: 'fa-solid fa-rotate-left',
            label: 'Reconnect',
            text: 'Membuka tab room lagi akan mengaktifkan kembali karakter dan posisimu.',
          },
          {
            icon: 'fa-solid fa-face-smile',
            label: 'Reaksi lobi',
            text: 'Kirim reaksi di lobi untuk menyemangati tim. Maksimal satu reaksi tiap 2 detik.',
          },
          {
            icon: 'fa-solid fa-code',
            label: 'Soal kode',
            text: 'Soal boleh berisi beberapa baris dan indentasi tab. Di editor admin pakai Enter dan Tab; lewat impor CSV gunakan penanda \\n dan \\t.',
          },
        ],
      },
      {
        key: 'selesai',
        title: 'Selesai',
        icon: SECTION_ICONS.selesai,
        accent: SECTION_TONES.selesai,
        items: [
          {
            icon: 'fa-solid fa-trophy',
            label: 'Podium',
            text: 'Saat permainan ditutup, podium 3D menampilkan juara 1-3 dan barisan pemain lain. Tombol Lihat papan mengembalikan papan permainan.',
          },
          {
            icon: 'fa-solid fa-list-ol',
            label: 'Hasil akhir',
            text: 'Peringkat akhir disusun dari posisi, lalu jumlah bantuan yang tersisa bila posisi sama.',
          },
          {
            icon: 'fa-solid fa-file-arrow-down',
            label: 'Rekaman jawaban',
            text: 'Admin dapat mengunduh CSV jawaban pemain dari tab Riwayat.',
          },
        ],
      },
    ];
  }

  function GuideModal({ open, onClose, quotas, allowLateJoin }) {
    const sections = buildGuideSections({ quotas, allowLateJoin });
    return (
      <window.UI.Modal open={open} onClose={onClose} labelledBy="guide-title">
        <div className="text-left">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <h2 id="guide-title" className="m-0 text-xl font-black text-slate-900">
                <i className="fa-solid fa-circle-question mr-2 text-indigo-600" aria-hidden="true"></i>
                Panduan bermain
              </h2>
              <p className="m-0 mt-1 text-sm font-semibold text-slate-500">
                EduLadder Battle · baca sebelum mulai
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4">
            {sections.map((section) => (
              <section key={section.key} className={`rounded-2xl border-2 p-4 ${section.accent}`}>
                <h3 className="m-0 flex items-center gap-2 text-base font-black text-slate-900">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-indigo-600 ring-1 ring-slate-200">
                    <i className={section.icon} aria-hidden="true"></i>
                  </span>
                  {section.title}
                </h3>
                {section.intro && (
                  <p className="m-0 mt-2 text-sm font-semibold text-slate-600">{section.intro}</p>
                )}
                <ul className="m-0 mt-3 grid list-none gap-2 p-0">
                  {section.items.map((item) => (
                    <li key={item.label} className="grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-xl bg-white/80 px-3 py-2">
                      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${item.iconClass || 'bg-slate-100 text-slate-600'}`}>
                        <i className={item.icon} aria-hidden="true"></i>
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-black text-slate-900">{item.label}</span>
                        <span className="block text-sm text-slate-600">{item.text}</span>
                      </span>
                      {item.badge && (
                        <span className={`rounded-full px-2.5 py-1 text-xs font-black ring-1 ${item.badgeClass}`}>{item.badge}</span>
                      )}
                      {item.dot && (
                        <span className="mt-2 h-3 w-3 shrink-0 rounded-full ring-2 ring-white" style={{ background: item.dot }} aria-hidden="true"></span>
                      )}
                    </li>
                  ))}
                </ul>
                {section.notes && section.notes.length > 0 && (
                  <ul className="m-0 mt-3 grid list-none gap-1 p-0">
                    {section.notes.map((note) => (
                      <li key={note} className="flex items-start gap-2 text-sm text-slate-600">
                        <i className="fa-solid fa-circle-info mt-1 text-rose-400" aria-hidden="true"></i>
                        <span>{note}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
            <p className="m-0 text-xs font-semibold text-slate-500">Kuota bantuan pada panduan ini mengikuti room yang sedang dibuka.</p>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              <i className="fa-solid fa-xmark" aria-hidden="true"></i> Tutup
            </button>
          </div>
        </div>
      </window.UI.Modal>
    );
  }

  window.UI = window.UI || {};
  window.UI.GuideModal = GuideModal;
  window.UI.guideSections = buildGuideSections;
})();

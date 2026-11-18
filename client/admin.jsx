/* Semua <script type="text/babel"> berbagi scope global; berkas ini
   dibungkus IIFE agar binding top-level tidak bentrok antar berkas. */
(function () {
  'use strict';
  const { useState, useEffect, useRef } = React;

  const GE = window.GameEngine;
  const Net = window.Net;

  /* Kelas Tailwind bersama untuk panel admin. Tanpa gradasi/neon: grid jelas,
     padding lega, kontras teks tinggi. */
  const T = {
    page: 'min-h-screen bg-slate-100 text-slate-900',
    container: 'w-full flex-1 px-6 py-6 lg:px-10 lg:py-8',
    card: 'rounded-xl border border-slate-200 bg-white shadow-sm',
    cardPad: 'p-6 lg:p-8',
    label: 'mb-1.5 block text-sm font-semibold text-slate-700',
    hint: 'mt-1 text-xs text-slate-500',
    input:
      'block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-base text-slate-900 ' +
      'placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 ' +
      'disabled:bg-slate-100 disabled:text-slate-500',
    textarea:
      'block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-base leading-relaxed text-slate-900 ' +
      'placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200',
    btn: 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition ' +
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50',
    btnPrimary: 'bg-indigo-600 text-white hover:bg-indigo-700',
    btnSecondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    btnDanger: 'border border-rose-200 bg-white text-rose-700 hover:bg-rose-50',
    btnSm: 'px-3 py-2 text-xs',
    iconBtn: 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 ' +
      'hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40',
    iconDanger: 'text-rose-600 hover:bg-rose-50 hover:border-rose-200',
    sectionTitle: 'm-0 text-lg font-bold text-slate-900',
    sectionSub: 'm-0 text-sm text-slate-500',
    headingLabel: 'm-0 text-xs font-bold uppercase tracking-wider text-slate-500',
    alertError: 'rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700',
    alertOk: 'rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800',
    badge: 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
  };

  const STATUS_STYLE = {
    Lobi: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
    Berjalan: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    Selesai: 'bg-slate-100 text-slate-600 ring-1 ring-slate-300',
  };

  const EMPTY_QUESTION = () => ({
    question: '',
    questionImage: '',
    options: [
      { text: '', imageUrl: '' },
      { text: '', imageUrl: '' },
      { text: '', imageUrl: '' },
      { text: '', imageUrl: '' },
    ],
    correctAnswer: 'A',
    clue: '',
    reward: 5,
    penalty: 3,
    duration: 15,
  });

  function normalizeForEdit(question, index) {
    const normalized = GE.normalizeQuestion(question || {}, index);
    return {
      ...normalized,
      options: [0, 1, 2, 3].map((i) => ({ text: normalized.options[i].text || '', imageUrl: normalized.options[i].imageUrl || '' })),
    };
  }

  function StatusBadge({ label }) {
    return <span className={`${T.badge} ${STATUS_STYLE[label] || STATUS_STYLE.Selesai}`}>{label}</span>;
  }

  /* Pesan hasil aksi: sukses tampil sebagai toast, gagal sebagai popup. */
  function Alert({ tone, children }) {
    useEffect(() => {
      if (!children) return;
      if (tone === 'ok') window.Dialog.toast(String(children));
      else window.Dialog.alert({ icon: 'error', title: 'Terjadi kesalahan', text: String(children) });
    }, [children, tone]);
    return null;
  }

  function EmptyState({ icon, title, hint }) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-14 text-center">
        <i className={`${icon} text-2xl text-slate-400`} aria-hidden="true"></i>
        <p className="m-0 text-sm font-semibold text-slate-700">{title}</p>
        {hint && <p className="m-0 max-w-sm text-sm text-slate-500">{hint}</p>}
      </div>
    );
  }

  function HelpQuotaEditor({ value, onChange, disabled }) {
    const quotas = GE.sanitizeHelpQuotas(value, GE.DEFAULT_HELPS());
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {GE.HELPS.map((item) => {
          const off = quotas[item.key] === 0;
          return (
            <label
              key={item.key}
              className={`flex flex-col gap-2 rounded-lg border p-4 ${off ? 'border-rose-200 bg-rose-50/60' : 'border-slate-200 bg-slate-50'}`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <i className={`${item.icon} w-4 text-center text-indigo-600`} aria-hidden="true"></i>
                {item.label}
              </span>
              <input
                type="number"
                min={0}
                max={20}
                className={`${T.input} bg-white`}
                value={quotas[item.key]}
                disabled={disabled}
                aria-label={`Kuota ${item.label}`}
                onChange={(e) => onChange({ ...quotas, [item.key]: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })}
              />
              {off && <span className="text-xs font-semibold text-rose-700">Nonaktif</span>}
            </label>
          );
        })}
      </div>
    );
  }

  function QuestionEditor({ index, value, total, onChange, onRemove, onMove }) {
    const [imageErrors, setImageErrors] = useState({});
    const [open, setOpen] = useState(index === 0);
    const set = (patch) => onChange({ ...value, ...patch });
    const setOption = (i, patch) => {
      const options = value.options.slice();
      options[i] = { ...options[i], ...patch };
      set({ options });
    };
    const validateUrl = (key, url) => {
      setImageErrors((prev) => ({ ...prev, [key]: Boolean(url) && !GE.isValidImageUrl(url) }));
    };
    const summary = value.question.trim() || 'Belum ada pertanyaan';

    return (
      <article className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">{index + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-sm font-semibold text-slate-900">{summary}</p>
            <p className="m-0 text-xs text-slate-500">
              Kunci {value.correctAnswer} · maju {value.reward} · mundur {value.penalty} · {value.duration} detik
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" className={T.iconBtn} title="Naikkan" aria-label="Naikkan urutan soal" disabled={index === 0} onClick={() => onMove(index, -1)}>
              <i className="fa-solid fa-arrow-up" aria-hidden="true"></i>
            </button>
            <button type="button" className={T.iconBtn} title="Turunkan" aria-label="Turunkan urutan soal" disabled={index === total - 1} onClick={() => onMove(index, 1)}>
              <i className="fa-solid fa-arrow-down" aria-hidden="true"></i>
            </button>
            <button type="button" className={`${T.iconBtn} ${T.iconDanger}`} title="Hapus soal" aria-label="Hapus soal" onClick={() => onRemove(index)}>
              <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
            </button>
            <button type="button" className={`${T.iconBtn}`} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? 'Tutup soal' : 'Buka soal'}>
              <i className={`fa-solid ${open ? 'fa-chevron-up' : 'fa-chevron-down'}`} aria-hidden="true"></i>
            </button>
          </div>
        </header>

        {open && (
          <div className="grid gap-6 p-5 lg:p-6">
            <div className="grid gap-5">
              <div>
                <label className={T.label} htmlFor={`q-${index}-text`}>Pertanyaan</label>
                <textarea
                  id={`q-${index}-text`}
                  rows={2}
                  className={T.textarea}
                  value={value.question}
                  onChange={(e) => set({ question: e.target.value })}
                  placeholder="Tulis pertanyaan…"
                />
              </div>

              <div>
                <label className={T.label} htmlFor={`q-${index}-image`}>URL gambar soal <span className="font-normal text-slate-500">(opsional)</span></label>
                <input
                  id={`q-${index}-image`}
                  className={`${T.input} ${imageErrors.q ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200' : ''}`}
                  value={value.questionImage || ''}
                  onChange={(e) => { set({ questionImage: e.target.value }); validateUrl('q', e.target.value); }}
                  placeholder="https://contoh.com/gambar.png"
                />
                {imageErrors.q && <p className="m-0 mt-1 text-xs font-medium text-rose-600">URL harus diawali http:// atau https://</p>}
                {value.questionImage && !imageErrors.q && (
                  <img src={value.questionImage} alt="Pratinjau gambar soal" loading="lazy" referrerPolicy="no-referrer" className="mt-3 h-24 w-auto max-w-xs rounded-lg border border-slate-200 object-contain p-1" />
                )}
              </div>
            </div>

            <div>
              <p className="m-0 mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Pilihan jawaban — pilih kunci jawaban</p>
              <div className="grid gap-3 xl:grid-cols-2">
                {value.options.map((option, i) => {
                  const letter = 'ABCD'[i];
                  const key = `opt${i}`;
                  const isCorrect = value.correctAnswer === letter;
                  return (
                    <div key={letter} className={`grid grid-cols-[auto_1fr] items-start gap-3 rounded-lg border p-3 ${isCorrect ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-white'}`}>
                      <label className="flex cursor-pointer items-center gap-2 pt-1">
                        <input
                          type="radio"
                          name={`correct-${index}`}
                          className="h-4 w-4 accent-emerald-600"
                          checked={isCorrect}
                          onChange={() => set({ correctAnswer: letter })}
                          aria-label={`Jadikan pilihan ${letter} kunci jawaban`}
                        />
                        <span className={`flex h-8 w-8 items-center justify-center rounded-md text-sm font-bold ${isCorrect ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{letter}</span>
                      </label>
                      <div className="grid gap-2">
                        <input
                          className={T.input}
                          value={option.text}
                          onChange={(e) => setOption(i, { text: e.target.value })}
                          placeholder={`Teks pilihan ${letter}`}
                          aria-label={`Teks pilihan ${letter}`}
                        />
                        <input
                          className={`${T.input} text-sm ${imageErrors[key] ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200' : ''}`}
                          value={option.imageUrl}
                          onChange={(e) => { setOption(i, { imageUrl: e.target.value }); validateUrl(key, e.target.value); }}
                          placeholder={`URL gambar ${letter} (opsional)`}
                          aria-label={`URL gambar pilihan ${letter}`}
                        />
                        {imageErrors[key] && <span className="text-xs font-medium text-rose-600">URL tidak valid</span>}
                        {option.imageUrl && !imageErrors[key] && (
                          <img src={option.imageUrl} alt={`Pratinjau pilihan ${letter}`} loading="lazy" referrerPolicy="no-referrer" className="h-14 w-auto max-w-[10rem] rounded-md border border-slate-200 object-contain p-1" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 border-t border-slate-200 pt-5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2 lg:col-span-1">
                <label className={T.label} htmlFor={`q-${index}-clue`}>Clue</label>
                <input id={`q-${index}-clue`} className={T.input} value={value.clue} onChange={(e) => set({ clue: e.target.value })} placeholder="Petunjuk (opsional)" />
              </div>
              <div>
                <label className={T.label} htmlFor={`q-${index}-reward`}>Reward (maju)</label>
                <input id={`q-${index}-reward`} type="number" min={1} max={12} className={T.input} value={value.reward} onChange={(e) => set({ reward: Number(e.target.value) })} />
              </div>
              <div>
                <label className={T.label} htmlFor={`q-${index}-penalty`}>Penalty (mundur)</label>
                <input id={`q-${index}-penalty`} type="number" min={1} max={10} className={T.input} value={value.penalty} onChange={(e) => set({ penalty: Number(e.target.value) })} />
              </div>
              <div>
                <label className={T.label} htmlFor={`q-${index}-duration`}>Durasi (detik)</label>
                <input id={`q-${index}-duration`} type="number" min={5} max={180} className={T.input} value={value.duration} onChange={(e) => set({ duration: Number(e.target.value) })} />
              </div>
            </div>
          </div>
        )}
      </article>
    );
  }

  function BankEditor({ bankId, onBack }) {
    const [bank, setBank] = useState(null);
    const [name, setName] = useState('');
    const [questions, setQuestions] = useState([]);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
      Net.request(`/api/banks/${bankId}`)
        .then((data) => {
          setBank(data.bank);
          setName(data.bank.name);
          setQuestions((data.bank.questions || []).map(normalizeForEdit));
        })
        .catch((e) => setError(e.message));
    }, [bankId]);

    const update = (index, value) => {
      setQuestions((prev) => prev.map((item, i) => (i === index ? value : item)));
      setDirty(true);
    };
    const remove = (index) => {
      window.Dialog.confirm({ danger: true, title: `Hapus soal ${index + 1}?` }).then((ok) => {
        if (!ok) return;
        setQuestions((prev) => prev.filter((_, i) => i !== index));
        setDirty(true);
      });
    };
    const move = (index, delta) => {
      setQuestions((prev) => {
        const next = prev.slice();
        const target = index + delta;
        if (target < 0 || target >= next.length) return prev;
        [next[index], next[target]] = [next[target], next[index]];
        return next;
      });
      setDirty(true);
    };
    const add = () => {
      setQuestions((prev) => [...prev, EMPTY_QUESTION()]);
      setDirty(true);
    };

    const save = () => {
      setBusy(true);
      setError('');
      setMessage('');
      Net.request(`/api/banks/${bankId}`, { method: 'PUT', body: { name, questions } })
        .then((data) => {
          setQuestions((data.bank ? (data.bank.questions || []).map(normalizeForEdit) : questions));
          setDirty(false);
          setMessage(`Tersimpan — ${questions.length} soal.`);
        })
        .catch((e) => setError(e.message || 'Gagal menyimpan.'))
        .finally(() => setBusy(false));
    };

    return (
      <div className="grid gap-6">
        <div className={`${T.card} ${T.cardPad}`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <button type="button" className={T.iconBtn} onClick={onBack} aria-label="Kembali ke daftar bank">
                <i className="fa-solid fa-arrow-left" aria-hidden="true"></i>
              </button>
              <div>
                <h2 className={T.sectionTitle}>{bank ? bank.name : 'Editor bank soal'}</h2>
                <p className={T.sectionSub}>{questions.length} soal</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {dirty && <span className={`${T.badge} bg-amber-50 text-amber-700 ring-1 ring-amber-200`}>Belum disimpan</span>}
              <button type="button" className={`${T.btn} ${T.btnSecondary}`} onClick={add}>
                <i className="fa-solid fa-plus" aria-hidden="true"></i> Tambah soal
              </button>
              <button type="button" className={`${T.btn} ${T.btnPrimary}`} onClick={save} disabled={busy || !dirty}>
                {busy ? <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> : <i className="fa-solid fa-floppy-disk" aria-hidden="true"></i>}
                {busy ? 'Menyimpan…' : 'Simpan bank'}
              </button>
            </div>
          </div>

          <div className="mt-6 max-w-xl">
            <label className={T.label} htmlFor="bank-name">Nama bank</label>
            <input id="bank-name" className={T.input} value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} maxLength={60} />
          </div>

          <Alert tone="ok">{message}</Alert>
          <Alert tone="bad">{error}</Alert>
        </div>

        {questions.length === 0 ? (
          <EmptyState icon="fa-solid fa-circle-question" title="Belum ada soal" />
        ) : (
          <div className="grid gap-4">
            {questions.map((question, index) => (
              <QuestionEditor
                key={index}
                index={index}
                value={question}
                total={questions.length}
                onChange={(value) => update(index, value)}
                onRemove={remove}
                onMove={move}
              />
            ))}
          </div>
        )}

        {questions.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={`${T.btn} ${T.btnSecondary}`} onClick={add}>
              <i className="fa-solid fa-plus" aria-hidden="true"></i> Tambah soal
            </button>
            <button type="button" className={`${T.btn} ${T.btnPrimary}`} onClick={save} disabled={busy || !dirty}>
              <i className="fa-solid fa-floppy-disk" aria-hidden="true"></i> Simpan bank
            </button>
          </div>
        )}
      </div>
    );
  }

  function BankList({ onOpenEditor }) {
    const [banks, setBanks] = useState([]);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [errors, setErrors] = useState([]);
    const fileRef = useRef(null);

    const refresh = () => {
      Net.request('/api/banks')
        .then((data) => setBanks(data.banks || []))
        .catch((e) => setMessage(e.message));
    };
    useEffect(refresh, []);

    const createEmpty = () => {
      setBusy(true);
      Net.request('/api/banks', { method: 'POST', body: { name, empty: true } })
        .then((data) => { setName(''); onOpenEditor(data.bank.id); })
        .catch((e) => setMessage(e.message))
        .finally(() => setBusy(false));
    };

    const upload = (file) => {
      if (!file) return;
      setBusy(true);
      setErrors([]);
      const reader = new FileReader();
      reader.onload = () => {
        Net.request('/api/banks', { method: 'POST', body: { name, csv: String(reader.result || '') } })
          .then((data) => {
            setErrors((data.errors || []).slice(0, 8));
            setMessage(`Bank "${data.bank.name}" tersimpan (${data.bank.count} soal).`);
            refresh();
          })
          .catch((e) => setMessage(e.message))
          .finally(() => setBusy(false));
      };
      reader.onerror = () => { setMessage('Gagal membaca file.'); setBusy(false); };
      reader.readAsText(file);
    };

    const remove = (id) => {
      window.Dialog.confirm({
        danger: true,
        title: 'Hapus bank soal?',
        text: 'Room lama tetap memakai salinan soalnya.',
      }).then((ok) => {
        if (!ok) return;
        Net.request(`/api/banks/${id}`, { method: 'DELETE' })
          .then(() => { refresh(); window.Dialog.toast('Bank soal dihapus'); })
          .catch((e) => window.Dialog.alert({ icon: 'error', title: 'Gagal menghapus', text: e.message }));
      });
    };

    return (
      <div className="grid gap-6">
        <div className={`${T.card} ${T.cardPad}`}>
          <h2 className={T.sectionTitle}>Tambah bank soal</h2>

          <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <label className={T.label} htmlFor="new-bank-name">Nama bank <span className="font-normal text-slate-500">(opsional)</span></label>
              <input id="new-bank-name" className={T.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="mis. Matematika Kelas 5" />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`${T.btn} ${T.btnPrimary}`} disabled={busy} onClick={createEmpty}>
                <i className="fa-solid fa-plus" aria-hidden="true"></i> Bank baru
              </button>
              <button type="button" className={`${T.btn} ${T.btnSecondary}`} disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>
                <i className="fa-solid fa-upload" aria-hidden="true"></i> Impor CSV
              </button>
              <button type="button" className={`${T.btn} ${T.btnSecondary}`} onClick={() => window.UI.downloadTemplate()}>
                <i className="fa-solid fa-download" aria-hidden="true"></i> Template
              </button>
            </div>
          </div>

          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) upload(f); e.target.value = ''; }} />

          {busy && <p className="m-0 mt-4 text-sm font-medium text-slate-500">Memproses…</p>}
          <Alert tone="ok">{message}</Alert>
          {errors.map((err, i) => (
            <p key={i} className={`${T.alertError} m-0 mt-2`}>{err}</p>
          ))}
        </div>

        <div>
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h2 className={T.sectionTitle}>Daftar bank soal</h2>
              <p className={T.sectionSub}>{banks.length} bank tersimpan</p>
            </div>
          </div>

          {banks.length === 0 ? (
            <EmptyState icon="fa-solid fa-book-open" title="Belum ada bank soal" />
          ) : (
            <div className={`${T.card} divide-y divide-slate-200`}>
              {banks.map((bank) => (
                <div key={bank.id} className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-4 lg:grid-cols-[1fr_10rem_auto]">
                  <button type="button" className="min-w-0 text-left" onClick={() => onOpenEditor(bank.id)}>
                    <span className="block truncate text-sm font-semibold text-slate-900">{bank.name}</span>
                    <span className="block text-xs text-slate-500">{new Date(bank.createdAt).toLocaleDateString('id-ID')}</span>
                  </button>
                  <span className="hidden text-sm text-slate-600 lg:block">
                    <span className="font-semibold text-slate-900">{bank.count}</span> soal
                  </span>
                  <div className="flex items-center justify-end gap-1.5">
                    <button type="button" className={`${T.btn} ${T.btnSecondary} ${T.btnSm}`} onClick={() => onOpenEditor(bank.id)}>
                      <i className="fa-solid fa-pen" aria-hidden="true"></i> Edit
                    </button>
                    <button type="button" className={`${T.iconBtn} ${T.iconDanger}`} title="Hapus bank" aria-label={`Hapus bank ${bank.name}`} onClick={() => remove(bank.id)}>
                      <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  function RoomsPanel({ onOpenRoom }) {
    const [banks, setBanks] = useState([]);
    const [rooms, setRooms] = useState([]);
    const [bankId, setBankId] = useState('');
    const [shuffle, setShuffle] = useState(true);
    const [maxPlayers, setMaxPlayers] = useState(GE.DEFAULT_MAX_PLAYERS || 4);
    const [quotas, setQuotas] = useState(() => GE.DEFAULT_HELPS());
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');

    const loadRooms = () => {
      Net.request('/api/rooms').then((data) => setRooms(data.rooms || [])).catch((e) => setMessage(e.message));
    };

    useEffect(() => {
      Net.request('/api/banks').then((data) => {
        const list = data.banks || [];
        setBanks(list);
        if (list.length && !bankId) setBankId(list[0].id);
      }).catch((e) => setMessage(e.message));
      loadRooms();
    }, []);

    const create = () => {
      if (!bankId) return;
      setBusy(true);
      setMessage('');
      Net.request('/api/rooms', { method: 'POST', body: { bankId, config: { shuffle, helpQuotas: quotas, maxPlayers } } })
        .then((data) => { loadRooms(); onOpenRoom(data.code); })
        .catch((e) => setMessage(e.message))
        .finally(() => setBusy(false));
    };

    const removeRoom = (code) => {
      window.Dialog.confirm({
        danger: true,
        title: `Hapus room ${code}?`,
        text: 'Riwayat pertandingan tetap disimpan.',
      }).then((ok) => {
        if (!ok) return;
        Net.request(`/api/rooms/${code}`, { method: 'DELETE' })
          .then(() => { loadRooms(); window.Dialog.toast('Room dihapus'); })
          .catch((e) => window.Dialog.alert({ icon: 'error', title: 'Gagal menghapus', text: e.message }));
      });
    };

    const statusLabel = (room) => {
      const phase = room.phase || room.status;
      if (phase === 'lobby') return 'Lobi';
      if (phase === 'finished' || room.status === 'finished') return 'Selesai';
      return 'Berjalan';
    };

    const selectedBank = banks.find((bank) => bank.id === bankId);

    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start 2xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
        <div className={`${T.card} ${T.cardPad} lg:sticky lg:top-6`}>
          <h2 className={T.sectionTitle}>Buat room</h2>

          <div className="mt-6 grid gap-5">
            <div>
              <label className={T.label} htmlFor="room-bank">Bank soal</label>
              <select id="room-bank" className={T.input} value={bankId} onChange={(e) => setBankId(e.target.value)}>
                {banks.length === 0 && <option value="">Belum ada bank</option>}
                {banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name} ({bank.count} soal)</option>)}
              </select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800">
                <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} />
                Acak urutan soal
              </label>
              <div>
                <label className={T.label} htmlFor="room-max-players">Maksimal pemain</label>
                <input
                  id="room-max-players"
                  type="number"
                  min={GE.MIN_PLAYERS || 2}
                  max={GE.MAX_PLAYERS || 25}
                  className={T.input}
                  value={maxPlayers}
                  onChange={(e) => setMaxPlayers(GE.sanitizeMaxPlayers(e.target.value))}
                />
                <p className={T.hint}>2–25 pemain (default 4). Tidak bisa diubah setelah room dibuat.</p>
              </div>
            </div>

            <div>
              <p className={`${T.headingLabel} mb-2`}>Kuota bantuan per pemain</p>
              <HelpQuotaEditor value={quotas} onChange={setQuotas} />
            </div>

            <button type="button" className={`${T.btn} ${T.btnPrimary} w-full py-3`} disabled={!bankId || busy} onClick={create}>
              <i className="fa-solid fa-plus" aria-hidden="true"></i> {busy ? 'Membuat…' : 'Buat room'}
            </button>
            <Alert tone="bad">{message}</Alert>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className={T.sectionTitle}>Room tersimpan</h2>
              <p className={T.sectionSub}>{rooms.length} room</p>
            </div>
          </div>

          {rooms.length === 0 ? (
            <EmptyState icon="fa-solid fa-door-open" title="Belum ada room" />
          ) : (
            <div className={`${T.card} divide-y divide-slate-200`}>
              {rooms.map((room) => {
                const label = statusLabel(room);
                return (
                  <div key={room.code} className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-[auto_1fr_auto] md:items-center">
                    <div className="flex items-center gap-3">
                      <span className="rounded-lg bg-slate-900 px-2.5 py-1.5 font-mono text-sm font-bold tracking-wider text-white">{room.code}</span>
                      <StatusBadge label={label} />
                    </div>
                    <div className="min-w-0">
                      <p className="m-0 truncate text-sm font-semibold text-slate-900">{room.bankName}</p>
                      <p className="m-0 text-xs text-slate-500">
                        {room.playerCount}/{room.maxPlayers || 4} pemain · {room.questionCount} soal · {new Date(room.updatedAt || room.createdAt).toLocaleString('id-ID')}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 md:justify-end">
                      <button type="button" className={`${T.btn} ${T.btnPrimary} ${T.btnSm}`} onClick={() => onOpenRoom(room.code)}>
                        <i className="fa-solid fa-arrow-right-to-bracket" aria-hidden="true"></i> Buka
                      </button>
                      <button type="button" className={`${T.iconBtn} ${T.iconDanger}`} title="Hapus room" aria-label={`Hapus room ${room.code}`} onClick={() => removeRoom(room.code)}>
                        <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  function HistoryPanel() {
    const [history, setHistory] = useState([]);
    const [busy, setBusy] = useState(false);
    const [downloadingId, setDownloadingId] = useState(null);
    const [message, setMessage] = useState('');

    const refresh = () => {
      Net.request('/api/history').then((data) => setHistory(data.history || [])).catch((e) => setMessage(e.message));
    };
    useEffect(refresh, []);

    const remove = (id) => {
      window.Dialog.confirm({ danger: true, title: 'Hapus entri riwayat?' }).then((ok) => {
        if (!ok) return;
        setBusy(true);
        Net.request(`/api/history/${id}`, { method: 'DELETE' })
          .then(() => { refresh(); window.Dialog.toast('Riwayat dihapus'); })
          .catch((e) => window.Dialog.alert({ icon: 'error', title: 'Gagal menghapus', text: e.message }))
          .finally(() => setBusy(false));
      });
    };

    const download = (entry) => {
      if (downloadingId) return;
      setDownloadingId(entry.id);
      Net.downloadFile(`/api/history/${entry.id}/answers`, `jawaban-${entry.roomCode}.csv`)
        .catch((e) => window.Dialog.alert({ icon: 'error', title: 'Gagal mengunduh', text: e.message }))
        .finally(() => setDownloadingId(null));
    };

    const winnerName = (entry) => {
      if (!entry.winner) return 'Tidak ada pemenang';
      if (entry.winner === 'Seri') return 'Seri';
      const found = (entry.ranking || []).find((item) => item.id === entry.winner);
      return found ? found.name : entry.winner;
    };

    return (
      <div className="grid gap-4">
        <div>
          <h2 className={T.sectionTitle}>Riwayat pertandingan</h2>
          <p className={T.sectionSub}>{history.length} pertandingan selesai</p>
        </div>

        <Alert tone="bad">{message}</Alert>

        {history.length === 0 ? (
          <EmptyState icon="fa-solid fa-clock-rotate-left" title="Belum ada pertandingan" />
        ) : (
          <div className={`${T.card} divide-y divide-slate-200`}>
            {history.map((entry) => (
              <div key={entry.id} className="grid gap-3 px-5 py-5 lg:grid-cols-[1fr_auto] lg:items-start">
                <div className="grid gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-lg bg-slate-900 px-2.5 py-1.5 font-mono text-sm font-bold tracking-wider text-white">{entry.roomCode}</span>
                    <span className={`${T.badge} bg-slate-100 text-slate-600 ring-1 ring-slate-300`}>{entry.bankName}</span>
                    <span className="text-xs text-slate-500">{new Date(entry.finishedAt).toLocaleString('id-ID')}</span>
                  </div>
                  <p className="m-0 text-sm text-slate-600">
                    Pemenang <span className="font-semibold text-slate-900">{winnerName(entry)}</span> · durasi{' '}
                    <span className="font-semibold text-slate-900">{window.UI.formatTime(entry.durationSeconds || 0)}</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(entry.ranking || []).map((item, i) => {
                      const isWinner = entry.winner === item.id;
                      return (
                        <span
                          key={item.id}
                          className={`${T.badge} ${isWinner ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200'}`}
                        >
                          {i + 1}. {item.name} · kotak {item.pos}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 lg:justify-self-end">
                  <button
                    type="button"
                    className={`${T.btn} ${T.btnSecondary} ${T.btnSm}`}
                    title="Unduh jawaban pemain (CSV)"
                    aria-label={`Unduh jawaban room ${entry.roomCode}`}
                    disabled={busy || downloadingId === entry.id}
                    onClick={() => download(entry)}
                  >
                    {downloadingId === entry.id ? (
                      <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
                    ) : (
                      <i className="fa-solid fa-file-csv" aria-hidden="true"></i>
                    )}
                    {downloadingId === entry.id ? 'Mengunduh…' : 'Unduh jawaban'}
                  </button>
                  <button type="button" className={`${T.iconBtn} ${T.iconDanger}`} title="Hapus riwayat" aria-label={`Hapus riwayat room ${entry.roomCode}`} disabled={busy} onClick={() => remove(entry.id)}>
                    <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const TABS = [
    { key: 'rooms', label: 'Room', icon: 'fa-solid fa-door-open' },
    { key: 'banks', label: 'Bank Soal', icon: 'fa-solid fa-book-open' },
    { key: 'history', label: 'Riwayat', icon: 'fa-solid fa-clock-rotate-left' },
  ];

  const tabFromHash = () => {
    const key = (window.location.hash || '').replace(/^#\/?/, '');
    return TABS.some((item) => item.key === key) ? key : 'rooms';
  };

  /* Item menu sidebar: tautan <a>, bukan <button>. */
  function NavLink({ href, icon, label, active, onClick }) {
    return (
      <a
        href={href}
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={`flex items-center gap-3 rounded-lg border-l-4 px-4 py-3 text-sm font-semibold no-underline transition-colors ${
          active
            ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
            : 'border-transparent text-slate-800 hover:bg-slate-100 hover:text-slate-900'
        }`}
      >
        <i className={`${icon} w-4 text-center ${active ? 'text-indigo-600' : 'text-slate-500'}`} aria-hidden="true"></i>
        {label}
      </a>
    );
  }

  function AdminDashboard({ onOpenRoom, onLogout, onExit }) {
    const [tab, setTab] = useState(tabFromHash);
    const [editorBank, setEditorBank] = useState(null);

    /* Layar admin memakai Tailwind: matikan aturan dasar styles.css. */
    useEffect(() => {
      document.documentElement.setAttribute('data-ui', 'admin');
    }, []);

    useEffect(() => {
      const sync = () => { setTab(tabFromHash()); setEditorBank(null); };
      window.addEventListener('hashchange', sync);
      return () => window.removeEventListener('hashchange', sync);
    }, []);

    const current = TABS.find((item) => item.key === tab) || TABS[0];
    const title = tab === 'banks' && editorBank ? 'Editor Bank Soal' : current.label;
    const run = (fn) => (e) => { e.preventDefault(); fn(); };

    return (
      <div className="min-h-screen bg-slate-100 text-slate-900 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="flex flex-col border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3 px-5 py-4 lg:px-6 lg:py-6">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <i className="fa-solid fa-user-shield" aria-hidden="true"></i>
            </span>
            <p className="m-0 text-base font-bold leading-tight text-slate-900">
              EduLadder
              <span className="block text-sm font-semibold text-slate-600">Admin</span>
            </p>
          </div>

          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-visible lg:px-4 lg:pb-4" aria-label="Menu admin">
            {TABS.map((item) => (
              <NavLink
                key={item.key}
                href={`#${item.key}`}
                icon={item.icon}
                label={item.label}
                active={tab === item.key}
                onClick={() => { setTab(item.key); setEditorBank(null); }}
              />
            ))}
          </nav>

          <nav className="flex gap-1 border-t border-slate-200 px-3 py-3 lg:flex-col lg:px-4 lg:py-4" aria-label="Akun">
            <NavLink href="#/" icon="fa-solid fa-house" label="Beranda" onClick={run(onExit)} />
            <NavLink href="#/logout" icon="fa-solid fa-right-from-bracket" label="Keluar" onClick={run(onLogout)} />
          </nav>
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="border-b border-slate-200 bg-white px-6 py-5 lg:px-10">
            <h1 className="m-0 text-xl font-bold leading-tight text-slate-900 lg:text-2xl">{title}</h1>
          </header>

          <main className={T.container}>
            {tab === 'rooms' && <RoomsPanel onOpenRoom={onOpenRoom} />}
            {tab === 'banks' && (editorBank ? <BankEditor bankId={editorBank} onBack={() => setEditorBank(null)} /> : <BankList onOpenEditor={setEditorBank} />)}
            {tab === 'history' && <HistoryPanel />}
          </main>
        </div>
      </div>
    );
  }


  window.AdminDashboard = AdminDashboard;
  window.AdminStyles = T;
})();

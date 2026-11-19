/* Semua <script type="text/babel"> berbagi scope global; berkas ini
   dibungkus IIFE agar binding top-level tidak bentrok antar berkas. */
(function () {
  'use strict';
  /* Reaksi statis tanpa aset: emoji + label. Kunci harus sama dengan server. */
  const REACTIONS = [
    { key: 'thumbs', emoji: '👍', label: 'Mantap' },
    { key: 'clap', emoji: '👏', label: 'Tepuk' },
    { key: 'party', emoji: '🎉', label: 'Hore' },
    { key: 'wow', emoji: '😮', label: 'Wow' },
    { key: 'fire', emoji: '🔥', label: 'Semangat' },
    { key: 'heart', emoji: '❤️', label: 'Suka' },
  ];

  function LobbyScreen({ snapshot, emit, onLeave, reactions }) {
    const QrCode = window.Screens.QrCode;
    const T = window.Screens.T;
    const GE = window.GameEngine;
    const players = snapshot.players || [];
    const spectators = snapshot.spectators || [];
    const isAdmin = snapshot.you && snapshot.you.role === 'admin';
    const myId = snapshot.you && snapshot.you.role === 'player' ? snapshot.you.key : null;
    const me = players.find((item) => item.id === myId) || null;
    const maxPlayers = snapshot.config && snapshot.config.maxPlayers ? snapshot.config.maxPlayers : 4;
    const minPlayers = GE.MIN_PLAYERS || 2;
    const neededQuestions = Math.max(GE.MIN_QUESTIONS || 3, players.length);
    const canStart = players.length >= minPlayers && snapshot.bankCount >= neededQuestions;
    const joinUrl = window.Net.joinUrl(snapshot.code);
    const characterOf = (player) => GE.characterStyle(player.char || player.slot);
    const callouts = Array.isArray(reactions) ? reactions : [];
    const reactionOf = (key) => REACTIONS.find((item) => item.key === key) || REACTIONS[0];

    return (
      <div className="min-h-screen w-full bg-sky-50 text-slate-900">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-6 lg:px-8 lg:py-8">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-2xl text-white">
                <i className="fa-solid fa-dice-five" aria-hidden="true"></i>
              </span>
              <div>
                <p className="m-0 text-xl font-black leading-tight text-slate-900">EduLadder Battle</p>
                <p className="m-0 text-sm font-semibold text-slate-500">Lobi · {snapshot.bankName}</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-indigo-700 ring-2 ring-indigo-200">
              <i className="fa-solid fa-users" aria-hidden="true"></i>
              {players.length}/{maxPlayers} pemain
            </span>
          </header>

          {me && (
            <div role="group" aria-label="Kirim reaksi" className="flex flex-wrap items-center gap-2 rounded-2xl border-2 border-indigo-100 bg-white px-4 py-3">
              <span className="text-xs font-black uppercase tracking-widest text-indigo-500">Reaksi</span>
              {REACTIONS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  title={item.label}
                  aria-label={`Kirim reaksi ${item.label}`}
                  onClick={() => emit('lobby:react', { key: item.key })}
                  className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-slate-200 bg-slate-50 text-2xl transition hover:scale-110 hover:border-indigo-300 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                >
                  <span aria-hidden="true">{item.emoji}</span>
                </button>
              ))}
              <span className="ml-auto text-xs font-semibold text-slate-400">Maksimal satu reaksi tiap 2 detik.</span>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
            <section className="flex flex-col gap-5 rounded-3xl border-4 border-indigo-200 bg-white p-6">
              <div>
                <p className="m-0 text-xs font-black uppercase tracking-widest text-indigo-500">Kode room</p>
                <p className="m-0 break-all font-mono text-5xl font-black leading-none tracking-[0.18em] text-slate-900 sm:text-6xl">
                  {snapshot.code}
                </p>
              </div>

              <div className="flex justify-center">
                <QrCode text={joinUrl} />
              </div>
              <p className="m-0 break-all text-center text-sm font-semibold text-slate-500">{joinUrl}</p>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-sky-50 px-4 py-3 text-center">
                  <p className="m-0 text-3xl font-black leading-none text-sky-700">{players.length}</p>
                  <p className="m-0 mt-1 text-xs font-bold uppercase tracking-wide text-sky-700/70">Pemain</p>
                </div>
                <div className="rounded-2xl bg-amber-50 px-4 py-3 text-center">
                  <p className="m-0 text-3xl font-black leading-none text-amber-700">{maxPlayers}</p>
                  <p className="m-0 mt-1 text-xs font-bold uppercase tracking-wide text-amber-700/70">Maksimal</p>
                </div>
              </div>

              {isAdmin ? (
                <div className="grid gap-3 border-t-2 border-slate-100 pt-5">
                  <button
                    type="button"
                    className={`${T.btn} ${T.btnPrimary} w-full py-3 text-base`}
                    disabled={!canStart}
                    onClick={() => emit('admin:start')}
                  >
                    <i className="fa-solid fa-play" aria-hidden="true"></i> Mulai Permainan
                  </button>
                  {!canStart && (
                    <p className="m-0 text-center text-xs font-semibold text-rose-600">
                      {players.length < minPlayers
                        ? `Butuh minimal ${minPlayers} pemain.`
                        : `Bank soal butuh minimal ${neededQuestions} soal.`}
                    </p>
                  )}
                  <button
                    type="button"
                    className={`${T.btn} ${T.btnSecondary} w-full`}
                    onClick={() => (onLeave ? onLeave() : emit('room:leave'))}
                  >
                    <i className="fa-solid fa-xmark" aria-hidden="true"></i> Tutup Sesi
                  </button>
                </div>
              ) : (
                <div className="border-t-2 border-slate-100 pt-5 text-center">
                  <p className="m-0 text-sm font-bold text-slate-600">
                    <i className="fa-solid fa-hourglass-half mr-2 text-amber-500" aria-hidden="true"></i>
                    Menunggu admin memulai
                  </p>
                  {onLeave && (
                    <button type="button" className="mt-3 text-xs font-bold text-slate-400 underline" onClick={onLeave}>
                      Keluar room
                    </button>
                  )}
                </div>
              )}
            </section>

            <div className="grid gap-6">
              <section className="rounded-3xl border-4 border-emerald-200 bg-white p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="m-0 text-lg font-black text-slate-900">Pemain di lobi</h2>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                    {players.length} bergabung
                  </span>
                </div>

                {players.length === 0 ? (
                  <p className="m-0 py-10 text-center text-sm font-semibold text-slate-400">Menunggu pemain lain…</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {players.map((player) => {
                      const character = characterOf(player);
                      const mine = player.id === myId;
                      const mineCalls = callouts.filter((item) => item.playerId === player.id);
                      const resting = player.status === 'resting';
                      const dim = resting || !player.connected;
                      return (
                        <div
                          key={player.id}
                          className={`relative flex items-center gap-3 rounded-2xl border-2 bg-white px-4 py-3 ${mine ? 'border-indigo-400 bg-indigo-50/60' : 'border-slate-200'} ${dim ? 'opacity-70' : ''}`}
                        >
                          {mineCalls.length > 0 && (
                            <div className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden="true">
                              {mineCalls.map((item, index) => (
                                <span key={item.id} className="reaction-callout" style={{ left: `${18 + index * 16}%` }}>
                                  {reactionOf(item.key).emoji}
                                </span>
                              ))}
                            </div>
                          )}
                          <span
                            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-2xl"
                            style={{ background: character.soft, boxShadow: `inset 0 0 0 3px ${character.color}` }}
                            aria-hidden="true"
                          >
                            {character.emoji}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="m-0 truncate text-sm font-black text-slate-900">
                              {GE.playerNameOf(player)}
                              {mine && <span className="ml-2 rounded-full bg-indigo-600 px-2 py-0.5 text-[0.65rem] font-bold text-white">kamu</span>}
                            </p>
                            <p className="m-0 truncate text-xs font-semibold text-slate-500">
                              {character.name} · #{player.slot}
                              {player.joinedMidGame && <span className="ml-2 font-bold text-emerald-600">tengah permainan</span>}
                              {resting && <span className="ml-2 font-bold text-slate-400">istirahat</span>}
                            </p>
                          </div>
                          <span
                            className={`h-3 w-3 shrink-0 rounded-full ${player.connected ? 'bg-emerald-500' : resting ? 'bg-slate-400' : 'bg-amber-400'}`}
                            title={resting ? 'Istirahat' : player.connected ? 'Tersambung' : 'Terputus'}
                          ></span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {players.length > 0 && players.length < minPlayers && (
                  <p className="m-0 mt-4 text-center text-sm font-semibold text-slate-400">Menunggu pemain lain…</p>
                )}

                {spectators.length > 0 && (
                  <p className="m-0 mt-4 text-xs font-semibold text-slate-400">
                    Penonton: {spectators.map((item) => item.name).join(', ')}
                  </p>
                )}
              </section>

              {me && (
                <section className="rounded-3xl border-4 border-amber-200 bg-white p-6">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="m-0 text-lg font-black text-slate-900">Pilih karakter</h2>
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                      Karakter milikmu: {characterOf(me).name}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                    {GE.CHARACTERS.map((character) => {
                      const selected = (me.char || me.slot) === character.id;
                      const usedBy = players.filter((player) => (player.char || player.slot) === character.id).length;
                      return (
                        <button
                          key={character.id}
                          type="button"
                          onClick={() => emit('lobby:setCharacter', { charId: character.id })}
                          aria-pressed={selected}
                          className={`flex flex-col items-center gap-1 rounded-2xl border-2 px-3 py-4 text-center transition ${selected ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200 hover:border-slate-300'}`}
                          style={{ background: selected ? character.soft : '#ffffff' }}
                        >
                          <span className="text-3xl" aria-hidden="true">{character.emoji}</span>
                          <span className="text-xs font-black text-slate-800">{character.name}</span>
                          <span className="text-[0.65rem] font-bold" style={{ color: character.color }}>
                            {usedBy > 0 ? `${usedBy} pemain` : 'belum dipakai'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="m-0 mt-4 text-center text-xs font-semibold text-slate-400">
                    Karakter boleh sama. Nomor urut membedakan pemain di papan.
                  </p>
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  window.LobbyScreen = LobbyScreen;
})();

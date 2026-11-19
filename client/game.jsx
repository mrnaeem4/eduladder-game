/* Semua <script type="text/babel"> berbagi scope global; berkas ini
   dibungkus IIFE agar binding top-level tidak bentrok antar berkas. */
(function () {
  'use strict';
  const { useState, useEffect, useRef, useMemo } = React;

  const Net = window.Net;

  function GameScreen({ snapshot, question, emit, boardRef, scoreFloats, soundOn, setSoundOn, musicOn, setMusicOn, onLeave }) {
    const UI = window.UI;
    const GE = window.GameEngine;
    const st = snapshot.state;
    const players = st.players;
    const positions = st.positions;
    const myId = snapshot.you && snapshot.you.role === 'player' ? snapshot.you.key : null;
    const isAdmin = snapshot.you && snapshot.you.role === 'admin';
    const activeId = st.turnForId || st.currentId;
    const currentId = st.currentId;
    const answeringPlayer = players.find((p) => p.id === activeId) || players[0];
    const currentPlayer = players.find((p) => p.id === currentId) || players[0];
    const [armTarget, setArmTarget] = useState(null);
    /* Popup pemenang bisa ditutup agar papan tetap bisa dilihat. */
    const [winnerOpen, setWinnerOpen] = useState(true);
    /* Podium 3D tampil sampai pemain memilih "Lihat papan". */
    const [podiumOpen, setPodiumOpen] = useState(true);
    useEffect(() => {
      if (st.phase === 'finished') {
        setWinnerOpen(true);
        setPodiumOpen(true);
      } else {
        setPodiumOpen(false);
      }
    }, [st.phase]);

    const webgl = useMemo(() => UI.detectWebGL(), []);
    const use3d = webgl.ok;

    // Sinkronkan papan dengan perubahan posisi dari snapshot.
    const prevRef = useRef(null);
    useEffect(() => {
      const board = boardRef.current;
      const pos = positions;
      const prev = prevRef.current;
      if (!prev) {
        if (board && board.setPositions) board.setPositions(pos);
        prevRef.current = { ...pos };
        return;
      }
      Object.keys(pos).forEach((id) => {
        const from = prev[id];
        const to = pos[id];
        if (from === to) return;
        if (!board) return;
        if (GE.LADDERS[from] === to && board.slide) board.slide(id, from, to, 'ladder', { durationMs: GE.LADDER_SLIDE_MS });
        else if (GE.SNAKES[from] === to && board.slide) board.slide(id, from, to, 'snake', { durationMs: GE.SNAKE_SLIDE_MS });
        else if (board.hop) {
          const path = [];
          const dir = to > from ? 1 : -1;
          for (let v = from + dir; ; v += dir) { path.push(v); if (v === to) break; }
          board.hop(id, path);
        }
      });
      prevRef.current = { ...pos };
    }, [st.seq, positions, boardRef]);

    /* Durasi soal aktif = batas atas countdown; tanpa batas, selisih jam
       perangkat bisa menampilkan angka ratusan detik. */
    const questionDuration = question && question.question && question.question.duration ? question.question.duration : null;
    const seconds = UI.useCountdown(st.deadline, questionDuration);
    /* Selama animasi serangan soal dijeda: input ditutup dan overlay
       disembunyikan agar efek di papan terlihat. */
    const attackFx = st.attackFx || null;
    const eliminated = Array.isArray(st.eliminated) ? st.eliminated : [];
    const canAnswer = Boolean(myId) && st.phase === 'answering' && activeId === myId && !st.revealed && !attackFx;
    const isBonus = st.phase === 'bonus';
    const canBonusAnswer = Boolean(myId) && isBonus && st.snakeLadder && st.snakeLadder.playerId === myId && !st.revealed && !attackFx;

    const helpsForActive = st.helps[activeId] || {};
    const reward = question && question.question
      ? { text: st.doubleId === activeId ? `${question.question.reward} × 2` : String(question.question.reward), double: st.doubleId === activeId }
      : { text: '0', double: false };

    const helpBlocked = (key) => {
      if (!canAnswer) return true;
      const bag = GE.normalizeBag(helpsForActive);
      if (bag[key] <= 0) return true;
      if (key === 'throwQuestion') return st.questionThrown;
      if (key === 'clue') return Boolean(question && question.clueRevealed);
      if (key === 'shield') return Boolean(st.shields[activeId]);
      if (key === 'penawar') return st.penawarId === activeId;
      if (key === 'doubleMove') return st.doubleId === activeId;
      if (key === 'eliminateTwo') return eliminated.length > 0;
      return false;
    };
    const helpActive = (key) => {
      if (key === 'clue') return Boolean(question && question.clueRevealed);
      if (key === 'shield') return Boolean(st.shields[activeId]);
      if (key === 'penawar') return st.penawarId === activeId;
      if (key === 'doubleMove') return st.doubleId === activeId;
      if (key === 'throwQuestion') return st.questionThrown;
      if (key === 'eliminateTwo') return eliminated.length > 0;
      return false;
    };

    const armSlots = st.arms[myId] || [];
    const armsFired = st.armedTurn === myId;
    const canUseArms = canAnswer && !armsFired;

    const openArmPicker = (slot) => {
      const targets = GE.pointableTargets(slot.key, myId, players, positions);
      const valid = targets.filter((t) => t.valid);
      if (!valid.length) {
        window.Dialog.alert({ icon: 'warning', text: slot.key === 'portal' ? 'Portal butuh lawan di depanmu.' : 'Tidak ada target sah.' });
        return;
      }
      setArmTarget({ slot, targets });
    };
    /* Efek senjata diambil dari konstanta engine agar teks tidak menyimpang. */
    const describeArmEffect = (slot, entry) => {
      const bomb = GE.BOMB_STEPS.join('/');
      if (slot.key === 'bomb') return `Kotak ${entry.cell} → mundur ${bomb}`;
      if (slot.key === 'magnet') return `Kotak ${entry.cell} → mundur ${GE.MAGNET_STEPS}`;
      if (slot.key === 'portal') return `Kotak ${entry.cell} ⇄ kotak ${positions[myId]}`;
      return 'Kehilangan 1 bantuan acak';
    };

    /* Peringkat final dihitung server (engine) dan ikut di snapshot. */
    const ranking = st.ranking || [];
    const showWinner = st.phase === 'finished';
    const podiumActive = showWinner && podiumOpen;

    /* Overlay soal/bonus/handoff hanya untuk pemiliknya dan admin (layar IFP).
       Pemain lain tetap melihat papan + pil "Giliran <nama>". */
    const questionOwnerId = question && question.ownerId ? question.ownerId : activeId;
    const canSeeQuestion = isAdmin || (Boolean(myId) && questionOwnerId === myId);
    const bonusOwnerId = st.snakeLadder ? st.snakeLadder.playerId : null;
    const canSeeBonus = isAdmin || (Boolean(myId) && bonusOwnerId === myId);
    const handoffOwnerId = st.handoff ? st.handoff.playerId : null;
    const canSeeHandoff = isAdmin || (Boolean(myId) && handoffOwnerId === myId);
    const isTurnOwner = Boolean(myId) && (
      (st.phase === 'answering' && activeId === myId)
      || (st.phase === 'bonus' && bonusOwnerId === myId)
      || (st.phase === 'handoff' && handoffOwnerId === myId)
    );
    const pillPlayer = (st.phase === 'bonus' && bonusOwnerId && players.find((p) => p.id === bonusOwnerId))
      || (st.phase === 'handoff' && handoffOwnerId && players.find((p) => p.id === handoffOwnerId))
      || answeringPlayer;
    const showTurnPill = Boolean(myId) && !isAdmin && !isTurnOwner && ['answering', 'bonus', 'handoff'].includes(st.phase);

    const questionOverlayProps = question && question.question ? {
      /* Payload soal = { question: <redacted>, clue, clueRevealed, … }.
         Clue hanya terisi setelah bantuan Clue dipakai, jadi petunjuk
         disisipkan ke soal di sini. */
      question: question.clue ? { ...question.question, clue: question.clue } : question.question,
      answeringPlayer,
      players,
      activeId,
      seconds: seconds === null ? 0 : seconds,
      showClue: Boolean(question.clueRevealed),
      picked: question.picked,
      correctLetter: question.correct,
      showAnswer: Boolean(st.revealed),
      reward,
      penaltyBlocked: Boolean(st.shields[activeId]),
      penawarBlocked: st.penawarId === activeId,
      onAnswer: (letter) => emit('game:answer', { letter }),
      helps: helpsForActive,
      onUseHelp: (key) => emit('game:useHelp', { key }),
      helpBlocked,
      helpActive,
      armSlots,
      showArms: !st.questionThrown,
      canUseArms,
      armsFired,
      onPickArm: openArmPicker,
      positions,
      bankLeft: st.bankLeft,
      helpsLocked: false,
      canAnswer,
      eliminated,
    } : null;

    return (
      <div className="play3d">
        {!podiumActive && (use3d ? (
          <div className={attackFx ? 'scene-hidden' : ''}>
            <UI.Scene3D boardRef={boardRef} players={players} positions={positions} characterStyles={GE.CHARACTERS} onError={() => {}} onReady={() => {}} />
            <UI.ScoreFloats mode="3d" floats={scoreFloats} boardRef={boardRef} positions={positions} />
          </div>
        ) : (
          <div className="board-fallback"><div className="board-wrap">
            <UI.Board players={players} positions={positions} sessionWeapons={st.sessionWeapons}>
              <UI.ScoreFloats mode="2d" floats={scoreFloats} positions={positions} />
            </UI.Board>
          </div></div>
        ))}

        <div className="hud" style={podiumActive ? { display: 'none' } : undefined}>
          <header className="hud-top">
            <div className="brand hud-brand"><span className="brand-mark"><i className="fa-solid fa-dice-five"></i></span>
              <div className="grow"><h1 className="brand-title">EduLadder Battle</h1>
                <p className="brand-sub">Room {snapshot.code} · {st.bankLeft} soal tersisa</p></div></div>
            <div className="turn-banner" style={GE.themeVars(answeringPlayer)} role="status">
              <i className={`fa-solid ${st.questionThrown ? 'fa-arrow-right-arrow-left' : 'fa-bullseye'}`}></i>
              <div><div className="turn-label">{st.questionThrown ? 'Soal dilempar ke' : 'Giliran'}</div>
                <div className="turn-name">{GE.playerNameOf(answeringPlayer)}</div></div>
            </div>
            <div className="row" style={{ gap: '0.6rem' }}>
              <div className="clock"><i className="fa-regular fa-clock"></i><div className="clock-text"><div className="clock-label">Total</div><div className="clock-value">{UI.formatTime(st.gameSeconds || 0)}</div></div></div>
              <button className="icon-btn" onClick={() => setSoundOn(!soundOn)}><i className={`fa-solid ${soundOn ? 'fa-volume-high' : 'fa-volume-xmark'}`}></i></button>
              <button className="icon-btn" onClick={() => setMusicOn(!musicOn)}><i className={`fa-solid ${musicOn ? 'fa-music' : 'fa-volume-xmark'}`}></i></button>
              <button className="icon-btn" onClick={() => { if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); else document.exitFullscreen && document.exitFullscreen(); }}><i className="fa-solid fa-expand"></i></button>
              <button className="icon-btn" onClick={onLeave} aria-label="Keluar room"><i className="fa-solid fa-house"></i></button>
            </div>
          </header>

          {isAdmin && (
            <div className="admin-bar">
              <span><i className="fa-solid fa-user-shield"></i> Admin · {snapshot.code}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => emit('admin:forceContinue')}>Paksa Lanjut</button>
              <button className="btn btn-ghost btn-sm" onClick={() => emit('admin:endGame')}>Tutup Sesi</button>
              <button className="btn btn-ghost btn-sm" onClick={() => emit('admin:replay')}>Main Lagi</button>
            </div>
          )}

          <div className={`hud-teams ${players.length > 4 ? 'many' : ''}`}>
            {players.map((p) => {
              const character = GE.characterStyle(p.char || p.slot);
              return (
                <div key={p.id} className={`score-card ${currentId === p.id ? 'active' : ''} ${p.status === 'resting' ? 'resting' : ''}`} style={GE.themeVars(p)}>
                  <span
                    className="avatar"
                    style={{
                      background: character.soft,
                      color: character.deep,
                      boxShadow: `inset 0 0 0 2px ${character.color}`,
                      fontSize: '1.35rem',
                    }}
                    aria-hidden="true"
                  >{character.emoji}</span>
                  <div className="grow">
                    <div className="score-name-row">
                      <span className="score-slot">#{p.slot}</span>
                      <span className="score-name">{GE.playerNameOf(p)}</span>
                      {st.shields[p.id] && <span className="score-badge shield"><i className="fa-solid fa-shield-halved"></i></span>}
                      {st.penawarId === p.id && <span className="score-badge penawar"><i className="fa-solid fa-prescription-bottle-medical"></i></span>}
                      {st.locked[p.id] && <span className="score-badge locked"><i className="fa-solid fa-lock"></i></span>}
                      {p.status === 'resting' && <span className="score-badge locked" title="Istirahat (terputus)"><i className="fa-solid fa-bed"></i></span>}
                      {!p.connected && p.status !== 'resting' && <span className="score-badge locked" title="Terputus"><i className="fa-solid fa-plug-circle-xmark"></i></span>}
                      {p.joinedMidGame && <span className="score-badge locked" title="Bergabung di tengah permainan"><i className="fa-solid fa-user-plus"></i></span>}
                    </div>
                    <div className="score-pos">{positions[p.id]}<small>/100</small></div>
                    {(st.arms[p.id] || []).length > 0 && <UI.ArmBay slots={st.arms[p.id]} active={myId === p.id} canUse={canUseArms && myId === p.id} fired={armsFired} onPick={openArmPicker} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {st.phase === 'countdown' && <UI.StartCountdown count={st.startCount} teamName={GE.playerNameOf(players[0])} />}

        {st.phase === 'answering' && questionOverlayProps && canSeeQuestion && !attackFx && <UI.MainQuestionOverlay {...questionOverlayProps} />}

        {isBonus && st.snakeLadder && question && question.question && canSeeBonus && !attackFx && (
          <UI.BonusOverlay info={st.snakeLadder} question={question.clue ? { ...question.question, clue: question.clue } : question.question} seconds={seconds === null ? 0 : seconds} limit={questionDuration} picked={question.picked} correctLetter={question.correct} revealed={Boolean(st.revealed)} players={players} onAnswer={(letter) => emit('game:answer', { letter })} canAnswer={canBonusAnswer} />
        )}

        {attackFx && (
          <div className="attack-reveal" role="status" aria-live="polite">
            <i className={GE.weaponOf(attackFx.weapon).icon} aria-hidden="true"></i>
            <span>
              {GE.weaponOf(attackFx.weapon).label} milik{' '}
              {GE.playerNameOf(players.find((p) => p.id === attackFx.actorId) || {})}
              {' → '}
              {GE.playerNameOf(players.find((p) => p.id === attackFx.targetId) || {})}
              {attackFx.shielded ? ' ditahan Shield' : ''}
            </span>
          </div>
        )}

        {st.phase === 'handoff' && st.handoff && canSeeHandoff && (
          <UI.TurnHandoffBanner info={st.handoff} player={players.find((p) => p.id === st.handoff.playerId) || players[0]} canPress={isAdmin || myId === st.handoff.playerId} onContinue={() => emit(isAdmin ? 'admin:forceContinue' : 'game:continue')} />
        )}

        {showTurnPill && pillPlayer && (
          <div className="turn-pill" style={GE.themeVars(pillPlayer)} role="status" aria-live="polite">
            <span className="turn-pill-avatar" aria-hidden="true">{GE.characterStyle(pillPlayer.char || pillPlayer.slot).emoji}</span>
            <span className="turn-pill-text">
              <small>{st.phase === 'bonus' ? 'Soal bonus' : st.phase === 'handoff' ? 'Giliran berikutnya' : 'Sekarang menjawab'}</small>
              <strong>Giliran {GE.playerNameOf(pillPlayer)}</strong>
            </span>
            {st.phase === 'answering' && seconds !== null && <span className="turn-pill-timer">{seconds}</span>}
          </div>
        )}

        {armTarget && (
          <UI.ArmTargetModal request={{ slot: armTarget.slot, targets: armTarget.targets }} actorName={GE.playerNameOf(currentPlayer)} describeEffect={(entry) => describeArmEffect(armTarget.slot, entry)} onConfirm={(targetId) => { emit('game:fireWeapon', { uid: armTarget.slot.uid, targetId }); setArmTarget(null); }} onClose={() => setArmTarget(null)} />
        )}

        {podiumActive && (
          <UI.PodiumStage
            ranking={ranking}
            players={players}
            characterStyles={GE.CHARACTERS}
            onClose={() => setPodiumOpen(false)}
            onShowResults={() => { setPodiumOpen(false); setWinnerOpen(true); }}
          />
        )}

        {showWinner && winnerOpen && (
          <UI.Modal open onClose={() => setWinnerOpen(false)} labelledBy="winner-title">
            <UI.Confetti active={showWinner && !podiumActive} />
            <div className="modal-icon gold"><i className={`fa-solid ${st.winner === 'Seri' || !st.winner ? 'fa-handshake' : 'fa-trophy'}`}></i></div>
            <h2 id="winner-title">{st.winner === 'Seri' ? 'Permainan Seri!' : st.winner ? `${GE.playerNameOf(players.find((p) => p.id === st.winner) || players[0])} Menang!` : 'Permainan Selesai'}</h2>
            <p className="lead">{st.winnerReason}</p>
            <div className="final-ranking">
              {ranking.map((entry, index) => (
                <div key={entry.id} className={`ranking-row ${st.winner === entry.id ? 'is-winner' : ''}`} style={GE.themeVars({ slot: entry.slot })}>
                  <span className="rank-num">{index + 1}</span><span className="avatar">{entry.slot}</span>
                  <div className="grow"><div className="ranking-name">{entry.name}</div><div className="ranking-sub">Kotak {entry.pos} · sisa bantuan {entry.helps}</div></div>
                </div>
              ))}
            </div>
            {isAdmin ? <div className="modal-actions"><button className="btn btn-primary" onClick={() => emit('admin:replay')}>Main Lagi</button><button className="btn btn-ghost" onClick={() => emit('admin:endGame')}>Tutup Sesi</button></div>
              : <p className="panel-sub">Menunggu admin memulai permainan baru.</p>}
          </UI.Modal>
        )}

        {showWinner && !winnerOpen && !podiumActive && (
          <button type="button" className="btn btn-primary result-reopen" onClick={() => setWinnerOpen(true)}>
            <i className="fa-solid fa-trophy" aria-hidden="true"></i> Lihat hasil
          </button>
        )}
      </div>
    );
  }

  window.GameScreen = GameScreen;
})();

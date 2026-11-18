/* Semua <script type="text/babel"> berbagi scope global; berkas ini
   dibungkus IIFE agar binding top-level tidak bentrok antar berkas. */
(function () {
  'use strict';
  const { useState, useEffect, useRef, useMemo } = React;
  const GE = window.GameEngine;

  const { WIN_POSITION, BOARD_SIZE, LADDERS, SNAKES, WEAPON_CELLS, HELPS, ARMS_CAPACITY } = GE;
  const { weaponOf, themeVars, playerNameOf, normalizeBag, sumHelps, rowCases } = GE;

  /* ------------------------------------------------------------------ */
  /* Shared UI                                                           */
  /* ------------------------------------------------------------------ */

  function Modal({ open, onClose, labelledBy, narrow, children, closable = true }) {
    /* Escape menutup dialog, sama seperti tombol X. */
    useEffect(() => {
      if (!open || !closable) return undefined;
      const onKey = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [open, closable, onClose]);

    if (!open) return null;
    return (
      <div
        className="modal-overlay"
        onMouseDown={(event) => {
          if (closable && event.target === event.currentTarget) onClose();
        }}
      >
        <div className={`modal ${narrow ? 'narrow' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}>
          {closable && (
            <button className="modal-close" onClick={onClose} aria-label="Tutup dialog">
              <i className="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          )}
          <div className="modal-body">{children}</div>
        </div>
      </div>
    );
  }

  function Toasts({ toasts }) {
    if (!toasts.length) return null;
    return (
      <div className="toast-layer" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone} ${toast.leaving ? 'leaving' : ''}`}>
            <i className={toast.icon} aria-hidden="true"></i>
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    );
  }

  function ResultFlash({ flash }) {
    if (!flash) return null;
    return (
      <div className={`flash ${flash.tone}`} aria-hidden="true">
        <div className="flash-inner">
          <i className={`fa-solid ${flash.tone === 'good' ? 'fa-circle-check' : 'fa-circle-xmark'}`}></i>
          <span>{flash.text}</span>
        </div>
      </div>
    );
  }

  /* Gambar soal/opsi: hanya URL http/https, dimuat malas, dan disembunyikan
     bila gagal dimuat agar tidak merusak tata letak layar besar. */
  function Img({ src, alt, className }) {
    const [failed, setFailed] = React.useState(false);
    if (!src || failed) return null;
    return (
      <img
        className={className || 'question-image'}
        src={src}
        alt={alt || 'Gambar soal'}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }

  function optionText(option) {
    if (option && typeof option === 'object') return option.text || '';
    return String(option === undefined || option === null ? '' : option);
  }

  function optionImage(option) {
    if (option && typeof option === 'object') return option.imageUrl || '';
    return '';
  }

  /* ------------------------------------------------------------------ */
  /* Board 2D (fallback)                                                 */
  /* ------------------------------------------------------------------ */

  function centerOf(cell, svgW, svgH) {
    const col = (cell - 1) % BOARD_SIZE;
    const rowFromBottom = Math.floor((cell - 1) / BOARD_SIZE);
    const rowFromTop = BOARD_SIZE - 1 - rowFromBottom;
    const visualCol = rowFromBottom % 2 === 0 ? col : BOARD_SIZE - 1 - col;
    const cellW = svgW / BOARD_SIZE;
    const cellH = svgH / BOARD_SIZE;
    return { x: cellW * (visualCol + 0.5), y: cellH * (rowFromTop + 0.5) };
  }

  function ladderGraphic(from, to, svgW, svgH) {
    const a = centerOf(from, svgW, svgH);
    const b = centerOf(to, svgW, svgH);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const unit = svgW / BOARD_SIZE;
    const half = unit * 0.16;
    const rungs = [];
    const count = Math.max(3, Math.round(length / (unit / 2.2)));
    for (let i = 1; i < count; i++) {
      const t = i / count;
      const cx = a.x + dx * t;
      const cy = a.y + dy * t;
      rungs.push(
        <line key={i} x1={cx + nx * half} y1={cy + ny * half} x2={cx - nx * half} y2={cy - ny * half} stroke="#ca8a04" strokeWidth={unit * 0.06} strokeLinecap="round" />
      );
    }
    return (
      <g key={`ladder-${from}`}>
        <line x1={a.x + nx * half} y1={a.y + ny * half} x2={b.x + nx * half} y2={b.y + ny * half} stroke="#a16207" strokeWidth={unit * 0.08} strokeLinecap="round" />
        <line x1={a.x - nx * half} y1={a.y - ny * half} x2={b.x - nx * half} y2={b.y - ny * half} stroke="#a16207" strokeWidth={unit * 0.08} strokeLinecap="round" />
        {rungs}
        <circle cx={b.x} cy={b.y} r={unit * 0.13} fill="#22c55e" stroke="#fff" strokeWidth={unit * 0.03} />
      </g>
    );
  }

  function snakeGraphic(head, tail, svgW, svgH, index) {
    const a = centerOf(head, svgW, svgH);
    const b = centerOf(tail, svgW, svgH);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const unit = svgW / BOARD_SIZE;
    const amplitude = Math.min(length * 0.14, unit * 0.8);
    const segments = 28;
    const points = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const wave = Math.sin(t * Math.PI * 3) * amplitude * Math.sin(t * Math.PI);
      points.push({ x: a.x + dx * t + nx * wave, y: a.y + dy * t + ny * wave });
    }
    const path = points.map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
    const color = index % 2 === 0 ? '#be123c' : '#7e22ce';
    const width = unit * 0.17;
    return (
      <g key={`snake-${head}`}>
        <path d={path} fill="none" stroke="rgba(69,10,10,0.22)" strokeWidth={width + unit * 0.06} strokeLinecap="round" />
        <path d={path} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" />
        <circle cx={a.x} cy={a.y} r={unit * 0.3} fill="#fb7185" stroke="#fff" strokeWidth={unit * 0.055} />
        <circle cx={a.x - unit * 0.1} cy={a.y - unit * 0.07} r={unit * 0.055} fill="#450a0a" />
        <circle cx={a.x + unit * 0.11} cy={a.y - unit * 0.05} r={unit * 0.055} fill="#450a0a" />
        <circle cx={b.x} cy={b.y} r={unit * 0.09} fill={color} stroke="#fff" strokeWidth={unit * 0.025} />
      </g>
    );
  }

  const BOARD_CELLS = (() => {
    const list = [];
    for (let row = BOARD_SIZE - 1; row >= 0; row--) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const num = rowCases(row, col);
        list.push({ num, dark: (row + col) % 2 === 1, ladder: Boolean(LADDERS[num]), snake: Boolean(SNAKES[num]), arm: WEAPON_CELLS.includes(num) });
      }
    }
    return list;
  })();

  function Board({ players, positions, targetCell, movingId, sessionWeapons, children }) {
    return (
      <div className="board-stage">
        <div className="board-surface">
          {BOARD_CELLS.map((cell) => {
            const weapon = cell.arm && sessionWeapons && sessionWeapons[cell.num] ? weaponOf(sessionWeapons[cell.num]) : null;
            return (
              <div
                key={cell.num}
                className={[
                  'cell',
                  cell.dark ? 'dark' : '',
                  cell.ladder ? 'ladder-cell' : '',
                  cell.snake ? 'snake-cell' : '',
                  cell.arm ? 'arm-cell' : '',
                  cell.num === WIN_POSITION ? 'finish' : '',
                  cell.num === 1 ? 'start' : '',
                  targetCell === cell.num ? 'is-target' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className="cell-num">{cell.num}</span>
                {cell.num === WIN_POSITION && <i className="fa-solid fa-trophy cell-icon" aria-hidden="true"></i>}
                {cell.ladder && <i className="fa-solid fa-stairs cell-icon" aria-hidden="true"></i>}
                {cell.snake && <i className="fa-solid fa-staff-snake cell-icon" aria-hidden="true"></i>}
                {cell.arm && (
                  <i className={`${weapon ? weapon.icon : 'fa-solid fa-crosshairs'} cell-icon arm-icon`} title={weapon ? `Kotak senjata: ${weapon.label}` : 'Kotak senjata'} aria-hidden="true"></i>
                )}
                {(() => {
                  const occupants = players.filter((player) => positions[player.id] === cell.num);
                  if (!occupants.length) return null;
                  return (
                    <div className={`tokens ${occupants.length > 1 ? 'shared' : ''} count-${occupants.length}`}>
                      {occupants.map((player) => (
                        <div key={player.id} className={`token ${movingId === player.id ? 'moving' : ''}`} style={themeVars(player)} title={playerNameOf(player)}>
                          {player.slot}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
        <svg className="board-svg" viewBox="0 0 1000 1000" aria-hidden="true" focusable="false">
          {Object.keys(LADDERS).map((from) => ladderGraphic(Number(from), LADDERS[from], 1000, 1000))}
          {Object.keys(SNAKES).map((head, index) => snakeGraphic(Number(head), SNAKES[head], 1000, 1000, index))}
        </svg>
        {children}
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /* 3D scene                                                            */
  /* ------------------------------------------------------------------ */

  function detectWebGL() {
    if (!window.Board3D) return { ok: false, reason: 'board3d.js gagal dimuat' };
    if (!window.THREE) return { ok: false, reason: 'Three.js gagal dimuat dari CDN' };
    try {
      if (typeof window.Board3D.supported === 'function') return window.Board3D.supported();
      return { ok: Boolean(window.Board3D), reason: '' };
    } catch (error) {
      return { ok: false, reason: `Deteksi WebGL gagal: ${error && error.message ? error.message : error}` };
    }
  }

  function Scene3D({ boardRef, players, positions, characterStyles, onError, onReady }) {
    const mountRef = useRef(null);
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;

    useEffect(() => {
      const mount = mountRef.current;
      if (!mount) return undefined;
      const fail = (reason, error) => {
        console.warn(`Papan 3D tidak tersedia: ${reason}`, error || '');
        if (onErrorRef.current) onErrorRef.current(reason);
      };
      if (!window.Board3D) return fail('board3d.js gagal dimuat');
      if (!window.THREE) return fail('Three.js gagal dimuat dari CDN');
      let board = null;
      try {
        board = new window.Board3D(mount, {
          ladders: LADDERS,
          snakes: SNAKES,
          weaponCells: WEAPON_CELLS,
          players: players.map((player) => ({ ...player, name: playerNameOf(player) })),
          positions,
          characterStyles,
          onError: (error) => {
            const message = error && error.message ? error.message : 'Konteks WebGL bermasalah';
            if (onErrorRef.current) onErrorRef.current(message);
          },
        });
        boardRef.current = board;
        if (onReadyRef.current) onReadyRef.current(board);
      } catch (error) {
        fail(error && error.message ? error.message : 'Papan 3D gagal dibuat', error);
      }
      return () => {
        if (board) board.dispose();
        if (boardRef.current === board) boardRef.current = null;
      };
    }, []);

    return <div className="scene-mount" ref={mountRef} aria-hidden="true" />;
  }

  /* ------------------------------------------------------------------ */
  /* Answers & helps                                                     */
  /* ------------------------------------------------------------------ */

  function OverlayAnswerGrid({ options, correctLetter, picked, showAnswer, onAnswer, disabled }) {
    return (
      <div className="overlay-answers" role="group" aria-label="Pilihan jawaban">
        {(options || []).map((option, index) => {
          const letter = String.fromCharCode(65 + index);
          const isCorrect = correctLetter ? letter === correctLetter : false;
          const isPicked = picked === letter;
          let stateClass = '';
          let verdictIcon = null;
          if (showAnswer) {
            if (isPicked && isCorrect) {
              stateClass = 'picked-correct';
              verdictIcon = <i className="fa-solid fa-circle-check verdict" aria-hidden="true"></i>;
            } else if (isPicked) {
              stateClass = 'picked-wrong';
              verdictIcon = <i className="fa-solid fa-circle-xmark verdict" aria-hidden="true"></i>;
            } else if (isCorrect) {
              stateClass = 'revealed-correct';
              verdictIcon = <i className="fa-solid fa-circle-check verdict" style={{ color: '#15803d' }} aria-hidden="true"></i>;
            } else {
              stateClass = 'dimmed';
            }
          }
          return (
            <button
              key={letter}
              type="button"
              className={`answer overlay-answer ${stateClass}`}
              onClick={() => onAnswer && onAnswer(letter)}
              disabled={disabled || showAnswer}
              aria-label={`Pilihan ${letter}: ${optionText(option)}`}
            >
              <span className="letter">{letter}</span>
              <span className="answer-text">
                {optionText(option)}
                <Img src={optionImage(option)} alt={`Gambar pilihan ${letter}`} className="option-image" />
              </span>
              {verdictIcon}
            </button>
          );
        })}
      </div>
    );
  }

  const HELP_TABS = [
    { key: 'help', label: 'Bantuan', icon: 'fa-solid fa-wand-magic-sparkles' },
    { key: 'defense', label: 'Pertahanan', icon: 'fa-solid fa-shield-halved' },
  ];

  function HelpsRow({ helps, onUseHelp, helpBlocked, helpActive, helpDescription, tab, onTabChange, locked }) {
    const bag = normalizeBag(helps);
    const groupHelps = HELPS.filter((help) => help.group === tab);
    const groupCount = (groupKey) => HELPS.filter((help) => help.group === groupKey).reduce((sum, help) => sum + (bag[help.key] || 0), 0);

    return (
      <div className={`overlay-helps ${locked ? 'locked' : ''}`}>
        <div className="overlay-helps-head">
          <h3>
            <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Bantuan
          </h3>
          <span className={`pill ${locked ? 'warn' : 'neutral'}`}>
            <i className={`fa-solid ${locked ? 'fa-lock' : 'fa-layer-group'}`} aria-hidden="true"></i>
            {locked ? 'Terkunci' : `${sumHelps(bag)} tersisa`}
          </span>
        </div>
        <div className="helps-tabs" role="tablist" aria-label="Jenis bantuan">
          {HELP_TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              className={`help-tab ${tab === item.key ? 'active' : ''}`}
              onClick={() => onTabChange(item.key)}
            >
              <i className={item.icon} aria-hidden="true"></i>
              {item.label}
              <span className="help-tab-count">{groupCount(item.key)}</span>
            </button>
          ))}
        </div>
        <div className={`helps-grid overlay-helps-grid ${tab === 'defense' ? 'defense' : ''}`} role="tabpanel">
          {groupHelps.map((help) => (
            <button
              key={help.key}
              type="button"
              className={`help-btn ${help.cls} ${helpActive(help.key) ? 'active' : ''}`}
              onClick={() => onUseHelp(help.key)}
              disabled={locked || helpBlocked(help.key)}
              aria-label={`${help.label}: ${help.short}. Sisa ${bag[help.key]}.`}
              aria-pressed={helpActive(help.key)}
              title={locked ? 'Soal ini dilempar ke pemain lain; bantuan dikunci.' : help.desc}
            >
              <span className={`help-count ${bag[help.key] === 0 ? 'zero' : ''}`}>{bag[help.key]}</span>
              <i className={help.icon} aria-hidden="true"></i>
              {help.label}
            </button>
          ))}
        </div>
        <p className="help-desc">{locked ? 'Soal ini dilempar ke pemain berikutnya. Hanya penerima yang menjawab.' : helpDescription}</p>
      </div>
    );
  }

  function ArmBay({ slots, active, canUse, fired, onPick, variant }) {
    const items = [0, 1].map((index) => slots[index] || null);
    if (!slots.length && variant !== 'panel') return null;
    return (
      <div className={`arm-bay ${active ? 'active' : ''} ${variant === 'panel' ? 'panel' : ''}`} aria-label="Baki senjata">
        {items.map((slot, index) => {
          const weapon = slot ? weaponOf(slot.key) : null;
          const usable = Boolean(slot) && active && canUse && !fired;
          return (
            <button
              key={slot ? slot.uid : `empty-${index}`}
              type="button"
              className={`arm-slot ${weapon ? 'filled' : 'empty'} ${usable ? 'usable' : ''}`}
              style={weapon ? { '--arm-tone': weapon.tone, '--arm-soft': weapon.soft, '--arm-line': weapon.line } : undefined}
              onClick={() => (usable ? onPick(slot) : null)}
              disabled={!usable}
              aria-label={weapon ? `${weapon.label}${usable ? ', tekan untuk memilih lawan' : ''}` : `Slot senjata ${index + 1} kosong`}
            >
              <i className={weapon ? weapon.icon : 'fa-regular fa-square'} aria-hidden="true"></i>
              {weapon && <span className="arm-slot-label">{weapon.label}</span>}
            </button>
          );
        })}
      </div>
    );
  }

  function ArmTargetModal({ request, actorName, describeEffect, onConfirm, onClose }) {
    if (!request) return null;
    const weapon = weaponOf(request.slot.key);
    const anyValid = request.targets.some((item) => item.valid);
    return (
      <Modal open onClose={onClose} labelledBy="arm-title" narrow>
        <div className="arm-modal-icon" style={{ background: weapon.soft, color: weapon.tone }}>
          <i className={weapon.icon} aria-hidden="true"></i>
        </div>
        <h2 id="arm-title">Lepas {weapon.label}?</h2>
        <p className="lead">{actorName} memilih lawan untuk dikenai {weapon.label}. Satu serangan per giliran.</p>
        <div className="arm-targets" role="list">
          {request.targets.map((item) => (
            <button key={item.player.id} type="button" role="listitem" className="arm-target" style={themeVars(item.player)} disabled={!item.valid} onClick={() => onConfirm(item.player.id)}>
              <span className="avatar" aria-hidden="true">{item.player.slot}</span>
              <span className="grow">
                <span className="arm-target-name">{playerNameOf(item.player)}</span>
                <span className="arm-target-sub">
                  Kotak {item.cell}
                  {item.valid ? '' : ' · di belakangmu, Portal tidak bisa'}
                </span>
                {item.valid && describeEffect && <span className="arm-target-delta">{describeEffect(item)}</span>}
              </span>
              <i className={`fa-solid ${item.valid ? 'fa-arrow-right' : 'fa-ban'} arm-target-go`} aria-hidden="true"></i>
            </button>
          ))}
        </div>
        {!anyValid && <p className="overlay-note">Tidak ada target sah. Pilih senjata lain atau simpan untuk giliran berikutnya.</p>}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            <i className="fa-solid fa-xmark" aria-hidden="true"></i>
            Batal
          </button>
        </div>
      </Modal>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Turn & question overlays                                            */
  /* ------------------------------------------------------------------ */

  function StartCountdown({ count, teamName }) {
    return (
      <div className="start-countdown" role="status" aria-live="assertive" aria-label={`Permainan dimulai dalam ${count} detik`}>
        <div className="start-countdown-inner">
          <span className="start-kicker">
            <i className="fa-solid fa-flag-checkered" aria-hidden="true"></i> Bersiap!
          </span>
          <span key={count} className="start-number" aria-hidden="true">{count}</span>
          <span className="start-team">Giliran {teamName} · mulai dari kotak 1</span>
          <div className="start-progress" aria-hidden="true">
            <span key={`bar-${count}`}></span>
          </div>
        </div>
      </div>
    );
  }

  function TurnHandoffBanner({ info, player, onContinue, canPress }) {
    if (!info || !player) return null;
    const thrown = info.mode === 'ready';
    const messages = {
      thrown: 'Soal dilempar kepadamu. Timer mulai penuh setelah kamu menekan tombol.',
      answer: 'Siap menjawab soal berikutnya? Timer baru berjalan setelah kamu siap.',
      locked: 'Giliranmu terkunci tadi, jadi tidak ada langkah maju.',
      penawar: 'Hukuman soal ditahan Penawar. Giliranmu selesai.',
      shield: 'Shield menahan hukuman soal. Giliranmu selesai.',
      ladder: 'Selesai naik tangga. Bersiap untuk giliran berikutnya.',
      snake: 'Selesai turun karena ular. Bersiap untuk giliran berikutnya.',
      start: 'Permainan siap. Tekan Lanjutkan untuk soal pertama.',
    };
    return (
      <div className="turn-handoff" role="dialog" aria-modal="true" aria-label="Beralih ke pemain berikutnya">
        <div className="turn-handoff-card" style={themeVars(player)}>
          <span className={`handoff-kicker ${thrown ? 'thrown' : ''}`}>
            <i className={`fa-solid ${thrown ? 'fa-arrow-right-arrow-left' : 'fa-flag-checkered'}`} aria-hidden="true"></i>
            {thrown ? 'Soal untukmu' : 'Giliran berikutnya'}
          </span>
          <div className="handoff-actor">
            <span className="avatar" aria-hidden="true">{player.slot}</span>
            <div className="grow">
              <strong>{playerNameOf(player)}</strong>
              <p>{messages[info.reason] || messages.answer}</p>
            </div>
          </div>
          {canPress ? (
            <button className="btn btn-primary" onClick={onContinue} autoFocus>
              <i className={`fa-solid ${thrown ? 'fa-play' : 'fa-forward'}`} aria-hidden="true"></i>
              {thrown ? 'Siap, jawab soal' : 'Lanjutkan'}
            </button>
          ) : (
            <p className="overlay-note" style={{ textAlign: 'center' }}>
              <i className="fa-solid fa-hourglass-half" aria-hidden="true"></i> Menunggu {playerNameOf(player)} menekan Lanjutkan…
            </p>
          )}
          <span className="handoff-hint">
            <i className="fa-solid fa-keyboard" aria-hidden="true"></i> Tekan Enter atau tombol untuk lanjut
          </span>
        </div>
      </div>
    );
  }

  function MainQuestionOverlay({
    question,
    answeringPlayer,
    players,
    activeId,
    seconds,
    showClue,
    picked,
    correctLetter,
    showAnswer,
    reward,
    penaltyBlocked,
    penawarBlocked,
    onAnswer,
    helps,
    onUseHelp,
    helpBlocked,
    helpActive,
    helpDescription,
    helpsTab,
    onHelpsTabChange,
    armSlots,
    showArms,
    canUseArms,
    armsFired,
    onPickArm,
    positions,
    bankLeft,
    helpsLocked,
    canAnswer,
  }) {
    if (!question) return null;
    return (
      <div className="overlay-root" role="dialog" aria-modal="true" aria-label="Soal aktif">
        <div className="overlay-card">
          <section className="overlay-main" aria-label="Kartu soal">
            <div className="overlay-head">
              <span className="q-team-chip" style={themeVars(answeringPlayer)}>
                <i className="fa-solid fa-user" aria-hidden="true"></i>
                {playerNameOf(answeringPlayer)}
              </span>
              <span className={`pill ${showAnswer ? 'neutral' : 'brand'}`}>
                <i className={`fa-solid ${showAnswer ? 'fa-flag-checkered' : 'fa-hand-pointer'}`} aria-hidden="true"></i>
                {showAnswer ? 'Jawaban dibuka' : 'Pilih satu jawaban'}
              </span>
              <span className="grow"></span>
              <Countdown seconds={seconds} limit={question.duration} theme={themeVars(answeringPlayer)} />
            </div>

            <h2 className="overlay-question">{question.question}</h2>
            <Img src={question.questionImage} alt="Gambar soal" className="question-image" />
            {showClue && question.clue && (
              <div className="clue-box overlay-clue">
                <i className="fa-solid fa-lightbulb" aria-hidden="true"></i>
                <span>{question.clue}</span>
              </div>
            )}

            <OverlayAnswerGrid options={question.options} correctLetter={correctLetter} picked={picked} showAnswer={showAnswer} onAnswer={onAnswer} disabled={!canAnswer} />

            <HelpsRow
              helps={helps}
              onUseHelp={onUseHelp}
              helpBlocked={helpBlocked}
              helpActive={helpActive}
              helpDescription={helpDescription}
              tab={helpsTab}
              onTabChange={onHelpsTabChange}
              locked={helpsLocked || !canAnswer}
            />

            <div className="overlay-foot">
              <span className={`pill ${reward.double ? 'warn' : 'good'}`}>
                <i className="fa-solid fa-arrow-up-right-dots" aria-hidden="true"></i>
                Benar: maju {reward.text}
              </span>
              <span className={`pill ${penaltyBlocked || penawarBlocked ? 'neutral' : 'bad'}`}>
                <i className={`fa-solid ${penaltyBlocked ? 'fa-shield-halved' : 'fa-arrow-down-right'}`} aria-hidden="true"></i>
                {penaltyBlocked ? 'Salah: dilindungi shield' : penawarBlocked ? 'Salah: ditahan penawar' : `Salah: mundur ${question.penalty}`}
              </span>
            </div>
          </section>

          <aside className="overlay-side" aria-label="Status permainan">
            <div className="overlay-side-card">
              <h3>Skor Saat Ini</h3>
              {players.map((player) => (
                <div key={player.id} className={`overlay-score-row ${activeId === player.id ? 'active' : ''}`} style={themeVars(player)}>
                  <span className="avatar" aria-hidden="true">{player.slot}</span>
                  <span className="overlay-score-name">{playerNameOf(player)}</span>
                  <span className="overlay-score-pos">{positions[player.id]}<small>/100</small></span>
                </div>
              ))}
            </div>

            <div className="overlay-side-card">
              <h3>Bank Soal</h3>
              <p className="overlay-bank">
                <i className="fa-solid fa-database" aria-hidden="true"></i>
                {bankLeft} soal tersisa
              </p>
            </div>

            <div className="overlay-side-card arm-side-card">
              <div className="arm-side-head">
                <h3>Senjata</h3>
                {showArms && (
                  <span className="pill neutral">
                    <i className="fa-solid fa-crosshairs" aria-hidden="true"></i>
                    {armSlots.length}/{ARMS_CAPACITY}
                  </span>
                )}
              </div>
              {showArms ? (
                <>
                  <ArmBay slots={armSlots} active canUse={canUseArms} fired={armsFired} onPick={onPickArm} variant="panel" />
                  <p className="overlay-note">
                    {armsFired ? 'Senjata sudah dilepas giliran ini.' : armSlots.length ? 'Lepas senjata sebelum menjawab. Satu serangan per giliran.' : 'Mendarat di kotak senjata untuk mengisi baki.'}
                  </p>
                </>
              ) : (
                <p className="overlay-note">Soal ini dilempar ke pemain berikutnya. Serangan hanya bisa dilepas pada giliran sendiri.</p>
              )}
            </div>
          </aside>
        </div>
      </div>
    );
  }

  function BonusOverlay({ info, question, seconds, picked, correctLetter, revealed, players, onAnswer, bankLeft, canAnswer }) {
    if (!info) return null;
    const player = players.find((item) => item.id === info.playerId) || players[0];
    const isLadder = info.type === 'ladder';

    if (!question) {
      return (
        <div className="overlay-root" role="dialog" aria-modal="true" aria-label="Bank soal habis">
          <div className="overlay-card bonus narrow">
            <section className="overlay-main">
              <div className={`overlay-icon ${isLadder ? 'ladder' : 'snake'}`}>
                <i className={`fa-solid ${isLadder ? 'fa-stairs' : 'fa-staff-snake'}`} aria-hidden="true"></i>
              </div>
              <h2 className="overlay-question">Bank soal tambahan habis</h2>
              <p className="overlay-lead">Tidak ada soal tersisa untuk uji {isLadder ? 'tangga bonus' : 'ular'}. Permainan lanjut tanpa uji tambahan.</p>
            </section>
          </div>
        </div>
      );
    }

    return (
      <div className="overlay-root" role="dialog" aria-modal="true" aria-label={isLadder ? 'Tangga bonus' : 'Soal penyelamat ular'}>
        <div className={`overlay-card bonus ${info.type}`}>
          <section className="overlay-main" aria-label="Kartu soal bonus">
            <div className="overlay-head">
              <span className={`overlay-kicker ${info.type}`}>
                <i className={`fa-solid ${isLadder ? 'fa-stairs' : 'fa-staff-snake'}`} aria-hidden="true"></i>
                {isLadder ? 'Tangga Bonus' : 'Soal Penyelamat Ular'}
              </span>
              <span className="q-team-chip" style={themeVars(player)}>
                <i className="fa-solid fa-user" aria-hidden="true"></i>
                {playerNameOf(player)}
              </span>
              <span className="grow"></span>
              <Countdown seconds={seconds} limit={question.duration} theme={themeVars(player)} />
            </div>

            <h2 className="overlay-question">{question.question}</h2>
            <Img src={question.questionImage} alt="Gambar soal" className="question-image" />
            <p className="overlay-lead">
              {isLadder
                ? `Berhenti di kotak ${info.from}. Jawab benar untuk naik ke kotak ${info.to}.`
                : `Berhenti di kepala ular kotak ${info.from}. Jawab benar untuk bertahan, salah turun ke kotak ${info.to}.`}
            </p>

            <OverlayAnswerGrid options={question.options} correctLetter={correctLetter} picked={picked} showAnswer={revealed} onAnswer={onAnswer} disabled={!canAnswer} />

            {!revealed && canAnswer && (
              <p className="overlay-note">
                <i className="fa-solid fa-hand-pointer" aria-hidden="true"></i> Pilih satu jawaban sebelum waktu habis.
              </p>
            )}
          </section>

          <aside className="overlay-side" aria-label="Status bonus">
            <div className="overlay-side-card">
              <h3>{isLadder ? 'Naik Tangga' : 'Gigitan Ular'}</h3>
              <p className="overlay-bank">
                <i className={`fa-solid ${isLadder ? 'fa-arrow-up' : 'fa-arrow-down'}`} aria-hidden="true"></i>
                Kotak {info.from} → {info.to}
              </p>
              <p className="overlay-note">{isLadder ? 'Benar: naik. Salah: tetap di kotak asal.' : 'Benar: bertahan. Salah: turun ke ekor ular.'}</p>
            </div>
            <div className="overlay-side-card">
              <h3>Bank Soal</h3>
              <p className="overlay-bank">
                <i className="fa-solid fa-database" aria-hidden="true"></i> {bankLeft} soal tersisa
              </p>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  /* Angka +N / −N / 0 melayang di atas karakter saat reveal jawaban. */
  function cellPercent(cell) {
    const value = Math.max(1, Math.min(WIN_POSITION, Number(cell) || 1));
    const col = (value - 1) % BOARD_SIZE;
    const rowFromBottom = Math.floor((value - 1) / BOARD_SIZE);
    const rowFromTop = BOARD_SIZE - 1 - rowFromBottom;
    const visualCol = rowFromBottom % 2 === 0 ? col : BOARD_SIZE - 1 - col;
    return { left: ((visualCol + 0.5) / BOARD_SIZE) * 100, top: ((rowFromTop + 0.5) / BOARD_SIZE) * 100 };
  }

  function ScoreFloats({ mode, floats, boardRef, positions }) {
    if (!floats || !floats.length) return null;
    return (
      <div className={`score-floats ${mode === '2d' ? 'd2' : 'd3'}`} aria-hidden="true">
        {floats.map((item) => {
          let style;
          if (mode === '2d') {
            const at = cellPercent(positions && positions[item.playerId]);
            style = { left: `${at.left}%`, top: `${at.top}%` };
          } else {
            const board = boardRef && boardRef.current;
            const at = board && typeof board.getPlayerScreenPosition === 'function'
              ? board.getPlayerScreenPosition(item.playerId)
              : null;
            style = at
              ? { left: `${at.x}px`, top: `${at.y}px` }
              : { left: '50%', top: '46%' };
          }
          const delta = Number(item.delta) || 0;
          const label = delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '0';
          return (
            <span key={item.id} className={`score-float ${item.tone || 'neutral'}`} style={style}>
              {label}
            </span>
          );
        })}
      </div>
    );
  }

  function Countdown({ seconds, limit, theme }) {
    const size = 100;
    const radius = 44;
    const circumference = 2 * Math.PI * radius;
    const ratio = limit > 0 ? Math.max(0, Math.min(1, seconds / limit)) : 0;
    const stateClass = seconds <= 3 ? 'critical' : seconds <= 5 ? 'warn' : '';
    return (
      <div className={`countdown ${stateClass}`} style={theme} role="timer" aria-label={`Sisa waktu ${seconds} detik`}>
        <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle className="track" cx={size / 2} cy={size / 2} r={radius} />
          <circle className="progress" cx={size / 2} cy={size / 2} r={radius} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)} />
        </svg>
        <div className="countdown-label">
          <strong>{seconds}</strong>
          <span>DETIK</span>
        </div>
      </div>
    );
  }

  function Confetti({ active }) {
    const canvasRef = useRef(null);
    useEffect(() => {
      if (!active) return undefined;
      const canvas = canvasRef.current;
      if (!canvas) return undefined;
      const ctx = canvas.getContext('2d');
      if (!ctx) return undefined;
      let width = (canvas.width = window.innerWidth);
      let height = (canvas.height = window.innerHeight);
      const colors = ['#fbbf24', '#f43f5e', '#22c55e', '#3b82f6', '#a855f7', '#f97316'];
      const pieces = Array.from({ length: 130 }).map(() => ({
        x: Math.random() * width,
        y: -20 - Math.random() * height,
        size: 6 + Math.random() * 9,
        color: colors[Math.floor(Math.random() * colors.length)],
        speed: 1.6 + Math.random() * 2.8,
        drift: -1.2 + Math.random() * 2.4,
        rotation: Math.random() * Math.PI,
        spin: -0.08 + Math.random() * 0.16,
      }));
      let frame = 0;
      const start = performance.now();
      const onResize = () => {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
      };
      window.addEventListener('resize', onResize);
      const draw = (now) => {
        ctx.clearRect(0, 0, width, height);
        pieces.forEach((piece) => {
          piece.y += piece.speed;
          piece.x += piece.drift;
          piece.rotation += piece.spin;
          if (piece.y > height + 20) {
            piece.y = -20;
            piece.x = Math.random() * width;
          }
          ctx.save();
          ctx.translate(piece.x, piece.y);
          ctx.rotate(piece.rotation);
          ctx.fillStyle = piece.color;
          ctx.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
          ctx.restore();
        });
        if (now - start < 6500) frame = requestAnimationFrame(draw);
        else ctx.clearRect(0, 0, width, height);
      };
      frame = requestAnimationFrame(draw);
      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener('resize', onResize);
      };
    }, [active]);
    return <canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true"></canvas>;
  }

  function downloadTemplate() {
    const content = [GE.CSV_HEADER, ...GE.CSV_SAMPLE_ROWS].join('\r\n');
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

  window.UI = {
    Modal,
    Toasts,
    ResultFlash,
    Img,
    optionText,
    optionImage,
    Board,
    Scene3D,
    OverlayAnswerGrid,
    HelpsRow,
    ArmBay,
    ArmTargetModal,
    StartCountdown,
    TurnHandoffBanner,
    MainQuestionOverlay,
    BonusOverlay,
    ScoreFloats,
    Countdown,
    Confetti,
    downloadTemplate,
    detectWebGL,
    HELP_TABS,
    BOARD_CELLS,
  };
})();

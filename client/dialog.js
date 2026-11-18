/* Pembungkus SweetAlert2 untuk semua popup/konfirmasi di klien.
   Dibungkus IIFE; hanya window.Dialog yang menjadi global. */
(function () {
  'use strict';

  const COLORS = {
    primary: '#4f46e5',
    danger: '#e11d48',
    cancel: '#475569',
  };

  const BASE = {
    reverseButtons: true,
    focusCancel: false,
    buttonsStyling: true,
    confirmButtonColor: COLORS.primary,
    cancelButtonColor: COLORS.cancel,
  };

  function swal() {
    return window.Swal;
  }

  /* Konfirmasi; resolve true bila pengguna menekan tombol konfirmasi. */
  function confirm(options) {
    const opts = typeof options === 'string' ? { text: options } : options || {};
    const danger = Boolean(opts.danger);
    return swal()
      .fire({
        ...BASE,
        icon: opts.icon || (danger ? 'warning' : 'question'),
        title: opts.title || 'Yakin?',
        text: opts.text || '',
        showCancelButton: true,
        confirmButtonText: opts.confirmText || (danger ? 'Hapus' : 'Ya'),
        cancelButtonText: opts.cancelText || 'Batal',
        confirmButtonColor: danger ? COLORS.danger : COLORS.primary,
        focusCancel: danger,
      })
      .then((result) => Boolean(result.isConfirmed));
  }

  /* Pemberitahuan dengan satu tombol OK. */
  function alert(options) {
    const opts = typeof options === 'string' ? { text: options } : options || {};
    return swal()
      .fire({
        ...BASE,
        icon: opts.icon || 'info',
        title: opts.title || '',
        text: opts.text || '',
        confirmButtonText: opts.confirmText || 'OK',
      })
      .then(() => undefined);
  }

  /* Notifikasi singkat di pojok yang hilang sendiri. */
  function toast(text, icon) {
    return swal().fire({
      toast: true,
      position: 'top-end',
      icon: icon || 'success',
      title: text,
      showConfirmButton: false,
      timer: 2600,
      timerProgressBar: true,
    });
  }

  window.Dialog = { confirm, alert, toast };
})();

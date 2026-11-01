/* ==========================================================
   Aviso de cookies
   A escolha do visitante fica no localStorage do navegador:
   "accepted" (aceitou todos) ou "essential" (só essenciais).
   Se o armazenamento estiver bloqueado, o aviso aparece em
   cada visita, mas o site continua funcionando.
   Outros scripts podem ouvir o evento "cookieconsentchange"
   ou ler a escolha com window.cookieConsent.get().
   ========================================================== */
(() => {
  const KEY = "aa-select-cookies";
  const banner = document.getElementById("cookieBanner");

  const read = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };

  const write = (choice) => {
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      /* navegador bloqueou o armazenamento: nada a fazer */
    }
  };

  const show = () => banner.classList.add("on");
  const hide = () => banner.classList.remove("on");

  function save(choice) {
    write(choice);
    hide();
    document.dispatchEvent(new CustomEvent("cookieconsentchange", { detail: { choice } }));
  }

  window.cookieConsent = { get: read };

  banner.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cookie-choice]");
    if (button) save(button.dataset.cookieChoice);
  });

  document.getElementById("cookieSettings").addEventListener("click", show);

  if (!read()) show();
})();

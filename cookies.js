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

  /* Análise e publicidade: só carregam depois de "Aceitar" e só se o ID estiver em config.js */
  let optionalLoaded = false;

  function loadOptional() {
    const cfg = window.APP_CONFIG || {};
    if (optionalLoaded || read() !== "accepted") return;
    optionalLoaded = true;

    if (cfg.GA_MEASUREMENT_ID) {
      const ga = document.createElement("script");
      ga.async = true;
      ga.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(cfg.GA_MEASUREMENT_ID)}`;
      document.head.appendChild(ga);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () {
        window.dataLayer.push(arguments);
      };
      window.gtag("js", new Date());
      window.gtag("config", cfg.GA_MEASUREMENT_ID);
    }

    if (cfg.META_PIXEL_ID) {
      /* Snippet padrão do Meta Pixel, com o ID vindo de config.js */
      const pixel = document.createElement("script");
      pixel.textContent = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${String(cfg.META_PIXEL_ID).replace(/\D/g, "")}');fbq('track','PageView');`;
      document.head.appendChild(pixel);
    }
  }

  function save(choice) {
    write(choice);
    hide();
    loadOptional();
    document.dispatchEvent(new CustomEvent("cookieconsentchange", { detail: { choice } }));
  }

  window.cookieConsent = { get: read };

  banner.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cookie-choice]");
    if (button) save(button.dataset.cookieChoice);
  });

  document.getElementById("cookieSettings").addEventListener("click", show);

  loadOptional();
  if (!read()) show();
})();

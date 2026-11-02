/* ==========================================================
   A&A Select Importados | Lógica do site
   Os produtos vêm do Supabase e são gerenciados em /admin.html
   ========================================================== */

const PAGE_SIZE = 12;

/* ----------------------------------------------------------
   ESTADO E ATALHOS
   ---------------------------------------------------------- */
const state = {
  products: [],
  status: "loading", // loading | ready | error | setup
  category: "Todos",
  term: "",
  limit: PAGE_SIZE,
  cart: {}, // { idDoProduto: quantidade }
};

const $ = (id) => document.getElementById(id);

const formatBRL = (value) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/* Evita que texto digitado no painel quebre ou injete HTML */
const esc = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* Letra exibida no lugar da foto (quando o produto não tem imagem) */
const initialOf = (name) =>
  name.replace(/^Body Splash (VS )?(Victoria.s Secret )?/i, "").charAt(0).toUpperCase();

/* Categorias vêm dos próprios produtos: criou uma nova no painel, ela aparece aqui */
const getCategories = () => ["Todos", ...new Set(state.products.map((p) => p.category))];

/* ----------------------------------------------------------
   SUPABASE
   ---------------------------------------------------------- */
const cfg = window.APP_CONFIG || {};
const isConfigured = Boolean(cfg.SUPABASE_URL) && !cfg.SUPABASE_URL.startsWith("COLE");
const db = isConfigured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

async function loadProducts() {
  if (!db) {
    state.status = "setup";
    return;
  }

  const fetchProducts = (fields) =>
    db.from("products").select(fields).eq("active", true).order("seq", { ascending: true });

  let { data, error } = await fetchProducts("id, name, price, category, image_url, brand, original_price, keywords, description, images");

  /* Se o banco ainda não tem as colunas novas, carrega só os campos antigos */
  if (error) ({ data, error } = await fetchProducts("id, name, price, category, image_url"));

  if (error) {
    console.error(error);
    state.status = "error";
    return;
  }

  state.products = data;
  state.status = "ready";
}

/* ----------------------------------------------------------
   AVISO (TOAST)
   ---------------------------------------------------------- */
let toastTimer;

/* action opcional: { label, onClick } mostra um botão dentro do aviso */
function showToast(message, action) {
  const el = $("toast");
  el.innerHTML = `<span>${esc(message)}</span>`;
  el.classList.toggle("with-action", Boolean(action));

  if (action) {
    const btn = document.createElement("button");
    btn.className = "toast-action";
    btn.type = "button";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      el.classList.remove("on");
      action.onClick();
    });
    el.appendChild(btn);
  }

  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), action ? 4000 : 1800);
}

/* ----------------------------------------------------------
   CATÁLOGO
   ---------------------------------------------------------- */
function getFilteredProducts() {
  return state.products.filter(
    (product) =>
      (state.category === "Todos" || product.category === state.category) &&
      product.name.toLowerCase().includes(state.term)
  );
}

const ICONS = {
  cart: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/></svg>',
  chat: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4V5z"/></svg>',
  expand: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
};

/* Desconto: o preço final é o campo "price"; "original_price" é o preço cheio riscado */
const hasDiscount = (p) => p.price !== null && p.original_price != null && Number(p.original_price) > Number(p.price);

const discountBadge = (p) =>
  hasDiscount(p) ? `<span class="badge-off">${Math.max(1, Math.round((1 - Number(p.price) / Number(p.original_price)) * 100))}% Off</span>` : "";

function priceHTML(p) {
  if (p.price === null) return '<div class="price quote">Sob consulta</div>';
  const was = hasDiscount(p) ? `<div class="was">${formatBRL(Number(p.original_price))}</div>` : "";
  return `<div class="price">${formatBRL(Number(p.price))}</div>${was}`;
}

function productCard(product) {
  const fab =
    product.price !== null
      ? `<button class="cart-fab" data-add="${esc(product.id)}" aria-label="Adicionar ${esc(product.name)} ao carrinho">${ICONS.cart}</button>`
      : `<button class="cart-fab" data-ask aria-label="Solicitar orçamento de ${esc(product.name)}">${ICONS.chat}</button>`;
  const visual = product.image_url
    ? `<img src="${esc(product.image_url)}" alt="${esc(product.name)}" loading="lazy" />`
    : esc(initialOf(product.name));

  return `
    <article class="card">
      <div class="ph">
        ${visual}
        ${discountBadge(product)}
        <button class="zoom" data-zoom="${esc(product.id)}" aria-label="Ver ${esc(product.name)} ampliado">${ICONS.expand}</button>
      </div>
      <div class="info">
        ${product.brand ? `<span class="brand">${esc(product.brand)}</span>` : ""}
        <h3>${esc(product.name)}</h3>
        ${priceHTML(product)}
      </div>
      ${fab}
    </article>`;
}

/* ----------------------------------------------------------
   POPUP DO PRODUTO (ampliar): fotos passam sozinhas a cada 5 s
   ---------------------------------------------------------- */
const SLIDE_INTERVAL = 5000;
const popup = { product: null, photos: [], index: 0, timer: null };

function renderSlide() {
  const { product, photos, index } = popup;
  $("pmSlide").innerHTML = photos.length
    ? `<img src="${esc(photos[index])}" alt="${esc(product.name)}" />`
    : `<span>${esc(initialOf(product.name))}</span>`;

  const multiple = photos.length > 1;
  $("pmPrev").hidden = !multiple;
  $("pmNext").hidden = !multiple;
  $("pmDots").innerHTML = multiple
    ? photos.map((_, i) => `<button class="pm-dot${i === index ? " on" : ""}" data-dot="${i}" aria-label="Foto ${i + 1}"></button>`).join("")
    : "";
}

function startSlideTimer() {
  clearInterval(popup.timer);
  if (popup.photos.length > 1) popup.timer = setInterval(() => goToSlide(popup.index + 1), SLIDE_INTERVAL);
}

function goToSlide(i) {
  popup.index = (i + popup.photos.length) % popup.photos.length;
  renderSlide();
  startSlideTimer();
}

function openProduct(id) {
  const product = findProduct(id);
  if (!product) return;

  popup.product = product;
  popup.photos = [product.image_url, ...(Array.isArray(product.images) ? product.images : [])].filter(Boolean);
  popup.index = 0;

  const setText = (el, text) => {
    $(el).textContent = text || "";
    $(el).hidden = !text;
  };

  $("pmBadge").innerHTML = discountBadge(product);
  setText("pmCat", product.category);
  setText("pmName", product.name);
  setText("pmBrand", product.brand);
  setText("pmKeys", product.keywords);
  setText("pmDesc", product.description);
  $("pmPrice").innerHTML = priceHTML(product);
  $("pmAdd").textContent = product.price !== null ? "Adicionar ao carrinho" : "Solicitar orçamento";

  renderSlide();
  startSlideTimer();
  $("productModal").showModal();
}

function closeProduct() {
  $("productModal").close();
}

const STATUS_MESSAGES = {
  loading: "Carregando produtos...",
  error: "Não foi possível carregar os produtos agora. Tente novamente em instantes.",
  setup: "Conexão com o banco ainda não configurada. Preencha o arquivo config.js.",
  empty: "Nenhum produto encontrado. Tente outro termo ou escolha outra categoria.",
};

/* Cards vazios que aparecem enquanto os produtos carregam */
const skeletonCard = `
  <article class="card skeleton" aria-hidden="true">
    <div class="ph"></div>
    <div class="info">
      <div class="line"></div>
      <div class="line short"></div>
    </div>
  </article>`;

function renderGrid() {
  const emptyEl = $("empty");
  const countEl = $("resultCount");

  if (state.status === "loading") {
    $("grid").innerHTML = skeletonCard.repeat(6);
    countEl.textContent = "";
    emptyEl.style.display = "none";
    $("more").style.display = "none";
    return;
  }

  if (state.status !== "ready") {
    $("grid").innerHTML = "";
    countEl.textContent = "";
    emptyEl.textContent = STATUS_MESSAGES[state.status];
    emptyEl.style.display = "block";
    $("more").style.display = "none";
    return;
  }

  const list = getFilteredProducts();
  $("grid").innerHTML = list.slice(0, state.limit).map(productCard).join("");
  countEl.textContent = list.length === 1 ? "1 produto encontrado" : `${list.length} produtos encontrados`;
  emptyEl.textContent = STATUS_MESSAGES.empty;
  emptyEl.style.display = list.length ? "none" : "block";
  $("more").style.display = list.length > state.limit ? "inline-block" : "none";
}

function renderChips() {
  const categories = getCategories();
  if (!categories.includes(state.category)) state.category = "Todos";

  $("chips").innerHTML = categories
    .map((name) => `<button class="chip${name === state.category ? " on" : ""}" data-category="${esc(name)}">${esc(name)}</button>`)
    .join("");
}

/* ----------------------------------------------------------
   CARRINHO
   ---------------------------------------------------------- */
const findProduct = (id) => state.products.find((p) => p.id === id);

/* O carrinho só fica salvo no navegador se o visitante aceitou os cookies */
const CART_KEY = "aa-select-cart";
const canSaveCart = () => Boolean(window.cookieConsent) && window.cookieConsent.get() === "accepted";

function saveCart() {
  try {
    if (canSaveCart() && Object.keys(state.cart).length) localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
    else localStorage.removeItem(CART_KEY);
  } catch {
    /* navegador bloqueou o armazenamento: o carrinho só vale até recarregar */
  }
}

function loadSavedCart() {
  if (!canSaveCart()) return;

  try {
    const saved = JSON.parse(localStorage.getItem(CART_KEY));
    if (!saved || typeof saved !== "object") return;

    Object.entries(saved).forEach(([id, qty]) => {
      if (Number.isInteger(qty) && qty > 0 && qty <= 999) state.cart[id] = qty;
    });
  } catch {
    /* dado salvo inválido: começa com o carrinho vazio */
  }
}

/* Tira do carrinho o que saiu do catálogo ou ficou sem preço desde a última visita */
function pruneCart() {
  Object.keys(state.cart).forEach((id) => {
    const product = findProduct(id);
    if (!product || product.price === null) delete state.cart[id];
  });
  saveCart();
}

function renderCart() {
  let count = 0;
  let total = 0;
  let html = "";

  Object.entries(state.cart).forEach(([id, qty]) => {
    const product = findProduct(id);
    if (!product) return;

    const price = Number(product.price);
    count += qty;
    total += qty * price;

    html += `
      <div class="it">
        <span>
          <span class="it-name">${esc(product.name)}</span><br>
          <small>${formatBRL(price)} cada</small>
        </span>
        <span class="qty">
          <button data-id="${esc(id)}" data-delta="-1" aria-label="Diminuir quantidade">-</button>
          <output aria-label="Quantidade">${qty}</output>
          <button data-id="${esc(id)}" data-delta="1" aria-label="Aumentar quantidade">+</button>
        </span>
      </div>`;
  });

  $("count").textContent = count;
  $("total").textContent = formatBRL(total);
  $("items").innerHTML = html || '<p class="empty-cart">Seu carrinho está vazio.<br>Escolha um produto no catálogo para começar.</p>';
  $("checkout").disabled = count === 0;
}

function openCart() {
  $("drawer").classList.add("open");
  $("closeCart").focus();
}

function closeCart() {
  $("drawer").classList.remove("open");
}

function addToCart(id) {
  state.cart[id] = (state.cart[id] || 0) + 1;
  saveCart();
  renderCart();
  showToast("Adicionado ao carrinho", { label: "Ver carrinho", onClick: openCart });
}

function changeQuantity(id, delta) {
  state.cart[id] = (state.cart[id] || 0) + delta;
  if (state.cart[id] <= 0) delete state.cart[id];
  saveCart();
  renderCart();
}

/* ----------------------------------------------------------
   PERKS: animação de entrada ao rolar a página
   ---------------------------------------------------------- */
function setupPerksAnimation() {
  const perks = document.querySelectorAll(".perk");

  if (!("IntersectionObserver" in window)) {
    perks.forEach((el) => el.classList.add("in"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.2 }
  );

  perks.forEach((el) => observer.observe(el));
}

/* ----------------------------------------------------------
   PEDIDO
   ---------------------------------------------------------- */
function checkout() {
  const items = [];
  let total = 0;

  Object.entries(state.cart).forEach(([id, qty]) => {
    const product = findProduct(id);
    if (!product) return;
    const price = Number(product.price);
    total += qty * price;
    items.push({ name: product.name, qty, price });
  });

  if (!items.length) return showToast("Adicione um produto primeiro");

  const lines = items.map((item) => `- ${item.qty}x ${item.name} (${formatBRL(item.price)})`);
  const message = `Olá! Quero fazer este pedido:\n${lines.join("\n")}\n\nTotal: ${formatBRL(total)}`;

  /* Abre o WhatsApp direto no clique, senão o navegador pode bloquear a janela */
  const number = cfg.WHATSAPP_NUMBER || "";
  window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, "_blank", "noopener");

  saveOrder(items, total);
}

/* Grava o pedido para o painel. Se falhar, o cliente já está no WhatsApp com o pedido */
async function saveOrder(items, total) {
  if (!db) return;

  const { error } = await db.from("orders").insert({ items, total: Number(total.toFixed(2)) });
  if (error) console.error(error);
}

/* ----------------------------------------------------------
   CONTATO
   ---------------------------------------------------------- */
async function sendContact(event) {
  event.preventDefault();
  const form = event.target;
  const status = $("contactStatus");
  const btn = $("contactBtn");
  const data = new FormData(form);

  /* Campo escondido preenchido = robô: finge que enviou, mas não grava */
  if (data.get("website")) {
    form.reset();
    return;
  }

  if (!db) {
    status.textContent = "Envio indisponível no momento. Fale com a gente pelo WhatsApp.";
    return;
  }

  /* Contato: e-mail (tem @) ou telefone com DDD (8 a 15 dígitos) */
  const contact = String(data.get("contact")).trim();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
  const digits = contact.replace(/\D/g, "");
  const isPhone = !contact.includes("@") && /^[\d\s()+-]+$/.test(contact) && digits.length >= 8 && digits.length <= 15;

  if (!isEmail && !isPhone) {
    status.textContent = "Informe um e-mail válido ou um telefone com DDD.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Enviando...";
  status.textContent = "";

  const { error } = await db.from("messages").insert({
    name: String(data.get("name")).trim().replace(/\s+/g, " "),
    contact,
    message: String(data.get("message")).trim(),
  });

  btn.disabled = false;
  btn.textContent = "Enviar mensagem";

  if (error) {
    console.error(error);
    status.textContent =
      error.code === "23514" ? "Confira os dados preenchidos e tente de novo." : "Não foi possível enviar. Tente novamente em instantes.";
    return;
  }

  form.reset();
  status.textContent = "Mensagem enviada! Responderemos em breve.";
  showToast("Mensagem enviada com sucesso");
}

/* ----------------------------------------------------------
   EVENTOS
   ---------------------------------------------------------- */
function bindEvents() {
  /* Filtro por categoria */
  $("chips").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-category]");
    if (!chip) return;
    state.category = chip.dataset.category;
    state.limit = PAGE_SIZE;
    renderChips();
    renderGrid();
  });

  /* Busca */
  $("q").addEventListener("input", (event) => {
    state.term = event.target.value.trim().toLowerCase();
    state.limit = PAGE_SIZE;
    renderGrid();
  });

  /* Ver mais */
  $("more").addEventListener("click", () => {
    state.limit += PAGE_SIZE;
    renderGrid();
  });

  /* Botões dos cards */
  $("grid").addEventListener("click", (event) => {
    const add = event.target.closest("[data-add]");
    if (add) return addToCart(add.dataset.add);

    const zoom = event.target.closest("[data-zoom]");
    if (zoom) return openProduct(zoom.dataset.zoom);

    if (event.target.closest("[data-ask]")) {
      showToast("Fale conosco pela seção de contato");
      location.hash = "contato";
    }
  });

  /* Popup do produto */
  const modal = $("productModal");
  $("pmClose").addEventListener("click", closeProduct);
  $("pmPrev").addEventListener("click", () => goToSlide(popup.index - 1));
  $("pmNext").addEventListener("click", () => goToSlide(popup.index + 1));
  $("pmDots").addEventListener("click", (event) => {
    const dot = event.target.closest("[data-dot]");
    if (dot) goToSlide(Number(dot.dataset.dot));
  });
  $("pmAdd").addEventListener("click", () => {
    const { product } = popup;
    closeProduct();
    if (product.price !== null) return addToCart(product.id);
    showToast("Fale conosco pela seção de contato");
    location.hash = "contato";
  });
  /* Clique fora do popup fecha; ao fechar, para a troca automática de fotos */
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeProduct();
  });
  modal.addEventListener("close", () => clearInterval(popup.timer));
  modal.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") goToSlide(popup.index - 1);
    if (event.key === "ArrowRight") goToSlide(popup.index + 1);
  });

  /* Quantidade no carrinho */
  $("items").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-delta]");
    if (btn) changeQuantity(btn.dataset.id, Number(btn.dataset.delta));
  });

  /* Abrir e fechar carrinho */
  $("openCart").addEventListener("click", openCart);
  $("closeCart").addEventListener("click", closeCart);
  $("shade").addEventListener("click", closeCart);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("drawer").classList.contains("open")) closeCart();
  });

  /* Finalizar pedido: abre o WhatsApp com a lista pronta e grava o pedido no painel */
  $("checkout").addEventListener("click", checkout);

  /* Formulário de contato: grava a mensagem para o painel ler */
  $("contactForm").addEventListener("submit", sendContact);
}

/* ----------------------------------------------------------
   INÍCIO
   ---------------------------------------------------------- */
async function init() {
  bindEvents();
  setupPerksAnimation();
  renderChips();
  renderGrid();
  loadSavedCart();
  renderCart();

  /* Aceitar os cookies salva o carrinho atual; escolher só essenciais apaga o que estava salvo */
  document.addEventListener("cookieconsentchange", saveCart);

  await loadProducts();
  if (state.status === "ready") pruneCart();

  renderChips();
  renderGrid();
  renderCart();
}

init();

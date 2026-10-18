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

  const { data, error } = await db
    .from("products")
    .select("id, name, price, category, image_url")
    .eq("active", true)
    .order("seq", { ascending: true });

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

function showToast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), 1800);
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

function productCard(product) {
  const hasPrice = product.price !== null;
  const price = hasPrice ? formatBRL(Number(product.price)) : "Sob consulta";
  const action = hasPrice
    ? `<button class="add" data-add="${esc(product.id)}">Adicionar ao carrinho</button>`
    : `<button class="add" data-ask>Solicitar orçamento</button>`;
  const visual = product.image_url
    ? `<img src="${esc(product.image_url)}" alt="${esc(product.name)}" loading="lazy" />`
    : esc(initialOf(product.name));

  return `
    <article class="card">
      <div class="ph">
        ${visual}
        <span class="tag">${esc(product.category)}</span>
      </div>
      <div class="info">
        <h3>${esc(product.name)}</h3>
        <div class="price">${price}</div>
        ${action}
      </div>
    </article>`;
}

const STATUS_MESSAGES = {
  loading: "Carregando produtos...",
  error: "Não foi possível carregar os produtos agora. Tente novamente em instantes.",
  setup: "Conexão com o banco ainda não configurada. Preencha o arquivo config.js.",
  empty: "Nenhum produto encontrado. Tente outro termo.",
};

function renderGrid() {
  const emptyEl = $("empty");

  if (state.status !== "ready") {
    $("grid").innerHTML = "";
    emptyEl.textContent = STATUS_MESSAGES[state.status];
    emptyEl.style.display = "block";
    $("more").style.display = "none";
    return;
  }

  const list = getFilteredProducts();
  $("grid").innerHTML = list.slice(0, state.limit).map(productCard).join("");
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
        <span>${esc(product.name)}<br><small style="color: var(--muted)">${formatBRL(price)}</small></span>
        <span class="qty">
          <button data-id="${esc(id)}" data-delta="-1" aria-label="Diminuir">-</button>
          ${qty}
          <button data-id="${esc(id)}" data-delta="1" aria-label="Aumentar">+</button>
        </span>
      </div>`;
  });

  $("count").textContent = count;
  $("total").textContent = formatBRL(total);
  $("items").innerHTML = html || '<p style="color: var(--muted)">Seu carrinho está vazio.</p>';
}

function addToCart(id) {
  state.cart[id] = (state.cart[id] || 0) + 1;
  renderCart();
  showToast("Adicionado ao carrinho");
}

function changeQuantity(id, delta) {
  state.cart[id] = (state.cart[id] || 0) + delta;
  if (state.cart[id] <= 0) delete state.cart[id];
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

    if (event.target.closest("[data-ask]")) {
      showToast("Fale conosco pela seção de contato");
      location.hash = "contato";
    }
  });

  /* Quantidade no carrinho */
  $("items").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-delta]");
    if (btn) changeQuantity(btn.dataset.id, Number(btn.dataset.delta));
  });

  /* Abrir e fechar carrinho */
  $("openCart").addEventListener("click", () => $("drawer").classList.add("open"));
  $("shade").addEventListener("click", () => $("drawer").classList.remove("open"));

  /* Finalizar pedido */
  $("checkout").addEventListener("click", () => {
    const hasItems = Object.keys(state.cart).length > 0;
    showToast(hasItems ? "Pedido enviado para atendimento" : "Adicione um produto primeiro");
  });

  /* Formulário de contato */
  $("contactForm").addEventListener("submit", (event) => {
    event.preventDefault();
    showToast("Mensagem enviada com sucesso");
    event.target.reset();
  });
}

/* ----------------------------------------------------------
   INÍCIO
   ---------------------------------------------------------- */
async function init() {
  bindEvents();
  setupPerksAnimation();
  renderChips();
  renderGrid();
  renderCart();

  await loadProducts();

  renderChips();
  renderGrid();
  renderCart();
}

init();

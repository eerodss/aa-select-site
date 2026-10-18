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

function productCard(product) {
  const hasPrice = product.price !== null;
  const price = hasPrice ? `<div class="price">${formatBRL(Number(product.price))}</div>` : `<div class="price quote">Sob consulta</div>`;
  const action = hasPrice
    ? `<button class="add" data-add="${esc(product.id)}" aria-label="Adicionar ${esc(product.name)} ao carrinho">Adicionar ao carrinho</button>`
    : `<button class="add outline" data-ask aria-label="Solicitar orçamento de ${esc(product.name)}">Solicitar orçamento</button>`;
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
        ${price}
        ${action}
      </div>
    </article>`;
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
  renderCart();
  showToast("Adicionado ao carrinho", { label: "Ver carrinho", onClick: openCart });
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

  btn.disabled = true;
  btn.textContent = "Enviando...";
  status.textContent = "";

  /* returning: "minimal" evita pedir de volta a linha gravada, o que exigiria permissão de leitura para visitantes */
  const { error } = await db.from("messages").insert(
    {
      name: String(data.get("name")).trim().replace(/\s+/g, " "),
      email: String(data.get("email")).trim(),
      message: String(data.get("message")).trim(),
    },
    { returning: "minimal" }
  );

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
  $("openCart").addEventListener("click", openCart);
  $("closeCart").addEventListener("click", closeCart);
  $("shade").addEventListener("click", closeCart);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("drawer").classList.contains("open")) closeCart();
  });

  /* Finalizar pedido: abre o WhatsApp com a lista do carrinho */
  $("checkout").addEventListener("click", () => {
    const lines = [];
    let total = 0;

    Object.entries(state.cart).forEach(([id, qty]) => {
      const product = findProduct(id);
      if (!product) return;
      const price = Number(product.price);
      total += qty * price;
      lines.push(`- ${qty}x ${product.name} (${formatBRL(price)})`);
    });

    if (!lines.length) return showToast("Adicione um produto primeiro");

    const message = `Olá! Quero fazer este pedido:\n${lines.join("\n")}\n\nTotal: ${formatBRL(total)}`;
    const number = cfg.WHATSAPP_NUMBER || "";
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
  });

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
  renderCart();

  await loadProducts();

  renderChips();
  renderGrid();
  renderCart();
}

init();

/* ==========================================================
   A&A Select Importados | Painel de produtos
   Login, listagem, cadastro, edição, exclusão e upload de foto.
   ========================================================== */

const cfg = window.APP_CONFIG || {};
const BUCKET = "products";
const IMAGE_MAX_SIDE = 900; // px (a foto é reduzida antes de enviar)

const $ = (id) => document.getElementById(id);

const formatBRL = (value) =>
  Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const esc = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const initialOf = (name) =>
  name.replace(/^Body Splash (VS )?(Victoria.s Secret )?/i, "").charAt(0).toUpperCase();

/* ----------------------------------------------------------
   ESTADO
   ---------------------------------------------------------- */
const state = {
  products: [],
  categories: [], // [{ id, name }] na ordem de cadastro
  messages: [], // mensagens enviadas pelo formulário de contato
  orders: [], // pedidos feitos pelo carrinho
  loaded: false, // true depois da primeira leitura do banco
  term: "",
  category: "Todas",
  editing: null, // produto sendo editado (null = novo)
  newFile: null, // arquivo de imagem escolhido (já reduzido)
  removeImage: false,
  extraKeep: [], // URLs das fotos extras que continuam no produto
  extraNew: [], // fotos extras novas: { blob, preview }
  hasTopRank: false, // o banco já tem a coluna top_rank?
};

const MAX_EXTRA_IMAGES = 8;

/* Preço final a partir do preço original e do desconto (em % ou em R$) */
function computeFinalPrice(original, type, value) {
  if (original === null) return null;
  if (type === "percent") return Math.round(original * (1 - value / 100) * 100) / 100;
  if (type === "amount") return Math.max(0, Math.round((original - value) * 100) / 100);
  return original;
}

/* ----------------------------------------------------------
   SUPABASE
   ---------------------------------------------------------- */
const isConfigured = Boolean(cfg.SUPABASE_URL) && !cfg.SUPABASE_URL.startsWith("COLE");
const db = isConfigured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

/* ----------------------------------------------------------
   AVISO (TOAST)
   ---------------------------------------------------------- */
let toastTimer;

function showToast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), 2200);
}

/* ----------------------------------------------------------
   TELAS: login x painel
   ---------------------------------------------------------- */
function showView(name) {
  $("loginView").hidden = name !== "login";
  $("dashView").hidden = name !== "dash";
}

let currentUserId = null;

async function handleSession(session) {
  const id = session ? session.user.id : null;
  if (id === currentUserId && currentUserId !== null) return; // renovação de token, nada a fazer
  currentUserId = id;

  if (session) {
    showView("dash");
    await loadProducts();
  } else {
    showView("login");
  }
}

function setupAuth() {
  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const btn = $("loginBtn");
    $("loginError").textContent = "";
    btn.disabled = true;
    btn.textContent = "Entrando...";

    const { error } = await db.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value,
    });

    btn.disabled = false;
    btn.textContent = "Entrar";
    if (error) $("loginError").textContent = "E-mail ou senha incorretos.";
  });

  $("logoutBtn").addEventListener("click", () => db.auth.signOut());

  /* Sai do callback do Supabase antes de consultar o banco, senão a consulta pode travar */
  db.auth.onAuthStateChange((_event, session) => setTimeout(() => handleSession(session), 0));
}

/* ----------------------------------------------------------
   DADOS
   ---------------------------------------------------------- */
async function loadProducts() {
  const [products, categories, topProbe] = await Promise.all([
    db.from("products").select("*").order("seq", { ascending: true }),
    db.from("categories").select("id, name").order("seq", { ascending: true }),
    db.from("products").select("top_rank").limit(1), // erro = o banco ainda não tem a coluna do Top 5
  ]);
  state.hasTopRank = !topProbe.error;

  if (products.error || categories.error) {
    console.error(products.error || categories.error);
    showToast("Erro ao carregar dados");
    $("tableEmpty").style.display = "block";
    $("tableEmpty").textContent = "Não foi possível carregar os produtos. Recarregue a página.";
    return;
  }

  state.products = products.data;
  state.categories = categories.data;
  state.loaded = true;
  render();
  await loadMessages();
  await loadOrders();
}

/* ----------------------------------------------------------
   PEDIDOS DO CARRINHO
   ---------------------------------------------------------- */
async function loadOrders() {
  const { data, error } = await db.from("orders").select("*").order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  state.orders = data;
  const newOnes = state.orders.filter((o) => o.status === "novo").length;
  $("newOrdersBadge").hidden = newOnes === 0;
  $("newOrdersBadge").textContent = newOnes;
}

function renderOrders() {
  $("ordersList").innerHTML = state.orders
    .map((o) => {
      const lines = o.items.map((item) => `<li>${item.qty}x ${esc(item.name)} · ${formatBRL(Number(item.price))}</li>`).join("");
      const when = new Date(o.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

      return `
      <li class="msg${o.status === "novo" ? " unread" : ""}">
        <div class="msg-head">
          <b>Pedido · ${formatBRL(Number(o.total))}</b>
          <span class="muted">${when} · ${esc(o.status)}</span>
        </div>
        <ul class="order-items">${lines}</ul>
        <div class="row-actions">
          ${o.status === "novo" ? `<button class="icon-btn" data-order-done="${o.id}">Marcar como atendido</button>` : ""}
          <button class="icon-btn danger" data-order-delete="${o.id}">Excluir</button>
        </div>
      </li>`;
    })
    .join("");

  $("ordersEmpty").style.display = state.orders.length ? "none" : "block";
  $("ordersEmpty").textContent = state.orders.length ? "" : "Nenhum pedido recebido ainda.";
}

function openOrdersModal() {
  renderOrders();
  $("ordersModal").showModal();
}

async function markOrderDone(id) {
  const { error } = await db.from("orders").update({ status: "atendido" }).eq("id", id);
  if (error) {
    showToast("Erro ao atualizar o pedido");
    return;
  }
  await loadOrders();
  renderOrders();
}

async function removeOrder(id) {
  if (!confirm("Excluir este pedido? Essa ação não pode ser desfeita.")) return;

  const { error } = await db.from("orders").delete().eq("id", id);
  if (error) {
    showToast("Erro ao excluir o pedido");
    return;
  }
  showToast("Pedido excluído");
  await loadOrders();
  renderOrders();
}

/* ----------------------------------------------------------
   MENSAGENS DO FORMULÁRIO DE CONTATO
   ---------------------------------------------------------- */
async function loadMessages() {
  const { data, error } = await db.from("messages").select("*").order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  state.messages = data;
  updateUnreadBadge();
}

function updateUnreadBadge() {
  const unread = state.messages.filter((m) => !m.is_read).length;
  $("unreadBadge").hidden = unread === 0;
  $("unreadBadge").textContent = unread;
}

/* E-mail abre o programa de e-mail; telefone abre a conversa no WhatsApp */
function contactLink(contact) {
  if (contact.includes("@")) {
    const subject = encodeURIComponent("Re: seu contato na A&A Select");
    return `<a href="mailto:${esc(contact)}?subject=${subject}">${esc(contact)}</a>`;
  }

  let digits = contact.replace(/\D/g, "");
  if (digits.length <= 11) digits = `55${digits}`; // sem código do país, assume Brasil
  return `<a href="https://wa.me/${digits}" target="_blank" rel="noopener">${esc(contact)} (WhatsApp)</a>`;
}

function renderMessages() {
  const list = $("msgList");

  list.innerHTML = state.messages
    .map(
      (m) => `
      <li class="msg${m.is_read ? "" : " unread"}">
        <div class="msg-head">
          <b>${esc(m.name)}</b>
          <span class="muted">${new Date(m.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
        </div>
        ${contactLink(m.contact)}
        <p>${esc(m.message)}</p>
        <div class="row-actions">
          ${m.is_read ? "" : `<button class="icon-btn" data-msg-read="${m.id}">Marcar como lida</button>`}
          <button class="icon-btn danger" data-msg-delete="${m.id}">Excluir</button>
        </div>
      </li>`
    )
    .join("");

  $("msgEmpty").style.display = state.messages.length ? "none" : "block";
  $("msgEmpty").textContent = state.messages.length ? "" : "Nenhuma mensagem recebida ainda.";
}

function openMsgModal() {
  renderMessages();
  $("msgModal").showModal();
}

async function markMessageRead(id) {
  const { error } = await db.from("messages").update({ is_read: true }).eq("id", id);
  if (error) {
    showToast("Erro ao atualizar a mensagem");
    return;
  }
  await loadMessages();
  renderMessages();
}

async function removeMessage(id) {
  if (!confirm("Excluir esta mensagem? Essa ação não pode ser desfeita.")) return;

  const { error } = await db.from("messages").delete().eq("id", id);
  if (error) {
    showToast("Erro ao excluir a mensagem");
    return;
  }
  showToast("Mensagem excluída");
  await loadMessages();
  renderMessages();
}

const categoryNames = () => state.categories.map((c) => c.name);

const productCount = (name) => state.products.filter((p) => p.category === name).length;

/* ----------------------------------------------------------
   LISTAGEM
   ---------------------------------------------------------- */
function getVisible() {
  return state.products.filter(
    (p) =>
      (state.category === "Todas" || p.category === state.category) &&
      p.name.toLowerCase().includes(state.term)
  );
}

function renderStats() {
  const total = state.products.length;
  const active = state.products.filter((p) => p.active).length;
  const noPrice = state.products.filter((p) => p.price === null).length;
  const items = [
    [total, "Produtos"],
    [active, "Visíveis no site"],
    [noPrice, "Sem preço"],
    [state.categories.length, "Categorias"],
  ];

  $("stats").innerHTML = items.map(([n, label]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`).join("");
}

function renderFilter() {
  const cats = ["Todas", ...categoryNames()];
  if (!cats.includes(state.category)) state.category = "Todas";

  $("filterCategory").innerHTML = cats
    .map((c) => `<option value="${esc(c)}"${c === state.category ? " selected" : ""}>${esc(c)}</option>`)
    .join("");
}

function thumbHTML(product) {
  return product.image_url
    ? `<div class="thumb"><img src="${esc(product.image_url)}" alt="" loading="lazy" /></div>`
    : `<div class="thumb">${esc(initialOf(product.name))}</div>`;
}

function priceCell(p) {
  if (p.price === null) return '<span class="muted">Sob consulta</span>';
  const hasDiscount = p.original_price !== null && Number(p.original_price) > Number(p.price);
  return hasDiscount
    ? `${formatBRL(p.price)}<span class="was-price">${formatBRL(p.original_price)}</span>`
    : formatBRL(p.price);
}

function renderRows() {
  const list = getVisible();

  $("rows").innerHTML = list
    .map(
      (p) => `
      <tr class="${p.active ? "" : "off"}">
        <td>${thumbHTML(p)}</td>
        <td class="name">${p.brand ? `<span class="row-brand">${esc(p.brand)}</span>` : ""}${esc(p.name)}${p.top_rank ? ` <span class="row-top">Top ${p.top_rank}</span>` : ""}</td>
        <td class="muted">${esc(p.category)}</td>
        <td class="nowrap">${priceCell(p)}</td>
        <td>
          <label class="switch" title="Mostrar ou ocultar no site">
            <input type="checkbox" data-toggle="${p.id}" ${p.active ? "checked" : ""} aria-label="Visível no site" />
            <i></i>
          </label>
        </td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" data-edit="${p.id}">Editar</button>
            <button class="icon-btn danger" data-delete="${p.id}">Excluir</button>
          </div>
        </td>
      </tr>`
    )
    .join("");

  $("resultCount").textContent = state.loaded
    ? `Mostrando ${list.length} de ${state.products.length} ${state.products.length === 1 ? "produto" : "produtos"}`
    : "";

  const empty = $("tableEmpty");
  empty.style.display = list.length ? "none" : "block";

  if (!state.loaded) {
    empty.textContent = "Carregando produtos...";
  } else if (!state.products.length) {
    empty.innerHTML = `<span>Nenhum produto cadastrado ainda.</span><button class="btn small" data-new>+ Cadastrar primeiro produto</button>`;
  } else {
    empty.textContent = "Nenhum produto encontrado com esses filtros.";
  }
}

function render() {
  renderStats();
  renderFilter();
  renderRows();
}

/* ----------------------------------------------------------
   IMAGEM: reduz no navegador antes de enviar
   ---------------------------------------------------------- */
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Falha ao processar a imagem"))), "image/jpeg", 0.85);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Arquivo de imagem inválido"));
    };

    img.src = url;
  });
}

/* Caminho do arquivo dentro do bucket, a partir da URL pública */
function storagePathFromUrl(url) {
  const marker = `/object/public/${BUCKET}/`;
  const i = url ? url.indexOf(marker) : -1;
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length).split("?")[0]);
}

async function uploadImage(blob) {
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await db.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
  if (error) throw error;
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

async function deleteImage(url) {
  const path = storagePathFromUrl(url);
  if (path) await db.storage.from(BUCKET).remove([path]);
}

/* ----------------------------------------------------------
   MODAL: adicionar / editar
   ---------------------------------------------------------- */
function renderPreview(src, fallback) {
  $("fPreview").innerHTML = src ? `<img src="${esc(src)}" alt="" />` : esc(fallback || "+");
  $("fRemoveImg").hidden = !src;
}

/* Seletor de categoria: só aceita categorias cadastradas */
function fillCategorySelect(selected) {
  const names = categoryNames();
  const options = ['<option value="">Escolha uma categoria</option>', ...names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`)];
  $("fCategory").innerHTML = options.join("");
  $("fCategory").value = selected || "";
  $("fCategory").disabled = names.length === 0;
}

/* Fotos extras do popup: as que já estão salvas + as recém-escolhidas */
function renderExtras() {
  const kept = state.extraKeep.map(
    (url, i) => `<div class="extra"><img src="${esc(url)}" alt="" /><button type="button" data-extra-keep="${i}" aria-label="Remover foto">×</button></div>`
  );
  const added = state.extraNew.map(
    (item, i) => `<div class="extra"><img src="${esc(item.preview)}" alt="" /><button type="button" data-extra-new="${i}" aria-label="Remover foto">×</button></div>`
  );
  $("fExtras").innerHTML = [...kept, ...added].join("");
}

/* Mostra o campo de desconto certo e o preço final calculado */
function updateDiscountUI() {
  const type = $("fDiscountType").value;
  $("discountRow").hidden = !type;
  $("fDiscountLabel").textContent = type === "amount" ? "Desconto (R$)" : "Desconto (%)";
  $("fDiscountValue").placeholder = type === "amount" ? "Ex.: 20,00" : "Ex.: 20";

  const original = parsePrice($("fPrice").value);
  const value = parsePrice($("fDiscountValue").value);
  const ready = type && original !== null && !Number.isNaN(original) && value !== null && !Number.isNaN(value);
  $("finalPreview").textContent = ready ? `Preço final: ${formatBRL(computeFinalPrice(original, type, value))}` : "";
}

/* Posição no Top 5: mostra quem ocupa cada lugar. Escolher um lugar ocupado troca o produto de lugar. */
function fillTopRankSelect(product) {
  $("topRankField").hidden = !state.hasTopRank;
  if (!state.hasTopRank) return;

  const options = ['<option value="">Fora do Top 5</option>'];
  for (let n = 1; n <= 5; n++) {
    const holder = state.products.find((p) => p.top_rank === n && (!product || p.id !== product.id));
    options.push(`<option value="${n}">${n}º lugar${holder ? ` (hoje: ${esc(holder.name)})` : ""}</option>`);
  }
  $("fTopRank").innerHTML = options.join("");
  $("fTopRank").value = product && product.top_rank ? String(product.top_rank) : "";
}

function openModal(product) {
  state.editing = product || null;
  state.newFile = null;
  state.removeImage = false;
  state.extraKeep = product && Array.isArray(product.images) ? [...product.images] : [];
  state.extraNew = [];

  $("modalTitle").textContent = product ? "Editar produto" : "Novo produto";
  $("fName").value = product ? product.name : "";
  $("fBrand").value = product && product.brand ? product.brand : "";
  $("fKeywords").value = product && product.keywords ? product.keywords : "";
  $("fDescription").value = product && product.description ? product.description : "";

  /* O campo mostra o preço cheio; quando não há preço original salvo, é o próprio preço */
  const full = product ? (product.original_price !== null && product.original_price !== undefined ? product.original_price : product.price) : null;
  $("fPrice").value = full !== null ? String(full).replace(".", ",") : "";
  $("fDiscountType").value = product && product.discount_type ? product.discount_type : "";
  $("fDiscountValue").value = product && product.discount_value !== null && product.discount_value !== undefined ? String(product.discount_value).replace(".", ",") : "";
  $("fExtraFiles").value = "";
  renderExtras();
  updateDiscountUI();
  fillTopRankSelect(product);
  fillCategorySelect(product ? product.category : "");
  $("fActive").checked = product ? product.active : true;
  $("fFile").value = "";
  $("formError").textContent = "";
  renderPreview(product ? product.image_url : null, product ? initialOf(product.name) : "+");

  $("modal").showModal();
}

function parsePrice(text) {
  const clean = text.trim().replace(/[R$\s]/g, "");
  if (clean === "") return null;

  /* Aceita 1.299,90 e 1299.90 */
  const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : NaN;
}

async function saveProduct(event) {
  event.preventDefault();
  $("formError").textContent = "";

  const name = $("fName").value.trim();
  const category = $("fCategory").value;
  const original = parsePrice($("fPrice").value);
  const discountType = $("fDiscountType").value;
  const discountValue = discountType ? parsePrice($("fDiscountValue").value) : null;

  if (!name || !category) {
    $("formError").textContent = category ? "Informe o título do produto." : "Escolha uma categoria. Se não houver nenhuma, crie em Categorias.";
    return;
  }
  if (Number.isNaN(original)) {
    $("formError").textContent = "Preço inválido. Exemplo: 149,90";
    return;
  }
  if (discountType) {
    if (original === null) {
      $("formError").textContent = "Informe o preço original para aplicar um desconto.";
      return;
    }
    if (discountValue === null || Number.isNaN(discountValue) || discountValue <= 0) {
      $("formError").textContent = "Informe um valor de desconto válido.";
      return;
    }
    if (discountType === "percent" && discountValue >= 100) {
      $("formError").textContent = "A porcentagem de desconto deve ser menor que 100.";
      return;
    }
    if (discountType === "amount" && discountValue >= original) {
      $("formError").textContent = "O desconto em reais deve ser menor que o preço original.";
      return;
    }
  }

  const price = computeFinalPrice(original, discountType, discountValue);

  const btn = $("saveBtn");
  btn.disabled = true;
  btn.textContent = "Salvando...";

  const uploaded = []; // fotos enviadas agora: se o salvamento falhar, são apagadas

  try {
    const previous = state.editing ? state.editing.image_url : null;
    let image_url = previous;

    if (state.newFile) {
      image_url = await uploadImage(state.newFile);
      uploaded.push(image_url);
    } else if (state.removeImage) {
      image_url = null;
    }

    const newExtras = [];
    for (const item of state.extraNew) {
      const url = await uploadImage(item.blob);
      uploaded.push(url);
      newExtras.push(url);
    }
    const images = [...state.extraKeep, ...newExtras];

    const payload = {
      name,
      brand: $("fBrand").value.trim() || null,
      category,
      keywords: $("fKeywords").value.trim() || null,
      description: $("fDescription").value.trim() || null,
      price,
      original_price: original,
      discount_type: discountType || null,
      discount_value: discountType ? discountValue : null,
      image_url,
      images,
      active: $("fActive").checked,
    };

    /* Top 5: libera o lugar escolhido (quem estava nele sai do Top 5) antes de salvar */
    if (state.hasTopRank) {
      const topRank = $("fTopRank").value ? Number($("fTopRank").value) : null;
      payload.top_rank = topRank;

      if (topRank) {
        let free = db.from("products").update({ top_rank: null }).eq("top_rank", topRank);
        if (state.editing) free = free.neq("id", state.editing.id);
        const { error: freeError } = await free;
        if (freeError) throw freeError;
      }
    }

    const query = state.editing
      ? db.from("products").update(payload).eq("id", state.editing.id)
      : db.from("products").insert(payload);

    const { error } = await query;
    if (error) throw error;

    /* Só apaga as fotos antigas depois que o produto foi salvo com sucesso */
    if (previous && previous !== image_url) await deleteImage(previous);
    const oldExtras = state.editing && Array.isArray(state.editing.images) ? state.editing.images : [];
    for (const url of oldExtras) {
      if (!images.includes(url)) await deleteImage(url);
    }

    $("modal").close();
    showToast(state.editing ? "Produto atualizado" : "Produto adicionado");
    await loadProducts();
  } catch (err) {
    console.error(err);
    for (const url of uploaded) await deleteImage(url);
    $("formError").textContent = "Não foi possível salvar. Tente novamente.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Salvar";
  }
}

/* ----------------------------------------------------------
   CATEGORIAS: criar, renomear e excluir
   ---------------------------------------------------------- */
const cleanName = (text) => text.trim().replace(/\s+/g, " ");

function categoryErrorMessage(error) {
  if (error.code === "23505") return "Já existe uma categoria com esse nome.";
  if (error.code === "23503") return "Essa categoria tem produtos. Mova os produtos antes de excluir.";
  return "Não foi possível salvar. Tente novamente.";
}

function renderCatList() {
  $("catList").innerHTML =
    state.categories
      .map((c) => {
        const n = productCount(c.name);
        return `
      <li data-cat="${c.id}">
        <span class="cat-name">${esc(c.name)}</span>
        <span class="muted">${n} ${n === 1 ? "produto" : "produtos"}</span>
        <button class="icon-btn" data-cat-rename="${c.id}">Renomear</button>
        <button class="icon-btn danger" data-cat-delete="${c.id}">Excluir</button>
      </li>`;
      })
      .join("") || '<li class="muted">Nenhuma categoria cadastrada.</li>';
}

function openCatModal() {
  $("catError").textContent = "";
  $("catName").value = "";
  renderCatList();
  $("catModal").showModal();
}

async function addCategory(event) {
  event.preventDefault();
  const name = cleanName($("catName").value);
  if (!name) return;

  $("catAddBtn").disabled = true;
  const { error } = await db.from("categories").insert({ name });
  $("catAddBtn").disabled = false;

  if (error) {
    $("catError").textContent = categoryErrorMessage(error);
    return;
  }

  $("catName").value = "";
  $("catError").textContent = "";
  showToast("Categoria criada");
  await loadProducts();
  renderCatList();
}

function startRename(id) {
  const cat = state.categories.find((c) => c.id === id);
  if (!cat) return;

  $("catList").querySelector(`[data-cat="${id}"]`).innerHTML = `
    <span class="cat-name"><input id="renameInput" maxlength="40" value="${esc(cat.name)}" aria-label="Novo nome" /></span>
    <button class="icon-btn" data-cat-save="${id}">Salvar</button>
    <button class="icon-btn" data-cat-cancel>Cancelar</button>`;

  $("renameInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveRename(id);
    }
  });
  $("renameInput").focus();
}

async function saveRename(id) {
  const cat = state.categories.find((c) => c.id === id);
  const name = cleanName($("renameInput").value);

  if (!name) {
    $("catError").textContent = "Digite um nome para a categoria.";
    return;
  }
  if (name === cat.name) return renderCatList();

  /* A chave estrangeira em products atualiza os produtos automaticamente */
  const { error } = await db.from("categories").update({ name }).eq("id", id);
  if (error) {
    $("catError").textContent = categoryErrorMessage(error);
    return;
  }

  $("catError").textContent = "";
  showToast("Categoria renomeada");
  await loadProducts();
  renderCatList();
}

async function removeCategory(id) {
  const cat = state.categories.find((c) => c.id === id);
  if (!cat) return;

  const n = productCount(cat.name);
  if (n > 0) {
    $("catError").textContent = `"${cat.name}" tem ${n} ${n === 1 ? "produto" : "produtos"}. Mova ou exclua esses produtos antes.`;
    return;
  }
  if (!confirm(`Excluir a categoria "${cat.name}"?`)) return;

  const { error } = await db.from("categories").delete().eq("id", id);
  if (error) {
    $("catError").textContent = categoryErrorMessage(error);
    return;
  }

  $("catError").textContent = "";
  showToast("Categoria excluída");
  await loadProducts();
  renderCatList();
}

/* ----------------------------------------------------------
   AÇÕES DA TABELA
   ---------------------------------------------------------- */
async function toggleActive(id, active) {
  const { error } = await db.from("products").update({ active }).eq("id", id);
  if (error) {
    showToast("Erro ao alterar visibilidade");
  } else {
    showToast(active ? "Produto visível no site" : "Produto oculto do site");
  }
  await loadProducts();
}

async function removeProduct(product) {
  if (!confirm(`Excluir "${product.name}" de vez? Essa ação não pode ser desfeita.\n\nDica: para só tirar do site, desligue o botão "Visível".`)) return;

  const { error } = await db.from("products").delete().eq("id", product.id);
  if (error) {
    showToast("Erro ao excluir");
    return;
  }

  if (product.image_url) await deleteImage(product.image_url);
  for (const url of Array.isArray(product.images) ? product.images : []) await deleteImage(url);
  showToast("Produto excluído");
  await loadProducts();
}

/* ----------------------------------------------------------
   FOTOS: escolhidas pelo botão ou arrastadas para o formulário
   ---------------------------------------------------------- */
async function setMainImage(file) {
  if (!file) return;

  try {
    state.newFile = await resizeImage(file);
    state.removeImage = false;
    renderPreview(URL.createObjectURL(state.newFile));
  } catch (err) {
    $("formError").textContent = err.message;
  }
}

async function addExtraImages(files) {
  for (const file of files) {
    if (state.extraKeep.length + state.extraNew.length >= MAX_EXTRA_IMAGES) {
      $("formError").textContent = `O limite é de ${MAX_EXTRA_IMAGES} fotos extras.`;
      break;
    }
    try {
      const blob = await resizeImage(file);
      state.extraNew.push({ blob, preview: URL.createObjectURL(blob) });
      renderExtras();
    } catch (err) {
      $("formError").textContent = err.message;
    }
  }
}

const hasFiles = (e) => Array.from(e.dataTransfer ? e.dataTransfer.types : []).includes("Files");

function setupDropZone(zone, onFiles) {
  ["dragenter", "dragover"].forEach((type) =>
    zone.addEventListener(type, (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      zone.classList.add("drag");
    })
  );

  zone.addEventListener("dragleave", (e) => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove("drag");
  });

  zone.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    zone.classList.remove("drag");

    const files = Array.from(e.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
    if (!files.length) {
      $("formError").textContent = "Solte apenas arquivos de imagem.";
      return;
    }
    $("formError").textContent = "";
    onFiles(files);
  });
}

/* ----------------------------------------------------------
   EVENTOS
   ---------------------------------------------------------- */
function bindEvents() {
  $("newBtn").addEventListener("click", () => openModal(null));
  $("cancelBtn").addEventListener("click", () => $("modal").close());
  $("productForm").addEventListener("submit", saveProduct);

  $("ordersBtn").addEventListener("click", openOrdersModal);
  $("ordersCloseBtn").addEventListener("click", () => $("ordersModal").close());
  $("ordersList").addEventListener("click", (e) => {
    const done = e.target.closest("[data-order-done]");
    if (done) return markOrderDone(done.dataset.orderDone);

    const del = e.target.closest("[data-order-delete]");
    if (del) removeOrder(del.dataset.orderDelete);
  });

  $("msgsBtn").addEventListener("click", openMsgModal);
  $("msgCloseBtn").addEventListener("click", () => $("msgModal").close());
  $("msgList").addEventListener("click", (e) => {
    const read = e.target.closest("[data-msg-read]");
    if (read) return markMessageRead(read.dataset.msgRead);

    const del = e.target.closest("[data-msg-delete]");
    if (del) removeMessage(del.dataset.msgDelete);
  });

  $("catsBtn").addEventListener("click", openCatModal);
  $("catCloseBtn").addEventListener("click", () => $("catModal").close());
  $("catForm").addEventListener("submit", addCategory);
  $("catList").addEventListener("click", (e) => {
    const rename = e.target.closest("[data-cat-rename]");
    if (rename) return startRename(rename.dataset.catRename);

    const save = e.target.closest("[data-cat-save]");
    if (save) return saveRename(save.dataset.catSave);

    if (e.target.closest("[data-cat-cancel]")) return renderCatList();

    const del = e.target.closest("[data-cat-delete]");
    if (del) removeCategory(del.dataset.catDelete);
  });

  $("search").addEventListener("input", (e) => {
    state.term = e.target.value.trim().toLowerCase();
    renderRows();
  });

  $("filterCategory").addEventListener("change", (e) => {
    state.category = e.target.value;
    renderRows();
  });

  $("rows").addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit]");
    if (edit) return openModal(state.products.find((p) => p.id === edit.dataset.edit));

    const del = e.target.closest("[data-delete]");
    if (del) removeProduct(state.products.find((p) => p.id === del.dataset.delete));
  });

  $("tableEmpty").addEventListener("click", (e) => {
    if (e.target.closest("[data-new]")) openModal(null);
  });

  $("rows").addEventListener("change", (e) => {
    const toggle = e.target.closest("[data-toggle]");
    if (toggle) toggleActive(toggle.dataset.toggle, toggle.checked);
  });

  $("fFile").addEventListener("change", (e) => setMainImage(e.target.files[0]));

  /* Arrastar e soltar: na foto principal (a 1ª vira principal, as outras viram extras) e nas extras */
  setupDropZone(document.querySelector(".image-field"), (files) => {
    setMainImage(files[0]);
    if (files.length > 1) addExtraImages(files.slice(1));
  });
  setupDropZone($("fExtras").closest(".extras"), addExtraImages);

  /* Foto solta fora das áreas não pode abrir a imagem no navegador */
  $("modal").addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  $("modal").addEventListener("drop", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });

  /* Desconto: atualiza o campo certo e o preço final calculado */
  ["fDiscountType", "fDiscountValue", "fPrice"].forEach((id) => $(id).addEventListener("input", updateDiscountUI));
  $("fDiscountType").addEventListener("change", updateDiscountUI);

  /* Fotos extras do popup */
  $("fExtraFiles").addEventListener("change", (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    addExtraImages(files);
  });

  $("fExtras").addEventListener("click", (e) => {
    const keep = e.target.closest("[data-extra-keep]");
    if (keep) state.extraKeep.splice(Number(keep.dataset.extraKeep), 1);

    const added = e.target.closest("[data-extra-new]");
    if (added) {
      const [removed] = state.extraNew.splice(Number(added.dataset.extraNew), 1);
      URL.revokeObjectURL(removed.preview);
    }
    if (keep || added) renderExtras();
  });

  $("fRemoveImg").addEventListener("click", () => {
    state.newFile = null;
    state.removeImage = true;
    $("fFile").value = "";
    renderPreview(null, $("fName").value ? initialOf($("fName").value) : "+");
  });
}

/* ----------------------------------------------------------
   INÍCIO
   ---------------------------------------------------------- */
async function init() {
  if (!db) {
    showView("login");
    $("loginError").textContent = "Configure o arquivo config.js com os dados do Supabase.";
    $("loginBtn").disabled = true;
    return;
  }

  bindEvents();
  setupAuth(); // o onAuthStateChange já dispara a sessão inicial
}

init();

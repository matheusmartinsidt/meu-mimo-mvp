(() => {
  "use strict";

  const CART_KEY = "meu_mimo_cart";
  const MAX_QUANTITY = 20;
  const ADMIN_PATH = document.body.dataset.adminPath || "/";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const money = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
  const escapeHtml = (value = "") => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  // ---------- Avisos (toasts) ----------
  function toast(message, type = "info") {
    const stack = $("#toast-stack");
    if (!stack) return;
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    node.textContent = message;
    stack.append(node);
    setTimeout(() => node.classList.add("leaving"), 3200);
    setTimeout(() => node.remove(), 3600);
  }

  async function postJson(url, body) {
    let response;
    try {
      response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    } catch {
      return { ok: false, status: 0, data: { error: "Sem conexão. Confira sua internet e tente de novo." } };
    }
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  }

  async function withBusy(form, task) {
    const button = $("button[type=submit]", form);
    if (button?.disabled) return;
    const label = button?.textContent;
    if (button) { button.disabled = true; button.textContent = "Aguarde..."; }
    try {
      await task();
    } finally {
      if (button) { button.disabled = false; button.textContent = label; }
    }
  }

  // ---------- Carrinho ----------
  function getCart() {
    try {
      const cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      if (!Array.isArray(cart)) return [];
      return cart
        .filter((item) => item && typeof item.id === "string" && Number.isInteger(item.quantity) && item.quantity > 0)
        .map((item) => ({ id: item.id, quantity: Math.min(item.quantity, MAX_QUANTITY) }));
    } catch {
      return [];
    }
  }

  function setCart(cart) {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      toast("Não foi possível salvar o carrinho neste navegador.", "error");
    }
    renderCart();
  }

  let storePromise = null;
  function loadStore(force = false) {
    if (!storePromise || force) {
      storePromise = fetch("/api/store").then((response) => {
        if (!response.ok) throw new Error("store");
        return response.json();
      }).catch((error) => { storePromise = null; throw error; });
    }
    return storePromise;
  }

  function changeQuantity(id, delta) {
    const cart = getCart();
    const line = cart.find((item) => item.id === id);
    if (!line) return;
    line.quantity += delta;
    if (line.quantity > MAX_QUANTITY) { line.quantity = MAX_QUANTITY; toast(`Máximo de ${MAX_QUANTITY} unidades por item.`); }
    setCart(cart.filter((item) => item.quantity > 0));
  }

  function addToCart(id, { open = true } = {}) {
    const cart = getCart();
    const line = cart.find((item) => item.id === id);
    if (line) line.quantity = Math.min(MAX_QUANTITY, line.quantity + 1);
    else cart.push({ id, quantity: 1 });
    setCart(cart);
    if (open) toggleCart(true);
  }

  function toggleCart(force) {
    const drawer = $("#cart-drawer");
    if (!drawer) return;
    const open = force ?? !drawer.classList.contains("open");
    drawer.classList.toggle("open", open);
    drawer.setAttribute("aria-hidden", String(!open));
    $(".cart-overlay")?.classList.toggle("open", open);
    $$("button[data-cart-toggle][aria-expanded]").forEach((button) => button.setAttribute("aria-expanded", String(open)));
    document.body.classList.toggle("no-scroll", open);
  }

  async function renderCart() {
    const cart = getCart();
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    $$("[data-cart-count]").forEach((node) => { node.textContent = String(count); });
    const containers = $$("[data-cart-items]");
    if (!containers.length) return;

    let store;
    try {
      store = await loadStore();
    } catch {
      containers.forEach((node) => { node.innerHTML = '<p class="empty-state">Não foi possível carregar o carrinho. Recarregue a página.</p>'; });
      return;
    }
    // Remove do carrinho o que saiu do catalogo.
    const lines = cart.map((item) => ({ ...item, product: store.products.find((product) => product.id === item.id) })).filter((item) => item.product);
    if (lines.length !== cart.length) {
      localStorage.setItem(CART_KEY, JSON.stringify(lines.map(({ id, quantity }) => ({ id, quantity }))));
      toast("Um item do carrinho não está mais disponível e foi removido.");
      return renderCart();
    }

    const subtotal = lines.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    const percent = Number(store.settings.pixDiscountPercent || 0);
    const discount = Math.round(subtotal * percent) / 100;
    const html = lines.length ? lines.map((item) => `
      <div class="cart-item-row">
        <img src="${escapeHtml(item.product.image)}" alt="">
        <div class="cart-item-info">
          <a href="/produto/${encodeURIComponent(item.product.slug)}">${escapeHtml(item.product.name)}</a>
          <span>${money(item.product.price)}</span>
          <div class="qty">
            <button type="button" data-qty="-1" data-id="${escapeHtml(item.id)}" aria-label="Diminuir quantidade">&minus;</button>
            <span aria-label="Quantidade">${item.quantity}</span>
            <button type="button" data-qty="1" data-id="${escapeHtml(item.id)}" aria-label="Aumentar quantidade">+</button>
            <button type="button" class="link-btn" data-remove-cart="${escapeHtml(item.id)}">Remover</button>
          </div>
        </div>
        <strong>${money(item.product.price * item.quantity)}</strong>
      </div>`).join("") : '<p class="empty-state">Seu carrinho está vazio. <a href="/#produtos">Ver produtos</a></p>';

    containers.forEach((node) => { node.innerHTML = html; });
    $$("[data-cart-subtotal]").forEach((node) => { node.textContent = money(subtotal); });
    $$("[data-cart-total]").forEach((node) => { node.textContent = money(subtotal - discount); });
    $$("[data-cart-discount-row]").forEach((node) => { node.hidden = !(discount > 0); });
    $$("[data-cart-discount]").forEach((node) => { node.textContent = `- ${money(discount)}`; });
    $$("[data-cart-discount-label]").forEach((node) => { node.textContent = `Desconto Pix (${percent}%)`; });
    $$(".checkout-btn").forEach((node) => node.classList.toggle("disabled", !lines.length));
  }

  // ---------- Catalogo: busca + categoria juntos ----------
  let activeCategory = "all";
  function applyFilters() {
    const grid = $("#products-grid");
    if (!grid) return;
    const query = ($("#search-input")?.value || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    let visible = 0;
    $$("[data-product-card]", grid).forEach((card) => {
      const text = card.dataset.search.normalize("NFD").replace(/[̀-ͯ]/g, "");
      const show = (activeCategory === "all" || card.dataset.category === activeCategory) && (!query || text.includes(query));
      card.hidden = !show;
      if (show) visible += 1;
    });
    const empty = $("#products-empty");
    if (empty) empty.hidden = visible > 0;
  }

  // ---------- Checkout ----------
  const validators = {
    customerName: (value) => (value.trim().length >= 3 && /\p{L}{2,}/u.test(value) ? "" : "Informe seu nome completo."),
    customerEmail: (value) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim()) ? "" : "Informe um e-mail válido."),
    customerPhone: (value) => {
      let digits = value.replace(/\D/g, "");
      if (digits.length >= 12 && digits.startsWith("55")) digits = digits.slice(2);
      return digits.length === 10 || digits.length === 11 ? "" : "Informe um WhatsApp válido com DDD.";
    }
  };

  function showFieldErrors(form, errors) {
    $$("[data-error-for]", form).forEach((node) => {
      const message = errors[node.dataset.errorFor] || "";
      node.textContent = message;
      const input = form.elements[node.dataset.errorFor];
      if (input?.setAttribute) input.setAttribute("aria-invalid", message ? "true" : "false");
    });
  }

  function maskPhone(input) {
    const digits = input.value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) input.value = digits;
    else if (digits.length <= 6) input.value = `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    else if (digits.length <= 10) input.value = `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    else input.value = `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  async function submitCheckout(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorBox = $("#checkout-error");
    errorBox.hidden = true;
    const cart = getCart();
    const errors = {};
    for (const [name, validate] of Object.entries(validators)) {
      const message = validate(form.elements[name].value);
      if (message) errors[name] = message;
    }
    if (!form.elements.acceptTerms.checked) errors.acceptTerms = "É preciso aceitar a política de privacidade.";
    showFieldErrors(form, errors);
    if (Object.keys(errors).length) {
      form.elements[Object.keys(errors)[0]]?.focus();
      return;
    }
    if (!cart.length) {
      errorBox.textContent = "Seu carrinho está vazio.";
      errorBox.hidden = false;
      return;
    }
    await withBusy(form, async () => {
      const { ok, status, data } = await postJson("/api/orders", {
        customerName: form.elements.customerName.value,
        customerEmail: form.elements.customerEmail.value,
        customerPhone: form.elements.customerPhone.value,
        cart
      });
      if (!ok) {
        if (data.fields) showFieldErrors(form, data.fields);
        if (status === 409) { await loadStore(true).catch(() => {}); renderCart(); }
        errorBox.textContent = data.error || "Não foi possível criar o pedido.";
        errorBox.hidden = false;
        return;
      }
      localStorage.removeItem(CART_KEY);
      location.href = data.orderUrl;
    });
  }

  // ---------- Pagina do pedido ----------
  function startOrderPolling() {
    const panel = $("[data-order-poll]");
    if (!panel) return;
    const started = Date.now();
    const tick = async () => {
      if (document.hidden) return schedule();
      try {
        const response = await fetch(panel.dataset.orderPoll, { cache: "no-store" });
        if (response.ok) {
          const data = await response.json();
          if (data.status !== panel.dataset.orderStatus) return location.reload();
        }
      } catch {
        // tenta de novo no proximo ciclo
      }
      schedule();
    };
    // 5s nos primeiros 10 minutos, depois 30s, por ate 2 horas.
    function schedule() {
      const elapsed = Date.now() - started;
      if (elapsed > 2 * 60 * 60_000) return;
      setTimeout(tick, elapsed < 10 * 60_000 ? 5000 : 30_000);
    }
    schedule();
  }

  async function copyText(text, okMessage) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMessage, "success");
    } catch {
      toast("Não foi possível copiar. Selecione e copie manualmente.", "error");
    }
  }

  // ---------- Newsletter ----------
  async function submitNewsletter(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (validators.customerEmail(form.elements.email.value)) return toast("Informe um e-mail válido.", "error");
    await withBusy(form, async () => {
      const { ok, data } = await postJson("/api/newsletter", { email: form.elements.email.value });
      if (!ok) return toast(data.error || "Não foi possível cadastrar agora.", "error");
      form.reset();
      toast("Cadastro feito! Você vai receber nossas novidades.", "success");
    });
  }

  // ---------- Painel ----------
  function formBody(form) {
    return Object.fromEntries(new FormData(form));
  }

  function showFormError(form, data, fallback) {
    const box = $("[data-form-error]", form) || $(".form-error", form);
    const message = data?.error || fallback;
    if (box) { box.textContent = message; box.hidden = false; box.scrollIntoView({ block: "nearest" }); }
    else toast(message, "error");
  }

  function handleExpiredSession(status) {
    if (status !== 401) return false;
    toast("Sessão expirada. Entre novamente.", "error");
    setTimeout(() => location.reload(), 1200);
    return true;
  }

  async function submitAdminLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await withBusy(form, async () => {
      const { ok, data } = await postJson("/api/internal/login", formBody(form));
      if (ok) return location.assign(ADMIN_PATH);
      const box = $("#login-error");
      box.textContent = data.error || "Login inválido.";
      box.hidden = false;
    });
  }

  async function adminSubmit(form, url, body, successMessage) {
    await withBusy(form, async () => {
      const { ok, status, data } = await postJson(url, body);
      if (ok) {
        toast(successMessage, "success");
        return setTimeout(() => location.reload(), 500);
      }
      if (!handleExpiredSession(status)) showFormError(form, data, "Não foi possível salvar.");
    });
  }

  function uploadImage(input) {
    const file = input.files?.[0];
    const form = input.closest("form");
    if (!file || !form) return;
    if (file.size > 5 * 1024 * 1024) { input.value = ""; return toast("Imagem muito grande (máximo 5 MB).", "error"); }
    const reader = new FileReader();
    reader.onload = async () => {
      toast("Enviando imagem...");
      const { ok, status, data } = await postJson("/api/internal/uploads", { dataUrl: reader.result });
      if (!ok) {
        input.value = "";
        if (!handleExpiredSession(status)) toast(data.error || "Erro ao enviar imagem.", "error");
        return;
      }
      form.elements.image.value = data.url;
      toast("Imagem enviada.", "success");
      updateProductPreview();
    };
    reader.onerror = () => toast("Não foi possível ler o arquivo.", "error");
    reader.readAsDataURL(file);
  }

  function updateProductPreview() {
    const form = $("#product-form");
    if (!form) return;
    const value = (name) => form.elements[name]?.value?.trim() || "";
    $("#preview-name").textContent = value("name") || "Nome do item";
    $("#preview-category").textContent = value("category") || "Categoria";
    $("#preview-description").textContent = value("shortDescription") || "Descrição curta do mimo digital.";
    $("#preview-price").textContent = money(value("price") || 0);
    $("#preview-old-price").textContent = value("compareAtPrice") ? money(value("compareAtPrice")) : "";
    const imageNode = $("#preview-image");
    const image = value("image");
    const valid = /^(https?:\/\/|\/uploads\/)/.test(image);
    imageNode.textContent = valid ? "" : "Imagem";
    imageNode.style.backgroundImage = valid ? `url("${encodeURI(image).replaceAll('"', "%22")}")` : "";
  }

  // ---------- Eventos ----------
  document.addEventListener("click", (event) => {
    const target = event.target;
    const add = target.closest("[data-add-cart]");
    if (add) return addToCart(add.dataset.addCart);

    const buyNow = target.closest("[data-buy-now]");
    if (buyNow) { addToCart(buyNow.dataset.buyNow, { open: false }); return location.assign("/carrinho"); }

    const qty = target.closest("[data-qty]");
    if (qty) return changeQuantity(qty.dataset.id, Number(qty.dataset.qty));

    const remove = target.closest("[data-remove-cart]");
    if (remove) return setCart(getCart().filter((item) => item.id !== remove.dataset.removeCart));

    if (target.closest("[data-cart-toggle]")) return toggleCart();

    const disabledCheckout = target.closest(".checkout-btn.disabled");
    if (disabledCheckout) { event.preventDefault(); return toast("Seu carrinho está vazio."); }

    const tab = target.closest("[data-category-tab]");
    if (tab) {
      activeCategory = tab.dataset.categoryTab;
      $$("[data-category-tab]").forEach((node) => node.classList.toggle("active", node === tab));
      return applyFilters();
    }

    const question = target.closest(".faq-question");
    if (question) {
      const item = question.closest(".faq-item");
      const open = !item.classList.contains("active");
      $$(".faq-item").forEach((node) => { node.classList.remove("active"); $(".faq-question", node).setAttribute("aria-expanded", "false"); });
      item.classList.toggle("active", open);
      question.setAttribute("aria-expanded", String(open));
      return;
    }

    const thumb = target.closest("[data-gallery-thumb]");
    if (thumb) {
      $("#product-main-image").src = thumb.dataset.galleryThumb;
      $$("[data-gallery-thumb]").forEach((node) => node.classList.toggle("active", node === thumb));
      return;
    }

    const copy = target.closest("[data-copy]");
    if (copy) return copyText($(copy.dataset.copy).value, "Código Pix copiado!");

    const copyLink = target.closest("[data-copy-text]");
    if (copyLink) return copyText(copyLink.dataset.copyText, "Link copiado!");

    const toggleProduct = target.closest("[data-toggle-product]");
    if (toggleProduct) {
      const active = toggleProduct.dataset.active === "true";
      if (!active && !confirm("Ocultar este item da loja?")) return;
      toggleProduct.disabled = true;
      postJson(`/api/internal/products/${encodeURIComponent(toggleProduct.dataset.toggleProduct)}`, { active }).then(({ ok, status, data }) => {
        if (ok) return location.reload();
        toggleProduct.disabled = false;
        if (!handleExpiredSession(status)) toast(data.error || "Erro ao atualizar item.", "error");
      });
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") toggleCart(false);
  });

  // Imagem quebrada nao deve mostrar o icone de erro do navegador.
  document.addEventListener("error", (event) => {
    if (event.target instanceof HTMLImageElement) event.target.classList.add("img-failed");
  }, true);

  window.addEventListener("storage", (event) => {
    if (event.key === CART_KEY) renderCart();
  });

  $("#search-input")?.addEventListener("input", applyFilters);
  $(".search-box")?.addEventListener("submit", (event) => {
    if (!$("#products-grid")) return; // fora da home, deixa o formulario navegar para /?q=
    event.preventDefault();
    applyFilters();
    $("#produtos")?.scrollIntoView({ behavior: "smooth" });
  });

  const checkoutForm = $("#checkout-form");
  if (checkoutForm) {
    checkoutForm.addEventListener("submit", submitCheckout);
    checkoutForm.elements.customerPhone.addEventListener("input", (event) => maskPhone(event.target));
    Object.keys(validators).forEach((name) => {
      checkoutForm.elements[name].addEventListener("blur", (event) => {
        const node = $(`[data-error-for="${name}"]`, checkoutForm);
        if (event.target.value) node.textContent = validators[name](event.target.value);
      });
    });
  }

  $("#newsletter-form")?.addEventListener("submit", submitNewsletter);
  $("#admin-login-form")?.addEventListener("submit", submitAdminLogin);
  $("#logout-admin")?.addEventListener("click", async () => { await postJson("/api/internal/logout"); location.assign(ADMIN_PATH); });

  $("#product-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    adminSubmit(event.currentTarget, "/api/internal/products", formBody(event.currentTarget), "Item cadastrado.");
  });
  $("#product-form")?.addEventListener("input", updateProductPreview);
  $$(".product-edit-form").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    adminSubmit(form, `/api/internal/products/${encodeURIComponent(form.dataset.productId)}`, { ...formBody(form), _form: "full" }, "Item atualizado.");
  }));
  $$(".order-status-form").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    adminSubmit(form, `/api/internal/orders/${encodeURIComponent(form.dataset.orderId)}/status`, formBody(form), "Pedido atualizado.");
  }));
  $("#settings-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    adminSubmit(event.currentTarget, "/api/internal/settings", formBody(event.currentTarget), "Dados da loja salvos.");
  });
  $$("[data-image-upload]").forEach((input) => input.addEventListener("change", () => uploadImage(input)));
  $("#order-filter")?.addEventListener("change", (event) => {
    $$("[data-order-row]").forEach((row) => { row.hidden = event.target.value !== "all" && row.dataset.status !== event.target.value; });
  });

  if ($("#products-grid")?.dataset.initialQuery) applyFilters();
  updateProductPreview();
  renderCart();
  startOrderPolling();
})();

const config = require("./config");

const money = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));

const escapeHtml = (value = "") =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const e = escapeHtml;
const STATUS_LABEL = { pending: "Aguardando pagamento", paid: "Pago", delivered: "Entregue", canceled: "Cancelado" };

const testimonials = [
  { name: "Allan", text: "Agradeço pelo trabalho incrível, pelo carinho e pelo cuidado com todos os detalhes." },
  { name: "Letícia Costa", text: "Ficou lindo demais. Como uma lembrança simples pode tocar tanto a gente? Obrigada pelo capricho." },
  { name: "Maiara", text: "Achei delicado e muito fácil de editar no Canva. A pessoa que ganhou ficou muito emocionada." }
];

const faqItems = (ctx) => [
  { q: "Como recebo meu produto digital?", a: ctx.pages.faq || "Assim que o pagamento é confirmado, os links dos arquivos são liberados na página do seu pedido." },
  { q: "Preciso da versão paga do Canva?", a: "Não. Os arquivos foram pensados para funcionar no Canva gratuito, sem assinatura." },
  { q: "Posso editar pelo celular?", a: "Sim. Você personaliza fotos, nomes e frases pelo aplicativo do Canva no celular ou pelo navegador do computador." },
  { q: "E se eu tiver alguma dificuldade?", a: "É só chamar no WhatsApp: a gente ajuda você a abrir e personalizar o arquivo." }
];

const icons = {
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>',
  bag: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  whatsapp: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2a13.9 13.9 0 00-11.8 21.3L2 30l6.9-2.2A13.9 13.9 0 1016 2zm0 25.4a11.5 11.5 0 01-5.9-1.6l-.4-.3-4.4 1.4 1.4-4.3-.3-.4A11.5 11.5 0 1116 27.4zm6.3-8.6c-.3-.2-2-.9-2.3-1s-.6-.2-.8.2-.9 1-1.1 1.2-.4.3-.7.1a9.2 9.2 0 01-2.7-1.7 10.1 10.1 0 01-1.9-2.3c-.2-.3 0-.5.1-.7l.5-.6.3-.5a.6.6 0 000-.6c-.1-.2-.8-1.9-1.1-2.6-.3-.7-.6-.6-.8-.6h-.7a1.4 1.4 0 00-1 .5 4.3 4.3 0 00-1.3 3.2 7.6 7.6 0 001.6 4 17.5 17.5 0 006.7 5.9c2.4 1 2.9 1 3.9.9a3.3 3.3 0 002.2-1.5 2.7 2.7 0 00.2-1.5c-.2-.1-.5-.2-.9-.4z"/></svg>'
};

function whatsappLink(ctx, text = "") {
  const number = String(ctx.settings.whatsapp || "").replace(/\D/g, "");
  if (!number) return "";
  return `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

function formatWhatsapp(number = "") {
  const digits = String(number).replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return number;
}

function brand(ctx) {
  const words = String(ctx.settings.storeName || "Meu Mimo Digital").split(" ");
  if (words.length < 2) return e(words[0]);
  return `${e(words.slice(0, -1).join(" "))} <span>${e(words.at(-1))}</span>`;
}

function layout(ctx, title, content, options = {}) {
  const { admin = false, noindex = false, description = ctx.settings.tagline, searchValue = "" } = options;
  const pixDiscount = Number(ctx.settings.pixDiscountPercent || 0);
  const wa = whatsappLink(ctx, "Olá! Tenho uma dúvida sobre os produtos.");
  const storeHeader = `
  ${pixDiscount > 0 ? `<div class="top-bar"><span>Pix</span> ${e(pixDiscount)}% de desconto pagando com Pix.</div>` : ""}
  <header class="site-header">
    <div class="nav-container">
      <a href="/" class="logo">${brand(ctx)}</a>
      <form class="search-box" action="/" method="get" role="search">
        ${icons.search}
        <input type="search" name="q" id="search-input" value="${e(searchValue)}" placeholder="Pesquisar moldes, quadros..." aria-label="Pesquisar produtos" maxlength="80">
      </form>
      <button class="cart-btn" type="button" data-cart-toggle aria-controls="cart-drawer" aria-expanded="false">
        ${icons.bag}<span>Carrinho</span><span class="cart-badge" data-cart-count>0</span>
      </button>
    </div>
  </header>`;
  const adminHeader = `
  <header class="site-header">
    <div class="nav-container">
      <span class="logo">${brand(ctx)}</span>
      <span class="pill">Painel interno</span>
    </div>
  </header>`;
  const storeFooter = `
  <footer class="site-footer">
    <div class="footer-content">
      <div class="footer-brand"><h2>${e(ctx.settings.storeName)}</h2><p>${e(ctx.settings.tagline)}</p></div>
      <div>
        <div class="footer-title">Navegação</div>
        <ul class="footer-links">
          <li><a href="/#produtos">Produtos</a></li>
          <li><a href="/#depoimentos">Depoimentos</a></li>
          <li><a href="/#faq">Dúvidas frequentes</a></li>
          <li><a href="/privacidade">Privacidade</a></li>
        </ul>
      </div>
      <div>
        <div class="footer-title">Contato</div>
        <ul class="footer-links">
          ${ctx.settings.city ? `<li>${e(ctx.settings.city)}</li>` : ""}
          ${wa ? `<li><a href="${e(wa)}" target="_blank" rel="noopener">WhatsApp: ${e(formatWhatsapp(ctx.settings.whatsapp))}</a></li>` : ""}
          ${ctx.settings.email ? `<li><a href="mailto:${e(ctx.settings.email)}">${e(ctx.settings.email)}</a></li>` : ""}
          ${ctx.settings.instagram ? `<li><a href="${e(ctx.settings.instagram)}" target="_blank" rel="noopener">Instagram</a></li>` : ""}
        </ul>
      </div>
    </div>
    <div class="footer-bottom">&copy; ${new Date().getFullYear()} ${e(ctx.settings.storeName)}. Todos os direitos reservados.</div>
  </footer>
  ${wa ? `<a href="${e(wa)}" target="_blank" rel="noopener" class="wsp-float" aria-label="Fale pelo WhatsApp">${icons.whatsapp}</a>` : ""}
  <div class="cart-overlay" data-cart-toggle></div>
  <aside class="cart-drawer" id="cart-drawer" aria-label="Carrinho" aria-hidden="true">
    <div class="cart-header"><h3>Seu carrinho</h3><button type="button" class="icon-btn" data-cart-toggle aria-label="Fechar carrinho">&times;</button></div>
    <div class="cart-body" data-cart-items></div>
    <div class="cart-footer">
      <div class="cart-total-row"><span>Subtotal</span><span data-cart-subtotal>R$ 0,00</span></div>
      <a class="checkout-btn" href="/carrinho">Finalizar compra</a>
    </div>
  </aside>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${e(title)} | ${e(ctx.settings.storeName)}</title>
  <meta name="description" content="${e(description)}">
  ${admin || noindex ? '<meta name="robots" content="noindex, nofollow">' : ""}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,600;0,700;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
</head>
<body data-admin-path="${e(config.adminPath)}">
  ${admin ? adminHeader : storeHeader}
  ${content}
  ${admin ? "" : storeFooter}
  <div class="toast-stack" id="toast-stack" role="status" aria-live="polite"></div>
  <script src="/app.js" defer></script>
</body>
</html>`;
}

function discountPercent(product) {
  if (!product.compareAtPrice || product.compareAtPrice <= product.price) return 0;
  return Math.round((1 - product.price / product.compareAtPrice) * 100);
}

function productCard(product) {
  const off = discountPercent(product);
  const href = `/produto/${encodeURIComponent(product.slug)}`;
  return `<article class="product-card" data-product-card data-category="${e(product.category)}" data-search="${e(`${product.name} ${product.category} ${product.shortDescription}`.toLowerCase())}">
    <a class="product-thumb" href="${href}">
      ${off ? `<span class="badge-discount">-${off}%</span>` : ""}
      <span class="badge-digital">Digital</span>
      <img src="${e(product.image)}" alt="${e(product.name)}" loading="lazy" width="400" height="400">
    </a>
    <div class="product-content">
      <span class="product-cat">${e(product.category)}</span>
      <h3 class="product-name"><a href="${href}">${e(product.name)}</a></h3>
      <p class="product-snippet">${e(product.shortDescription)}</p>
      <div class="product-bottom">
        <div class="price-box">
          ${product.compareAtPrice ? `<span class="price-old">${money(product.compareAtPrice)}</span>` : ""}
          <span class="price-main">${money(product.price)}</span>
        </div>
        <button class="buy-btn" type="button" data-add-cart="${e(product.id)}">+ Adicionar</button>
      </div>
    </div>
  </article>`;
}

function homePage(ctx, products, query = "") {
  const active = products.filter((product) => product.active !== false);
  const sorted = [...active].sort((a, b) => Number(b.featured) - Number(a.featured));
  const categories = [...new Set(active.map((product) => product.category))];
  const heroShots = sorted.slice(0, 2);
  const wa = whatsappLink(ctx, "Olá! Tenho uma dúvida sobre os produtos.");
  return layout(ctx, "Presentes e lembranças digitais", `
  <section class="hero">
    <div class="hero-grid">
      <div class="hero-text">
        <div class="hero-badge">Arquivos editáveis no Canva</div>
        <h1>Presentes que <span>emocionam</span> e eternizam momentos</h1>
        <p>${e(ctx.settings.tagline)}</p>
        <div class="hero-cta">
          <a href="#produtos" class="btn-primary">Explorar catálogo</a>
          <a href="#depoimentos" class="btn-secondary">Ver avaliações</a>
        </div>
      </div>
      ${heroShots.length ? `<div class="hero-visual"><div class="hero-card-stack">
        <img class="hero-img-main" src="${e(heroShots[0].image)}" alt="${e(heroShots[0].name)}">
        ${heroShots[1] ? `<img class="hero-img-sub" src="${e(heroShots[1].image)}" alt="${e(heroShots[1].name)}">` : ""}
      </div></div>` : ""}
    </div>
  </section>

  <div class="trust-bar"><div class="trust-grid">
    <div class="trust-item"><div class="trust-icon-wrap">${icons.bolt}</div><div><div class="trust-title">Entrega digital</div><div class="trust-sub">Liberada após o pagamento</div></div></div>
    <div class="trust-item"><div class="trust-icon-wrap">${icons.pencil}</div><div><div class="trust-title">Editável no Canva</div><div class="trust-sub">Personalize fotos e textos</div></div></div>
    <div class="trust-item"><div class="trust-icon-wrap">${icons.shield}</div><div><div class="trust-title">Pagamento seguro</div><div class="trust-sub">Pague com Pix</div></div></div>
    <div class="trust-item"><div class="trust-icon-wrap">${icons.chat}</div><div><div class="trust-title">Suporte dedicado</div><div class="trust-sub">Atendimento no WhatsApp</div></div></div>
  </div></div>

  <main>
    <div class="section-head" id="produtos"><h2 class="section-heading">Catálogo completo</h2></div>
    <div class="filter-scroll-wrapper"><div class="filter-tabs" role="tablist" aria-label="Categorias">
      <button class="tab-btn active" type="button" data-category-tab="all">Todos</button>
      ${categories.map((category) => `<button class="tab-btn" type="button" data-category-tab="${e(category)}">${e(category)}</button>`).join("")}
    </div></div>
    <div class="products-container">
      <div class="products-grid" id="products-grid" data-initial-query="${e(query)}">${sorted.map(productCard).join("")}</div>
      <p class="empty-state" id="products-empty" ${sorted.length ? "hidden" : ""}>Nenhum produto encontrado. <a href="/">Ver todos</a></p>
    </div>

    <section class="reviews-section" id="depoimentos">
      <div class="section-intro"><h2>Depoimentos de clientes</h2><p>A experiência de quem já presenteou com os nossos mimos digitais.</p></div>
      <div class="reviews-grid">${testimonials.map((item) => `<div class="review-card">
        <div class="stars" aria-label="5 de 5 estrelas">★★★★★</div>
        <p class="review-text">"${e(item.text)}"</p>
        <div class="reviewer-info"><div class="reviewer-avatar">${e(item.name[0])}</div><div class="reviewer-name">${e(item.name)}</div></div>
      </div>`).join("")}</div>
    </section>

    <section class="about-section" id="sobre">
      <div class="section-intro"><h2>Quem somos</h2><p>${e(ctx.pages.about)}</p></div>
    </section>

    <section class="faq-section" id="faq">
      <div class="section-intro"><h2>Dúvidas frequentes</h2><p>Respostas rápidas para as principais perguntas.</p></div>
      <div class="faq-container">${faqItems(ctx).map((item, index) => `<div class="faq-item">
        <button class="faq-question" type="button" aria-expanded="false" aria-controls="faq-${index}"><span>${e(item.q)}</span><span class="faq-icon-badge">${icons.plus}</span></button>
        <div class="faq-answer-wrapper" id="faq-${index}"><div class="faq-answer-inner"><div class="faq-answer">${e(item.a)}</div></div></div>
      </div>`).join("")}</div>
      ${wa ? `<p class="faq-more">Não achou sua dúvida? <a href="${e(wa)}" target="_blank" rel="noopener">Chama no WhatsApp</a>.</p>` : ""}
    </section>

    <section class="newsletter">
      <h2>Receba as novidades</h2>
      <p>Cadastre seu e-mail para acompanhar novos mimos e ofertas.</p>
      <form id="newsletter-form" novalidate>
        <input type="email" name="email" placeholder="seu@email.com" aria-label="E-mail" autocomplete="email" maxlength="254" required>
        <button class="btn-primary" type="submit">Quero receber</button>
      </form>
    </section>
  </main>`, { searchValue: query });
}

function productPage(ctx, product, related = []) {
  const gallery = [...new Set([product.image, ...(product.gallery || [])].filter(Boolean))].slice(0, 9);
  const off = discountPercent(product);
  const pixDiscount = Number(ctx.settings.pixDiscountPercent || 0);
  return layout(ctx, product.name, `
  <main class="page">
    <nav class="breadcrumb"><a href="/">Início</a> / <a href="/#produtos">Produtos</a> / <span>${e(product.name)}</span></nav>
    <div class="product-main">
      <section class="product-gallery">
        <img id="product-main-image" class="product-hero-image" src="${e(product.image)}" alt="${e(product.name)}">
        ${gallery.length > 1 ? `<div class="thumbs">${gallery.map((image, index) => `<button type="button" class="thumb ${index === 0 ? "active" : ""}" data-gallery-thumb="${e(image)}" aria-label="Ver imagem ${index + 1}"><img src="${e(image)}" alt="" loading="lazy"></button>`).join("")}</div>` : ""}
      </section>
      <section class="product-info">
        <span class="product-cat">${e(product.category)}</span>
        <h1>${e(product.name)}</h1>
        <div class="product-price-row">
          <span class="price-main big">${money(product.price)}</span>
          ${product.compareAtPrice ? `<span class="price-old">${money(product.compareAtPrice)}</span>` : ""}
          ${off ? `<span class="badge-inline">-${off}%</span>` : ""}
        </div>
        ${pixDiscount > 0 ? `<p class="pix-hint">${money(product.price * (1 - pixDiscount / 100))} no Pix (${e(pixDiscount)}% de desconto)</p>` : ""}
        <p class="product-description">${e(product.description)}</p>
        <div class="product-actions">
          <button class="btn-primary" type="button" data-add-cart="${e(product.id)}">Adicionar ao carrinho</button>
          <button class="btn-secondary" type="button" data-buy-now="${e(product.id)}">Comprar agora</button>
        </div>
        <ul class="product-perks">
          <li>Arquivo 100% digital, editável no Canva gratuito</li>
          <li>Acesso liberado na página do pedido após o pagamento</li>
          <li>Suporte pelo WhatsApp</li>
        </ul>
      </section>
    </div>
    ${related.length ? `<section class="related"><h2 class="section-heading">Você também pode gostar</h2><div class="products-grid">${related.map(productCard).join("")}</div></section>` : ""}
  </main>`, { description: product.shortDescription });
}

function cartPage(ctx) {
  return layout(ctx, "Carrinho", `
  <main class="page">
    <h1 class="page-title">Finalizar compra</h1>
    <div class="checkout-grid">
      <section class="panel">
        <h2>Seu carrinho</h2>
        <div data-cart-items data-cart-full></div>
        <div class="totals">
          <div><span>Subtotal</span><span data-cart-subtotal>R$ 0,00</span></div>
          <div data-cart-discount-row hidden><span data-cart-discount-label>Desconto Pix</span><span data-cart-discount></span></div>
          <div class="totals-final"><span>Total</span><span data-cart-total>R$ 0,00</span></div>
        </div>
      </section>
      <section class="panel">
        <h2>Seus dados</h2>
        <form id="checkout-form" class="form" novalidate>
          <label>Nome completo
            <input name="customerName" autocomplete="name" maxlength="120" required>
            <small class="field-error" data-error-for="customerName"></small>
          </label>
          <label>E-mail
            <input name="customerEmail" type="email" autocomplete="email" maxlength="254" required>
            <small class="field-error" data-error-for="customerEmail"></small>
          </label>
          <label>WhatsApp com DDD
            <input name="customerPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(11) 99999-9999" maxlength="20" required>
            <small class="field-error" data-error-for="customerPhone"></small>
          </label>
          <label class="check"><input type="checkbox" name="acceptTerms" required><span>Li e concordo com a <a href="/privacidade" target="_blank">política de privacidade</a>.</span></label>
          <small class="field-error" data-error-for="acceptTerms"></small>
          <p class="form-error" id="checkout-error" role="alert" hidden></p>
          <button class="checkout-btn" type="submit">Gerar pagamento Pix</button>
          <p class="form-hint">Você verá o Pix na próxima tela. Os arquivos são liberados após a confirmação do pagamento.</p>
        </form>
      </section>
    </div>
  </main>`, { noindex: true });
}

function orderItemsList(order) {
  return `<ul class="order-items">${(order.items || []).map((item) => `<li><span>${e(item.name)} <small>x${e(item.quantity)}</small></span><span>${money(item.total)}</span></li>`).join("")}</ul>
  <div class="totals">
    ${order.discount > 0 ? `<div><span>Subtotal</span><span>${money(order.subtotal)}</span></div><div><span>Desconto Pix</span><span>- ${money(order.discount)}</span></div>` : ""}
    <div class="totals-final"><span>Total</span><span>${money(order.total)}</span></div>
  </div>`;
}

function orderPage(ctx, order, products) {
  const view = order.paymentPayload?.view || {};
  const wa = whatsappLink(ctx, `Olá! Fiz o pedido ${order.id} e quero enviar o comprovante.`);
  const pollUrl = `/api/orders/${encodeURIComponent(order.id)}?token=${encodeURIComponent(order.deliveryToken)}`;
  let body = "";
  if (order.status === "pending") {
    body = `
      <p class="status-line"><span class="status-dot"></span>${e(view.message || "Aguardando a confirmação do pagamento.")}</p>
      ${view.qrCode ? `<img class="payment-qr" src="${e(view.qrCode)}" alt="QR Code Pix" width="220" height="220">` : ""}
      ${view.pixCopyPaste ? `<label class="copy-field">Pix copia e cola
        <textarea id="pix-code" readonly rows="3">${e(view.pixCopyPaste)}</textarea>
      </label>
      <button class="btn-primary" type="button" data-copy="#pix-code">Copiar código Pix</button>` : ""}
      ${view.ticketUrl ? `<p><a class="btn-secondary" href="${e(view.ticketUrl)}" target="_blank" rel="noopener">Abrir página de pagamento</a></p>` : ""}
      ${wa ? `<p><a class="btn-secondary" href="${e(wa)}" target="_blank" rel="noopener">Enviar comprovante no WhatsApp</a></p>` : ""}
      <p class="form-hint">Esta página atualiza sozinha quando o pagamento for confirmado. Guarde este link para acessar seus arquivos.</p>`;
  } else if (order.status === "canceled") {
    body = `<p class="status-line">Este pedido foi cancelado. Se precisar de ajuda, fale com a gente.</p>
      ${wa ? `<p><a class="btn-secondary" href="${e(wa)}" target="_blank" rel="noopener">Falar no WhatsApp</a></p>` : ""}
      <p><a class="btn-primary" href="/">Voltar para a loja</a></p>`;
  } else {
    const links = (order.items || []).map((item) => {
      const product = products.find((entry) => entry.id === item.productId);
      return `<article class="download-card"><div><strong>${e(item.name)}</strong></div>${
        product?.digitalDeliveryUrl
          ? `<a class="btn-primary" href="${e(product.digitalDeliveryUrl)}" target="_blank" rel="noopener noreferrer">Abrir arquivo</a>`
          : `<span class="form-hint">Arquivo em preparação — fale com a gente no WhatsApp.</span>`
      }</article>`;
    }).join("");
    body = `<p class="status-line ok">Pagamento confirmado. Seus arquivos estão liberados!</p>${links}
      <p class="form-hint">Guarde o link desta página: ele é o seu acesso aos arquivos.</p>`;
  }
  return layout(ctx, `Pedido ${order.id}`, `
  <main class="page narrow">
    <section class="panel order-panel" data-order-status="${e(order.status)}" ${order.status === "pending" ? `data-order-poll="${e(pollUrl)}"` : ""}>
      <span class="pill status-${e(order.status)}">${e(STATUS_LABEL[order.status] || order.status)}</span>
      <h1 class="page-title">Pedido ${e(order.id)}</h1>
      ${body}
    </section>
    <section class="panel"><h2>Resumo</h2>${orderItemsList(order)}</section>
  </main>`, { noindex: true });
}

function textPage(ctx, title, text) {
  const paragraphs = String(text || "").split(/\n{2,}|\r?\n/).filter(Boolean).map((paragraph) => `<p>${e(paragraph)}</p>`).join("");
  return layout(ctx, title, `<main class="page narrow"><section class="panel prose"><h1 class="page-title">${e(title)}</h1>${paragraphs}</section></main>`);
}

function notFoundPage(ctx, admin = false) {
  return layout(ctx, "Página não encontrada", `<main class="page narrow"><section class="panel center">
    <h1 class="page-title">Página não encontrada</h1>
    <p>O endereço pode ter mudado ou não existe mais.</p>
    <p><a class="btn-primary" href="/">${admin ? "Voltar ao painel" : "Voltar para a loja"}</a></p>
  </section></main>`, { admin, noindex: true });
}

function adminLoginPage(ctx) {
  const disabled = !config.adminEmail || !config.adminPassword;
  return layout(ctx, "Acesso interno", `
  <main class="page narrow">
    <section class="panel">
      <span class="pill">Painel da loja</span>
      <h1 class="page-title">Acesso interno</h1>
      ${disabled ? `<p class="form-error">Login desativado: defina ADMIN_EMAIL e ADMIN_PASSWORD no ambiente.</p>` : ""}
      <form id="admin-login-form" class="form" novalidate>
        <label>E-mail<input name="adminEmail" type="email" autocomplete="username" required></label>
        <label>Senha<input name="adminPassword" type="password" autocomplete="current-password" required></label>
        ${config.admin2faRequired ? `<label>Código 2FA<input name="otpCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required></label>` : ""}
        <p class="form-error" id="login-error" role="alert" hidden></p>
        <button class="btn-primary" type="submit" ${disabled ? "disabled" : ""}>Entrar</button>
      </form>
    </section>
  </main>`, { admin: true });
}

function productFields(product = {}) {
  const value = (key) => e(product[key] ?? "");
  return `
    <label>Nome do item<input name="name" data-preview="name" value="${value("name")}" maxlength="120" placeholder="Ex: Molde - Tirinha de Fotos" required></label>
    <div class="form-grid">
      <label>Categoria<input name="category" data-preview="category" value="${value("category")}" maxlength="60" placeholder="Ex: Polaroid" list="category-options" required></label>
      <label>Link curto (opcional)<input name="slug" value="${value("slug")}" maxlength="80" placeholder="ex: molde-polaroid"></label>
    </div>
    <div class="form-grid">
      <label>Preço de venda (R$)<input name="price" data-preview="price" type="number" min="0.01" step="0.01" value="${value("price")}" placeholder="4,99" required></label>
      <label>Preço antigo (R$)<input name="compareAtPrice" data-preview="compareAtPrice" type="number" min="0" step="0.01" value="${value("compareAtPrice")}" placeholder="29,90"></label>
    </div>
    <label>Enviar imagem (PNG, JPG, WEBP ou GIF até 5 MB)<input type="file" data-image-upload accept="image/png,image/jpeg,image/webp,image/gif"></label>
    <label>Imagem principal<input name="image" data-preview="image" value="${value("image")}" maxlength="2000" placeholder="https://... ou envie um arquivo acima" required></label>
    <label>Galeria (uma URL por linha, até 8)<textarea name="gallery" rows="3" placeholder="https://...">${e((product.gallery || []).join("\n"))}</textarea></label>
    <label>Link de entrega digital<input name="digitalDeliveryUrl" type="url" value="${value("digitalDeliveryUrl")}" maxlength="2000" placeholder="Link do Canva, Drive ou arquivo"></label>
    <label>Descrição curta<textarea name="shortDescription" data-preview="shortDescription" rows="2" maxlength="240" placeholder="Texto pequeno que aparece no card" required>${value("shortDescription")}</textarea></label>
    <label>Descrição completa<textarea name="description" rows="4" maxlength="4000" placeholder="Texto da página do produto" required>${value("description")}</textarea></label>
    <div class="form-grid">
      <label class="check"><input type="checkbox" name="featured" ${product.featured === false ? "" : "checked"}><span>Destaque</span></label>
      <label class="check"><input type="checkbox" name="active" ${product.active === false ? "" : "checked"}><span>Publicado na loja</span></label>
    </div>
    <p class="form-error" data-form-error role="alert" hidden></p>`;
}

function adminPage(ctx, { products, orders, subscribers, provider }) {
  const paid = orders.filter((order) => ["paid", "delivered"].includes(order.status));
  const pending = orders.filter((order) => order.status === "pending");
  const revenue = paid.reduce((sum, order) => sum + order.total, 0);
  const categories = [...new Set(products.map((product) => product.category))];
  const s = ctx.settings;

  const productRows = products.map((product) => `
    <article class="admin-product-card ${product.active === false ? "is-muted" : ""}">
      <img src="${e(product.image)}" alt="" loading="lazy">
      <div class="admin-product-card-body">
        <span class="pill">${e(product.category)}</span>
        <h3>${e(product.name)}</h3>
        <p><strong>${money(product.price)}</strong>${product.compareAtPrice ? ` <s>${money(product.compareAtPrice)}</s>` : ""}</p>
        <small>${product.active === false ? "Oculto da loja" : "Publicado"}${product.featured ? " · destaque" : ""}${product.digitalDeliveryUrl ? "" : " · <b class=\"warn\">sem link de entrega</b>"}</small>
        <div class="admin-actions">
          <button type="button" class="btn-secondary small" data-toggle-product="${e(product.id)}" data-active="${product.active === false ? "true" : "false"}">${product.active === false ? "Publicar" : "Ocultar"}</button>
          ${product.active === false ? "" : `<a class="btn-secondary small" href="${e(config.publicBaseUrl)}/produto/${encodeURIComponent(product.slug)}" target="_blank" rel="noopener">Ver na loja</a>`}
        </div>
        <details class="edit-box">
          <summary>Editar item</summary>
          <form class="form product-edit-form" data-product-id="${e(product.id)}" novalidate>
            ${productFields(product)}
            <button class="btn-primary" type="submit">Salvar alterações</button>
          </form>
        </details>
      </div>
    </article>`).join("");

  const orderRows = orders.map((order) => {
    const orderUrl = `${config.publicBaseUrl}/pedido/${encodeURIComponent(order.id)}/${encodeURIComponent(order.deliveryToken)}`;
    const phone = String(order.customerPhone || "").replace(/\D/g, "");
    return `<article class="order-card" data-order-row data-status="${e(order.status)}">
      <div>
        <span class="pill status-${e(order.status)}">${e(STATUS_LABEL[order.status] || order.status)}</span>
        <h3>${e(order.id)} · ${money(order.total)}</h3>
        <p>${e(order.customerName || "Cliente")} · ${e(order.customerEmail || "sem e-mail")}${phone ? ` · <a href="https://wa.me/55${e(phone)}" target="_blank" rel="noopener">${e(formatWhatsapp(phone))}</a>` : ""}</p>
        <p><small>${e(new Date(order.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }))} · ${(order.items || []).map((item) => `${e(item.name)} x${e(item.quantity)}`).join(" | ")}</small></p>
        ${order.paymentId ? `<p><small>Pagamento: ${e(order.paymentProvider || "gateway")} #${e(order.paymentId)}</small></p>` : ""}
      </div>
      <form class="order-status-form" data-order-id="${e(order.id)}">
        <select name="status" aria-label="Status do pedido">
          ${Object.keys(STATUS_LABEL).map((status) => `<option value="${status}" ${order.status === status ? "selected" : ""}>${STATUS_LABEL[status]}</option>`).join("")}
        </select>
        <button class="btn-primary small" type="submit">Atualizar</button>
        <button class="btn-secondary small" type="button" data-copy-text="${e(orderUrl)}">Copiar link do cliente</button>
      </form>
    </article>`;
  }).join("");

  return layout(ctx, "Painel", `
  <main class="page admin-page">
    <section class="admin-hero">
      <div><span class="pill">Painel da loja</span><h1 class="page-title">Gestão da ${e(s.storeName)}</h1>
        <p>Pagamento ativo: <strong>${e(provider.label)}</strong>${provider.automatic ? " (confirmação automática)" : " (confirmação manual: marque o pedido como Pago após conferir o Pix)"}.</p></div>
      <div class="admin-actions"><a class="btn-secondary" href="${e(config.publicBaseUrl)}" target="_blank" rel="noopener">Abrir loja</a><button class="btn-primary" type="button" id="logout-admin">Sair</button></div>
    </section>

    <section class="stats-grid">
      <div class="stat"><span>Aguardando pagamento</span><strong>${pending.length}</strong></div>
      <div class="stat"><span>Pedidos pagos</span><strong>${paid.length}</strong></div>
      <div class="stat"><span>Faturamento</span><strong>${money(revenue)}</strong></div>
      <div class="stat"><span>Inscritos na newsletter</span><strong>${subscribers}</strong></div>
    </section>

    <section>
      <div class="section-head"><h2 class="section-heading">Pedidos</h2>
        <select id="order-filter" aria-label="Filtrar pedidos"><option value="all">Todos</option>${Object.keys(STATUS_LABEL).map((status) => `<option value="${status}">${STATUS_LABEL[status]}</option>`).join("")}</select>
      </div>
      <div class="admin-list">${orderRows || "<p class='panel'>Nenhum pedido ainda.</p>"}</div>
    </section>

    <section>
      <div class="section-head"><h2 class="section-heading">Novo item</h2></div>
      <div class="admin-workspace">
        <form id="product-form" class="form panel" novalidate>
          ${productFields()}
          <button class="btn-primary" type="submit">Cadastrar item</button>
        </form>
        <aside class="sticky-preview">
          <span class="pill">Prévia do cliente</span>
          <article class="product-card">
            <div class="product-thumb preview-image" id="preview-image">Imagem</div>
            <div class="product-content">
              <span class="product-cat" id="preview-category">Categoria</span>
              <h3 class="product-name" id="preview-name">Nome do item</h3>
              <p class="product-snippet" id="preview-description">Descrição curta do mimo digital.</p>
              <div class="product-bottom"><div class="price-box"><span class="price-old" id="preview-old-price"></span><span class="price-main" id="preview-price">R$ 0,00</span></div></div>
            </div>
          </article>
        </aside>
      </div>
      <datalist id="category-options">${categories.map((category) => `<option value="${e(category)}">`).join("")}</datalist>
    </section>

    <section>
      <div class="section-head"><h2 class="section-heading">Itens cadastrados (${products.length})</h2></div>
      <div class="admin-product-grid">${productRows || "<p class='panel'>Nenhum item cadastrado ainda.</p>"}</div>
    </section>

    <section>
      <div class="section-head"><h2 class="section-heading">Dados da loja</h2></div>
      <form id="settings-form" class="form panel" novalidate>
        <div class="form-grid">
          <label>Nome da loja<input name="storeName" value="${e(s.storeName)}" maxlength="80" required></label>
          <label>Desconto no Pix (%)<input name="pixDiscountPercent" type="number" min="0" max="90" step="0.5" value="${e(s.pixDiscountPercent ?? 0)}"></label>
        </div>
        <label>Frase de destaque<input name="tagline" value="${e(s.tagline)}" maxlength="200"></label>
        <div class="form-grid">
          <label>WhatsApp (DDI + DDD + número)<input name="whatsapp" value="${e(s.whatsapp)}" inputmode="numeric" maxlength="20" placeholder="5511999999999"></label>
          <label>E-mail de contato<input name="email" type="email" value="${e(s.email)}" maxlength="254"></label>
        </div>
        <div class="form-grid">
          <label>Instagram (link)<input name="instagram" type="url" value="${e(s.instagram)}" maxlength="300"></label>
          <label>Cidade<input name="city" value="${e(s.city)}" maxlength="80"></label>
        </div>
        <label>Quem somos<textarea name="about" rows="3" maxlength="2000">${e(ctx.pages.about)}</textarea></label>
        <label>Como recebo meu produto (FAQ)<textarea name="faq" rows="3" maxlength="2000">${e(ctx.pages.faq)}</textarea></label>
        <label>Política de privacidade<textarea name="privacy" rows="5" maxlength="6000">${e(ctx.pages.privacy)}</textarea></label>
        <p class="form-error" data-form-error role="alert" hidden></p>
        <button class="btn-primary" type="submit">Salvar dados da loja</button>
      </form>
    </section>
  </main>`, { admin: true });
}

module.exports = { money, escapeHtml, STATUS_LABEL, homePage, productPage, cartPage, orderPage, textPage, notFoundPage, adminLoginPage, adminPage, whatsappLink };

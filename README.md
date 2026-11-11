# Meu Mimo Digital

Loja própria para produtos digitais (moldes e arquivos editáveis no Canva), sem WordPress e sem construtor visual. Node.js puro + PostgreSQL.

## O que está pronto

**Loja**
- Home com busca, filtro por categoria, depoimentos, FAQ e newsletter.
- Página de produto com galeria e produtos relacionados.
- Carrinho (gaveta lateral e página) com quantidade, remoção e desconto Pix.
- Checkout com validação de nome, e-mail e WhatsApp no navegador e no servidor.
- Página do pedido: mostra o Pix, atualiza sozinha quando o pagamento é confirmado e libera os arquivos. O link dessa página é o acesso do cliente.

**Painel interno** (host/porta separados)
- Login com senha, 2FA opcional (TOTP), limite de tentativas e sessão de 8 horas.
- Pedidos: filtro por status, mudança de status, link do cliente, contato por WhatsApp.
- Produtos: cadastro, edição, upload de imagem, ocultar/publicar.
- Dados da loja: nome, contatos, desconto Pix, textos de "quem somos", FAQ e privacidade.

**Pagamento** — a loja já vende sem gateway e está preparada para receber um:
- `manual` (padrão): com `PIX_KEY` definida, gera Pix copia e cola + QR Code com o valor do pedido, direto para a conta da loja, sem taxa. A confirmação é feita no painel (marcar como **Pago**).
- `mercado-pago`: Pix com confirmação automática por webhook assinado.
- Outro gateway: basta um arquivo novo em `src/payments/` (contrato documentado em `src/payments/index.js`). Comparativo em [`docs/GATEWAYS.md`](docs/GATEWAYS.md).

## Rodar

```bash
cp .env.example .env        # ajuste senha, SESSION_SECRET e PIX_KEY
docker compose up --build -d
```

- Loja: http://localhost:3000
- Painel: http://localhost:3001 (credenciais de `ADMIN_EMAIL` / `ADMIN_PASSWORD`)

Sem Docker (dados em `data/db.local.json`, sem PostgreSQL):

```bash
npm install
ADMIN_EMAIL=admin@meumimo.local ADMIN_PASSWORD=uma-senha ADMIN_HOSTS=127.0.0.1:3000 npm start
# loja em http://localhost:3000 e painel em http://127.0.0.1:3000
# (o painel responde só pelo host listado em ADMIN_HOSTS)
```

## Testes

```bash
npm test
# inclui o caminho PostgreSQL quando houver um banco descartável:
TEST_DATABASE_URL=postgres://usuario:senha@localhost:5432/banco_teste npm test
```

Os testes cobrem validações, cálculo do pedido, Pix (CRC e payload), TOTP, sessão, fluxo completo de compra, painel e o webhook do Mercado Pago (com a API simulada).

## Variáveis de ambiente

Todas estão comentadas em [`.env.example`](.env.example). As essenciais para publicar:

| Variável | Para quê |
|---|---|
| `PUBLIC_STORE_URL` | URL pública da loja (links de pedido, e-mails, webhooks). |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Login do painel. Sem elas o login fica desativado. |
| `SESSION_SECRET` | Assina a sessão do painel. Use um valor longo e aleatório. |
| `ADMIN_HOSTS` | Host(s) em que o painel responde, ex.: `admin.seudominio.com.br`. |
| `ADMIN_2FA_SECRET` | Segredo base32 do autenticador (ativa o 2FA). |
| `TRUST_PROXY` | `true` atrás de Nginx/Caddy/Cloudflare (IP real e HTTPS). |
| `PAYMENT_PROVIDER` | `manual` ou `mercado-pago`. |
| `PIX_KEY`, `PIX_MERCHANT_NAME`, `PIX_MERCHANT_CITY` | Pix do modo manual. |
| `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET` | Credenciais do Mercado Pago. |
| `RESEND_API_KEY`, `EMAIL_FROM` | E-mails de "pedido recebido" e "pagamento confirmado" (opcional). |
| `DATABASE_URL` | PostgreSQL. Sem ela, os dados ficam em arquivo (só para desenvolvimento). |

## Publicar: checklist

1. Domínio com HTTPS e proxy reverso apontando loja e painel (`admin.`) para o container; `TRUST_PROXY=true`.
2. Trocar `ADMIN_PASSWORD`, definir `SESSION_SECRET` e ativar o 2FA.
3. Definir `PIX_KEY` (modo manual) ou as credenciais do gateway escolhido.
4. No painel, conferir o link de entrega de cada produto (o painel avisa quando falta).
5. Backup do volume do PostgreSQL e do volume de uploads.

Webhook do Mercado Pago: `https://seudominio.com.br/api/webhooks/mercado-pago`. O app valida a assinatura, ignora o conteúdo recebido e consulta o pagamento na API oficial antes de liberar a entrega.

## Estrutura

```
src/server.js        rotas HTTP
src/views.js         páginas (HTML renderizado no servidor)
src/validation.js    validações de entrada
src/security.js      sessão, 2FA, limite de tentativas
src/store.js         PostgreSQL (produção) ou arquivo JSON (desenvolvimento)
src/payments/        provedores de pagamento
src/mailer.js        e-mail transacional opcional
src/public/          JS e CSS do navegador
data/store.json      dados iniciais (seed)
index.html           prévia estática do layout (GitHub Pages), sem checkout real
```

## Limites conhecidos

- O limite de tentativas fica em memória: vale para uma única instância do app.
- Os arquivos digitais são links externos (Canva/Drive) liberados após o pagamento; não há hospedagem própria de arquivos.
- Não há área de cliente com login: o acesso é pelo link do pedido.

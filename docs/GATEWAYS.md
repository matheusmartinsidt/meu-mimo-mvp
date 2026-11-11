# Meios de pagamento sem custo fixo

Levantamento para escolher o gateway da loja. **Atenção:** a pesquisa foi feita sem acesso aos sites oficiais da maioria dos gateways (bloqueio de rede no ambiente). Os valores abaixo vieram de resumos de busca e de sites de terceiros e estão marcados como *não verificado*. Confirme cada taxa na página oficial antes de decidir.

## Opção zero: Pix direto, já implementado

O modo `manual` da loja gera Pix copia e cola e QR Code com o valor do pedido usando apenas a chave Pix (`PIX_KEY`). Não há gateway, adesão nem taxa por venda (a conta que recebe pode ter tarifa própria, principalmente PJ). O custo é operacional: alguém confere o extrato e marca o pedido como **Pago** no painel. Serve para começar a vender hoje; deixa de servir quando o volume tornar a conferência manual inviável.

## Gateways com confirmação automática

Nenhum dos pesquisados cobra adesão ou mensalidade, segundo as fontes encontradas; todos cobram por transação.

| Gateway | Pix (recebimento) | Cartão | Observações |
|---|---|---|---|
| Mercado Pago | 0,99% *(não verificado)* | ~4,98% na hora *(não verificado; fontes divergem)* | **Já integrado na loja** (Pix + webhook). Marca conhecida pelo cliente final. |
| Asaas | R$ 1,99 por Pix recebido *(não verificado)* | *não verificado* | Taxa fixa pesa em tíquete baixo: em um produto de R$ 4,99 seria cerca de 40%. |
| Woovi / OpenPix | ~0,80% *(relato de 2024, não verificado)* | não oferece | Focado em Pix, API bem documentada, tem sandbox. |
| AbacatePay | *não encontrado* (saque R$ 0,80 *não verificado*) | *não verificado* | Focado em Pix, SDK Node. |
| InfinitePay | grátis *(não verificado; fontes contraditórias para venda online)* | a partir de 4,20% *(não verificado)* | API de checkout não avaliada. |
| Efí | 1,98% limitado a R$ 7,90 *(dado antigo, não verificado)* | *não verificado* | API Pix madura. |
| Pagar.me | sob proposta | sob proposta | Taxas negociadas caso a caso. |
| PagBank | fontes divergem (grátis a 1,89%) | a partir de 2,92% *(não verificado)* | |
| Stripe | via parceiro, cobertura incerta no Brasil | *não verificado* | Pouco indicado para Pix. |
| Pix via API de banco | depende do banco | — | Exige conta PJ, certificado e integração bancária: esforço alto para um MVP. |

## Leitura para esta loja

O tíquete é baixo (produtos de R$ 4,99 a R$ 9,90). Por isso:

- **Taxa percentual vence taxa fixa.** 0,99% de R$ 4,99 são 5 centavos; uma taxa fixa de R$ 1,99 consome 40% da venda.
- **Mercado Pago** é o caminho de menor esforço: a integração Pix já existe e está testada com a API simulada. Falta validar com credenciais reais.
- **Woovi/OpenPix** vale cotar se a taxa percentual se confirmar menor.
- Qualquer outro entra como um arquivo novo em `src/payments/`, seguindo o contrato de `src/payments/index.js`.

## Antes de fechar

1. Conferir a tabela oficial de taxas do gateway escolhido.
2. Confirmar se aceita CPF ou exige CNPJ/MEI e qual o prazo de recebimento.
3. Testar no sandbox do gateway com credenciais reais.

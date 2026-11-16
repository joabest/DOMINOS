# Consulta de lojas por CEP — Vercel

Frontend independente de checkout ou pagamentos. O formulário recebe CEP e número, exibe o endereço usando ViaCEP e busca lojas por uma função serverless `/api/lojas`.

## Publicar
1. Envie o conteúdo desta pasta para um repositório GitHub.
2. Importe o repositório em https://vercel.com/new.
3. Framework **Other**; diretório raiz do projeto; deploy padrão.

## Desenvolvimento local
Use `npx vercel dev` (Vercel CLI, login necessário) para executar `api/lojas.js`. `python -m http.server` **não** executa funções serverless.

## Integração
Consulta read-only a `getStore` com `zipCode`, `city`, `state`, `neighborhood`, `street`, `number`, conforme HAR fornecido. O CEP é resolvido por ViaCEP no servidor. A API pode mudar ou exigir autorização e não há garantia de resposta fora do site de origem. Não se usam cookies, dados de cartão ou requisições de pagamento. Se a resposta tiver estrutura não reconhecida, a UI mostra erro claro em vez de inventar lojas.

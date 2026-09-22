# Especificação de UI/UX — pedido assistido no Foundry

## Contexto e objetivo

Mestres precisam receber, dentro do mundo correto, um aviso privado e acionável
sobre pedidos feitos por jogadores no portal. A mensagem serve como registro para
o acerto manual; não transfere itens, não reduz estoque e não desconta moedas.

## Hierarquia da mensagem

1. Título: `Solicitação de compra` e estado `Precisa de ação`.
2. Identidade do personagem e do jogador.
3. Item, quantidade e preço registrado no momento do pedido.
4. Observação opcional do jogador.
5. Aviso persistente: nenhuma moeda, item ou quantidade foi alterada.
6. Orientação: realizar o acerto e decidir o pedido no portal.

## Estados e falhas

- A mensagem é criada somente depois de revalidar o ator do Mercador, o
  personagem, o item, o preço e a quantidade disponível.
- Mudança de preço, estoque insuficiente, item removido ou ator ausente falham sem
  criar uma mensagem enganosa.
- A mensagem é um sussurro para todos os usuários GM do mundo; jogadores não a
  recebem.
- Uma entrega repetida usa o ciclo idempotente do comando e o callback do portal
  não pode desfazer uma decisão humana.

## Acessibilidade e conteúdo

- Estado é comunicado por texto, não apenas por cor.
- O conteúdo usa estrutura semântica simples, texto escapado e contraste herdado
  do chat do Foundry.
- Nomes e observações longas quebram linha sem provocar rolagem horizontal.
- A mensagem não contém botões falsos nem sugere que o acerto ocorreu.

## Critérios de aceitação

- Somente um mestre conector ativo consome o comando.
- Apenas GMs recebem a notificação.
- Todos os dados vindos do portal são tratados como texto não confiável.
- A validação usa os documentos reais do mundo no momento da entrega.
- Sucesso retorna o ID da mensagem e o estado observado; falha retorna explicação
  adequada ao portal.
- A mensagem permanece legível em chat estreito, intermediário e amplo.


# Changelog

## 0.9.0 — Não lançada

- Envia o retrato (`actor.img`) e o token (`prototypeToken.texture.src`) de cada
  personagem, como miniaturas geradas no navegador do mestre: retrato de 256 px
  enquadrado pelo topo e token de 128 px inteiro, com fundo transparente.
- Imagens que não carregam seguem como ausentes; a sincronização respeita um
  orçamento total de imagens.
- Requer o portal com as imagens de personagem.

## 0.8.1 — 2026-09-26

- Envia as versões do Foundry, do sistema e do módulo a cada heartbeat. O
  portal passa a reconhecer atualizações feitas depois do pareamento, o que
  libera o envio do estoque do Lojista para mundos pareados em versões antigas.
- Requer o portal com o heartbeat de versões.

## 0.8.0 — 2026-09-26

- Recebe o estoque sorteado no portal (`merchant.stock.replace`) e cria os itens
  no ator do Lojista, com nome, tipo, ícone do sistema, preço, disponibilidade,
  quantidade, propriedades, dano, empunhadura, defesa e requisito.
- Troca somente os itens criados por sorteios anteriores; itens colocados à mão
  no ator continuam como estão.
- Reenviar o mesmo sorteio não duplica itens.
- Valida o payload antes de tocar no ator: só os campos do contrato, ícones de
  caminhos do Foundry e nada de HTML ou código vindo do portal.
- Requer o portal com o catálogo e o sorteio de estoque do Lojista.

## 0.7.0 — 2026-09-25

- Envia uma miniatura de 64 px do ícone de cada item do Mercador, gerada no
  navegador do mestre. O servidor do Foundry continua fora da internet.
- Envia raridade, tipo de consumível, propriedades, dados de arma (dano,
  empunhadura e requisito) e de armadura (defesa, defesa fixa, agilidade,
  escudo e requisito).
- Nova opção "Moeda dos preços sem moeda" na tela de conexão: um preço digitado
  só com número, como `22`, é enviado como `22 cp` (ou na moeda escolhida).
- Pedidos feitos antes da atualização continuam aceitos com o preço original.
- Requer o portal com o contrato de detalhes do item.

## 0.6.0 — 2026-09-22

- Reescreve o módulo em TypeScript estrito, organizado em módulos por
  responsabilidade, com testes automatizados e build por Bun.
- Reduz requisições com o mestre ocioso: o heartbeat segue a cadência informada
  pelo Bridge e o polling de comandos passa a ser adaptativo (5 s a 30 s).
- Deixa de reiniciar sincronizações completas a cada atualização de usuário ou
  configuração enquanto a conexão já está ativa.
- Envia o saldo das quatro moedas do personagem (coroas de ouro, xelins de
  prata, centavos de cobre e trocados) para o portal exibir custo e saldo nos
  pedidos do Mercador. Requer o portal com o contrato de moedas.

## 0.5.0 — 2026-09-11

- Recebe pedidos assistidos do Mercador pela fila idempotente de comandos.
- Revalida Mercador, personagem, item, preço e estoque no mundo antes de avisar.
- Envia uma mensagem privada e sanitizada a todos os mestres, deixando explícito
  que nenhuma moeda, item ou quantidade foi alterada automaticamente.
- Retorna o resultado ao portal para acompanhamento e decisão humana.

## 0.4.0 — 2026-08-31

- Permite ao mestre conector escolher explicitamente um ator como Mercador.
- Sincroniza um catálogo sanitizado e somente leitura com nome, descrição,
  categoria, preço e quantidade dos itens.
- Atualiza o catálogo ao alterar o ator ou seus itens e oferece sincronização
  manual com estado visível na tela de conexão.
- Mantém caminhos e imagens locais fora da projeção pública; somente imagens
  HTTPS podem ser encaminhadas.

## 0.3.0 — 2026-08-24

- Captura mensagens públicas do chat durante sessões iniciadas pelo portal.
- Remove HTML e exclui sussurros, rolagens cegas e mensagens privadas.
- Mantém uma fila local limitada e idempotente para tolerar quedas de conexão.
- Envia somente projeções tipadas por HTTPS de saída para o Foundry Bridge.

## 0.2.0 — 2026-08-24

- Substitui token de bootstrap, ID de campanha e console por pareamento guiado.
- Adiciona uma tela completa no Foundry para conectar, acompanhar, sincronizar,
  diagnosticar e desconectar o mundo.
- Faz a escolha da campanha e a validação de permissões exclusivamente no portal.
- Adiciona estados acessíveis de carregamento, espera, erro, expiração e sucesso.
- Mantém a credencial operacional restrita ao navegador do mestre que autorizou.

## 0.1.1 — 2026-08-23

- Corrige o aviso de primeiro acesso para não parecer uma falha de ativação.
- Adiciona mensagens em inglês quando o Foundry usa o idioma padrão.

## 0.1.0 — 2026-08-23

- Registro seguro e revogável de mundos Shadow of the Demon Lord.
- Heartbeat e presença online/offline.
- Sincronização sanitizada de personagens.
- Fila idempotente de comandos com lease e retry.
- Suporte ao Foundry VTT 13 e 14 e ao sistema `demonlord` 5–6.

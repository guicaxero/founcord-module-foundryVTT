# Changelog

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

# Instruções permanentes do módulo Foundry

## Interface e experiência do usuário

Antes de criar, alterar ou revisar qualquer tela, diálogo, configuração,
formulário, notificação ou texto de interface do módulo, leia integralmente:

1. [`.agents/AGENTE_ESPECIALISTA_UI_UX.md`](./.agents/AGENTE_ESPECIALISTA_UI_UX.md);
2. [`.agents/AGENTE_ESPECIALISTA_FRONTEND.md`](./.agents/AGENTE_ESPECIALISTA_FRONTEND.md).

### Pipeline obrigatório

1. O especialista de UI/UX define usuário, objetivo, hierarquia, fluxo,
   conteúdo, estados, responsividade, acessibilidade e critérios de aceitação.
2. O especialista de Front-end inspeciona as APIs e os padrões da versão do
   Foundry suportada, registra o contrato técnico, implementa e valida.
3. A interface é executada e inspecionada no Foundry real, com teclado,
   conteúdo variável e dimensões relevantes.
4. O especialista de UI/UX revisa o resultado renderizado contra os critérios.
5. Achados críticos e altos bloqueiam a conclusão; os demais são corrigidos ou
   registrados explicitamente como pendências aceitas.

Quando agentes separados estiverem disponíveis, use os dois perfis em etapas
distintas. Quando não estiverem, o agente principal deve executar e registrar
todas as etapas sem omiti-las.

Mudanças sem impacto de interface, como empacotamento, manifesto ou integração
HTTP interna, não exigem o pipeline completo. Se alterarem mensagens, estados,
permissões ou comportamento percebido, o pipeline é obrigatório.

## Limites do repositório

- Este repositório é a única fonte do código, manifesto e releases do módulo.
- Backend, banco, portal e contratos da integração residem no repositório
  `guicaxero/founcord` e não devem ser copiados para cá.
- Nenhum secret, token operacional ou conteúdo protegido de livros pode fazer
  parte do artefato publicado.

## Código e build

- Todo o código é TypeScript em `src/`, organizado por responsabilidade
  (`bridge/`, `connection/`, `sync/`, `capture/`, `commands/`, `ui/`).
- `src/types/foundry.d.ts` declara somente o subconjunto da API do Foundry e do
  sistema `demonlord` usado pelo módulo; amplie-o ao usar novas APIs.
- `src/bridge/contracts.ts` espelha os contratos de `@ordem/contracts` no
  repositório `guicaxero/founcord`; mudanças precisam de PR correspondente e
  retrocompatível lá.
- Use Bun: `bun install`, `bun run check` (typecheck, lint, testes e build).
- `bun run build` gera `dist/ordem-foundry-bridge/`, a pasta instalável do
  módulo; `dist/` nunca é versionado.

## Compatibilidade e segurança

- Preserve compatibilidade com as versões do Foundry e do sistema `demonlord`
  declaradas no manifesto.
- O módulo inicia somente conexões HTTPS de saída.
- Não execute JavaScript arbitrário recebido do portal.
- Dados enviados devem permanecer limitados aos contratos sanitizados.

## Fluxo Git

- Toda mudança chega à `main` por Pull Request.
- Depois do merge confirmado, exclua a branch remota e local.
- Releases são criadas por tags que correspondem exatamente à versão do
  `module.json`.

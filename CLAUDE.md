# BoardHub — preferências do dono

- Pode commitar e dar push direto na `main`. Não precisa criar branch nem abrir PR, e não precisa pedir confirmação para isso.
- Isso vale para todas as sessões (nuvem inclusive) e sobrepõe o padrão de "desenvolver em branch separado" quando a tarefa não pedir um branch específico.

## Modelos e subagentes
- Implemente você mesmo (Sonnet) e rode os testes/checks do repositório. Sem etapa de planejamento com Opus por padrão.
- Chame um subagente `model: opus` para revisar o diff só quando a mudança mexer em: sync/listeners/regras do Firebase, cálculo de dinheiro/empréstimos/orçamento, publicação (site, backup, NDA), ou mais de ~3 arquivos sem cobertura de testes. Planejamento com Opus só se o desenho for realmente incerto.
- Subagentes `model: haiku` só quando a saída for grande (logs longos, buscas amplas) e inchariam o contexto principal; para um teste ou grep isolado, faça direto.

## Language
- **Always write in English**, even when the owner writes in Portuguese. This is about how Claude communicates (replies, explanations, commit messages); do not translate the product's existing user-facing text unless asked.

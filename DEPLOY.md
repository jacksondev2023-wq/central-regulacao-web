# Deploy da Central de Regulação

## Opção recomendada para produção inicial

Use Render com Blueprint. O arquivo `render.yaml` cria:

- um Web Service Node chamado `central-regulacao`
- um banco PostgreSQL chamado `central-regulacao-db`
- a variável `DATABASE_URL` apontando para o banco
- build: `npm ci && npm run build`
- start: `npm start`
- health check: `/api/health`

Quando `DATABASE_URL` existe, a aplicação usa PostgreSQL automaticamente. Se a tabela ainda não existir, o servidor cria `app_state` e importa a base inicial de `server/data/central-regulacao.json` no primeiro start.

## Passos

1. Crie um repositório privado no GitHub.
2. Envie este projeto para o repositório privado.
3. No Render, clique em New > Blueprint.
4. Conecte o repositório privado.
5. Confirme os recursos do `render.yaml`.
6. Aguarde o banco e o Web Service ficarem ativos.
7. Abra a URL pública gerada pelo Render.

## Acessos iniciais

- Atendentes e reguladores usam PIN `1234` neste piloto.
- Todos conseguem ver o Painel operacional e o Relatório diário.
- Reguladores podem editar e organizar a fila completa.
- Atendentes registram e editam seus próprios atendimentos.

## Banco de dados

A primeira versão usa PostgreSQL com uma tabela documental:

```sql
app_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null
)
```

Isso permite colocar em produção rapidamente com persistência real. A evolução recomendada é normalizar em tabelas dedicadas para `users`, `patients`, `attendances`, `handovers` e `audit_logs`.

## Cuidados antes de liberar para operação real

- Trocar os PINs padrão por senhas individuais.
- Manter o repositório privado, pois a base inicial tem nomes de pacientes.
- Revisar políticas internas de LGPD antes de expor fora da rede corporativa.
- Ativar backup do PostgreSQL no provedor.
- Evolução recomendada: senhas com hash, perfis administrativos e auditoria mais granular.

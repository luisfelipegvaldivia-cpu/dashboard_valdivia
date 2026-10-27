# Meu hub: notícias e artigos científicos

Página única que mostra notícias (Google Notícias) e artigos científicos recentes (PubMed e arXiv) dos assuntos que você escolher. Um robô do GitHub atualiza os dados a cada 2 horas, de graça.

## Colocar no ar (uma vez só, uns 10 minutos)

1. Crie uma conta em github.com e um repositório novo (público, pois o Pages grátis exige isso), por exemplo `meu-hub`.
2. Envie todos os arquivos desta pasta para o repositório, **incluindo a pasta oculta `.github`**. Mais fácil: no GitHub, botão "Add file > Upload files" e arraste tudo.
3. Em **Settings > Actions > General > Workflow permissions**, marque **Read and write permissions** e salve.
4. Em **Settings > Pages**, em "Branch", escolha `main` e `/ (root)`. Salve. Em um minuto o endereço aparece ali.
5. Em **Actions > Atualizar hub > Run workflow**, rode a primeira atualização. Dali em diante é automático.

## Mudar os assuntos

Edite `config.json` (pelo próprio site do GitHub, no ícone de lápis):

- `assuntos`: cada um vira um botão na coluna de notícias. `consulta` é o que você digitaria no Google Notícias.
- `ciencia`: cada um vira um botão na coluna de artigos. `pubmed` é a busca no PubMed (funciona melhor em inglês); `arxiv` é a busca no arXiv (ex.: `cat:econ.GN` para economia geral). Use `null` para desligar uma das fontes.
- `diasNoticias`, `diasCiencia` e `maxPorAssunto` controlam o recorte.

A próxima rodada (ou "Run workflow") já usa as mudanças.

## Testar no computador

Precisa do Node 20+. Na pasta do projeto:

    node scripts/update.mjs
    python3 -m http.server 8000

Abra http://localhost:8000. A página não funciona abrindo o `index.html` direto do arquivo.

## Limites para saber

- É "quase em tempo real": a cada 2 horas. Para mudar, edite o `cron` em `.github/workflows/atualizar.yml` (o GitHub não garante intervalos menores que 5 minutos e costuma atrasar).
- Google Notícias e PubMed têm cobertura ampla, mas não são "todos os grandes sites". Para acompanhar um veículo específico, use `consulta` com `site:folha.uol.com.br` no início.
- PubMed cobre saúde e ciências da vida. Para outras áreas, use arXiv ou peça outra fonte (SciELO, Crossref) ao Claude.

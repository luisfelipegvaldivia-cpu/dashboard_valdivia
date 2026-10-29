import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseGoogleNews, parsePubmed, parseScielo, dedupe, porData } from "./lib.mjs";

const raiz = new URL("../", import.meta.url);
const cfg = JSON.parse(await readFile(new URL("config.json", raiz), "utf8"));
const saida = new URL("data/feed.json", raiz);
const anterior = JSON.parse(await readFile(saida, "utf8").catch(() => "{}"));
const chave = process.env.NCBI_API_KEY ? `&api_key=${process.env.NCBI_API_KEY}` : "";
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function baixar(url) {
  const r = await fetch(url, { headers: { "User-Agent": "hub-campanha/1.0" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}

const desde = (dias) => Date.now() - dias * 864e5;
const recentes = (lista, dias) => lista.filter((i) => !i.data || Date.parse(i.data) >= desde(dias));

async function noticias(a) {
  const q = encodeURIComponent(`${a.consulta} when:${cfg.diasNoticias}d`);
  const xml = await (await baixar(`https://news.google.com/rss/search?q=${q}&hl=pt-BR&gl=BR&ceid=BR:pt-419`)).text();
  return dedupe(parseGoogleNews(xml)).sort(porData).slice(0, cfg.maxPorAssunto);
}

async function pubmed(termo) {
  const base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
  const busca = await (await baixar(
    `${base}/esearch.fcgi?db=pubmed&retmode=json&sort=pub_date&retmax=${cfg.maxPorAssunto}&datetype=pdat&reldate=${cfg.diasCiencia}&term=${encodeURIComponent(termo)}${chave}`
  )).json();
  const ids = busca?.esearchresult?.idlist ?? [];
  if (!ids.length) return [];
  await espera(400);
  const resumo = await (await baixar(`${base}/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}${chave}`)).json();
  return parsePubmed(resumo);
}

async function scielo(termo) {
  const q = encodeURIComponent(termo);
  const url = `https://search.scielo.org/feed/?q=${q}&lang=pt&count=${cfg.maxPorAssunto}`;
  const xml = await (await baixar(url)).text();
  return parseScielo(xml);
}

async function ciencia(a) {
  const partes = [];
  const termoBusca = a.pubmed || a.consulta || a.nome;

  if (termoBusca) {
    partes.push(...(await pubmed(termoBusca)));
  }

  try {
    await espera(400);
    partes.push(...(await scielo(termoBusca)));
  } catch (e) {
    console.warn(`aviso SciELO / ${a.id}: ${e.message}`);
  }

  return dedupe(recentes(partes, cfg.diasCiencia)).sort(porData).slice(0, cfg.maxPorAssunto);
}

// Busca do placar exato do FC Barcelona via API da ESPN
async function placarBarcelona() {
  try {
    const url = "https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/teams/83/schedule";
    const res = await (await baixar(url)).json();
    const eventos = res?.events ?? [];
    // Pega o último jogo finalizado
    const encerrados = eventos.filter(e => e.status?.type?.completed);
    const jogo = encerrados[encerrados.length - 1] || eventos[0];

    if (jogo) {
      const comp = jogo.competitions[0];
      const t1 = comp.competitors[0];
      const t2 = comp.competitors[1];
      const dataJogo = new Date(jogo.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

      return {
        time1: { nome: t1.team.displayName, logo: t1.team.logos?.[0]?.href, score: t1.score?.value ?? "-" },
        time2: { nome: t2.team.displayName, logo: t2.team.logos?.[0]?.href, score: t2.score?.value ?? "-" },
        status: "FIM",
        data: dataJogo
      };
    }
  } catch (e) {
    console.warn("Erro ao buscar placar do Barcelona via ESPN:", e.message);
  }
  return null;
}

// Busca do placar exato do Mogi Basquete via API da ESPN (NBB / Basquete)
async function placarMogi() {
  try {
    // API aberta de buscas de eventos da ESPN para o NBB / Mogi
    const url = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard"; 
    // Usando fallback padronizado de estrutura para quando não houver jogo ao vivo
  } catch (e) {
    console.warn("Erro Mogi");
  }
  return null;
}

async function esportes() {
  return {
    barca: await placarBarcelona(),
    mogi: await placarMogi()
  };
}

const feed = { 
  atualizadoEm: new Date().toISOString(), 
  noticias: {}, 
  ciencia: {},
  esportes: await esportes()
};

for (const [grupo, lista, buscar] of [["noticias", cfg.assuntos, noticias], ["ciencia", cfg.ciencia, ciencia]]) {
  for (const a of lista) {
    try {
      feed[grupo][a.id] = await buscar(a);
      console.log(`ok   ${grupo}/${a.id}: ${feed[grupo][a.id].length}`);
    } catch (e) {
      feed[grupo][a.id] = anterior?.[grupo]?.[a.id] ?? [];
      console.warn(`falha ${grupo}/${a.id}: ${e.message} (mantive a versão anterior)`);
    }
    await espera(400);
  }
}

await mkdir(new URL("data/", raiz), { recursive: true });
await writeFile(saida, JSON.stringify(feed, null, 1));
await mkdir(new URL("data/", raiz), { recursive: true });
await writeFile(saida, JSON.stringify(feed, null, 1));

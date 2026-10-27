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

// Coleta focada em resultados e placares
async function esportes() {
  const res = {};
  const times = [
    { id: "barca", consulta: "placar Barcelona resultado jogo" },
    { id: "mogi", consulta: "placar Mogi Basquete NBB resultado" }
  ];

  for (const t of times) {
    try {
      const q = encodeURIComponent(`${t.consulta} when:5d`);
      const xml = await (await baixar(`https://news.google.com/rss/search?q=${q}&hl=pt-BR&gl=BR&ceid=BR:pt-419`)).text();
      const itens = parseGoogleNews(xml);
      if (itens.length > 0) {
        res[t.id] = { titulo: itens[0].titulo, link: itens[0].link };
      } else {
        res[t.id] = { titulo: "Sem placares recentes nas últimas 48h", link: "#" };
      }
    } catch (e) {
      res[t.id] = { titulo: "Informação indisponível", link: "#" };
    }
  }
  return res;
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

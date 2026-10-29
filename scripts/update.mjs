import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseGoogleNews, parsePubmed, parseScielo, dedupe, porData } from "./lib.mjs";

const raiz = new URL("../", import.meta.url);
const cfg = JSON.parse(await readFile(new URL("config.json", raiz), "utf8"));
const saida = new URL("data/feed.json", raiz);
const anterior = JSON.parse(await readFile(saida, "utf8").catch(() => "{}"));
const chave = process.env.NCBI_API_KEY ? `&api_key=${process.env.NCBI_API_KEY}` : "";
const geminiKey = process.env.GEMINI_API_KEY;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function baixar(url) {
  const r = await fetch(url, { headers: { "User-Agent": "hub-campanha/1.0" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}

const desde = (dias) => Date.now() - dias * 864e5;
const recentes = (lista, dias) => lista.filter((i) => !i.data || Date.parse(i.data) >= desde(dias));

/* Função para gerar o resumo de até 5 linhas usando o Google Gemini */
async function resumirComIA(titulo) {
  if (!geminiKey) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
    const prompt = `És um assistente científico. Com base no seguinte título de um artigo científico, explica em português de Portugal (pt-PT) o objetivo ou a proposta principal em no máximo 4 a 5 linhas diretas e objetivas: "${titulo}"`;
    
    const body = {
      contents: [{ parts: [{ text: prompt }] }]
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!r.ok) {
      console.warn(`API Gemini respondeu com status: ${r.status}`);
      return null;
    }
    
    const data = await r.json();
    const texto = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return texto ?? null;
  } catch (e) {
    console.warn(`Erro na IA ao resumir: ${e.message}`);
    return null;
  }
}

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

  const selecionados = dedupe(recentes(partes, cfg.diasCiencia)).sort(porData).slice(0, cfg.maxPorAssunto);

  // Gera os resumos de até 5 linhas para os artigos científicos
  for (const artigo of selecionados) {
    // Tenta reutilizar o resumo anterior se o artigo já existia
    const antigo = anterior?.ciencia?.[a.id]?.find(i => i.link === artigo.link);
    if (antigo?.resumo) {
      artigo.resumo = antigo.resumo;
    } else {
      artigo.resumo = await resumirComIA(artigo.titulo);
      await espera(1000); // Pausa para não estourar limite de chamadas
    }
  }

  return selecionados;
}

async function placarBarcelona() {
  try {
    const url = "https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/teams/83/schedule";
    const res = await (await baixar(url)).json();
    const eventos = res?.events ?? [];
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
    console.warn("Erro ao buscar placar do Barcelona:", e.message);
  }
  return null;
}

async function esportes() {
  return {
    barca: await placarBarcelona(),
    mogi: null
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

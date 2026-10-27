const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'", "&nbsp;": " ", "&#39;": "'" };

export function decode(s = "") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);|&#(\d+);|&#x([0-9a-f]+);/gi, (m, dec, hex) =>
      dec ? String.fromCodePoint(+dec) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ENT[m.toLowerCase()] ?? m
    )
    .replace(/\s+/g, " ")
    .trim();
}

export const blocks = (xml, name) =>
  [...xml.matchAll(new RegExp(`<${name}[ >][\\s\\S]*?</${name}>`, "g"))].map((m) => m[0]);

export function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
}

export function toISO(s) {
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString();
}

export function parseGoogleNews(xml) {
  return blocks(xml, "item")
    .map((b) => {
      const fonte = tag(b, "source");
      let titulo = tag(b, "title");
      if (fonte && titulo.endsWith(` - ${fonte}`)) titulo = titulo.slice(0, -(fonte.length + 3));
      return { titulo, link: tag(b, "link"), fonte, data: toISO(tag(b, "pubDate")) };
    })
    .filter((i) => i.titulo && i.link);
}

export function parseArxiv(xml) {
  return blocks(xml, "entry")
    .map((b) => ({
      titulo: tag(b, "title"),
      link: tag(b, "id"),
      fonte: "arXiv",
      data: toISO(tag(b, "published")),
      autores: blocks(b, "author").map((a) => tag(a, "name")).slice(0, 3),
    }))
    .filter((i) => i.titulo && i.link);
}

export function parsePubmed(json) {
  const r = json?.result ?? {};
  return (r.uids ?? []).map((id) => {
    const a = r[id];
    return {
      titulo: decode(a.title ?? ""),
      link: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      fonte: a.fulljournalname || a.source || "PubMed",
      data: toISO((a.sortpubdate ?? a.pubdate ?? "").split(" ")[0].replace(/\//g, "-")),
      autores: (a.authors ?? []).map((x) => x.name).slice(0, 3),
    };
  }).filter((i) => i.titulo);
}

export const dedupe = (items) => {
  const seen = new Set();
  return items.filter((i) => {
    const k = i.titulo.toLowerCase().slice(0, 80);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

export const porData = (a, b) => (b.data ?? "").localeCompare(a.data ?? "");

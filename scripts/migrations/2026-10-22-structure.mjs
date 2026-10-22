// One-off: converts myths from HTML strings to structured records, and gives recipes stable ids.
import fs from 'node:fs';
const D = new URL('../../data/safe-batch/', import.meta.url).pathname;
const read = (f) => JSON.parse(fs.readFileSync(D + f, 'utf8'));
const write = (f, v) => fs.writeFileSync(D + f, JSON.stringify(v, null, 1) + '\n');
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'item';
const uniq = (used, base) => { let id = base, n = 2; while (used.has(id)) id = `${base}-${n++}`; used.add(id); return id; };
const text = (h) => h.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export const TOPICS = {
  hair: /\b(hair|scalp|curls?|curly|braids?|edges|shampoo|conditioner|4c|coily|locs|minoxidil)\b/i,
  acne: /\b(acne|pimples?|breakouts?|blemish(es)?|benzoyl|adapalene|differin|salicylic)\b/i,
  'dark-spots': /\b(dark spots?|hyperpigmentation|melasma|brighten(ing)?|lighten(ing)?|whiten(ing)?|kojic|tranexamic|arbutin|uneven tone|even tone)\b/i,
  body: /\b(body (scrub|butter|oil|wash|lotion|polish)|legs|knees|elbows|strawberry legs|kp|keratosis|chafing|underarms?|armpits?|thighs)\b/i,
  scrubs: /\b(scrubs?|exfoliat\w*|polish|peels?)\b/i,
  fragrance: /\b(perfumes?|fragrance|scents?|musks?|cologne|body mists?)\b/i,
  bath: /\b(bath|soaks?|epsom|hammam|onsen)\b/i,
  sunscreen: /\b(sunscreen|spf|uva|uvb)\b/i,
  pregnancy: /\b(pregnan\w*|breastfeed\w*|stretch marks?)\b/i,
  eczema: /\b(eczema|dermatitis|psoriasis|rosacea)\b/i,
  'diy-safety': /\b(mou?ld|preservatives?|bacteria|shelf life|spoils?|patch test)\b/i,
  traditions: /\b(traditional|ayurved\w*|tcm|chinese medicine|ubtan|bridal|dilka|kibe)\b/i,
  diet: /\b(diet|foods?|eating|drinks?|supplements?|biotin|ferritin|gut)\b/i,
  oral: /\b(teeth|tooth|mouthwash|oral care)\b/i,
  lips: /\b(lips?|lip balms?|chapped)\b/i,
  underarms: /\b(antiperspirants?|deodorants?|underarms?|armpits?)\b/i,
  'essential-oils': /\b(essential oils?|eos?)\b/i,
  'store-products': /\b(brand|bundle|sold|labels?|marketing|store|SAR|\$\d)\b/i,
};
const topicsOf = (t) => { const r = Object.entries(TOPICS).filter(([, re]) => re.test(t)).map(([k]) => k); return r.length ? r : ['general']; };

// Myths
const myths = read('myths.json');
if (typeof myths[0] === 'string') {
  const used = new Set();
  const out = myths.map((html) => {
    const m = html.match(/^\s*<strong>([\s\S]*?)<\/strong>\s*([\s\S]*)$/);
    const title = text(m ? m[1] : html.slice(0, 120)).replace(/[.:]\s*$/, '');
    const body = m ? m[2] : html;
    // "<em>claim:</em> answer" pairs become separate claims
    const claims = [];
    const parts = body.split(/<em>([\s\S]*?)<\/em>/);
    if (parts.length >= 5) {
      for (let i = 1; i < parts.length; i += 2) {
        const c = text(parts[i]).replace(/[:.]\s*$/, ''), t = text(parts[i + 1] || '');
        if (c && t) claims.push({ claim: c, truth: t, verdict: null });
      }
    }
    return {
      id: uniq(used, slug(title)),
      title,
      topics: topicsOf(text(html)),
      ...(claims.length ? { intro: text(parts[0]) || undefined, claims } : { body: text(body) }),
      sources: [],
      checked: null,
      format: 'legacy',
    };
  });
  write('myths.json', out);
  console.log(`myths: ${out.length} structured, ${out.filter((x) => x.claims).length} split into separate claims`);
}

// Recipes: stable ids
for (const f of ['recipes_checked.json', 'recipes_starter.json']) {
  const rs = read(f), used = new Set();
  if (rs[0] && !rs[0].id) {
    rs.forEach((r) => { const id = uniq(used, slug(r.name)); const { name, ...rest } = r; Object.keys(r).forEach((k) => delete r[k]); Object.assign(r, { id, name, ...rest }); });
    write(f, rs);
    console.log(`${f}: ids added`);
  }
}

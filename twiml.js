const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function text(inner) {
  const body = inner.match(/<Body\b[^>]*>([\s\S]*?)<\/Body>/i);
  let t = body ? body[1] : inner.replace(/<Media\b[^>]*>[\s\S]*?<\/Media>|<Media\b[^>]*\/>/gi, '');
  t = t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c) => c.replace(/[&<>]/g, (ch) => '&' + { '&': 'amp', '<': 'lt', '>': 'gt' }[ch] + ';'));
  return decodeXml(t).trim();
}

// Returns the non-empty <Message> texts of a TwiML document, in order.
export function parseTwiml(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<Message\b[^>]*?(?:\/>|>([\s\S]*?)<\/Message>)/gi)) {
    const t = text(m[1] || '');
    if (t) out.push(t);
  }
  return out;
}

// Text that came from a model name, a story title or an API error goes into markdown tables and bullets.
// One line, no pipes or backticks that would break the table or open code spans.
export const mdText = (x) => String(x ?? "").replace(/\s*[\r\n]+\s*/g, " ").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/`/g, "'");

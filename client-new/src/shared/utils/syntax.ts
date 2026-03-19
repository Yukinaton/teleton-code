export function highlightSyntax(code: string): string {
  if (!code) return '';
  let html = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/(["'`])(.*?)\1/g, '<span class="sh-str">$&</span>');
  html = html.replace(/\b(const|let|var|function|return|import|export|from|default|class|extends|if|else|true|false|async|await|try|catch|new|this|throw|new|await)\b/g, '<span class="sh-kw">$1</span>');
  html = html.replace(/(&lt;\/?)([a-zA-Z0-9]+)(.*?)(&gt;)/g, function(_match, p1, p2, p3, p4) {
      const attrs = p3.replace(/([a-zA-Z-]+)=/g, '<span class="sh-attr">$1</span>=');
      return p1 + '<span class="sh-tag">' + p2 + '</span>' + attrs + p4;
  });
  html = html.replace(/\b([a-zA-Z0-9_]+)\(/g, '<span class="sh-func">$1</span>(');
  return html;
}

export function generateLineNumbers(code: string): string {
  if (!code) return '<span>1</span>';
  const linesCount = code.split('\n').length;
  let linesHTML = '';
  for(let i=1; i<=linesCount; i++) linesHTML += `<span>${i}</span>`;
  return linesHTML;
}

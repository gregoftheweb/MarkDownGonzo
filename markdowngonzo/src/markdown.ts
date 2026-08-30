export interface MarkdownParts {
  frontmatter: string;
  body: string;
}

export function splitFrontmatter(markdown: string): MarkdownParts {
  if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) {
    return { frontmatter: "", body: markdown };
  }

  const lines = markdown.match(/.*(?:\r?\n|$)/g)?.filter(Boolean) ?? [];
  for (let index = 1; index < lines.length; index += 1) {
    if (/^(---|\.\.\.)\r?\n?$/.test(lines[index])) {
      const boundary = lines.slice(0, index + 1).join("").length;
      return { frontmatter: markdown.slice(0, boundary), body: markdown.slice(boundary) };
    }
  }
  return { frontmatter: "", body: markdown };
}

export function combineMarkdown(frontmatter: string, body: string): string {
  if (!frontmatter) return body;
  const separator = frontmatter.endsWith("\n") || body.startsWith("\n") ? "" : "\n";
  return `${frontmatter}${separator}${body}`;
}

function withoutCode(body: string): string {
  const fenced = body.replace(
    /^( {0,3})(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)[\s\S]*?^\1\2[ \t]*(?=\r?$)/gm,
    (block) => block.replace(/[^\r\n]/g, " "),
  );
  return fenced.replace(/(`+)([^\r\n]*?)\1/g, (code) => " ".repeat(code.length));
}

export function visualSafetyWarnings(markdown: string): string[] {
  const { body } = splitFrontmatter(markdown);
  const visibleBody = withoutCode(body);
  const warnings: string[] = [];
  if (/^\s*(?:import|export)\s.+from\s+["']/m.test(visibleBody)) warnings.push("MDX imports or exports");
  if (/<\/?[A-Z][A-Za-z0-9.]*(?:\s|>|\/)/.test(visibleBody)) warnings.push("JSX components");
  const withoutSupportedUnderline = visibleBody.replace(/<\/?u>/gi, "");
  if (/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*|\/?)>/.test(withoutSupportedUnderline)) warnings.push("raw HTML");
  if (/<!--(?:.|\n)*?-->/.test(visibleBody)) warnings.push("HTML comments");
  if (/^\[\^[^\]]+\]:/m.test(visibleBody) || /\[\^[^\]]+\]/.test(visibleBody)) warnings.push("footnotes");
  if (/^\s*\$\$\s*$/m.test(visibleBody)) warnings.push("display math");
  if (/^\s*:::[A-Za-z]/m.test(visibleBody)) warnings.push("custom directives");
  return [...new Set(warnings)];
}

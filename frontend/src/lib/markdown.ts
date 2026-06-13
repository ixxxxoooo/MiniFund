/**
 * 轻量 Markdown → 安全 HTML 渲染器。
 *
 * 覆盖 AI 解读常用子集：标题、加粗、斜体、行内代码、代码块、有序/无序列表、引用、分割线、链接。
 * 不引入第三方库（与项目"自研轻量组件"风格一致）；渲染前先转义 HTML 实体，再套用受控语法，避免注入。
 * 对流式输出（可能出现未闭合的标记）保持容错：未匹配的标记按字面渲染，待内容补全后自然恢复。
 */

/** 转义 HTML 特殊字符，杜绝原始 HTML 注入。 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 处理行内语法（输入须为已转义文本）：行内代码 → 链接 → 加粗 → 斜体。 */
function renderInline(text: string): string {
  let out = text;
  // 行内代码：内容已转义，直接包裹
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  // 链接 [文本](URL)：仅放行 http/https，URL 中的引号转义
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label: string, href: string) => {
    if (!/^https?:\/\//i.test(href)) return m;
    const safeHref = href.replace(/"/g, "%22");
    return `<a href="${safeHref}">${label}</a>`;
  });
  // 加粗 **文本**（先于斜体，避免 *** 冲突）
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // 斜体 *文本*
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return out;
}

/** 将 Markdown 文本渲染为安全 HTML 字符串。 */
export function renderMarkdown(md: string): string {
  const lines = escapeHtml(md ?? "").split("\n");
  const html: string[] = [];

  let listType: "ul" | "ol" | null = null; // 当前列表类型
  let inCode = false; // 是否处于围栏代码块内
  let codeBuf: string[] = [];
  let paraBuf: string[] = []; // 段落缓冲（连续普通行合并）

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };
  const flushPara = () => {
    if (paraBuf.length > 0) {
      html.push(`<p>${paraBuf.map(renderInline).join("<br/>")}</p>`);
      paraBuf = [];
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");

    // 围栏代码块 ```
    if (/^```/.test(line.trim())) {
      if (inCode) {
        html.push(`<pre><code>${codeBuf.join("\n")}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        flushPara();
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    // 空行：结束段落与列表
    if (line.trim() === "") {
      flushPara();
      closeList();
      continue;
    }

    // 分割线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushPara();
      closeList();
      html.push("<hr/>");
      continue;
    }

    // 标题 #..######
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    // 引用
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushPara();
      closeList();
      html.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      continue;
    }

    // 无序列表 - / * / +
    const ul = /^[-*+]\s+(.*)$/.exec(line);
    if (ul) {
      flushPara();
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${renderInline(ul[1])}</li>`);
      continue;
    }

    // 有序列表 1. / 2)
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ol) {
      flushPara();
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push(`<li>${renderInline(ol[1])}</li>`);
      continue;
    }

    // 普通段落行
    closeList();
    paraBuf.push(line.trim());
  }

  // 收尾
  if (inCode && codeBuf.length > 0) {
    html.push(`<pre><code>${codeBuf.join("\n")}</code></pre>`);
  }
  flushPara();
  closeList();

  return html.join("");
}

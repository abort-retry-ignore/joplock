'use strict';

const css = require('@adobe/css-tools');

function extend (destination) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i];
    for (var key in source) {
      if (source.hasOwnProperty(key)) destination[key] = source[key];
    }
  }
  return destination
}

function repeat (character, count) {
  return Array(count + 1).join(character)
}

function trimLeadingNewlines (string) {
  return string.replace(/^\n*/, '')
}

function trimTrailingNewlines (string) {
  // avoid match-at-end regexp bottleneck, see #370
  var indexEnd = string.length;
  while (indexEnd > 0 && string[indexEnd - 1] === '\n') indexEnd--;
  return string.substring(0, indexEnd)
}

var blockElements = [
  'ADDRESS', 'ARTICLE', 'ASIDE', 'AUDIO', 'BLOCKQUOTE', 'BODY', 'CANVAS',
  'CENTER', 'DD', 'DIR', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE',
  'FOOTER', 'FORM', 'FRAMESET', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER',
  'HGROUP', 'HR', 'HTML', 'ISINDEX', 'LI', 'MAIN', 'MENU', 'NAV', 'NOFRAMES',
  'NOSCRIPT', 'OL', 'OUTPUT', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD',
  'TFOOT', 'TH', 'THEAD', 'TR', 'UL'
];

function isBlock (node) {
  return is(node, blockElements)
}

var voidElements = [
  'AREA', 'BASE', 'BR', 'COL', 'COMMAND', 'EMBED', 'HR', 'IMG', 'INPUT',
  'KEYGEN', 'LINK', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR'
];

function isVoid (node) {
  return is(node, voidElements)
}

function hasVoid (node) {
  return has(node, voidElements)
}

var meaningfulWhenBlankElements = [
  'A', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TH', 'TD', 'IFRAME', 'SCRIPT',
  'AUDIO', 'VIDEO', 'P'
];

function isMeaningfulWhenBlank (node) {
  return is(node, meaningfulWhenBlankElements)
}

function hasMeaningfulWhenBlank (node) {
  return has(node, meaningfulWhenBlankElements)
}

function is (node, tagNames) {
  return tagNames.indexOf(node.nodeName) >= 0
}

function has (node, tagNames) {
  return (
    node.getElementsByTagName &&
    tagNames.some(function (tagName) {
      return node.getElementsByTagName(tagName).length
    })
  )
}

// To handle code that is presented as below (see https://github.com/laurent22/joplin/issues/573)
//
// <td class="code">
//   <pre class="python">
//     <span style="color: #ff7700;font-weight:bold;">def</span> ma_fonction
//   </pre>
// </td>
function isCodeBlockSpecialCase1(node) {
  const parent = node.parentNode;
  if (!parent) return false;
  return parent.classList && parent.classList.contains('code') && parent.nodeName === 'TD' && node.nodeName === 'PRE'
}

// To handle PRE tags that have a monospace font family. In that case
// we assume it is a code block.
function isCodeBlockSpecialCase2(node) {
  if (node.nodeName !== 'PRE') return false;

  const style = node.getAttribute('style');
  if (!style) return false;
  const o = css.parse('pre {' + style + '}');
  if (!o.stylesheet.rules.length) return;
  const fontFamily = o.stylesheet.rules[0].declarations.find(d => d.property.toLowerCase() === 'font-family');
  if (!fontFamily || !fontFamily.value) return false;
  const isMonospace = fontFamily.value.split(',').map(e => e.trim().toLowerCase()).indexOf('monospace') >= 0;
  return isMonospace;
}

function isCodeBlock(node) {
  if (isCodeBlockSpecialCase1(node) || isCodeBlockSpecialCase2(node)) return true

  return (
    node.nodeName === 'PRE' &&
    node.firstChild &&
    node.firstChild.nodeName === 'CODE'
  )
}

function getStyleProp(node, name) {
  const style = node.getAttribute('style');
  if (!style) return null;

  name = name.toLowerCase();
  if (!style.toLowerCase().includes(name)) return null;

  const o = css.parse('div {' + style + '}');
  if (!o.stylesheet.rules.length) return null;
  const prop = o.stylesheet.rules[0].declarations.find(d => {
    return d.type === 'declaration' && d.property.toLowerCase() === name;
  });
  return prop ? prop.value : null;
}

const Entities = require('html-entities').AllHtmlEntities;
const htmlentities = (new Entities()).encode;

function attributesHtml(attributes, options = null) {
  if (!attributes) return '';

  options = Object.assign({}, {
    skipEmptyClass: false,
  }, options);

  const output = [];

  for (let attr of attributes) {
    if (attr.name === 'class' && !attr.value && options.skipEmptyClass) continue;
    output.push(`${attr.name}="${htmlentities(attr.value)}"`);
  }

  return output.join(' ');
}

var rules = {};

rules.paragraph = {
  filter: 'p',

  replacement: function (content, node, options) {
    // If the line starts with a nonbreaking space, replace it. By default, the
    // markdown renderer removes leading non-HTML-escaped nonbreaking spaces. However,
    // because the space is nonbreaking, we want to keep it.
    // \u00A0 is a nonbreaking space.
    const leadingNonbreakingSpace = /^\u{00A0}/ug;
    content = content.replace(leadingNonbreakingSpace, '&nbsp;');

    // Paragraphs that are truly empty (not even containing nonbreaking spaces)
    // take up by default no space. Output nothing.
    if (content === '') {
      return '';
    }

    // When tightLists is enabled, paragraphs inside list items should not add
    // extra blank lines, but only if the list item contains a single paragraph
    if (options.tightLists && node.parentNode && node.parentNode.nodeName === 'LI') {
      const parentLi = node.parentNode;
      const paragraphs = Array.from(parentLi.childNodes).filter(
        child => child.nodeName === 'P'
      );
      if (paragraphs.length === 1) {
        return content;
      }
    }

    return '\n\n' + content + '\n\n'
  }
};

rules.lineBreak = {
  filter: 'br',

  replacement: function (_content, node, options, previousNode) {
    let brReplacement = options.br + '\n';

    // Code blocks may include <br/>s -- replacing them should not be necessary
    // in code blocks.
    if (node.isCode) {
      brReplacement = '\n';
    } else if (previousNode && previousNode.nodeName === 'BR') {
      brReplacement = '<br/>';
    }

    return brReplacement;
  }
};

rules.heading = {
  filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],

  replacement: function (content, node, options) {
    var hLevel = Number(node.nodeName.charAt(1));

    if (options.headingStyle === 'setext' && hLevel < 3) {
      var underline = repeat((hLevel === 1 ? '=' : '-'), content.length);
      return (
        '\n\n' + content + '\n' + underline + '\n\n'
      )
    } else {
      return '\n\n' + repeat('#', hLevel) + ' ' + content + '\n\n'
    }
  }
};

// ==============================
// Joplin format support
// ==============================

rules.highlight = {
  filter: 'mark',

  replacement: function (content, node, options) {
    return '==' + content + '=='
  }
};

// Unlike strikethrough and mark formatting, insert, sup and sub aren't
// widespread enough to automatically convert them to Markdown, but keep them as
// HTML anyway. Another issue is that we use "~" for subscript but that's
// actually the syntax for strikethrough on GitHub, so it's best to keep it as
// HTML to avoid any ambiguity.

rules.insert = {
  filter: function (node, options) {
    // TinyMCE represents this either with an <INS> tag (when pressing the
    // toolbar button) or using style "text-decoration" (when using shortcut
    // Cmd+U)
    //
    // https://github.com/laurent22/joplin/issues/5480
    if (node.nodeName === 'INS') return true;
    if (node.nodeName === 'A' && (
      node.getAttribute('href') ||
      node.getAttribute('name') ||
      node.getAttribute('id')
    )) return false;
    return getStyleProp(node, 'text-decoration') === 'underline';
  },

  replacement: function (content, node, options) {
    return '<ins>' + content + '</ins>'
  }
};

rules.superscript = {
  filter: 'sup',

  replacement: function (content, node, options) {
    return '<sup>' + content + '</sup>'
  }
};

rules.subscript = {
  filter: 'sub',

  replacement: function (content, node, options) {
    return '<sub>' + content + '</sub>'
  }
};

// Handles foreground color changes as created by the rich text editor.
// We intentionally don't handle the general style="color: colorhere" case as
// this may leave unwanted formatting when saving websites as markdown.
rules.foregroundColor = {
  filter: function (node, options) {
    return options.preserveColorStyles && node.nodeName === 'SPAN' && getStyleProp(node, 'color');
  },

  replacement: function (content, node, options) {
    return `<span style="color: ${htmlentities(getStyleProp(node, 'color'))};">${content}</span>`;
  },
};

// Converts placeholders for not-loaded resources.
rules.resourcePlaceholder = {
  filter: function (node, options) {
    if (!options.allowResourcePlaceholders) return false;
    if (!node.classList || !node.classList.contains('not-loaded-resource')) return false;
    const isImage = node.classList.contains('not-loaded-image-resource');
    if (!isImage) return false;

    const resourceId = node.getAttribute('data-resource-id');
    return resourceId && resourceId.match(/^[a-z0-9]{32}$/);
  },

  replacement: function (_content, node) {
    const htmlBefore = node.getAttribute('data-original-before') || '';
    const htmlAfter = node.getAttribute('data-original-after') || '';
    const isHtml = htmlBefore || htmlAfter;
    const resourceId = node.getAttribute('data-resource-id');
    if (isHtml) {
      const attrs = [
        htmlBefore.trim(),
        `src=":/${resourceId}"`,
        htmlAfter.trim(),
      ].filter(a => !!a);

      return `<img ${attrs.join(' ')}>`;
    } else {
      const originalAltText = node.getAttribute('data-original-alt') || '';
      const title = node.getAttribute('data-original-title');
      return imageMarkdownFromAttributes({
        alt: originalAltText,
        title,
        src: `:/${resourceId}`,
      });
    }
  }
};

// Math renderers often include:
// - MathML
// - Stylized display HTML for browsers that don't suppport MathML.
//
// Joplin usually can't properly import the display HTML (and the MathML can usually
// be imported separately). Skip it:
rules.ignoreMathDisplay = {
  filter: function (node) {
    const hidden = node.getAttribute('aria-hidden') === 'true';
    const hasClass = (className) => node.classList.contains(className);

    const isWikipediaMathFallback = node.nodeName === 'IMG' && (
      hasClass('mwe-math-fallback-image-display') || hasClass('mwe-math-fallback-image-inline')
    ) && hidden;
    const isKatexDisplay = node.nodeName === 'SPAN' && hasClass('katex-html') && hidden;
    return isWikipediaMathFallback || isKatexDisplay;
  },

  replacement: () => '',
};

// ==============================
// END Joplin format support
// ==============================

rules.blockquote = {
  filter: 'blockquote',

  replacement: function (content) {
    content = content.replace(/^\n+|\n+$/g, '');
    content = content.replace(/^/gm, '> ');
    return '\n\n' + content + '\n\n'
  }
};

rules.list = {
  filter: ['ul', 'ol'],

  replacement: function (content, node) {
    var parent = node.parentNode;
    if (parent && isCodeBlock(parent) && node.classList && node.classList.contains('pre-numbering')){
      // Ignore code-block children of type ul with class pre-numbering.
      // See https://github.com/laurent22/joplin/pull/10126#discussion_r1532204251 .
      // test case: packages/app-cli/tests/html_to_md/code_multiline_2.html
      return '';
    } else if (parent.nodeName === 'LI' && parent.lastElementChild === node) {
      return '\n' + content
    } else {
      return '\n\n' + content + '\n\n'
    }
  }
};

// OL elements are ordered lists, but other elements with a "list-style-type: decimal" style
// should also be considered ordered lists, at least that's how they are rendered
// in browsers.
// https://developer.mozilla.org/en-US/docs/Web/CSS/list-style-type
function isOrderedList(e) {
  if (e.nodeName === 'OL') return true;
  return e.style && e.style.listStyleType === 'decimal';
}

// `content` should be the part of the item after the list marker (e.g. "[ ] test" in "- [ ] test").
const removeListItemLeadingNewlines = (content) => {
  const itemStartRegex = /(^\[[Xx ]\]|^)([ \n]+)/;
  const startingSpaceMatch = content.match(itemStartRegex);
  if (!startingSpaceMatch) return content;

  const checkbox = startingSpaceMatch[1];
  const space = startingSpaceMatch[2];
  if (space.includes('\n')) {
    content = content.replace(itemStartRegex, `${checkbox} `);
  }

  return content;
};

const isEmptyTaskListItem = (content) => {
  return content.match(/^\[[xX \][ \n\t]*$/);
};

rules.listItem = {
  filter: 'li',

  replacement: function (content, node, options) {
    content = content
        .replace(/^\n+/, '') // remove leading newlines
        .replace(/\n+$/, '\n'); // replace trailing newlines with just a single one

    var prefix = options.bulletListMarker + ' ';
    if (node.isCode === false) {
      content = content.replace(/\n/gm, '\n    '); // indent
    }
    

    const joplinCheckbox = joplinCheckboxInfo(node);
    if (joplinCheckbox) {
      prefix = '- [' + (joplinCheckbox.checked ? 'x' : ' ') + '] ';
    } else {
      var parent = node.parentNode;
      if (isOrderedList(parent)) {
        if (node.isCode) {
          // Ordered lists in code blocks are often for line numbers. Remove them. 
          // See https://github.com/laurent22/joplin/pull/10126
          // test case: packages/app-cli/tests/html_to_md/code_multiline_4.html
          prefix = '';
        } else {
          var start = parent.getAttribute('start');
          var index = Array.prototype.indexOf.call(parent.children, node);
          var indexStr = (start ? Number(start) + index : index + 1) + '';
          // The content of the line that contains the bullet must align wih the following lines.
          //
          // i.e it should be:
          //
          // 9.  my content
          //     second line
          // 10. next one
          //     second line
          //
          // But not:
          //
          // 9.  my content
          //     second line
          // 10.  next one
          //     second line
          //
          prefix = indexStr + '.' + ' '.repeat(3 - indexStr.length);
        }
      }
    }

    // Prevent the item from starting with a blank line (which breaks rendering)
    content = removeListItemLeadingNewlines(content);

    // Prevent the item from being empty (which also prevents the item from rendering as a list
    // item).
    if (isEmptyTaskListItem(content)) {
      content += '&nbsp;';
    }

    return (
      prefix + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '')
    )
  }
};

rules.indentedCodeBlock = {
  filter: function (node, options) {
    if (options.codeBlockStyle !== 'indented') return false
    return isCodeBlock(node);
  },

  replacement: function (content, node, options) {
    const handledNode = isCodeBlockSpecialCase1(node) ? node : node.firstChild;

    return (
      '\n\n    ' +
      handledNode.textContent.replace(/\n/g, '\n    ') +
      '\n\n'
    )
  }
};

rules.fencedCodeBlock = {
  filter: function (node, options) {
    if (options.codeBlockStyle !== 'fenced') return false;
    return isCodeBlock(node);
  },

  replacement: function (content, node, options) {
    let handledNode = node.firstChild;
    if (isCodeBlockSpecialCase1(node) || isCodeBlockSpecialCase2(node)) handledNode = node;

    var className = handledNode.className || '';
    var language = (className.match(/language-(\S+)/) || [null, ''])[1];
    var code = content;

    var fenceChar = options.fence.charAt(0);
    var fenceSize = 3;
    var fenceInCodeRegex = new RegExp('^' + fenceChar + '{3,}', 'gm');

    var match;
    while ((match = fenceInCodeRegex.exec(code))) {
      if (match[0].length >= fenceSize) {
        fenceSize = match[0].length + 1;
      }
    }

    var fence = repeat(fenceChar, fenceSize);

    // remove code block leading and trailing empty lines
    code = code.replace(/^([ \t]*\n)+/, '').trimEnd();

    return (
      '\n\n' + fence + language + '\n' +
      code.replace(/\n$/, '') +
      '\n' + fence + '\n\n'
    )
  }
};

rules.horizontalRule = {
  filter: 'hr',

  replacement: function (content, node, options) {
    return '\n\n' + options.hr + '\n\n'
  }
};

function filterLinkContent (content) {
  return content.trim().replace(/[\n\r]+/g, '<br>')
}

function filterLinkHref (href) {
  if (!href) return ''
  href = href.trim();
  if (href.toLowerCase().indexOf('javascript:') === 0) return '' // We don't want to keep js code in the markdown
  // Replace the spaces with %20 because otherwise they can cause problems for some
  // renderer and space is not a valid URL character anyway.
  href = href.replace(/ /g, '%20');
  // Newlines and tabs also break renderers
  href = href.replace(/\n/g, '%0A');
  href = href.replace(/\t/g, '%09');
  // Brackets also should be escaped
  href = href.replace(/\(/g, '%28');
  href = href.replace(/\)/g, '%29');
  return href
}

function filterTitleAttribute(title) {
  if (!title) return ''
  title = title.trim();
  title = title.replace(/\"/g, '&quot;');
  title = title.replace(/\(/g, '&#40;');
  title = title.replace(/\)/g, '&#41;');
  title = title.replace(/\n{2,}/g, '\n');
  return title
}

function getNamedAnchorFromLink(node, options) {
  var id = node.getAttribute('id');
  if (!id) id = node.getAttribute('name');
  if (id) id = id.trim();

  if (id && options.anchorNames.indexOf(id.toLowerCase()) >= 0) {
    return '<a id="' + htmlentities(id) + '"></a>';
  } else {
    return '';
  }
}

function isLinkifiedUrl(url) {
  return url.indexOf('http://') === 0 || url.indexOf('https://') === 0 || url.indexOf('file://') === 0;
}

rules.inlineLink = {
  filter: function (node, options) {
    return (
      options.linkStyle === 'inlined' &&
      node.nodeName === 'A' &&
      (node.getAttribute('href') || node.getAttribute('name') || node.getAttribute('id'))
    )
  },

  escapeContent: function (node, _options) {
    // Disable escaping content (including '_'s) when the link has the same URL and href.
    // This prevents links from being broken by added escapes.
    return node.getAttribute('href') !== node.textContent;
  },

  replacement: function (content, node, options) {
    var href = filterLinkHref(node.getAttribute('href'));

    if (!href) {
      return getNamedAnchorFromLink(node, options) + filterLinkContent(content)
    } else {
      var title = node.title && node.title !== href ? ' "' + filterTitleAttribute(node.title) + '"' : '';
      if (!href) title = '';
      let output = getNamedAnchorFromLink(node, options) + '[' + filterLinkContent(content) + '](' + href + title + ')';

      // If the URL is automatically linkified by Joplin, and the title is
      // the same as the URL, there is no need to make it a link here. That
      // will prevent URsL from the rich text editor to be needlessly
      // converted from this:
      //
      // <a href="https://example.com">https://example.com</a>
      //
      // to this:
      //
      // [https://example.com](https://example.com)
      //
      // It means cleaner Markdown will also be generated by the web
      // clipper.
      if (isLinkifiedUrl(href)) {
        if (output === '[' + href + '](' + href + ')') return href;
      }

      return output;
    }
  }
};

// Normally a named anchor would be <a name="something"></a> but
// you can also find <span id="something">Something</span> so the
// rule below handle this.
// Fixes https://github.com/laurent22/joplin/issues/1876
rules.otherNamedAnchors = {
  filter: function (node, options) {
    return !!getNamedAnchorFromLink(node, options);
  },

  replacement: function (content, node, options) {
    return getNamedAnchorFromLink(node, options) + content;
  }
};

rules.referenceLink = {
  filter: function (node, options) {
    return (
      options.linkStyle === 'referenced' &&
      node.nodeName === 'A' &&
      node.getAttribute('href')
    )
  },

  replacement: function (content, node, options) {
    var href = filterLinkHref(node.getAttribute('href'));
    var title = node.title ? ' "' + node.title + '"' : '';
    if (!href) title = '';
    var replacement;
    var reference;

    content = filterLinkContent(content);

    switch (options.linkReferenceStyle) {
      case 'collapsed':
        replacement = '[' + content + '][]';
        reference = '[' + content + ']: ' + href + title;
        break
      case 'shortcut':
        replacement = '[' + content + ']';
        reference = '[' + content + ']: ' + href + title;
        break
      default:
        var id = this.references.length + 1;
        replacement = '[' + content + '][' + id + ']';
        reference = '[' + id + ']: ' + href + title;
    }

    this.references.push(reference);
    return replacement
  },

  references: [],

  append: function (options) {
    var references = '';
    if (this.references.length) {
      references = '\n\n' + this.references.join('\n') + '\n\n';
      this.references = []; // Reset references
    }
    return references
  }
};

rules.emphasis = {
  filter: ['em', 'i'],

  replacement: function (content, node, options) {
    if (!content.trim()) return ''
    if (node.isCode) return content;
    return options.emDelimiter + content + options.emDelimiter
  }
};

rules.strong = {
  filter: ['strong', 'b'],

  replacement: function (content, node, options) {
    if (!content.trim()) return ''
    if (node.isCode) return content;
    return options.strongDelimiter + content + options.strongDelimiter
  }
};

rules.code = {
  filter: function (node) {
    var hasSiblings = node.previousSibling || node.nextSibling;
    var isCodeBlock = node.parentNode.nodeName === 'PRE' && !hasSiblings;

    return node.nodeName === 'CODE' && !isCodeBlock
  },

  replacement: function (content, node, options) {
    if (!content) {
      return ''
    }

    content = content.replace(/\r?\n|\r/g, '\n');
    // If code is multiline and in codeBlock, just return it, codeBlock will add fence(default is ```).
    //
    // This handles the case where a <code> element is nested directly within a <pre> and
    // should not be turned into an inline code region.
    //
    // See https://github.com/laurent22/joplin/pull/10126 .
    if (content.indexOf('\n') !== -1 && node.parentNode && isCodeBlock(node.parentNode)){
      return content
    }

    content = content.replace(/\r?\n|\r/g, '');

    var extraSpace = /^`|^ .*?[^ ].* $|`$/.test(content) ? ' ' : '';
    var delimiter = '`';
    var matches = content.match(/`+/gm) || [];
    while (matches.indexOf(delimiter) !== -1) delimiter = delimiter + '`';

    return delimiter + extraSpace + content + extraSpace + delimiter
  }
};

function imageMarkdownFromAttributes(attributes) {
  var alt = attributes.alt || '';
  var src = filterLinkHref(attributes.src || '');
  var title = attributes.title || '';
  var titlePart = title ? ' "' + filterTitleAttribute(title) + '"' : '';
  return src ? '![' + alt.replace(/([[\]])/g, '\\$1') + ']' + '(' + src + titlePart + ')' : ''
}

function imageMarkdownFromNode(node, options = null) {
  options = Object.assign({}, {
    preserveImageTagsWithSize: false,
  }, options);

  if (options.preserveImageTagsWithSize && (node.getAttribute('width') || node.getAttribute('height'))) {
    let html = node.outerHTML;

    // To prevent markup immediately after the image from being interpreted as HTML, a closing tag
    // is sometimes necessary.
    const needsClosingTag = () => {
      const parent = node.parentElement;
      if (!parent || parent.nodeName !== 'LI') return false;
      const hasClosingTag = html.match(/<\/[a-z]+\/>$/ig);
      if (hasClosingTag) {
        return false;
      }

      const allChildren = [...parent.childNodes];
      const nonEmptyChildren = allChildren.filter(item => {
        // Even if surrounded by #text nodes that only contain whitespace, Markdown after
        // an <img> can still be incorrectly interpreted as HTML. Only non-empty #texts seem
        // to prevent this.
        return item.nodeName !== '#text' || item.textContent.trim() !== '';
      });

      const imageIndex = nonEmptyChildren.indexOf(node);
      const hasNextSibling = imageIndex + 1 < nonEmptyChildren.length;
      const nextSiblingName = hasNextSibling ? (
        nonEmptyChildren[imageIndex + 1].nodeName
      ) : null;

      const nextSiblingIsNewLine = nextSiblingName === 'UL' || nextSiblingName === 'OL' || nextSiblingName === 'BR';
      return imageIndex === 0 && nextSiblingIsNewLine;
    };

    if (needsClosingTag()) {
      html = html.replace(/[/]?>$/, `></${node.nodeName.toLowerCase()}>`);
    }
    return html;
  }

  return imageMarkdownFromAttributes({
    alt: node.alt,
    src: node.getAttribute('src') || node.getAttribute('data-src'),
    title: node.title,
  });
}

function imageUrlFromSource(node) {
  // Format of srcset can be:
  // srcset="kitten.png"
  // or:
  // srcset="kitten.png, kitten@2X.png 2x"

  let src = node.getAttribute('srcset');
  if (!src) src = node.getAttribute('data-srcset');
  if (!src) return '';

  const s = src.split(',');
  if (!s.length) return '';
  src = s[0];

  src = src.split(' ');
  return src[0];
}

rules.image = {
  filter: 'img',

  replacement: function (content, node, options) {
    return imageMarkdownFromNode(node, options);
  }
};

rules.picture = {
  filter: 'picture',

  replacement: function (content, node, options) {
    if (!node.childNodes) return '';

    let firstSource = null;
    let firstImg = null;

    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];

      if (child.nodeName === 'SOURCE' && !firstSource) firstSource = child;
      if (child.nodeName === 'IMG') firstImg = child;
    }

    if (firstImg && firstImg.getAttribute('src')) {
      return imageMarkdownFromNode(firstImg, options);
    } else if (firstSource) {
      // A <picture> tag can have multiple <source> tag and the browser should decide which one to download
      // but for now let's pick the first one.
      const src = imageUrlFromSource(firstSource);
      return src ? '![](' + src + ')' : '';
    }

    return '';
  }
};

function findFirstDescendant(node, byType, name) {
  for (const childNode of node.childNodes) {
    if (byType === 'class' && childNode.classList && childNode.classList.contains(name)) return childNode;
    if (byType === 'nodeName' && childNode.nodeName === name) return childNode;

    const sub = findFirstDescendant(childNode, byType, name);
    if (sub) return sub;
  }
  return null;
}

function findParent(node, byType, name) {
  while (true) {
    const p = node.parentNode;
    if (!p) return null;
    if (byType === 'class' && p.classList && p.classList.contains(name)) return p;
    if (byType === 'nodeName' && p.nodeName === name) return p;
    node = p;
  }
}

// ===============================================================================
// MATHJAX support
//
// When encountering Mathjax elements there's first the rendered Mathjax,
// which we want to skip because it cannot be converted reliably to Markdown.
// This tag is followed by the actual MathJax script in a <script> tag, which
// is what we want to export. By wrapping this text in "$" or "$$" it will
// be displayed correctly by Katex in Joplin.
//
// See mathjax_inline and mathjax_block test cases.
// ===============================================================================

function majaxScriptBlockType(node) {
  if (node.nodeName !== 'SCRIPT') return null;

  const a = node.getAttribute('type');
  if (!a || a.indexOf('math/tex') < 0) return null;

  return a.indexOf('display') >= 0 ? 'block' : 'inline';
}

rules.mathjaxRendered = {
  filter: function (node) {
    return node.nodeName === 'SPAN' && node.getAttribute('class') === 'MathJax';
  },

  replacement: function (content, node, options) {
    return '';
  }
};

rules.mathjaxScriptInline = {
  filter: function (node) {
    return majaxScriptBlockType(node) === 'inline';
  },

  escapeContent: function() {
    // We want the raw unescaped content since this is what Katex will need to render
    // If we escape, it will double the \\ in particular.
    return false;
  },

  replacement: function (content, node, options) {
    return '$' + content + '$';
  }
};

rules.mathjaxScriptBlock = {
  filter: function (node) {
    return majaxScriptBlockType(node) === 'block';
  },

  escapeContent: function() {
    return false;
  },

  replacement: function (content, node, options) {
    return '$$\n' + content + '\n$$';
  }
};

// ===============================================================================
// End of MATHJAX support
// ===============================================================================

// ===============================================================================
// MathML support (Wikipedia & KaTeX math)
// ===============================================================================

// Returns the contents of a <semantics><annotation>...</annotation></semantics> within
// a math block.
const getSourceText = (mathNode) => {
  const semantics = findFirstDescendant(mathNode, 'nodeName', 'semantics');
  if (!semantics) return '';

  const annotation = findFirstDescendant(semantics, 'nodeName', 'annotation');
  if (!annotation) return '';
  return annotation.textContent;
};

rules.mathMlScriptBlock = {
  filter: function (node) {
    return node.nodeName === 'math' && !!getSourceText(node);
  },

  escapeContent: function() {
    return false;
  },

  replacement: function (_content, node, _options) {
    return '$' + getSourceText(node) + '$';
  }
};

// ===============================================================================
// Joplin "noMdConv" support
// 
// Tags that have the class "jop-noMdConv" are not converted to Markdown
// but left as HTML. This is useful when converting from MD to HTML, then
// back to MD again. In that case, we'd want to preserve the code that
// was in HTML originally.
// ===============================================================================

rules.joplinHtmlInMarkdown = {
  filter: function (node) {
    // Tables are special because they may be entirely kept as HTML depending on
    // the logic in table.js, for example if they contain code.
    return node && node.classList && node.classList.contains('jop-noMdConv') && node.nodeName !== 'TABLE';
  },

  replacement: function (content, node) {
    node.classList.remove('jop-noMdConv');
    const nodeName = node.nodeName.toLowerCase();
    let attrString = attributesHtml(node.attributes, { skipEmptyClass: true });
    if (attrString) attrString = ' ' + attrString;
    return '<' + nodeName + attrString + '>' + content + '</' + nodeName + '>';
  }
};

// ===============================================================================
// Joplin Source block support
// 
// This is specific to Joplin: a plugin may convert some Markdown to HTML
// but keep the original source in a hidden <PRE class="joplin-source"> block.
// In that case, when we convert back again from HTML to MD, we use that
// block for lossless conversion.
// ===============================================================================

function joplinEditableBlockInfo(node) {
  if (!node.classList.contains('joplin-editable')) return null;

  let sourceNode = null;
  let isInline = false;
  for (const childNode of node.childNodes) {
    if (childNode.classList && childNode.classList.contains('joplin-source')) {
      sourceNode = childNode;
      break;
    }
  }

  if (!sourceNode) return null;
  if (!node.isBlock) isInline = true;

  return {
    openCharacters: sourceNode.getAttribute('data-joplin-source-open'),
    closeCharacters: sourceNode.getAttribute('data-joplin-source-close'),
    content: sourceNode.textContent,
    isInline
  };
}

rules.joplinSourceBlock = {
  filter: function (node) {
    return !!joplinEditableBlockInfo(node);
  },

  escapeContent: function() {
    return false;
  },

  replacement: function (content, node, options) {
    const info = joplinEditableBlockInfo(node);
    if (!info) return;

    const surroundingCharacter = info.isInline? '' : '\n\n';
    return surroundingCharacter + info.openCharacters + info.content + info.closeCharacters + surroundingCharacter;
  }
};


// ===============================================================================
// Checkboxes
// ===============================================================================

function joplinCheckboxInfo(liNode) {
  if (liNode.classList.contains('joplin-checkbox')) {
    // Handling of this rendering is buggy as it adds extra new lines between each
    // list item. However, supporting this rendering is normally no longer needed.
    const input = findFirstDescendant(liNode, 'nodeName', 'INPUT');
    return {
      checked: input && input.getAttribute ? !!input.getAttribute('checked') : false,
      renderingType: 1,
    };
  }

  // Should handle both <ul class='joplin-checklist'><li>...</li></ul>
  // and <ul><li class='joplin-checklist-item'>...</li></ul>. The second is present
  // in certain types of imported notes.
  const parentChecklist = findParent(liNode, 'class', 'joplin-checklist');
  const currentChecklist = liNode.classList.contains('joplin-checklist-item');
  if (parentChecklist || currentChecklist) {
    return {
      checked: !!liNode.classList && liNode.classList.contains('checked'),
      renderingType: 2,
    };
  }

  return null;
}

/**
 * Manages a collection of rules used to convert HTML to Markdown
 */

function Rules (options) {
  this.options = options;
  this._keep = [];
  this._remove = [];

  this.blankRule = {
    replacement: options.blankReplacement
  };

  this.keepReplacement = options.keepReplacement;

  this.defaultRule = {
    replacement: options.defaultReplacement
  };

  this.array = [];
  for (var key in options.rules) this.array.push(options.rules[key]);
}

Rules.prototype = {
  add: function (key, rule) {
    this.array.unshift(rule);
  },

  keep: function (filter) {
    this._keep.unshift({
      filter: filter,
      replacement: this.keepReplacement
    });
  },

  remove: function (filter) {
    this._remove.unshift({
      filter: filter,
      replacement: function () {
        return ''
      }
    });
  },

  forNode: function (node) {
    // code block keep blank lines
    // See https://github.com/laurent22/joplin/pull/10126 .
    // test case: packages/app-cli/tests/html_to_md/code_multiline_4.html
    if (node.isCode === false && node.isBlank) return this.blankRule
    var rule;

    if ((rule = findRule(this.array, node, this.options))) return rule
    if ((rule = findRule(this._keep, node, this.options))) return rule
    if ((rule = findRule(this._remove, node, this.options))) return rule

    return this.defaultRule
  },

  forEach: function (fn) {
    for (var i = 0; i < this.array.length; i++) fn(this.array[i], i);
  }
};

function findRule (rules, node, options) {
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    if (filterValue(rule, node, options)) return rule
  }
  return void 0
}

function filterValue (rule, node, options) {
  var filter = rule.filter;
  if (typeof filter === 'string') {
    if (filter === node.nodeName.toLowerCase()) return true
  } else if (Array.isArray(filter)) {
    if (filter.indexOf(node.nodeName.toLowerCase()) > -1) return true
  } else if (typeof filter === 'function') {
    if (filter.call(rule, node, options)) return true
  } else {
    throw new TypeError('`filter` needs to be a string, array, or function')
  }
}

/**
 * The collapseWhitespace function is adapted from collapse-whitespace
 * by Luc Thevenard.
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2014 Luc Thevenard <lucthevenard@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

function containsOnlySpaces(text) {
  if (!text) return false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ' ') return false;
  }
  return true;
}

/**
 * collapseWhitespace(options) removes extraneous whitespace from an the given element.
 *
 * @param {Object} options
 */
function collapseWhitespace (options) {
  var element = options.element;
  var isBlock = options.isBlock;
  var isVoid = options.isVoid;
  var isPre = options.isPre || function (node) {
    return node.nodeName === 'PRE'
  };

  if (!element.firstChild || isPre(element)) return

  var prevText = null;
  var keepLeadingWs = false;

  var prev = null;
  var node = next(prev, element, isPre);

  // We keep track of whether the previous was only spaces or not. This prevent the case where multiple empty blocks are
  // added, which results in multiple spaces. This spaces are then incorrectly interpreted as a code block by renderers.
  // So by keeping track of this, we make sure that only one space at most is added.
  var prevTextIsOnlySpaces = false;
  while (node !== element) {
    if (node.nodeType === 3 || node.nodeType === 4) { // Node.TEXT_NODE or Node.CDATA_SECTION_NODE
      var text = node.data.replace(/[ \r\n\t]+/g, ' ');

      if ((!prevText || / $/.test(prevText.data)) &&
          !keepLeadingWs && text[0] === ' ') {
        text = text.substr(1);
      }

      var textIsOnlySpaces = containsOnlySpaces(text);

      // `text` might be empty at this point.
      if (!text || (textIsOnlySpaces && prevTextIsOnlySpaces)) {
        node = remove(node);
        continue
      }

      prevTextIsOnlySpaces = textIsOnlySpaces;
      node.data = text;

      prevText = node;
    } else if (node.nodeType === 1) { // Node.ELEMENT_NODE
      if (isBlock(node) || node.nodeName === 'BR') {
        if (prevText) {
          prevText.data = prevText.data.replace(/ $/, '');
        }

        prevText = null;
        keepLeadingWs = false;
      } else if (isVoid(node) || isPre(node)) {
        // Avoid trimming space around non-block, non-BR void elements and inline PRE.
        prevText = null;
        keepLeadingWs = true;
      } else if (prevText) {
        // Drop protection if set previously.
        keepLeadingWs = false;
      }
    } else {
      node = remove(node);
      continue
    }

    var nextNode = next(prev, node, isPre);
    prev = node;
    node = nextNode;
  }

  if (prevText) {
    prevText.data = prevText.data.replace(/ $/, '');
    if (!prevText.data) {
      remove(prevText);
    }
  }
}

/**
 * remove(node) removes the given node from the DOM and returns the
 * next node in the sequence.
 *
 * @param {Node} node
 * @return {Node} node
 */
function remove (node) {
  var next = node.nextSibling || node.parentNode;

  node.parentNode.removeChild(node);

  return next
}

/**
 * next(prev, current, isPre) returns the next node in the sequence, given the
 * current and previous nodes.
 *
 * @param {Node} prev
 * @param {Node} current
 * @param {Function} isPre
 * @return {Node}
 */
function next (prev, current, isPre) {
  if ((prev && prev.parentNode === current) || isPre(current)) {
    return current.nextSibling || current.parentNode
  }

  return current.firstChild || current.nextSibling || current.parentNode
}

/*
 * Set up window for Node.js
 */

var root = (typeof window !== 'undefined' ? window : {});

/*
 * Parsing HTML strings
 */

function canParseHTMLNatively () {
  var Parser = root.DOMParser;
  var canParse = false;

  // Adapted from https://gist.github.com/1129031
  // Firefox/Opera/IE throw errors on unsupported types
  try {
    // WebKit returns null on unsupported types
    if (new Parser().parseFromString('', 'text/html')) {
      canParse = true;
    }
  } catch (e) {}

  return canParse
}

function createHTMLParser () {
  var Parser = function () {};

  {
    if (shouldUseActiveX()) {
      Parser.prototype.parseFromString = function (string) {
        var doc = new window.ActiveXObject('htmlfile');
        doc.designMode = 'on'; // disable on-page scripts
        doc.open();
        doc.write(string);
        doc.close();
        return doc
      };
    } else {
      Parser.prototype.parseFromString = function (string) {
        var doc = document.implementation.createHTMLDocument('');
        doc.open();
        doc.write(string);
        doc.close();
        return doc
      };
    }
  }
  return Parser
}

function shouldUseActiveX () {
  var useActiveX = false;
  try {
    document.implementation.createHTMLDocument('').open();
  } catch (e) {
    if (window.ActiveXObject) useActiveX = true;
  }
  return useActiveX
}

var HTMLParser = canParseHTMLNatively() ? root.DOMParser : createHTMLParser();

function RootNode (input, options) {
  var root;
  if (typeof input === 'string') {
    var doc = htmlParser().parseFromString(
      // DOM parsers arrange elements in the <head> and <body>.
      // Wrapping in a custom element ensures elements are reliably arranged in
      // a single element.
      '<x-turndown id="turndown-root">' + input + '</x-turndown>',
      'text/html'
    );
    root = doc.getElementById('turndown-root');
  } else {
    root = input.cloneNode(true);
  }
  collapseWhitespace({
    element: root,
    isBlock: isBlock,
    isVoid: isVoid,
    isPre: options.preformattedCode ? isPreOrCode : null
  });

  return root
}

var _htmlParser;
function htmlParser () {
  _htmlParser = _htmlParser || new HTMLParser();
  return _htmlParser
}

function isPreOrCode (node) {
  return node.nodeName === 'PRE' || node.nodeName === 'CODE'
}

function Node (node, options) {
  node.isBlock = isBlock(node);
  node.isCode = node.nodeName === 'CODE' || node.parentNode.isCode || isCodeBlock(node);
  node.isBlank = isBlank(node);
  node.flankingWhitespace = flankingWhitespace(node, options);
  return node
}

function isBlank (node) {
  return (
    !isVoid(node) &&
    !isMeaningfulWhenBlank(node) &&
    /^\s*$/i.test(node.textContent) &&
    !hasVoid(node) &&
    !hasMeaningfulWhenBlank(node)
  )
}

function flankingWhitespace (node, options) {
  if (node.isBlock || (options.preformattedCode && node.isCode)) {
    return { leading: '', trailing: '' }
  }

  var edges = edgeWhitespace(node.textContent);

  // abandon leading ASCII WS if left-flanked by ASCII WS
  if (edges.leadingAscii && isFlankedByWhitespace('left', node, options)) {
    edges.leading = edges.leadingNonAscii;
  }

  // abandon trailing ASCII WS if right-flanked by ASCII WS
  if (edges.trailingAscii && isFlankedByWhitespace('right', node, options)) {
    edges.trailing = edges.trailingNonAscii;
  }

  return { leading: edges.leading, trailing: edges.trailing }
}

function edgeWhitespace (string) {
  var m = string.match(/^(([ \t\r\n]*)(\s*))(?:(?=\S)[\s\S]*\S)?((\s*?)([ \t\r\n]*))$/);
  return {
    leading: m[1], // whole string for whitespace-only strings
    leadingAscii: m[2],
    leadingNonAscii: m[3],
    trailing: m[4], // empty for whitespace-only strings
    trailingNonAscii: m[5],
    trailingAscii: m[6]
  }
}

function isFlankedByWhitespace (side, node, options) {
  var sibling;
  var regExp;
  var isFlanked;

  if (side === 'left') {
    sibling = node.previousSibling;
    regExp = / $/;
  } else {
    sibling = node.nextSibling;
    regExp = /^ /;
  }

  if (sibling) {
    if (sibling.nodeType === 3) {
      isFlanked = regExp.test(sibling.nodeValue);
    } else if (options.preformattedCode && sibling.nodeName === 'CODE') {
      isFlanked = false;
    } else if (sibling.nodeType === 1 && !isBlock(sibling)) {
      isFlanked = regExp.test(sibling.textContent);
    }
  }
  return isFlanked
}

// Allows falling back to a more-compatible [fallbackRegex] on platforms that fail to compile
// the primary [regexString].
const regexWithFallback = (regexString, regexFlags, fallbackRegex) => {
  try {
    return new RegExp(regexString, regexFlags);
  } catch (error) {
    console.error('Failed to compile regular expression. Falling back to a compatibility regex. Error: ', error);
    return fallbackRegex;
  }
};
var escapes = [
  [/\\/g, '\\\\'],
  [/\*/g, '\\*'],
  [/^-/g, '\\-'],
  [/^\+ /g, '\\+ '],
  [/^(=+)/g, '\\$1'],
  [/^(#{1,6}) /g, '\\$1 '],
  [/`/g, '\\`'],
  [/^~~~/g, '\\~~~'],
  [/\[/g, '\\['],
  [/\]/g, '\\]'],
  [/^>/g, '\\>'],
  // A list of valid \p values can be found here: https://unicode.org/reports/tr44/#GC_Values_Table
  [regexWithFallback('(^|\\p{Punctuation}|\\p{Separator}|\\p{Symbol})_(\\P{Separator})', 'ug', /(^|\s)_(\S)/), '$1\\_$2'],
  [/^(\d+)\. /g, '$1\\. '],
  [/\$/g, '\\$$'], // Math
];

function TurndownService (options) {
  if (!(this instanceof TurndownService)) return new TurndownService(options)

  var defaults = {
    rules: rules,
    headingStyle: 'setext',
    hr: '* * *',
    bulletListMarker: '*',
    codeBlockStyle: 'indented',
    fence: '```',
    emDelimiter: '_',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    linkReferenceStyle: 'full',
    anchorNames: [],
    br: '  ',
    disableEscapeContent: false,
    preformattedCode: false,
    preserveNestedTables: false,
    preserveColorStyles: false,
    tightLists: false,
    collapseMultipleBlankLines: false,
    blankReplacement: function (content, node) {
      return node.isBlock ? '\n\n' : ''
    },
    keepReplacement: function (content, node) {
      // In markdown, multiple blank lines end an HTML block. We thus
      // include an HTML comment to make otherwise blank lines not blank.
      const mutliBlankLineRegex = /\n([ \t\r]*)\n/g;

      // We run the replacement multiple times to handle multiple blank
      // lines in a row.
      //
      // For example, "Foo\n\n\nBar" becomes "Foo\n<!-- -->\n\nBar" after the
      // first replacement.
      let html = node.outerHTML;
      while (html.match(mutliBlankLineRegex)) {
        html = html.replace(mutliBlankLineRegex, '\n<!-- -->$1\n');
      }

      return node.isBlock ? '\n\n' + html + '\n\n' : html
    },
    defaultReplacement: function (content, node) {
      return node.isBlock ? '\n\n' + content + '\n\n' : content
    }
  };
  this.options = extend({}, defaults, options);
  this.rules = new Rules(this.options);
}

TurndownService.prototype = {
  /**
   * The entry point for converting a string or DOM node to Markdown
   * @public
   * @param {String|HTMLElement} input The string or DOM node to convert
   * @returns A Markdown representation of the input
   * @type String
   */

  turndown: function (input) {
    if (!canConvert(input)) {
      throw new TypeError(
        input + ' is not a string, or an element/document/fragment node.'
      )
    }

    if (input === '') return ''

    var output = process.call(this, new RootNode(input, this.options));
    return postProcess.call(this, output)
  },

  /**
   * Add one or more plugins
   * @public
   * @param {Function|Array} plugin The plugin or array of plugins to add
   * @returns The Turndown instance for chaining
   * @type Object
   */

  use: function (plugin) {
    if (Array.isArray(plugin)) {
      for (var i = 0; i < plugin.length; i++) this.use(plugin[i]);
    } else if (typeof plugin === 'function') {
      plugin(this);
    } else {
      throw new TypeError('plugin must be a Function or an Array of Functions')
    }
    return this
  },

  /**
   * Adds a rule
   * @public
   * @param {String} key The unique key of the rule
   * @param {Object} rule The rule
   * @returns The Turndown instance for chaining
   * @type Object
   */

  addRule: function (key, rule) {
    this.rules.add(key, rule);
    return this
  },

  /**
   * Keep a node (as HTML) that matches the filter
   * @public
   * @param {String|Array|Function} filter The unique key of the rule
   * @returns The Turndown instance for chaining
   * @type Object
   */

  keep: function (filter) {
    this.rules.keep(filter);
    return this
  },

  /**
   * Remove a node that matches the filter
   * @public
   * @param {String|Array|Function} filter The unique key of the rule
   * @returns The Turndown instance for chaining
   * @type Object
   */

  remove: function (filter) {
    this.rules.remove(filter);
    return this
  },

  /**
   * Escapes Markdown syntax
   * @public
   * @param {String} string The string to escape
   * @returns A string with Markdown syntax escaped
   * @type String
   */

  escape: function (string) {
    return escapes.reduce(function (accumulator, escape) {
      return accumulator.replace(escape[0], escape[1])
    }, string)
  },

  isCodeBlock: function(node) {
    return isCodeBlock(node);
  },

};

/**
 * Reduces a DOM node down to its Markdown string equivalent
 * @private
 * @param {HTMLElement} parentNode The node to convert
 * @returns A Markdown representation of the node
 * @type String
 */

function process (parentNode, escapeContent = 'auto') {
  if (this.options.disableEscapeContent) escapeContent = false;

  let output = '';
  let previousNode = null;

  for (let node of parentNode.childNodes) {
    node = new Node(node, this.options);

    var replacement = '';
    if (node.nodeType === 3) {
      if (node.isCode || escapeContent === false) {
        replacement = node.nodeValue;
      } else {
        replacement = this.escape(node.nodeValue);

        // Escape < and > so that, for example, this kind of HTML text: "This is a tag: &lt;p&gt;" is still rendered as "This is a tag: &lt;p&gt;"
        // and not "This is a tag: <p>". If the latter, it means the HTML will be rendered if the viewer supports HTML (which, in Joplin, it does).
        replacement = replacement.replace(/<(.+?)>/g, '&lt;$1&gt;');
      }
    } else if (node.nodeType === 1) {
      replacement = replacementForNode.call(this, node, previousNode);
    }

    output = join(output, replacement, parentNode.isCode);
    previousNode = node;
  }

  return output;
}

/**
 * Appends strings as each rule requires and trims the output
 * @private
 * @param {String} output The conversion output
 * @returns A trimmed version of the ouput
 * @type String
 */

function postProcess (output) {
  var self = this;
  this.rules.forEach(function (rule) {
    if (typeof rule.append === 'function') {
      output = join(output, rule.append(self.options), false);
    }
  });

  output = output.replace(/^[\t\r\n]+/, '').replace(/[\t\r\n\s]+$/, '');

  // Collapse multiple blank lines (or lines with only whitespace) into a single blank line
  if (this.options.collapseMultipleBlankLines) {
    output = output.replace(/(\n\s*){3,}/g, '\n\n');
  }

  return output
}

/**
 * Converts an element node to its Markdown equivalent
 * @private
 * @param {HTMLElement} node The node to convert
 * @param {HTMLElement|null} previousNode The node immediately before this node.
 * @returns A Markdown representation of the node
 * @type String
 */

function replacementForNode (node, previousNode) {
  var rule = this.rules.forNode(node);
  var content = process.call(this, node, rule.escapeContent ? rule.escapeContent(node) : 'auto');
  var whitespace = node.flankingWhitespace;
  if (whitespace.leading || whitespace.trailing){
    if (node.isCode) {
      // Fix: Web clipper has trouble with code blocks on Joplin's website.
      // See https://github.com/laurent22/joplin/pull/10126#issuecomment-2016523281 .
      // if isCode, keep line breaks
      //test case: packages/app-cli/tests/html_to_md/code_multiline_1.html
      //test case: packages/app-cli/tests/html_to_md/code_multiline_3.html

      //If the leading blank of current node or leading blank of current node including line breaks, and the leading blank of current node is equal to the leading blank of it's first child node, and the trailing blank of the current node is equal to the leading blank of it's last child node, it indicates that the leading blank and leading blank of current node is from it's child nodes, so should not be added repeatedly, this remove multiple line breaks.
      //test case: packages/app-cli/tests/html_to_md/code_multiline_5.html
      if ( (whitespace.leading.indexOf('\n') !== -1 || whitespace.trailing.indexOf('\n') !== -1) && 
        node.childNodes && node.childNodes.length > 0) {

        var firstChildWhitespace = node.childNodes[0].flankingWhitespace;
        var lastChildWhitespace = node.childNodes[node.childNodes.length-1].flankingWhitespace;

        if (whitespace.leading === firstChildWhitespace.leading && 
          whitespace.trailing === lastChildWhitespace.trailing) {
            content = content.trim();
        }
      } else {
        // keep line breaks
        content = content.replace(/^[ \t]+|[ \t]+$/g, '');
      }
    } else {
      content = content.trim();
    }
  }
  
  return (
    whitespace.leading +
    rule.replacement(content, node, this.options, previousNode) +
    whitespace.trailing
  )
}

/**
 * Joins replacement to the current output with appropriate number of new lines
 * @private
 * @param {String} output The current conversion output
 * @param {String} replacement The string to append to the output
 * @returns Joined output
 * @type String
 */

function join (output, replacement, isCode) {
  if (isCode === true) {
    // Fix: Web clipper has trouble with code blocks on Joplin's website.
    // See https://github.com/laurent22/joplin/pull/10126#issuecomment-2016523281 .
    // If isCode, keep line breaks
    return output + replacement
  } else {
    var s1 = trimTrailingNewlines(output);
    var s2 = trimLeadingNewlines(replacement);
    var nls = Math.max(output.length - s1.length, replacement.length - s2.length);
    var separator = '\n\n'.substring(0, nls);

    return s1 + separator + s2
  }  
}

/**
 * Determines whether an input can be converted
 * @private
 * @param {String|HTMLElement} input Describe this parameter
 * @returns Describe what it returns
 * @type String|Object|Array|Boolean|Number
 */

function canConvert (input) {
  return (
    input != null && (
      typeof input === 'string' ||
      (input.nodeType && (
        input.nodeType === 1 || input.nodeType === 9 || input.nodeType === 11
      ))
    )
  )
}

module.exports = TurndownService;

const fs = require('fs');
const path = require('path');
const visit = require('unist-util-visit');
const { EOL } = require('os');

function extractLines(
  content,
  fromLine,
  hasDash,
  toLine,
  preserveTrailingNewline = false
) {
  const lines = content.split(EOL);
  const start = fromLine || 1;
  let end;
  if (!hasDash) {
    end = start;
  } else if (toLine) {
    end = toLine;
  } else if (lines[lines.length - 1] === '' && !preserveTrailingNewline) {
    end = lines.length - 1;
  } else {
    end = lines.length;
  }
  return lines.slice(start - 1, end).join('\n');
}

// Modified from strip-indent
// See https://github.com/sindresorhus/strip-indent/blob/main/license
function removeRedundantIndentations(content) {
  const match = content.match(/^[ \t]*(?=\S)/gm);
  if (!match) {
    return content;
  }
  const minIndent = Math.min(...match.slice(1).map(indent => indent.length));
  if (minIndent === 0) {
    return content;
  }
  return content.replace(new RegExp(`^[ \\t]{${minIndent}}`, 'gm'), '');
}

function codeImport(options = {}) {
  return function transformer(tree, file) {
    const codes = [];
    const promises = [];

    visit(tree, 'code', (node, index, parent) => {
      codes.push([node, index, parent]);
    });

    for (const [node] of codes) {
      const fileMeta = (node.meta || '')
        .split(' ')
        .find(meta => meta.startsWith('file='));

      if (!fileMeta) {
        continue;
      }

      const res = /^file=(?<path>.+?)(?:(?:#(?:L(?<from>\d+)(?<dash>-)?)?)(?:L(?<to>\d+))?)?$/.exec(
        fileMeta
      );
      if (!res || !res.groups || !res.groups.path) {
        throw new Error(`Unable to parse file path ${fileMeta}`);
      }
      const filePath = res.groups.path;
      const fromLine = res.groups.from
        ? parseInt(res.groups.from, 10)
        : undefined;
      const hasDash = !!res.groups.dash || fromLine === undefined;
      const toLine = res.groups.to ? parseInt(res.groups.to, 10) : undefined;

      if (!options.basePath && !file.dirname) {
        throw new Error("Unable to parse base file path. Please configure options.basePath or modify your tooling to include path data, like mdxOptions.filepath.")
      }

      const fileAbsPath = path.resolve(options.basePath || file.dirname, filePath);

      if (options.async) {
        promises.push(
          new Promise((resolve, reject) => {
            fs.readFile(fileAbsPath, 'utf8', (err, fileContent) => {
              if (err) {
                reject(err);
                return;
              }

              node.value = extractLines(
                fileContent,
                fromLine,
                hasDash,
                toLine,
                options.preserveTrailingNewline
              );
              if (options.removeRedundantIndentations) {
                node.value = removeRedundantIndentations(node.value);
              }
              resolve();
            });
          })
        );
      } else {
        const fileContent = fs.readFileSync(fileAbsPath, 'utf8');

        node.value = extractLines(
          fileContent,
          fromLine,
          hasDash,
          toLine,
          options.preserveTrailingNewline
        );
        if (options.removeRedundantIndentations) {
          node.value = removeRedundantIndentations(node.value);
        }
      }
    }

    if (promises.length) {
      return Promise.all(promises);
    }
  };
}

module.exports = codeImport;

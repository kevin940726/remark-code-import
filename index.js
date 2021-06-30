const fs = require('fs');
const path = require('path');
const visit = require('unist-util-visit');
const { EOL } = require('os');

function extractLines(content, fromLine, hasDash, toLine) {
  if (fromLine === undefined && toLine === undefined) {
    return content;
  }
  const lines = content.split(EOL);
  const start = fromLine || 1;
  const end = hasDash ? toLine || lines.length : start;
  return lines.slice(start - 1, end).join('\n');
}

const anyEndRegex = `^\\s*// @snippet:end\\s*$`;

function extractSnippet(content, snippetId) {
  if (typeof snippetId === "undefined" || typeof content === "undefined") {
    return content;
  }

  // alphanumeric, dashes and underscores
  // otherwise, no match!
  if (!snippetId.match(/[A-Za-z0-9-_]+/)) {
    return "";
  }

  const startRegex = `^\\s*// @snippet:start ${snippetId}\\s*$`;
  const endRegex = `^\\s*// @snippet:end ${snippetId}\\s*$`;

  const snippetStart = content.search(new RegExp(startRegex, "im"));

  // there must be a beginning
  if (snippetStart === -1) {
    throw new Error(`Unable to locate snippet: ${snippetId}`);
  }

  let snippet = content.substr(snippetStart);

  let snippetEnd = snippet.search(new RegExp(endRegex, "im"));

  // if no end for `snippetId`, check for one without an ID
  if (snippetEnd === -1) {
    snippetEnd = snippet.search(new RegExp(anyEndRegex, "im"))
  }

  // if we found an end, slice it
  if (snippetEnd !== -1) {
    snippet = snippet.substr(0, snippetEnd);
  }

  const lines = snippet.split(EOL);

  // remove @snippet:start and trailing newline
  return lines.slice(1, lines.length - 1).join('\n');
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
      const res = /^file=(?<path>.+?)(?:(?:#(?:L(?<from>\d+)(?<dash>-)?)?)(?:L(?<to>\d+))?|(?:@(?<snippetId>\S+)))?$/.exec(
        fileMeta
      );
      if (!res || !res.groups || !res.groups.path) {
        throw new Error(`Unable to parse file path ${fileMeta}`);
      }
      const filePath = res.groups.path;
      const hasDash = !!res.groups.dash;
      const fromLine = res.groups.from
        ? parseInt(res.groups.from, 10)
        : undefined;
      const toLine = res.groups.to ? parseInt(res.groups.to, 10) : undefined;
      const snippetId = res.groups.snippetId;

      if (!options.basePath && !file.dirname) {
        throw new Error("Unable to parse base file path. Please configure options.basePath or modify your tooling to include path data, like mdxOptions.filepath.")
      }

      const fileAbsPath = path.resolve(options.basePath || file.dirname, filePath);

      const extractText = (fileContent) => snippetId
        ? extractSnippet(fileContent, snippetId)
        : extractLines(
          fileContent,
          fromLine,
          hasDash,
          toLine
        ).trim();

      if (options.async) {
        promises.push(
          new Promise((resolve, reject) => {
            fs.readFile(fileAbsPath, 'utf8', (err, fileContent) => {
              if (err) {
                reject(err);
                return;
              }

              node.value = extractText(fileContent);

              resolve();
            });
          })
        );
      } else {
        const fileContent = fs.readFileSync(fileAbsPath, 'utf8');

        node.value = extractText(fileContent);
      }
    }

    if (promises.length) {
      return Promise.all(promises);
    }
  };
}

module.exports = codeImport;

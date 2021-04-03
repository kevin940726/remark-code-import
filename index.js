const fs = require('fs');
const path = require('path');
const visit = require('unist-util-visit');
const EOL = require('os').EOL

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

      const res = /^file=(?<path>.+?)(?:#(?:L(?<from>\d+))?(?<dash>-)?)?(?:L(?<to>\d+))?$/.exec(fileMeta)
      if (!res || !res.groups || !res.groups.path) {
        throw new Error(`Unable to parse file path ${fileMeta}`)
      }
      const filePath = res.groups.path
      const hasDash = !! res.groups.dash
      const fromLine = res.groups.from ? parseInt(res.groups.from) : undefined
      const toLine = res.groups.to ? parseInt(res.groups.to) : undefined
      const fileAbsPath = path.resolve(file.dirname, filePath);

      const extractLines = (content, fromLine, toLine) => {
        if (fromLine === undefined && toLine === undefined) { return content }
        const lines = content.split(EOL)
        toLine = !toLine && hasDash ? lines.length - 1 : toLine || fromLine
        fromLine = fromLine || 1
        return lines.slice(fromLine-1,toLine).join('\n')
      }

      if (options.async) {
        promises.push(
          new Promise((resolve, reject) => {
            fs.readFile(fileAbsPath, 'utf8', (err, fileContent) => {
              if (err) {
                reject(err);
                return;
              }

              node.value = extractLines(fileContent,fromLine,toLine).trim();
              resolve();
            });
          })
        );
      } else {
        const fileContent = fs.readFileSync(fileAbsPath, 'utf8');

        node.value = extractLines(fileContent,fromLine,toLine).trim();
      }
    }

    if (promises.length) {
      return Promise.all(promises);
    }
  };
}

module.exports = codeImport;

const fs = require('fs');
const path = require('path');
const visit = require('unist-util-visit');

function codeImport(options = {}) {
  return function transformer(tree, file) {
    const codes = [];

    visit(tree, 'code', (node, index, parent) => {
      codes.push([node, index, parent]);
    });

    for (const [node] of codes) {
      const fileMeta = (node.meta || '')
        .split(' ')
        .find(meta => meta.startsWith('file='));

      if (!fileMeta) {
        return;
      }

      const filePath = fileMeta.slice('file='.length);
      const fileAbsPath = path.resolve(file.dirname, filePath);

      if (options.async) {
        fs.readFile(fileAbsPath, 'utf8', (err, fileContent) => {
          if (err) {
            throw err;
          }

          node.value = fileContent;
        });
      } else {
        const fileContent = fs.readFileSync(fileAbsPath, 'utf8');

        node.value = fileContent;
      }
    }
  };
}

module.exports = codeImport;

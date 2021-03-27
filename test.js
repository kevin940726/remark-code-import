const codeImport = require('./');
const remark = require('remark');
const path = require('path');

const input = `
\`\`\`js file=./__fixtures__/say-hi.js
\`\`\`
`;

test('Basic file import', () => {
  expect(
    remark()
      .use(codeImport, {})
      .processSync({
        contents: input,
        path: path.resolve('test.md'),
      })
      .toString()
  ).toMatchInlineSnapshot(`
    "\`\`\`js file=./__fixtures__/say-hi.js
    console.log('Hello remark-code-import!');
    console.log('This is another line...');
    \`\`\`
    "
  `);
});

const inputWithLineNumbers = `
\`\`\`js file=./__fixtures__/say-hi.js#L2:L2
\`\`\`
`;

test('File import using line numbers', () => {
  expect(
    remark()
      .use(codeImport, {})
      .processSync({
        contents: inputWithLineNumbers,
        path: path.resolve('test.md'),
      })
      .toString()
  ).toMatchInlineSnapshot(`
    "\`\`\`js file=./__fixtures__/say-hi.js#L2:L2
    console.log('This is another line...');
    \`\`\`
    "
  `);
});

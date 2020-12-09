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
    \`\`\`
    "
  `);
});

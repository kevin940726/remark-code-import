# `remark-code-import`

📝 Populate code blocks from files.

[![npm version](https://badge.fury.io/js/remark-code-import.svg)](https://badge.fury.io/js/remark-code-import)

**Starting from v1.0.0, the plugin is now [ESM only](https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c). Node 12+ is needed to use it and it must be `import`ed instead of `require`d.**

## Installation

```sh
npm install -D remark-code-import
```

## Setup

The plugin can be imported via named export, there's no default export.

```js
import codeImport from 'remark-code-import';
```

See [**Using plugins**](https://github.com/remarkjs/remark/blob/master/doc/plugins.md#using-plugins) for more instructions in the official documentation.

It can also be used in various of libraries: `remark`: [MDX](https://mdxjs.com/advanced/plugins#using-remark-and-rehype-plugins), [Gatsby `gatsby-plugin-mdx`](https://www.gatsbyjs.org/docs/mdx/plugins/#remark-plugins), [Storybook docs](https://github.com/storybookjs/storybook/tree/master/addons/docs#manual-configuration).

## Usage

Transform:

````md
```js file=./say-hi.js
```
````

into:

````md
```js file=./say-hi.js
console.log('Hello remark-code-import!');
```
````

The file path is relative to the markdown file path. You can use `<rootDir>` at the start of the path to import files relatively from the [`rootDir`](#options):

````md
```js file=<rootDir>/file-under-root-directory.js
```
````

You may also specify lines or ranges:

````md
Only line 3:
```js file=./say-hi.js#L3
```

Line 3 to line 6:
```js file=./say-hi.js#L3-L6
```

Line 3 to the end of the file
```js file=./say-hi.js#L3-
```
````

File paths with spaces should be escaped with `\`:

````md
```js file=./file\ with\ spaces.js
```
````

## Options

- `async: boolean`: By default, this plugin uses `readFileSync` to read the contents of the files. Set this to `true` if you want to use `readFile` for non-blocking IO.
- `rootDir: string`: Change what `<rootDir>` refers to. Defaults to `process.cwd()`.
- `preserveTrailingNewline: boolean`: By default, this plugin will trim the trailing newline of the file when importing the code. You can preserve the trailing new line in the code block by setting this option to `true`.
- `removeRedundantIndentations: boolean`: Set to `true` to remove redundant indentations for each line. For instance, the imported code of:
  ```
    First line
      Second line
  ```
  will become...
  ```
  First line
    Second line
  ```
- `allowImportingFromOutside: boolean`: For security reasons, by default this plugin doesn't allow importing files from outside the root directory (`rootDir`). Set this option to `true` to bypass this limit.

## Use as a Gatsby remark plugin

Use the `/gatsby` endpoint. It's possible through [`to-gatsby-remark-plugin`](https://github.com/kevin940726/to-gatsby-remark-plugin).

```js
{
  resolve: 'remark-code-import/gatsby',
  options: {}
}
```

## Testing

After installing dependencies with `npm install`, the tests can be run with: `npm test`

## License

Kai Hao
[MIT](LICENSE)

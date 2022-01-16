# `remark-code-import`

📝 Populate code blocks from files

[![npm version](https://badge.fury.io/js/remark-code-import.svg)](https://badge.fury.io/js/remark-code-import)

**Starting from v1.0.0, the plugin is now [ESM only](https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c). Node 12+ is needed to use it and it must be `import`ed instead of `require`d.

## Installation

```sh
# npm
npm install -D remark-code-import

# yarn
yarn add -D remark-code-import
```

## Setup

See [**Using plugins**](https://github.com/remarkjs/remark/blob/master/doc/plugins.md#using-plugins) in the official documentation.

It can also be used in various of libraries using `remark`: [MDX](https://mdxjs.com/advanced/plugins#using-remark-and-rehype-plugins), [Gatsby `gatsby-plugin-mdx`](https://www.gatsbyjs.org/docs/mdx/plugins/#remark-plugins), [Storybook docs](https://github.com/storybookjs/storybook/tree/master/addons/docs#manual-configuration), etc.

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

The file path is relative to the markdown file path.

You may also specify specific lines or ranges:

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



## Options

- `async`: By default, this plugin uses `readFileSync` to read the contents of the files. Set this to `true` if you want to use `readFile` for non-blocking IO.
- `preserveTrailingNewline`: By default, this plugin will trim the trailing newline of the file when importing the code. You can preserve the trailing new line in the code block by setting this option to `true`.
- `removeRedundantIndentations`: Set to `true` to remove redundant indentations for each line. For instance, the imported code of:
  ```
    First line
      Second line
  ```
  will become...
  ```
  First line
    Second line
  ```


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

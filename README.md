# `remark-code-import`

📝 Populate code blocks from files

[![npm version](https://badge.fury.io/js/remark-code-import.svg)](https://badge.fury.io/js/remark-code-import)

The plain remark version of [`gatsby-remark-import-code`](https://github.com/pomber/gatsby-remark-import-code).

## Installation

```sh
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

## Options

- `async`: By default, this plugin uses `readFileSync` to read the contents of the files. Set this to `true` if you want to use `readFile` for non-blocking IO.

## License

Kai Hao
[MIT](LICENSE)

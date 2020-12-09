#!/usr/bin/env node

/* eslint-disable max-len, flowtype/require-valid-file-annotation, flowtype/require-return-type */
/* global packageInformationStores, null, $$SETUP_STATIC_TABLES */

// Used for the resolveUnqualified part of the resolution (ie resolving folder/index.js & file extensions)
// Deconstructed so that they aren't affected by any fs monkeypatching occuring later during the execution
const {statSync, lstatSync, readlinkSync, readFileSync, existsSync, realpathSync} = require('fs');

const Module = require('module');
const path = require('path');
const StringDecoder = require('string_decoder');

const ignorePattern = null ? new RegExp(null) : null;

const builtinModules = new Set(Module.builtinModules || Object.keys(process.binding('natives')));

const topLevelLocator = {name: null, reference: null};
const blacklistedLocator = {name: NaN, reference: NaN};

// Used for compatibility purposes - cf setupCompatibilityLayer
const patchedModules = new Map();
const fallbackLocators = [topLevelLocator];

// Matches backslashes of Windows paths
const backwardSlashRegExp = /\\/g;

// Matches if the path must point to a directory (ie ends with /)
const isDirRegExp = /\/$/;

// Matches if the path starts with a valid path qualifier (./, ../, /)
// eslint-disable-next-line no-unused-vars
const isStrictRegExp = /^\.{0,2}\//;

// Splits a require request into its components, or return null if the request is a file path
const pathRegExp = /^(?!\.{0,2}(?:\/|$))((?:@[^\/]+\/)?[^\/]+)\/?(.*|)$/;

// Keep a reference around ("module" is a common name in this context, so better rename it to something more significant)
const pnpModule = module;

/**
 * Used to disable the resolution hooks (for when we want to fallback to the previous resolution - we then need
 * a way to "reset" the environment temporarily)
 */

let enableNativeHooks = true;

/**
 * Simple helper function that assign an error code to an error, so that it can more easily be caught and used
 * by third-parties.
 */

function makeError(code, message, data = {}) {
  const error = new Error(message);
  return Object.assign(error, {code, data});
}

/**
 * Ensures that the returned locator isn't a blacklisted one.
 *
 * Blacklisted packages are packages that cannot be used because their dependencies cannot be deduced. This only
 * happens with peer dependencies, which effectively have different sets of dependencies depending on their parents.
 *
 * In order to deambiguate those different sets of dependencies, the Yarn implementation of PnP will generate a
 * symlink for each combination of <package name>/<package version>/<dependent package> it will find, and will
 * blacklist the target of those symlinks. By doing this, we ensure that files loaded through a specific path
 * will always have the same set of dependencies, provided the symlinks are correctly preserved.
 *
 * Unfortunately, some tools do not preserve them, and when it happens PnP isn't able anymore to deduce the set of
 * dependencies based on the path of the file that makes the require calls. But since we've blacklisted those paths,
 * we're able to print a more helpful error message that points out that a third-party package is doing something
 * incompatible!
 */

// eslint-disable-next-line no-unused-vars
function blacklistCheck(locator) {
  if (locator === blacklistedLocator) {
    throw makeError(
      `BLACKLISTED`,
      [
        `A package has been resolved through a blacklisted path - this is usually caused by one of your tools calling`,
        `"realpath" on the return value of "require.resolve". Since the returned values use symlinks to disambiguate`,
        `peer dependencies, they must be passed untransformed to "require".`,
      ].join(` `),
    );
  }

  return locator;
}

let packageInformationStores = new Map([
  ["to-gatsby-remark-plugin", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-to-gatsby-remark-plugin-0.1.0-34167b2c3cf3209745cf97e5a488042586f9990d/node_modules/to-gatsby-remark-plugin/"),
      packageDependencies: new Map([
        ["to-vfile", "6.1.0"],
        ["to-gatsby-remark-plugin", "0.1.0"],
      ]),
    }],
  ])],
  ["to-vfile", new Map([
    ["6.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-to-vfile-6.1.0-5f7a3f65813c2c4e34ee1f7643a5646344627699/node_modules/to-vfile/"),
      packageDependencies: new Map([
        ["is-buffer", "2.0.5"],
        ["vfile", "4.2.0"],
        ["to-vfile", "6.1.0"],
      ]),
    }],
  ])],
  ["is-buffer", new Map([
    ["2.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-buffer-2.0.5-ebc252e400d22ff8d77fa09888821a24a658c191/node_modules/is-buffer/"),
      packageDependencies: new Map([
        ["is-buffer", "2.0.5"],
      ]),
    }],
    ["1.1.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-buffer-1.1.6-efaa2ea9daa0d7ab2ea13a97b2b8ad51fefbe8be/node_modules/is-buffer/"),
      packageDependencies: new Map([
        ["is-buffer", "1.1.6"],
      ]),
    }],
  ])],
  ["vfile", new Map([
    ["4.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-vfile-4.2.0-26c78ac92eb70816b01d4565e003b7e65a2a0e01/node_modules/vfile/"),
      packageDependencies: new Map([
        ["@types/unist", "2.0.3"],
        ["is-buffer", "2.0.5"],
        ["replace-ext", "1.0.0"],
        ["unist-util-stringify-position", "2.0.3"],
        ["vfile-message", "2.0.4"],
        ["vfile", "4.2.0"],
      ]),
    }],
  ])],
  ["@types/unist", new Map([
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@types-unist-2.0.3-9c088679876f374eb5983f150d4787aa6fb32d7e/node_modules/@types/unist/"),
      packageDependencies: new Map([
        ["@types/unist", "2.0.3"],
      ]),
    }],
  ])],
  ["replace-ext", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-replace-ext-1.0.0-de63128373fcbf7c3ccfa4de5a480c45a67958eb/node_modules/replace-ext/"),
      packageDependencies: new Map([
        ["replace-ext", "1.0.0"],
      ]),
    }],
  ])],
  ["unist-util-stringify-position", new Map([
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-unist-util-stringify-position-2.0.3-cce3bfa1cdf85ba7375d1d5b17bdc4cada9bd9da/node_modules/unist-util-stringify-position/"),
      packageDependencies: new Map([
        ["@types/unist", "2.0.3"],
        ["unist-util-stringify-position", "2.0.3"],
      ]),
    }],
  ])],
  ["vfile-message", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-vfile-message-2.0.4-5b43b88171d409eae58477d13f23dd41d52c371a/node_modules/vfile-message/"),
      packageDependencies: new Map([
        ["@types/unist", "2.0.3"],
        ["unist-util-stringify-position", "2.0.3"],
        ["vfile-message", "2.0.4"],
      ]),
    }],
  ])],
  ["unist-util-visit", new Map([
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-unist-util-visit-2.0.3-c3703893146df47203bb8a9795af47d7b971208c/node_modules/unist-util-visit/"),
      packageDependencies: new Map([
        ["@types/unist", "2.0.3"],
        ["unist-util-is", "4.0.4"],
        ["unist-util-visit-parents", "3.1.1"],
        ["unist-util-visit", "2.0.3"],
      ]),
    }],
  ])],
  ["unist-util-is", new Map([
    ["4.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-unist-util-is-4.0.4-3e9e8de6af2eb0039a59f50c9b3e99698a924f50/node_modules/unist-util-is/"),
      packageDependencies: new Map([
        ["unist-util-is", "4.0.4"],
      ]),
    }],
  ])],
  ["unist-util-visit-parents", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-unist-util-visit-parents-3.1.1-65a6ce698f78a6b0f56aa0e88f13801886cdaef6/node_modules/unist-util-visit-parents/"),
      packageDependencies: new Map([
        ["@types/unist", "2.0.3"],
        ["unist-util-is", "4.0.4"],
        ["unist-util-visit-parents", "3.1.1"],
      ]),
    }],
  ])],
  ["jest", new Map([
    ["26.6.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-26.6.3-40e8fdbe48f00dfa1f0ce8121ca74b88ac9148ef/node_modules/jest/"),
      packageDependencies: new Map([
        ["@jest/core", "26.6.3"],
        ["import-local", "3.0.2"],
        ["jest-cli", "26.6.3"],
        ["jest", "26.6.3"],
      ]),
    }],
  ])],
  ["@jest/core", new Map([
    ["26.6.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@jest-core-26.6.3-7639fcb3833d748a4656ada54bde193051e45fad/node_modules/@jest/core/"),
      packageDependencies: new Map([
        ["@jest/console", "26.6.2"],
        ["@jest/reporters", "26.6.2"],
        ["@jest/test-result", "26.6.2"],
        ["@jest/transform", "26.6.2"],
        ["@jest/types", "26.6.2"],
        ["@types/node", "14.14.10"],
        ["ansi-escapes", "4.3.1"],
        ["chalk", "4.1.0"],
        ["exit", "0.1.2"],
        ["graceful-fs", "4.2.4"],
        ["jest-changed-files", "26.6.2"],
        ["jest-config", "pnp:249ddef947a9ababda31301a1edf90989bee7687"],
        ["jest-haste-map", "26.6.2"],
        ["jest-message-util", "26.6.2"],
        ["jest-regex-util", "26.0.0"],
        ["jest-resolve", "26.6.2"],
        ["jest-resolve-dependencies", "26.6.3"],
        ["jest-runner", "26.6.3"],
        ["jest-runtime", "26.6.3"],
        ["jest-snapshot", "26.6.2"],
        ["jest-util", "26.6.2"],
        ["jest-validate", "26.6.2"],
        ["jest-watcher", "26.6.2"],
        ["micromatch", "4.0.2"],
        ["p-each-series", "2.2.0"],
        ["rimraf", "3.0.2"],
        ["slash", "3.0.0"],
        ["strip-ansi", "6.0.0"],
        ["@jest/core", "26.6.3"],
      ]),
    }],
  ])],
  ["@jest/console", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@jest-console-26.6.2-4e04bc464014358b03ab4937805ee36a0aeb98f2/node_modules/@jest/console/"),
      packageDependencies: new Map([
        ["@jest/types", "26.6.2"],
        ["@types/node", "14.14.10"],
        ["chalk", "4.1.0"],
        ["jest-message-util", "26.6.2"],
        ["jest-util", "26.6.2"],
        ["slash", "3.0.0"],
        ["@jest/console", "26.6.2"],
      ]),
    }],
  ])],
  ["@jest/types", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@jest-types-26.6.2-bef5a532030e1d88a2f5a6d933f84e97226ed48e/node_modules/@jest/types/"),
      packageDependencies: new Map([
        ["@types/istanbul-lib-coverage", "2.0.3"],
        ["@types/istanbul-reports", "3.0.0"],
        ["@types/node", "14.14.10"],
        ["@types/yargs", "15.0.10"],
        ["chalk", "4.1.0"],
        ["@jest/types", "26.6.2"],
      ]),
    }],
  ])],
  ["@types/istanbul-lib-coverage", new Map([
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@types-istanbul-lib-coverage-2.0.3-4ba8ddb720221f432e443bd5f9117fd22cfd4762/node_modules/@types/istanbul-lib-coverage/"),
      packageDependencies: new Map([
        ["@types/istanbul-lib-coverage", "2.0.3"],
      ]),
    }],
  ])],
  ["@types/istanbul-reports", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@types-istanbul-reports-3.0.0-508b13aa344fa4976234e75dddcc34925737d821/node_modules/@types/istanbul-reports/"),
      packageDependencies: new Map([
        ["@types/istanbul-lib-report", "3.0.0"],
        ["@types/istanbul-reports", "3.0.0"],
      ]),
    }],
  ])],
  ["@types/istanbul-lib-report", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@types-istanbul-lib-report-3.0.0-c14c24f18ea8190c118ee7562b7ff99a36552686/node_modules/@types/istanbul-lib-report/"),
      packageDependencies: new Map([
        ["@types/istanbul-lib-coverage", "2.0.3"],
        ["@types/istanbul-lib-report", "3.0.0"],
      ]),
    }],
  ])],
  ["@types/node", new Map([
    ["14.14.10", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@types-node-14.14.10-5958a82e41863cfc71f2307b3748e3491ba03785/node_modules/@types/node/"),
      packageDependencies: new Map([
        ["@types/node", "14.14.10"],
      ]),
    }],
  ])],
  ["@types/yargs", new Map([
    ["15.0.10", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@types-yargs-15.0.10-0fe3c8173a0d5c3e780b389050140c3f5ea6ea74/node_modules/@types/yargs/"),
      packageDependencies: new Map([
        ["@types/yargs-parser", "15.0.0"],
        ["@types/yargs", "15.0.10"],
      ]),
    }],
  ])],
  ["@types/yargs-parser", new Map([
    ["15.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@types-yargs-parser-15.0.0-cb3f9f741869e20cce330ffbeb9271590483882d/node_modules/@types/yargs-parser/"),
      packageDependencies: new Map([
        ["@types/yargs-parser", "15.0.0"],
      ]),
    }],
  ])],
  ["chalk", new Map([
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-chalk-4.1.0-4e14870a618d9e2edd97dd8345fd9d9dc315646a/node_modules/chalk/"),
      packageDependencies: new Map([
        ["ansi-styles", "4.3.0"],
        ["supports-color", "7.2.0"],
        ["chalk", "4.1.0"],
      ]),
    }],
    ["2.4.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-chalk-2.4.2-cd42541677a54333cf541a49108c1432b44c9424/node_modules/chalk/"),
      packageDependencies: new Map([
        ["ansi-styles", "3.2.1"],
        ["escape-string-regexp", "1.0.5"],
        ["supports-color", "5.5.0"],
        ["chalk", "2.4.2"],
      ]),
    }],
  ])],
  ["ansi-styles", new Map([
    ["4.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-ansi-styles-4.3.0-edd803628ae71c04c85ae7a0906edad34b648937/node_modules/ansi-styles/"),
      packageDependencies: new Map([
        ["color-convert", "2.0.1"],
        ["ansi-styles", "4.3.0"],
      ]),
    }],
    ["3.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-ansi-styles-3.2.1-41fbb20243e50b12be0f04b8dedbf07520ce841d/node_modules/ansi-styles/"),
      packageDependencies: new Map([
        ["color-convert", "1.9.3"],
        ["ansi-styles", "3.2.1"],
      ]),
    }],
  ])],
  ["color-convert", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-color-convert-2.0.1-72d3a68d598c9bdb3af2ad1e84f21d896abd4de3/node_modules/color-convert/"),
      packageDependencies: new Map([
        ["color-name", "1.1.4"],
        ["color-convert", "2.0.1"],
      ]),
    }],
    ["1.9.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-color-convert-1.9.3-bb71850690e1f136567de629d2d5471deda4c1e8/node_modules/color-convert/"),
      packageDependencies: new Map([
        ["color-name", "1.1.3"],
        ["color-convert", "1.9.3"],
      ]),
    }],
  ])],
  ["color-name", new Map([
    ["1.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-color-name-1.1.4-c2a09a87acbde69543de6f63fa3995c826c536a2/node_modules/color-name/"),
      packageDependencies: new Map([
        ["color-name", "1.1.4"],
      ]),
    }],
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-color-name-1.1.3-a7d0558bd89c42f795dd42328f740831ca53bc25/node_modules/color-name/"),
      packageDependencies: new Map([
        ["color-name", "1.1.3"],
      ]),
    }],
  ])],
  ["supports-color", new Map([
    ["7.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-supports-color-7.2.0-1b7dcdcb32b8138801b3e478ba6a51caa89648da/node_modules/supports-color/"),
      packageDependencies: new Map([
        ["has-flag", "4.0.0"],
        ["supports-color", "7.2.0"],
      ]),
    }],
    ["5.5.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-supports-color-5.5.0-e2e69a44ac8772f78a1ec0b35b689df6530efc8f/node_modules/supports-color/"),
      packageDependencies: new Map([
        ["has-flag", "3.0.0"],
        ["supports-color", "5.5.0"],
      ]),
    }],
  ])],
  ["has-flag", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-has-flag-4.0.0-944771fd9c81c81265c4d6941860da06bb59479b/node_modules/has-flag/"),
      packageDependencies: new Map([
        ["has-flag", "4.0.0"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-has-flag-3.0.0-b5d454dc2199ae225699f3467e5a07f3b955bafd/node_modules/has-flag/"),
      packageDependencies: new Map([
        ["has-flag", "3.0.0"],
      ]),
    }],
  ])],
  ["jest-message-util", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-message-util-26.6.2-58173744ad6fc0506b5d21150b9be56ef001ca07/node_modules/jest-message-util/"),
      packageDependencies: new Map([
        ["@babel/code-frame", "7.10.4"],
        ["@jest/types", "26.6.2"],
        ["@types/stack-utils", "2.0.0"],
        ["chalk", "4.1.0"],
        ["graceful-fs", "4.2.4"],
        ["micromatch", "4.0.2"],
        ["pretty-format", "26.6.2"],
        ["slash", "3.0.0"],
        ["stack-utils", "2.0.3"],
        ["jest-message-util", "26.6.2"],
      ]),
    }],
  ])],
  ["@babel/code-frame", new Map([
    ["7.10.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-code-frame-7.10.4-168da1a36e90da68ae8d49c0f1b48c7c6249213a/node_modules/@babel/code-frame/"),
      packageDependencies: new Map([
        ["@babel/highlight", "7.10.4"],
        ["@babel/code-frame", "7.10.4"],
      ]),
    }],
  ])],
  ["@babel/highlight", new Map([
    ["7.10.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-highlight-7.10.4-7d1bdfd65753538fabe6c38596cdb76d9ac60143/node_modules/@babel/highlight/"),
      packageDependencies: new Map([
        ["@babel/helper-validator-identifier", "7.10.4"],
        ["chalk", "2.4.2"],
        ["js-tokens", "4.0.0"],
        ["@babel/highlight", "7.10.4"],
      ]),
    }],
  ])],
  ["@babel/helper-validator-identifier", new Map([
    ["7.10.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-helper-validator-identifier-7.10.4-a78c7a7251e01f616512d31b10adcf52ada5e0d2/node_modules/@babel/helper-validator-identifier/"),
      packageDependencies: new Map([
        ["@babel/helper-validator-identifier", "7.10.4"],
      ]),
    }],
  ])],
  ["escape-string-regexp", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-escape-string-regexp-1.0.5-1b61c0562190a8dff6ae3bb2cf0200ca130b86d4/node_modules/escape-string-regexp/"),
      packageDependencies: new Map([
        ["escape-string-regexp", "1.0.5"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-escape-string-regexp-2.0.0-a30304e99daa32e23b2fd20f51babd07cffca344/node_modules/escape-string-regexp/"),
      packageDependencies: new Map([
        ["escape-string-regexp", "2.0.0"],
      ]),
    }],
  ])],
  ["js-tokens", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-js-tokens-4.0.0-19203fb59991df98e3a287050d4647cdeaf32499/node_modules/js-tokens/"),
      packageDependencies: new Map([
        ["js-tokens", "4.0.0"],
      ]),
    }],
  ])],
  ["@types/stack-utils", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@types-stack-utils-2.0.0-7036640b4e21cc2f259ae826ce843d277dad8cff/node_modules/@types/stack-utils/"),
      packageDependencies: new Map([
        ["@types/stack-utils", "2.0.0"],
      ]),
    }],
  ])],
  ["graceful-fs", new Map([
    ["4.2.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-graceful-fs-4.2.4-2256bde14d3632958c465ebc96dc467ca07a29fb/node_modules/graceful-fs/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.4"],
      ]),
    }],
  ])],
  ["micromatch", new Map([
    ["4.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-micromatch-4.0.2-4fcb0999bf9fbc2fcbdd212f6d629b9a56c39259/node_modules/micromatch/"),
      packageDependencies: new Map([
        ["braces", "3.0.2"],
        ["picomatch", "2.2.2"],
        ["micromatch", "4.0.2"],
      ]),
    }],
    ["3.1.10", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-micromatch-3.1.10-70859bc95c9840952f359a068a3fc49f9ecfac23/node_modules/micromatch/"),
      packageDependencies: new Map([
        ["arr-diff", "4.0.0"],
        ["array-unique", "0.3.2"],
        ["braces", "2.3.2"],
        ["define-property", "2.0.2"],
        ["extend-shallow", "3.0.2"],
        ["extglob", "2.0.4"],
        ["fragment-cache", "0.2.1"],
        ["kind-of", "6.0.3"],
        ["nanomatch", "1.2.13"],
        ["object.pick", "1.3.0"],
        ["regex-not", "1.0.2"],
        ["snapdragon", "0.8.2"],
        ["to-regex", "3.0.2"],
        ["micromatch", "3.1.10"],
      ]),
    }],
  ])],
  ["braces", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-braces-3.0.2-3454e1a462ee8d599e236df336cd9ea4f8afe107/node_modules/braces/"),
      packageDependencies: new Map([
        ["fill-range", "7.0.1"],
        ["braces", "3.0.2"],
      ]),
    }],
    ["2.3.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-braces-2.3.2-5979fd3f14cd531565e5fa2df1abfff1dfaee729/node_modules/braces/"),
      packageDependencies: new Map([
        ["arr-flatten", "1.1.0"],
        ["array-unique", "0.3.2"],
        ["extend-shallow", "2.0.1"],
        ["fill-range", "4.0.0"],
        ["isobject", "3.0.1"],
        ["repeat-element", "1.1.3"],
        ["snapdragon", "0.8.2"],
        ["snapdragon-node", "2.1.1"],
        ["split-string", "3.1.0"],
        ["to-regex", "3.0.2"],
        ["braces", "2.3.2"],
      ]),
    }],
  ])],
  ["fill-range", new Map([
    ["7.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-fill-range-7.0.1-1919a6a7c75fe38b2c7c77e5198535da9acdda40/node_modules/fill-range/"),
      packageDependencies: new Map([
        ["to-regex-range", "5.0.1"],
        ["fill-range", "7.0.1"],
      ]),
    }],
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-fill-range-4.0.0-d544811d428f98eb06a63dc402d2403c328c38f7/node_modules/fill-range/"),
      packageDependencies: new Map([
        ["extend-shallow", "2.0.1"],
        ["is-number", "3.0.0"],
        ["repeat-string", "1.6.1"],
        ["to-regex-range", "2.1.1"],
        ["fill-range", "4.0.0"],
      ]),
    }],
  ])],
  ["to-regex-range", new Map([
    ["5.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-to-regex-range-5.0.1-1648c44aae7c8d988a326018ed72f5b4dd0392e4/node_modules/to-regex-range/"),
      packageDependencies: new Map([
        ["is-number", "7.0.0"],
        ["to-regex-range", "5.0.1"],
      ]),
    }],
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-to-regex-range-2.1.1-7c80c17b9dfebe599e27367e0d4dd5590141db38/node_modules/to-regex-range/"),
      packageDependencies: new Map([
        ["is-number", "3.0.0"],
        ["repeat-string", "1.6.1"],
        ["to-regex-range", "2.1.1"],
      ]),
    }],
  ])],
  ["is-number", new Map([
    ["7.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-number-7.0.0-7535345b896734d5f80c4d06c50955527a14f12b/node_modules/is-number/"),
      packageDependencies: new Map([
        ["is-number", "7.0.0"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-number-3.0.0-24fd6201a4782cf50561c810276afc7d12d71195/node_modules/is-number/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["is-number", "3.0.0"],
      ]),
    }],
  ])],
  ["picomatch", new Map([
    ["2.2.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-picomatch-2.2.2-21f333e9b6b8eaff02468f5146ea406d345f4dad/node_modules/picomatch/"),
      packageDependencies: new Map([
        ["picomatch", "2.2.2"],
      ]),
    }],
  ])],
  ["pretty-format", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-pretty-format-26.6.2-e35c2705f14cb7fe2fe94fa078345b444120fc93/node_modules/pretty-format/"),
      packageDependencies: new Map([
        ["@jest/types", "26.6.2"],
        ["ansi-regex", "5.0.0"],
        ["ansi-styles", "4.3.0"],
        ["react-is", "17.0.1"],
        ["pretty-format", "26.6.2"],
      ]),
    }],
  ])],
  ["ansi-regex", new Map([
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-ansi-regex-5.0.0-388539f55179bf39339c81af30a654d69f87cb75/node_modules/ansi-regex/"),
      packageDependencies: new Map([
        ["ansi-regex", "5.0.0"],
      ]),
    }],
  ])],
  ["react-is", new Map([
    ["17.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-react-is-17.0.1-5b3531bd76a645a4c9fb6e693ed36419e3301339/node_modules/react-is/"),
      packageDependencies: new Map([
        ["react-is", "17.0.1"],
      ]),
    }],
  ])],
  ["slash", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-slash-3.0.0-6539be870c165adbd5240220dbe361f1bc4d4634/node_modules/slash/"),
      packageDependencies: new Map([
        ["slash", "3.0.0"],
      ]),
    }],
  ])],
  ["stack-utils", new Map([
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-stack-utils-2.0.3-cd5f030126ff116b78ccb3c027fe302713b61277/node_modules/stack-utils/"),
      packageDependencies: new Map([
        ["escape-string-regexp", "2.0.0"],
        ["stack-utils", "2.0.3"],
      ]),
    }],
  ])],
  ["jest-util", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-util-26.6.2-907535dbe4d5a6cb4c47ac9b926f6af29576cbc1/node_modules/jest-util/"),
      packageDependencies: new Map([
        ["@jest/types", "26.6.2"],
        ["@types/node", "14.14.10"],
        ["chalk", "4.1.0"],
        ["graceful-fs", "4.2.4"],
        ["is-ci", "2.0.0"],
        ["micromatch", "4.0.2"],
        ["jest-util", "26.6.2"],
      ]),
    }],
  ])],
  ["is-ci", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-ci-2.0.0-6bc6334181810e04b5c22b3d589fdca55026404c/node_modules/is-ci/"),
      packageDependencies: new Map([
        ["ci-info", "2.0.0"],
        ["is-ci", "2.0.0"],
      ]),
    }],
  ])],
  ["ci-info", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-ci-info-2.0.0-67a9e964be31a51e15e5010d58e6f12834002f46/node_modules/ci-info/"),
      packageDependencies: new Map([
        ["ci-info", "2.0.0"],
      ]),
    }],
  ])],
  ["@jest/reporters", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@jest-reporters-26.6.2-1f518b99637a5f18307bd3ecf9275f6882a667f6/node_modules/@jest/reporters/"),
      packageDependencies: new Map([
        ["@bcoe/v8-coverage", "0.2.3"],
        ["@jest/console", "26.6.2"],
        ["@jest/test-result", "26.6.2"],
        ["@jest/transform", "26.6.2"],
        ["@jest/types", "26.6.2"],
        ["chalk", "4.1.0"],
        ["collect-v8-coverage", "1.0.1"],
        ["exit", "0.1.2"],
        ["glob", "7.1.6"],
        ["graceful-fs", "4.2.4"],
        ["istanbul-lib-coverage", "3.0.0"],
        ["istanbul-lib-instrument", "4.0.3"],
        ["istanbul-lib-report", "3.0.0"],
        ["istanbul-lib-source-maps", "4.0.0"],
        ["istanbul-reports", "3.0.2"],
        ["jest-haste-map", "26.6.2"],
        ["jest-resolve", "26.6.2"],
        ["jest-util", "26.6.2"],
        ["jest-worker", "26.6.2"],
        ["slash", "3.0.0"],
        ["source-map", "0.6.1"],
        ["string-length", "4.0.1"],
        ["terminal-link", "2.1.1"],
        ["v8-to-istanbul", "7.0.0"],
        ["node-notifier", "8.0.0"],
        ["@jest/reporters", "26.6.2"],
      ]),
    }],
  ])],
  ["@bcoe/v8-coverage", new Map([
    ["0.2.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@bcoe-v8-coverage-0.2.3-75a2e8b51cb758a7553d6804a5932d7aace75c39/node_modules/@bcoe/v8-coverage/"),
      packageDependencies: new Map([
        ["@bcoe/v8-coverage", "0.2.3"],
      ]),
    }],
  ])],
  ["@jest/test-result", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@jest-test-result-26.6.2-55da58b62df134576cc95476efa5f7949e3f5f18/node_modules/@jest/test-result/"),
      packageDependencies: new Map([
        ["@jest/console", "26.6.2"],
        ["@jest/types", "26.6.2"],
        ["@types/istanbul-lib-coverage", "2.0.3"],
        ["collect-v8-coverage", "1.0.1"],
        ["@jest/test-result", "26.6.2"],
      ]),
    }],
  ])],
  ["collect-v8-coverage", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-collect-v8-coverage-1.0.1-cc2c8e94fc18bbdffe64d6534570c8a673b27f59/node_modules/collect-v8-coverage/"),
      packageDependencies: new Map([
        ["collect-v8-coverage", "1.0.1"],
      ]),
    }],
  ])],
  ["@jest/transform", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@jest-transform-26.6.2-5ac57c5fa1ad17b2aae83e73e45813894dcf2e4b/node_modules/@jest/transform/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["@jest/types", "26.6.2"],
        ["babel-plugin-istanbul", "6.0.0"],
        ["chalk", "4.1.0"],
        ["convert-source-map", "1.7.0"],
        ["fast-json-stable-stringify", "2.1.0"],
        ["graceful-fs", "4.2.4"],
        ["jest-haste-map", "26.6.2"],
        ["jest-regex-util", "26.0.0"],
        ["jest-util", "26.6.2"],
        ["micromatch", "4.0.2"],
        ["pirates", "4.0.1"],
        ["slash", "3.0.0"],
        ["source-map", "0.6.1"],
        ["write-file-atomic", "3.0.3"],
        ["@jest/transform", "26.6.2"],
      ]),
    }],
  ])],
  ["@babel/core", new Map([
    ["7.12.9", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-core-7.12.9-fd450c4ec10cdbb980e2928b7aa7a28484593fc8/node_modules/@babel/core/"),
      packageDependencies: new Map([
        ["@babel/code-frame", "7.10.4"],
        ["@babel/generator", "7.12.5"],
        ["@babel/helper-module-transforms", "7.12.1"],
        ["@babel/helpers", "7.12.5"],
        ["@babel/parser", "7.12.7"],
        ["@babel/template", "7.12.7"],
        ["@babel/traverse", "7.12.9"],
        ["@babel/types", "7.12.7"],
        ["convert-source-map", "1.7.0"],
        ["debug", "4.3.1"],
        ["gensync", "1.0.0-beta.2"],
        ["json5", "2.1.3"],
        ["lodash", "4.17.20"],
        ["resolve", "1.19.0"],
        ["semver", "5.7.1"],
        ["source-map", "0.5.7"],
        ["@babel/core", "7.12.9"],
      ]),
    }],
  ])],
  ["@babel/generator", new Map([
    ["7.12.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-generator-7.12.5-a2c50de5c8b6d708ab95be5e6053936c1884a4de/node_modules/@babel/generator/"),
      packageDependencies: new Map([
        ["@babel/types", "7.12.7"],
        ["jsesc", "2.5.2"],
        ["source-map", "0.5.7"],
        ["@babel/generator", "7.12.5"],
      ]),
    }],
  ])],
  ["@babel/types", new Map([
    ["7.12.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-types-7.12.7-6039ff1e242640a29452c9ae572162ec9a8f5d13/node_modules/@babel/types/"),
      packageDependencies: new Map([
        ["@babel/helper-validator-identifier", "7.10.4"],
        ["lodash", "4.17.20"],
        ["to-fast-properties", "2.0.0"],
        ["@babel/types", "7.12.7"],
      ]),
    }],
  ])],
  ["lodash", new Map([
    ["4.17.20", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-lodash-4.17.20-b44a9b6297bcb698f1c51a3545a2b3b368d59c52/node_modules/lodash/"),
      packageDependencies: new Map([
        ["lodash", "4.17.20"],
      ]),
    }],
  ])],
  ["to-fast-properties", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-to-fast-properties-2.0.0-dc5e698cbd079265bc73e0377681a4e4e83f616e/node_modules/to-fast-properties/"),
      packageDependencies: new Map([
        ["to-fast-properties", "2.0.0"],
      ]),
    }],
  ])],
  ["jsesc", new Map([
    ["2.5.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jsesc-2.5.2-80564d2e483dacf6e8ef209650a67df3f0c283a4/node_modules/jsesc/"),
      packageDependencies: new Map([
        ["jsesc", "2.5.2"],
      ]),
    }],
  ])],
  ["source-map", new Map([
    ["0.5.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-source-map-0.5.7-8a039d2d1021d22d1ea14c80d8ea468ba2ef3fcc/node_modules/source-map/"),
      packageDependencies: new Map([
        ["source-map", "0.5.7"],
      ]),
    }],
    ["0.6.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-source-map-0.6.1-74722af32e9614e9c287a8d0bbde48b5e2f1a263/node_modules/source-map/"),
      packageDependencies: new Map([
        ["source-map", "0.6.1"],
      ]),
    }],
    ["0.7.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-source-map-0.7.3-5302f8169031735226544092e64981f751750383/node_modules/source-map/"),
      packageDependencies: new Map([
        ["source-map", "0.7.3"],
      ]),
    }],
  ])],
  ["@babel/helper-module-transforms", new Map([
    ["7.12.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-helper-module-transforms-7.12.1-7954fec71f5b32c48e4b303b437c34453fd7247c/node_modules/@babel/helper-module-transforms/"),
      packageDependencies: new Map([
        ["@babel/helper-module-imports", "7.12.5"],
        ["@babel/helper-replace-supers", "7.12.5"],
        ["@babel/helper-simple-access", "7.12.1"],
        ["@babel/helper-split-export-declaration", "7.11.0"],
        ["@babel/helper-validator-identifier", "7.10.4"],
        ["@babel/template", "7.12.7"],
        ["@babel/traverse", "7.12.9"],
        ["@babel/types", "7.12.7"],
        ["lodash", "4.17.20"],
        ["@babel/helper-module-transforms", "7.12.1"],
      ]),
    }],
  ])],
  ["@babel/helper-module-imports", new Map([
    ["7.12.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-helper-module-imports-7.12.5-1bfc0229f794988f76ed0a4d4e90860850b54dfb/node_modules/@babel/helper-module-imports/"),
      packageDependencies: new Map([
        ["@babel/types", "7.12.7"],
        ["@babel/helper-module-imports", "7.12.5"],
      ]),
    }],
  ])],
  ["@babel/helper-replace-supers", new Map([
    ["7.12.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-helper-replace-supers-7.12.5-f009a17543bbbbce16b06206ae73b63d3fca68d9/node_modules/@babel/helper-replace-supers/"),
      packageDependencies: new Map([
        ["@babel/helper-member-expression-to-functions", "7.12.7"],
        ["@babel/helper-optimise-call-expression", "7.12.7"],
        ["@babel/traverse", "7.12.9"],
        ["@babel/types", "7.12.7"],
        ["@babel/helper-replace-supers", "7.12.5"],
      ]),
    }],
  ])],
  ["@babel/helper-member-expression-to-functions", new Map([
    ["7.12.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-helper-member-expression-to-functions-7.12.7-aa77bd0396ec8114e5e30787efa78599d874a855/node_modules/@babel/helper-member-expression-to-functions/"),
      packageDependencies: new Map([
        ["@babel/types", "7.12.7"],
        ["@babel/helper-member-expression-to-functions", "7.12.7"],
      ]),
    }],
  ])],
  ["@babel/helper-optimise-call-expression", new Map([
    ["7.12.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-helper-optimise-call-expression-7.12.7-7f94ae5e08721a49467346aa04fd22f750033b9c/node_modules/@babel/helper-optimise-call-expression/"),
      packageDependencies: new Map([
        ["@babel/types", "7.12.7"],
        ["@babel/helper-optimise-call-expression", "7.12.7"],
      ]),
    }],
  ])],
  ["@babel/traverse", new Map([
    ["7.12.9", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-traverse-7.12.9-fad26c972eabbc11350e0b695978de6cc8e8596f/node_modules/@babel/traverse/"),
      packageDependencies: new Map([
        ["@babel/code-frame", "7.10.4"],
        ["@babel/generator", "7.12.5"],
        ["@babel/helper-function-name", "7.10.4"],
        ["@babel/helper-split-export-declaration", "7.11.0"],
        ["@babel/parser", "7.12.7"],
        ["@babel/types", "7.12.7"],
        ["debug", "4.3.1"],
        ["globals", "11.12.0"],
        ["lodash", "4.17.20"],
        ["@babel/traverse", "7.12.9"],
      ]),
    }],
  ])],
  ["@babel/helper-function-name", new Map([
    ["7.10.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-helper-function-name-7.10.4-d2d3b20c59ad8c47112fa7d2a94bc09d5ef82f1a/node_modules/@babel/helper-function-name/"),
      packageDependencies: new Map([
        ["@babel/helper-get-function-arity", "7.10.4"],
        ["@babel/template", "7.12.7"],
        ["@babel/types", "7.12.7"],
        ["@babel/helper-function-name", "7.10.4"],
      ]),
    }],
  ])],
  ["@babel/helper-get-function-arity", new Map([
    ["7.10.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-helper-get-function-arity-7.10.4-98c1cbea0e2332f33f9a4661b8ce1505b2c19ba2/node_modules/@babel/helper-get-function-arity/"),
      packageDependencies: new Map([
        ["@babel/types", "7.12.7"],
        ["@babel/helper-get-function-arity", "7.10.4"],
      ]),
    }],
  ])],
  ["@babel/template", new Map([
    ["7.12.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-template-7.12.7-c817233696018e39fbb6c491d2fb684e05ed43bc/node_modules/@babel/template/"),
      packageDependencies: new Map([
        ["@babel/code-frame", "7.10.4"],
        ["@babel/parser", "7.12.7"],
        ["@babel/types", "7.12.7"],
        ["@babel/template", "7.12.7"],
      ]),
    }],
  ])],
  ["@babel/parser", new Map([
    ["7.12.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-parser-7.12.7-fee7b39fe809d0e73e5b25eecaf5780ef3d73056/node_modules/@babel/parser/"),
      packageDependencies: new Map([
        ["@babel/parser", "7.12.7"],
      ]),
    }],
  ])],
  ["@babel/helper-split-export-declaration", new Map([
    ["7.11.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-helper-split-export-declaration-7.11.0-f8a491244acf6a676158ac42072911ba83ad099f/node_modules/@babel/helper-split-export-declaration/"),
      packageDependencies: new Map([
        ["@babel/types", "7.12.7"],
        ["@babel/helper-split-export-declaration", "7.11.0"],
      ]),
    }],
  ])],
  ["debug", new Map([
    ["4.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-debug-4.3.1-f0d229c505e0c6d8c49ac553d1b13dc183f6b2ee/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.1.2"],
        ["debug", "4.3.1"],
      ]),
    }],
    ["2.6.9", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-debug-2.6.9-5d128515df134ff327e90a4c93f4e077a536341f/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
        ["debug", "2.6.9"],
      ]),
    }],
  ])],
  ["ms", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-ms-2.1.2-d09d1f357b443f493382a8eb3ccd183872ae6009/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "2.1.2"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-ms-2.0.0-5608aeadfc00be6c2901df5f9861788de0d597c8/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
      ]),
    }],
  ])],
  ["globals", new Map([
    ["11.12.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-globals-11.12.0-ab8795338868a0babd8525758018c2a7eb95c42e/node_modules/globals/"),
      packageDependencies: new Map([
        ["globals", "11.12.0"],
      ]),
    }],
  ])],
  ["@babel/helper-simple-access", new Map([
    ["7.12.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-helper-simple-access-7.12.1-32427e5aa61547d38eb1e6eaf5fd1426fdad9136/node_modules/@babel/helper-simple-access/"),
      packageDependencies: new Map([
        ["@babel/types", "7.12.7"],
        ["@babel/helper-simple-access", "7.12.1"],
      ]),
    }],
  ])],
  ["@babel/helpers", new Map([
    ["7.12.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-helpers-7.12.5-1a1ba4a768d9b58310eda516c449913fe647116e/node_modules/@babel/helpers/"),
      packageDependencies: new Map([
        ["@babel/template", "7.12.7"],
        ["@babel/traverse", "7.12.9"],
        ["@babel/types", "7.12.7"],
        ["@babel/helpers", "7.12.5"],
      ]),
    }],
  ])],
  ["convert-source-map", new Map([
    ["1.7.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-convert-source-map-1.7.0-17a2cb882d7f77d3490585e2ce6c524424a3a442/node_modules/convert-source-map/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
        ["convert-source-map", "1.7.0"],
      ]),
    }],
  ])],
  ["safe-buffer", new Map([
    ["5.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-safe-buffer-5.1.2-991ec69d296e0313747d59bdfd2b745c35f8828d/node_modules/safe-buffer/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
      ]),
    }],
    ["5.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-safe-buffer-5.2.1-1eaf9fa9bdb1fdd4ec75f58f9cdb4e6b7827eec6/node_modules/safe-buffer/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.2.1"],
      ]),
    }],
  ])],
  ["gensync", new Map([
    ["1.0.0-beta.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-gensync-1.0.0-beta.2-32a6ee76c3d7f52d46b2b1ae5d93fea8580a25e0/node_modules/gensync/"),
      packageDependencies: new Map([
        ["gensync", "1.0.0-beta.2"],
      ]),
    }],
  ])],
  ["json5", new Map([
    ["2.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-json5-2.1.3-c9b0f7fa9233bfe5807fe66fcf3a5617ed597d43/node_modules/json5/"),
      packageDependencies: new Map([
        ["minimist", "1.2.5"],
        ["json5", "2.1.3"],
      ]),
    }],
  ])],
  ["minimist", new Map([
    ["1.2.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-minimist-1.2.5-67d66014b66a6a8aaa0c083c5fd58df4e4e97602/node_modules/minimist/"),
      packageDependencies: new Map([
        ["minimist", "1.2.5"],
      ]),
    }],
  ])],
  ["resolve", new Map([
    ["1.19.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-resolve-1.19.0-1af5bf630409734a067cae29318aac7fa29a267c/node_modules/resolve/"),
      packageDependencies: new Map([
        ["is-core-module", "2.2.0"],
        ["path-parse", "1.0.6"],
        ["resolve", "1.19.0"],
      ]),
    }],
  ])],
  ["is-core-module", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-core-module-2.2.0-97037ef3d52224d85163f5597b2b63d9afed981a/node_modules/is-core-module/"),
      packageDependencies: new Map([
        ["has", "1.0.3"],
        ["is-core-module", "2.2.0"],
      ]),
    }],
  ])],
  ["has", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-has-1.0.3-722d7cbfc1f6aa8241f16dd814e011e1f41e8796/node_modules/has/"),
      packageDependencies: new Map([
        ["function-bind", "1.1.1"],
        ["has", "1.0.3"],
      ]),
    }],
  ])],
  ["function-bind", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-function-bind-1.1.1-a56899d3ea3c9bab874bb9773b7c5ede92f4895d/node_modules/function-bind/"),
      packageDependencies: new Map([
        ["function-bind", "1.1.1"],
      ]),
    }],
  ])],
  ["path-parse", new Map([
    ["1.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-path-parse-1.0.6-d62dbb5679405d72c4737ec58600e9ddcf06d24c/node_modules/path-parse/"),
      packageDependencies: new Map([
        ["path-parse", "1.0.6"],
      ]),
    }],
  ])],
  ["semver", new Map([
    ["5.7.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-semver-5.7.1-a954f931aeba508d307bbf069eff0c01c96116f7/node_modules/semver/"),
      packageDependencies: new Map([
        ["semver", "5.7.1"],
      ]),
    }],
    ["6.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-semver-6.3.0-ee0a64c8af5e8ceea67687b133761e1becbd1d3d/node_modules/semver/"),
      packageDependencies: new Map([
        ["semver", "6.3.0"],
      ]),
    }],
    ["7.3.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-semver-7.3.2-604962b052b81ed0786aae84389ffba70ffd3938/node_modules/semver/"),
      packageDependencies: new Map([
        ["semver", "7.3.2"],
      ]),
    }],
  ])],
  ["babel-plugin-istanbul", new Map([
    ["6.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-babel-plugin-istanbul-6.0.0-e159ccdc9af95e0b570c75b4573b7c34d671d765/node_modules/babel-plugin-istanbul/"),
      packageDependencies: new Map([
        ["@babel/helper-plugin-utils", "7.10.4"],
        ["@istanbuljs/load-nyc-config", "1.1.0"],
        ["@istanbuljs/schema", "0.1.2"],
        ["istanbul-lib-instrument", "4.0.3"],
        ["test-exclude", "6.0.0"],
        ["babel-plugin-istanbul", "6.0.0"],
      ]),
    }],
  ])],
  ["@babel/helper-plugin-utils", new Map([
    ["7.10.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-helper-plugin-utils-7.10.4-2f75a831269d4f677de49986dff59927533cf375/node_modules/@babel/helper-plugin-utils/"),
      packageDependencies: new Map([
        ["@babel/helper-plugin-utils", "7.10.4"],
      ]),
    }],
  ])],
  ["@istanbuljs/load-nyc-config", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@istanbuljs-load-nyc-config-1.1.0-fd3db1d59ecf7cf121e80650bb86712f9b55eced/node_modules/@istanbuljs/load-nyc-config/"),
      packageDependencies: new Map([
        ["camelcase", "5.3.1"],
        ["find-up", "4.1.0"],
        ["get-package-type", "0.1.0"],
        ["js-yaml", "3.14.0"],
        ["resolve-from", "5.0.0"],
        ["@istanbuljs/load-nyc-config", "1.1.0"],
      ]),
    }],
  ])],
  ["camelcase", new Map([
    ["5.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-camelcase-5.3.1-e3c9b31569e106811df242f715725a1f4c494320/node_modules/camelcase/"),
      packageDependencies: new Map([
        ["camelcase", "5.3.1"],
      ]),
    }],
    ["6.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-camelcase-6.2.0-924af881c9d525ac9d87f40d964e5cea982a1809/node_modules/camelcase/"),
      packageDependencies: new Map([
        ["camelcase", "6.2.0"],
      ]),
    }],
  ])],
  ["find-up", new Map([
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-find-up-4.1.0-97afe7d6cdc0bc5928584b7c8d7b16e8a9aa5d19/node_modules/find-up/"),
      packageDependencies: new Map([
        ["locate-path", "5.0.0"],
        ["path-exists", "4.0.0"],
        ["find-up", "4.1.0"],
      ]),
    }],
  ])],
  ["locate-path", new Map([
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-locate-path-5.0.0-1afba396afd676a6d42504d0a67a3a7eb9f62aa0/node_modules/locate-path/"),
      packageDependencies: new Map([
        ["p-locate", "4.1.0"],
        ["locate-path", "5.0.0"],
      ]),
    }],
  ])],
  ["p-locate", new Map([
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-p-locate-4.1.0-a3428bb7088b3a60292f66919278b7c297ad4f07/node_modules/p-locate/"),
      packageDependencies: new Map([
        ["p-limit", "2.3.0"],
        ["p-locate", "4.1.0"],
      ]),
    }],
  ])],
  ["p-limit", new Map([
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-p-limit-2.3.0-3dd33c647a214fdfffd835933eb086da0dc21db1/node_modules/p-limit/"),
      packageDependencies: new Map([
        ["p-try", "2.2.0"],
        ["p-limit", "2.3.0"],
      ]),
    }],
  ])],
  ["p-try", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-p-try-2.2.0-cb2868540e313d61de58fafbe35ce9004d5540e6/node_modules/p-try/"),
      packageDependencies: new Map([
        ["p-try", "2.2.0"],
      ]),
    }],
  ])],
  ["path-exists", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-path-exists-4.0.0-513bdbe2d3b95d7762e8c1137efa195c6c61b5b3/node_modules/path-exists/"),
      packageDependencies: new Map([
        ["path-exists", "4.0.0"],
      ]),
    }],
  ])],
  ["get-package-type", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-get-package-type-0.1.0-8de2d803cff44df3bc6c456e6668b36c3926e11a/node_modules/get-package-type/"),
      packageDependencies: new Map([
        ["get-package-type", "0.1.0"],
      ]),
    }],
  ])],
  ["js-yaml", new Map([
    ["3.14.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-js-yaml-3.14.0-a7a34170f26a21bb162424d8adacb4113a69e482/node_modules/js-yaml/"),
      packageDependencies: new Map([
        ["argparse", "1.0.10"],
        ["esprima", "4.0.1"],
        ["js-yaml", "3.14.0"],
      ]),
    }],
  ])],
  ["argparse", new Map([
    ["1.0.10", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-argparse-1.0.10-bcd6791ea5ae09725e17e5ad988134cd40b3d911/node_modules/argparse/"),
      packageDependencies: new Map([
        ["sprintf-js", "1.0.3"],
        ["argparse", "1.0.10"],
      ]),
    }],
  ])],
  ["sprintf-js", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-sprintf-js-1.0.3-04e6926f662895354f3dd015203633b857297e2c/node_modules/sprintf-js/"),
      packageDependencies: new Map([
        ["sprintf-js", "1.0.3"],
      ]),
    }],
  ])],
  ["esprima", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-esprima-4.0.1-13b04cdb3e6c5d19df91ab6987a8695619b0aa71/node_modules/esprima/"),
      packageDependencies: new Map([
        ["esprima", "4.0.1"],
      ]),
    }],
  ])],
  ["resolve-from", new Map([
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-resolve-from-5.0.0-c35225843df8f776df21c57557bc087e9dfdfc69/node_modules/resolve-from/"),
      packageDependencies: new Map([
        ["resolve-from", "5.0.0"],
      ]),
    }],
  ])],
  ["@istanbuljs/schema", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@istanbuljs-schema-0.1.2-26520bf09abe4a5644cd5414e37125a8954241dd/node_modules/@istanbuljs/schema/"),
      packageDependencies: new Map([
        ["@istanbuljs/schema", "0.1.2"],
      ]),
    }],
  ])],
  ["istanbul-lib-instrument", new Map([
    ["4.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-istanbul-lib-instrument-4.0.3-873c6fff897450118222774696a3f28902d77c1d/node_modules/istanbul-lib-instrument/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["@istanbuljs/schema", "0.1.2"],
        ["istanbul-lib-coverage", "3.0.0"],
        ["semver", "6.3.0"],
        ["istanbul-lib-instrument", "4.0.3"],
      ]),
    }],
  ])],
  ["istanbul-lib-coverage", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-istanbul-lib-coverage-3.0.0-f5944a37c70b550b02a78a5c3b2055b280cec8ec/node_modules/istanbul-lib-coverage/"),
      packageDependencies: new Map([
        ["istanbul-lib-coverage", "3.0.0"],
      ]),
    }],
  ])],
  ["test-exclude", new Map([
    ["6.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-test-exclude-6.0.0-04a8698661d805ea6fa293b6cb9e63ac044ef15e/node_modules/test-exclude/"),
      packageDependencies: new Map([
        ["@istanbuljs/schema", "0.1.2"],
        ["glob", "7.1.6"],
        ["minimatch", "3.0.4"],
        ["test-exclude", "6.0.0"],
      ]),
    }],
  ])],
  ["glob", new Map([
    ["7.1.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-glob-7.1.6-141f33b81a7c2492e125594307480c46679278a6/node_modules/glob/"),
      packageDependencies: new Map([
        ["fs.realpath", "1.0.0"],
        ["inflight", "1.0.6"],
        ["inherits", "2.0.4"],
        ["minimatch", "3.0.4"],
        ["once", "1.4.0"],
        ["path-is-absolute", "1.0.1"],
        ["glob", "7.1.6"],
      ]),
    }],
  ])],
  ["fs.realpath", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-fs-realpath-1.0.0-1504ad2523158caa40db4a2787cb01411994ea4f/node_modules/fs.realpath/"),
      packageDependencies: new Map([
        ["fs.realpath", "1.0.0"],
      ]),
    }],
  ])],
  ["inflight", new Map([
    ["1.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-inflight-1.0.6-49bd6331d7d02d0c09bc910a1075ba8165b56df9/node_modules/inflight/"),
      packageDependencies: new Map([
        ["once", "1.4.0"],
        ["wrappy", "1.0.2"],
        ["inflight", "1.0.6"],
      ]),
    }],
  ])],
  ["once", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-once-1.4.0-583b1aa775961d4b113ac17d9c50baef9dd76bd1/node_modules/once/"),
      packageDependencies: new Map([
        ["wrappy", "1.0.2"],
        ["once", "1.4.0"],
      ]),
    }],
  ])],
  ["wrappy", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-wrappy-1.0.2-b5243d8f3ec1aa35f1364605bc0d1036e30ab69f/node_modules/wrappy/"),
      packageDependencies: new Map([
        ["wrappy", "1.0.2"],
      ]),
    }],
  ])],
  ["inherits", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-inherits-2.0.4-0fa2c64f932917c3433a0ded55363aae37416b7c/node_modules/inherits/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
      ]),
    }],
  ])],
  ["minimatch", new Map([
    ["3.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-minimatch-3.0.4-5166e286457f03306064be5497e8dbb0c3d32083/node_modules/minimatch/"),
      packageDependencies: new Map([
        ["brace-expansion", "1.1.11"],
        ["minimatch", "3.0.4"],
      ]),
    }],
  ])],
  ["brace-expansion", new Map([
    ["1.1.11", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-brace-expansion-1.1.11-3c7fcbf529d87226f3d2f52b966ff5271eb441dd/node_modules/brace-expansion/"),
      packageDependencies: new Map([
        ["balanced-match", "1.0.0"],
        ["concat-map", "0.0.1"],
        ["brace-expansion", "1.1.11"],
      ]),
    }],
  ])],
  ["balanced-match", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-balanced-match-1.0.0-89b4d199ab2bee49de164ea02b89ce462d71b767/node_modules/balanced-match/"),
      packageDependencies: new Map([
        ["balanced-match", "1.0.0"],
      ]),
    }],
  ])],
  ["concat-map", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-concat-map-0.0.1-d8a96bd77fd68df7793a73036a3ba0d5405d477b/node_modules/concat-map/"),
      packageDependencies: new Map([
        ["concat-map", "0.0.1"],
      ]),
    }],
  ])],
  ["path-is-absolute", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-path-is-absolute-1.0.1-174b9268735534ffbc7ace6bf53a5a9e1b5c5f5f/node_modules/path-is-absolute/"),
      packageDependencies: new Map([
        ["path-is-absolute", "1.0.1"],
      ]),
    }],
  ])],
  ["fast-json-stable-stringify", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-fast-json-stable-stringify-2.1.0-874bf69c6f404c2b5d99c481341399fd55892633/node_modules/fast-json-stable-stringify/"),
      packageDependencies: new Map([
        ["fast-json-stable-stringify", "2.1.0"],
      ]),
    }],
  ])],
  ["jest-haste-map", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-haste-map-26.6.2-dd7e60fe7dc0e9f911a23d79c5ff7fb5c2cafeaa/node_modules/jest-haste-map/"),
      packageDependencies: new Map([
        ["@jest/types", "26.6.2"],
        ["@types/graceful-fs", "4.1.4"],
        ["@types/node", "14.14.10"],
        ["anymatch", "3.1.1"],
        ["fb-watchman", "2.0.1"],
        ["graceful-fs", "4.2.4"],
        ["jest-regex-util", "26.0.0"],
        ["jest-serializer", "26.6.2"],
        ["jest-util", "26.6.2"],
        ["jest-worker", "26.6.2"],
        ["micromatch", "4.0.2"],
        ["sane", "4.1.0"],
        ["walker", "1.0.7"],
        ["fsevents", "2.2.1"],
        ["jest-haste-map", "26.6.2"],
      ]),
    }],
  ])],
  ["@types/graceful-fs", new Map([
    ["4.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@types-graceful-fs-4.1.4-4ff9f641a7c6d1a3508ff88bc3141b152772e753/node_modules/@types/graceful-fs/"),
      packageDependencies: new Map([
        ["@types/node", "14.14.10"],
        ["@types/graceful-fs", "4.1.4"],
      ]),
    }],
  ])],
  ["anymatch", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-anymatch-3.1.1-c55ecf02185e2469259399310c173ce31233b142/node_modules/anymatch/"),
      packageDependencies: new Map([
        ["normalize-path", "3.0.0"],
        ["picomatch", "2.2.2"],
        ["anymatch", "3.1.1"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-anymatch-2.0.0-bcb24b4f37934d9aa7ac17b4adaf89e7c76ef2eb/node_modules/anymatch/"),
      packageDependencies: new Map([
        ["micromatch", "3.1.10"],
        ["normalize-path", "2.1.1"],
        ["anymatch", "2.0.0"],
      ]),
    }],
  ])],
  ["normalize-path", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-normalize-path-3.0.0-0dcd69ff23a1c9b11fd0978316644a0388216a65/node_modules/normalize-path/"),
      packageDependencies: new Map([
        ["normalize-path", "3.0.0"],
      ]),
    }],
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-normalize-path-2.1.1-1ab28b556e198363a8c1a6f7e6fa20137fe6aed9/node_modules/normalize-path/"),
      packageDependencies: new Map([
        ["remove-trailing-separator", "1.1.0"],
        ["normalize-path", "2.1.1"],
      ]),
    }],
  ])],
  ["fb-watchman", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-fb-watchman-2.0.1-fc84fb39d2709cf3ff6d743706157bb5708a8a85/node_modules/fb-watchman/"),
      packageDependencies: new Map([
        ["bser", "2.1.1"],
        ["fb-watchman", "2.0.1"],
      ]),
    }],
  ])],
  ["bser", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-bser-2.1.1-e6787da20ece9d07998533cfd9de6f5c38f4bc05/node_modules/bser/"),
      packageDependencies: new Map([
        ["node-int64", "0.4.0"],
        ["bser", "2.1.1"],
      ]),
    }],
  ])],
  ["node-int64", new Map([
    ["0.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-node-int64-0.4.0-87a9065cdb355d3182d8f94ce11188b825c68a3b/node_modules/node-int64/"),
      packageDependencies: new Map([
        ["node-int64", "0.4.0"],
      ]),
    }],
  ])],
  ["jest-regex-util", new Map([
    ["26.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-regex-util-26.0.0-d25e7184b36e39fd466c3bc41be0971e821fee28/node_modules/jest-regex-util/"),
      packageDependencies: new Map([
        ["jest-regex-util", "26.0.0"],
      ]),
    }],
  ])],
  ["jest-serializer", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-serializer-26.6.2-d139aafd46957d3a448f3a6cdabe2919ba0742d1/node_modules/jest-serializer/"),
      packageDependencies: new Map([
        ["@types/node", "14.14.10"],
        ["graceful-fs", "4.2.4"],
        ["jest-serializer", "26.6.2"],
      ]),
    }],
  ])],
  ["jest-worker", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-worker-26.6.2-7f72cbc4d643c365e27b9fd775f9d0eaa9c7a8ed/node_modules/jest-worker/"),
      packageDependencies: new Map([
        ["@types/node", "14.14.10"],
        ["merge-stream", "2.0.0"],
        ["supports-color", "7.2.0"],
        ["jest-worker", "26.6.2"],
      ]),
    }],
  ])],
  ["merge-stream", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-merge-stream-2.0.0-52823629a14dd00c9770fb6ad47dc6310f2c1f60/node_modules/merge-stream/"),
      packageDependencies: new Map([
        ["merge-stream", "2.0.0"],
      ]),
    }],
  ])],
  ["sane", new Map([
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-sane-4.1.0-ed881fd922733a6c461bc189dc2b6c006f3ffded/node_modules/sane/"),
      packageDependencies: new Map([
        ["@cnakazawa/watch", "1.0.4"],
        ["anymatch", "2.0.0"],
        ["capture-exit", "2.0.0"],
        ["exec-sh", "0.3.4"],
        ["execa", "1.0.0"],
        ["fb-watchman", "2.0.1"],
        ["micromatch", "3.1.10"],
        ["minimist", "1.2.5"],
        ["walker", "1.0.7"],
        ["sane", "4.1.0"],
      ]),
    }],
  ])],
  ["@cnakazawa/watch", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@cnakazawa-watch-1.0.4-f864ae85004d0fcab6f50be9141c4da368d1656a/node_modules/@cnakazawa/watch/"),
      packageDependencies: new Map([
        ["exec-sh", "0.3.4"],
        ["minimist", "1.2.5"],
        ["@cnakazawa/watch", "1.0.4"],
      ]),
    }],
  ])],
  ["exec-sh", new Map([
    ["0.3.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-exec-sh-0.3.4-3a018ceb526cc6f6df2bb504b2bfe8e3a4934ec5/node_modules/exec-sh/"),
      packageDependencies: new Map([
        ["exec-sh", "0.3.4"],
      ]),
    }],
  ])],
  ["arr-diff", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-arr-diff-4.0.0-d6461074febfec71e7e15235761a329a5dc7c520/node_modules/arr-diff/"),
      packageDependencies: new Map([
        ["arr-diff", "4.0.0"],
      ]),
    }],
  ])],
  ["array-unique", new Map([
    ["0.3.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-array-unique-0.3.2-a894b75d4bc4f6cd679ef3244a9fd8f46ae2d428/node_modules/array-unique/"),
      packageDependencies: new Map([
        ["array-unique", "0.3.2"],
      ]),
    }],
  ])],
  ["arr-flatten", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-arr-flatten-1.1.0-36048bbff4e7b47e136644316c99669ea5ae91f1/node_modules/arr-flatten/"),
      packageDependencies: new Map([
        ["arr-flatten", "1.1.0"],
      ]),
    }],
  ])],
  ["extend-shallow", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-extend-shallow-2.0.1-51af7d614ad9a9f610ea1bafbb989d6b1c56890f/node_modules/extend-shallow/"),
      packageDependencies: new Map([
        ["is-extendable", "0.1.1"],
        ["extend-shallow", "2.0.1"],
      ]),
    }],
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-extend-shallow-3.0.2-26a71aaf073b39fb2127172746131c2704028db8/node_modules/extend-shallow/"),
      packageDependencies: new Map([
        ["assign-symbols", "1.0.0"],
        ["is-extendable", "1.0.1"],
        ["extend-shallow", "3.0.2"],
      ]),
    }],
  ])],
  ["is-extendable", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-extendable-0.1.1-62b110e289a471418e3ec36a617d472e301dfc89/node_modules/is-extendable/"),
      packageDependencies: new Map([
        ["is-extendable", "0.1.1"],
      ]),
    }],
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-extendable-1.0.1-a7470f9e426733d81bd81e1155264e3a3507cab4/node_modules/is-extendable/"),
      packageDependencies: new Map([
        ["is-plain-object", "2.0.4"],
        ["is-extendable", "1.0.1"],
      ]),
    }],
  ])],
  ["kind-of", new Map([
    ["3.2.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-kind-of-3.2.2-31ea21a734bab9bbb0f32466d893aea51e4a3c64/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["is-buffer", "1.1.6"],
        ["kind-of", "3.2.2"],
      ]),
    }],
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-kind-of-4.0.0-20813df3d712928b207378691a45066fae72dd57/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["is-buffer", "1.1.6"],
        ["kind-of", "4.0.0"],
      ]),
    }],
    ["5.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-kind-of-5.1.0-729c91e2d857b7a419a1f9aa65685c4c33f5845d/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["kind-of", "5.1.0"],
      ]),
    }],
    ["6.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-kind-of-6.0.3-07c05034a6c349fa06e24fa35aa76db4580ce4dd/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["kind-of", "6.0.3"],
      ]),
    }],
  ])],
  ["repeat-string", new Map([
    ["1.6.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-repeat-string-1.6.1-8dcae470e1c88abc2d600fff4a776286da75e637/node_modules/repeat-string/"),
      packageDependencies: new Map([
        ["repeat-string", "1.6.1"],
      ]),
    }],
  ])],
  ["isobject", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-isobject-3.0.1-4e431e92b11a9731636aa1f9c8d1ccbcfdab78df/node_modules/isobject/"),
      packageDependencies: new Map([
        ["isobject", "3.0.1"],
      ]),
    }],
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-isobject-2.1.0-f065561096a3f1da2ef46272f815c840d87e0c89/node_modules/isobject/"),
      packageDependencies: new Map([
        ["isarray", "1.0.0"],
        ["isobject", "2.1.0"],
      ]),
    }],
  ])],
  ["repeat-element", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-repeat-element-1.1.3-782e0d825c0c5a3bb39731f84efee6b742e6b1ce/node_modules/repeat-element/"),
      packageDependencies: new Map([
        ["repeat-element", "1.1.3"],
      ]),
    }],
  ])],
  ["snapdragon", new Map([
    ["0.8.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-snapdragon-0.8.2-64922e7c565b0e14204ba1aa7d6964278d25182d/node_modules/snapdragon/"),
      packageDependencies: new Map([
        ["base", "0.11.2"],
        ["debug", "2.6.9"],
        ["define-property", "0.2.5"],
        ["extend-shallow", "2.0.1"],
        ["map-cache", "0.2.2"],
        ["source-map", "0.5.7"],
        ["source-map-resolve", "0.5.3"],
        ["use", "3.1.1"],
        ["snapdragon", "0.8.2"],
      ]),
    }],
  ])],
  ["base", new Map([
    ["0.11.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-base-0.11.2-7bde5ced145b6d551a90db87f83c558b4eb48a8f/node_modules/base/"),
      packageDependencies: new Map([
        ["cache-base", "1.0.1"],
        ["class-utils", "0.3.6"],
        ["component-emitter", "1.3.0"],
        ["define-property", "1.0.0"],
        ["isobject", "3.0.1"],
        ["mixin-deep", "1.3.2"],
        ["pascalcase", "0.1.1"],
        ["base", "0.11.2"],
      ]),
    }],
  ])],
  ["cache-base", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-cache-base-1.0.1-0a7f46416831c8b662ee36fe4e7c59d76f666ab2/node_modules/cache-base/"),
      packageDependencies: new Map([
        ["collection-visit", "1.0.0"],
        ["component-emitter", "1.3.0"],
        ["get-value", "2.0.6"],
        ["has-value", "1.0.0"],
        ["isobject", "3.0.1"],
        ["set-value", "2.0.1"],
        ["to-object-path", "0.3.0"],
        ["union-value", "1.0.1"],
        ["unset-value", "1.0.0"],
        ["cache-base", "1.0.1"],
      ]),
    }],
  ])],
  ["collection-visit", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-collection-visit-1.0.0-4bc0373c164bc3291b4d368c829cf1a80a59dca0/node_modules/collection-visit/"),
      packageDependencies: new Map([
        ["map-visit", "1.0.0"],
        ["object-visit", "1.0.1"],
        ["collection-visit", "1.0.0"],
      ]),
    }],
  ])],
  ["map-visit", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-map-visit-1.0.0-ecdca8f13144e660f1b5bd41f12f3479d98dfb8f/node_modules/map-visit/"),
      packageDependencies: new Map([
        ["object-visit", "1.0.1"],
        ["map-visit", "1.0.0"],
      ]),
    }],
  ])],
  ["object-visit", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-object-visit-1.0.1-f79c4493af0c5377b59fe39d395e41042dd045bb/node_modules/object-visit/"),
      packageDependencies: new Map([
        ["isobject", "3.0.1"],
        ["object-visit", "1.0.1"],
      ]),
    }],
  ])],
  ["component-emitter", new Map([
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-component-emitter-1.3.0-16e4070fba8ae29b679f2215853ee181ab2eabc0/node_modules/component-emitter/"),
      packageDependencies: new Map([
        ["component-emitter", "1.3.0"],
      ]),
    }],
  ])],
  ["get-value", new Map([
    ["2.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-get-value-2.0.6-dc15ca1c672387ca76bd37ac0a395ba2042a2c28/node_modules/get-value/"),
      packageDependencies: new Map([
        ["get-value", "2.0.6"],
      ]),
    }],
  ])],
  ["has-value", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-has-value-1.0.0-18b281da585b1c5c51def24c930ed29a0be6b177/node_modules/has-value/"),
      packageDependencies: new Map([
        ["get-value", "2.0.6"],
        ["has-values", "1.0.0"],
        ["isobject", "3.0.1"],
        ["has-value", "1.0.0"],
      ]),
    }],
    ["0.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-has-value-0.3.1-7b1f58bada62ca827ec0a2078025654845995e1f/node_modules/has-value/"),
      packageDependencies: new Map([
        ["get-value", "2.0.6"],
        ["has-values", "0.1.4"],
        ["isobject", "2.1.0"],
        ["has-value", "0.3.1"],
      ]),
    }],
  ])],
  ["has-values", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-has-values-1.0.0-95b0b63fec2146619a6fe57fe75628d5a39efe4f/node_modules/has-values/"),
      packageDependencies: new Map([
        ["is-number", "3.0.0"],
        ["kind-of", "4.0.0"],
        ["has-values", "1.0.0"],
      ]),
    }],
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-has-values-0.1.4-6d61de95d91dfca9b9a02089ad384bff8f62b771/node_modules/has-values/"),
      packageDependencies: new Map([
        ["has-values", "0.1.4"],
      ]),
    }],
  ])],
  ["set-value", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-set-value-2.0.1-a18d40530e6f07de4228c7defe4227af8cad005b/node_modules/set-value/"),
      packageDependencies: new Map([
        ["extend-shallow", "2.0.1"],
        ["is-extendable", "0.1.1"],
        ["is-plain-object", "2.0.4"],
        ["split-string", "3.1.0"],
        ["set-value", "2.0.1"],
      ]),
    }],
  ])],
  ["is-plain-object", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-plain-object-2.0.4-2c163b3fafb1b606d9d17928f05c2a1c38e07677/node_modules/is-plain-object/"),
      packageDependencies: new Map([
        ["isobject", "3.0.1"],
        ["is-plain-object", "2.0.4"],
      ]),
    }],
  ])],
  ["split-string", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-split-string-3.1.0-7cb09dda3a86585705c64b39a6466038682e8fe2/node_modules/split-string/"),
      packageDependencies: new Map([
        ["extend-shallow", "3.0.2"],
        ["split-string", "3.1.0"],
      ]),
    }],
  ])],
  ["assign-symbols", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-assign-symbols-1.0.0-59667f41fadd4f20ccbc2bb96b8d4f7f78ec0367/node_modules/assign-symbols/"),
      packageDependencies: new Map([
        ["assign-symbols", "1.0.0"],
      ]),
    }],
  ])],
  ["to-object-path", new Map([
    ["0.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-to-object-path-0.3.0-297588b7b0e7e0ac08e04e672f85c1f4999e17af/node_modules/to-object-path/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["to-object-path", "0.3.0"],
      ]),
    }],
  ])],
  ["union-value", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-union-value-1.0.1-0b6fe7b835aecda61c6ea4d4f02c14221e109847/node_modules/union-value/"),
      packageDependencies: new Map([
        ["arr-union", "3.1.0"],
        ["get-value", "2.0.6"],
        ["is-extendable", "0.1.1"],
        ["set-value", "2.0.1"],
        ["union-value", "1.0.1"],
      ]),
    }],
  ])],
  ["arr-union", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-arr-union-3.1.0-e39b09aea9def866a8f206e288af63919bae39c4/node_modules/arr-union/"),
      packageDependencies: new Map([
        ["arr-union", "3.1.0"],
      ]),
    }],
  ])],
  ["unset-value", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-unset-value-1.0.0-8376873f7d2335179ffb1e6fc3a8ed0dfc8ab559/node_modules/unset-value/"),
      packageDependencies: new Map([
        ["has-value", "0.3.1"],
        ["isobject", "3.0.1"],
        ["unset-value", "1.0.0"],
      ]),
    }],
  ])],
  ["isarray", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-isarray-1.0.0-bb935d48582cba168c06834957a54a3e07124f11/node_modules/isarray/"),
      packageDependencies: new Map([
        ["isarray", "1.0.0"],
      ]),
    }],
  ])],
  ["class-utils", new Map([
    ["0.3.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-class-utils-0.3.6-f93369ae8b9a7ce02fd41faad0ca83033190c463/node_modules/class-utils/"),
      packageDependencies: new Map([
        ["arr-union", "3.1.0"],
        ["define-property", "0.2.5"],
        ["isobject", "3.0.1"],
        ["static-extend", "0.1.2"],
        ["class-utils", "0.3.6"],
      ]),
    }],
  ])],
  ["define-property", new Map([
    ["0.2.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-define-property-0.2.5-c35b1ef918ec3c990f9a5bc57be04aacec5c8116/node_modules/define-property/"),
      packageDependencies: new Map([
        ["is-descriptor", "0.1.6"],
        ["define-property", "0.2.5"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-define-property-1.0.0-769ebaaf3f4a63aad3af9e8d304c9bbe79bfb0e6/node_modules/define-property/"),
      packageDependencies: new Map([
        ["is-descriptor", "1.0.2"],
        ["define-property", "1.0.0"],
      ]),
    }],
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-define-property-2.0.2-d459689e8d654ba77e02a817f8710d702cb16e9d/node_modules/define-property/"),
      packageDependencies: new Map([
        ["is-descriptor", "1.0.2"],
        ["isobject", "3.0.1"],
        ["define-property", "2.0.2"],
      ]),
    }],
  ])],
  ["is-descriptor", new Map([
    ["0.1.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-descriptor-0.1.6-366d8240dde487ca51823b1ab9f07a10a78251ca/node_modules/is-descriptor/"),
      packageDependencies: new Map([
        ["is-accessor-descriptor", "0.1.6"],
        ["is-data-descriptor", "0.1.4"],
        ["kind-of", "5.1.0"],
        ["is-descriptor", "0.1.6"],
      ]),
    }],
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-descriptor-1.0.2-3b159746a66604b04f8c81524ba365c5f14d86ec/node_modules/is-descriptor/"),
      packageDependencies: new Map([
        ["is-accessor-descriptor", "1.0.0"],
        ["is-data-descriptor", "1.0.0"],
        ["kind-of", "6.0.3"],
        ["is-descriptor", "1.0.2"],
      ]),
    }],
  ])],
  ["is-accessor-descriptor", new Map([
    ["0.1.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-accessor-descriptor-0.1.6-a9e12cb3ae8d876727eeef3843f8a0897b5c98d6/node_modules/is-accessor-descriptor/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["is-accessor-descriptor", "0.1.6"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-accessor-descriptor-1.0.0-169c2f6d3df1f992618072365c9b0ea1f6878656/node_modules/is-accessor-descriptor/"),
      packageDependencies: new Map([
        ["kind-of", "6.0.3"],
        ["is-accessor-descriptor", "1.0.0"],
      ]),
    }],
  ])],
  ["is-data-descriptor", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-data-descriptor-0.1.4-0b5ee648388e2c860282e793f1856fec3f301b56/node_modules/is-data-descriptor/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["is-data-descriptor", "0.1.4"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-data-descriptor-1.0.0-d84876321d0e7add03990406abbbbd36ba9268c7/node_modules/is-data-descriptor/"),
      packageDependencies: new Map([
        ["kind-of", "6.0.3"],
        ["is-data-descriptor", "1.0.0"],
      ]),
    }],
  ])],
  ["static-extend", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-static-extend-0.1.2-60809c39cbff55337226fd5e0b520f341f1fb5c6/node_modules/static-extend/"),
      packageDependencies: new Map([
        ["define-property", "0.2.5"],
        ["object-copy", "0.1.0"],
        ["static-extend", "0.1.2"],
      ]),
    }],
  ])],
  ["object-copy", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-object-copy-0.1.0-7e7d858b781bd7c991a41ba975ed3812754e998c/node_modules/object-copy/"),
      packageDependencies: new Map([
        ["copy-descriptor", "0.1.1"],
        ["define-property", "0.2.5"],
        ["kind-of", "3.2.2"],
        ["object-copy", "0.1.0"],
      ]),
    }],
  ])],
  ["copy-descriptor", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-copy-descriptor-0.1.1-676f6eb3c39997c2ee1ac3a924fd6124748f578d/node_modules/copy-descriptor/"),
      packageDependencies: new Map([
        ["copy-descriptor", "0.1.1"],
      ]),
    }],
  ])],
  ["mixin-deep", new Map([
    ["1.3.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-mixin-deep-1.3.2-1120b43dc359a785dce65b55b82e257ccf479566/node_modules/mixin-deep/"),
      packageDependencies: new Map([
        ["for-in", "1.0.2"],
        ["is-extendable", "1.0.1"],
        ["mixin-deep", "1.3.2"],
      ]),
    }],
  ])],
  ["for-in", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-for-in-1.0.2-81068d295a8142ec0ac726c6e2200c30fb6d5e80/node_modules/for-in/"),
      packageDependencies: new Map([
        ["for-in", "1.0.2"],
      ]),
    }],
  ])],
  ["pascalcase", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-pascalcase-0.1.1-b363e55e8006ca6fe21784d2db22bd15d7917f14/node_modules/pascalcase/"),
      packageDependencies: new Map([
        ["pascalcase", "0.1.1"],
      ]),
    }],
  ])],
  ["map-cache", new Map([
    ["0.2.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-map-cache-0.2.2-c32abd0bd6525d9b051645bb4f26ac5dc98a0dbf/node_modules/map-cache/"),
      packageDependencies: new Map([
        ["map-cache", "0.2.2"],
      ]),
    }],
  ])],
  ["source-map-resolve", new Map([
    ["0.5.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-source-map-resolve-0.5.3-190866bece7553e1f8f267a2ee82c606b5509a1a/node_modules/source-map-resolve/"),
      packageDependencies: new Map([
        ["atob", "2.1.2"],
        ["decode-uri-component", "0.2.0"],
        ["resolve-url", "0.2.1"],
        ["source-map-url", "0.4.0"],
        ["urix", "0.1.0"],
        ["source-map-resolve", "0.5.3"],
      ]),
    }],
  ])],
  ["atob", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-atob-2.1.2-6d9517eb9e030d2436666651e86bd9f6f13533c9/node_modules/atob/"),
      packageDependencies: new Map([
        ["atob", "2.1.2"],
      ]),
    }],
  ])],
  ["decode-uri-component", new Map([
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-decode-uri-component-0.2.0-eb3913333458775cb84cd1a1fae062106bb87545/node_modules/decode-uri-component/"),
      packageDependencies: new Map([
        ["decode-uri-component", "0.2.0"],
      ]),
    }],
  ])],
  ["resolve-url", new Map([
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-resolve-url-0.2.1-2c637fe77c893afd2a663fe21aa9080068e2052a/node_modules/resolve-url/"),
      packageDependencies: new Map([
        ["resolve-url", "0.2.1"],
      ]),
    }],
  ])],
  ["source-map-url", new Map([
    ["0.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-source-map-url-0.4.0-3e935d7ddd73631b97659956d55128e87b5084a3/node_modules/source-map-url/"),
      packageDependencies: new Map([
        ["source-map-url", "0.4.0"],
      ]),
    }],
  ])],
  ["urix", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-urix-0.1.0-da937f7a62e21fec1fd18d49b35c2935067a6c72/node_modules/urix/"),
      packageDependencies: new Map([
        ["urix", "0.1.0"],
      ]),
    }],
  ])],
  ["use", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-use-3.1.1-d50c8cac79a19fbc20f2911f56eb973f4e10070f/node_modules/use/"),
      packageDependencies: new Map([
        ["use", "3.1.1"],
      ]),
    }],
  ])],
  ["snapdragon-node", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-snapdragon-node-2.1.1-6c175f86ff14bdb0724563e8f3c1b021a286853b/node_modules/snapdragon-node/"),
      packageDependencies: new Map([
        ["define-property", "1.0.0"],
        ["isobject", "3.0.1"],
        ["snapdragon-util", "3.0.1"],
        ["snapdragon-node", "2.1.1"],
      ]),
    }],
  ])],
  ["snapdragon-util", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-snapdragon-util-3.0.1-f956479486f2acd79700693f6f7b805e45ab56e2/node_modules/snapdragon-util/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["snapdragon-util", "3.0.1"],
      ]),
    }],
  ])],
  ["to-regex", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-to-regex-3.0.2-13cfdd9b336552f30b51f33a8ae1b42a7a7599ce/node_modules/to-regex/"),
      packageDependencies: new Map([
        ["define-property", "2.0.2"],
        ["extend-shallow", "3.0.2"],
        ["regex-not", "1.0.2"],
        ["safe-regex", "1.1.0"],
        ["to-regex", "3.0.2"],
      ]),
    }],
  ])],
  ["regex-not", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-regex-not-1.0.2-1f4ece27e00b0b65e0247a6810e6a85d83a5752c/node_modules/regex-not/"),
      packageDependencies: new Map([
        ["extend-shallow", "3.0.2"],
        ["safe-regex", "1.1.0"],
        ["regex-not", "1.0.2"],
      ]),
    }],
  ])],
  ["safe-regex", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-safe-regex-1.1.0-40a3669f3b077d1e943d44629e157dd48023bf2e/node_modules/safe-regex/"),
      packageDependencies: new Map([
        ["ret", "0.1.15"],
        ["safe-regex", "1.1.0"],
      ]),
    }],
  ])],
  ["ret", new Map([
    ["0.1.15", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-ret-0.1.15-b8a4825d5bdb1fc3f6f53c2bc33f81388681c7bc/node_modules/ret/"),
      packageDependencies: new Map([
        ["ret", "0.1.15"],
      ]),
    }],
  ])],
  ["extglob", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-extglob-2.0.4-ad00fe4dc612a9232e8718711dc5cb5ab0285543/node_modules/extglob/"),
      packageDependencies: new Map([
        ["array-unique", "0.3.2"],
        ["define-property", "1.0.0"],
        ["expand-brackets", "2.1.4"],
        ["extend-shallow", "2.0.1"],
        ["fragment-cache", "0.2.1"],
        ["regex-not", "1.0.2"],
        ["snapdragon", "0.8.2"],
        ["to-regex", "3.0.2"],
        ["extglob", "2.0.4"],
      ]),
    }],
  ])],
  ["expand-brackets", new Map([
    ["2.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-expand-brackets-2.1.4-b77735e315ce30f6b6eff0f83b04151a22449622/node_modules/expand-brackets/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["define-property", "0.2.5"],
        ["extend-shallow", "2.0.1"],
        ["posix-character-classes", "0.1.1"],
        ["regex-not", "1.0.2"],
        ["snapdragon", "0.8.2"],
        ["to-regex", "3.0.2"],
        ["expand-brackets", "2.1.4"],
      ]),
    }],
  ])],
  ["posix-character-classes", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-posix-character-classes-0.1.1-01eac0fe3b5af71a2a6c02feabb8c1fef7e00eab/node_modules/posix-character-classes/"),
      packageDependencies: new Map([
        ["posix-character-classes", "0.1.1"],
      ]),
    }],
  ])],
  ["fragment-cache", new Map([
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-fragment-cache-0.2.1-4290fad27f13e89be7f33799c6bc5a0abfff0d19/node_modules/fragment-cache/"),
      packageDependencies: new Map([
        ["map-cache", "0.2.2"],
        ["fragment-cache", "0.2.1"],
      ]),
    }],
  ])],
  ["nanomatch", new Map([
    ["1.2.13", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-nanomatch-1.2.13-b87a8aa4fc0de8fe6be88895b38983ff265bd119/node_modules/nanomatch/"),
      packageDependencies: new Map([
        ["arr-diff", "4.0.0"],
        ["array-unique", "0.3.2"],
        ["define-property", "2.0.2"],
        ["extend-shallow", "3.0.2"],
        ["fragment-cache", "0.2.1"],
        ["is-windows", "1.0.2"],
        ["kind-of", "6.0.3"],
        ["object.pick", "1.3.0"],
        ["regex-not", "1.0.2"],
        ["snapdragon", "0.8.2"],
        ["to-regex", "3.0.2"],
        ["nanomatch", "1.2.13"],
      ]),
    }],
  ])],
  ["is-windows", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-windows-1.0.2-d1850eb9791ecd18e6182ce12a30f396634bb19d/node_modules/is-windows/"),
      packageDependencies: new Map([
        ["is-windows", "1.0.2"],
      ]),
    }],
  ])],
  ["object.pick", new Map([
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-object-pick-1.3.0-87a10ac4c1694bd2e1cbf53591a66141fb5dd747/node_modules/object.pick/"),
      packageDependencies: new Map([
        ["isobject", "3.0.1"],
        ["object.pick", "1.3.0"],
      ]),
    }],
  ])],
  ["remove-trailing-separator", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-remove-trailing-separator-1.1.0-c24bce2a283adad5bc3f58e0d48249b92379d8ef/node_modules/remove-trailing-separator/"),
      packageDependencies: new Map([
        ["remove-trailing-separator", "1.1.0"],
      ]),
    }],
  ])],
  ["capture-exit", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-capture-exit-2.0.0-fb953bfaebeb781f62898239dabb426d08a509a4/node_modules/capture-exit/"),
      packageDependencies: new Map([
        ["rsvp", "4.8.5"],
        ["capture-exit", "2.0.0"],
      ]),
    }],
  ])],
  ["rsvp", new Map([
    ["4.8.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-rsvp-4.8.5-c8f155311d167f68f21e168df71ec5b083113734/node_modules/rsvp/"),
      packageDependencies: new Map([
        ["rsvp", "4.8.5"],
      ]),
    }],
  ])],
  ["execa", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-execa-1.0.0-c6236a5bb4df6d6f15e88e7f017798216749ddd8/node_modules/execa/"),
      packageDependencies: new Map([
        ["cross-spawn", "6.0.5"],
        ["get-stream", "4.1.0"],
        ["is-stream", "1.1.0"],
        ["npm-run-path", "2.0.2"],
        ["p-finally", "1.0.0"],
        ["signal-exit", "3.0.3"],
        ["strip-eof", "1.0.0"],
        ["execa", "1.0.0"],
      ]),
    }],
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-execa-4.1.0-4e5491ad1572f2f17a77d388c6c857135b22847a/node_modules/execa/"),
      packageDependencies: new Map([
        ["cross-spawn", "7.0.3"],
        ["get-stream", "5.2.0"],
        ["human-signals", "1.1.1"],
        ["is-stream", "2.0.0"],
        ["merge-stream", "2.0.0"],
        ["npm-run-path", "4.0.1"],
        ["onetime", "5.1.2"],
        ["signal-exit", "3.0.3"],
        ["strip-final-newline", "2.0.0"],
        ["execa", "4.1.0"],
      ]),
    }],
  ])],
  ["cross-spawn", new Map([
    ["6.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-cross-spawn-6.0.5-4a5ec7c64dfae22c3a14124dbacdee846d80cbc4/node_modules/cross-spawn/"),
      packageDependencies: new Map([
        ["nice-try", "1.0.5"],
        ["path-key", "2.0.1"],
        ["semver", "5.7.1"],
        ["shebang-command", "1.2.0"],
        ["which", "1.3.1"],
        ["cross-spawn", "6.0.5"],
      ]),
    }],
    ["7.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-cross-spawn-7.0.3-f73a85b9d5d41d045551c177e2882d4ac85728a6/node_modules/cross-spawn/"),
      packageDependencies: new Map([
        ["path-key", "3.1.1"],
        ["shebang-command", "2.0.0"],
        ["which", "2.0.2"],
        ["cross-spawn", "7.0.3"],
      ]),
    }],
  ])],
  ["nice-try", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-nice-try-1.0.5-a3378a7696ce7d223e88fc9b764bd7ef1089e366/node_modules/nice-try/"),
      packageDependencies: new Map([
        ["nice-try", "1.0.5"],
      ]),
    }],
  ])],
  ["path-key", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-path-key-2.0.1-411cadb574c5a140d3a4b1910d40d80cc9f40b40/node_modules/path-key/"),
      packageDependencies: new Map([
        ["path-key", "2.0.1"],
      ]),
    }],
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-path-key-3.1.1-581f6ade658cbba65a0d3380de7753295054f375/node_modules/path-key/"),
      packageDependencies: new Map([
        ["path-key", "3.1.1"],
      ]),
    }],
  ])],
  ["shebang-command", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-shebang-command-1.2.0-44aac65b695b03398968c39f363fee5deafdf1ea/node_modules/shebang-command/"),
      packageDependencies: new Map([
        ["shebang-regex", "1.0.0"],
        ["shebang-command", "1.2.0"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-shebang-command-2.0.0-ccd0af4f8835fbdc265b82461aaf0c36663f34ea/node_modules/shebang-command/"),
      packageDependencies: new Map([
        ["shebang-regex", "3.0.0"],
        ["shebang-command", "2.0.0"],
      ]),
    }],
  ])],
  ["shebang-regex", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-shebang-regex-1.0.0-da42f49740c0b42db2ca9728571cb190c98efea3/node_modules/shebang-regex/"),
      packageDependencies: new Map([
        ["shebang-regex", "1.0.0"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-shebang-regex-3.0.0-ae16f1644d873ecad843b0307b143362d4c42172/node_modules/shebang-regex/"),
      packageDependencies: new Map([
        ["shebang-regex", "3.0.0"],
      ]),
    }],
  ])],
  ["which", new Map([
    ["1.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-which-1.3.1-a45043d54f5805316da8d62f9f50918d3da70b0a/node_modules/which/"),
      packageDependencies: new Map([
        ["isexe", "2.0.0"],
        ["which", "1.3.1"],
      ]),
    }],
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-which-2.0.2-7c6a8dd0a636a0327e10b59c9286eee93f3f51b1/node_modules/which/"),
      packageDependencies: new Map([
        ["isexe", "2.0.0"],
        ["which", "2.0.2"],
      ]),
    }],
  ])],
  ["isexe", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-isexe-2.0.0-e8fbf374dc556ff8947a10dcb0572d633f2cfa10/node_modules/isexe/"),
      packageDependencies: new Map([
        ["isexe", "2.0.0"],
      ]),
    }],
  ])],
  ["get-stream", new Map([
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-get-stream-4.1.0-c1b255575f3dc21d59bfc79cd3d2b46b1c3a54b5/node_modules/get-stream/"),
      packageDependencies: new Map([
        ["pump", "3.0.0"],
        ["get-stream", "4.1.0"],
      ]),
    }],
    ["5.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-get-stream-5.2.0-4966a1795ee5ace65e706c4b7beb71257d6e22d3/node_modules/get-stream/"),
      packageDependencies: new Map([
        ["pump", "3.0.0"],
        ["get-stream", "5.2.0"],
      ]),
    }],
  ])],
  ["pump", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-pump-3.0.0-b4a2116815bde2f4e1ea602354e8c75565107a64/node_modules/pump/"),
      packageDependencies: new Map([
        ["end-of-stream", "1.4.4"],
        ["once", "1.4.0"],
        ["pump", "3.0.0"],
      ]),
    }],
  ])],
  ["end-of-stream", new Map([
    ["1.4.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-end-of-stream-1.4.4-5ae64a5f45057baf3626ec14da0ca5e4b2431eb0/node_modules/end-of-stream/"),
      packageDependencies: new Map([
        ["once", "1.4.0"],
        ["end-of-stream", "1.4.4"],
      ]),
    }],
  ])],
  ["is-stream", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-stream-1.1.0-12d4a3dd4e68e0b79ceb8dbc84173ae80d91ca44/node_modules/is-stream/"),
      packageDependencies: new Map([
        ["is-stream", "1.1.0"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-stream-2.0.0-bde9c32680d6fae04129d6ac9d921ce7815f78e3/node_modules/is-stream/"),
      packageDependencies: new Map([
        ["is-stream", "2.0.0"],
      ]),
    }],
  ])],
  ["npm-run-path", new Map([
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-npm-run-path-2.0.2-35a9232dfa35d7067b4cb2ddf2357b1871536c5f/node_modules/npm-run-path/"),
      packageDependencies: new Map([
        ["path-key", "2.0.1"],
        ["npm-run-path", "2.0.2"],
      ]),
    }],
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-npm-run-path-4.0.1-b7ecd1e5ed53da8e37a55e1c2269e0b97ed748ea/node_modules/npm-run-path/"),
      packageDependencies: new Map([
        ["path-key", "3.1.1"],
        ["npm-run-path", "4.0.1"],
      ]),
    }],
  ])],
  ["p-finally", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-p-finally-1.0.0-3fbcfb15b899a44123b34b6dcc18b724336a2cae/node_modules/p-finally/"),
      packageDependencies: new Map([
        ["p-finally", "1.0.0"],
      ]),
    }],
  ])],
  ["signal-exit", new Map([
    ["3.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-signal-exit-3.0.3-a1410c2edd8f077b08b4e253c8eacfcaf057461c/node_modules/signal-exit/"),
      packageDependencies: new Map([
        ["signal-exit", "3.0.3"],
      ]),
    }],
  ])],
  ["strip-eof", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-strip-eof-1.0.0-bb43ff5598a6eb05d89b59fcd129c983313606bf/node_modules/strip-eof/"),
      packageDependencies: new Map([
        ["strip-eof", "1.0.0"],
      ]),
    }],
  ])],
  ["walker", new Map([
    ["1.0.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-walker-1.0.7-2f7f9b8fd10d677262b18a884e28d19618e028fb/node_modules/walker/"),
      packageDependencies: new Map([
        ["makeerror", "1.0.11"],
        ["walker", "1.0.7"],
      ]),
    }],
  ])],
  ["makeerror", new Map([
    ["1.0.11", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-makeerror-1.0.11-e01a5c9109f2af79660e4e8b9587790184f5a96c/node_modules/makeerror/"),
      packageDependencies: new Map([
        ["tmpl", "1.0.4"],
        ["makeerror", "1.0.11"],
      ]),
    }],
  ])],
  ["tmpl", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-tmpl-1.0.4-23640dd7b42d00433911140820e5cf440e521dd1/node_modules/tmpl/"),
      packageDependencies: new Map([
        ["tmpl", "1.0.4"],
      ]),
    }],
  ])],
  ["fsevents", new Map([
    ["2.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-fsevents-2.2.1-1fb02ded2036a8ac288d507a65962bd87b97628d/node_modules/fsevents/"),
      packageDependencies: new Map([
        ["fsevents", "2.2.1"],
      ]),
    }],
  ])],
  ["pirates", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-pirates-4.0.1-643a92caf894566f91b2b986d2c66950a8e2fb87/node_modules/pirates/"),
      packageDependencies: new Map([
        ["node-modules-regexp", "1.0.0"],
        ["pirates", "4.0.1"],
      ]),
    }],
  ])],
  ["node-modules-regexp", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-node-modules-regexp-1.0.0-8d9dbe28964a4ac5712e9131642107c71e90ec40/node_modules/node-modules-regexp/"),
      packageDependencies: new Map([
        ["node-modules-regexp", "1.0.0"],
      ]),
    }],
  ])],
  ["write-file-atomic", new Map([
    ["3.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-write-file-atomic-3.0.3-56bd5c5a5c70481cd19c571bd39ab965a5de56e8/node_modules/write-file-atomic/"),
      packageDependencies: new Map([
        ["imurmurhash", "0.1.4"],
        ["is-typedarray", "1.0.0"],
        ["signal-exit", "3.0.3"],
        ["typedarray-to-buffer", "3.1.5"],
        ["write-file-atomic", "3.0.3"],
      ]),
    }],
  ])],
  ["imurmurhash", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-imurmurhash-0.1.4-9218b9b2b928a238b13dc4fb6b6d576f231453ea/node_modules/imurmurhash/"),
      packageDependencies: new Map([
        ["imurmurhash", "0.1.4"],
      ]),
    }],
  ])],
  ["is-typedarray", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-typedarray-1.0.0-e479c80858df0c1b11ddda6940f96011fcda4a9a/node_modules/is-typedarray/"),
      packageDependencies: new Map([
        ["is-typedarray", "1.0.0"],
      ]),
    }],
  ])],
  ["typedarray-to-buffer", new Map([
    ["3.1.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-typedarray-to-buffer-3.1.5-a97ee7a9ff42691b9f783ff1bc5112fe3fca9080/node_modules/typedarray-to-buffer/"),
      packageDependencies: new Map([
        ["is-typedarray", "1.0.0"],
        ["typedarray-to-buffer", "3.1.5"],
      ]),
    }],
  ])],
  ["exit", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-exit-0.1.2-0632638f8d877cc82107d30a0fff1a17cba1cd0c/node_modules/exit/"),
      packageDependencies: new Map([
        ["exit", "0.1.2"],
      ]),
    }],
  ])],
  ["istanbul-lib-report", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-istanbul-lib-report-3.0.0-7518fe52ea44de372f460a76b5ecda9ffb73d8a6/node_modules/istanbul-lib-report/"),
      packageDependencies: new Map([
        ["istanbul-lib-coverage", "3.0.0"],
        ["make-dir", "3.1.0"],
        ["supports-color", "7.2.0"],
        ["istanbul-lib-report", "3.0.0"],
      ]),
    }],
  ])],
  ["make-dir", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-make-dir-3.1.0-415e967046b3a7f1d185277d84aa58203726a13f/node_modules/make-dir/"),
      packageDependencies: new Map([
        ["semver", "6.3.0"],
        ["make-dir", "3.1.0"],
      ]),
    }],
  ])],
  ["istanbul-lib-source-maps", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-istanbul-lib-source-maps-4.0.0-75743ce6d96bb86dc7ee4352cf6366a23f0b1ad9/node_modules/istanbul-lib-source-maps/"),
      packageDependencies: new Map([
        ["debug", "4.3.1"],
        ["istanbul-lib-coverage", "3.0.0"],
        ["source-map", "0.6.1"],
        ["istanbul-lib-source-maps", "4.0.0"],
      ]),
    }],
  ])],
  ["istanbul-reports", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-istanbul-reports-3.0.2-d593210e5000683750cb09fc0644e4b6e27fd53b/node_modules/istanbul-reports/"),
      packageDependencies: new Map([
        ["html-escaper", "2.0.2"],
        ["istanbul-lib-report", "3.0.0"],
        ["istanbul-reports", "3.0.2"],
      ]),
    }],
  ])],
  ["html-escaper", new Map([
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-html-escaper-2.0.2-dfd60027da36a36dfcbe236262c00a5822681453/node_modules/html-escaper/"),
      packageDependencies: new Map([
        ["html-escaper", "2.0.2"],
      ]),
    }],
  ])],
  ["jest-resolve", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-resolve-26.6.2-a3ab1517217f469b504f1b56603c5bb541fbb507/node_modules/jest-resolve/"),
      packageDependencies: new Map([
        ["@jest/types", "26.6.2"],
        ["chalk", "4.1.0"],
        ["graceful-fs", "4.2.4"],
        ["jest-pnp-resolver", "1.2.2"],
        ["jest-util", "26.6.2"],
        ["read-pkg-up", "7.0.1"],
        ["resolve", "1.19.0"],
        ["slash", "3.0.0"],
        ["jest-resolve", "26.6.2"],
      ]),
    }],
  ])],
  ["jest-pnp-resolver", new Map([
    ["1.2.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-pnp-resolver-1.2.2-b704ac0ae028a89108a4d040b3f919dfddc8e33c/node_modules/jest-pnp-resolver/"),
      packageDependencies: new Map([
        ["jest-pnp-resolver", "1.2.2"],
      ]),
    }],
  ])],
  ["read-pkg-up", new Map([
    ["7.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-read-pkg-up-7.0.1-f3a6135758459733ae2b95638056e1854e7ef507/node_modules/read-pkg-up/"),
      packageDependencies: new Map([
        ["find-up", "4.1.0"],
        ["read-pkg", "5.2.0"],
        ["type-fest", "0.8.1"],
        ["read-pkg-up", "7.0.1"],
      ]),
    }],
  ])],
  ["read-pkg", new Map([
    ["5.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-read-pkg-5.2.0-7bf295438ca5a33e56cd30e053b34ee7250c93cc/node_modules/read-pkg/"),
      packageDependencies: new Map([
        ["@types/normalize-package-data", "2.4.0"],
        ["normalize-package-data", "2.5.0"],
        ["parse-json", "5.1.0"],
        ["type-fest", "0.6.0"],
        ["read-pkg", "5.2.0"],
      ]),
    }],
  ])],
  ["@types/normalize-package-data", new Map([
    ["2.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@types-normalize-package-data-2.4.0-e486d0d97396d79beedd0a6e33f4534ff6b4973e/node_modules/@types/normalize-package-data/"),
      packageDependencies: new Map([
        ["@types/normalize-package-data", "2.4.0"],
      ]),
    }],
  ])],
  ["normalize-package-data", new Map([
    ["2.5.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-normalize-package-data-2.5.0-e66db1838b200c1dfc233225d12cb36520e234a8/node_modules/normalize-package-data/"),
      packageDependencies: new Map([
        ["hosted-git-info", "2.8.8"],
        ["resolve", "1.19.0"],
        ["semver", "5.7.1"],
        ["validate-npm-package-license", "3.0.4"],
        ["normalize-package-data", "2.5.0"],
      ]),
    }],
  ])],
  ["hosted-git-info", new Map([
    ["2.8.8", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-hosted-git-info-2.8.8-7539bd4bc1e0e0a895815a2e0262420b12858488/node_modules/hosted-git-info/"),
      packageDependencies: new Map([
        ["hosted-git-info", "2.8.8"],
      ]),
    }],
  ])],
  ["validate-npm-package-license", new Map([
    ["3.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-validate-npm-package-license-3.0.4-fc91f6b9c7ba15c857f4cb2c5defeec39d4f410a/node_modules/validate-npm-package-license/"),
      packageDependencies: new Map([
        ["spdx-correct", "3.1.1"],
        ["spdx-expression-parse", "3.0.1"],
        ["validate-npm-package-license", "3.0.4"],
      ]),
    }],
  ])],
  ["spdx-correct", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-spdx-correct-3.1.1-dece81ac9c1e6713e5f7d1b6f17d468fa53d89a9/node_modules/spdx-correct/"),
      packageDependencies: new Map([
        ["spdx-expression-parse", "3.0.1"],
        ["spdx-license-ids", "3.0.7"],
        ["spdx-correct", "3.1.1"],
      ]),
    }],
  ])],
  ["spdx-expression-parse", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-spdx-expression-parse-3.0.1-cf70f50482eefdc98e3ce0a6833e4a53ceeba679/node_modules/spdx-expression-parse/"),
      packageDependencies: new Map([
        ["spdx-exceptions", "2.3.0"],
        ["spdx-license-ids", "3.0.7"],
        ["spdx-expression-parse", "3.0.1"],
      ]),
    }],
  ])],
  ["spdx-exceptions", new Map([
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-spdx-exceptions-2.3.0-3f28ce1a77a00372683eade4a433183527a2163d/node_modules/spdx-exceptions/"),
      packageDependencies: new Map([
        ["spdx-exceptions", "2.3.0"],
      ]),
    }],
  ])],
  ["spdx-license-ids", new Map([
    ["3.0.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-spdx-license-ids-3.0.7-e9c18a410e5ed7e12442a549fbd8afa767038d65/node_modules/spdx-license-ids/"),
      packageDependencies: new Map([
        ["spdx-license-ids", "3.0.7"],
      ]),
    }],
  ])],
  ["parse-json", new Map([
    ["5.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-parse-json-5.1.0-f96088cdf24a8faa9aea9a009f2d9d942c999646/node_modules/parse-json/"),
      packageDependencies: new Map([
        ["@babel/code-frame", "7.10.4"],
        ["error-ex", "1.3.2"],
        ["json-parse-even-better-errors", "2.3.1"],
        ["lines-and-columns", "1.1.6"],
        ["parse-json", "5.1.0"],
      ]),
    }],
  ])],
  ["error-ex", new Map([
    ["1.3.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-error-ex-1.3.2-b4ac40648107fdcdcfae242f428bea8a14d4f1bf/node_modules/error-ex/"),
      packageDependencies: new Map([
        ["is-arrayish", "0.2.1"],
        ["error-ex", "1.3.2"],
      ]),
    }],
  ])],
  ["is-arrayish", new Map([
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-arrayish-0.2.1-77c99840527aa8ecb1a8ba697b80645a7a926a9d/node_modules/is-arrayish/"),
      packageDependencies: new Map([
        ["is-arrayish", "0.2.1"],
      ]),
    }],
  ])],
  ["json-parse-even-better-errors", new Map([
    ["2.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-json-parse-even-better-errors-2.3.1-7c47805a94319928e05777405dc12e1f7a4ee02d/node_modules/json-parse-even-better-errors/"),
      packageDependencies: new Map([
        ["json-parse-even-better-errors", "2.3.1"],
      ]),
    }],
  ])],
  ["lines-and-columns", new Map([
    ["1.1.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-lines-and-columns-1.1.6-1c00c743b433cd0a4e80758f7b64a57440d9ff00/node_modules/lines-and-columns/"),
      packageDependencies: new Map([
        ["lines-and-columns", "1.1.6"],
      ]),
    }],
  ])],
  ["type-fest", new Map([
    ["0.6.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-type-fest-0.6.0-8d2a2370d3df886eb5c90ada1c5bf6188acf838b/node_modules/type-fest/"),
      packageDependencies: new Map([
        ["type-fest", "0.6.0"],
      ]),
    }],
    ["0.8.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-type-fest-0.8.1-09e249ebde851d3b1e48d27c105444667f17b83d/node_modules/type-fest/"),
      packageDependencies: new Map([
        ["type-fest", "0.8.1"],
      ]),
    }],
    ["0.11.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-type-fest-0.11.0-97abf0872310fed88a5c466b25681576145e33f1/node_modules/type-fest/"),
      packageDependencies: new Map([
        ["type-fest", "0.11.0"],
      ]),
    }],
  ])],
  ["string-length", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-string-length-4.0.1-4a973bf31ef77c4edbceadd6af2611996985f8a1/node_modules/string-length/"),
      packageDependencies: new Map([
        ["char-regex", "1.0.2"],
        ["strip-ansi", "6.0.0"],
        ["string-length", "4.0.1"],
      ]),
    }],
  ])],
  ["char-regex", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-char-regex-1.0.2-d744358226217f981ed58f479b1d6bcc29545dcf/node_modules/char-regex/"),
      packageDependencies: new Map([
        ["char-regex", "1.0.2"],
      ]),
    }],
  ])],
  ["strip-ansi", new Map([
    ["6.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-strip-ansi-6.0.0-0b1571dd7669ccd4f3e06e14ef1eed26225ae532/node_modules/strip-ansi/"),
      packageDependencies: new Map([
        ["ansi-regex", "5.0.0"],
        ["strip-ansi", "6.0.0"],
      ]),
    }],
  ])],
  ["terminal-link", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-terminal-link-2.1.1-14a64a27ab3c0df933ea546fba55f2d078edc994/node_modules/terminal-link/"),
      packageDependencies: new Map([
        ["ansi-escapes", "4.3.1"],
        ["supports-hyperlinks", "2.1.0"],
        ["terminal-link", "2.1.1"],
      ]),
    }],
  ])],
  ["ansi-escapes", new Map([
    ["4.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-ansi-escapes-4.3.1-a5c47cc43181f1f38ffd7076837700d395522a61/node_modules/ansi-escapes/"),
      packageDependencies: new Map([
        ["type-fest", "0.11.0"],
        ["ansi-escapes", "4.3.1"],
      ]),
    }],
  ])],
  ["supports-hyperlinks", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-supports-hyperlinks-2.1.0-f663df252af5f37c5d49bbd7eeefa9e0b9e59e47/node_modules/supports-hyperlinks/"),
      packageDependencies: new Map([
        ["has-flag", "4.0.0"],
        ["supports-color", "7.2.0"],
        ["supports-hyperlinks", "2.1.0"],
      ]),
    }],
  ])],
  ["v8-to-istanbul", new Map([
    ["7.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-v8-to-istanbul-7.0.0-b4fe00e35649ef7785a9b7fcebcea05f37c332fc/node_modules/v8-to-istanbul/"),
      packageDependencies: new Map([
        ["@types/istanbul-lib-coverage", "2.0.3"],
        ["convert-source-map", "1.7.0"],
        ["source-map", "0.7.3"],
        ["v8-to-istanbul", "7.0.0"],
      ]),
    }],
  ])],
  ["node-notifier", new Map([
    ["8.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-node-notifier-8.0.0-a7eee2d51da6d0f7ff5094bc7108c911240c1620/node_modules/node-notifier/"),
      packageDependencies: new Map([
        ["growly", "1.3.0"],
        ["is-wsl", "2.2.0"],
        ["semver", "7.3.2"],
        ["shellwords", "0.1.1"],
        ["uuid", "8.3.1"],
        ["which", "2.0.2"],
        ["node-notifier", "8.0.0"],
      ]),
    }],
  ])],
  ["growly", new Map([
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-growly-1.3.0-f10748cbe76af964b7c96c93c6bcc28af120c081/node_modules/growly/"),
      packageDependencies: new Map([
        ["growly", "1.3.0"],
      ]),
    }],
  ])],
  ["is-wsl", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-wsl-2.2.0-74a4c76e77ca9fd3f932f290c17ea326cd157271/node_modules/is-wsl/"),
      packageDependencies: new Map([
        ["is-docker", "2.1.1"],
        ["is-wsl", "2.2.0"],
      ]),
    }],
  ])],
  ["is-docker", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-docker-2.1.1-4125a88e44e450d384e09047ede71adc2d144156/node_modules/is-docker/"),
      packageDependencies: new Map([
        ["is-docker", "2.1.1"],
      ]),
    }],
  ])],
  ["shellwords", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-shellwords-0.1.1-d6b9181c1a48d397324c84871efbcfc73fc0654b/node_modules/shellwords/"),
      packageDependencies: new Map([
        ["shellwords", "0.1.1"],
      ]),
    }],
  ])],
  ["uuid", new Map([
    ["8.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-uuid-8.3.1-2ba2e6ca000da60fce5a196954ab241131e05a31/node_modules/uuid/"),
      packageDependencies: new Map([
        ["uuid", "8.3.1"],
      ]),
    }],
    ["3.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-uuid-3.4.0-b23e4358afa8a202fe7a100af1f5f883f02007ee/node_modules/uuid/"),
      packageDependencies: new Map([
        ["uuid", "3.4.0"],
      ]),
    }],
  ])],
  ["jest-changed-files", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-changed-files-26.6.2-f6198479e1cc66f22f9ae1e22acaa0b429c042d0/node_modules/jest-changed-files/"),
      packageDependencies: new Map([
        ["@jest/types", "26.6.2"],
        ["execa", "4.1.0"],
        ["throat", "5.0.0"],
        ["jest-changed-files", "26.6.2"],
      ]),
    }],
  ])],
  ["human-signals", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-human-signals-1.1.1-c5b1cd14f50aeae09ab6c59fe63ba3395fe4dfa3/node_modules/human-signals/"),
      packageDependencies: new Map([
        ["human-signals", "1.1.1"],
      ]),
    }],
  ])],
  ["onetime", new Map([
    ["5.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-onetime-5.1.2-d0e96ebb56b07476df1dd9c4806e5237985ca45e/node_modules/onetime/"),
      packageDependencies: new Map([
        ["mimic-fn", "2.1.0"],
        ["onetime", "5.1.2"],
      ]),
    }],
  ])],
  ["mimic-fn", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-mimic-fn-2.1.0-7ed2c2ccccaf84d3ffcb7a69b57711fc2083401b/node_modules/mimic-fn/"),
      packageDependencies: new Map([
        ["mimic-fn", "2.1.0"],
      ]),
    }],
  ])],
  ["strip-final-newline", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-strip-final-newline-2.0.0-89b852fb2fcbe936f6f4b3187afb0a12c1ab58ad/node_modules/strip-final-newline/"),
      packageDependencies: new Map([
        ["strip-final-newline", "2.0.0"],
      ]),
    }],
  ])],
  ["throat", new Map([
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-throat-5.0.0-c5199235803aad18754a667d659b5e72ce16764b/node_modules/throat/"),
      packageDependencies: new Map([
        ["throat", "5.0.0"],
      ]),
    }],
  ])],
  ["jest-config", new Map([
    ["pnp:249ddef947a9ababda31301a1edf90989bee7687", {
      packageLocation: path.resolve(__dirname, "./.pnp/externals/pnp-249ddef947a9ababda31301a1edf90989bee7687/node_modules/jest-config/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["@jest/test-sequencer", "26.6.3"],
        ["@jest/types", "26.6.2"],
        ["babel-jest", "26.6.3"],
        ["chalk", "4.1.0"],
        ["deepmerge", "4.2.2"],
        ["glob", "7.1.6"],
        ["graceful-fs", "4.2.4"],
        ["jest-environment-jsdom", "26.6.2"],
        ["jest-environment-node", "26.6.2"],
        ["jest-get-type", "26.3.0"],
        ["jest-jasmine2", "26.6.3"],
        ["jest-regex-util", "26.0.0"],
        ["jest-resolve", "26.6.2"],
        ["jest-util", "26.6.2"],
        ["jest-validate", "26.6.2"],
        ["micromatch", "4.0.2"],
        ["pretty-format", "26.6.2"],
        ["jest-config", "pnp:249ddef947a9ababda31301a1edf90989bee7687"],
      ]),
    }],
    ["pnp:1bc15128b2300766876943bd879ea149399eae4b", {
      packageLocation: path.resolve(__dirname, "./.pnp/externals/pnp-1bc15128b2300766876943bd879ea149399eae4b/node_modules/jest-config/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["@jest/test-sequencer", "26.6.3"],
        ["@jest/types", "26.6.2"],
        ["babel-jest", "26.6.3"],
        ["chalk", "4.1.0"],
        ["deepmerge", "4.2.2"],
        ["glob", "7.1.6"],
        ["graceful-fs", "4.2.4"],
        ["jest-environment-jsdom", "26.6.2"],
        ["jest-environment-node", "26.6.2"],
        ["jest-get-type", "26.3.0"],
        ["jest-jasmine2", "26.6.3"],
        ["jest-regex-util", "26.0.0"],
        ["jest-resolve", "26.6.2"],
        ["jest-util", "26.6.2"],
        ["jest-validate", "26.6.2"],
        ["micromatch", "4.0.2"],
        ["pretty-format", "26.6.2"],
        ["jest-config", "pnp:1bc15128b2300766876943bd879ea149399eae4b"],
      ]),
    }],
    ["pnp:e1d5cb28cb6a685f6cd90d3e6e1bcca052b998f1", {
      packageLocation: path.resolve(__dirname, "./.pnp/externals/pnp-e1d5cb28cb6a685f6cd90d3e6e1bcca052b998f1/node_modules/jest-config/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["@jest/test-sequencer", "26.6.3"],
        ["@jest/types", "26.6.2"],
        ["babel-jest", "26.6.3"],
        ["chalk", "4.1.0"],
        ["deepmerge", "4.2.2"],
        ["glob", "7.1.6"],
        ["graceful-fs", "4.2.4"],
        ["jest-environment-jsdom", "26.6.2"],
        ["jest-environment-node", "26.6.2"],
        ["jest-get-type", "26.3.0"],
        ["jest-jasmine2", "26.6.3"],
        ["jest-regex-util", "26.0.0"],
        ["jest-resolve", "26.6.2"],
        ["jest-util", "26.6.2"],
        ["jest-validate", "26.6.2"],
        ["micromatch", "4.0.2"],
        ["pretty-format", "26.6.2"],
        ["jest-config", "pnp:e1d5cb28cb6a685f6cd90d3e6e1bcca052b998f1"],
      ]),
    }],
    ["pnp:ea5fa9bda876bb254d64d757d7fe647cee0301f5", {
      packageLocation: path.resolve(__dirname, "./.pnp/externals/pnp-ea5fa9bda876bb254d64d757d7fe647cee0301f5/node_modules/jest-config/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["@jest/test-sequencer", "26.6.3"],
        ["@jest/types", "26.6.2"],
        ["babel-jest", "26.6.3"],
        ["chalk", "4.1.0"],
        ["deepmerge", "4.2.2"],
        ["glob", "7.1.6"],
        ["graceful-fs", "4.2.4"],
        ["jest-environment-jsdom", "26.6.2"],
        ["jest-environment-node", "26.6.2"],
        ["jest-get-type", "26.3.0"],
        ["jest-jasmine2", "26.6.3"],
        ["jest-regex-util", "26.0.0"],
        ["jest-resolve", "26.6.2"],
        ["jest-util", "26.6.2"],
        ["jest-validate", "26.6.2"],
        ["micromatch", "4.0.2"],
        ["pretty-format", "26.6.2"],
        ["jest-config", "pnp:ea5fa9bda876bb254d64d757d7fe647cee0301f5"],
      ]),
    }],
  ])],
  ["@jest/test-sequencer", new Map([
    ["26.6.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@jest-test-sequencer-26.6.3-98e8a45100863886d074205e8ffdc5a7eb582b17/node_modules/@jest/test-sequencer/"),
      packageDependencies: new Map([
        ["@jest/test-result", "26.6.2"],
        ["graceful-fs", "4.2.4"],
        ["jest-haste-map", "26.6.2"],
        ["jest-runner", "26.6.3"],
        ["jest-runtime", "26.6.3"],
        ["@jest/test-sequencer", "26.6.3"],
      ]),
    }],
  ])],
  ["jest-runner", new Map([
    ["26.6.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-runner-26.6.3-2d1fed3d46e10f233fd1dbd3bfaa3fe8924be159/node_modules/jest-runner/"),
      packageDependencies: new Map([
        ["@jest/console", "26.6.2"],
        ["@jest/environment", "26.6.2"],
        ["@jest/test-result", "26.6.2"],
        ["@jest/types", "26.6.2"],
        ["@types/node", "14.14.10"],
        ["chalk", "4.1.0"],
        ["emittery", "0.7.2"],
        ["exit", "0.1.2"],
        ["graceful-fs", "4.2.4"],
        ["jest-config", "pnp:1bc15128b2300766876943bd879ea149399eae4b"],
        ["jest-docblock", "26.0.0"],
        ["jest-haste-map", "26.6.2"],
        ["jest-leak-detector", "26.6.2"],
        ["jest-message-util", "26.6.2"],
        ["jest-resolve", "26.6.2"],
        ["jest-runtime", "26.6.3"],
        ["jest-util", "26.6.2"],
        ["jest-worker", "26.6.2"],
        ["source-map-support", "0.5.19"],
        ["throat", "5.0.0"],
        ["jest-runner", "26.6.3"],
      ]),
    }],
  ])],
  ["@jest/environment", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@jest-environment-26.6.2-ba364cc72e221e79cc8f0a99555bf5d7577cf92c/node_modules/@jest/environment/"),
      packageDependencies: new Map([
        ["@jest/fake-timers", "26.6.2"],
        ["@jest/types", "26.6.2"],
        ["@types/node", "14.14.10"],
        ["jest-mock", "26.6.2"],
        ["@jest/environment", "26.6.2"],
      ]),
    }],
  ])],
  ["@jest/fake-timers", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@jest-fake-timers-26.6.2-459c329bcf70cee4af4d7e3f3e67848123535aad/node_modules/@jest/fake-timers/"),
      packageDependencies: new Map([
        ["@jest/types", "26.6.2"],
        ["@sinonjs/fake-timers", "6.0.1"],
        ["@types/node", "14.14.10"],
        ["jest-message-util", "26.6.2"],
        ["jest-mock", "26.6.2"],
        ["jest-util", "26.6.2"],
        ["@jest/fake-timers", "26.6.2"],
      ]),
    }],
  ])],
  ["@sinonjs/fake-timers", new Map([
    ["6.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@sinonjs-fake-timers-6.0.1-293674fccb3262ac782c7aadfdeca86b10c75c40/node_modules/@sinonjs/fake-timers/"),
      packageDependencies: new Map([
        ["@sinonjs/commons", "1.8.1"],
        ["@sinonjs/fake-timers", "6.0.1"],
      ]),
    }],
  ])],
  ["@sinonjs/commons", new Map([
    ["1.8.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@sinonjs-commons-1.8.1-e7df00f98a203324f6dc7cc606cad9d4a8ab2217/node_modules/@sinonjs/commons/"),
      packageDependencies: new Map([
        ["type-detect", "4.0.8"],
        ["@sinonjs/commons", "1.8.1"],
      ]),
    }],
  ])],
  ["type-detect", new Map([
    ["4.0.8", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-type-detect-4.0.8-7646fb5f18871cfbb7749e69bd39a6388eb7450c/node_modules/type-detect/"),
      packageDependencies: new Map([
        ["type-detect", "4.0.8"],
      ]),
    }],
  ])],
  ["jest-mock", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-mock-26.6.2-d6cb712b041ed47fe0d9b6fc3474bc6543feb302/node_modules/jest-mock/"),
      packageDependencies: new Map([
        ["@jest/types", "26.6.2"],
        ["@types/node", "14.14.10"],
        ["jest-mock", "26.6.2"],
      ]),
    }],
  ])],
  ["emittery", new Map([
    ["0.7.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-emittery-0.7.2-25595908e13af0f5674ab419396e2fb394cdfa82/node_modules/emittery/"),
      packageDependencies: new Map([
        ["emittery", "0.7.2"],
      ]),
    }],
  ])],
  ["babel-jest", new Map([
    ["26.6.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-babel-jest-26.6.3-d87d25cb0037577a0c89f82e5755c5d293c01056/node_modules/babel-jest/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["@jest/transform", "26.6.2"],
        ["@jest/types", "26.6.2"],
        ["@types/babel__core", "7.1.12"],
        ["babel-plugin-istanbul", "6.0.0"],
        ["babel-preset-jest", "26.6.2"],
        ["chalk", "4.1.0"],
        ["graceful-fs", "4.2.4"],
        ["slash", "3.0.0"],
        ["babel-jest", "26.6.3"],
      ]),
    }],
  ])],
  ["@types/babel__core", new Map([
    ["7.1.12", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@types-babel-core-7.1.12-4d8e9e51eb265552a7e4f1ff2219ab6133bdfb2d/node_modules/@types/babel__core/"),
      packageDependencies: new Map([
        ["@babel/parser", "7.12.7"],
        ["@babel/types", "7.12.7"],
        ["@types/babel__generator", "7.6.2"],
        ["@types/babel__template", "7.4.0"],
        ["@types/babel__traverse", "7.0.16"],
        ["@types/babel__core", "7.1.12"],
      ]),
    }],
  ])],
  ["@types/babel__generator", new Map([
    ["7.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@types-babel-generator-7.6.2-f3d71178e187858f7c45e30380f8f1b7415a12d8/node_modules/@types/babel__generator/"),
      packageDependencies: new Map([
        ["@babel/types", "7.12.7"],
        ["@types/babel__generator", "7.6.2"],
      ]),
    }],
  ])],
  ["@types/babel__template", new Map([
    ["7.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@types-babel-template-7.4.0-0c888dd70b3ee9eebb6e4f200e809da0076262be/node_modules/@types/babel__template/"),
      packageDependencies: new Map([
        ["@babel/parser", "7.12.7"],
        ["@babel/types", "7.12.7"],
        ["@types/babel__template", "7.4.0"],
      ]),
    }],
  ])],
  ["@types/babel__traverse", new Map([
    ["7.0.16", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@types-babel-traverse-7.0.16-0bbbf70c7bc4193210dd27e252c51260a37cd6a7/node_modules/@types/babel__traverse/"),
      packageDependencies: new Map([
        ["@babel/types", "7.12.7"],
        ["@types/babel__traverse", "7.0.16"],
      ]),
    }],
  ])],
  ["babel-preset-jest", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-babel-preset-jest-26.6.2-747872b1171df032252426586881d62d31798fee/node_modules/babel-preset-jest/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["babel-plugin-jest-hoist", "26.6.2"],
        ["babel-preset-current-node-syntax", "1.0.0"],
        ["babel-preset-jest", "26.6.2"],
      ]),
    }],
  ])],
  ["babel-plugin-jest-hoist", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-babel-plugin-jest-hoist-26.6.2-8185bd030348d254c6d7dd974355e6a28b21e62d/node_modules/babel-plugin-jest-hoist/"),
      packageDependencies: new Map([
        ["@babel/template", "7.12.7"],
        ["@babel/types", "7.12.7"],
        ["@types/babel__core", "7.1.12"],
        ["@types/babel__traverse", "7.0.16"],
        ["babel-plugin-jest-hoist", "26.6.2"],
      ]),
    }],
  ])],
  ["babel-preset-current-node-syntax", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-babel-preset-current-node-syntax-1.0.0-cf5feef29551253471cfa82fc8e0f5063df07a77/node_modules/babel-preset-current-node-syntax/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["@babel/plugin-syntax-async-generators", "7.8.4"],
        ["@babel/plugin-syntax-bigint", "7.8.3"],
        ["@babel/plugin-syntax-class-properties", "7.12.1"],
        ["@babel/plugin-syntax-import-meta", "7.10.4"],
        ["@babel/plugin-syntax-json-strings", "7.8.3"],
        ["@babel/plugin-syntax-logical-assignment-operators", "7.10.4"],
        ["@babel/plugin-syntax-nullish-coalescing-operator", "7.8.3"],
        ["@babel/plugin-syntax-numeric-separator", "7.10.4"],
        ["@babel/plugin-syntax-object-rest-spread", "7.8.3"],
        ["@babel/plugin-syntax-optional-catch-binding", "7.8.3"],
        ["@babel/plugin-syntax-optional-chaining", "7.8.3"],
        ["@babel/plugin-syntax-top-level-await", "7.12.1"],
        ["babel-preset-current-node-syntax", "1.0.0"],
      ]),
    }],
  ])],
  ["@babel/plugin-syntax-async-generators", new Map([
    ["7.8.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-async-generators-7.8.4-a983fb1aeb2ec3f6ed042a210f640e90e786fe0d/node_modules/@babel/plugin-syntax-async-generators/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["@babel/helper-plugin-utils", "7.10.4"],
        ["@babel/plugin-syntax-async-generators", "7.8.4"],
      ]),
    }],
  ])],
  ["@babel/plugin-syntax-bigint", new Map([
    ["7.8.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-bigint-7.8.3-4c9a6f669f5d0cdf1b90a1671e9a146be5300cea/node_modules/@babel/plugin-syntax-bigint/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["@babel/helper-plugin-utils", "7.10.4"],
        ["@babel/plugin-syntax-bigint", "7.8.3"],
      ]),
    }],
  ])],
  ["@babel/plugin-syntax-class-properties", new Map([
    ["7.12.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-class-properties-7.12.1-bcb297c5366e79bebadef509549cd93b04f19978/node_modules/@babel/plugin-syntax-class-properties/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["@babel/helper-plugin-utils", "7.10.4"],
        ["@babel/plugin-syntax-class-properties", "7.12.1"],
      ]),
    }],
  ])],
  ["@babel/plugin-syntax-import-meta", new Map([
    ["7.10.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-import-meta-7.10.4-ee601348c370fa334d2207be158777496521fd51/node_modules/@babel/plugin-syntax-import-meta/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["@babel/helper-plugin-utils", "7.10.4"],
        ["@babel/plugin-syntax-import-meta", "7.10.4"],
      ]),
    }],
  ])],
  ["@babel/plugin-syntax-json-strings", new Map([
    ["7.8.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-json-strings-7.8.3-01ca21b668cd8218c9e640cb6dd88c5412b2c96a/node_modules/@babel/plugin-syntax-json-strings/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["@babel/helper-plugin-utils", "7.10.4"],
        ["@babel/plugin-syntax-json-strings", "7.8.3"],
      ]),
    }],
  ])],
  ["@babel/plugin-syntax-logical-assignment-operators", new Map([
    ["7.10.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-logical-assignment-operators-7.10.4-ca91ef46303530448b906652bac2e9fe9941f699/node_modules/@babel/plugin-syntax-logical-assignment-operators/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["@babel/helper-plugin-utils", "7.10.4"],
        ["@babel/plugin-syntax-logical-assignment-operators", "7.10.4"],
      ]),
    }],
  ])],
  ["@babel/plugin-syntax-nullish-coalescing-operator", new Map([
    ["7.8.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-nullish-coalescing-operator-7.8.3-167ed70368886081f74b5c36c65a88c03b66d1a9/node_modules/@babel/plugin-syntax-nullish-coalescing-operator/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["@babel/helper-plugin-utils", "7.10.4"],
        ["@babel/plugin-syntax-nullish-coalescing-operator", "7.8.3"],
      ]),
    }],
  ])],
  ["@babel/plugin-syntax-numeric-separator", new Map([
    ["7.10.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-numeric-separator-7.10.4-b9b070b3e33570cd9fd07ba7fa91c0dd37b9af97/node_modules/@babel/plugin-syntax-numeric-separator/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["@babel/helper-plugin-utils", "7.10.4"],
        ["@babel/plugin-syntax-numeric-separator", "7.10.4"],
      ]),
    }],
  ])],
  ["@babel/plugin-syntax-object-rest-spread", new Map([
    ["7.8.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-object-rest-spread-7.8.3-60e225edcbd98a640332a2e72dd3e66f1af55871/node_modules/@babel/plugin-syntax-object-rest-spread/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["@babel/helper-plugin-utils", "7.10.4"],
        ["@babel/plugin-syntax-object-rest-spread", "7.8.3"],
      ]),
    }],
  ])],
  ["@babel/plugin-syntax-optional-catch-binding", new Map([
    ["7.8.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-optional-catch-binding-7.8.3-6111a265bcfb020eb9efd0fdfd7d26402b9ed6c1/node_modules/@babel/plugin-syntax-optional-catch-binding/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["@babel/helper-plugin-utils", "7.10.4"],
        ["@babel/plugin-syntax-optional-catch-binding", "7.8.3"],
      ]),
    }],
  ])],
  ["@babel/plugin-syntax-optional-chaining", new Map([
    ["7.8.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-optional-chaining-7.8.3-4f69c2ab95167e0180cd5336613f8c5788f7d48a/node_modules/@babel/plugin-syntax-optional-chaining/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["@babel/helper-plugin-utils", "7.10.4"],
        ["@babel/plugin-syntax-optional-chaining", "7.8.3"],
      ]),
    }],
  ])],
  ["@babel/plugin-syntax-top-level-await", new Map([
    ["7.12.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-top-level-await-7.12.1-dd6c0b357ac1bb142d98537450a319625d13d2a0/node_modules/@babel/plugin-syntax-top-level-await/"),
      packageDependencies: new Map([
        ["@babel/core", "7.12.9"],
        ["@babel/helper-plugin-utils", "7.10.4"],
        ["@babel/plugin-syntax-top-level-await", "7.12.1"],
      ]),
    }],
  ])],
  ["deepmerge", new Map([
    ["4.2.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-deepmerge-4.2.2-44d2ea3679b8f4d4ffba33f03d865fc1e7bf4955/node_modules/deepmerge/"),
      packageDependencies: new Map([
        ["deepmerge", "4.2.2"],
      ]),
    }],
  ])],
  ["jest-environment-jsdom", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-environment-jsdom-26.6.2-78d09fe9cf019a357009b9b7e1f101d23bd1da3e/node_modules/jest-environment-jsdom/"),
      packageDependencies: new Map([
        ["@jest/environment", "26.6.2"],
        ["@jest/fake-timers", "26.6.2"],
        ["@jest/types", "26.6.2"],
        ["@types/node", "14.14.10"],
        ["jest-mock", "26.6.2"],
        ["jest-util", "26.6.2"],
        ["jsdom", "16.4.0"],
        ["jest-environment-jsdom", "26.6.2"],
      ]),
    }],
  ])],
  ["jsdom", new Map([
    ["16.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jsdom-16.4.0-36005bde2d136f73eee1a830c6d45e55408edddb/node_modules/jsdom/"),
      packageDependencies: new Map([
        ["abab", "2.0.5"],
        ["acorn", "7.4.1"],
        ["acorn-globals", "6.0.0"],
        ["cssom", "0.4.4"],
        ["cssstyle", "2.3.0"],
        ["data-urls", "2.0.0"],
        ["decimal.js", "10.2.1"],
        ["domexception", "2.0.1"],
        ["escodegen", "1.14.3"],
        ["html-encoding-sniffer", "2.0.1"],
        ["is-potential-custom-element-name", "1.0.0"],
        ["nwsapi", "2.2.0"],
        ["parse5", "5.1.1"],
        ["request", "2.88.2"],
        ["request-promise-native", "1.0.9"],
        ["saxes", "5.0.1"],
        ["symbol-tree", "3.2.4"],
        ["tough-cookie", "3.0.1"],
        ["w3c-hr-time", "1.0.2"],
        ["w3c-xmlserializer", "2.0.0"],
        ["webidl-conversions", "6.1.0"],
        ["whatwg-encoding", "1.0.5"],
        ["whatwg-mimetype", "2.3.0"],
        ["whatwg-url", "8.4.0"],
        ["ws", "7.4.0"],
        ["xml-name-validator", "3.0.0"],
        ["jsdom", "16.4.0"],
      ]),
    }],
  ])],
  ["abab", new Map([
    ["2.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-abab-2.0.5-c0b678fb32d60fc1219c784d6a826fe385aeb79a/node_modules/abab/"),
      packageDependencies: new Map([
        ["abab", "2.0.5"],
      ]),
    }],
  ])],
  ["acorn", new Map([
    ["7.4.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-acorn-7.4.1-feaed255973d2e77555b83dbc08851a6c63520fa/node_modules/acorn/"),
      packageDependencies: new Map([
        ["acorn", "7.4.1"],
      ]),
    }],
  ])],
  ["acorn-globals", new Map([
    ["6.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-acorn-globals-6.0.0-46cdd39f0f8ff08a876619b55f5ac8a6dc770b45/node_modules/acorn-globals/"),
      packageDependencies: new Map([
        ["acorn", "7.4.1"],
        ["acorn-walk", "7.2.0"],
        ["acorn-globals", "6.0.0"],
      ]),
    }],
  ])],
  ["acorn-walk", new Map([
    ["7.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-acorn-walk-7.2.0-0de889a601203909b0fbe07b8938dc21d2e967bc/node_modules/acorn-walk/"),
      packageDependencies: new Map([
        ["acorn-walk", "7.2.0"],
      ]),
    }],
  ])],
  ["cssom", new Map([
    ["0.4.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-cssom-0.4.4-5a66cf93d2d0b661d80bf6a44fb65f5c2e4e0a10/node_modules/cssom/"),
      packageDependencies: new Map([
        ["cssom", "0.4.4"],
      ]),
    }],
    ["0.3.8", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-cssom-0.3.8-9f1276f5b2b463f2114d3f2c75250af8c1a36f4a/node_modules/cssom/"),
      packageDependencies: new Map([
        ["cssom", "0.3.8"],
      ]),
    }],
  ])],
  ["cssstyle", new Map([
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-cssstyle-2.3.0-ff665a0ddbdc31864b09647f34163443d90b0852/node_modules/cssstyle/"),
      packageDependencies: new Map([
        ["cssom", "0.3.8"],
        ["cssstyle", "2.3.0"],
      ]),
    }],
  ])],
  ["data-urls", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-data-urls-2.0.0-156485a72963a970f5d5821aaf642bef2bf2db9b/node_modules/data-urls/"),
      packageDependencies: new Map([
        ["abab", "2.0.5"],
        ["whatwg-mimetype", "2.3.0"],
        ["whatwg-url", "8.4.0"],
        ["data-urls", "2.0.0"],
      ]),
    }],
  ])],
  ["whatwg-mimetype", new Map([
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-whatwg-mimetype-2.3.0-3d4b1e0312d2079879f826aff18dbeeca5960fbf/node_modules/whatwg-mimetype/"),
      packageDependencies: new Map([
        ["whatwg-mimetype", "2.3.0"],
      ]),
    }],
  ])],
  ["whatwg-url", new Map([
    ["8.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-whatwg-url-8.4.0-50fb9615b05469591d2b2bd6dfaed2942ed72837/node_modules/whatwg-url/"),
      packageDependencies: new Map([
        ["lodash.sortby", "4.7.0"],
        ["tr46", "2.0.2"],
        ["webidl-conversions", "6.1.0"],
        ["whatwg-url", "8.4.0"],
      ]),
    }],
  ])],
  ["lodash.sortby", new Map([
    ["4.7.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-lodash-sortby-4.7.0-edd14c824e2cc9c1e0b0a1b42bb5210516a42438/node_modules/lodash.sortby/"),
      packageDependencies: new Map([
        ["lodash.sortby", "4.7.0"],
      ]),
    }],
  ])],
  ["tr46", new Map([
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-tr46-2.0.2-03273586def1595ae08fedb38d7733cee91d2479/node_modules/tr46/"),
      packageDependencies: new Map([
        ["punycode", "2.1.1"],
        ["tr46", "2.0.2"],
      ]),
    }],
  ])],
  ["punycode", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-punycode-2.1.1-b58b010ac40c22c5657616c8d2c2c02c7bf479ec/node_modules/punycode/"),
      packageDependencies: new Map([
        ["punycode", "2.1.1"],
      ]),
    }],
  ])],
  ["webidl-conversions", new Map([
    ["6.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-webidl-conversions-6.1.0-9111b4d7ea80acd40f5270d666621afa78b69514/node_modules/webidl-conversions/"),
      packageDependencies: new Map([
        ["webidl-conversions", "6.1.0"],
      ]),
    }],
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-webidl-conversions-5.0.0-ae59c8a00b121543a2acc65c0434f57b0fc11aff/node_modules/webidl-conversions/"),
      packageDependencies: new Map([
        ["webidl-conversions", "5.0.0"],
      ]),
    }],
  ])],
  ["decimal.js", new Map([
    ["10.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-decimal-js-10.2.1-238ae7b0f0c793d3e3cea410108b35a2c01426a3/node_modules/decimal.js/"),
      packageDependencies: new Map([
        ["decimal.js", "10.2.1"],
      ]),
    }],
  ])],
  ["domexception", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-domexception-2.0.1-fb44aefba793e1574b0af6aed2801d057529f304/node_modules/domexception/"),
      packageDependencies: new Map([
        ["webidl-conversions", "5.0.0"],
        ["domexception", "2.0.1"],
      ]),
    }],
  ])],
  ["escodegen", new Map([
    ["1.14.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-escodegen-1.14.3-4e7b81fba61581dc97582ed78cab7f0e8d63f503/node_modules/escodegen/"),
      packageDependencies: new Map([
        ["esprima", "4.0.1"],
        ["estraverse", "4.3.0"],
        ["esutils", "2.0.3"],
        ["optionator", "0.8.3"],
        ["source-map", "0.6.1"],
        ["escodegen", "1.14.3"],
      ]),
    }],
  ])],
  ["estraverse", new Map([
    ["4.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-estraverse-4.3.0-398ad3f3c5a24948be7725e83d11a7de28cdbd1d/node_modules/estraverse/"),
      packageDependencies: new Map([
        ["estraverse", "4.3.0"],
      ]),
    }],
  ])],
  ["esutils", new Map([
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-esutils-2.0.3-74d2eb4de0b8da1293711910d50775b9b710ef64/node_modules/esutils/"),
      packageDependencies: new Map([
        ["esutils", "2.0.3"],
      ]),
    }],
  ])],
  ["optionator", new Map([
    ["0.8.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-optionator-0.8.3-84fa1d036fe9d3c7e21d99884b601167ec8fb495/node_modules/optionator/"),
      packageDependencies: new Map([
        ["deep-is", "0.1.3"],
        ["fast-levenshtein", "2.0.6"],
        ["levn", "0.3.0"],
        ["prelude-ls", "1.1.2"],
        ["type-check", "0.3.2"],
        ["word-wrap", "1.2.3"],
        ["optionator", "0.8.3"],
      ]),
    }],
  ])],
  ["deep-is", new Map([
    ["0.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-deep-is-0.1.3-b369d6fb5dbc13eecf524f91b070feedc357cf34/node_modules/deep-is/"),
      packageDependencies: new Map([
        ["deep-is", "0.1.3"],
      ]),
    }],
  ])],
  ["fast-levenshtein", new Map([
    ["2.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-fast-levenshtein-2.0.6-3d8a5c66883a16a30ca8643e851f19baa7797917/node_modules/fast-levenshtein/"),
      packageDependencies: new Map([
        ["fast-levenshtein", "2.0.6"],
      ]),
    }],
  ])],
  ["levn", new Map([
    ["0.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-levn-0.3.0-3b09924edf9f083c0490fdd4c0bc4421e04764ee/node_modules/levn/"),
      packageDependencies: new Map([
        ["prelude-ls", "1.1.2"],
        ["type-check", "0.3.2"],
        ["levn", "0.3.0"],
      ]),
    }],
  ])],
  ["prelude-ls", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-prelude-ls-1.1.2-21932a549f5e52ffd9a827f570e04be62a97da54/node_modules/prelude-ls/"),
      packageDependencies: new Map([
        ["prelude-ls", "1.1.2"],
      ]),
    }],
  ])],
  ["type-check", new Map([
    ["0.3.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-type-check-0.3.2-5884cab512cf1d355e3fb784f30804b2b520db72/node_modules/type-check/"),
      packageDependencies: new Map([
        ["prelude-ls", "1.1.2"],
        ["type-check", "0.3.2"],
      ]),
    }],
  ])],
  ["word-wrap", new Map([
    ["1.2.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-word-wrap-1.2.3-610636f6b1f703891bd34771ccb17fb93b47079c/node_modules/word-wrap/"),
      packageDependencies: new Map([
        ["word-wrap", "1.2.3"],
      ]),
    }],
  ])],
  ["html-encoding-sniffer", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-html-encoding-sniffer-2.0.1-42a6dc4fd33f00281176e8b23759ca4e4fa185f3/node_modules/html-encoding-sniffer/"),
      packageDependencies: new Map([
        ["whatwg-encoding", "1.0.5"],
        ["html-encoding-sniffer", "2.0.1"],
      ]),
    }],
  ])],
  ["whatwg-encoding", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-whatwg-encoding-1.0.5-5abacf777c32166a51d085d6b4f3e7d27113ddb0/node_modules/whatwg-encoding/"),
      packageDependencies: new Map([
        ["iconv-lite", "0.4.24"],
        ["whatwg-encoding", "1.0.5"],
      ]),
    }],
  ])],
  ["iconv-lite", new Map([
    ["0.4.24", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-iconv-lite-0.4.24-2022b4b25fbddc21d2f524974a474aafe733908b/node_modules/iconv-lite/"),
      packageDependencies: new Map([
        ["safer-buffer", "2.1.2"],
        ["iconv-lite", "0.4.24"],
      ]),
    }],
  ])],
  ["safer-buffer", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-safer-buffer-2.1.2-44fa161b0187b9549dd84bb91802f9bd8385cd6a/node_modules/safer-buffer/"),
      packageDependencies: new Map([
        ["safer-buffer", "2.1.2"],
      ]),
    }],
  ])],
  ["is-potential-custom-element-name", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-potential-custom-element-name-1.0.0-0c52e54bcca391bb2c494b21e8626d7336c6e397/node_modules/is-potential-custom-element-name/"),
      packageDependencies: new Map([
        ["is-potential-custom-element-name", "1.0.0"],
      ]),
    }],
  ])],
  ["nwsapi", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-nwsapi-2.2.0-204879a9e3d068ff2a55139c2c772780681a38b7/node_modules/nwsapi/"),
      packageDependencies: new Map([
        ["nwsapi", "2.2.0"],
      ]),
    }],
  ])],
  ["parse5", new Map([
    ["5.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-parse5-5.1.1-f68e4e5ba1852ac2cadc00f4555fff6c2abb6178/node_modules/parse5/"),
      packageDependencies: new Map([
        ["parse5", "5.1.1"],
      ]),
    }],
  ])],
  ["request", new Map([
    ["2.88.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-request-2.88.2-d73c918731cb5a87da047e207234146f664d12b3/node_modules/request/"),
      packageDependencies: new Map([
        ["aws-sign2", "0.7.0"],
        ["aws4", "1.11.0"],
        ["caseless", "0.12.0"],
        ["combined-stream", "1.0.8"],
        ["extend", "3.0.2"],
        ["forever-agent", "0.6.1"],
        ["form-data", "2.3.3"],
        ["har-validator", "5.1.5"],
        ["http-signature", "1.2.0"],
        ["is-typedarray", "1.0.0"],
        ["isstream", "0.1.2"],
        ["json-stringify-safe", "5.0.1"],
        ["mime-types", "2.1.27"],
        ["oauth-sign", "0.9.0"],
        ["performance-now", "2.1.0"],
        ["qs", "6.5.2"],
        ["safe-buffer", "5.2.1"],
        ["tough-cookie", "2.5.0"],
        ["tunnel-agent", "0.6.0"],
        ["uuid", "3.4.0"],
        ["request", "2.88.2"],
      ]),
    }],
  ])],
  ["aws-sign2", new Map([
    ["0.7.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-aws-sign2-0.7.0-b46e890934a9591f2d2f6f86d7e6a9f1b3fe76a8/node_modules/aws-sign2/"),
      packageDependencies: new Map([
        ["aws-sign2", "0.7.0"],
      ]),
    }],
  ])],
  ["aws4", new Map([
    ["1.11.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-aws4-1.11.0-d61f46d83b2519250e2784daf5b09479a8b41c59/node_modules/aws4/"),
      packageDependencies: new Map([
        ["aws4", "1.11.0"],
      ]),
    }],
  ])],
  ["caseless", new Map([
    ["0.12.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-caseless-0.12.0-1b681c21ff84033c826543090689420d187151dc/node_modules/caseless/"),
      packageDependencies: new Map([
        ["caseless", "0.12.0"],
      ]),
    }],
  ])],
  ["combined-stream", new Map([
    ["1.0.8", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-combined-stream-1.0.8-c3d45a8b34fd730631a110a8a2520682b31d5a7f/node_modules/combined-stream/"),
      packageDependencies: new Map([
        ["delayed-stream", "1.0.0"],
        ["combined-stream", "1.0.8"],
      ]),
    }],
  ])],
  ["delayed-stream", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-delayed-stream-1.0.0-df3ae199acadfb7d440aaae0b29e2272b24ec619/node_modules/delayed-stream/"),
      packageDependencies: new Map([
        ["delayed-stream", "1.0.0"],
      ]),
    }],
  ])],
  ["extend", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-extend-3.0.2-f8b1136b4071fbd8eb140aff858b1019ec2915fa/node_modules/extend/"),
      packageDependencies: new Map([
        ["extend", "3.0.2"],
      ]),
    }],
  ])],
  ["forever-agent", new Map([
    ["0.6.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-forever-agent-0.6.1-fbc71f0c41adeb37f96c577ad1ed42d8fdacca91/node_modules/forever-agent/"),
      packageDependencies: new Map([
        ["forever-agent", "0.6.1"],
      ]),
    }],
  ])],
  ["form-data", new Map([
    ["2.3.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-form-data-2.3.3-dcce52c05f644f298c6a7ab936bd724ceffbf3a6/node_modules/form-data/"),
      packageDependencies: new Map([
        ["asynckit", "0.4.0"],
        ["combined-stream", "1.0.8"],
        ["mime-types", "2.1.27"],
        ["form-data", "2.3.3"],
      ]),
    }],
  ])],
  ["asynckit", new Map([
    ["0.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-asynckit-0.4.0-c79ed97f7f34cb8f2ba1bc9790bcc366474b4b79/node_modules/asynckit/"),
      packageDependencies: new Map([
        ["asynckit", "0.4.0"],
      ]),
    }],
  ])],
  ["mime-types", new Map([
    ["2.1.27", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-mime-types-2.1.27-47949f98e279ea53119f5722e0f34e529bec009f/node_modules/mime-types/"),
      packageDependencies: new Map([
        ["mime-db", "1.44.0"],
        ["mime-types", "2.1.27"],
      ]),
    }],
  ])],
  ["mime-db", new Map([
    ["1.44.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-mime-db-1.44.0-fa11c5eb0aca1334b4233cb4d52f10c5a6272f92/node_modules/mime-db/"),
      packageDependencies: new Map([
        ["mime-db", "1.44.0"],
      ]),
    }],
  ])],
  ["har-validator", new Map([
    ["5.1.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-har-validator-5.1.5-1f0803b9f8cb20c0fa13822df1ecddb36bde1efd/node_modules/har-validator/"),
      packageDependencies: new Map([
        ["ajv", "6.12.6"],
        ["har-schema", "2.0.0"],
        ["har-validator", "5.1.5"],
      ]),
    }],
  ])],
  ["ajv", new Map([
    ["6.12.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-ajv-6.12.6-baf5a62e802b07d977034586f8c3baf5adf26df4/node_modules/ajv/"),
      packageDependencies: new Map([
        ["fast-deep-equal", "3.1.3"],
        ["fast-json-stable-stringify", "2.1.0"],
        ["json-schema-traverse", "0.4.1"],
        ["uri-js", "4.4.0"],
        ["ajv", "6.12.6"],
      ]),
    }],
  ])],
  ["fast-deep-equal", new Map([
    ["3.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-fast-deep-equal-3.1.3-3a7d56b559d6cbc3eb512325244e619a65c6c525/node_modules/fast-deep-equal/"),
      packageDependencies: new Map([
        ["fast-deep-equal", "3.1.3"],
      ]),
    }],
  ])],
  ["json-schema-traverse", new Map([
    ["0.4.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-json-schema-traverse-0.4.1-69f6a87d9513ab8bb8fe63bdb0979c448e684660/node_modules/json-schema-traverse/"),
      packageDependencies: new Map([
        ["json-schema-traverse", "0.4.1"],
      ]),
    }],
  ])],
  ["uri-js", new Map([
    ["4.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-uri-js-4.4.0-aa714261de793e8a82347a7bcc9ce74e86f28602/node_modules/uri-js/"),
      packageDependencies: new Map([
        ["punycode", "2.1.1"],
        ["uri-js", "4.4.0"],
      ]),
    }],
  ])],
  ["har-schema", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-har-schema-2.0.0-a94c2224ebcac04782a0d9035521f24735b7ec92/node_modules/har-schema/"),
      packageDependencies: new Map([
        ["har-schema", "2.0.0"],
      ]),
    }],
  ])],
  ["http-signature", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-http-signature-1.2.0-9aecd925114772f3d95b65a60abb8f7c18fbace1/node_modules/http-signature/"),
      packageDependencies: new Map([
        ["assert-plus", "1.0.0"],
        ["jsprim", "1.4.1"],
        ["sshpk", "1.16.1"],
        ["http-signature", "1.2.0"],
      ]),
    }],
  ])],
  ["assert-plus", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-assert-plus-1.0.0-f12e0f3c5d77b0b1cdd9146942e4e96c1e4dd525/node_modules/assert-plus/"),
      packageDependencies: new Map([
        ["assert-plus", "1.0.0"],
      ]),
    }],
  ])],
  ["jsprim", new Map([
    ["1.4.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jsprim-1.4.1-313e66bc1e5cc06e438bc1b7499c2e5c56acb6a2/node_modules/jsprim/"),
      packageDependencies: new Map([
        ["assert-plus", "1.0.0"],
        ["extsprintf", "1.3.0"],
        ["json-schema", "0.2.3"],
        ["verror", "1.10.0"],
        ["jsprim", "1.4.1"],
      ]),
    }],
  ])],
  ["extsprintf", new Map([
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-extsprintf-1.3.0-96918440e3041a7a414f8c52e3c574eb3c3e1e05/node_modules/extsprintf/"),
      packageDependencies: new Map([
        ["extsprintf", "1.3.0"],
      ]),
    }],
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-extsprintf-1.4.0-e2689f8f356fad62cca65a3a91c5df5f9551692f/node_modules/extsprintf/"),
      packageDependencies: new Map([
        ["extsprintf", "1.4.0"],
      ]),
    }],
  ])],
  ["json-schema", new Map([
    ["0.2.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-json-schema-0.2.3-b480c892e59a2f05954ce727bd3f2a4e882f9e13/node_modules/json-schema/"),
      packageDependencies: new Map([
        ["json-schema", "0.2.3"],
      ]),
    }],
  ])],
  ["verror", new Map([
    ["1.10.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-verror-1.10.0-3a105ca17053af55d6e270c1f8288682e18da400/node_modules/verror/"),
      packageDependencies: new Map([
        ["assert-plus", "1.0.0"],
        ["core-util-is", "1.0.2"],
        ["extsprintf", "1.4.0"],
        ["verror", "1.10.0"],
      ]),
    }],
  ])],
  ["core-util-is", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-core-util-is-1.0.2-b5fd54220aa2bc5ab57aab7140c940754503c1a7/node_modules/core-util-is/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.2"],
      ]),
    }],
  ])],
  ["sshpk", new Map([
    ["1.16.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-sshpk-1.16.1-fb661c0bef29b39db40769ee39fa70093d6f6877/node_modules/sshpk/"),
      packageDependencies: new Map([
        ["asn1", "0.2.4"],
        ["assert-plus", "1.0.0"],
        ["bcrypt-pbkdf", "1.0.2"],
        ["dashdash", "1.14.1"],
        ["ecc-jsbn", "0.1.2"],
        ["getpass", "0.1.7"],
        ["jsbn", "0.1.1"],
        ["safer-buffer", "2.1.2"],
        ["tweetnacl", "0.14.5"],
        ["sshpk", "1.16.1"],
      ]),
    }],
  ])],
  ["asn1", new Map([
    ["0.2.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-asn1-0.2.4-8d2475dfab553bb33e77b54e59e880bb8ce23136/node_modules/asn1/"),
      packageDependencies: new Map([
        ["safer-buffer", "2.1.2"],
        ["asn1", "0.2.4"],
      ]),
    }],
  ])],
  ["bcrypt-pbkdf", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-bcrypt-pbkdf-1.0.2-a4301d389b6a43f9b67ff3ca11a3f6637e360e9e/node_modules/bcrypt-pbkdf/"),
      packageDependencies: new Map([
        ["tweetnacl", "0.14.5"],
        ["bcrypt-pbkdf", "1.0.2"],
      ]),
    }],
  ])],
  ["tweetnacl", new Map([
    ["0.14.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-tweetnacl-0.14.5-5ae68177f192d4456269d108afa93ff8743f4f64/node_modules/tweetnacl/"),
      packageDependencies: new Map([
        ["tweetnacl", "0.14.5"],
      ]),
    }],
  ])],
  ["dashdash", new Map([
    ["1.14.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-dashdash-1.14.1-853cfa0f7cbe2fed5de20326b8dd581035f6e2f0/node_modules/dashdash/"),
      packageDependencies: new Map([
        ["assert-plus", "1.0.0"],
        ["dashdash", "1.14.1"],
      ]),
    }],
  ])],
  ["ecc-jsbn", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-ecc-jsbn-0.1.2-3a83a904e54353287874c564b7549386849a98c9/node_modules/ecc-jsbn/"),
      packageDependencies: new Map([
        ["jsbn", "0.1.1"],
        ["safer-buffer", "2.1.2"],
        ["ecc-jsbn", "0.1.2"],
      ]),
    }],
  ])],
  ["jsbn", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jsbn-0.1.1-a5e654c2e5a2deb5f201d96cefbca80c0ef2f513/node_modules/jsbn/"),
      packageDependencies: new Map([
        ["jsbn", "0.1.1"],
      ]),
    }],
  ])],
  ["getpass", new Map([
    ["0.1.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-getpass-0.1.7-5eff8e3e684d569ae4cb2b1282604e8ba62149fa/node_modules/getpass/"),
      packageDependencies: new Map([
        ["assert-plus", "1.0.0"],
        ["getpass", "0.1.7"],
      ]),
    }],
  ])],
  ["isstream", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-isstream-0.1.2-47e63f7af55afa6f92e1500e690eb8b8529c099a/node_modules/isstream/"),
      packageDependencies: new Map([
        ["isstream", "0.1.2"],
      ]),
    }],
  ])],
  ["json-stringify-safe", new Map([
    ["5.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-json-stringify-safe-5.0.1-1296a2d58fd45f19a0f6ce01d65701e2c735b6eb/node_modules/json-stringify-safe/"),
      packageDependencies: new Map([
        ["json-stringify-safe", "5.0.1"],
      ]),
    }],
  ])],
  ["oauth-sign", new Map([
    ["0.9.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-oauth-sign-0.9.0-47a7b016baa68b5fa0ecf3dee08a85c679ac6455/node_modules/oauth-sign/"),
      packageDependencies: new Map([
        ["oauth-sign", "0.9.0"],
      ]),
    }],
  ])],
  ["performance-now", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-performance-now-2.1.0-6309f4e0e5fa913ec1c69307ae364b4b377c9e7b/node_modules/performance-now/"),
      packageDependencies: new Map([
        ["performance-now", "2.1.0"],
      ]),
    }],
  ])],
  ["qs", new Map([
    ["6.5.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-qs-6.5.2-cb3ae806e8740444584ef154ce8ee98d403f3e36/node_modules/qs/"),
      packageDependencies: new Map([
        ["qs", "6.5.2"],
      ]),
    }],
  ])],
  ["tough-cookie", new Map([
    ["2.5.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-tough-cookie-2.5.0-cd9fb2a0aa1d5a12b473bd9fb96fa3dcff65ade2/node_modules/tough-cookie/"),
      packageDependencies: new Map([
        ["psl", "1.8.0"],
        ["punycode", "2.1.1"],
        ["tough-cookie", "2.5.0"],
      ]),
    }],
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-tough-cookie-3.0.1-9df4f57e739c26930a018184887f4adb7dca73b2/node_modules/tough-cookie/"),
      packageDependencies: new Map([
        ["ip-regex", "2.1.0"],
        ["psl", "1.8.0"],
        ["punycode", "2.1.1"],
        ["tough-cookie", "3.0.1"],
      ]),
    }],
  ])],
  ["psl", new Map([
    ["1.8.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-psl-1.8.0-9326f8bcfb013adcc005fdff056acce020e51c24/node_modules/psl/"),
      packageDependencies: new Map([
        ["psl", "1.8.0"],
      ]),
    }],
  ])],
  ["tunnel-agent", new Map([
    ["0.6.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-tunnel-agent-0.6.0-27a5dea06b36b04a0a9966774b290868f0fc40fd/node_modules/tunnel-agent/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.2.1"],
        ["tunnel-agent", "0.6.0"],
      ]),
    }],
  ])],
  ["request-promise-native", new Map([
    ["1.0.9", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-request-promise-native-1.0.9-e407120526a5efdc9a39b28a5679bf47b9d9dc28/node_modules/request-promise-native/"),
      packageDependencies: new Map([
        ["request", "2.88.2"],
        ["request-promise-core", "1.1.4"],
        ["stealthy-require", "1.1.1"],
        ["tough-cookie", "2.5.0"],
        ["request-promise-native", "1.0.9"],
      ]),
    }],
  ])],
  ["request-promise-core", new Map([
    ["1.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-request-promise-core-1.1.4-3eedd4223208d419867b78ce815167d10593a22f/node_modules/request-promise-core/"),
      packageDependencies: new Map([
        ["request", "2.88.2"],
        ["lodash", "4.17.20"],
        ["request-promise-core", "1.1.4"],
      ]),
    }],
  ])],
  ["stealthy-require", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-stealthy-require-1.1.1-35b09875b4ff49f26a777e509b3090a3226bf24b/node_modules/stealthy-require/"),
      packageDependencies: new Map([
        ["stealthy-require", "1.1.1"],
      ]),
    }],
  ])],
  ["saxes", new Map([
    ["5.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-saxes-5.0.1-eebab953fa3b7608dbe94e5dadb15c888fa6696d/node_modules/saxes/"),
      packageDependencies: new Map([
        ["xmlchars", "2.2.0"],
        ["saxes", "5.0.1"],
      ]),
    }],
  ])],
  ["xmlchars", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-xmlchars-2.2.0-060fe1bcb7f9c76fe2a17db86a9bc3ab894210cb/node_modules/xmlchars/"),
      packageDependencies: new Map([
        ["xmlchars", "2.2.0"],
      ]),
    }],
  ])],
  ["symbol-tree", new Map([
    ["3.2.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-symbol-tree-3.2.4-430637d248ba77e078883951fb9aa0eed7c63fa2/node_modules/symbol-tree/"),
      packageDependencies: new Map([
        ["symbol-tree", "3.2.4"],
      ]),
    }],
  ])],
  ["ip-regex", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-ip-regex-2.1.0-fa78bf5d2e6913c911ce9f819ee5146bb6d844e9/node_modules/ip-regex/"),
      packageDependencies: new Map([
        ["ip-regex", "2.1.0"],
      ]),
    }],
  ])],
  ["w3c-hr-time", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-w3c-hr-time-1.0.2-0a89cdf5cc15822df9c360543676963e0cc308cd/node_modules/w3c-hr-time/"),
      packageDependencies: new Map([
        ["browser-process-hrtime", "1.0.0"],
        ["w3c-hr-time", "1.0.2"],
      ]),
    }],
  ])],
  ["browser-process-hrtime", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-browser-process-hrtime-1.0.0-3c9b4b7d782c8121e56f10106d84c0d0ffc94626/node_modules/browser-process-hrtime/"),
      packageDependencies: new Map([
        ["browser-process-hrtime", "1.0.0"],
      ]),
    }],
  ])],
  ["w3c-xmlserializer", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-w3c-xmlserializer-2.0.0-3e7104a05b75146cc60f564380b7f683acf1020a/node_modules/w3c-xmlserializer/"),
      packageDependencies: new Map([
        ["xml-name-validator", "3.0.0"],
        ["w3c-xmlserializer", "2.0.0"],
      ]),
    }],
  ])],
  ["xml-name-validator", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-xml-name-validator-3.0.0-6ae73e06de4d8c6e47f9fb181f78d648ad457c6a/node_modules/xml-name-validator/"),
      packageDependencies: new Map([
        ["xml-name-validator", "3.0.0"],
      ]),
    }],
  ])],
  ["ws", new Map([
    ["7.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-ws-7.4.0-a5dd76a24197940d4a8bb9e0e152bb4503764da7/node_modules/ws/"),
      packageDependencies: new Map([
        ["ws", "7.4.0"],
      ]),
    }],
  ])],
  ["jest-environment-node", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-environment-node-26.6.2-824e4c7fb4944646356f11ac75b229b0035f2b0c/node_modules/jest-environment-node/"),
      packageDependencies: new Map([
        ["@jest/environment", "26.6.2"],
        ["@jest/fake-timers", "26.6.2"],
        ["@jest/types", "26.6.2"],
        ["@types/node", "14.14.10"],
        ["jest-mock", "26.6.2"],
        ["jest-util", "26.6.2"],
        ["jest-environment-node", "26.6.2"],
      ]),
    }],
  ])],
  ["jest-get-type", new Map([
    ["26.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-get-type-26.3.0-e97dc3c3f53c2b406ca7afaed4493b1d099199e0/node_modules/jest-get-type/"),
      packageDependencies: new Map([
        ["jest-get-type", "26.3.0"],
      ]),
    }],
  ])],
  ["jest-jasmine2", new Map([
    ["26.6.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-jasmine2-26.6.3-adc3cf915deacb5212c93b9f3547cd12958f2edd/node_modules/jest-jasmine2/"),
      packageDependencies: new Map([
        ["@babel/traverse", "7.12.9"],
        ["@jest/environment", "26.6.2"],
        ["@jest/source-map", "26.6.2"],
        ["@jest/test-result", "26.6.2"],
        ["@jest/types", "26.6.2"],
        ["@types/node", "14.14.10"],
        ["chalk", "4.1.0"],
        ["co", "4.6.0"],
        ["expect", "26.6.2"],
        ["is-generator-fn", "2.1.0"],
        ["jest-each", "26.6.2"],
        ["jest-matcher-utils", "26.6.2"],
        ["jest-message-util", "26.6.2"],
        ["jest-runtime", "26.6.3"],
        ["jest-snapshot", "26.6.2"],
        ["jest-util", "26.6.2"],
        ["pretty-format", "26.6.2"],
        ["throat", "5.0.0"],
        ["jest-jasmine2", "26.6.3"],
      ]),
    }],
  ])],
  ["@jest/source-map", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@jest-source-map-26.6.2-29af5e1e2e324cafccc936f218309f54ab69d535/node_modules/@jest/source-map/"),
      packageDependencies: new Map([
        ["callsites", "3.1.0"],
        ["graceful-fs", "4.2.4"],
        ["source-map", "0.6.1"],
        ["@jest/source-map", "26.6.2"],
      ]),
    }],
  ])],
  ["callsites", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-callsites-3.1.0-b3630abd8943432f54b3f0519238e33cd7df2f73/node_modules/callsites/"),
      packageDependencies: new Map([
        ["callsites", "3.1.0"],
      ]),
    }],
  ])],
  ["co", new Map([
    ["4.6.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-co-4.6.0-6ea6bdf3d853ae54ccb8e47bfa0bf3f9031fb184/node_modules/co/"),
      packageDependencies: new Map([
        ["co", "4.6.0"],
      ]),
    }],
  ])],
  ["expect", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-expect-26.6.2-c6b996bf26bf3fe18b67b2d0f51fc981ba934417/node_modules/expect/"),
      packageDependencies: new Map([
        ["@jest/types", "26.6.2"],
        ["ansi-styles", "4.3.0"],
        ["jest-get-type", "26.3.0"],
        ["jest-matcher-utils", "26.6.2"],
        ["jest-message-util", "26.6.2"],
        ["jest-regex-util", "26.0.0"],
        ["expect", "26.6.2"],
      ]),
    }],
  ])],
  ["jest-matcher-utils", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-matcher-utils-26.6.2-8e6fd6e863c8b2d31ac6472eeb237bc595e53e7a/node_modules/jest-matcher-utils/"),
      packageDependencies: new Map([
        ["chalk", "4.1.0"],
        ["jest-diff", "26.6.2"],
        ["jest-get-type", "26.3.0"],
        ["pretty-format", "26.6.2"],
        ["jest-matcher-utils", "26.6.2"],
      ]),
    }],
  ])],
  ["jest-diff", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-diff-26.6.2-1aa7468b52c3a68d7d5c5fdcdfcd5e49bd164394/node_modules/jest-diff/"),
      packageDependencies: new Map([
        ["chalk", "4.1.0"],
        ["diff-sequences", "26.6.2"],
        ["jest-get-type", "26.3.0"],
        ["pretty-format", "26.6.2"],
        ["jest-diff", "26.6.2"],
      ]),
    }],
  ])],
  ["diff-sequences", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-diff-sequences-26.6.2-48ba99157de1923412eed41db6b6d4aa9ca7c0b1/node_modules/diff-sequences/"),
      packageDependencies: new Map([
        ["diff-sequences", "26.6.2"],
      ]),
    }],
  ])],
  ["is-generator-fn", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-generator-fn-2.1.0-7d140adc389aaf3011a8f2a2a4cfa6faadffb118/node_modules/is-generator-fn/"),
      packageDependencies: new Map([
        ["is-generator-fn", "2.1.0"],
      ]),
    }],
  ])],
  ["jest-each", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-each-26.6.2-02526438a77a67401c8a6382dfe5999952c167cb/node_modules/jest-each/"),
      packageDependencies: new Map([
        ["@jest/types", "26.6.2"],
        ["chalk", "4.1.0"],
        ["jest-get-type", "26.3.0"],
        ["jest-util", "26.6.2"],
        ["pretty-format", "26.6.2"],
        ["jest-each", "26.6.2"],
      ]),
    }],
  ])],
  ["jest-runtime", new Map([
    ["26.6.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-runtime-26.6.3-4f64efbcfac398331b74b4b3c82d27d401b8fa2b/node_modules/jest-runtime/"),
      packageDependencies: new Map([
        ["@jest/console", "26.6.2"],
        ["@jest/environment", "26.6.2"],
        ["@jest/fake-timers", "26.6.2"],
        ["@jest/globals", "26.6.2"],
        ["@jest/source-map", "26.6.2"],
        ["@jest/test-result", "26.6.2"],
        ["@jest/transform", "26.6.2"],
        ["@jest/types", "26.6.2"],
        ["@types/yargs", "15.0.10"],
        ["chalk", "4.1.0"],
        ["cjs-module-lexer", "0.6.0"],
        ["collect-v8-coverage", "1.0.1"],
        ["exit", "0.1.2"],
        ["glob", "7.1.6"],
        ["graceful-fs", "4.2.4"],
        ["jest-config", "pnp:e1d5cb28cb6a685f6cd90d3e6e1bcca052b998f1"],
        ["jest-haste-map", "26.6.2"],
        ["jest-message-util", "26.6.2"],
        ["jest-mock", "26.6.2"],
        ["jest-regex-util", "26.0.0"],
        ["jest-resolve", "26.6.2"],
        ["jest-snapshot", "26.6.2"],
        ["jest-util", "26.6.2"],
        ["jest-validate", "26.6.2"],
        ["slash", "3.0.0"],
        ["strip-bom", "4.0.0"],
        ["yargs", "15.4.1"],
        ["jest-runtime", "26.6.3"],
      ]),
    }],
  ])],
  ["@jest/globals", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@jest-globals-26.6.2-5b613b78a1aa2655ae908eba638cc96a20df720a/node_modules/@jest/globals/"),
      packageDependencies: new Map([
        ["@jest/environment", "26.6.2"],
        ["@jest/types", "26.6.2"],
        ["expect", "26.6.2"],
        ["@jest/globals", "26.6.2"],
      ]),
    }],
  ])],
  ["cjs-module-lexer", new Map([
    ["0.6.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-cjs-module-lexer-0.6.0-4186fcca0eae175970aee870b9fe2d6cf8d5655f/node_modules/cjs-module-lexer/"),
      packageDependencies: new Map([
        ["cjs-module-lexer", "0.6.0"],
      ]),
    }],
  ])],
  ["jest-validate", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-validate-26.6.2-23d380971587150467342911c3d7b4ac57ab20ec/node_modules/jest-validate/"),
      packageDependencies: new Map([
        ["@jest/types", "26.6.2"],
        ["camelcase", "6.2.0"],
        ["chalk", "4.1.0"],
        ["jest-get-type", "26.3.0"],
        ["leven", "3.1.0"],
        ["pretty-format", "26.6.2"],
        ["jest-validate", "26.6.2"],
      ]),
    }],
  ])],
  ["leven", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-leven-3.1.0-77891de834064cccba82ae7842bb6b14a13ed7f2/node_modules/leven/"),
      packageDependencies: new Map([
        ["leven", "3.1.0"],
      ]),
    }],
  ])],
  ["jest-snapshot", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-snapshot-26.6.2-f3b0af1acb223316850bd14e1beea9837fb39c84/node_modules/jest-snapshot/"),
      packageDependencies: new Map([
        ["@babel/types", "7.12.7"],
        ["@jest/types", "26.6.2"],
        ["@types/babel__traverse", "7.0.16"],
        ["@types/prettier", "2.1.5"],
        ["chalk", "4.1.0"],
        ["expect", "26.6.2"],
        ["graceful-fs", "4.2.4"],
        ["jest-diff", "26.6.2"],
        ["jest-get-type", "26.3.0"],
        ["jest-haste-map", "26.6.2"],
        ["jest-matcher-utils", "26.6.2"],
        ["jest-message-util", "26.6.2"],
        ["jest-resolve", "26.6.2"],
        ["natural-compare", "1.4.0"],
        ["pretty-format", "26.6.2"],
        ["semver", "7.3.2"],
        ["jest-snapshot", "26.6.2"],
      ]),
    }],
  ])],
  ["@types/prettier", new Map([
    ["2.1.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@types-prettier-2.1.5-b6ab3bba29e16b821d84e09ecfaded462b816b00/node_modules/@types/prettier/"),
      packageDependencies: new Map([
        ["@types/prettier", "2.1.5"],
      ]),
    }],
  ])],
  ["natural-compare", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-natural-compare-1.4.0-4abebfeed7541f2c27acfb29bdbbd15c8d5ba4f7/node_modules/natural-compare/"),
      packageDependencies: new Map([
        ["natural-compare", "1.4.0"],
      ]),
    }],
  ])],
  ["strip-bom", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-strip-bom-4.0.0-9c3505c1db45bcedca3d9cf7a16f5c5aa3901878/node_modules/strip-bom/"),
      packageDependencies: new Map([
        ["strip-bom", "4.0.0"],
      ]),
    }],
  ])],
  ["yargs", new Map([
    ["15.4.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-yargs-15.4.1-0d87a16de01aee9d8bec2bfbf74f67851730f4f8/node_modules/yargs/"),
      packageDependencies: new Map([
        ["cliui", "6.0.0"],
        ["decamelize", "1.2.0"],
        ["find-up", "4.1.0"],
        ["get-caller-file", "2.0.5"],
        ["require-directory", "2.1.1"],
        ["require-main-filename", "2.0.0"],
        ["set-blocking", "2.0.0"],
        ["string-width", "4.2.0"],
        ["which-module", "2.0.0"],
        ["y18n", "4.0.1"],
        ["yargs-parser", "18.1.3"],
        ["yargs", "15.4.1"],
      ]),
    }],
  ])],
  ["cliui", new Map([
    ["6.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-cliui-6.0.0-511d702c0c4e41ca156d7d0e96021f23e13225b1/node_modules/cliui/"),
      packageDependencies: new Map([
        ["string-width", "4.2.0"],
        ["strip-ansi", "6.0.0"],
        ["wrap-ansi", "6.2.0"],
        ["cliui", "6.0.0"],
      ]),
    }],
  ])],
  ["string-width", new Map([
    ["4.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-string-width-4.2.0-952182c46cc7b2c313d1596e623992bd163b72b5/node_modules/string-width/"),
      packageDependencies: new Map([
        ["emoji-regex", "8.0.0"],
        ["is-fullwidth-code-point", "3.0.0"],
        ["strip-ansi", "6.0.0"],
        ["string-width", "4.2.0"],
      ]),
    }],
  ])],
  ["emoji-regex", new Map([
    ["8.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-emoji-regex-8.0.0-e818fd69ce5ccfcb404594f842963bf53164cc37/node_modules/emoji-regex/"),
      packageDependencies: new Map([
        ["emoji-regex", "8.0.0"],
      ]),
    }],
  ])],
  ["is-fullwidth-code-point", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-fullwidth-code-point-3.0.0-f116f8064fe90b3f7844a38997c0b75051269f1d/node_modules/is-fullwidth-code-point/"),
      packageDependencies: new Map([
        ["is-fullwidth-code-point", "3.0.0"],
      ]),
    }],
  ])],
  ["wrap-ansi", new Map([
    ["6.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-wrap-ansi-6.2.0-e9393ba07102e6c91a3b221478f0257cd2856e53/node_modules/wrap-ansi/"),
      packageDependencies: new Map([
        ["ansi-styles", "4.3.0"],
        ["string-width", "4.2.0"],
        ["strip-ansi", "6.0.0"],
        ["wrap-ansi", "6.2.0"],
      ]),
    }],
  ])],
  ["decamelize", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-decamelize-1.2.0-f6534d15148269b20352e7bee26f501f9a191290/node_modules/decamelize/"),
      packageDependencies: new Map([
        ["decamelize", "1.2.0"],
      ]),
    }],
  ])],
  ["get-caller-file", new Map([
    ["2.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-get-caller-file-2.0.5-4f94412a82db32f36e3b0b9741f8a97feb031f7e/node_modules/get-caller-file/"),
      packageDependencies: new Map([
        ["get-caller-file", "2.0.5"],
      ]),
    }],
  ])],
  ["require-directory", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-require-directory-2.1.1-8c64ad5fd30dab1c976e2344ffe7f792a6a6df42/node_modules/require-directory/"),
      packageDependencies: new Map([
        ["require-directory", "2.1.1"],
      ]),
    }],
  ])],
  ["require-main-filename", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-require-main-filename-2.0.0-d0b329ecc7cc0f61649f62215be69af54aa8989b/node_modules/require-main-filename/"),
      packageDependencies: new Map([
        ["require-main-filename", "2.0.0"],
      ]),
    }],
  ])],
  ["set-blocking", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-set-blocking-2.0.0-045f9782d011ae9a6803ddd382b24392b3d890f7/node_modules/set-blocking/"),
      packageDependencies: new Map([
        ["set-blocking", "2.0.0"],
      ]),
    }],
  ])],
  ["which-module", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-which-module-2.0.0-d9ef07dce77b9902b8a3a8fa4b31c3e3f7e6e87a/node_modules/which-module/"),
      packageDependencies: new Map([
        ["which-module", "2.0.0"],
      ]),
    }],
  ])],
  ["y18n", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-y18n-4.0.1-8db2b83c31c5d75099bb890b23f3094891e247d4/node_modules/y18n/"),
      packageDependencies: new Map([
        ["y18n", "4.0.1"],
      ]),
    }],
  ])],
  ["yargs-parser", new Map([
    ["18.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-yargs-parser-18.1.3-be68c4975c6b2abf469236b0c870362fab09a7b0/node_modules/yargs-parser/"),
      packageDependencies: new Map([
        ["camelcase", "5.3.1"],
        ["decamelize", "1.2.0"],
        ["yargs-parser", "18.1.3"],
      ]),
    }],
  ])],
  ["jest-docblock", new Map([
    ["26.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-docblock-26.0.0-3e2fa20899fc928cb13bd0ff68bd3711a36889b5/node_modules/jest-docblock/"),
      packageDependencies: new Map([
        ["detect-newline", "3.1.0"],
        ["jest-docblock", "26.0.0"],
      ]),
    }],
  ])],
  ["detect-newline", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-detect-newline-3.1.0-576f5dfc63ae1a192ff192d8ad3af6308991b651/node_modules/detect-newline/"),
      packageDependencies: new Map([
        ["detect-newline", "3.1.0"],
      ]),
    }],
  ])],
  ["jest-leak-detector", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-leak-detector-26.6.2-7717cf118b92238f2eba65054c8a0c9c653a91af/node_modules/jest-leak-detector/"),
      packageDependencies: new Map([
        ["jest-get-type", "26.3.0"],
        ["pretty-format", "26.6.2"],
        ["jest-leak-detector", "26.6.2"],
      ]),
    }],
  ])],
  ["source-map-support", new Map([
    ["0.5.19", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-source-map-support-0.5.19-a98b62f86dcaf4f67399648c085291ab9e8fed61/node_modules/source-map-support/"),
      packageDependencies: new Map([
        ["buffer-from", "1.1.1"],
        ["source-map", "0.6.1"],
        ["source-map-support", "0.5.19"],
      ]),
    }],
  ])],
  ["buffer-from", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-buffer-from-1.1.1-32713bc028f75c02fdb710d7c7bcec1f2c6070ef/node_modules/buffer-from/"),
      packageDependencies: new Map([
        ["buffer-from", "1.1.1"],
      ]),
    }],
  ])],
  ["jest-resolve-dependencies", new Map([
    ["26.6.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-resolve-dependencies-26.6.3-6680859ee5d22ee5dcd961fe4871f59f4c784fb6/node_modules/jest-resolve-dependencies/"),
      packageDependencies: new Map([
        ["@jest/types", "26.6.2"],
        ["jest-regex-util", "26.0.0"],
        ["jest-snapshot", "26.6.2"],
        ["jest-resolve-dependencies", "26.6.3"],
      ]),
    }],
  ])],
  ["jest-watcher", new Map([
    ["26.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-watcher-26.6.2-a5b683b8f9d68dbcb1d7dae32172d2cca0592975/node_modules/jest-watcher/"),
      packageDependencies: new Map([
        ["@jest/test-result", "26.6.2"],
        ["@jest/types", "26.6.2"],
        ["@types/node", "14.14.10"],
        ["ansi-escapes", "4.3.1"],
        ["chalk", "4.1.0"],
        ["jest-util", "26.6.2"],
        ["string-length", "4.0.1"],
        ["jest-watcher", "26.6.2"],
      ]),
    }],
  ])],
  ["p-each-series", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-p-each-series-2.2.0-105ab0357ce72b202a8a8b94933672657b5e2a9a/node_modules/p-each-series/"),
      packageDependencies: new Map([
        ["p-each-series", "2.2.0"],
      ]),
    }],
  ])],
  ["rimraf", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-rimraf-3.0.2-f1a5402ba6220ad52cc1282bac1ae3aa49fd061a/node_modules/rimraf/"),
      packageDependencies: new Map([
        ["glob", "7.1.6"],
        ["rimraf", "3.0.2"],
      ]),
    }],
  ])],
  ["import-local", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-import-local-3.0.2-a8cfd0431d1de4a2199703d003e3e62364fa6db6/node_modules/import-local/"),
      packageDependencies: new Map([
        ["pkg-dir", "4.2.0"],
        ["resolve-cwd", "3.0.0"],
        ["import-local", "3.0.2"],
      ]),
    }],
  ])],
  ["pkg-dir", new Map([
    ["4.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-pkg-dir-4.2.0-f099133df7ede422e81d1d8448270eeb3e4261f3/node_modules/pkg-dir/"),
      packageDependencies: new Map([
        ["find-up", "4.1.0"],
        ["pkg-dir", "4.2.0"],
      ]),
    }],
  ])],
  ["resolve-cwd", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-resolve-cwd-3.0.0-0f0075f1bb2544766cf73ba6a6e2adfebcb13f2d/node_modules/resolve-cwd/"),
      packageDependencies: new Map([
        ["resolve-from", "5.0.0"],
        ["resolve-cwd", "3.0.0"],
      ]),
    }],
  ])],
  ["jest-cli", new Map([
    ["26.6.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jest-cli-26.6.3-43117cfef24bc4cd691a174a8796a532e135e92a/node_modules/jest-cli/"),
      packageDependencies: new Map([
        ["@jest/core", "26.6.3"],
        ["@jest/test-result", "26.6.2"],
        ["@jest/types", "26.6.2"],
        ["chalk", "4.1.0"],
        ["exit", "0.1.2"],
        ["graceful-fs", "4.2.4"],
        ["import-local", "3.0.2"],
        ["is-ci", "2.0.0"],
        ["jest-config", "pnp:ea5fa9bda876bb254d64d757d7fe647cee0301f5"],
        ["jest-util", "26.6.2"],
        ["jest-validate", "26.6.2"],
        ["prompts", "2.4.0"],
        ["yargs", "15.4.1"],
        ["jest-cli", "26.6.3"],
      ]),
    }],
  ])],
  ["prompts", new Map([
    ["2.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-prompts-2.4.0-4aa5de0723a231d1ee9121c40fdf663df73f61d7/node_modules/prompts/"),
      packageDependencies: new Map([
        ["kleur", "3.0.3"],
        ["sisteransi", "1.0.5"],
        ["prompts", "2.4.0"],
      ]),
    }],
  ])],
  ["kleur", new Map([
    ["3.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-kleur-3.0.3-a79c9ecc86ee1ce3fa6206d1216c501f147fc07e/node_modules/kleur/"),
      packageDependencies: new Map([
        ["kleur", "3.0.3"],
      ]),
    }],
  ])],
  ["sisteransi", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-sisteransi-1.0.5-134d681297756437cc05ca01370d3a7a571075ed/node_modules/sisteransi/"),
      packageDependencies: new Map([
        ["sisteransi", "1.0.5"],
      ]),
    }],
  ])],
  ["prettier", new Map([
    ["1.19.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-prettier-1.19.1-f7d7f5ff8a9cd872a7be4ca142095956a60797cb/node_modules/prettier/"),
      packageDependencies: new Map([
        ["prettier", "1.19.1"],
      ]),
    }],
  ])],
  ["remark", new Map([
    ["13.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-remark-13.0.0-d15d9bf71a402f40287ebe36067b66d54868e425/node_modules/remark/"),
      packageDependencies: new Map([
        ["remark-parse", "9.0.0"],
        ["remark-stringify", "9.0.0"],
        ["unified", "9.2.0"],
        ["remark", "13.0.0"],
      ]),
    }],
  ])],
  ["remark-parse", new Map([
    ["9.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-remark-parse-9.0.0-4d20a299665880e4f4af5d90b7c7b8a935853640/node_modules/remark-parse/"),
      packageDependencies: new Map([
        ["mdast-util-from-markdown", "0.8.1"],
        ["remark-parse", "9.0.0"],
      ]),
    }],
  ])],
  ["mdast-util-from-markdown", new Map([
    ["0.8.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-mdast-util-from-markdown-0.8.1-781371d493cac11212947226190270c15dc97116/node_modules/mdast-util-from-markdown/"),
      packageDependencies: new Map([
        ["@types/mdast", "3.0.3"],
        ["mdast-util-to-string", "1.1.0"],
        ["micromark", "2.10.1"],
        ["parse-entities", "2.0.0"],
        ["mdast-util-from-markdown", "0.8.1"],
      ]),
    }],
  ])],
  ["@types/mdast", new Map([
    ["3.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@types-mdast-3.0.3-2d7d671b1cd1ea3deb306ea75036c2a0407d2deb/node_modules/@types/mdast/"),
      packageDependencies: new Map([
        ["@types/unist", "2.0.3"],
        ["@types/mdast", "3.0.3"],
      ]),
    }],
  ])],
  ["mdast-util-to-string", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-mdast-util-to-string-1.1.0-27055500103f51637bd07d01da01eb1967a43527/node_modules/mdast-util-to-string/"),
      packageDependencies: new Map([
        ["mdast-util-to-string", "1.1.0"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-mdast-util-to-string-2.0.0-b8cfe6a713e1091cb5b728fc48885a4767f8b97b/node_modules/mdast-util-to-string/"),
      packageDependencies: new Map([
        ["mdast-util-to-string", "2.0.0"],
      ]),
    }],
  ])],
  ["micromark", new Map([
    ["2.10.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-micromark-2.10.1-cd73f54e0656f10e633073db26b663a221a442a7/node_modules/micromark/"),
      packageDependencies: new Map([
        ["debug", "4.3.1"],
        ["parse-entities", "2.0.0"],
        ["micromark", "2.10.1"],
      ]),
    }],
  ])],
  ["parse-entities", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-parse-entities-2.0.0-53c6eb5b9314a1f4ec99fa0fdf7ce01ecda0cbe8/node_modules/parse-entities/"),
      packageDependencies: new Map([
        ["character-entities", "1.2.4"],
        ["character-entities-legacy", "1.1.4"],
        ["character-reference-invalid", "1.1.4"],
        ["is-alphanumerical", "1.0.4"],
        ["is-decimal", "1.0.4"],
        ["is-hexadecimal", "1.0.4"],
        ["parse-entities", "2.0.0"],
      ]),
    }],
  ])],
  ["character-entities", new Map([
    ["1.2.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-character-entities-1.2.4-e12c3939b7eaf4e5b15e7ad4c5e28e1d48c5b16b/node_modules/character-entities/"),
      packageDependencies: new Map([
        ["character-entities", "1.2.4"],
      ]),
    }],
  ])],
  ["character-entities-legacy", new Map([
    ["1.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-character-entities-legacy-1.1.4-94bc1845dce70a5bb9d2ecc748725661293d8fc1/node_modules/character-entities-legacy/"),
      packageDependencies: new Map([
        ["character-entities-legacy", "1.1.4"],
      ]),
    }],
  ])],
  ["character-reference-invalid", new Map([
    ["1.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-character-reference-invalid-1.1.4-083329cda0eae272ab3dbbf37e9a382c13af1560/node_modules/character-reference-invalid/"),
      packageDependencies: new Map([
        ["character-reference-invalid", "1.1.4"],
      ]),
    }],
  ])],
  ["is-alphanumerical", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-alphanumerical-1.0.4-7eb9a2431f855f6b1ef1a78e326df515696c4dbf/node_modules/is-alphanumerical/"),
      packageDependencies: new Map([
        ["is-alphabetical", "1.0.4"],
        ["is-decimal", "1.0.4"],
        ["is-alphanumerical", "1.0.4"],
      ]),
    }],
  ])],
  ["is-alphabetical", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-alphabetical-1.0.4-9e7d6b94916be22153745d184c298cbf986a686d/node_modules/is-alphabetical/"),
      packageDependencies: new Map([
        ["is-alphabetical", "1.0.4"],
      ]),
    }],
  ])],
  ["is-decimal", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-decimal-1.0.4-65a3a5958a1c5b63a706e1b333d7cd9f630d3fa5/node_modules/is-decimal/"),
      packageDependencies: new Map([
        ["is-decimal", "1.0.4"],
      ]),
    }],
  ])],
  ["is-hexadecimal", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-hexadecimal-1.0.4-cc35c97588da4bd49a8eedd6bc4082d44dcb23a7/node_modules/is-hexadecimal/"),
      packageDependencies: new Map([
        ["is-hexadecimal", "1.0.4"],
      ]),
    }],
  ])],
  ["remark-stringify", new Map([
    ["9.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-remark-stringify-9.0.0-8ba0c9e4167c42733832215a81550489759e3793/node_modules/remark-stringify/"),
      packageDependencies: new Map([
        ["mdast-util-to-markdown", "0.5.4"],
        ["remark-stringify", "9.0.0"],
      ]),
    }],
  ])],
  ["mdast-util-to-markdown", new Map([
    ["0.5.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-mdast-util-to-markdown-0.5.4-be680ed0c0e11a07d07c7adff9551eec09c1b0f9/node_modules/mdast-util-to-markdown/"),
      packageDependencies: new Map([
        ["@types/unist", "2.0.3"],
        ["longest-streak", "2.0.4"],
        ["mdast-util-to-string", "2.0.0"],
        ["parse-entities", "2.0.0"],
        ["repeat-string", "1.6.1"],
        ["zwitch", "1.0.5"],
        ["mdast-util-to-markdown", "0.5.4"],
      ]),
    }],
  ])],
  ["longest-streak", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-longest-streak-2.0.4-b8599957da5b5dab64dee3fe316fa774597d90e4/node_modules/longest-streak/"),
      packageDependencies: new Map([
        ["longest-streak", "2.0.4"],
      ]),
    }],
  ])],
  ["zwitch", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-zwitch-1.0.5-d11d7381ffed16b742f6af7b3f223d5cd9fe9920/node_modules/zwitch/"),
      packageDependencies: new Map([
        ["zwitch", "1.0.5"],
      ]),
    }],
  ])],
  ["unified", new Map([
    ["9.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-unified-9.2.0-67a62c627c40589edebbf60f53edfd4d822027f8/node_modules/unified/"),
      packageDependencies: new Map([
        ["bail", "1.0.5"],
        ["extend", "3.0.2"],
        ["is-buffer", "2.0.5"],
        ["is-plain-obj", "2.1.0"],
        ["trough", "1.0.5"],
        ["vfile", "4.2.0"],
        ["unified", "9.2.0"],
      ]),
    }],
  ])],
  ["bail", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-bail-1.0.5-b6fa133404a392cbc1f8c4bf63f5953351e7a776/node_modules/bail/"),
      packageDependencies: new Map([
        ["bail", "1.0.5"],
      ]),
    }],
  ])],
  ["is-plain-obj", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-plain-obj-2.1.0-45e42e37fccf1f40da8e5f76ee21515840c09287/node_modules/is-plain-obj/"),
      packageDependencies: new Map([
        ["is-plain-obj", "2.1.0"],
      ]),
    }],
  ])],
  ["trough", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-trough-1.0.5-b8b639cefad7d0bb2abd37d433ff8293efa5f406/node_modules/trough/"),
      packageDependencies: new Map([
        ["trough", "1.0.5"],
      ]),
    }],
  ])],
  [null, new Map([
    [null, {
      packageLocation: path.resolve(__dirname, "./"),
      packageDependencies: new Map([
        ["to-gatsby-remark-plugin", "0.1.0"],
        ["unist-util-visit", "2.0.3"],
        ["jest", "26.6.3"],
        ["prettier", "1.19.1"],
        ["remark", "13.0.0"],
      ]),
    }],
  ])],
]);

let locatorsByLocations = new Map([
  ["./.pnp/externals/pnp-249ddef947a9ababda31301a1edf90989bee7687/node_modules/jest-config/", blacklistedLocator],
  ["./.pnp/externals/pnp-1bc15128b2300766876943bd879ea149399eae4b/node_modules/jest-config/", blacklistedLocator],
  ["./.pnp/externals/pnp-e1d5cb28cb6a685f6cd90d3e6e1bcca052b998f1/node_modules/jest-config/", blacklistedLocator],
  ["./.pnp/externals/pnp-ea5fa9bda876bb254d64d757d7fe647cee0301f5/node_modules/jest-config/", blacklistedLocator],
  ["../../Library/Caches/Yarn/v3/npm-to-gatsby-remark-plugin-0.1.0-34167b2c3cf3209745cf97e5a488042586f9990d/node_modules/to-gatsby-remark-plugin/", {"name":"to-gatsby-remark-plugin","reference":"0.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-to-vfile-6.1.0-5f7a3f65813c2c4e34ee1f7643a5646344627699/node_modules/to-vfile/", {"name":"to-vfile","reference":"6.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-is-buffer-2.0.5-ebc252e400d22ff8d77fa09888821a24a658c191/node_modules/is-buffer/", {"name":"is-buffer","reference":"2.0.5"}],
  ["../../Library/Caches/Yarn/v3/npm-is-buffer-1.1.6-efaa2ea9daa0d7ab2ea13a97b2b8ad51fefbe8be/node_modules/is-buffer/", {"name":"is-buffer","reference":"1.1.6"}],
  ["../../Library/Caches/Yarn/v3/npm-vfile-4.2.0-26c78ac92eb70816b01d4565e003b7e65a2a0e01/node_modules/vfile/", {"name":"vfile","reference":"4.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-@types-unist-2.0.3-9c088679876f374eb5983f150d4787aa6fb32d7e/node_modules/@types/unist/", {"name":"@types/unist","reference":"2.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-replace-ext-1.0.0-de63128373fcbf7c3ccfa4de5a480c45a67958eb/node_modules/replace-ext/", {"name":"replace-ext","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-unist-util-stringify-position-2.0.3-cce3bfa1cdf85ba7375d1d5b17bdc4cada9bd9da/node_modules/unist-util-stringify-position/", {"name":"unist-util-stringify-position","reference":"2.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-vfile-message-2.0.4-5b43b88171d409eae58477d13f23dd41d52c371a/node_modules/vfile-message/", {"name":"vfile-message","reference":"2.0.4"}],
  ["../../Library/Caches/Yarn/v3/npm-unist-util-visit-2.0.3-c3703893146df47203bb8a9795af47d7b971208c/node_modules/unist-util-visit/", {"name":"unist-util-visit","reference":"2.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-unist-util-is-4.0.4-3e9e8de6af2eb0039a59f50c9b3e99698a924f50/node_modules/unist-util-is/", {"name":"unist-util-is","reference":"4.0.4"}],
  ["../../Library/Caches/Yarn/v3/npm-unist-util-visit-parents-3.1.1-65a6ce698f78a6b0f56aa0e88f13801886cdaef6/node_modules/unist-util-visit-parents/", {"name":"unist-util-visit-parents","reference":"3.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-26.6.3-40e8fdbe48f00dfa1f0ce8121ca74b88ac9148ef/node_modules/jest/", {"name":"jest","reference":"26.6.3"}],
  ["../../Library/Caches/Yarn/v3/npm-@jest-core-26.6.3-7639fcb3833d748a4656ada54bde193051e45fad/node_modules/@jest/core/", {"name":"@jest/core","reference":"26.6.3"}],
  ["../../Library/Caches/Yarn/v3/npm-@jest-console-26.6.2-4e04bc464014358b03ab4937805ee36a0aeb98f2/node_modules/@jest/console/", {"name":"@jest/console","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-@jest-types-26.6.2-bef5a532030e1d88a2f5a6d933f84e97226ed48e/node_modules/@jest/types/", {"name":"@jest/types","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-@types-istanbul-lib-coverage-2.0.3-4ba8ddb720221f432e443bd5f9117fd22cfd4762/node_modules/@types/istanbul-lib-coverage/", {"name":"@types/istanbul-lib-coverage","reference":"2.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-@types-istanbul-reports-3.0.0-508b13aa344fa4976234e75dddcc34925737d821/node_modules/@types/istanbul-reports/", {"name":"@types/istanbul-reports","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-@types-istanbul-lib-report-3.0.0-c14c24f18ea8190c118ee7562b7ff99a36552686/node_modules/@types/istanbul-lib-report/", {"name":"@types/istanbul-lib-report","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-@types-node-14.14.10-5958a82e41863cfc71f2307b3748e3491ba03785/node_modules/@types/node/", {"name":"@types/node","reference":"14.14.10"}],
  ["../../Library/Caches/Yarn/v3/npm-@types-yargs-15.0.10-0fe3c8173a0d5c3e780b389050140c3f5ea6ea74/node_modules/@types/yargs/", {"name":"@types/yargs","reference":"15.0.10"}],
  ["../../Library/Caches/Yarn/v3/npm-@types-yargs-parser-15.0.0-cb3f9f741869e20cce330ffbeb9271590483882d/node_modules/@types/yargs-parser/", {"name":"@types/yargs-parser","reference":"15.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-chalk-4.1.0-4e14870a618d9e2edd97dd8345fd9d9dc315646a/node_modules/chalk/", {"name":"chalk","reference":"4.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-chalk-2.4.2-cd42541677a54333cf541a49108c1432b44c9424/node_modules/chalk/", {"name":"chalk","reference":"2.4.2"}],
  ["../../Library/Caches/Yarn/v3/npm-ansi-styles-4.3.0-edd803628ae71c04c85ae7a0906edad34b648937/node_modules/ansi-styles/", {"name":"ansi-styles","reference":"4.3.0"}],
  ["../../Library/Caches/Yarn/v3/npm-ansi-styles-3.2.1-41fbb20243e50b12be0f04b8dedbf07520ce841d/node_modules/ansi-styles/", {"name":"ansi-styles","reference":"3.2.1"}],
  ["../../Library/Caches/Yarn/v3/npm-color-convert-2.0.1-72d3a68d598c9bdb3af2ad1e84f21d896abd4de3/node_modules/color-convert/", {"name":"color-convert","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-color-convert-1.9.3-bb71850690e1f136567de629d2d5471deda4c1e8/node_modules/color-convert/", {"name":"color-convert","reference":"1.9.3"}],
  ["../../Library/Caches/Yarn/v3/npm-color-name-1.1.4-c2a09a87acbde69543de6f63fa3995c826c536a2/node_modules/color-name/", {"name":"color-name","reference":"1.1.4"}],
  ["../../Library/Caches/Yarn/v3/npm-color-name-1.1.3-a7d0558bd89c42f795dd42328f740831ca53bc25/node_modules/color-name/", {"name":"color-name","reference":"1.1.3"}],
  ["../../Library/Caches/Yarn/v3/npm-supports-color-7.2.0-1b7dcdcb32b8138801b3e478ba6a51caa89648da/node_modules/supports-color/", {"name":"supports-color","reference":"7.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-supports-color-5.5.0-e2e69a44ac8772f78a1ec0b35b689df6530efc8f/node_modules/supports-color/", {"name":"supports-color","reference":"5.5.0"}],
  ["../../Library/Caches/Yarn/v3/npm-has-flag-4.0.0-944771fd9c81c81265c4d6941860da06bb59479b/node_modules/has-flag/", {"name":"has-flag","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-has-flag-3.0.0-b5d454dc2199ae225699f3467e5a07f3b955bafd/node_modules/has-flag/", {"name":"has-flag","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-message-util-26.6.2-58173744ad6fc0506b5d21150b9be56ef001ca07/node_modules/jest-message-util/", {"name":"jest-message-util","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-code-frame-7.10.4-168da1a36e90da68ae8d49c0f1b48c7c6249213a/node_modules/@babel/code-frame/", {"name":"@babel/code-frame","reference":"7.10.4"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-highlight-7.10.4-7d1bdfd65753538fabe6c38596cdb76d9ac60143/node_modules/@babel/highlight/", {"name":"@babel/highlight","reference":"7.10.4"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-helper-validator-identifier-7.10.4-a78c7a7251e01f616512d31b10adcf52ada5e0d2/node_modules/@babel/helper-validator-identifier/", {"name":"@babel/helper-validator-identifier","reference":"7.10.4"}],
  ["../../Library/Caches/Yarn/v3/npm-escape-string-regexp-1.0.5-1b61c0562190a8dff6ae3bb2cf0200ca130b86d4/node_modules/escape-string-regexp/", {"name":"escape-string-regexp","reference":"1.0.5"}],
  ["../../Library/Caches/Yarn/v3/npm-escape-string-regexp-2.0.0-a30304e99daa32e23b2fd20f51babd07cffca344/node_modules/escape-string-regexp/", {"name":"escape-string-regexp","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-js-tokens-4.0.0-19203fb59991df98e3a287050d4647cdeaf32499/node_modules/js-tokens/", {"name":"js-tokens","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-@types-stack-utils-2.0.0-7036640b4e21cc2f259ae826ce843d277dad8cff/node_modules/@types/stack-utils/", {"name":"@types/stack-utils","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-graceful-fs-4.2.4-2256bde14d3632958c465ebc96dc467ca07a29fb/node_modules/graceful-fs/", {"name":"graceful-fs","reference":"4.2.4"}],
  ["../../Library/Caches/Yarn/v3/npm-micromatch-4.0.2-4fcb0999bf9fbc2fcbdd212f6d629b9a56c39259/node_modules/micromatch/", {"name":"micromatch","reference":"4.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-micromatch-3.1.10-70859bc95c9840952f359a068a3fc49f9ecfac23/node_modules/micromatch/", {"name":"micromatch","reference":"3.1.10"}],
  ["../../Library/Caches/Yarn/v3/npm-braces-3.0.2-3454e1a462ee8d599e236df336cd9ea4f8afe107/node_modules/braces/", {"name":"braces","reference":"3.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-braces-2.3.2-5979fd3f14cd531565e5fa2df1abfff1dfaee729/node_modules/braces/", {"name":"braces","reference":"2.3.2"}],
  ["../../Library/Caches/Yarn/v3/npm-fill-range-7.0.1-1919a6a7c75fe38b2c7c77e5198535da9acdda40/node_modules/fill-range/", {"name":"fill-range","reference":"7.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-fill-range-4.0.0-d544811d428f98eb06a63dc402d2403c328c38f7/node_modules/fill-range/", {"name":"fill-range","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-to-regex-range-5.0.1-1648c44aae7c8d988a326018ed72f5b4dd0392e4/node_modules/to-regex-range/", {"name":"to-regex-range","reference":"5.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-to-regex-range-2.1.1-7c80c17b9dfebe599e27367e0d4dd5590141db38/node_modules/to-regex-range/", {"name":"to-regex-range","reference":"2.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-is-number-7.0.0-7535345b896734d5f80c4d06c50955527a14f12b/node_modules/is-number/", {"name":"is-number","reference":"7.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-is-number-3.0.0-24fd6201a4782cf50561c810276afc7d12d71195/node_modules/is-number/", {"name":"is-number","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-picomatch-2.2.2-21f333e9b6b8eaff02468f5146ea406d345f4dad/node_modules/picomatch/", {"name":"picomatch","reference":"2.2.2"}],
  ["../../Library/Caches/Yarn/v3/npm-pretty-format-26.6.2-e35c2705f14cb7fe2fe94fa078345b444120fc93/node_modules/pretty-format/", {"name":"pretty-format","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-ansi-regex-5.0.0-388539f55179bf39339c81af30a654d69f87cb75/node_modules/ansi-regex/", {"name":"ansi-regex","reference":"5.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-react-is-17.0.1-5b3531bd76a645a4c9fb6e693ed36419e3301339/node_modules/react-is/", {"name":"react-is","reference":"17.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-slash-3.0.0-6539be870c165adbd5240220dbe361f1bc4d4634/node_modules/slash/", {"name":"slash","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-stack-utils-2.0.3-cd5f030126ff116b78ccb3c027fe302713b61277/node_modules/stack-utils/", {"name":"stack-utils","reference":"2.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-util-26.6.2-907535dbe4d5a6cb4c47ac9b926f6af29576cbc1/node_modules/jest-util/", {"name":"jest-util","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-is-ci-2.0.0-6bc6334181810e04b5c22b3d589fdca55026404c/node_modules/is-ci/", {"name":"is-ci","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-ci-info-2.0.0-67a9e964be31a51e15e5010d58e6f12834002f46/node_modules/ci-info/", {"name":"ci-info","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-@jest-reporters-26.6.2-1f518b99637a5f18307bd3ecf9275f6882a667f6/node_modules/@jest/reporters/", {"name":"@jest/reporters","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-@bcoe-v8-coverage-0.2.3-75a2e8b51cb758a7553d6804a5932d7aace75c39/node_modules/@bcoe/v8-coverage/", {"name":"@bcoe/v8-coverage","reference":"0.2.3"}],
  ["../../Library/Caches/Yarn/v3/npm-@jest-test-result-26.6.2-55da58b62df134576cc95476efa5f7949e3f5f18/node_modules/@jest/test-result/", {"name":"@jest/test-result","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-collect-v8-coverage-1.0.1-cc2c8e94fc18bbdffe64d6534570c8a673b27f59/node_modules/collect-v8-coverage/", {"name":"collect-v8-coverage","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-@jest-transform-26.6.2-5ac57c5fa1ad17b2aae83e73e45813894dcf2e4b/node_modules/@jest/transform/", {"name":"@jest/transform","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-core-7.12.9-fd450c4ec10cdbb980e2928b7aa7a28484593fc8/node_modules/@babel/core/", {"name":"@babel/core","reference":"7.12.9"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-generator-7.12.5-a2c50de5c8b6d708ab95be5e6053936c1884a4de/node_modules/@babel/generator/", {"name":"@babel/generator","reference":"7.12.5"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-types-7.12.7-6039ff1e242640a29452c9ae572162ec9a8f5d13/node_modules/@babel/types/", {"name":"@babel/types","reference":"7.12.7"}],
  ["../../Library/Caches/Yarn/v3/npm-lodash-4.17.20-b44a9b6297bcb698f1c51a3545a2b3b368d59c52/node_modules/lodash/", {"name":"lodash","reference":"4.17.20"}],
  ["../../Library/Caches/Yarn/v3/npm-to-fast-properties-2.0.0-dc5e698cbd079265bc73e0377681a4e4e83f616e/node_modules/to-fast-properties/", {"name":"to-fast-properties","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-jsesc-2.5.2-80564d2e483dacf6e8ef209650a67df3f0c283a4/node_modules/jsesc/", {"name":"jsesc","reference":"2.5.2"}],
  ["../../Library/Caches/Yarn/v3/npm-source-map-0.5.7-8a039d2d1021d22d1ea14c80d8ea468ba2ef3fcc/node_modules/source-map/", {"name":"source-map","reference":"0.5.7"}],
  ["../../Library/Caches/Yarn/v3/npm-source-map-0.6.1-74722af32e9614e9c287a8d0bbde48b5e2f1a263/node_modules/source-map/", {"name":"source-map","reference":"0.6.1"}],
  ["../../Library/Caches/Yarn/v3/npm-source-map-0.7.3-5302f8169031735226544092e64981f751750383/node_modules/source-map/", {"name":"source-map","reference":"0.7.3"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-helper-module-transforms-7.12.1-7954fec71f5b32c48e4b303b437c34453fd7247c/node_modules/@babel/helper-module-transforms/", {"name":"@babel/helper-module-transforms","reference":"7.12.1"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-helper-module-imports-7.12.5-1bfc0229f794988f76ed0a4d4e90860850b54dfb/node_modules/@babel/helper-module-imports/", {"name":"@babel/helper-module-imports","reference":"7.12.5"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-helper-replace-supers-7.12.5-f009a17543bbbbce16b06206ae73b63d3fca68d9/node_modules/@babel/helper-replace-supers/", {"name":"@babel/helper-replace-supers","reference":"7.12.5"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-helper-member-expression-to-functions-7.12.7-aa77bd0396ec8114e5e30787efa78599d874a855/node_modules/@babel/helper-member-expression-to-functions/", {"name":"@babel/helper-member-expression-to-functions","reference":"7.12.7"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-helper-optimise-call-expression-7.12.7-7f94ae5e08721a49467346aa04fd22f750033b9c/node_modules/@babel/helper-optimise-call-expression/", {"name":"@babel/helper-optimise-call-expression","reference":"7.12.7"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-traverse-7.12.9-fad26c972eabbc11350e0b695978de6cc8e8596f/node_modules/@babel/traverse/", {"name":"@babel/traverse","reference":"7.12.9"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-helper-function-name-7.10.4-d2d3b20c59ad8c47112fa7d2a94bc09d5ef82f1a/node_modules/@babel/helper-function-name/", {"name":"@babel/helper-function-name","reference":"7.10.4"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-helper-get-function-arity-7.10.4-98c1cbea0e2332f33f9a4661b8ce1505b2c19ba2/node_modules/@babel/helper-get-function-arity/", {"name":"@babel/helper-get-function-arity","reference":"7.10.4"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-template-7.12.7-c817233696018e39fbb6c491d2fb684e05ed43bc/node_modules/@babel/template/", {"name":"@babel/template","reference":"7.12.7"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-parser-7.12.7-fee7b39fe809d0e73e5b25eecaf5780ef3d73056/node_modules/@babel/parser/", {"name":"@babel/parser","reference":"7.12.7"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-helper-split-export-declaration-7.11.0-f8a491244acf6a676158ac42072911ba83ad099f/node_modules/@babel/helper-split-export-declaration/", {"name":"@babel/helper-split-export-declaration","reference":"7.11.0"}],
  ["../../Library/Caches/Yarn/v3/npm-debug-4.3.1-f0d229c505e0c6d8c49ac553d1b13dc183f6b2ee/node_modules/debug/", {"name":"debug","reference":"4.3.1"}],
  ["../../Library/Caches/Yarn/v3/npm-debug-2.6.9-5d128515df134ff327e90a4c93f4e077a536341f/node_modules/debug/", {"name":"debug","reference":"2.6.9"}],
  ["../../Library/Caches/Yarn/v3/npm-ms-2.1.2-d09d1f357b443f493382a8eb3ccd183872ae6009/node_modules/ms/", {"name":"ms","reference":"2.1.2"}],
  ["../../Library/Caches/Yarn/v3/npm-ms-2.0.0-5608aeadfc00be6c2901df5f9861788de0d597c8/node_modules/ms/", {"name":"ms","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-globals-11.12.0-ab8795338868a0babd8525758018c2a7eb95c42e/node_modules/globals/", {"name":"globals","reference":"11.12.0"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-helper-simple-access-7.12.1-32427e5aa61547d38eb1e6eaf5fd1426fdad9136/node_modules/@babel/helper-simple-access/", {"name":"@babel/helper-simple-access","reference":"7.12.1"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-helpers-7.12.5-1a1ba4a768d9b58310eda516c449913fe647116e/node_modules/@babel/helpers/", {"name":"@babel/helpers","reference":"7.12.5"}],
  ["../../Library/Caches/Yarn/v3/npm-convert-source-map-1.7.0-17a2cb882d7f77d3490585e2ce6c524424a3a442/node_modules/convert-source-map/", {"name":"convert-source-map","reference":"1.7.0"}],
  ["../../Library/Caches/Yarn/v3/npm-safe-buffer-5.1.2-991ec69d296e0313747d59bdfd2b745c35f8828d/node_modules/safe-buffer/", {"name":"safe-buffer","reference":"5.1.2"}],
  ["../../Library/Caches/Yarn/v3/npm-safe-buffer-5.2.1-1eaf9fa9bdb1fdd4ec75f58f9cdb4e6b7827eec6/node_modules/safe-buffer/", {"name":"safe-buffer","reference":"5.2.1"}],
  ["../../Library/Caches/Yarn/v3/npm-gensync-1.0.0-beta.2-32a6ee76c3d7f52d46b2b1ae5d93fea8580a25e0/node_modules/gensync/", {"name":"gensync","reference":"1.0.0-beta.2"}],
  ["../../Library/Caches/Yarn/v3/npm-json5-2.1.3-c9b0f7fa9233bfe5807fe66fcf3a5617ed597d43/node_modules/json5/", {"name":"json5","reference":"2.1.3"}],
  ["../../Library/Caches/Yarn/v3/npm-minimist-1.2.5-67d66014b66a6a8aaa0c083c5fd58df4e4e97602/node_modules/minimist/", {"name":"minimist","reference":"1.2.5"}],
  ["../../Library/Caches/Yarn/v3/npm-resolve-1.19.0-1af5bf630409734a067cae29318aac7fa29a267c/node_modules/resolve/", {"name":"resolve","reference":"1.19.0"}],
  ["../../Library/Caches/Yarn/v3/npm-is-core-module-2.2.0-97037ef3d52224d85163f5597b2b63d9afed981a/node_modules/is-core-module/", {"name":"is-core-module","reference":"2.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-has-1.0.3-722d7cbfc1f6aa8241f16dd814e011e1f41e8796/node_modules/has/", {"name":"has","reference":"1.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-function-bind-1.1.1-a56899d3ea3c9bab874bb9773b7c5ede92f4895d/node_modules/function-bind/", {"name":"function-bind","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-path-parse-1.0.6-d62dbb5679405d72c4737ec58600e9ddcf06d24c/node_modules/path-parse/", {"name":"path-parse","reference":"1.0.6"}],
  ["../../Library/Caches/Yarn/v3/npm-semver-5.7.1-a954f931aeba508d307bbf069eff0c01c96116f7/node_modules/semver/", {"name":"semver","reference":"5.7.1"}],
  ["../../Library/Caches/Yarn/v3/npm-semver-6.3.0-ee0a64c8af5e8ceea67687b133761e1becbd1d3d/node_modules/semver/", {"name":"semver","reference":"6.3.0"}],
  ["../../Library/Caches/Yarn/v3/npm-semver-7.3.2-604962b052b81ed0786aae84389ffba70ffd3938/node_modules/semver/", {"name":"semver","reference":"7.3.2"}],
  ["../../Library/Caches/Yarn/v3/npm-babel-plugin-istanbul-6.0.0-e159ccdc9af95e0b570c75b4573b7c34d671d765/node_modules/babel-plugin-istanbul/", {"name":"babel-plugin-istanbul","reference":"6.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-helper-plugin-utils-7.10.4-2f75a831269d4f677de49986dff59927533cf375/node_modules/@babel/helper-plugin-utils/", {"name":"@babel/helper-plugin-utils","reference":"7.10.4"}],
  ["../../Library/Caches/Yarn/v3/npm-@istanbuljs-load-nyc-config-1.1.0-fd3db1d59ecf7cf121e80650bb86712f9b55eced/node_modules/@istanbuljs/load-nyc-config/", {"name":"@istanbuljs/load-nyc-config","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-camelcase-5.3.1-e3c9b31569e106811df242f715725a1f4c494320/node_modules/camelcase/", {"name":"camelcase","reference":"5.3.1"}],
  ["../../Library/Caches/Yarn/v3/npm-camelcase-6.2.0-924af881c9d525ac9d87f40d964e5cea982a1809/node_modules/camelcase/", {"name":"camelcase","reference":"6.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-find-up-4.1.0-97afe7d6cdc0bc5928584b7c8d7b16e8a9aa5d19/node_modules/find-up/", {"name":"find-up","reference":"4.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-locate-path-5.0.0-1afba396afd676a6d42504d0a67a3a7eb9f62aa0/node_modules/locate-path/", {"name":"locate-path","reference":"5.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-p-locate-4.1.0-a3428bb7088b3a60292f66919278b7c297ad4f07/node_modules/p-locate/", {"name":"p-locate","reference":"4.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-p-limit-2.3.0-3dd33c647a214fdfffd835933eb086da0dc21db1/node_modules/p-limit/", {"name":"p-limit","reference":"2.3.0"}],
  ["../../Library/Caches/Yarn/v3/npm-p-try-2.2.0-cb2868540e313d61de58fafbe35ce9004d5540e6/node_modules/p-try/", {"name":"p-try","reference":"2.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-path-exists-4.0.0-513bdbe2d3b95d7762e8c1137efa195c6c61b5b3/node_modules/path-exists/", {"name":"path-exists","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-get-package-type-0.1.0-8de2d803cff44df3bc6c456e6668b36c3926e11a/node_modules/get-package-type/", {"name":"get-package-type","reference":"0.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-js-yaml-3.14.0-a7a34170f26a21bb162424d8adacb4113a69e482/node_modules/js-yaml/", {"name":"js-yaml","reference":"3.14.0"}],
  ["../../Library/Caches/Yarn/v3/npm-argparse-1.0.10-bcd6791ea5ae09725e17e5ad988134cd40b3d911/node_modules/argparse/", {"name":"argparse","reference":"1.0.10"}],
  ["../../Library/Caches/Yarn/v3/npm-sprintf-js-1.0.3-04e6926f662895354f3dd015203633b857297e2c/node_modules/sprintf-js/", {"name":"sprintf-js","reference":"1.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-esprima-4.0.1-13b04cdb3e6c5d19df91ab6987a8695619b0aa71/node_modules/esprima/", {"name":"esprima","reference":"4.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-resolve-from-5.0.0-c35225843df8f776df21c57557bc087e9dfdfc69/node_modules/resolve-from/", {"name":"resolve-from","reference":"5.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-@istanbuljs-schema-0.1.2-26520bf09abe4a5644cd5414e37125a8954241dd/node_modules/@istanbuljs/schema/", {"name":"@istanbuljs/schema","reference":"0.1.2"}],
  ["../../Library/Caches/Yarn/v3/npm-istanbul-lib-instrument-4.0.3-873c6fff897450118222774696a3f28902d77c1d/node_modules/istanbul-lib-instrument/", {"name":"istanbul-lib-instrument","reference":"4.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-istanbul-lib-coverage-3.0.0-f5944a37c70b550b02a78a5c3b2055b280cec8ec/node_modules/istanbul-lib-coverage/", {"name":"istanbul-lib-coverage","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-test-exclude-6.0.0-04a8698661d805ea6fa293b6cb9e63ac044ef15e/node_modules/test-exclude/", {"name":"test-exclude","reference":"6.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-glob-7.1.6-141f33b81a7c2492e125594307480c46679278a6/node_modules/glob/", {"name":"glob","reference":"7.1.6"}],
  ["../../Library/Caches/Yarn/v3/npm-fs-realpath-1.0.0-1504ad2523158caa40db4a2787cb01411994ea4f/node_modules/fs.realpath/", {"name":"fs.realpath","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-inflight-1.0.6-49bd6331d7d02d0c09bc910a1075ba8165b56df9/node_modules/inflight/", {"name":"inflight","reference":"1.0.6"}],
  ["../../Library/Caches/Yarn/v3/npm-once-1.4.0-583b1aa775961d4b113ac17d9c50baef9dd76bd1/node_modules/once/", {"name":"once","reference":"1.4.0"}],
  ["../../Library/Caches/Yarn/v3/npm-wrappy-1.0.2-b5243d8f3ec1aa35f1364605bc0d1036e30ab69f/node_modules/wrappy/", {"name":"wrappy","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-inherits-2.0.4-0fa2c64f932917c3433a0ded55363aae37416b7c/node_modules/inherits/", {"name":"inherits","reference":"2.0.4"}],
  ["../../Library/Caches/Yarn/v3/npm-minimatch-3.0.4-5166e286457f03306064be5497e8dbb0c3d32083/node_modules/minimatch/", {"name":"minimatch","reference":"3.0.4"}],
  ["../../Library/Caches/Yarn/v3/npm-brace-expansion-1.1.11-3c7fcbf529d87226f3d2f52b966ff5271eb441dd/node_modules/brace-expansion/", {"name":"brace-expansion","reference":"1.1.11"}],
  ["../../Library/Caches/Yarn/v3/npm-balanced-match-1.0.0-89b4d199ab2bee49de164ea02b89ce462d71b767/node_modules/balanced-match/", {"name":"balanced-match","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-concat-map-0.0.1-d8a96bd77fd68df7793a73036a3ba0d5405d477b/node_modules/concat-map/", {"name":"concat-map","reference":"0.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-path-is-absolute-1.0.1-174b9268735534ffbc7ace6bf53a5a9e1b5c5f5f/node_modules/path-is-absolute/", {"name":"path-is-absolute","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-fast-json-stable-stringify-2.1.0-874bf69c6f404c2b5d99c481341399fd55892633/node_modules/fast-json-stable-stringify/", {"name":"fast-json-stable-stringify","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-haste-map-26.6.2-dd7e60fe7dc0e9f911a23d79c5ff7fb5c2cafeaa/node_modules/jest-haste-map/", {"name":"jest-haste-map","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-@types-graceful-fs-4.1.4-4ff9f641a7c6d1a3508ff88bc3141b152772e753/node_modules/@types/graceful-fs/", {"name":"@types/graceful-fs","reference":"4.1.4"}],
  ["../../Library/Caches/Yarn/v3/npm-anymatch-3.1.1-c55ecf02185e2469259399310c173ce31233b142/node_modules/anymatch/", {"name":"anymatch","reference":"3.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-anymatch-2.0.0-bcb24b4f37934d9aa7ac17b4adaf89e7c76ef2eb/node_modules/anymatch/", {"name":"anymatch","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-normalize-path-3.0.0-0dcd69ff23a1c9b11fd0978316644a0388216a65/node_modules/normalize-path/", {"name":"normalize-path","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-normalize-path-2.1.1-1ab28b556e198363a8c1a6f7e6fa20137fe6aed9/node_modules/normalize-path/", {"name":"normalize-path","reference":"2.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-fb-watchman-2.0.1-fc84fb39d2709cf3ff6d743706157bb5708a8a85/node_modules/fb-watchman/", {"name":"fb-watchman","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-bser-2.1.1-e6787da20ece9d07998533cfd9de6f5c38f4bc05/node_modules/bser/", {"name":"bser","reference":"2.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-node-int64-0.4.0-87a9065cdb355d3182d8f94ce11188b825c68a3b/node_modules/node-int64/", {"name":"node-int64","reference":"0.4.0"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-regex-util-26.0.0-d25e7184b36e39fd466c3bc41be0971e821fee28/node_modules/jest-regex-util/", {"name":"jest-regex-util","reference":"26.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-serializer-26.6.2-d139aafd46957d3a448f3a6cdabe2919ba0742d1/node_modules/jest-serializer/", {"name":"jest-serializer","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-worker-26.6.2-7f72cbc4d643c365e27b9fd775f9d0eaa9c7a8ed/node_modules/jest-worker/", {"name":"jest-worker","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-merge-stream-2.0.0-52823629a14dd00c9770fb6ad47dc6310f2c1f60/node_modules/merge-stream/", {"name":"merge-stream","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-sane-4.1.0-ed881fd922733a6c461bc189dc2b6c006f3ffded/node_modules/sane/", {"name":"sane","reference":"4.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-@cnakazawa-watch-1.0.4-f864ae85004d0fcab6f50be9141c4da368d1656a/node_modules/@cnakazawa/watch/", {"name":"@cnakazawa/watch","reference":"1.0.4"}],
  ["../../Library/Caches/Yarn/v3/npm-exec-sh-0.3.4-3a018ceb526cc6f6df2bb504b2bfe8e3a4934ec5/node_modules/exec-sh/", {"name":"exec-sh","reference":"0.3.4"}],
  ["../../Library/Caches/Yarn/v3/npm-arr-diff-4.0.0-d6461074febfec71e7e15235761a329a5dc7c520/node_modules/arr-diff/", {"name":"arr-diff","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-array-unique-0.3.2-a894b75d4bc4f6cd679ef3244a9fd8f46ae2d428/node_modules/array-unique/", {"name":"array-unique","reference":"0.3.2"}],
  ["../../Library/Caches/Yarn/v3/npm-arr-flatten-1.1.0-36048bbff4e7b47e136644316c99669ea5ae91f1/node_modules/arr-flatten/", {"name":"arr-flatten","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-extend-shallow-2.0.1-51af7d614ad9a9f610ea1bafbb989d6b1c56890f/node_modules/extend-shallow/", {"name":"extend-shallow","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-extend-shallow-3.0.2-26a71aaf073b39fb2127172746131c2704028db8/node_modules/extend-shallow/", {"name":"extend-shallow","reference":"3.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-is-extendable-0.1.1-62b110e289a471418e3ec36a617d472e301dfc89/node_modules/is-extendable/", {"name":"is-extendable","reference":"0.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-is-extendable-1.0.1-a7470f9e426733d81bd81e1155264e3a3507cab4/node_modules/is-extendable/", {"name":"is-extendable","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-kind-of-3.2.2-31ea21a734bab9bbb0f32466d893aea51e4a3c64/node_modules/kind-of/", {"name":"kind-of","reference":"3.2.2"}],
  ["../../Library/Caches/Yarn/v3/npm-kind-of-4.0.0-20813df3d712928b207378691a45066fae72dd57/node_modules/kind-of/", {"name":"kind-of","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-kind-of-5.1.0-729c91e2d857b7a419a1f9aa65685c4c33f5845d/node_modules/kind-of/", {"name":"kind-of","reference":"5.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-kind-of-6.0.3-07c05034a6c349fa06e24fa35aa76db4580ce4dd/node_modules/kind-of/", {"name":"kind-of","reference":"6.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-repeat-string-1.6.1-8dcae470e1c88abc2d600fff4a776286da75e637/node_modules/repeat-string/", {"name":"repeat-string","reference":"1.6.1"}],
  ["../../Library/Caches/Yarn/v3/npm-isobject-3.0.1-4e431e92b11a9731636aa1f9c8d1ccbcfdab78df/node_modules/isobject/", {"name":"isobject","reference":"3.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-isobject-2.1.0-f065561096a3f1da2ef46272f815c840d87e0c89/node_modules/isobject/", {"name":"isobject","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-repeat-element-1.1.3-782e0d825c0c5a3bb39731f84efee6b742e6b1ce/node_modules/repeat-element/", {"name":"repeat-element","reference":"1.1.3"}],
  ["../../Library/Caches/Yarn/v3/npm-snapdragon-0.8.2-64922e7c565b0e14204ba1aa7d6964278d25182d/node_modules/snapdragon/", {"name":"snapdragon","reference":"0.8.2"}],
  ["../../Library/Caches/Yarn/v3/npm-base-0.11.2-7bde5ced145b6d551a90db87f83c558b4eb48a8f/node_modules/base/", {"name":"base","reference":"0.11.2"}],
  ["../../Library/Caches/Yarn/v3/npm-cache-base-1.0.1-0a7f46416831c8b662ee36fe4e7c59d76f666ab2/node_modules/cache-base/", {"name":"cache-base","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-collection-visit-1.0.0-4bc0373c164bc3291b4d368c829cf1a80a59dca0/node_modules/collection-visit/", {"name":"collection-visit","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-map-visit-1.0.0-ecdca8f13144e660f1b5bd41f12f3479d98dfb8f/node_modules/map-visit/", {"name":"map-visit","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-object-visit-1.0.1-f79c4493af0c5377b59fe39d395e41042dd045bb/node_modules/object-visit/", {"name":"object-visit","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-component-emitter-1.3.0-16e4070fba8ae29b679f2215853ee181ab2eabc0/node_modules/component-emitter/", {"name":"component-emitter","reference":"1.3.0"}],
  ["../../Library/Caches/Yarn/v3/npm-get-value-2.0.6-dc15ca1c672387ca76bd37ac0a395ba2042a2c28/node_modules/get-value/", {"name":"get-value","reference":"2.0.6"}],
  ["../../Library/Caches/Yarn/v3/npm-has-value-1.0.0-18b281da585b1c5c51def24c930ed29a0be6b177/node_modules/has-value/", {"name":"has-value","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-has-value-0.3.1-7b1f58bada62ca827ec0a2078025654845995e1f/node_modules/has-value/", {"name":"has-value","reference":"0.3.1"}],
  ["../../Library/Caches/Yarn/v3/npm-has-values-1.0.0-95b0b63fec2146619a6fe57fe75628d5a39efe4f/node_modules/has-values/", {"name":"has-values","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-has-values-0.1.4-6d61de95d91dfca9b9a02089ad384bff8f62b771/node_modules/has-values/", {"name":"has-values","reference":"0.1.4"}],
  ["../../Library/Caches/Yarn/v3/npm-set-value-2.0.1-a18d40530e6f07de4228c7defe4227af8cad005b/node_modules/set-value/", {"name":"set-value","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-is-plain-object-2.0.4-2c163b3fafb1b606d9d17928f05c2a1c38e07677/node_modules/is-plain-object/", {"name":"is-plain-object","reference":"2.0.4"}],
  ["../../Library/Caches/Yarn/v3/npm-split-string-3.1.0-7cb09dda3a86585705c64b39a6466038682e8fe2/node_modules/split-string/", {"name":"split-string","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-assign-symbols-1.0.0-59667f41fadd4f20ccbc2bb96b8d4f7f78ec0367/node_modules/assign-symbols/", {"name":"assign-symbols","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-to-object-path-0.3.0-297588b7b0e7e0ac08e04e672f85c1f4999e17af/node_modules/to-object-path/", {"name":"to-object-path","reference":"0.3.0"}],
  ["../../Library/Caches/Yarn/v3/npm-union-value-1.0.1-0b6fe7b835aecda61c6ea4d4f02c14221e109847/node_modules/union-value/", {"name":"union-value","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-arr-union-3.1.0-e39b09aea9def866a8f206e288af63919bae39c4/node_modules/arr-union/", {"name":"arr-union","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-unset-value-1.0.0-8376873f7d2335179ffb1e6fc3a8ed0dfc8ab559/node_modules/unset-value/", {"name":"unset-value","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-isarray-1.0.0-bb935d48582cba168c06834957a54a3e07124f11/node_modules/isarray/", {"name":"isarray","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-class-utils-0.3.6-f93369ae8b9a7ce02fd41faad0ca83033190c463/node_modules/class-utils/", {"name":"class-utils","reference":"0.3.6"}],
  ["../../Library/Caches/Yarn/v3/npm-define-property-0.2.5-c35b1ef918ec3c990f9a5bc57be04aacec5c8116/node_modules/define-property/", {"name":"define-property","reference":"0.2.5"}],
  ["../../Library/Caches/Yarn/v3/npm-define-property-1.0.0-769ebaaf3f4a63aad3af9e8d304c9bbe79bfb0e6/node_modules/define-property/", {"name":"define-property","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-define-property-2.0.2-d459689e8d654ba77e02a817f8710d702cb16e9d/node_modules/define-property/", {"name":"define-property","reference":"2.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-is-descriptor-0.1.6-366d8240dde487ca51823b1ab9f07a10a78251ca/node_modules/is-descriptor/", {"name":"is-descriptor","reference":"0.1.6"}],
  ["../../Library/Caches/Yarn/v3/npm-is-descriptor-1.0.2-3b159746a66604b04f8c81524ba365c5f14d86ec/node_modules/is-descriptor/", {"name":"is-descriptor","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-is-accessor-descriptor-0.1.6-a9e12cb3ae8d876727eeef3843f8a0897b5c98d6/node_modules/is-accessor-descriptor/", {"name":"is-accessor-descriptor","reference":"0.1.6"}],
  ["../../Library/Caches/Yarn/v3/npm-is-accessor-descriptor-1.0.0-169c2f6d3df1f992618072365c9b0ea1f6878656/node_modules/is-accessor-descriptor/", {"name":"is-accessor-descriptor","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-is-data-descriptor-0.1.4-0b5ee648388e2c860282e793f1856fec3f301b56/node_modules/is-data-descriptor/", {"name":"is-data-descriptor","reference":"0.1.4"}],
  ["../../Library/Caches/Yarn/v3/npm-is-data-descriptor-1.0.0-d84876321d0e7add03990406abbbbd36ba9268c7/node_modules/is-data-descriptor/", {"name":"is-data-descriptor","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-static-extend-0.1.2-60809c39cbff55337226fd5e0b520f341f1fb5c6/node_modules/static-extend/", {"name":"static-extend","reference":"0.1.2"}],
  ["../../Library/Caches/Yarn/v3/npm-object-copy-0.1.0-7e7d858b781bd7c991a41ba975ed3812754e998c/node_modules/object-copy/", {"name":"object-copy","reference":"0.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-copy-descriptor-0.1.1-676f6eb3c39997c2ee1ac3a924fd6124748f578d/node_modules/copy-descriptor/", {"name":"copy-descriptor","reference":"0.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-mixin-deep-1.3.2-1120b43dc359a785dce65b55b82e257ccf479566/node_modules/mixin-deep/", {"name":"mixin-deep","reference":"1.3.2"}],
  ["../../Library/Caches/Yarn/v3/npm-for-in-1.0.2-81068d295a8142ec0ac726c6e2200c30fb6d5e80/node_modules/for-in/", {"name":"for-in","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-pascalcase-0.1.1-b363e55e8006ca6fe21784d2db22bd15d7917f14/node_modules/pascalcase/", {"name":"pascalcase","reference":"0.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-map-cache-0.2.2-c32abd0bd6525d9b051645bb4f26ac5dc98a0dbf/node_modules/map-cache/", {"name":"map-cache","reference":"0.2.2"}],
  ["../../Library/Caches/Yarn/v3/npm-source-map-resolve-0.5.3-190866bece7553e1f8f267a2ee82c606b5509a1a/node_modules/source-map-resolve/", {"name":"source-map-resolve","reference":"0.5.3"}],
  ["../../Library/Caches/Yarn/v3/npm-atob-2.1.2-6d9517eb9e030d2436666651e86bd9f6f13533c9/node_modules/atob/", {"name":"atob","reference":"2.1.2"}],
  ["../../Library/Caches/Yarn/v3/npm-decode-uri-component-0.2.0-eb3913333458775cb84cd1a1fae062106bb87545/node_modules/decode-uri-component/", {"name":"decode-uri-component","reference":"0.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-resolve-url-0.2.1-2c637fe77c893afd2a663fe21aa9080068e2052a/node_modules/resolve-url/", {"name":"resolve-url","reference":"0.2.1"}],
  ["../../Library/Caches/Yarn/v3/npm-source-map-url-0.4.0-3e935d7ddd73631b97659956d55128e87b5084a3/node_modules/source-map-url/", {"name":"source-map-url","reference":"0.4.0"}],
  ["../../Library/Caches/Yarn/v3/npm-urix-0.1.0-da937f7a62e21fec1fd18d49b35c2935067a6c72/node_modules/urix/", {"name":"urix","reference":"0.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-use-3.1.1-d50c8cac79a19fbc20f2911f56eb973f4e10070f/node_modules/use/", {"name":"use","reference":"3.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-snapdragon-node-2.1.1-6c175f86ff14bdb0724563e8f3c1b021a286853b/node_modules/snapdragon-node/", {"name":"snapdragon-node","reference":"2.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-snapdragon-util-3.0.1-f956479486f2acd79700693f6f7b805e45ab56e2/node_modules/snapdragon-util/", {"name":"snapdragon-util","reference":"3.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-to-regex-3.0.2-13cfdd9b336552f30b51f33a8ae1b42a7a7599ce/node_modules/to-regex/", {"name":"to-regex","reference":"3.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-regex-not-1.0.2-1f4ece27e00b0b65e0247a6810e6a85d83a5752c/node_modules/regex-not/", {"name":"regex-not","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-safe-regex-1.1.0-40a3669f3b077d1e943d44629e157dd48023bf2e/node_modules/safe-regex/", {"name":"safe-regex","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-ret-0.1.15-b8a4825d5bdb1fc3f6f53c2bc33f81388681c7bc/node_modules/ret/", {"name":"ret","reference":"0.1.15"}],
  ["../../Library/Caches/Yarn/v3/npm-extglob-2.0.4-ad00fe4dc612a9232e8718711dc5cb5ab0285543/node_modules/extglob/", {"name":"extglob","reference":"2.0.4"}],
  ["../../Library/Caches/Yarn/v3/npm-expand-brackets-2.1.4-b77735e315ce30f6b6eff0f83b04151a22449622/node_modules/expand-brackets/", {"name":"expand-brackets","reference":"2.1.4"}],
  ["../../Library/Caches/Yarn/v3/npm-posix-character-classes-0.1.1-01eac0fe3b5af71a2a6c02feabb8c1fef7e00eab/node_modules/posix-character-classes/", {"name":"posix-character-classes","reference":"0.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-fragment-cache-0.2.1-4290fad27f13e89be7f33799c6bc5a0abfff0d19/node_modules/fragment-cache/", {"name":"fragment-cache","reference":"0.2.1"}],
  ["../../Library/Caches/Yarn/v3/npm-nanomatch-1.2.13-b87a8aa4fc0de8fe6be88895b38983ff265bd119/node_modules/nanomatch/", {"name":"nanomatch","reference":"1.2.13"}],
  ["../../Library/Caches/Yarn/v3/npm-is-windows-1.0.2-d1850eb9791ecd18e6182ce12a30f396634bb19d/node_modules/is-windows/", {"name":"is-windows","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-object-pick-1.3.0-87a10ac4c1694bd2e1cbf53591a66141fb5dd747/node_modules/object.pick/", {"name":"object.pick","reference":"1.3.0"}],
  ["../../Library/Caches/Yarn/v3/npm-remove-trailing-separator-1.1.0-c24bce2a283adad5bc3f58e0d48249b92379d8ef/node_modules/remove-trailing-separator/", {"name":"remove-trailing-separator","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-capture-exit-2.0.0-fb953bfaebeb781f62898239dabb426d08a509a4/node_modules/capture-exit/", {"name":"capture-exit","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-rsvp-4.8.5-c8f155311d167f68f21e168df71ec5b083113734/node_modules/rsvp/", {"name":"rsvp","reference":"4.8.5"}],
  ["../../Library/Caches/Yarn/v3/npm-execa-1.0.0-c6236a5bb4df6d6f15e88e7f017798216749ddd8/node_modules/execa/", {"name":"execa","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-execa-4.1.0-4e5491ad1572f2f17a77d388c6c857135b22847a/node_modules/execa/", {"name":"execa","reference":"4.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-cross-spawn-6.0.5-4a5ec7c64dfae22c3a14124dbacdee846d80cbc4/node_modules/cross-spawn/", {"name":"cross-spawn","reference":"6.0.5"}],
  ["../../Library/Caches/Yarn/v3/npm-cross-spawn-7.0.3-f73a85b9d5d41d045551c177e2882d4ac85728a6/node_modules/cross-spawn/", {"name":"cross-spawn","reference":"7.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-nice-try-1.0.5-a3378a7696ce7d223e88fc9b764bd7ef1089e366/node_modules/nice-try/", {"name":"nice-try","reference":"1.0.5"}],
  ["../../Library/Caches/Yarn/v3/npm-path-key-2.0.1-411cadb574c5a140d3a4b1910d40d80cc9f40b40/node_modules/path-key/", {"name":"path-key","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-path-key-3.1.1-581f6ade658cbba65a0d3380de7753295054f375/node_modules/path-key/", {"name":"path-key","reference":"3.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-shebang-command-1.2.0-44aac65b695b03398968c39f363fee5deafdf1ea/node_modules/shebang-command/", {"name":"shebang-command","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-shebang-command-2.0.0-ccd0af4f8835fbdc265b82461aaf0c36663f34ea/node_modules/shebang-command/", {"name":"shebang-command","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-shebang-regex-1.0.0-da42f49740c0b42db2ca9728571cb190c98efea3/node_modules/shebang-regex/", {"name":"shebang-regex","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-shebang-regex-3.0.0-ae16f1644d873ecad843b0307b143362d4c42172/node_modules/shebang-regex/", {"name":"shebang-regex","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-which-1.3.1-a45043d54f5805316da8d62f9f50918d3da70b0a/node_modules/which/", {"name":"which","reference":"1.3.1"}],
  ["../../Library/Caches/Yarn/v3/npm-which-2.0.2-7c6a8dd0a636a0327e10b59c9286eee93f3f51b1/node_modules/which/", {"name":"which","reference":"2.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-isexe-2.0.0-e8fbf374dc556ff8947a10dcb0572d633f2cfa10/node_modules/isexe/", {"name":"isexe","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-get-stream-4.1.0-c1b255575f3dc21d59bfc79cd3d2b46b1c3a54b5/node_modules/get-stream/", {"name":"get-stream","reference":"4.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-get-stream-5.2.0-4966a1795ee5ace65e706c4b7beb71257d6e22d3/node_modules/get-stream/", {"name":"get-stream","reference":"5.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-pump-3.0.0-b4a2116815bde2f4e1ea602354e8c75565107a64/node_modules/pump/", {"name":"pump","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-end-of-stream-1.4.4-5ae64a5f45057baf3626ec14da0ca5e4b2431eb0/node_modules/end-of-stream/", {"name":"end-of-stream","reference":"1.4.4"}],
  ["../../Library/Caches/Yarn/v3/npm-is-stream-1.1.0-12d4a3dd4e68e0b79ceb8dbc84173ae80d91ca44/node_modules/is-stream/", {"name":"is-stream","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-is-stream-2.0.0-bde9c32680d6fae04129d6ac9d921ce7815f78e3/node_modules/is-stream/", {"name":"is-stream","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-npm-run-path-2.0.2-35a9232dfa35d7067b4cb2ddf2357b1871536c5f/node_modules/npm-run-path/", {"name":"npm-run-path","reference":"2.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-npm-run-path-4.0.1-b7ecd1e5ed53da8e37a55e1c2269e0b97ed748ea/node_modules/npm-run-path/", {"name":"npm-run-path","reference":"4.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-p-finally-1.0.0-3fbcfb15b899a44123b34b6dcc18b724336a2cae/node_modules/p-finally/", {"name":"p-finally","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-signal-exit-3.0.3-a1410c2edd8f077b08b4e253c8eacfcaf057461c/node_modules/signal-exit/", {"name":"signal-exit","reference":"3.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-strip-eof-1.0.0-bb43ff5598a6eb05d89b59fcd129c983313606bf/node_modules/strip-eof/", {"name":"strip-eof","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-walker-1.0.7-2f7f9b8fd10d677262b18a884e28d19618e028fb/node_modules/walker/", {"name":"walker","reference":"1.0.7"}],
  ["../../Library/Caches/Yarn/v3/npm-makeerror-1.0.11-e01a5c9109f2af79660e4e8b9587790184f5a96c/node_modules/makeerror/", {"name":"makeerror","reference":"1.0.11"}],
  ["../../Library/Caches/Yarn/v3/npm-tmpl-1.0.4-23640dd7b42d00433911140820e5cf440e521dd1/node_modules/tmpl/", {"name":"tmpl","reference":"1.0.4"}],
  ["../../Library/Caches/Yarn/v3/npm-fsevents-2.2.1-1fb02ded2036a8ac288d507a65962bd87b97628d/node_modules/fsevents/", {"name":"fsevents","reference":"2.2.1"}],
  ["../../Library/Caches/Yarn/v3/npm-pirates-4.0.1-643a92caf894566f91b2b986d2c66950a8e2fb87/node_modules/pirates/", {"name":"pirates","reference":"4.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-node-modules-regexp-1.0.0-8d9dbe28964a4ac5712e9131642107c71e90ec40/node_modules/node-modules-regexp/", {"name":"node-modules-regexp","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-write-file-atomic-3.0.3-56bd5c5a5c70481cd19c571bd39ab965a5de56e8/node_modules/write-file-atomic/", {"name":"write-file-atomic","reference":"3.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-imurmurhash-0.1.4-9218b9b2b928a238b13dc4fb6b6d576f231453ea/node_modules/imurmurhash/", {"name":"imurmurhash","reference":"0.1.4"}],
  ["../../Library/Caches/Yarn/v3/npm-is-typedarray-1.0.0-e479c80858df0c1b11ddda6940f96011fcda4a9a/node_modules/is-typedarray/", {"name":"is-typedarray","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-typedarray-to-buffer-3.1.5-a97ee7a9ff42691b9f783ff1bc5112fe3fca9080/node_modules/typedarray-to-buffer/", {"name":"typedarray-to-buffer","reference":"3.1.5"}],
  ["../../Library/Caches/Yarn/v3/npm-exit-0.1.2-0632638f8d877cc82107d30a0fff1a17cba1cd0c/node_modules/exit/", {"name":"exit","reference":"0.1.2"}],
  ["../../Library/Caches/Yarn/v3/npm-istanbul-lib-report-3.0.0-7518fe52ea44de372f460a76b5ecda9ffb73d8a6/node_modules/istanbul-lib-report/", {"name":"istanbul-lib-report","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-make-dir-3.1.0-415e967046b3a7f1d185277d84aa58203726a13f/node_modules/make-dir/", {"name":"make-dir","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-istanbul-lib-source-maps-4.0.0-75743ce6d96bb86dc7ee4352cf6366a23f0b1ad9/node_modules/istanbul-lib-source-maps/", {"name":"istanbul-lib-source-maps","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-istanbul-reports-3.0.2-d593210e5000683750cb09fc0644e4b6e27fd53b/node_modules/istanbul-reports/", {"name":"istanbul-reports","reference":"3.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-html-escaper-2.0.2-dfd60027da36a36dfcbe236262c00a5822681453/node_modules/html-escaper/", {"name":"html-escaper","reference":"2.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-resolve-26.6.2-a3ab1517217f469b504f1b56603c5bb541fbb507/node_modules/jest-resolve/", {"name":"jest-resolve","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-pnp-resolver-1.2.2-b704ac0ae028a89108a4d040b3f919dfddc8e33c/node_modules/jest-pnp-resolver/", {"name":"jest-pnp-resolver","reference":"1.2.2"}],
  ["../../Library/Caches/Yarn/v3/npm-read-pkg-up-7.0.1-f3a6135758459733ae2b95638056e1854e7ef507/node_modules/read-pkg-up/", {"name":"read-pkg-up","reference":"7.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-read-pkg-5.2.0-7bf295438ca5a33e56cd30e053b34ee7250c93cc/node_modules/read-pkg/", {"name":"read-pkg","reference":"5.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-@types-normalize-package-data-2.4.0-e486d0d97396d79beedd0a6e33f4534ff6b4973e/node_modules/@types/normalize-package-data/", {"name":"@types/normalize-package-data","reference":"2.4.0"}],
  ["../../Library/Caches/Yarn/v3/npm-normalize-package-data-2.5.0-e66db1838b200c1dfc233225d12cb36520e234a8/node_modules/normalize-package-data/", {"name":"normalize-package-data","reference":"2.5.0"}],
  ["../../Library/Caches/Yarn/v3/npm-hosted-git-info-2.8.8-7539bd4bc1e0e0a895815a2e0262420b12858488/node_modules/hosted-git-info/", {"name":"hosted-git-info","reference":"2.8.8"}],
  ["../../Library/Caches/Yarn/v3/npm-validate-npm-package-license-3.0.4-fc91f6b9c7ba15c857f4cb2c5defeec39d4f410a/node_modules/validate-npm-package-license/", {"name":"validate-npm-package-license","reference":"3.0.4"}],
  ["../../Library/Caches/Yarn/v3/npm-spdx-correct-3.1.1-dece81ac9c1e6713e5f7d1b6f17d468fa53d89a9/node_modules/spdx-correct/", {"name":"spdx-correct","reference":"3.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-spdx-expression-parse-3.0.1-cf70f50482eefdc98e3ce0a6833e4a53ceeba679/node_modules/spdx-expression-parse/", {"name":"spdx-expression-parse","reference":"3.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-spdx-exceptions-2.3.0-3f28ce1a77a00372683eade4a433183527a2163d/node_modules/spdx-exceptions/", {"name":"spdx-exceptions","reference":"2.3.0"}],
  ["../../Library/Caches/Yarn/v3/npm-spdx-license-ids-3.0.7-e9c18a410e5ed7e12442a549fbd8afa767038d65/node_modules/spdx-license-ids/", {"name":"spdx-license-ids","reference":"3.0.7"}],
  ["../../Library/Caches/Yarn/v3/npm-parse-json-5.1.0-f96088cdf24a8faa9aea9a009f2d9d942c999646/node_modules/parse-json/", {"name":"parse-json","reference":"5.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-error-ex-1.3.2-b4ac40648107fdcdcfae242f428bea8a14d4f1bf/node_modules/error-ex/", {"name":"error-ex","reference":"1.3.2"}],
  ["../../Library/Caches/Yarn/v3/npm-is-arrayish-0.2.1-77c99840527aa8ecb1a8ba697b80645a7a926a9d/node_modules/is-arrayish/", {"name":"is-arrayish","reference":"0.2.1"}],
  ["../../Library/Caches/Yarn/v3/npm-json-parse-even-better-errors-2.3.1-7c47805a94319928e05777405dc12e1f7a4ee02d/node_modules/json-parse-even-better-errors/", {"name":"json-parse-even-better-errors","reference":"2.3.1"}],
  ["../../Library/Caches/Yarn/v3/npm-lines-and-columns-1.1.6-1c00c743b433cd0a4e80758f7b64a57440d9ff00/node_modules/lines-and-columns/", {"name":"lines-and-columns","reference":"1.1.6"}],
  ["../../Library/Caches/Yarn/v3/npm-type-fest-0.6.0-8d2a2370d3df886eb5c90ada1c5bf6188acf838b/node_modules/type-fest/", {"name":"type-fest","reference":"0.6.0"}],
  ["../../Library/Caches/Yarn/v3/npm-type-fest-0.8.1-09e249ebde851d3b1e48d27c105444667f17b83d/node_modules/type-fest/", {"name":"type-fest","reference":"0.8.1"}],
  ["../../Library/Caches/Yarn/v3/npm-type-fest-0.11.0-97abf0872310fed88a5c466b25681576145e33f1/node_modules/type-fest/", {"name":"type-fest","reference":"0.11.0"}],
  ["../../Library/Caches/Yarn/v3/npm-string-length-4.0.1-4a973bf31ef77c4edbceadd6af2611996985f8a1/node_modules/string-length/", {"name":"string-length","reference":"4.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-char-regex-1.0.2-d744358226217f981ed58f479b1d6bcc29545dcf/node_modules/char-regex/", {"name":"char-regex","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-strip-ansi-6.0.0-0b1571dd7669ccd4f3e06e14ef1eed26225ae532/node_modules/strip-ansi/", {"name":"strip-ansi","reference":"6.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-terminal-link-2.1.1-14a64a27ab3c0df933ea546fba55f2d078edc994/node_modules/terminal-link/", {"name":"terminal-link","reference":"2.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-ansi-escapes-4.3.1-a5c47cc43181f1f38ffd7076837700d395522a61/node_modules/ansi-escapes/", {"name":"ansi-escapes","reference":"4.3.1"}],
  ["../../Library/Caches/Yarn/v3/npm-supports-hyperlinks-2.1.0-f663df252af5f37c5d49bbd7eeefa9e0b9e59e47/node_modules/supports-hyperlinks/", {"name":"supports-hyperlinks","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-v8-to-istanbul-7.0.0-b4fe00e35649ef7785a9b7fcebcea05f37c332fc/node_modules/v8-to-istanbul/", {"name":"v8-to-istanbul","reference":"7.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-node-notifier-8.0.0-a7eee2d51da6d0f7ff5094bc7108c911240c1620/node_modules/node-notifier/", {"name":"node-notifier","reference":"8.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-growly-1.3.0-f10748cbe76af964b7c96c93c6bcc28af120c081/node_modules/growly/", {"name":"growly","reference":"1.3.0"}],
  ["../../Library/Caches/Yarn/v3/npm-is-wsl-2.2.0-74a4c76e77ca9fd3f932f290c17ea326cd157271/node_modules/is-wsl/", {"name":"is-wsl","reference":"2.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-is-docker-2.1.1-4125a88e44e450d384e09047ede71adc2d144156/node_modules/is-docker/", {"name":"is-docker","reference":"2.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-shellwords-0.1.1-d6b9181c1a48d397324c84871efbcfc73fc0654b/node_modules/shellwords/", {"name":"shellwords","reference":"0.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-uuid-8.3.1-2ba2e6ca000da60fce5a196954ab241131e05a31/node_modules/uuid/", {"name":"uuid","reference":"8.3.1"}],
  ["../../Library/Caches/Yarn/v3/npm-uuid-3.4.0-b23e4358afa8a202fe7a100af1f5f883f02007ee/node_modules/uuid/", {"name":"uuid","reference":"3.4.0"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-changed-files-26.6.2-f6198479e1cc66f22f9ae1e22acaa0b429c042d0/node_modules/jest-changed-files/", {"name":"jest-changed-files","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-human-signals-1.1.1-c5b1cd14f50aeae09ab6c59fe63ba3395fe4dfa3/node_modules/human-signals/", {"name":"human-signals","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-onetime-5.1.2-d0e96ebb56b07476df1dd9c4806e5237985ca45e/node_modules/onetime/", {"name":"onetime","reference":"5.1.2"}],
  ["../../Library/Caches/Yarn/v3/npm-mimic-fn-2.1.0-7ed2c2ccccaf84d3ffcb7a69b57711fc2083401b/node_modules/mimic-fn/", {"name":"mimic-fn","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-strip-final-newline-2.0.0-89b852fb2fcbe936f6f4b3187afb0a12c1ab58ad/node_modules/strip-final-newline/", {"name":"strip-final-newline","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-throat-5.0.0-c5199235803aad18754a667d659b5e72ce16764b/node_modules/throat/", {"name":"throat","reference":"5.0.0"}],
  ["./.pnp/externals/pnp-249ddef947a9ababda31301a1edf90989bee7687/node_modules/jest-config/", {"name":"jest-config","reference":"pnp:249ddef947a9ababda31301a1edf90989bee7687"}],
  ["./.pnp/externals/pnp-1bc15128b2300766876943bd879ea149399eae4b/node_modules/jest-config/", {"name":"jest-config","reference":"pnp:1bc15128b2300766876943bd879ea149399eae4b"}],
  ["./.pnp/externals/pnp-e1d5cb28cb6a685f6cd90d3e6e1bcca052b998f1/node_modules/jest-config/", {"name":"jest-config","reference":"pnp:e1d5cb28cb6a685f6cd90d3e6e1bcca052b998f1"}],
  ["./.pnp/externals/pnp-ea5fa9bda876bb254d64d757d7fe647cee0301f5/node_modules/jest-config/", {"name":"jest-config","reference":"pnp:ea5fa9bda876bb254d64d757d7fe647cee0301f5"}],
  ["../../Library/Caches/Yarn/v3/npm-@jest-test-sequencer-26.6.3-98e8a45100863886d074205e8ffdc5a7eb582b17/node_modules/@jest/test-sequencer/", {"name":"@jest/test-sequencer","reference":"26.6.3"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-runner-26.6.3-2d1fed3d46e10f233fd1dbd3bfaa3fe8924be159/node_modules/jest-runner/", {"name":"jest-runner","reference":"26.6.3"}],
  ["../../Library/Caches/Yarn/v3/npm-@jest-environment-26.6.2-ba364cc72e221e79cc8f0a99555bf5d7577cf92c/node_modules/@jest/environment/", {"name":"@jest/environment","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-@jest-fake-timers-26.6.2-459c329bcf70cee4af4d7e3f3e67848123535aad/node_modules/@jest/fake-timers/", {"name":"@jest/fake-timers","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-@sinonjs-fake-timers-6.0.1-293674fccb3262ac782c7aadfdeca86b10c75c40/node_modules/@sinonjs/fake-timers/", {"name":"@sinonjs/fake-timers","reference":"6.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-@sinonjs-commons-1.8.1-e7df00f98a203324f6dc7cc606cad9d4a8ab2217/node_modules/@sinonjs/commons/", {"name":"@sinonjs/commons","reference":"1.8.1"}],
  ["../../Library/Caches/Yarn/v3/npm-type-detect-4.0.8-7646fb5f18871cfbb7749e69bd39a6388eb7450c/node_modules/type-detect/", {"name":"type-detect","reference":"4.0.8"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-mock-26.6.2-d6cb712b041ed47fe0d9b6fc3474bc6543feb302/node_modules/jest-mock/", {"name":"jest-mock","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-emittery-0.7.2-25595908e13af0f5674ab419396e2fb394cdfa82/node_modules/emittery/", {"name":"emittery","reference":"0.7.2"}],
  ["../../Library/Caches/Yarn/v3/npm-babel-jest-26.6.3-d87d25cb0037577a0c89f82e5755c5d293c01056/node_modules/babel-jest/", {"name":"babel-jest","reference":"26.6.3"}],
  ["../../Library/Caches/Yarn/v3/npm-@types-babel-core-7.1.12-4d8e9e51eb265552a7e4f1ff2219ab6133bdfb2d/node_modules/@types/babel__core/", {"name":"@types/babel__core","reference":"7.1.12"}],
  ["../../Library/Caches/Yarn/v3/npm-@types-babel-generator-7.6.2-f3d71178e187858f7c45e30380f8f1b7415a12d8/node_modules/@types/babel__generator/", {"name":"@types/babel__generator","reference":"7.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-@types-babel-template-7.4.0-0c888dd70b3ee9eebb6e4f200e809da0076262be/node_modules/@types/babel__template/", {"name":"@types/babel__template","reference":"7.4.0"}],
  ["../../Library/Caches/Yarn/v3/npm-@types-babel-traverse-7.0.16-0bbbf70c7bc4193210dd27e252c51260a37cd6a7/node_modules/@types/babel__traverse/", {"name":"@types/babel__traverse","reference":"7.0.16"}],
  ["../../Library/Caches/Yarn/v3/npm-babel-preset-jest-26.6.2-747872b1171df032252426586881d62d31798fee/node_modules/babel-preset-jest/", {"name":"babel-preset-jest","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-babel-plugin-jest-hoist-26.6.2-8185bd030348d254c6d7dd974355e6a28b21e62d/node_modules/babel-plugin-jest-hoist/", {"name":"babel-plugin-jest-hoist","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-babel-preset-current-node-syntax-1.0.0-cf5feef29551253471cfa82fc8e0f5063df07a77/node_modules/babel-preset-current-node-syntax/", {"name":"babel-preset-current-node-syntax","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-async-generators-7.8.4-a983fb1aeb2ec3f6ed042a210f640e90e786fe0d/node_modules/@babel/plugin-syntax-async-generators/", {"name":"@babel/plugin-syntax-async-generators","reference":"7.8.4"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-bigint-7.8.3-4c9a6f669f5d0cdf1b90a1671e9a146be5300cea/node_modules/@babel/plugin-syntax-bigint/", {"name":"@babel/plugin-syntax-bigint","reference":"7.8.3"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-class-properties-7.12.1-bcb297c5366e79bebadef509549cd93b04f19978/node_modules/@babel/plugin-syntax-class-properties/", {"name":"@babel/plugin-syntax-class-properties","reference":"7.12.1"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-import-meta-7.10.4-ee601348c370fa334d2207be158777496521fd51/node_modules/@babel/plugin-syntax-import-meta/", {"name":"@babel/plugin-syntax-import-meta","reference":"7.10.4"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-json-strings-7.8.3-01ca21b668cd8218c9e640cb6dd88c5412b2c96a/node_modules/@babel/plugin-syntax-json-strings/", {"name":"@babel/plugin-syntax-json-strings","reference":"7.8.3"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-logical-assignment-operators-7.10.4-ca91ef46303530448b906652bac2e9fe9941f699/node_modules/@babel/plugin-syntax-logical-assignment-operators/", {"name":"@babel/plugin-syntax-logical-assignment-operators","reference":"7.10.4"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-nullish-coalescing-operator-7.8.3-167ed70368886081f74b5c36c65a88c03b66d1a9/node_modules/@babel/plugin-syntax-nullish-coalescing-operator/", {"name":"@babel/plugin-syntax-nullish-coalescing-operator","reference":"7.8.3"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-numeric-separator-7.10.4-b9b070b3e33570cd9fd07ba7fa91c0dd37b9af97/node_modules/@babel/plugin-syntax-numeric-separator/", {"name":"@babel/plugin-syntax-numeric-separator","reference":"7.10.4"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-object-rest-spread-7.8.3-60e225edcbd98a640332a2e72dd3e66f1af55871/node_modules/@babel/plugin-syntax-object-rest-spread/", {"name":"@babel/plugin-syntax-object-rest-spread","reference":"7.8.3"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-optional-catch-binding-7.8.3-6111a265bcfb020eb9efd0fdfd7d26402b9ed6c1/node_modules/@babel/plugin-syntax-optional-catch-binding/", {"name":"@babel/plugin-syntax-optional-catch-binding","reference":"7.8.3"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-optional-chaining-7.8.3-4f69c2ab95167e0180cd5336613f8c5788f7d48a/node_modules/@babel/plugin-syntax-optional-chaining/", {"name":"@babel/plugin-syntax-optional-chaining","reference":"7.8.3"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-plugin-syntax-top-level-await-7.12.1-dd6c0b357ac1bb142d98537450a319625d13d2a0/node_modules/@babel/plugin-syntax-top-level-await/", {"name":"@babel/plugin-syntax-top-level-await","reference":"7.12.1"}],
  ["../../Library/Caches/Yarn/v3/npm-deepmerge-4.2.2-44d2ea3679b8f4d4ffba33f03d865fc1e7bf4955/node_modules/deepmerge/", {"name":"deepmerge","reference":"4.2.2"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-environment-jsdom-26.6.2-78d09fe9cf019a357009b9b7e1f101d23bd1da3e/node_modules/jest-environment-jsdom/", {"name":"jest-environment-jsdom","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-jsdom-16.4.0-36005bde2d136f73eee1a830c6d45e55408edddb/node_modules/jsdom/", {"name":"jsdom","reference":"16.4.0"}],
  ["../../Library/Caches/Yarn/v3/npm-abab-2.0.5-c0b678fb32d60fc1219c784d6a826fe385aeb79a/node_modules/abab/", {"name":"abab","reference":"2.0.5"}],
  ["../../Library/Caches/Yarn/v3/npm-acorn-7.4.1-feaed255973d2e77555b83dbc08851a6c63520fa/node_modules/acorn/", {"name":"acorn","reference":"7.4.1"}],
  ["../../Library/Caches/Yarn/v3/npm-acorn-globals-6.0.0-46cdd39f0f8ff08a876619b55f5ac8a6dc770b45/node_modules/acorn-globals/", {"name":"acorn-globals","reference":"6.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-acorn-walk-7.2.0-0de889a601203909b0fbe07b8938dc21d2e967bc/node_modules/acorn-walk/", {"name":"acorn-walk","reference":"7.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-cssom-0.4.4-5a66cf93d2d0b661d80bf6a44fb65f5c2e4e0a10/node_modules/cssom/", {"name":"cssom","reference":"0.4.4"}],
  ["../../Library/Caches/Yarn/v3/npm-cssom-0.3.8-9f1276f5b2b463f2114d3f2c75250af8c1a36f4a/node_modules/cssom/", {"name":"cssom","reference":"0.3.8"}],
  ["../../Library/Caches/Yarn/v3/npm-cssstyle-2.3.0-ff665a0ddbdc31864b09647f34163443d90b0852/node_modules/cssstyle/", {"name":"cssstyle","reference":"2.3.0"}],
  ["../../Library/Caches/Yarn/v3/npm-data-urls-2.0.0-156485a72963a970f5d5821aaf642bef2bf2db9b/node_modules/data-urls/", {"name":"data-urls","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-whatwg-mimetype-2.3.0-3d4b1e0312d2079879f826aff18dbeeca5960fbf/node_modules/whatwg-mimetype/", {"name":"whatwg-mimetype","reference":"2.3.0"}],
  ["../../Library/Caches/Yarn/v3/npm-whatwg-url-8.4.0-50fb9615b05469591d2b2bd6dfaed2942ed72837/node_modules/whatwg-url/", {"name":"whatwg-url","reference":"8.4.0"}],
  ["../../Library/Caches/Yarn/v3/npm-lodash-sortby-4.7.0-edd14c824e2cc9c1e0b0a1b42bb5210516a42438/node_modules/lodash.sortby/", {"name":"lodash.sortby","reference":"4.7.0"}],
  ["../../Library/Caches/Yarn/v3/npm-tr46-2.0.2-03273586def1595ae08fedb38d7733cee91d2479/node_modules/tr46/", {"name":"tr46","reference":"2.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-punycode-2.1.1-b58b010ac40c22c5657616c8d2c2c02c7bf479ec/node_modules/punycode/", {"name":"punycode","reference":"2.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-webidl-conversions-6.1.0-9111b4d7ea80acd40f5270d666621afa78b69514/node_modules/webidl-conversions/", {"name":"webidl-conversions","reference":"6.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-webidl-conversions-5.0.0-ae59c8a00b121543a2acc65c0434f57b0fc11aff/node_modules/webidl-conversions/", {"name":"webidl-conversions","reference":"5.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-decimal-js-10.2.1-238ae7b0f0c793d3e3cea410108b35a2c01426a3/node_modules/decimal.js/", {"name":"decimal.js","reference":"10.2.1"}],
  ["../../Library/Caches/Yarn/v3/npm-domexception-2.0.1-fb44aefba793e1574b0af6aed2801d057529f304/node_modules/domexception/", {"name":"domexception","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-escodegen-1.14.3-4e7b81fba61581dc97582ed78cab7f0e8d63f503/node_modules/escodegen/", {"name":"escodegen","reference":"1.14.3"}],
  ["../../Library/Caches/Yarn/v3/npm-estraverse-4.3.0-398ad3f3c5a24948be7725e83d11a7de28cdbd1d/node_modules/estraverse/", {"name":"estraverse","reference":"4.3.0"}],
  ["../../Library/Caches/Yarn/v3/npm-esutils-2.0.3-74d2eb4de0b8da1293711910d50775b9b710ef64/node_modules/esutils/", {"name":"esutils","reference":"2.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-optionator-0.8.3-84fa1d036fe9d3c7e21d99884b601167ec8fb495/node_modules/optionator/", {"name":"optionator","reference":"0.8.3"}],
  ["../../Library/Caches/Yarn/v3/npm-deep-is-0.1.3-b369d6fb5dbc13eecf524f91b070feedc357cf34/node_modules/deep-is/", {"name":"deep-is","reference":"0.1.3"}],
  ["../../Library/Caches/Yarn/v3/npm-fast-levenshtein-2.0.6-3d8a5c66883a16a30ca8643e851f19baa7797917/node_modules/fast-levenshtein/", {"name":"fast-levenshtein","reference":"2.0.6"}],
  ["../../Library/Caches/Yarn/v3/npm-levn-0.3.0-3b09924edf9f083c0490fdd4c0bc4421e04764ee/node_modules/levn/", {"name":"levn","reference":"0.3.0"}],
  ["../../Library/Caches/Yarn/v3/npm-prelude-ls-1.1.2-21932a549f5e52ffd9a827f570e04be62a97da54/node_modules/prelude-ls/", {"name":"prelude-ls","reference":"1.1.2"}],
  ["../../Library/Caches/Yarn/v3/npm-type-check-0.3.2-5884cab512cf1d355e3fb784f30804b2b520db72/node_modules/type-check/", {"name":"type-check","reference":"0.3.2"}],
  ["../../Library/Caches/Yarn/v3/npm-word-wrap-1.2.3-610636f6b1f703891bd34771ccb17fb93b47079c/node_modules/word-wrap/", {"name":"word-wrap","reference":"1.2.3"}],
  ["../../Library/Caches/Yarn/v3/npm-html-encoding-sniffer-2.0.1-42a6dc4fd33f00281176e8b23759ca4e4fa185f3/node_modules/html-encoding-sniffer/", {"name":"html-encoding-sniffer","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-whatwg-encoding-1.0.5-5abacf777c32166a51d085d6b4f3e7d27113ddb0/node_modules/whatwg-encoding/", {"name":"whatwg-encoding","reference":"1.0.5"}],
  ["../../Library/Caches/Yarn/v3/npm-iconv-lite-0.4.24-2022b4b25fbddc21d2f524974a474aafe733908b/node_modules/iconv-lite/", {"name":"iconv-lite","reference":"0.4.24"}],
  ["../../Library/Caches/Yarn/v3/npm-safer-buffer-2.1.2-44fa161b0187b9549dd84bb91802f9bd8385cd6a/node_modules/safer-buffer/", {"name":"safer-buffer","reference":"2.1.2"}],
  ["../../Library/Caches/Yarn/v3/npm-is-potential-custom-element-name-1.0.0-0c52e54bcca391bb2c494b21e8626d7336c6e397/node_modules/is-potential-custom-element-name/", {"name":"is-potential-custom-element-name","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-nwsapi-2.2.0-204879a9e3d068ff2a55139c2c772780681a38b7/node_modules/nwsapi/", {"name":"nwsapi","reference":"2.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-parse5-5.1.1-f68e4e5ba1852ac2cadc00f4555fff6c2abb6178/node_modules/parse5/", {"name":"parse5","reference":"5.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-request-2.88.2-d73c918731cb5a87da047e207234146f664d12b3/node_modules/request/", {"name":"request","reference":"2.88.2"}],
  ["../../Library/Caches/Yarn/v3/npm-aws-sign2-0.7.0-b46e890934a9591f2d2f6f86d7e6a9f1b3fe76a8/node_modules/aws-sign2/", {"name":"aws-sign2","reference":"0.7.0"}],
  ["../../Library/Caches/Yarn/v3/npm-aws4-1.11.0-d61f46d83b2519250e2784daf5b09479a8b41c59/node_modules/aws4/", {"name":"aws4","reference":"1.11.0"}],
  ["../../Library/Caches/Yarn/v3/npm-caseless-0.12.0-1b681c21ff84033c826543090689420d187151dc/node_modules/caseless/", {"name":"caseless","reference":"0.12.0"}],
  ["../../Library/Caches/Yarn/v3/npm-combined-stream-1.0.8-c3d45a8b34fd730631a110a8a2520682b31d5a7f/node_modules/combined-stream/", {"name":"combined-stream","reference":"1.0.8"}],
  ["../../Library/Caches/Yarn/v3/npm-delayed-stream-1.0.0-df3ae199acadfb7d440aaae0b29e2272b24ec619/node_modules/delayed-stream/", {"name":"delayed-stream","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-extend-3.0.2-f8b1136b4071fbd8eb140aff858b1019ec2915fa/node_modules/extend/", {"name":"extend","reference":"3.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-forever-agent-0.6.1-fbc71f0c41adeb37f96c577ad1ed42d8fdacca91/node_modules/forever-agent/", {"name":"forever-agent","reference":"0.6.1"}],
  ["../../Library/Caches/Yarn/v3/npm-form-data-2.3.3-dcce52c05f644f298c6a7ab936bd724ceffbf3a6/node_modules/form-data/", {"name":"form-data","reference":"2.3.3"}],
  ["../../Library/Caches/Yarn/v3/npm-asynckit-0.4.0-c79ed97f7f34cb8f2ba1bc9790bcc366474b4b79/node_modules/asynckit/", {"name":"asynckit","reference":"0.4.0"}],
  ["../../Library/Caches/Yarn/v3/npm-mime-types-2.1.27-47949f98e279ea53119f5722e0f34e529bec009f/node_modules/mime-types/", {"name":"mime-types","reference":"2.1.27"}],
  ["../../Library/Caches/Yarn/v3/npm-mime-db-1.44.0-fa11c5eb0aca1334b4233cb4d52f10c5a6272f92/node_modules/mime-db/", {"name":"mime-db","reference":"1.44.0"}],
  ["../../Library/Caches/Yarn/v3/npm-har-validator-5.1.5-1f0803b9f8cb20c0fa13822df1ecddb36bde1efd/node_modules/har-validator/", {"name":"har-validator","reference":"5.1.5"}],
  ["../../Library/Caches/Yarn/v3/npm-ajv-6.12.6-baf5a62e802b07d977034586f8c3baf5adf26df4/node_modules/ajv/", {"name":"ajv","reference":"6.12.6"}],
  ["../../Library/Caches/Yarn/v3/npm-fast-deep-equal-3.1.3-3a7d56b559d6cbc3eb512325244e619a65c6c525/node_modules/fast-deep-equal/", {"name":"fast-deep-equal","reference":"3.1.3"}],
  ["../../Library/Caches/Yarn/v3/npm-json-schema-traverse-0.4.1-69f6a87d9513ab8bb8fe63bdb0979c448e684660/node_modules/json-schema-traverse/", {"name":"json-schema-traverse","reference":"0.4.1"}],
  ["../../Library/Caches/Yarn/v3/npm-uri-js-4.4.0-aa714261de793e8a82347a7bcc9ce74e86f28602/node_modules/uri-js/", {"name":"uri-js","reference":"4.4.0"}],
  ["../../Library/Caches/Yarn/v3/npm-har-schema-2.0.0-a94c2224ebcac04782a0d9035521f24735b7ec92/node_modules/har-schema/", {"name":"har-schema","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-http-signature-1.2.0-9aecd925114772f3d95b65a60abb8f7c18fbace1/node_modules/http-signature/", {"name":"http-signature","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-assert-plus-1.0.0-f12e0f3c5d77b0b1cdd9146942e4e96c1e4dd525/node_modules/assert-plus/", {"name":"assert-plus","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-jsprim-1.4.1-313e66bc1e5cc06e438bc1b7499c2e5c56acb6a2/node_modules/jsprim/", {"name":"jsprim","reference":"1.4.1"}],
  ["../../Library/Caches/Yarn/v3/npm-extsprintf-1.3.0-96918440e3041a7a414f8c52e3c574eb3c3e1e05/node_modules/extsprintf/", {"name":"extsprintf","reference":"1.3.0"}],
  ["../../Library/Caches/Yarn/v3/npm-extsprintf-1.4.0-e2689f8f356fad62cca65a3a91c5df5f9551692f/node_modules/extsprintf/", {"name":"extsprintf","reference":"1.4.0"}],
  ["../../Library/Caches/Yarn/v3/npm-json-schema-0.2.3-b480c892e59a2f05954ce727bd3f2a4e882f9e13/node_modules/json-schema/", {"name":"json-schema","reference":"0.2.3"}],
  ["../../Library/Caches/Yarn/v3/npm-verror-1.10.0-3a105ca17053af55d6e270c1f8288682e18da400/node_modules/verror/", {"name":"verror","reference":"1.10.0"}],
  ["../../Library/Caches/Yarn/v3/npm-core-util-is-1.0.2-b5fd54220aa2bc5ab57aab7140c940754503c1a7/node_modules/core-util-is/", {"name":"core-util-is","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-sshpk-1.16.1-fb661c0bef29b39db40769ee39fa70093d6f6877/node_modules/sshpk/", {"name":"sshpk","reference":"1.16.1"}],
  ["../../Library/Caches/Yarn/v3/npm-asn1-0.2.4-8d2475dfab553bb33e77b54e59e880bb8ce23136/node_modules/asn1/", {"name":"asn1","reference":"0.2.4"}],
  ["../../Library/Caches/Yarn/v3/npm-bcrypt-pbkdf-1.0.2-a4301d389b6a43f9b67ff3ca11a3f6637e360e9e/node_modules/bcrypt-pbkdf/", {"name":"bcrypt-pbkdf","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-tweetnacl-0.14.5-5ae68177f192d4456269d108afa93ff8743f4f64/node_modules/tweetnacl/", {"name":"tweetnacl","reference":"0.14.5"}],
  ["../../Library/Caches/Yarn/v3/npm-dashdash-1.14.1-853cfa0f7cbe2fed5de20326b8dd581035f6e2f0/node_modules/dashdash/", {"name":"dashdash","reference":"1.14.1"}],
  ["../../Library/Caches/Yarn/v3/npm-ecc-jsbn-0.1.2-3a83a904e54353287874c564b7549386849a98c9/node_modules/ecc-jsbn/", {"name":"ecc-jsbn","reference":"0.1.2"}],
  ["../../Library/Caches/Yarn/v3/npm-jsbn-0.1.1-a5e654c2e5a2deb5f201d96cefbca80c0ef2f513/node_modules/jsbn/", {"name":"jsbn","reference":"0.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-getpass-0.1.7-5eff8e3e684d569ae4cb2b1282604e8ba62149fa/node_modules/getpass/", {"name":"getpass","reference":"0.1.7"}],
  ["../../Library/Caches/Yarn/v3/npm-isstream-0.1.2-47e63f7af55afa6f92e1500e690eb8b8529c099a/node_modules/isstream/", {"name":"isstream","reference":"0.1.2"}],
  ["../../Library/Caches/Yarn/v3/npm-json-stringify-safe-5.0.1-1296a2d58fd45f19a0f6ce01d65701e2c735b6eb/node_modules/json-stringify-safe/", {"name":"json-stringify-safe","reference":"5.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-oauth-sign-0.9.0-47a7b016baa68b5fa0ecf3dee08a85c679ac6455/node_modules/oauth-sign/", {"name":"oauth-sign","reference":"0.9.0"}],
  ["../../Library/Caches/Yarn/v3/npm-performance-now-2.1.0-6309f4e0e5fa913ec1c69307ae364b4b377c9e7b/node_modules/performance-now/", {"name":"performance-now","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-qs-6.5.2-cb3ae806e8740444584ef154ce8ee98d403f3e36/node_modules/qs/", {"name":"qs","reference":"6.5.2"}],
  ["../../Library/Caches/Yarn/v3/npm-tough-cookie-2.5.0-cd9fb2a0aa1d5a12b473bd9fb96fa3dcff65ade2/node_modules/tough-cookie/", {"name":"tough-cookie","reference":"2.5.0"}],
  ["../../Library/Caches/Yarn/v3/npm-tough-cookie-3.0.1-9df4f57e739c26930a018184887f4adb7dca73b2/node_modules/tough-cookie/", {"name":"tough-cookie","reference":"3.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-psl-1.8.0-9326f8bcfb013adcc005fdff056acce020e51c24/node_modules/psl/", {"name":"psl","reference":"1.8.0"}],
  ["../../Library/Caches/Yarn/v3/npm-tunnel-agent-0.6.0-27a5dea06b36b04a0a9966774b290868f0fc40fd/node_modules/tunnel-agent/", {"name":"tunnel-agent","reference":"0.6.0"}],
  ["../../Library/Caches/Yarn/v3/npm-request-promise-native-1.0.9-e407120526a5efdc9a39b28a5679bf47b9d9dc28/node_modules/request-promise-native/", {"name":"request-promise-native","reference":"1.0.9"}],
  ["../../Library/Caches/Yarn/v3/npm-request-promise-core-1.1.4-3eedd4223208d419867b78ce815167d10593a22f/node_modules/request-promise-core/", {"name":"request-promise-core","reference":"1.1.4"}],
  ["../../Library/Caches/Yarn/v3/npm-stealthy-require-1.1.1-35b09875b4ff49f26a777e509b3090a3226bf24b/node_modules/stealthy-require/", {"name":"stealthy-require","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-saxes-5.0.1-eebab953fa3b7608dbe94e5dadb15c888fa6696d/node_modules/saxes/", {"name":"saxes","reference":"5.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-xmlchars-2.2.0-060fe1bcb7f9c76fe2a17db86a9bc3ab894210cb/node_modules/xmlchars/", {"name":"xmlchars","reference":"2.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-symbol-tree-3.2.4-430637d248ba77e078883951fb9aa0eed7c63fa2/node_modules/symbol-tree/", {"name":"symbol-tree","reference":"3.2.4"}],
  ["../../Library/Caches/Yarn/v3/npm-ip-regex-2.1.0-fa78bf5d2e6913c911ce9f819ee5146bb6d844e9/node_modules/ip-regex/", {"name":"ip-regex","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-w3c-hr-time-1.0.2-0a89cdf5cc15822df9c360543676963e0cc308cd/node_modules/w3c-hr-time/", {"name":"w3c-hr-time","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-browser-process-hrtime-1.0.0-3c9b4b7d782c8121e56f10106d84c0d0ffc94626/node_modules/browser-process-hrtime/", {"name":"browser-process-hrtime","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-w3c-xmlserializer-2.0.0-3e7104a05b75146cc60f564380b7f683acf1020a/node_modules/w3c-xmlserializer/", {"name":"w3c-xmlserializer","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-xml-name-validator-3.0.0-6ae73e06de4d8c6e47f9fb181f78d648ad457c6a/node_modules/xml-name-validator/", {"name":"xml-name-validator","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-ws-7.4.0-a5dd76a24197940d4a8bb9e0e152bb4503764da7/node_modules/ws/", {"name":"ws","reference":"7.4.0"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-environment-node-26.6.2-824e4c7fb4944646356f11ac75b229b0035f2b0c/node_modules/jest-environment-node/", {"name":"jest-environment-node","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-get-type-26.3.0-e97dc3c3f53c2b406ca7afaed4493b1d099199e0/node_modules/jest-get-type/", {"name":"jest-get-type","reference":"26.3.0"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-jasmine2-26.6.3-adc3cf915deacb5212c93b9f3547cd12958f2edd/node_modules/jest-jasmine2/", {"name":"jest-jasmine2","reference":"26.6.3"}],
  ["../../Library/Caches/Yarn/v3/npm-@jest-source-map-26.6.2-29af5e1e2e324cafccc936f218309f54ab69d535/node_modules/@jest/source-map/", {"name":"@jest/source-map","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-callsites-3.1.0-b3630abd8943432f54b3f0519238e33cd7df2f73/node_modules/callsites/", {"name":"callsites","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-co-4.6.0-6ea6bdf3d853ae54ccb8e47bfa0bf3f9031fb184/node_modules/co/", {"name":"co","reference":"4.6.0"}],
  ["../../Library/Caches/Yarn/v3/npm-expect-26.6.2-c6b996bf26bf3fe18b67b2d0f51fc981ba934417/node_modules/expect/", {"name":"expect","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-matcher-utils-26.6.2-8e6fd6e863c8b2d31ac6472eeb237bc595e53e7a/node_modules/jest-matcher-utils/", {"name":"jest-matcher-utils","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-diff-26.6.2-1aa7468b52c3a68d7d5c5fdcdfcd5e49bd164394/node_modules/jest-diff/", {"name":"jest-diff","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-diff-sequences-26.6.2-48ba99157de1923412eed41db6b6d4aa9ca7c0b1/node_modules/diff-sequences/", {"name":"diff-sequences","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-is-generator-fn-2.1.0-7d140adc389aaf3011a8f2a2a4cfa6faadffb118/node_modules/is-generator-fn/", {"name":"is-generator-fn","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-each-26.6.2-02526438a77a67401c8a6382dfe5999952c167cb/node_modules/jest-each/", {"name":"jest-each","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-runtime-26.6.3-4f64efbcfac398331b74b4b3c82d27d401b8fa2b/node_modules/jest-runtime/", {"name":"jest-runtime","reference":"26.6.3"}],
  ["../../Library/Caches/Yarn/v3/npm-@jest-globals-26.6.2-5b613b78a1aa2655ae908eba638cc96a20df720a/node_modules/@jest/globals/", {"name":"@jest/globals","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-cjs-module-lexer-0.6.0-4186fcca0eae175970aee870b9fe2d6cf8d5655f/node_modules/cjs-module-lexer/", {"name":"cjs-module-lexer","reference":"0.6.0"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-validate-26.6.2-23d380971587150467342911c3d7b4ac57ab20ec/node_modules/jest-validate/", {"name":"jest-validate","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-leven-3.1.0-77891de834064cccba82ae7842bb6b14a13ed7f2/node_modules/leven/", {"name":"leven","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-snapshot-26.6.2-f3b0af1acb223316850bd14e1beea9837fb39c84/node_modules/jest-snapshot/", {"name":"jest-snapshot","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-@types-prettier-2.1.5-b6ab3bba29e16b821d84e09ecfaded462b816b00/node_modules/@types/prettier/", {"name":"@types/prettier","reference":"2.1.5"}],
  ["../../Library/Caches/Yarn/v3/npm-natural-compare-1.4.0-4abebfeed7541f2c27acfb29bdbbd15c8d5ba4f7/node_modules/natural-compare/", {"name":"natural-compare","reference":"1.4.0"}],
  ["../../Library/Caches/Yarn/v3/npm-strip-bom-4.0.0-9c3505c1db45bcedca3d9cf7a16f5c5aa3901878/node_modules/strip-bom/", {"name":"strip-bom","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-yargs-15.4.1-0d87a16de01aee9d8bec2bfbf74f67851730f4f8/node_modules/yargs/", {"name":"yargs","reference":"15.4.1"}],
  ["../../Library/Caches/Yarn/v3/npm-cliui-6.0.0-511d702c0c4e41ca156d7d0e96021f23e13225b1/node_modules/cliui/", {"name":"cliui","reference":"6.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-string-width-4.2.0-952182c46cc7b2c313d1596e623992bd163b72b5/node_modules/string-width/", {"name":"string-width","reference":"4.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-emoji-regex-8.0.0-e818fd69ce5ccfcb404594f842963bf53164cc37/node_modules/emoji-regex/", {"name":"emoji-regex","reference":"8.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-is-fullwidth-code-point-3.0.0-f116f8064fe90b3f7844a38997c0b75051269f1d/node_modules/is-fullwidth-code-point/", {"name":"is-fullwidth-code-point","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-wrap-ansi-6.2.0-e9393ba07102e6c91a3b221478f0257cd2856e53/node_modules/wrap-ansi/", {"name":"wrap-ansi","reference":"6.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-decamelize-1.2.0-f6534d15148269b20352e7bee26f501f9a191290/node_modules/decamelize/", {"name":"decamelize","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-get-caller-file-2.0.5-4f94412a82db32f36e3b0b9741f8a97feb031f7e/node_modules/get-caller-file/", {"name":"get-caller-file","reference":"2.0.5"}],
  ["../../Library/Caches/Yarn/v3/npm-require-directory-2.1.1-8c64ad5fd30dab1c976e2344ffe7f792a6a6df42/node_modules/require-directory/", {"name":"require-directory","reference":"2.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-require-main-filename-2.0.0-d0b329ecc7cc0f61649f62215be69af54aa8989b/node_modules/require-main-filename/", {"name":"require-main-filename","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-set-blocking-2.0.0-045f9782d011ae9a6803ddd382b24392b3d890f7/node_modules/set-blocking/", {"name":"set-blocking","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-which-module-2.0.0-d9ef07dce77b9902b8a3a8fa4b31c3e3f7e6e87a/node_modules/which-module/", {"name":"which-module","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-y18n-4.0.1-8db2b83c31c5d75099bb890b23f3094891e247d4/node_modules/y18n/", {"name":"y18n","reference":"4.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-yargs-parser-18.1.3-be68c4975c6b2abf469236b0c870362fab09a7b0/node_modules/yargs-parser/", {"name":"yargs-parser","reference":"18.1.3"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-docblock-26.0.0-3e2fa20899fc928cb13bd0ff68bd3711a36889b5/node_modules/jest-docblock/", {"name":"jest-docblock","reference":"26.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-detect-newline-3.1.0-576f5dfc63ae1a192ff192d8ad3af6308991b651/node_modules/detect-newline/", {"name":"detect-newline","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-leak-detector-26.6.2-7717cf118b92238f2eba65054c8a0c9c653a91af/node_modules/jest-leak-detector/", {"name":"jest-leak-detector","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-source-map-support-0.5.19-a98b62f86dcaf4f67399648c085291ab9e8fed61/node_modules/source-map-support/", {"name":"source-map-support","reference":"0.5.19"}],
  ["../../Library/Caches/Yarn/v3/npm-buffer-from-1.1.1-32713bc028f75c02fdb710d7c7bcec1f2c6070ef/node_modules/buffer-from/", {"name":"buffer-from","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-resolve-dependencies-26.6.3-6680859ee5d22ee5dcd961fe4871f59f4c784fb6/node_modules/jest-resolve-dependencies/", {"name":"jest-resolve-dependencies","reference":"26.6.3"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-watcher-26.6.2-a5b683b8f9d68dbcb1d7dae32172d2cca0592975/node_modules/jest-watcher/", {"name":"jest-watcher","reference":"26.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-p-each-series-2.2.0-105ab0357ce72b202a8a8b94933672657b5e2a9a/node_modules/p-each-series/", {"name":"p-each-series","reference":"2.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-rimraf-3.0.2-f1a5402ba6220ad52cc1282bac1ae3aa49fd061a/node_modules/rimraf/", {"name":"rimraf","reference":"3.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-import-local-3.0.2-a8cfd0431d1de4a2199703d003e3e62364fa6db6/node_modules/import-local/", {"name":"import-local","reference":"3.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-pkg-dir-4.2.0-f099133df7ede422e81d1d8448270eeb3e4261f3/node_modules/pkg-dir/", {"name":"pkg-dir","reference":"4.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-resolve-cwd-3.0.0-0f0075f1bb2544766cf73ba6a6e2adfebcb13f2d/node_modules/resolve-cwd/", {"name":"resolve-cwd","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-jest-cli-26.6.3-43117cfef24bc4cd691a174a8796a532e135e92a/node_modules/jest-cli/", {"name":"jest-cli","reference":"26.6.3"}],
  ["../../Library/Caches/Yarn/v3/npm-prompts-2.4.0-4aa5de0723a231d1ee9121c40fdf663df73f61d7/node_modules/prompts/", {"name":"prompts","reference":"2.4.0"}],
  ["../../Library/Caches/Yarn/v3/npm-kleur-3.0.3-a79c9ecc86ee1ce3fa6206d1216c501f147fc07e/node_modules/kleur/", {"name":"kleur","reference":"3.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-sisteransi-1.0.5-134d681297756437cc05ca01370d3a7a571075ed/node_modules/sisteransi/", {"name":"sisteransi","reference":"1.0.5"}],
  ["../../Library/Caches/Yarn/v3/npm-prettier-1.19.1-f7d7f5ff8a9cd872a7be4ca142095956a60797cb/node_modules/prettier/", {"name":"prettier","reference":"1.19.1"}],
  ["../../Library/Caches/Yarn/v3/npm-remark-13.0.0-d15d9bf71a402f40287ebe36067b66d54868e425/node_modules/remark/", {"name":"remark","reference":"13.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-remark-parse-9.0.0-4d20a299665880e4f4af5d90b7c7b8a935853640/node_modules/remark-parse/", {"name":"remark-parse","reference":"9.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-mdast-util-from-markdown-0.8.1-781371d493cac11212947226190270c15dc97116/node_modules/mdast-util-from-markdown/", {"name":"mdast-util-from-markdown","reference":"0.8.1"}],
  ["../../Library/Caches/Yarn/v3/npm-@types-mdast-3.0.3-2d7d671b1cd1ea3deb306ea75036c2a0407d2deb/node_modules/@types/mdast/", {"name":"@types/mdast","reference":"3.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-mdast-util-to-string-1.1.0-27055500103f51637bd07d01da01eb1967a43527/node_modules/mdast-util-to-string/", {"name":"mdast-util-to-string","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-mdast-util-to-string-2.0.0-b8cfe6a713e1091cb5b728fc48885a4767f8b97b/node_modules/mdast-util-to-string/", {"name":"mdast-util-to-string","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-micromark-2.10.1-cd73f54e0656f10e633073db26b663a221a442a7/node_modules/micromark/", {"name":"micromark","reference":"2.10.1"}],
  ["../../Library/Caches/Yarn/v3/npm-parse-entities-2.0.0-53c6eb5b9314a1f4ec99fa0fdf7ce01ecda0cbe8/node_modules/parse-entities/", {"name":"parse-entities","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-character-entities-1.2.4-e12c3939b7eaf4e5b15e7ad4c5e28e1d48c5b16b/node_modules/character-entities/", {"name":"character-entities","reference":"1.2.4"}],
  ["../../Library/Caches/Yarn/v3/npm-character-entities-legacy-1.1.4-94bc1845dce70a5bb9d2ecc748725661293d8fc1/node_modules/character-entities-legacy/", {"name":"character-entities-legacy","reference":"1.1.4"}],
  ["../../Library/Caches/Yarn/v3/npm-character-reference-invalid-1.1.4-083329cda0eae272ab3dbbf37e9a382c13af1560/node_modules/character-reference-invalid/", {"name":"character-reference-invalid","reference":"1.1.4"}],
  ["../../Library/Caches/Yarn/v3/npm-is-alphanumerical-1.0.4-7eb9a2431f855f6b1ef1a78e326df515696c4dbf/node_modules/is-alphanumerical/", {"name":"is-alphanumerical","reference":"1.0.4"}],
  ["../../Library/Caches/Yarn/v3/npm-is-alphabetical-1.0.4-9e7d6b94916be22153745d184c298cbf986a686d/node_modules/is-alphabetical/", {"name":"is-alphabetical","reference":"1.0.4"}],
  ["../../Library/Caches/Yarn/v3/npm-is-decimal-1.0.4-65a3a5958a1c5b63a706e1b333d7cd9f630d3fa5/node_modules/is-decimal/", {"name":"is-decimal","reference":"1.0.4"}],
  ["../../Library/Caches/Yarn/v3/npm-is-hexadecimal-1.0.4-cc35c97588da4bd49a8eedd6bc4082d44dcb23a7/node_modules/is-hexadecimal/", {"name":"is-hexadecimal","reference":"1.0.4"}],
  ["../../Library/Caches/Yarn/v3/npm-remark-stringify-9.0.0-8ba0c9e4167c42733832215a81550489759e3793/node_modules/remark-stringify/", {"name":"remark-stringify","reference":"9.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-mdast-util-to-markdown-0.5.4-be680ed0c0e11a07d07c7adff9551eec09c1b0f9/node_modules/mdast-util-to-markdown/", {"name":"mdast-util-to-markdown","reference":"0.5.4"}],
  ["../../Library/Caches/Yarn/v3/npm-longest-streak-2.0.4-b8599957da5b5dab64dee3fe316fa774597d90e4/node_modules/longest-streak/", {"name":"longest-streak","reference":"2.0.4"}],
  ["../../Library/Caches/Yarn/v3/npm-zwitch-1.0.5-d11d7381ffed16b742f6af7b3f223d5cd9fe9920/node_modules/zwitch/", {"name":"zwitch","reference":"1.0.5"}],
  ["../../Library/Caches/Yarn/v3/npm-unified-9.2.0-67a62c627c40589edebbf60f53edfd4d822027f8/node_modules/unified/", {"name":"unified","reference":"9.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-bail-1.0.5-b6fa133404a392cbc1f8c4bf63f5953351e7a776/node_modules/bail/", {"name":"bail","reference":"1.0.5"}],
  ["../../Library/Caches/Yarn/v3/npm-is-plain-obj-2.1.0-45e42e37fccf1f40da8e5f76ee21515840c09287/node_modules/is-plain-obj/", {"name":"is-plain-obj","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-trough-1.0.5-b8b639cefad7d0bb2abd37d433ff8293efa5f406/node_modules/trough/", {"name":"trough","reference":"1.0.5"}],
  ["./", topLevelLocator],
]);
exports.findPackageLocator = function findPackageLocator(location) {
  let relativeLocation = normalizePath(path.relative(__dirname, location));

  if (!relativeLocation.match(isStrictRegExp))
    relativeLocation = `./${relativeLocation}`;

  if (location.match(isDirRegExp) && relativeLocation.charAt(relativeLocation.length - 1) !== '/')
    relativeLocation = `${relativeLocation}/`;

  let match;

  if (relativeLocation.length >= 194 && relativeLocation[193] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 194)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 191 && relativeLocation[190] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 191)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 184 && relativeLocation[183] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 184)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 181 && relativeLocation[180] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 181)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 173 && relativeLocation[172] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 173)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 172 && relativeLocation[171] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 172)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 171 && relativeLocation[170] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 171)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 170 && relativeLocation[169] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 170)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 169 && relativeLocation[168] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 169)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 168 && relativeLocation[167] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 168)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 164 && relativeLocation[163] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 164)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 161 && relativeLocation[160] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 161)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 160 && relativeLocation[159] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 160)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 159 && relativeLocation[158] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 159)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 158 && relativeLocation[157] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 158)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 153 && relativeLocation[152] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 153)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 152 && relativeLocation[151] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 152)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 151 && relativeLocation[150] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 151)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 150 && relativeLocation[149] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 150)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 149 && relativeLocation[148] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 149)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 148 && relativeLocation[147] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 148)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 147 && relativeLocation[146] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 147)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 146 && relativeLocation[145] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 146)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 145 && relativeLocation[144] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 145)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 143 && relativeLocation[142] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 143)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 142 && relativeLocation[141] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 142)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 141 && relativeLocation[140] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 141)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 140 && relativeLocation[139] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 140)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 139 && relativeLocation[138] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 139)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 138 && relativeLocation[137] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 138)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 137 && relativeLocation[136] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 137)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 136 && relativeLocation[135] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 136)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 135 && relativeLocation[134] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 135)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 134 && relativeLocation[133] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 134)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 133 && relativeLocation[132] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 133)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 132 && relativeLocation[131] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 132)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 131 && relativeLocation[130] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 131)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 130 && relativeLocation[129] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 130)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 129 && relativeLocation[128] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 129)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 128 && relativeLocation[127] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 128)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 127 && relativeLocation[126] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 127)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 126 && relativeLocation[125] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 126)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 125 && relativeLocation[124] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 125)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 124 && relativeLocation[123] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 124)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 123 && relativeLocation[122] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 123)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 122 && relativeLocation[121] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 122)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 121 && relativeLocation[120] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 121)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 120 && relativeLocation[119] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 120)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 119 && relativeLocation[118] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 119)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 118 && relativeLocation[117] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 118)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 117 && relativeLocation[116] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 117)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 116 && relativeLocation[115] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 116)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 115 && relativeLocation[114] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 115)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 114 && relativeLocation[113] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 114)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 113 && relativeLocation[112] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 113)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 112 && relativeLocation[111] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 112)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 111 && relativeLocation[110] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 111)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 110 && relativeLocation[109] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 110)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 109 && relativeLocation[108] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 109)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 108 && relativeLocation[107] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 108)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 107 && relativeLocation[106] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 107)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 106 && relativeLocation[105] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 106)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 105 && relativeLocation[104] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 105)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 104 && relativeLocation[103] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 104)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 103 && relativeLocation[102] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 103)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 102 && relativeLocation[101] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 102)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 101 && relativeLocation[100] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 101)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 99 && relativeLocation[98] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 99)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 87 && relativeLocation[86] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 87)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 2 && relativeLocation[1] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 2)))
      return blacklistCheck(match);

  return null;
};


/**
 * Returns the module that should be used to resolve require calls. It's usually the direct parent, except if we're
 * inside an eval expression.
 */

function getIssuerModule(parent) {
  let issuer = parent;

  while (issuer && (issuer.id === '[eval]' || issuer.id === '<repl>' || !issuer.filename)) {
    issuer = issuer.parent;
  }

  return issuer;
}

/**
 * Returns information about a package in a safe way (will throw if they cannot be retrieved)
 */

function getPackageInformationSafe(packageLocator) {
  const packageInformation = exports.getPackageInformation(packageLocator);

  if (!packageInformation) {
    throw makeError(
      `INTERNAL`,
      `Couldn't find a matching entry in the dependency tree for the specified parent (this is probably an internal error)`,
    );
  }

  return packageInformation;
}

/**
 * Implements the node resolution for folder access and extension selection
 */

function applyNodeExtensionResolution(unqualifiedPath, {extensions}) {
  // We use this "infinite while" so that we can restart the process as long as we hit package folders
  while (true) {
    let stat;

    try {
      stat = statSync(unqualifiedPath);
    } catch (error) {}

    // If the file exists and is a file, we can stop right there

    if (stat && !stat.isDirectory()) {
      // If the very last component of the resolved path is a symlink to a file, we then resolve it to a file. We only
      // do this first the last component, and not the rest of the path! This allows us to support the case of bin
      // symlinks, where a symlink in "/xyz/pkg-name/.bin/bin-name" will point somewhere else (like "/xyz/pkg-name/index.js").
      // In such a case, we want relative requires to be resolved relative to "/xyz/pkg-name/" rather than "/xyz/pkg-name/.bin/".
      //
      // Also note that the reason we must use readlink on the last component (instead of realpath on the whole path)
      // is that we must preserve the other symlinks, in particular those used by pnp to deambiguate packages using
      // peer dependencies. For example, "/xyz/.pnp/local/pnp-01234569/.bin/bin-name" should see its relative requires
      // be resolved relative to "/xyz/.pnp/local/pnp-0123456789/" rather than "/xyz/pkg-with-peers/", because otherwise
      // we would lose the information that would tell us what are the dependencies of pkg-with-peers relative to its
      // ancestors.

      if (lstatSync(unqualifiedPath).isSymbolicLink()) {
        unqualifiedPath = path.normalize(path.resolve(path.dirname(unqualifiedPath), readlinkSync(unqualifiedPath)));
      }

      return unqualifiedPath;
    }

    // If the file is a directory, we must check if it contains a package.json with a "main" entry

    if (stat && stat.isDirectory()) {
      let pkgJson;

      try {
        pkgJson = JSON.parse(readFileSync(`${unqualifiedPath}/package.json`, 'utf-8'));
      } catch (error) {}

      let nextUnqualifiedPath;

      if (pkgJson && pkgJson.main) {
        nextUnqualifiedPath = path.resolve(unqualifiedPath, pkgJson.main);
      }

      // If the "main" field changed the path, we start again from this new location

      if (nextUnqualifiedPath && nextUnqualifiedPath !== unqualifiedPath) {
        unqualifiedPath = nextUnqualifiedPath;
        continue;
      }
    }

    // Otherwise we check if we find a file that match one of the supported extensions

    const qualifiedPath = extensions
      .map(extension => {
        return `${unqualifiedPath}${extension}`;
      })
      .find(candidateFile => {
        return existsSync(candidateFile);
      });

    if (qualifiedPath) {
      return qualifiedPath;
    }

    // Otherwise, we check if the path is a folder - in such a case, we try to use its index

    if (stat && stat.isDirectory()) {
      const indexPath = extensions
        .map(extension => {
          return `${unqualifiedPath}/index${extension}`;
        })
        .find(candidateFile => {
          return existsSync(candidateFile);
        });

      if (indexPath) {
        return indexPath;
      }
    }

    // Otherwise there's nothing else we can do :(

    return null;
  }
}

/**
 * This function creates fake modules that can be used with the _resolveFilename function.
 * Ideally it would be nice to be able to avoid this, since it causes useless allocations
 * and cannot be cached efficiently (we recompute the nodeModulePaths every time).
 *
 * Fortunately, this should only affect the fallback, and there hopefully shouldn't be a
 * lot of them.
 */

function makeFakeModule(path) {
  const fakeModule = new Module(path, false);
  fakeModule.filename = path;
  fakeModule.paths = Module._nodeModulePaths(path);
  return fakeModule;
}

/**
 * Normalize path to posix format.
 */

// eslint-disable-next-line no-unused-vars
function normalizePath(fsPath) {
  return process.platform === 'win32' ? fsPath.replace(backwardSlashRegExp, '/') : fsPath;
}

/**
 * Forward the resolution to the next resolver (usually the native one)
 */

function callNativeResolution(request, issuer) {
  if (issuer.endsWith('/')) {
    issuer += 'internal.js';
  }

  try {
    enableNativeHooks = false;

    // Since we would need to create a fake module anyway (to call _resolveLookupPath that
    // would give us the paths to give to _resolveFilename), we can as well not use
    // the {paths} option at all, since it internally makes _resolveFilename create another
    // fake module anyway.
    return Module._resolveFilename(request, makeFakeModule(issuer), false);
  } finally {
    enableNativeHooks = true;
  }
}

/**
 * This key indicates which version of the standard is implemented by this resolver. The `std` key is the
 * Plug'n'Play standard, and any other key are third-party extensions. Third-party extensions are not allowed
 * to override the standard, and can only offer new methods.
 *
 * If an new version of the Plug'n'Play standard is released and some extensions conflict with newly added
 * functions, they'll just have to fix the conflicts and bump their own version number.
 */

exports.VERSIONS = {std: 1};

/**
 * Useful when used together with getPackageInformation to fetch information about the top-level package.
 */

exports.topLevel = {name: null, reference: null};

/**
 * Gets the package information for a given locator. Returns null if they cannot be retrieved.
 */

exports.getPackageInformation = function getPackageInformation({name, reference}) {
  const packageInformationStore = packageInformationStores.get(name);

  if (!packageInformationStore) {
    return null;
  }

  const packageInformation = packageInformationStore.get(reference);

  if (!packageInformation) {
    return null;
  }

  return packageInformation;
};

/**
 * Transforms a request (what's typically passed as argument to the require function) into an unqualified path.
 * This path is called "unqualified" because it only changes the package name to the package location on the disk,
 * which means that the end result still cannot be directly accessed (for example, it doesn't try to resolve the
 * file extension, or to resolve directories to their "index.js" content). Use the "resolveUnqualified" function
 * to convert them to fully-qualified paths, or just use "resolveRequest" that do both operations in one go.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveToUnqualified = function resolveToUnqualified(request, issuer, {considerBuiltins = true} = {}) {
  // Bailout if the request is a native module

  if (considerBuiltins && builtinModules.has(request)) {
    return null;
  }

  // We allow disabling the pnp resolution for some subpaths. This is because some projects, often legacy,
  // contain multiple levels of dependencies (ie. a yarn.lock inside a subfolder of a yarn.lock). This is
  // typically solved using workspaces, but not all of them have been converted already.

  if (ignorePattern && ignorePattern.test(issuer)) {
    const result = callNativeResolution(request, issuer);

    if (result === false) {
      throw makeError(
        `BUILTIN_NODE_RESOLUTION_FAIL`,
        `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer was explicitely ignored by the regexp "null")`,
        {
          request,
          issuer,
        },
      );
    }

    return result;
  }

  let unqualifiedPath;

  // If the request is a relative or absolute path, we just return it normalized

  const dependencyNameMatch = request.match(pathRegExp);

  if (!dependencyNameMatch) {
    if (path.isAbsolute(request)) {
      unqualifiedPath = path.normalize(request);
    } else if (issuer.match(isDirRegExp)) {
      unqualifiedPath = path.normalize(path.resolve(issuer, request));
    } else {
      unqualifiedPath = path.normalize(path.resolve(path.dirname(issuer), request));
    }
  }

  // Things are more hairy if it's a package require - we then need to figure out which package is needed, and in
  // particular the exact version for the given location on the dependency tree

  if (dependencyNameMatch) {
    const [, dependencyName, subPath] = dependencyNameMatch;

    const issuerLocator = exports.findPackageLocator(issuer);

    // If the issuer file doesn't seem to be owned by a package managed through pnp, then we resort to using the next
    // resolution algorithm in the chain, usually the native Node resolution one

    if (!issuerLocator) {
      const result = callNativeResolution(request, issuer);

      if (result === false) {
        throw makeError(
          `BUILTIN_NODE_RESOLUTION_FAIL`,
          `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer doesn't seem to be part of the Yarn-managed dependency tree)`,
          {
            request,
            issuer,
          },
        );
      }

      return result;
    }

    const issuerInformation = getPackageInformationSafe(issuerLocator);

    // We obtain the dependency reference in regard to the package that request it

    let dependencyReference = issuerInformation.packageDependencies.get(dependencyName);

    // If we can't find it, we check if we can potentially load it from the packages that have been defined as potential fallbacks.
    // It's a bit of a hack, but it improves compatibility with the existing Node ecosystem. Hopefully we should eventually be able
    // to kill this logic and become stricter once pnp gets enough traction and the affected packages fix themselves.

    if (issuerLocator !== topLevelLocator) {
      for (let t = 0, T = fallbackLocators.length; dependencyReference === undefined && t < T; ++t) {
        const fallbackInformation = getPackageInformationSafe(fallbackLocators[t]);
        dependencyReference = fallbackInformation.packageDependencies.get(dependencyName);
      }
    }

    // If we can't find the path, and if the package making the request is the top-level, we can offer nicer error messages

    if (!dependencyReference) {
      if (dependencyReference === null) {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `You seem to be requiring a peer dependency ("${dependencyName}"), but it is not installed (which might be because you're the top-level package)`,
            {request, issuer, dependencyName},
          );
        } else {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" is trying to access a peer dependency ("${dependencyName}") that should be provided by its direct ancestor but isn't`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName},
          );
        }
      } else {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `You cannot require a package ("${dependencyName}") that is not declared in your dependencies (via "${issuer}")`,
            {request, issuer, dependencyName},
          );
        } else {
          const candidates = Array.from(issuerInformation.packageDependencies.keys());
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" (via "${issuer}") is trying to require the package "${dependencyName}" (via "${request}") without it being listed in its dependencies (${candidates.join(
              `, `,
            )})`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName, candidates},
          );
        }
      }
    }

    // We need to check that the package exists on the filesystem, because it might not have been installed

    const dependencyLocator = {name: dependencyName, reference: dependencyReference};
    const dependencyInformation = exports.getPackageInformation(dependencyLocator);
    const dependencyLocation = path.resolve(__dirname, dependencyInformation.packageLocation);

    if (!dependencyLocation) {
      throw makeError(
        `MISSING_DEPENDENCY`,
        `Package "${dependencyLocator.name}@${dependencyLocator.reference}" is a valid dependency, but hasn't been installed and thus cannot be required (it might be caused if you install a partial tree, such as on production environments)`,
        {request, issuer, dependencyLocator: Object.assign({}, dependencyLocator)},
      );
    }

    // Now that we know which package we should resolve to, we only have to find out the file location

    if (subPath) {
      unqualifiedPath = path.resolve(dependencyLocation, subPath);
    } else {
      unqualifiedPath = dependencyLocation;
    }
  }

  return path.normalize(unqualifiedPath);
};

/**
 * Transforms an unqualified path into a qualified path by using the Node resolution algorithm (which automatically
 * appends ".js" / ".json", and transforms directory accesses into "index.js").
 */

exports.resolveUnqualified = function resolveUnqualified(
  unqualifiedPath,
  {extensions = Object.keys(Module._extensions)} = {},
) {
  const qualifiedPath = applyNodeExtensionResolution(unqualifiedPath, {extensions});

  if (qualifiedPath) {
    return path.normalize(qualifiedPath);
  } else {
    throw makeError(
      `QUALIFIED_PATH_RESOLUTION_FAILED`,
      `Couldn't find a suitable Node resolution for unqualified path "${unqualifiedPath}"`,
      {unqualifiedPath},
    );
  }
};

/**
 * Transforms a request into a fully qualified path.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveRequest = function resolveRequest(request, issuer, {considerBuiltins, extensions} = {}) {
  let unqualifiedPath;

  try {
    unqualifiedPath = exports.resolveToUnqualified(request, issuer, {considerBuiltins});
  } catch (originalError) {
    // If we get a BUILTIN_NODE_RESOLUTION_FAIL error there, it means that we've had to use the builtin node
    // resolution, which usually shouldn't happen. It might be because the user is trying to require something
    // from a path loaded through a symlink (which is not possible, because we need something normalized to
    // figure out which package is making the require call), so we try to make the same request using a fully
    // resolved issuer and throws a better and more actionable error if it works.
    if (originalError.code === `BUILTIN_NODE_RESOLUTION_FAIL`) {
      let realIssuer;

      try {
        realIssuer = realpathSync(issuer);
      } catch (error) {}

      if (realIssuer) {
        if (issuer.endsWith(`/`)) {
          realIssuer = realIssuer.replace(/\/?$/, `/`);
        }

        try {
          exports.resolveToUnqualified(request, realIssuer, {considerBuiltins});
        } catch (error) {
          // If an error was thrown, the problem doesn't seem to come from a path not being normalized, so we
          // can just throw the original error which was legit.
          throw originalError;
        }

        // If we reach this stage, it means that resolveToUnqualified didn't fail when using the fully resolved
        // file path, which is very likely caused by a module being invoked through Node with a path not being
        // correctly normalized (ie you should use "node $(realpath script.js)" instead of "node script.js").
        throw makeError(
          `SYMLINKED_PATH_DETECTED`,
          `A pnp module ("${request}") has been required from what seems to be a symlinked path ("${issuer}"). This is not possible, you must ensure that your modules are invoked through their fully resolved path on the filesystem (in this case "${realIssuer}").`,
          {
            request,
            issuer,
            realIssuer,
          },
        );
      }
    }
    throw originalError;
  }

  if (unqualifiedPath === null) {
    return null;
  }

  try {
    return exports.resolveUnqualified(unqualifiedPath, {extensions});
  } catch (resolutionError) {
    if (resolutionError.code === 'QUALIFIED_PATH_RESOLUTION_FAILED') {
      Object.assign(resolutionError.data, {request, issuer});
    }
    throw resolutionError;
  }
};

/**
 * Setups the hook into the Node environment.
 *
 * From this point on, any call to `require()` will go through the "resolveRequest" function, and the result will
 * be used as path of the file to load.
 */

exports.setup = function setup() {
  // A small note: we don't replace the cache here (and instead use the native one). This is an effort to not
  // break code similar to "delete require.cache[require.resolve(FOO)]", where FOO is a package located outside
  // of the Yarn dependency tree. In this case, we defer the load to the native loader. If we were to replace the
  // cache by our own, the native loader would populate its own cache, which wouldn't be exposed anymore, so the
  // delete call would be broken.

  const originalModuleLoad = Module._load;

  Module._load = function(request, parent, isMain) {
    if (!enableNativeHooks) {
      return originalModuleLoad.call(Module, request, parent, isMain);
    }

    // Builtins are managed by the regular Node loader

    if (builtinModules.has(request)) {
      try {
        enableNativeHooks = false;
        return originalModuleLoad.call(Module, request, parent, isMain);
      } finally {
        enableNativeHooks = true;
      }
    }

    // The 'pnpapi' name is reserved to return the PnP api currently in use by the program

    if (request === `pnpapi`) {
      return pnpModule.exports;
    }

    // Request `Module._resolveFilename` (ie. `resolveRequest`) to tell us which file we should load

    const modulePath = Module._resolveFilename(request, parent, isMain);

    // Check if the module has already been created for the given file

    const cacheEntry = Module._cache[modulePath];

    if (cacheEntry) {
      return cacheEntry.exports;
    }

    // Create a new module and store it into the cache

    const module = new Module(modulePath, parent);
    Module._cache[modulePath] = module;

    // The main module is exposed as global variable

    if (isMain) {
      process.mainModule = module;
      module.id = '.';
    }

    // Try to load the module, and remove it from the cache if it fails

    let hasThrown = true;

    try {
      module.load(modulePath);
      hasThrown = false;
    } finally {
      if (hasThrown) {
        delete Module._cache[modulePath];
      }
    }

    // Some modules might have to be patched for compatibility purposes

    if (patchedModules.has(request)) {
      module.exports = patchedModules.get(request)(module.exports);
    }

    return module.exports;
  };

  const originalModuleResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function(request, parent, isMain, options) {
    if (!enableNativeHooks) {
      return originalModuleResolveFilename.call(Module, request, parent, isMain, options);
    }

    let issuers;

    if (options) {
      const optionNames = new Set(Object.keys(options));
      optionNames.delete('paths');

      if (optionNames.size > 0) {
        throw makeError(
          `UNSUPPORTED`,
          `Some options passed to require() aren't supported by PnP yet (${Array.from(optionNames).join(', ')})`,
        );
      }

      if (options.paths) {
        issuers = options.paths.map(entry => `${path.normalize(entry)}/`);
      }
    }

    if (!issuers) {
      const issuerModule = getIssuerModule(parent);
      const issuer = issuerModule ? issuerModule.filename : `${process.cwd()}/`;

      issuers = [issuer];
    }

    let firstError;

    for (const issuer of issuers) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, issuer);
      } catch (error) {
        firstError = firstError || error;
        continue;
      }

      return resolution !== null ? resolution : request;
    }

    throw firstError;
  };

  const originalFindPath = Module._findPath;

  Module._findPath = function(request, paths, isMain) {
    if (!enableNativeHooks) {
      return originalFindPath.call(Module, request, paths, isMain);
    }

    for (const path of paths) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, path);
      } catch (error) {
        continue;
      }

      if (resolution) {
        return resolution;
      }
    }

    return false;
  };

  process.versions.pnp = String(exports.VERSIONS.std);
};

exports.setupCompatibilityLayer = () => {
  // see https://github.com/browserify/resolve/blob/master/lib/caller.js
  const getCaller = () => {
    const origPrepareStackTrace = Error.prepareStackTrace;

    Error.prepareStackTrace = (_, stack) => stack;
    const stack = new Error().stack;
    Error.prepareStackTrace = origPrepareStackTrace;

    return stack[2].getFileName();
  };

  // ESLint currently doesn't have any portable way for shared configs to specify their own
  // plugins that should be used (https://github.com/eslint/eslint/issues/10125). This will
  // likely get fixed at some point, but it'll take time and in the meantime we'll just add
  // additional fallback entries for common shared configs.

  for (const name of [`react-scripts`]) {
    const packageInformationStore = packageInformationStores.get(name);
    if (packageInformationStore) {
      for (const reference of packageInformationStore.keys()) {
        fallbackLocators.push({name, reference});
      }
    }
  }

  // We need to shim the "resolve" module, because Liftoff uses it in order to find the location
  // of the module in the dependency tree. And Liftoff is used to power Gulp, which doesn't work
  // at all unless modulePath is set, which we cannot configure from any other way than through
  // the Liftoff pipeline (the key isn't whitelisted for env or cli options).

  patchedModules.set(/^resolve$/, realResolve => {
    const mustBeShimmed = caller => {
      const callerLocator = exports.findPackageLocator(caller);

      return callerLocator && callerLocator.name === 'liftoff';
    };

    const attachCallerToOptions = (caller, options) => {
      if (!options.basedir) {
        options.basedir = path.dirname(caller);
      }
    };

    const resolveSyncShim = (request, {basedir}) => {
      return exports.resolveRequest(request, basedir, {
        considerBuiltins: false,
      });
    };

    const resolveShim = (request, options, callback) => {
      setImmediate(() => {
        let error;
        let result;

        try {
          result = resolveSyncShim(request, options);
        } catch (thrown) {
          error = thrown;
        }

        callback(error, result);
      });
    };

    return Object.assign(
      (request, options, callback) => {
        if (typeof options === 'function') {
          callback = options;
          options = {};
        } else if (!options) {
          options = {};
        }

        const caller = getCaller();
        attachCallerToOptions(caller, options);

        if (mustBeShimmed(caller)) {
          return resolveShim(request, options, callback);
        } else {
          return realResolve.sync(request, options, callback);
        }
      },
      {
        sync: (request, options) => {
          if (!options) {
            options = {};
          }

          const caller = getCaller();
          attachCallerToOptions(caller, options);

          if (mustBeShimmed(caller)) {
            return resolveSyncShim(request, options);
          } else {
            return realResolve.sync(request, options);
          }
        },
        isCore: request => {
          return realResolve.isCore(request);
        },
      },
    );
  });
};

if (module.parent && module.parent.id === 'internal/preload') {
  exports.setupCompatibilityLayer();

  exports.setup();
}

if (process.mainModule === module) {
  exports.setupCompatibilityLayer();

  const reportError = (code, message, data) => {
    process.stdout.write(`${JSON.stringify([{code, message, data}, null])}\n`);
  };

  const reportSuccess = resolution => {
    process.stdout.write(`${JSON.stringify([null, resolution])}\n`);
  };

  const processResolution = (request, issuer) => {
    try {
      reportSuccess(exports.resolveRequest(request, issuer));
    } catch (error) {
      reportError(error.code, error.message, error.data);
    }
  };

  const processRequest = data => {
    try {
      const [request, issuer] = JSON.parse(data);
      processResolution(request, issuer);
    } catch (error) {
      reportError(`INVALID_JSON`, error.message, error.data);
    }
  };

  if (process.argv.length > 2) {
    if (process.argv.length !== 4) {
      process.stderr.write(`Usage: ${process.argv[0]} ${process.argv[1]} <request> <issuer>\n`);
      process.exitCode = 64; /* EX_USAGE */
    } else {
      processResolution(process.argv[2], process.argv[3]);
    }
  } else {
    let buffer = '';
    const decoder = new StringDecoder.StringDecoder();

    process.stdin.on('data', chunk => {
      buffer += decoder.write(chunk);

      do {
        const index = buffer.indexOf('\n');
        if (index === -1) {
          break;
        }

        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);

        processRequest(line);
      } while (true);
    });
  }
}

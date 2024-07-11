import fsp from 'node:fs/promises';
import path from 'node:path';
import { EOL } from 'node:os';
import { visit } from 'unist-util-visit';
import stripIndent from 'strip-indent';
import type { Node, Code, Parent } from 'mdast';
import type { VFile } from 'vfile';
import type { Plugin } from 'unified';

interface CodeImportOptions {
  preserveTrailingNewline?: boolean;
  removeRedundantIndentations?: boolean;
  rootDir?: string;
  allowImportingFromOutside?: boolean;
}

function extractLines(
  content: string,
  fromLine: number | undefined,
  hasDash: boolean,
  toLine: number | undefined,
  preserveTrailingNewline: boolean = false
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

const codeImport: Plugin<[CodeImportOptions]> = (options = {}) => {
  const rootDir = options.rootDir || process.cwd();

  if (!path.isAbsolute(rootDir)) {
    throw new Error(`"rootDir" has to be an absolute path`);
  }

  return async function transformer(tree: Node, file: VFile): Promise<void> {
    const codes: [Code, number | undefined, Parent][] = [];
    const promises: Promise<void>[] = [];

    visit(tree, 'code', (node, index, parent) => {
      codes.push([node as Code, index, parent as Parent]);
    });

    for (const [node] of codes) {
      const fileMeta = (node.meta || '')
        // Allow escaping spaces
        .split(/(?<!\\) /g)
        .find((meta) => meta.startsWith('file='));

      if (!fileMeta) {
        continue;
      }

      if (!file.dirname) {
        throw new Error('"file" should be an instance of VFile');
      }

      const res =
        /^file=(?<path>.+?)(?:(?:#(?:L(?<from>\d+)(?<dash>-)?)?)(?:L(?<to>\d+))?)?$/.exec(
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
      const normalizedFilePath = filePath
        .replace(/^<rootDir>/, rootDir)
        .replace(/\\ /g, ' ');
      const fileAbsPath = path.resolve(file.dirname, normalizedFilePath);

      if (!options.allowImportingFromOutside) {
        const relativePathFromRootDir = path.relative(rootDir, fileAbsPath);
        if (
          !rootDir ||
          relativePathFromRootDir.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relativePathFromRootDir)
        ) {
          throw new Error(
            `Attempted to import code from "${fileAbsPath}", which is outside from the rootDir "${rootDir}"`
          );
        }
      }

      promises.push(
        (async () => {
          const fileContent = await fsp.readFile(fileAbsPath, 'utf8');

          node.value = extractLines(
            fileContent,
            fromLine,
            hasDash,
            toLine,
            options.preserveTrailingNewline
          );
          if (options.removeRedundantIndentations) {
            node.value = stripIndent(node.value);
          }
        })()
      );
    }

    if (promises.length) {
      await Promise.all(promises);

      return;
    }
  };
};

export { codeImport };
export default codeImport;

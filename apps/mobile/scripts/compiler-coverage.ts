import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  findDirectiveDisablingMemoization,
  LoggerEvent,
  PluginOptions,
} from "babel-plugin-react-compiler";

export type CompilerBailout = {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
};

type SourcesFilter = (filename: string) => boolean;

type BabelConfig = (api: { readonly cache: () => void }) => {
  readonly presets: readonly (readonly [
    string,
    { readonly "react-compiler": { readonly sources: SourcesFilter } },
  ])[];
};

type CompilerOptions = {
  readonly compilationMode: "infer";
  readonly panicThreshold: "none";
  readonly logger: {
    readonly logEvent: (file: string | null, event: LoggerEvent) => void;
  };
};

/** A Babel plugin that only reads the module's own directives. */
type DirectivesProbe = {
  readonly visitor: {
    readonly Program: (path: {
      readonly node: {
        readonly directives: Parameters<
          typeof findDirectiveDisablingMemoization
        >[0];
      };
    }) => void;
  };
};

type Babel = {
  readonly transformSync: (
    code: string,
    options: {
      readonly filename: string;
      readonly babelrc: false;
      readonly configFile: false;
      readonly parserOpts: { readonly plugins: readonly string[] };
      readonly plugins: readonly (
        | DirectivesProbe
        | readonly [string, CompilerOptions]
      )[];
    },
  ) => unknown;
};

type ReactCompilerModule = {
  readonly findDirectiveDisablingMemoization: typeof findDirectiveDisablingMemoization;
  readonly parsePluginOptions: (
    options: Partial<PluginOptions>,
  ) => PluginOptions;
};

export type CompilerSource = {
  /** Path relative to apps/mobile. */
  readonly file: string;
  readonly code: string;
};

const require = createRequire(import.meta.url);
const appRoot = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_FILE = /\.tsx?$/;
const NOT_COMPILED_SOURCE = /\.(test|d)\.tsx?$/;

/** The app's own React Compiler `sources` filter, read from babel.config.js. */
function readSourcesFilter(): SourcesFilter {
  const babelConfig: BabelConfig = require("../babel.config.js");
  return babelConfig({ cache() {} }).presets[0][1]["react-compiler"].sources;
}

function listSourceFiles(): readonly string[] {
  const srcRoot = join(appRoot, "src");
  return readdirSync(srcRoot, { recursive: true, encoding: "utf8" })
    .filter((path) => SOURCE_FILE.test(path) && !NOT_COMPILED_SOURCE.test(path))
    .map((path) => join(srcRoot, path))
    .sort();
}

/**
 * Maps one compiler logger event to a bailout. A `CompileError` is a function the
 * compiler declined to compile; a `PipelineError` is an internal failure that also
 * leaves the function uncompiled (the app's `critical_errors` setting would fail the
 * build on it); a `CompileSkip` is a function opted out with a `"use no memo"` or
 * `"use no forget"` directive. Every other event kind is not a bailout.
 */
export function bailoutFromEvent(
  file: string,
  event: LoggerEvent,
): CompilerBailout | undefined {
  switch (event.kind) {
    case "CompileError":
      return {
        file,
        line: event.fnLoc?.start.line ?? 0,
        reason: event.detail.reason,
      };
    case "PipelineError":
      return {
        file,
        line: event.fnLoc?.start.line ?? 0,
        reason: event.data,
      };
    case "CompileSkip":
      return {
        file,
        line: event.fnLoc?.start.line ?? 0,
        reason: event.reason,
      };
    default:
      return undefined;
  }
}

/**
 * Runs babel-plugin-react-compiler (compilationMode "infer", panicThreshold "none",
 * with a logger) over each source and returns one entry per CompileError,
 * PipelineError or CompileSkip event, since each leaves a function uncompiled. A
 * module-level opt-out directive (`"use no memo"`, `"use no forget"`) leaves the
 * whole file uncompiled although the compiler logs only CompileSuccess for it, so it
 * adds one more entry for that file.
 */
export function bailoutsForSources(
  sources: readonly CompilerSource[],
): readonly CompilerBailout[] {
  const babel: Babel = require("@babel/core");
  const reactCompiler = require.resolve("babel-plugin-react-compiler");
  const compiler: ReactCompilerModule = require("babel-plugin-react-compiler");
  const defaultOptions = compiler.parsePluginOptions({});
  const bailouts: CompilerBailout[] = [];

  for (const { file, code } of sources) {
    const moduleOptOut: DirectivesProbe = {
      visitor: {
        Program(path) {
          const directive = compiler.findDirectiveDisablingMemoization(
            path.node.directives,
            defaultOptions,
          );
          if (directive !== null) {
            bailouts.push({
              file,
              line: directive.loc?.start.line ?? 0,
              reason: `module-level "${directive.value.value}" directive`,
            });
          }
        },
      },
    };
    babel.transformSync(code, {
      filename: join(appRoot, file),
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ["typescript", "jsx"] },
      plugins: [
        moduleOptOut,
        [
          reactCompiler,
          {
            compilationMode: "infer",
            panicThreshold: "none",
            logger: {
              logEvent(_file, event) {
                const bailout = bailoutFromEvent(file, event);
                if (bailout) {
                  bailouts.push(bailout);
                }
              },
            },
          },
        ],
      ],
    });
  }
  return bailouts;
}

/**
 * `bailoutsForSources` over every non-test .ts/.tsx file under apps/mobile/src that
 * the app's own `sources` filter accepts. `file` is relative to apps/mobile.
 */
export function listCompilerBailouts(): readonly CompilerBailout[] {
  const accepts = readSourcesFilter();
  return bailoutsForSources(
    listSourceFiles()
      .filter((filename) => accepts(filename))
      .map((filename) => ({
        file: relative(appRoot, filename),
        code: readFileSync(filename, "utf8"),
      })),
  );
}
